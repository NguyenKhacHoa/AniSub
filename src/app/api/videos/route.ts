import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  PRIMARY_GENRE_OPTIONS,
  type CinemaVideoItem,
  type PrimaryGenreTag,
} from '@/types/workspace';

function normalizeChannelTags(
  genreTags: string[] | null | undefined,
  fallbackSingle: string | null | undefined,
): PrimaryGenreTag[] {
  const set = new Set<PrimaryGenreTag>();
  for (const tag of genreTags ?? []) {
    if (PRIMARY_GENRE_OPTIONS.includes(tag as PrimaryGenreTag)) {
      set.add(tag as PrimaryGenreTag);
    }
  }
  if (
    set.size === 0 &&
    fallbackSingle &&
    PRIMARY_GENRE_OPTIONS.includes(fallbackSingle as PrimaryGenreTag)
  ) {
    set.add(fallbackSingle as PrimaryGenreTag);
  }
  if (set.size === 0) {
    set.add('HH2D');
  }
  return Array.from(set);
}

function parseGenreParam(raw: string | null): PrimaryGenreTag | 'all' {
  const val = raw?.trim();
  if (!val || val === 'all' || val === 'Tất cả') return 'all';
  if (val === 'Phim AI') return 'Phim AI';
  if (val === 'HH2D') return 'HH2D';
  return 'all';
}

function parseTabParam(
  raw: string | null,
): 'all' | 'episode' | 'full_movie' | 'continue' {
  const val = raw?.trim();
  if (!val || val === 'all' || val === 'Tất cả') return 'all';
  if (val === 'episode' || val === 'Tập mới') return 'episode';
  if (val === 'full_movie' || val === 'Phim Full') return 'full_movie';
  if (val === 'continue' || val === 'Đang cày dở') return 'continue';
  return 'all';
}

