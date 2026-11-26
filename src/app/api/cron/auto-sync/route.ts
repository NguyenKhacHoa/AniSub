import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchVideoDetailsByIds } from '@/lib/youtube/api';
import {
  syncChannelPlaylistsTail,
  syncChannelVideosPage,
} from '@/lib/youtube/channel-sync';
import {
  PRIMARY_GENRE_OPTIONS,
  computeChannelHotnessBaselines,
  computeVideoHotness,
  type PrimaryGenreTag,
} from '@/types/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TOTAL_TIME_BUDGET_MS = 46_000;
const PLAYLIST_TIME_BUDGET_MS = 20_000;
const BACKFILL_LIMIT = 150;
const UPLOADS_MAX_RESULTS = 50; // Quét đủ 50 video mới nhất cho toàn bộ các kênh đang bật
const CONCURRENCY_LIMIT = 4;

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
  const urlSecret =
    new URL(request.url).searchParams.get('secret')?.trim() ?? '';
  const providedSecret = bearerToken || headerSecret || urlSecret;

  if (configuredSecret) {
    if (providedSecret && providedSecret === configuredSecret) {
      return { ok: true };
    }
    return { ok: false, reason: 'Invalid or missing CRON_SECRET Bearer token' };
  }

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

/**
 * Lấy toàn bộ kênh đang kích hoạt bằng Service Role (KHÔNG lọc theo auth.uid()):
 * - Hợp nhất từ `user_channels (is_selected = true)` VÀ `channels (is_subscribed = true)` nếu bảng channels có cột này.
 */
