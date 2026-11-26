import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  PRIMARY_GENRE_OPTIONS,
  computeChannelHotnessBaselines,
  computeVideoHotness,
  normalizeHotBadge,
  type CinemaVideoItem,
  type HotBadge,
  type PrimaryGenreTag,
} from '@/types/workspace';

const DB_FETCH_BATCH_SIZE = 1000;
export const dynamic = 'force-dynamic';

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

interface RawVideoRow {
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
  is_theatrical_movie?: boolean | null;
  theatrical_release_year?: number | null;
  cinema_format?: CinemaVideoItem['cinema_format'];
  cinema_genres?: string[] | null;
  is_unavailable?: boolean | null;
  youtube_playlist_id?: string | null;
  playlist_position?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  hot_badge?: HotBadge;
  hot_score?: number | null;
  is_upcoming?: boolean | null;
  scheduled_start_at?: string | null;
  created_at: string;
}

const DESIRED_VIDEO_COLUMNS = [
  'video_id',
  'channel_id',
  'title',
  'description',
  'thumbnail_url',
  'published_at',
  'duration_seconds',
  'is_short',
  'video_type',
  'detected_genre',
  'series_name',
  'episode_number',
  'ai_summary',
  'is_manual_tag',
  'is_theatrical_movie',
  'theatrical_release_year',
  'cinema_format',
  'cinema_genres',
  'is_unavailable',
  'youtube_playlist_id',
  'playlist_position',
  'view_count',
  'like_count',
  'comment_count',
  'hot_badge',
  'hot_score',
  'is_upcoming',
  'scheduled_start_at',
  'created_at',
] as const;

const missingApiVideoCols = new Set<string>();

function extractMissingApiColumn(errorMessage?: string | null): string | null {
  if (!errorMessage) return null;
  const m1 = errorMessage.match(
    /column\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i,
  );
  if (m1?.[1]) return m1[1];
  const m2 = errorMessage.match(
    /Could not find the\s+['"]([a-zA-Z0-9_]+)['"]\s+column/i,
  );
  if (m2?.[1]) return m2[1];
  return null;
}

function buildApiVideoSelect(): string {
  return DESIRED_VIDEO_COLUMNS.filter(
    (col) => !missingApiVideoCols.has(col),
  ).join(', ');
}

/**
 * GET /api/videos — Trả về 100% toàn bộ video không phải Shorts khớp ngữ cảnh
 * bằng truy vấn phân đoạn tự động (`.range(from, to)` theo từng lô 1.000 dòng).
 */
export async function GET(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const genre = parseGenreParam(searchParams.get('genre'));
  const tab = parseTabParam(searchParams.get('tab'));
  const showTrailers = searchParams.get('showTrailers') === 'true';
  const queryText = (searchParams.get('q') ?? '').trim();

  const admin = createAdminClient();

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
      hasMore: false,
    });
  }

  const [{ data: channelRows }, { data: progressRows }] = await Promise.all([
    admin
      .from('channels')
      .select('channel_id, title')
      .in('channel_id', eligibleChannelIds),
    admin
      .from('watch_progress')
      .select('video_id, progress_seconds, is_completed, last_watched_at')
      .eq('user_id', auth.userId),
  ]);

  const channelTitleMap = new Map(
    (channelRows ?? []).map((c) => [c.channel_id, c.title]),
  );
  const progressMap = new Map(
    (progressRows ?? []).map((p) => [p.video_id, p]),
  );

  let continueVideoIds: string[] | null = null;
  if (tab === 'continue') {
    continueVideoIds = (progressRows ?? [])
      .filter((r) => r.progress_seconds > 0 && !r.is_completed)
      .map((r) => r.video_id);
    if (continueVideoIds.length === 0) {
      return NextResponse.json({
        videos: [],
        totalCount: 0,
        hasMore: false,
      });
    }
  }

  const safeQ = queryText.replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim();
  const matchingChannelIdsByName = safeQ
    ? eligibleChannelIds.filter((cid) =>
        (channelTitleMap.get(cid) ?? '')
          .toLowerCase()
          .includes(safeQ.toLowerCase()),
      )
    : [];

  const fetchedVideos: RawVideoRow[] = [];
  let from = 0;

  while (true) {
    const to = from + DB_FETCH_BATCH_SIZE - 1;
    let batchData: RawVideoRow[] | null = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      let qBuilder = admin
        .from('videos')
        .select(buildApiVideoSelect())
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

      const res = await qBuilder
        .order('published_at', { ascending: false })
        .range(from, to);

      if (!res.error) {
        batchData = (res.data ?? []) as unknown as RawVideoRow[];
        break;
      }

      const missingCol = extractMissingApiColumn(res.error.message);
      if (missingCol && !missingApiVideoCols.has(missingCol)) {
        missingApiVideoCols.add(missingCol);
        continue;
      }

      console.error('[GET /api/videos] Lỗi truy vấn videos:', res.error);
      return NextResponse.json(
        { error: 'Không thể tải danh sách video.' },
        { status: 500 },
      );
    }

    if (!batchData) break;
    fetchedVideos.push(...batchData);
    if (batchData.length < DB_FETCH_BATCH_SIZE) break;
    from += DB_FETCH_BATCH_SIZE;
  }

  const nowMs = Date.now();
  const hotBaselines = computeChannelHotnessBaselines(fetchedVideos, nowMs);

  const mergedVideos: CinemaVideoItem[] = fetchedVideos
    .filter((v) => v.is_unavailable !== true)
    .map((v) => {
      const progress = progressMap.get(v.video_id);
      const chTags = channelTagsMap.get(v.channel_id) ?? ['HH2D'];
      const storedBadge = normalizeHotBadge(v.hot_badge);
      const storedScore =
        typeof v.hot_score === 'number' && v.hot_score > 0 ? v.hot_score : 0;
      const hasStoredHot = storedBadge !== null || storedScore > 0;
      const fallbackHot = hasStoredHot
        ? null
        : computeVideoHotness(
            {
              published_at: v.published_at,
              view_count: v.view_count,
              like_count: v.like_count,
              comment_count: v.comment_count,
            },
            hotBaselines.get(v.channel_id),
            nowMs,
          );

      return {
        ...v,
        youtube_playlist_id: v.youtube_playlist_id ?? null,
        playlist_position: v.playlist_position ?? null,
        view_count: v.view_count ?? 0,
        like_count: v.like_count ?? 0,
        comment_count: v.comment_count ?? 0,
        hot_badge: hasStoredHot
          ? storedBadge
          : (fallbackHot?.hot_badge ?? null),
        hot_score: hasStoredHot ? storedScore : (fallbackHot?.hot_score ?? 0),
        is_upcoming: v.is_upcoming === true,
        scheduled_start_at: v.scheduled_start_at ?? null,
        detected_genre:
          v.detected_genre === 'Phim AI' || v.detected_genre === 'HH2D'
            ? v.detected_genre
            : chTags[0],
        channel_title: channelTitleMap.get(v.channel_id) ?? v.channel_id,
        progress_seconds: progress?.progress_seconds ?? 0,
        is_completed: progress?.is_completed ?? false,
        last_watched_at: progress?.last_watched_at ?? null,
      };
    });

  return NextResponse.json(
    {
      videos: mergedVideos,
      totalCount: mergedVideos.length,
      hasMore: false,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