export async function GET(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const offsetRaw = Number(searchParams.get('offset') ?? 0);
  const limitRaw = Number(searchParams.get('limit') ?? 60);
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(120, Math.floor(limitRaw))
      : 60;

  const genre = parseGenreParam(searchParams.get('genre'));
  const tab = parseTabParam(searchParams.get('tab'));
  const showTrailers = searchParams.get('showTrailers') === 'true';
  const queryText = (searchParams.get('q') ?? '').trim();

  const admin = createAdminClient();

  // 1. Lấy danh sách kênh user đang kích hoạt (is_selected = true) kèm genre_tags
  let userChannels: Array<{
    channel_id: string;
    genre_tag: string;
    genre_tags?: string[] | null;
  }> = [];

  const ucWithMulti = await admin
    .from('user_channels')
    .select('channel_id, genre_tag, genre_tags')
    .eq('user_id', auth.userId)
    .eq('is_selected', true);

  if (ucWithMulti.error) {
    const ucFallback = await admin
      .from('user_channels')
      .select('channel_id, genre_tag')
      .eq('user_id', auth.userId)
      .eq('is_selected', true);
    userChannels = ucFallback.data ?? [];
  } else {
    userChannels = ucWithMulti.data ?? [];
  }

  if (userChannels.length === 0) {
    return NextResponse.json({
      videos: [],
      totalCount: 0,
      offset,
      limit,
      hasMore: false,
    });
  }

  const channelTagsMap = new Map<string, PrimaryGenreTag[]>();
  for (const uc of userChannels) {
    channelTagsMap.set(
      uc.channel_id,
      normalizeChannelTags(uc.genre_tags, uc.genre_tag),
    );
  }

  // 2. Quy tắc lọc theo ngữ cảnh (Genre-Aware Filtering):
  // - genre === 'all': lấy tất cả kênh đang bật
  // - genre === 'Phim AI' | 'HH2D': chỉ lấy kênh đang bật có gắn tag tương ứng trong genre_tags
  const eligibleChannelIds = userChannels
    .filter((uc) => {
      if (genre === 'all') return true;
      const tags = channelTagsMap.get(uc.channel_id) ?? ['HH2D'];
      return tags.includes(genre);
    })
    .map((uc) => uc.channel_id);

  if (eligibleChannelIds.length === 0) {
    return NextResponse.json({
      videos: [],
      totalCount: 0,
      offset,
      limit,
      hasMore: false,
    });
  }

  // Lấy tên kênh để phục vụ join channel_title & tìm kiếm theo tên kênh
  const { data: channelRows } = await admin
    .from('channels')
    .select('channel_id, title')
    .in('channel_id', eligibleChannelIds);

  const channelTitleMap = new Map(
    (channelRows ?? []).map((c) => [c.channel_id, c.title]),
  );

  // Nếu tab === 'continue', lấy trước danh sách video_id đang xem dở của user
  let continueVideoIds: string[] | null = null;
  if (tab === 'continue') {
    const { data: inProgressRows } = await admin
      .from('watch_progress')
      .select('video_id')
      .eq('user_id', auth.userId)
      .gt('progress_seconds', 0)
      .eq('is_completed', false);

    continueVideoIds = (inProgressRows ?? []).map((r) => r.video_id);
    if (continueVideoIds.length === 0) {
      return NextResponse.json({
        videos: [],
        totalCount: 0,
        offset,
        limit,
        hasMore: false,
      });
    }
  }

  // Chuẩn bị bộ lọc tìm kiếm q (an toàn cho PostgREST .or())
  const safeQ = queryText.replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim();
  const matchingChannelIdsByName = safeQ
    ? eligibleChannelIds.filter((cid) =>
        (channelTitleMap.get(cid) ?? '')
          .toLowerCase()
          .includes(safeQ.toLowerCase()),
      )
    : [];

  const runVideoQuery = async (includeManualTagColumn: boolean) => {
    const columns = includeManualTagColumn
      ? 'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, created_at'
      : 'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, created_at';

    let qBuilder = admin
      .from('videos')
      .select(columns, { count: 'exact' })
      .in('channel_id', eligibleChannelIds)
      .eq('is_short', false);

    if (genre !== 'all') {
      qBuilder = qBuilder.eq('detected_genre', genre);
    }

    if (!showTrailers) {
      qBuilder = qBuilder.neq('video_type', 'trailer');
    }

    if (tab === 'episode') {
      qBuilder = qBuilder.eq('video_type', 'episode');
    } else if (tab === 'full_movie') {
      qBuilder = qBuilder.eq('video_type', 'full_movie');
    } else if (tab === 'continue' && continueVideoIds) {
      qBuilder = qBuilder.in('video_id', continueVideoIds);
    }

    if (safeQ) {
      const orParts = [
        `title.ilike.%${safeQ}%`,
        `series_name.ilike.%${safeQ}%`,
      ];
      if (matchingChannelIdsByName.length > 0) {
        orParts.push(`channel_id.in.(${matchingChannelIdsByName.join(',')})`);
      }
      qBuilder = qBuilder.or(orParts.join(','));
    }

    return qBuilder
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);
  };

  type RawVideoRow = {
    video_id: string;
    channel_id: string;
    title: string;
    description: string | null;
    thumbnail_url: string | null;
    published_at: string;
    duration_seconds: number;
    is_short: boolean;
    video_type: CinemaVideoItem['video_type'];
    detected_genre: CinemaVideoItem['detected_genre'];
    series_name: string | null;
    episode_number: number | null;
    ai_summary: string | null;
    is_manual_tag?: boolean;
    created_at: string;
  };

  let fetchedVideos: RawVideoRow[] = [];
  let totalCount = 0;

  const primaryRes = await runVideoQuery(true);
  if (primaryRes.error) {
    const fallbackRes = await runVideoQuery(false);
    if (fallbackRes.error) {
      console.error('[GET /api/videos] Lỗi truy vấn videos:', fallbackRes.error);
      return NextResponse.json(
        { error: 'Không thể tải danh sách video.' },
        { status: 500 },
      );
    }
    fetchedVideos = (fallbackRes.data ?? []) as unknown as RawVideoRow[];
    totalCount = fallbackRes.count ?? fetchedVideos.length;
  } else {
    fetchedVideos = (primaryRes.data ?? []) as unknown as RawVideoRow[];
    totalCount = primaryRes.count ?? fetchedVideos.length;
  }

  const hasMore = offset + fetchedVideos.length < totalCount;

  if (fetchedVideos.length === 0) {
    return NextResponse.json({
      videos: [],
      totalCount,
      offset,
      limit,
      hasMore,
    });
  }

  // 3. Ghép tiến độ xem watch_progress của user hiện tại
  const videoIds = fetchedVideos.map((v) => v.video_id);
  const { data: progressRows } = await admin
    .from('watch_progress')
    .select('video_id, progress_seconds, is_completed')
    .eq('user_id', auth.userId)
    .in('video_id', videoIds);

  const progressMap = new Map(
    (progressRows ?? []).map((p) => [p.video_id, p]),
  );

  const mergedVideos: CinemaVideoItem[] = fetchedVideos.map((v) => {
    const progress = progressMap.get(v.video_id);
    const chTags = channelTagsMap.get(v.channel_id) ?? ['HH2D'];
    return {
      ...v,
      detected_genre:
        v.detected_genre === 'Phim AI' || v.detected_genre === 'HH2D'
          ? v.detected_genre
          : chTags[0],
      channel_title: channelTitleMap.get(v.channel_id) ?? v.channel_id,
      progress_seconds: progress?.progress_seconds ?? 0,
      is_completed: progress?.is_completed ?? false,
    };
  });

  return NextResponse.json({
    videos: mergedVideos,
    totalCount,
    offset,
    limit,
    hasMore,
  });
}
