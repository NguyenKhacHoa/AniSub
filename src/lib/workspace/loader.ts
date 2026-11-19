import { createAdminClient } from '@/lib/supabase/server';
import {
  PRIMARY_GENRE_OPTIONS,
  type ChannelWithSelection,
  type CinemaVideoItem,
  type PrimaryGenreTag,
} from '@/types/workspace';
import type { GenreTag, UserSeriesStatus } from '@/types/database';

const DB_FETCH_BATCH_SIZE = 1000;

export interface LoadedWorkspaceData {
  channels: ChannelWithSelection[];
  videos: CinemaVideoItem[];
  seriesStatuses: Record<string, UserSeriesStatus>;
  watchLaterIds: string[];
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
  created_at: string;
}

const VIDEO_SELECT_FULL =
  'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, is_theatrical_movie, theatrical_release_year, cinema_format, cinema_genres, created_at';
const VIDEO_SELECT_THEATRICAL =
  'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, is_theatrical_movie, theatrical_release_year, created_at';
const VIDEO_SELECT_BASIC =
  'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, created_at';

/**
 * Tải KHÔNG GIỚI HẠN toàn bộ kho Phim Chiếu Rạp đã xác minh (`is_theatrical_movie = true` hoặc `[CHIẾU RẠP]`)
 * theo từng lô 1.000 dòng (`.range(from, to)`), hoàn toàn độc lập với danh sách kênh Đã đăng ký.
 */
async function fetchGlobalTheatricalVideos(
  admin: ReturnType<typeof createAdminClient>,
): Promise<RawVideoRow[]> {
  const allRows: RawVideoRow[] = [];
  let from = 0;
  let selectTier: 'full' | 'theatrical' | 'basic' = 'full';

  while (true) {
    const to = from + DB_FETCH_BATCH_SIZE - 1;

    if (selectTier === 'full') {
      const res = await admin
        .from('videos')
        .select(VIDEO_SELECT_FULL)
        .or('is_theatrical_movie.eq.true,series_name.ilike.%[CHIẾU RẠP]%')
        .order('published_at', { ascending: false })
        .range(from, to);

      if (res.error) {
        selectTier = 'theatrical';
        continue;
      }
      const batch = (res.data ?? []) as RawVideoRow[];
      allRows.push(...batch);
      if (batch.length < DB_FETCH_BATCH_SIZE) break;
      from += DB_FETCH_BATCH_SIZE;
    } else if (selectTier === 'theatrical') {
      const res = await admin
        .from('videos')
        .select(VIDEO_SELECT_THEATRICAL)
        .or('is_theatrical_movie.eq.true,series_name.ilike.%[CHIẾU RẠP]%')
        .order('published_at', { ascending: false })
        .range(from, to);

      if (res.error) {
        selectTier = 'basic';
        continue;
      }
      const batch = (res.data ?? []) as RawVideoRow[];
      allRows.push(...batch);
      if (batch.length < DB_FETCH_BATCH_SIZE) break;
      from += DB_FETCH_BATCH_SIZE;
    } else {
      const res = await admin
        .from('videos')
        .select(VIDEO_SELECT_BASIC)
        .ilike('series_name', '%[CHIẾU RẠP]%')
        .order('published_at', { ascending: false })
        .range(from, to);

      if (res.error) break;
      const batch = (res.data ?? []) as RawVideoRow[];
      allRows.push(...batch);
      if (batch.length < DB_FETCH_BATCH_SIZE) break;
      from += DB_FETCH_BATCH_SIZE;
    }
  }

  return allRows;
}

/**
 * Truy vấn phân đoạn tự động phía server theo từng lô 1.000 dòng (`.range(from, to)`)
 * cho đến khi lấy trọn vẹn 100% toàn bộ video không phải Shorts của các kênh đang bật.
 */
