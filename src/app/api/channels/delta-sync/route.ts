import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  syncChannelPlaylistsAll,
  syncChannelVideosPage,
} from '@/lib/youtube/channel-sync';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

export const maxDuration = 30;

const DELTA_SYNC_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 giờ
const DELTA_MAX_RESULTS = 10;
const CONCURRENCY_LIMIT = 3;

// Cache nhẹ theo userId trên server để chống spam gọi trùng khi chưa qua 60 phút
const lastDeltaSyncByUser = new Map<string, number>();

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

/**
 * POST /api/channels/delta-sync
 * Smart Delta Sync:
 * - Nếu force !== true và chưa đủ 60 phút từ lần quét trước -> bỏ qua ngay (0 quota).
 * - Nếu đủ 60 phút hoặc user chủ động bấm "Cập nhật tập mới" (force = true):
 *   gọi `playlistItems.list?maxResults=10` (1 điểm quota/kênh) cho các kênh đang bật,
 *   tự động insert & phân loại Series-Aware cho các tập mới phát hiện.
 */
export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { force?: boolean } = {};
  try {
    body = (await request.json()) as { force?: boolean };
  } catch {
    body = {};
  }

  const force = Boolean(body.force);
  const nowMs = Date.now();
  const lastRunMs = lastDeltaSyncByUser.get(auth.userId) ?? 0;

  if (!force && nowMs - lastRunMs < DELTA_SYNC_COOLDOWN_MS) {
    return NextResponse.json({
      skipped: true,
      newVideosCount: 0,
      syncedChannelsCount: 0,
      syncedAt: new Date(lastRunMs).toISOString(),
    });
  }

  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu YOUTUBE_API_KEY trong .env.local.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  let selectedChannels: Array<{
    channel_id: string;
    genre_tag: string;
    genre_tags?: string[] | null;
  }> = [];

  const withMultiRes = await admin
    .from('user_channels')
    .select('channel_id, genre_tag, genre_tags')
    .eq('user_id', auth.userId)
    .eq('is_selected', true);

  if (withMultiRes.error) {
    const fallbackRes = await admin
      .from('user_channels')
      .select('channel_id, genre_tag')
      .eq('user_id', auth.userId)
      .eq('is_selected', true);
    selectedChannels = fallbackRes.data ?? [];
  } else {
    selectedChannels = withMultiRes.data ?? [];
  }

  if (selectedChannels.length === 0) {
    return NextResponse.json({
      skipped: false,
      newVideosCount: 0,
      syncedChannelsCount: 0,
      syncedAt: new Date(nowMs).toISOString(),
    });
  }

  lastDeltaSyncByUser.set(auth.userId, nowMs);

  let totalNewVideos = 0;
  let totalPlaylistsSynced = 0;
  let syncedChannelsCount = 0;
  let lastWarning: string | null = null;
  const startedAt = Date.now();

  // Quét song song từng nhóm 3 kênh (maxResults = 10 -> 1 điểm quota/kênh)
  for (let i = 0; i < selectedChannels.length; i += CONCURRENCY_LIMIT) {
    const batch = selectedChannels.slice(i, i + CONCURRENCY_LIMIT);
    const settled = await Promise.allSettled(
      batch.map((ch) =>
        syncChannelVideosPage({
          channelId: ch.channel_id,
          genreTags: normalizeTags(ch.genre_tags, ch.genre_tag),
          maxResults: DELTA_MAX_RESULTS,
          skipSaveNextPageToken: true,
        }),
      ),
    );

    for (const item of settled) {
      if (item.status === 'fulfilled') {
        syncedChannelsCount += 1;
        totalNewVideos += item.value.newVideosCount;
        if (item.value.warning) {
          lastWarning = item.value.warning;
        }
      } else {
        console.error('[DeltaSync] Lỗi quét 1 kênh:', item.reason);
      }
    }
  }

  // Khi user chủ động bấm "Cập nhật tập mới" (force = true): đồng bộ thêm YouTube Playlists chính thức
  // để lấp đầy 100% các tập cũ bị thiếu trong bộ phim (trong giới hạn ngân sách thời gian an toàn)
  if (force) {
    const PLAYLIST_BUDGET_MS = 16_000;
    for (let i = 0; i < selectedChannels.length; i += 2) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= PLAYLIST_BUDGET_MS) break;
      const remainingMs = Math.max(2500, PLAYLIST_BUDGET_MS - elapsed);
      const batch = selectedChannels.slice(i, i + 2);
      const settledPl = await Promise.allSettled(
        batch.map((ch) =>
          syncChannelPlaylistsAll({
            channelId: ch.channel_id,
            genreTags: normalizeTags(ch.genre_tags, ch.genre_tag),
            maxPlaylists: 150,
            timeBudgetMs: remainingMs,
          }),
        ),
      );
      for (const item of settledPl) {
        if (item.status === 'fulfilled') {
          totalPlaylistsSynced += item.value.playlistsCount;
          totalNewVideos += item.value.newVideosCount;
          if (item.value.warning) {
            lastWarning = item.value.warning;
          }
        }
      }
    }
  }

  const syncedAt = new Date().toISOString();

  if (force || totalNewVideos > 0) {
    await admin
      .from('profiles')
      .update({ last_synced_at: syncedAt })
      .eq('id', auth.userId);
  }

  if (!force && totalNewVideos === 0) {
    return NextResponse.json({
      skipped: false,
      newVideosCount: 0,
      playlistsSyncedCount: totalPlaylistsSynced,
      syncedChannelsCount,
      warning: lastWarning,
      syncedAt,
    });
  }

  // Luôn tải lại full catalog khi user chủ động cập nhật (force) hoặc khi có tập mới
  const refreshed = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    skipped: false,
    newVideosCount: totalNewVideos,
    playlistsSyncedCount: totalPlaylistsSynced,
    syncedChannelsCount,
    warning: lastWarning,
    syncedAt,
    videos: refreshed.videos,
    channels: refreshed.channels,
  });
}
