import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { YouTubeApiError } from '@/lib/youtube/api';
import {
  getChannelNextPageToken,
  isChannelHistoryExhausted,
  syncChannelVideosPage,
} from '@/lib/youtube/channel-sync';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

function normalizeTags(
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

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { genre?: string; maxChannels?: number } = {};
  try {
    body = (await request.json()) as { genre?: string; maxChannels?: number };
  } catch {
    body = {};
  }

  const genreFilter: PrimaryGenreTag | 'all' =
    body.genre === 'Phim AI' || body.genre === 'HH2D' ? body.genre : 'all';
  const maxChannels =
    typeof body.maxChannels === 'number' && Number.isFinite(body.maxChannels)
      ? Math.min(3, Math.max(1, Math.floor(body.maxChannels)))
      : 3;

  const admin = createAdminClient();

  // 1. Lấy các kênh user đang bật (is_selected = true)
  let userChannels: Array<{
    channel_id: string;
    genre_tag: string;
    genre_tags?: string[] | null;
  }> = [];

  const withMulti = await admin
    .from('user_channels')
    .select('channel_id, genre_tag, genre_tags')
    .eq('user_id', auth.userId)
    .eq('is_selected', true);

  if (withMulti.error) {
    const fallback = await admin
      .from('user_channels')
      .select('channel_id, genre_tag')
      .eq('user_id', auth.userId)
      .eq('is_selected', true);
    userChannels = fallback.data ?? [];
  } else {
    userChannels = withMulti.data ?? [];
  }

  if (userChannels.length === 0) {
    return NextResponse.json({
      processedChannels: 0,
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      hasMoreYouTubeHistory: false,
      warning: null,
    });
  }

  // Lọc theo thể loại đang xem nếu user đang ở tab Phim AI / HH2D
  const scopedChannels = userChannels
    .map((uc) => ({
      channelId: uc.channel_id,
      genreTags: normalizeTags(uc.genre_tags, uc.genre_tag),
    }))
    .filter((ch) =>
      genreFilter === 'all' ? true : ch.genreTags.includes(genreFilter),
    );

  if (scopedChannels.length === 0) {
    return NextResponse.json({
      processedChannels: 0,
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      hasMoreYouTubeHistory: false,
      warning: null,
    });
  }

  // 2. Kiểm tra next_page_token của từng kênh để lọc ra những kênh CHƯA cạn lịch sử YouTube
  const checkExhausted =
    typeof isChannelHistoryExhausted === 'function'
      ? isChannelHistoryExhausted
      : (t?: string | null) => t === '__END__' || t === '__EXHAUSTED__';

  const candidates: Array<{
    channelId: string;
    genreTags: PrimaryGenreTag[];
    pageToken: string | null;
  }> = [];

  for (const ch of scopedChannels) {
    const token = await getChannelNextPageToken(ch.channelId);
    if (!checkExhausted(token)) {
      candidates.push({
        channelId: ch.channelId,
        genreTags: ch.genreTags,
        pageToken: token,
      });
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      processedChannels: 0,
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      hasMoreYouTubeHistory: false,
      warning: null,
    });
  }

  // Ưu tiên tối đa 2-3 kênh/lần để phản hồi nhanh & tiết kiệm quota YouTube API
  // Ưu tiên kênh đã có sẵn next_page_token (đang kéo dở), rồi tới kênh chưa kéo (null)
  candidates.sort((a, b) => {
    const aHasToken = a.pageToken ? 0 : 1;
    const bHasToken = b.pageToken ? 0 : 1;
    return aHasToken - bHasToken;
  });

  const batchChannels = candidates.slice(0, maxChannels);

  let processedChannels = 0;
  let fetchedCount = 0;
  let newVideosCount = 0;
  let aiClassifiedCount = 0;
  let warning: string | null = null;
  let anyChannelStillHasMoreInBatch = false;

  for (const ch of batchChannels) {
    try {
      const result = await syncChannelVideosPage({
        channelId: ch.channelId,
        genreTags: ch.genreTags,
        maxResults: 50,
        pageToken: ch.pageToken,
      });

      processedChannels += 1;
      fetchedCount += result.fetchedCount;
      newVideosCount += result.newVideosCount;
      aiClassifiedCount += result.aiClassifiedCount;

      if (result.nextPageToken) {
        anyChannelStillHasMoreInBatch = true;
      }
      if (result.warning && !warning) {
        warning = result.warning;
      }
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        if (err.reason === 'quotaExceeded') {
          warning =
            'YouTube Data API tạm hết hạn mức Quota hôm nay. Vui lòng thử lại sau.';
          break;
        }
        if (err.reason === 'missing_api_key') {
          return NextResponse.json(
            { error: 'Thiếu YOUTUBE_API_KEY trong .env.local.' },
            { status: 400 },
          );
        }
        warning = `Lỗi tải lịch sử YouTube: ${err.message}`;
      } else {
        console.error(
          `[LoadMoreAll] Lỗi kéo lịch sử kênh ${ch.channelId}:`,
          err,
        );
        warning = 'Một số kênh gặp lỗi tạm thời khi kéo video cũ từ YouTube.';
      }
    }
  }

  const remainingUntouchedChannels = candidates.length > batchChannels.length;
  const hasMoreYouTubeHistory =
    remainingUntouchedChannels || anyChannelStillHasMoreInBatch;

  return NextResponse.json({
    processedChannels,
    fetchedCount,
    newVideosCount,
    aiClassifiedCount,
    hasMoreYouTubeHistory,
    warning,
  });
}
