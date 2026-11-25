import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchVideoDetailsByIds } from '@/lib/youtube/api';
import {
  syncChannelPlaylistsAll,
  syncChannelVideosPage,
} from '@/lib/youtube/channel-sync';
import {
  PRIMARY_GENRE_OPTIONS,
  computeChannelHotnessBaselines,
  computeVideoHotness,
  type PrimaryGenreTag,
} from '@/types/workspace';

export const maxDuration = 60;

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TOTAL_TIME_BUDGET_MS = 22_000;
const PLAYLIST_TIME_BUDGET_MS = 10_000;
const BACKFILL_LIMIT = 150; // 3 request videos.list x 50 ID mỗi chu kỳ cron
const DELTA_MAX_RESULTS = 15;
const CONCURRENCY_LIMIT = 3;

let lastAutoCinemaTriggerMs = 0;

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
  if (set.size === 0) set.add('HH2D');
  return Array.from(set);
}

function isAuthorizedCronRequest(request: Request): {
  ok: boolean;
  reason?: string;
} {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization')?.trim() ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerSecret = request.headers.get('x-cron-secret')?.trim() ?? '';
  const urlSecret = new URL(request.url).searchParams.get('secret')?.trim() ?? '';
  const providedSecret = bearerToken || headerSecret || urlSecret;

  if (configuredSecret) {
    if (providedSecret && providedSecret === configuredSecret) {
      return { ok: true };
    }
    return { ok: false, reason: 'Invalid or missing CRON_SECRET Bearer token' };
  }

  // Nếu chưa cấu hình CRON_SECRET: chỉ cho phép chạy ở môi trường local hoặc có header nội bộ
  if (process.env.NODE_ENV !== 'production') {
    return { ok: true };
  }
  if (
    request.headers.get('x-vercel-cron') === '1' ||
    providedSecret.length > 0
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: 'CRON_SECRET chưa được cấu hình trên môi trường production',
  };
}