async function fetchAllActiveChannelsForCron(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{
  activeChannels: Array<{ channelId: string; genreTags: PrimaryGenreTag[] }>;
  activeUserIds: string[];
}> {
  const channelMap = new Map<string, PrimaryGenreTag[]>();
  const userIdsSet = new Set<string>();

  // 1. Nguồn chính: toàn bộ user_channels đang bật (`is_selected = true`) không lọc auth.uid()
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
    if (fallbackRes.error) {
      throw new Error(
        `Lỗi truy vấn user_channels: ${fallbackRes.error.message}`,
      );
    }
    rawUserChannels = fallbackRes.data ?? [];
  } else {
    rawUserChannels = withMultiRes.data ?? [];
  }

  for (const row of rawUserChannels) {
    userIdsSet.add(row.user_id);
    const tags = normalizeTags(row.genre_tags, row.genre_tag);
    const existing = channelMap.get(row.channel_id);
    if (!existing) {
      channelMap.set(row.channel_id, tags);
    } else {
      channelMap.set(
        row.channel_id,
        Array.from(new Set([...existing, ...tags])),
      );
    }
  }

  // 2. Bổ sung thêm các kênh có `channels.is_subscribed = true` (nếu DB có cột is_subscribed)
  const subChannelsRes = await admin
    .from('channels')
    .select('channel_id, default_category')
    .eq('is_subscribed', true);

  if (!subChannelsRes.error && Array.isArray(subChannelsRes.data)) {
    for (const ch of subChannelsRes.data) {
      if (!channelMap.has(ch.channel_id)) {
        const defaultTag: PrimaryGenreTag =
          ch.default_category === 'PHIM_AI' ? 'Phim AI' : 'HH2D';
        channelMap.set(ch.channel_id, [defaultTag]);
      }
    }
  }

  return {
    activeChannels: Array.from(channelMap.entries()).map(
      ([channelId, genreTags]) => ({ channelId, genreTags }),
    ),
    activeUserIds: Array.from(userIdsSet),
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
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const admin = createAdminClient();

  let activeChannels: Array<{
    channelId: string;
    genreTags: PrimaryGenreTag[];
  }> = [];
  let activeUserIds: string[] = [];

  try {
    const loaded = await fetchAllActiveChannelsForCron(admin);
    activeChannels = loaded.activeChannels;
    activeUserIds = loaded.activeUserIds;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Không thể đọc danh sách kênh.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }

  if (activeChannels.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Không tìm thấy kênh nào đang bật (user_channels.is_selected = true hoặc channels.is_subscribed = true).',
      },
      { status: 500 },
    );
  }

  let channelsSyncedCount = 0;
  let playlistsSyncedCount = 0;
  let newVideosCount = 0;
  let statsUpdatedCount = 0;
  let hotTaggedCount = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  // BƯỚC 1: Quét 50 video mới nhất (`uploads` playlist) cho TOÀN BỘ các kênh đang bật (không thoát sớm, không cooldown)
  for (let i = 0; i < activeChannels.length; i += CONCURRENCY_LIMIT) {
    const batch = activeChannels.slice(i, i + CONCURRENCY_LIMIT);
    const settled = await Promise.allSettled(
      batch.map((ch) =>
        syncChannelVideosPage({
          channelId: ch.channelId,
          genreTags: ch.genreTags,
          maxResults: UPLOADS_MAX_RESULTS,
          skipSaveNextPageToken: true,
        }),
      ),
    );

    settled.forEach((item, idx) => {
      const chId = batch[idx]?.channelId ?? 'unknown';
      if (item.status === 'fulfilled') {
        channelsSyncedCount += 1;
        newVideosCount += item.value.newVideosCount;
        if (item.value.warning) warnings.push(item.value.warning);
      } else {
        const msg =
          item.reason instanceof Error
            ? item.reason.message
            : String(item.reason);
        console.error(`[CronAutoSync] Lỗi quét uploads kênh ${chId}:`, msg);
        errors.push(`uploads(${chId}): ${msg}`);
      }
    });
  }

  // BƯỚC 2: Kéo trang đầu & trang cuối (50 tập mới nhất) của YouTube Playlists trên các kênh đang bật
  const playlistStart = Date.now();
  for (let i = 0; i < activeChannels.length; i += 3) {
    const plElapsed = Date.now() - playlistStart;
    const totalElapsed = Date.now() - startedAt;
    if (
      plElapsed >= PLAYLIST_TIME_BUDGET_MS ||
      totalElapsed >= TOTAL_TIME_BUDGET_MS - 8000
    ) {
      break;
    }

    const remainingPlMs = Math.max(
      2500,
      Math.min(
        PLAYLIST_TIME_BUDGET_MS - plElapsed,
        TOTAL_TIME_BUDGET_MS - 8000 - totalElapsed,
      ),
    );
    const batch = activeChannels.slice(i, i + 3);
    const settledPl = await Promise.allSettled(
      batch.map((ch) =>
        syncChannelPlaylistsTail({
          channelId: ch.channelId,
          genreTags: ch.genreTags,
          maxPlaylists: 40,
          timeBudgetMs: remainingPlMs,
        }),
      ),
    );

    settledPl.forEach((item, idx) => {
      const chId = batch[idx]?.channelId ?? 'unknown';
      if (item.status === 'fulfilled') {
        playlistsSyncedCount += item.value.playlistsCount;
        newVideosCount += item.value.newVideosCount;
      } else {
        const msg =
          item.reason instanceof Error
            ? item.reason.message
            : String(item.reason);
        console.error(`[CronAutoSync] Lỗi quét playlists kênh ${chId}:`, msg);
        errors.push(`playlists(${chId}): ${msg}`);
      }
    });
  }

  // BƯỚC 3: Cập nhật view_count, like_count, comment_count & chấm nhãn hot_badge cho video chưa có lượt xem
  if (Date.now() - startedAt < TOTAL_TIME_BUDGET_MS - 4000) {
    const channelIds = activeChannels.map((c) => c.channelId);
    const missingRes = await admin
      .from('videos')
      .select('video_id, channel_id, published_at, view_count')
      .in('channel_id', channelIds)
      .eq('is_short', false)
      .or('view_count.is.null,view_count.eq.0')
      .order('published_at', { ascending: false })
      .limit(BACKFILL_LIMIT);

    if (missingRes.error) {
      errors.push(`backfill_select: ${missingRes.error.message}`);
    } else if (Array.isArray(missingRes.data) && missingRes.data.length > 0) {
      try {
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
                    is_upcoming: yt.is_upcoming === true,
                    scheduled_start_at: yt.scheduled_start_at ?? null,
                  } as never)
                  .eq('video_id', yt.video_id);

                if (!error) statsUpdatedCount += 1;
              }),
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`backfill_yt: ${msg}`);
      }
    }
  }

  // BƯỚC 4: Quét bổ sung Phim Chiếu Rạp nếu đã quá 3 tiếng kể từ lần quét rạp gần nhất
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

  // BƯỚC 5: Ghi lại mốc thời gian đồng bộ gần nhất vào DB
  const syncedAt = new Date().toISOString();
  const nextScheduledSyncAt = new Date(
    Date.now() + THREE_HOURS_MS,
  ).toISOString();

  if (activeUserIds.length > 0 && channelsSyncedCount > 0) {
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        last_synced_at: syncedAt,
        last_auto_sync_at: syncedAt,
      } as never)
      .in('id', activeUserIds);

    if (profErr) {
      await admin
        .from('profiles')
        .update({ last_synced_at: syncedAt })
        .in('id', activeUserIds);
    }
  }

  // Nếu toàn bộ lượt quét kênh thất bại hoặc xảy ra lỗi nghiêm trọng từ YouTube/Supabase -> trả về HTTP 500 để GitHub Actions báo đỏ ngay
  const hasCriticalFailure =
    channelsSyncedCount === 0 ||
    (errors.length > 0 && channelsSyncedCount < activeChannels.length);

  const responsePayload = {
    ok: !hasCriticalFailure,
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
    errors: errors.slice(0, 10),
    elapsedMs: Date.now() - startedAt,
  };

  return NextResponse.json(responsePayload, {
    status: hasCriticalFailure ? 500 : 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export async function GET(request: Request) {
  return handleAutoSync(request);
}

export async function POST(request: Request) {
  return handleAutoSync(request);
}