async function fetchAllSelectedVideos(
  admin: ReturnType<typeof createAdminClient>,
  selectedChannelIds: string[],
): Promise<RawVideoRow[]> {
  if (selectedChannelIds.length === 0) return [];
  const allRows: RawVideoRow[] = [];
  let from = 0;
  let selectTier: 'full' | 'theatrical' | 'basic' = 'full';

  while (true) {
    const to = from + DB_FETCH_BATCH_SIZE - 1;
    const selectStr =
      selectTier === 'full'
        ? VIDEO_SELECT_FULL
        : selectTier === 'theatrical'
          ? VIDEO_SELECT_THEATRICAL
          : VIDEO_SELECT_BASIC;

    const res = await admin
      .from('videos')
      .select(selectStr)
      .in('channel_id', selectedChannelIds)
      .eq('is_short', false)
      .order('published_at', { ascending: false })
      .range(from, to);

    if (res.error) {
      if (selectTier === 'full') {
        selectTier = 'theatrical';
        continue;
      }
      if (selectTier === 'theatrical') {
        selectTier = 'basic';
        continue;
      }
      console.error('[WorkspaceLoader] Lỗi tải full catalog videos:', res.error);
      break;
    }

    const batch = (res.data ?? []) as unknown as RawVideoRow[];
    allRows.push(...batch);
    if (batch.length < DB_FETCH_BATCH_SIZE) break;
    from += DB_FETCH_BATCH_SIZE;
  }

  return allRows;
}

/**
 * Tải toàn bộ danh sách kênh (`user_channels` + `channels`) và 100% kho video thật
 * thuộc các kênh đang bật (`is_selected = true`) trong 1 lần tải duy nhất (Full-Catalog In-Memory Store).
 */
export async function loadWorkspaceDataForUser(
  userId: string,
): Promise<LoadedWorkspaceData> {
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

  const allChannelIds = userChannels.map((uc) => uc.channel_id);

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

  if (allChannelIds.length > 0) {
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

  // Tải 100% toàn bộ video kênh đã chọn, kho Phim Chiếu Rạp toàn cục, watch_progress, user_series_status và user_watch_later song song
  const [
    selectedVideos,
    globalTheatricalVideos,
    progressRes,
    seriesStatusRes,
    watchLaterRes,
  ] = await Promise.all([
    fetchAllSelectedVideos(admin, selectedChannelIds),
    fetchGlobalTheatricalVideos(admin),
    admin
      .from('watch_progress')
      .select('video_id, progress_seconds, is_completed, last_watched_at')
      .eq('user_id', userId),
    admin
      .from('user_series_status')
      .select('series_key, status')
      .eq('user_id', userId),
    admin
      .from('user_watch_later')
      .select('video_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  const seriesStatuses: Record<string, UserSeriesStatus> = {};
  if (!seriesStatusRes.error && Array.isArray(seriesStatusRes.data)) {
    for (const row of seriesStatusRes.data) {
      if (
        row.series_key &&
        (row.status === 'following' ||
          row.status === 'completed' ||
          row.status === 'hidden')
      ) {
        seriesStatuses[row.series_key] = row.status;
      }
    }
  }

  const watchLaterIds: string[] =
    !watchLaterRes.error && Array.isArray(watchLaterRes.data)
      ? watchLaterRes.data.map((r) => r.video_id)
      : [];

  // Hợp nhất không trùng lặp giữa video thuộc kênh đã chọn và kho Phim Chiếu Rạp đã xác minh
  const videoById = new Map<string, RawVideoRow>();
  for (const v of selectedVideos) {
    videoById.set(v.video_id, v);
  }
  for (const v of globalTheatricalVideos) {
    if (!videoById.has(v.video_id)) {
      videoById.set(v.video_id, v);
    }
  }
  const fetchedVideos = Array.from(videoById.values());

  if (fetchedVideos.length === 0) {
    return {
      channels: mergedChannels,
      videos: [],
      seriesStatuses,
      watchLaterIds,
      totalVideosCount: 0,
      hasMoreVideos: false,
      lastSyncedAt,
    };
  }

  // Bổ sung thông tin tên kênh cho các Phim Chiếu Rạp từ kênh người dùng chưa subscribe
  const missingChannelIds = Array.from(
    new Set(
      fetchedVideos
        .map((v) => v.channel_id)
        .filter((cid) => !channelMap.has(cid)),
    ),
  );
  if (missingChannelIds.length > 0) {
    const { data: extraChannels } = await admin
      .from('channels')
      .select('channel_id, title, thumbnail_url, custom_url, websub_status, websub_expires_at, updated_at')
      .in('channel_id', missingChannelIds);
    for (const ch of extraChannels ?? []) {
      channelMap.set(ch.channel_id, ch);
    }
  }

  const progressMap = new Map(
    (progressRes.data ?? []).map((p) => [p.video_id, p]),
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
      last_watched_at: progress?.last_watched_at ?? null,
    };
  });

  return {
    channels: mergedChannels,
    videos: mergedVideos,
    seriesStatuses,
    watchLaterIds,
    totalVideosCount: mergedVideos.length,
    hasMoreVideos: false,
    lastSyncedAt,
  };
}