async function handleAutoSync(request: Request) {
  const authCheck = isAuthorizedCronRequest(request);
  if (!authCheck.ok) {
    return NextResponse.json(
      { ok: false, error: authCheck.reason || 'Unauthorized' },
      { status: 401 },
    );
  }

  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'Thiếu YOUTUBE_API_KEY trên máy chủ.' },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const admin = createAdminClient();

  // 1. Lấy toàn bộ các kênh đang kích hoạt (`user_channels.is_selected = true`) bằng Service Role (không cần cookie)
  let rawUserChannels: Array<{
    user_id: string;
    channel_id: string;
    genre_tag: string;
    genre_tags?: string[] | null;
  }> = [];

  const withMultiRes = await admin
    .from('user_channels')
    .select('user_id, channel_id, genre_tag, genre_tags')
    .eq('is_selected', true);

  if (withMultiRes.error) {
    const fallbackRes = await admin
      .from('user_channels')
      .select('user_id, channel_id, genre_tag')
      .eq('is_selected', true);
    rawUserChannels = fallbackRes.data ?? [];
  } else {
    rawUserChannels = withMultiRes.data ?? [];
  }

  const activeUserIds = Array.from(
    new Set(rawUserChannels.map((row) => row.user_id)),
  );

  // Gom kênh duy nhất theo channel_id (hợp nhất genre_tags nếu nhiều user cùng theo dõi)
  const channelMap = new Map<string, PrimaryGenreTag[]>();
  for (const row of rawUserChannels) {
    const tags = normalizeTags(row.genre_tags, row.genre_tag);
    const existing = channelMap.get(row.channel_id);
    if (!existing) {
      channelMap.set(row.channel_id, tags);
    } else {
      const merged = Array.from(new Set([...existing, ...tags]));
      channelMap.set(row.channel_id, merged);
    }
  }

  const activeChannels = Array.from(channelMap.entries()).map(
    ([channelId, genreTags]) => ({ channelId, genreTags }),
  );

  let channelsSyncedCount = 0;
  let playlistsSyncedCount = 0;
  let newVideosCount = 0;
  let statsUpdatedCount = 0;
  let hotTaggedCount = 0;
  const warnings: string[] = [];

  // BƯỚC 1A: Delta-Sync video mới nhất cho toàn bộ kênh đang kích hoạt (15 video/kênh)
  for (let i = 0; i < activeChannels.length; i += CONCURRENCY_LIMIT) {
    if (Date.now() - startedAt >= TOTAL_TIME_BUDGET_MS - 6000) break;
    const batch = activeChannels.slice(i, i + CONCURRENCY_LIMIT);
    const settled = await Promise.allSettled(
      batch.map((ch) =>
        syncChannelVideosPage({
          channelId: ch.channelId,
          genreTags: ch.genreTags,
          maxResults: DELTA_MAX_RESULTS,
          skipSaveNextPageToken: true,
        }),
      ),
    );

    for (const item of settled) {
      if (item.status === 'fulfilled') {
        channelsSyncedCount += 1;
        newVideosCount += item.value.newVideosCount;
        if (item.value.warning) warnings.push(item.value.warning);
      } else {
        console.error('[CronAutoSync] Lỗi delta-sync 1 kênh:', item.reason);
      }
    }
  }

  // BƯỚC 1B: Đồng bộ YouTube Playlists cho các kênh đang kích hoạt trong ngân sách thời gian an toàn
  const playlistStart = Date.now();
  for (let i = 0; i < activeChannels.length; i += 2) {
    const plElapsed = Date.now() - playlistStart;
    const totalElapsed = Date.now() - startedAt;
    if (
      plElapsed >= PLAYLIST_TIME_BUDGET_MS ||
      totalElapsed >= TOTAL_TIME_BUDGET_MS - 5000
    ) {
      break;
    }

    const remainingPlMs = Math.max(
      2000,
      Math.min(
        PLAYLIST_TIME_BUDGET_MS - plElapsed,
        TOTAL_TIME_BUDGET_MS - 5000 - totalElapsed,
      ),
    );
    const batch = activeChannels.slice(i, i + 2);
    const settledPl = await Promise.allSettled(
      batch.map((ch) =>
        syncChannelPlaylistsAll({
          channelId: ch.channelId,
          genreTags: ch.genreTags,
          maxPlaylists: 30,
          timeBudgetMs: remainingPlMs,
        }),
      ),
    );

    for (const item of settledPl) {
      if (item.status === 'fulfilled') {
        playlistsSyncedCount += item.value.playlistsCount;
        newVideosCount += item.value.newVideosCount;
      }
    }
  }

  // BƯỚC 2: Cập nhật view_count, like_count, comment_count & chấm nhãn hot_badge cho video chưa có lượt xem
  if (
    activeChannels.length > 0 &&
    Date.now() - startedAt < TOTAL_TIME_BUDGET_MS - 3500
  ) {
    const channelIds = activeChannels.map((c) => c.channelId);
    const missingRes = await admin
      .from('videos')
      .select('video_id, channel_id, published_at, view_count')
      .in('channel_id', channelIds)
      .eq('is_short', false)
      .or('view_count.is.null,view_count.eq.0')
      .order('published_at', { ascending: false })
      .limit(BACKFILL_LIMIT);

    if (!missingRes.error && Array.isArray(missingRes.data) && missingRes.data.length > 0) {
      const missingRows = missingRes.data;
      const missingIds = missingRows.map((r) => r.video_id);
      const ytDetails = await fetchVideoDetailsByIds(
        missingIds,
        missingRows[0].channel_id,
      );

      if (ytDetails.length > 0) {
        const nowMs = Date.now();
        const baselines = computeChannelHotnessBaselines(ytDetails, nowMs);

        const UPDATE_BATCH = 25;
        for (let i = 0; i < ytDetails.length; i += UPDATE_BATCH) {
          const slice = ytDetails.slice(i, i + UPDATE_BATCH);
          await Promise.all(
            slice.map(async (yt) => {
              const hot = computeVideoHotness(
                {
                  published_at: yt.published_at,
                  view_count: yt.view_count,
                  like_count: yt.like_count,
                  comment_count: yt.comment_count,
                },
                baselines.get(yt.channel_id),
                nowMs,
              );
              if (hot.hot_badge) hotTaggedCount += 1;

              const { error } = await admin
                .from('videos')
                .update({
                  published_at: yt.published_at,
                  view_count: yt.view_count,
                  like_count: yt.like_count,
                  comment_count: yt.comment_count,
                  hot_badge: hot.hot_badge,
                  hot_score: hot.hot_score,
                } as never)
                .eq('video_id', yt.video_id);

              if (!error) statsUpdatedCount += 1;
            }),
          );
        }
      }
    }
  }

  // BƯỚC 3: Quét bổ sung Phim Chiếu Rạp nếu đã quá 3 tiếng kể từ lần quét rạp gần nhất
  let cinemaDiscoverTriggered = false;
  const nowMs = Date.now();
  if (
    nowMs - lastAutoCinemaTriggerMs >= THREE_HOURS_MS &&
    nowMs - startedAt < TOTAL_TIME_BUDGET_MS - 3000
  ) {
    try {
      const origin = new URL(request.url).origin;
      const headers: Record<string, string> = {};
      if (process.env.CRON_SECRET?.trim()) {
        headers.Authorization = `Bearer ${process.env.CRON_SECRET.trim()}`;
      }
      const discoverRes = await fetch(
        `${origin}/api/cinema/discover?force=true`,
        {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(5500),
          cache: 'no-store',
        },
      );
      if (discoverRes.ok) {
        cinemaDiscoverTriggered = true;
        lastAutoCinemaTriggerMs = nowMs;
      }
    } catch {
      // Không làm gián đoạn chu kỳ cron chính nếu discover mất nhiều thời gian
    }
  }

  // BƯỚC 4: Ghi lại mốc thời gian đồng bộ gần nhất (`last_synced_at` & `last_auto_sync_at` nếu có) vào DB
  const syncedAt = new Date().toISOString();
  const nextScheduledSyncAt = new Date(Date.now() + THREE_HOURS_MS).toISOString();

  if (activeUserIds.length > 0) {
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        last_synced_at: syncedAt,
        last_auto_sync_at: syncedAt,
      } as never)
      .in('id', activeUserIds);

    if (profErr) {
      // Fallback nếu cột last_auto_sync_at chưa được tạo trên bảng profiles
      await admin
        .from('profiles')
        .update({ last_synced_at: syncedAt })
        .in('id', activeUserIds);
    }
  }

  return NextResponse.json({
    ok: true,
    syncedAt,
    nextScheduledSyncAt,
    intervalHours: 3,
    totalActiveChannels: activeChannels.length,
    channelsSyncedCount,
    playlistsSyncedCount,
    newVideosCount,
    statsUpdatedCount,
    hotTaggedCount,
    cinemaDiscoverTriggered,
    warnings: warnings.slice(0, 5),
    elapsedMs: Date.now() - startedAt,
  });
}

export async function GET(request: Request) {
  return handleAutoSync(request);
}

export async function POST(request: Request) {
  return handleAutoSync(request);
}
