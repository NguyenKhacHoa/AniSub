import { createAdminClient } from '@/lib/supabase/server';
import {
  PRIMARY_GENRE_OPTIONS,
  type ChannelWithSelection,
  type CinemaVideoItem,
  type PrimaryGenreTag,
} from '@/types/workspace';
import type { GenreTag } from '@/types/database';

export const DEFAULT_FEED_PAGE_SIZE = 120;

export interface LoadedWorkspaceData {
  channels: ChannelWithSelection[];
  videos: CinemaVideoItem[];
  totalVideosCount: number;
  hasMoreVideos: boolean;
  lastSyncedAt: string | null;
}

function normalizePrimaryTags(
  genreTags: string[] | null | undefined,
  fallbackSingle: string | null | undefined,
): PrimaryGenreTag[] {
  const validSet = new Set<PrimaryGenreTag>();
  for (const tag of genreTags ?? []) {
    if (PRIMARY_GENRE_OPTIONS.includes(tag as PrimaryGenreTag)) {
      validSet.add(tag as PrimaryGenreTag);
    }
  }
  if (validSet.size === 0 && fallbackSingle) {
    if (PRIMARY_GENRE_OPTIONS.includes(fallbackSingle as PrimaryGenreTag)) {
      validSet.add(fallbackSingle as PrimaryGenreTag);
    }
  }
  if (validSet.size === 0) {
    validSet.add('HH2D');
  }
  return Array.from(validSet);
}

/**
 * Tải danh sách kênh (`user_channels` + `channels`) và danh sách video thật có phân trang
 * (`offset`, `limit` mặc định 120 video/trang) cùng tổng số video thực tế trong kho (`totalVideosCount`).
 */
export async function loadWorkspaceDataForUser(
  userId: string,
  options?: { offset?: number; limit?: number },
): Promise<LoadedWorkspaceData> {
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.floor(options?.limit ?? DEFAULT_FEED_PAGE_SIZE)));

  const admin = createAdminClient();

  const profilePromise = admin
    .from('profiles')
    .select('last_synced_at')
    .eq('id', userId)
    .maybeSingle();

  let userChannels: Array<{
    id: string;
    channel_id: string;
    is_selected: boolean;
    genre_tag: string;
    genre_tags?: string[] | null;
  }> = [];

  const withMultiRes = await admin
    .from('user_channels')
    .select('id, channel_id, is_selected, genre_tag, genre_tags')
    .eq('user_id', userId);

  if (withMultiRes.error) {
    const fallbackRes = await admin
      .from('user_channels')
      .select('id, channel_id, is_selected, genre_tag')
      .eq('user_id', userId);
    userChannels = fallbackRes.data ?? [];
  } else {
    userChannels = withMultiRes.data ?? [];
  }

  const profileRes = await profilePromise;
  const lastSyncedAt = profileRes.data?.last_synced_at ?? null;

  if (userChannels.length === 0) {
    return {
      channels: [],
      videos: [],
      totalVideosCount: 0,
      hasMoreVideos: false,
      lastSyncedAt,
    };
  }

  const allChannelIds = userChannels.map((uc) => uc.channel_id);

  // Tương thích ngược nếu chưa chạy ALTER TABLE thêm cột next_page_token
  let channelRows: Array<{
    channel_id: string;
    title: string;
    thumbnail_url: string | null;
    custom_url: string | null;
    websub_status: ChannelWithSelection['websub_status'];
    websub_expires_at: string | null;
    next_page_token?: string | null;
    updated_at: string;
  }> = [];

  const channelsWithToken = await admin
    .from('channels')
    .select(
      'channel_id, title, thumbnail_url, custom_url, websub_status, websub_expires_at, next_page_token, updated_at',
    )
    .in('channel_id', allChannelIds);

  if (channelsWithToken.error) {
    const channelsFallback = await admin
      .from('channels')
      .select(
        'channel_id, title, thumbnail_url, custom_url, websub_status, websub_expires_at, updated_at',
      )
      .in('channel_id', allChannelIds);
    channelRows = channelsFallback.data ?? [];
  } else {
    channelRows = channelsWithToken.data ?? [];
  }

  const channelMap = new Map(channelRows.map((row) => [row.channel_id, row]));

  const mergedChannels: ChannelWithSelection[] = userChannels
    .map((uc) => {
      const ch = channelMap.get(uc.channel_id);
      if (!ch) return null;
      const tags = normalizePrimaryTags(uc.genre_tags, uc.genre_tag);
      return {
        ...ch,
        is_selected: uc.is_selected,
        genre_tag: (tags[0] ?? 'HH2D') as GenreTag,
        genre_tags: tags,
        user_channel_id: uc.id,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.title.localeCompare(b.title, 'vi'));

  const selectedChannelIds = mergedChannels
    .filter((c) => c.is_selected)
    .map((c) => c.channel_id);

  if (selectedChannelIds.length === 0) {
    return {
      channels: mergedChannels,
      videos: [],
      totalVideosCount: 0,
      hasMoreVideos: false,
      lastSyncedAt,
    };
  }

  // Truy vấn phân trang kèm tổng số lượng phim thực tế trong kho (count: 'exact')
  let fetchedVideos: Array<{
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
  }> = [];

  let totalVideosCount = 0;

  const videosWithManual = await admin
    .from('videos')
    .select(
      'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, created_at',
      { count: 'exact' },
    )
    .in('channel_id', selectedChannelIds)
    .eq('is_short', false)
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (videosWithManual.error) {
    const fallbackVideos = await admin
      .from('videos')
      .select(
        'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, created_at',
        { count: 'exact' },
      )
      .in('channel_id', selectedChannelIds)
      .eq('is_short', false)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);
    fetchedVideos = fallbackVideos.data ?? [];
    totalVideosCount = fallbackVideos.count ?? fetchedVideos.length;
  } else {
    fetchedVideos = videosWithManual.data ?? [];
    totalVideosCount = videosWithManual.count ?? fetchedVideos.length;
  }

  const hasMoreVideos = offset + fetchedVideos.length < totalVideosCount;

  if (fetchedVideos.length === 0) {
    return {
      channels: mergedChannels,
      videos: [],
      totalVideosCount,
      hasMoreVideos,
      lastSyncedAt,
    };
  }

  const videoIds = fetchedVideos.map((v) => v.video_id);
  const { data: progressRows } = await admin
    .from('watch_progress')
    .select('video_id, progress_seconds, is_completed')
    .eq('user_id', userId)
    .in('video_id', videoIds);

  const progressMap = new Map(
    (progressRows ?? []).map((p) => [p.video_id, p]),
  );

  const genreByChannel = new Map(
    mergedChannels.map((c) => [c.channel_id, c.genre_tags[0] ?? 'HH2D']),
  );

  const mergedVideos: CinemaVideoItem[] = fetchedVideos.map((v) => {
    const progress = progressMap.get(v.video_id);
    const channel = channelMap.get(v.channel_id);
    return {
      ...v,
      detected_genre:
        v.detected_genre === 'Phim AI' || v.detected_genre === 'HH2D'
          ? v.detected_genre
          : (genreByChannel.get(v.channel_id) ?? 'HH2D'),
      channel_title: channel?.title ?? v.channel_id,
      progress_seconds: progress?.progress_seconds ?? 0,
      is_completed: progress?.is_completed ?? false,
    };
  });

  return {
    channels: mergedChannels,
    videos: mergedVideos,
    totalVideosCount,
    hasMoreVideos,
    lastSyncedAt,
  };
}
