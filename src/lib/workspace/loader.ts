import { createAdminClient } from '@/lib/supabase/server';
import {
  PRIMARY_GENRE_OPTIONS,
  computeChannelHotnessBaselines,
  computeVideoHotness,
  normalizeHotBadge,
  type ChannelWithSelection,
  type CinemaVideoItem,
  type PrimaryGenreTag,
} from '@/types/workspace';
import type { GenreTag, HotBadge, UserSeriesStatus } from '@/types/database';

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
  description?: string | null;
  thumbnail_url: string | null;
  published_at: string;
  duration_seconds: number;
  is_short: boolean;
  video_type: CinemaVideoItem['video_type'];
  detected_genre: CinemaVideoItem['detected_genre'];
  series_name: string | null;
  episode_number: number | null;
  ai_summary?: string | null;
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
  created_at: string;
}

// Chỉ SELECT các cột nhẹ cần thiết cho lưới thẻ phim ngoài màn hình chính
// (loại bỏ cột nặng như description, ai_summary, insight_data; chỉ tải chi tiết khi mở TheaterStage)
const DESIRED_VIDEO_COLUMNS = [
  'video_id',
  'channel_id',
  'title',
  'thumbnail_url',
  'published_at',
  'duration_seconds',
  'is_short',
  'video_type',
  'detected_genre',
  'series_name',
  'episode_number',
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
  'created_at',
] as const;

// Cache các cột chưa tồn tại trên DB thực tế để chỉ lược bỏ ĐÚNG cột thiếu (tuyệt đối không bỏ nhầm view_count / youtube_playlist_id / hot_badge)
const missingVideoColumnsCache = new Set<string>();

function extractMissingColumn(errorMessage?: string | null): string | null {
  if (!errorMessage) return null;
  const m1 = errorMessage.match(/column\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
  if (m1?.[1]) return m1[1];
  const m2 = errorMessage.match(/Could not find the\s+['"]([a-zA-Z0-9_]+)['"]\s+column/i);
  if (m2?.[1]) return m2[1];
  return null;
}

function buildAvailableVideoSelect(): string {
  return DESIRED_VIDEO_COLUMNS.filter(
    (col) => !missingVideoColumnsCache.has(col),
  ).join(', ');
}

/**
 * Tải KHÔNG GIỚI HẠN toàn bộ kho Phim Chiếu Rạp đã xác minh (`is_theatrical_movie = true` hoặc `[CHIẾU RẠP]`)
 * theo từng lô 1.000 dòng (`.range(from, to)`), hoàn toàn độc lập với danh sách kênh Đã đăng ký.
 */
async function fetchGlobalTheatricalVideos(
  admin: ReturnType<typeof createAdminClient>,
): Promise<RawVideoRow[]> {
  const allRows: RawVideoRow[] = [];
  let from = 0;

  while (true) {
    const to = from + DB_FETCH_BATCH_SIZE - 1;
    let batchData: RawVideoRow[] | null = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const selectStr = buildAvailableVideoSelect();
      const hasTheatricalCol = !missingVideoColumnsCache.has(
        'is_theatrical_movie',
      );

      const baseQuery = admin.from('videos').select(selectStr);
      const filteredQuery = hasTheatricalCol
        ? baseQuery.or(
            'is_theatrical_movie.eq.true,series_name.ilike.%[CHIẾU RẠP]%',
          )
        : baseQuery.ilike('series_name', '%[CHIẾU RẠP]%');

      const res = await filteredQuery
        .order('published_at', { ascending: false })
        .range(from, to);

      if (!res.error) {
        batchData = (res.data ?? []) as unknown as RawVideoRow[];
        break;
      }

      const missingCol = extractMissingColumn(res.error.message);
      if (missingCol && !missingVideoColumnsCache.has(missingCol)) {
        missingVideoColumnsCache.add(missingCol);
        continue;
      }
      break;
    }

    if (!batchData) break;
    allRows.push(...batchData);
    if (batchData.length < DB_FETCH_BATCH_SIZE) break;
    from += DB_FETCH_BATCH_SIZE;
  }

  return allRows;
}

/**
 * Truy vấn phân đoạn tự động phía server theo từng lô 1.000 dòng (`.range(from, from + 999)`)
 * cho đến khi lấy trọn vẹn 100% toàn bộ video không phải Shorts của các kênh đang bật (vượt giới hạn 1.000 dòng của PostgREST).
 * Khi truyền `initialLimit` (Giai đoạn 1 Fast Hydration), chỉ lấy đúng `initialLimit` video mới nhất (< 200ms First Paint).
 */
async function fetchAllSelectedVideos(
  admin: ReturnType<typeof createAdminClient>,
  selectedChannelIds: string[],
  initialLimit?: number,
): Promise<{ rows: RawVideoRow[]; hasMore: boolean }> {
  if (selectedChannelIds.length === 0) return { rows: [], hasMore: false };
  const allRows: RawVideoRow[] = [];
  let from = 0;

  if (typeof initialLimit === 'number' && initialLimit > 0) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const res = await admin
        .from('videos')
        .select(buildAvailableVideoSelect())
        .in('channel_id', selectedChannelIds)
        .eq('is_short', false)
        .order('published_at', { ascending: false })
        .range(0, initialLimit - 1);

      if (!res.error) {
        const batch = (res.data ?? []) as unknown as RawVideoRow[];
        return { rows: batch, hasMore: batch.length >= initialLimit };
      }

      const missingCol = extractMissingColumn(res.error.message);
      if (missingCol && !missingVideoColumnsCache.has(missingCol)) {
        missingVideoColumnsCache.add(missingCol);
        continue;
      }
      return { rows: [], hasMore: false };
    }
    return { rows: [], hasMore: false };
  }

  while (true) {
    const to = from + DB_FETCH_BATCH_SIZE - 1;
    let batchData: RawVideoRow[] | null = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const res = await admin
        .from('videos')
        .select(buildAvailableVideoSelect())
        .in('channel_id', selectedChannelIds)
        .eq('is_short', false)
        .order('published_at', { ascending: false })
        .range(from, to);

      if (!res.error) {
        batchData = (res.data ?? []) as unknown as RawVideoRow[];
        break;
      }

      const missingCol = extractMissingColumn(res.error.message);
      if (missingCol && !missingVideoColumnsCache.has(missingCol)) {
        missingVideoColumnsCache.add(missingCol);
        continue;
      }
      console.error('[WorkspaceLoader] Lỗi tải full catalog videos:', res.error);
      break;
    }

    if (!batchData) break;
    allRows.push(...batchData);
    if (batchData.length < DB_FETCH_BATCH_SIZE) break;
    from += DB_FETCH_BATCH_SIZE;
  }

  return { rows: allRows, hasMore: false };
}

/**
 * Tải danh sách kênh (`user_channels` + `channels`) và kho video thật thuộc các kênh đang bật.
 * Hỗ trợ Two-Stage Fast Hydration:
 * - Giai đoạn 1 (`options.initialLimit = 90`): tải nhanh 90 video mới nhất cho First Paint < 200ms.
 * - Giai đoạn 2 (không giới hạn): vòng lặp `.range(from, from + 999)` lấy 100% kho 6.000+ video.
 */
export async function loadWorkspaceDataForUser(
  userId: string,
  options?: { initialLimit?: number },
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
    default_category?: ChannelWithSelection['default_category'];
    websub_status: ChannelWithSelection['websub_status'];
    websub_expires_at: string | null;
    next_page_token?: string | null;
    updated_at: string;
  }> = [];

  if (allChannelIds.length > 0) {
    const channelsWithAll = await admin
      .from('channels')
      .select(
        'channel_id, title, thumbnail_url, custom_url, default_category, websub_status, websub_expires_at, next_page_token, updated_at',
      )
      .in('channel_id', allChannelIds);

    if (channelsWithAll.error) {
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
    } else {
      channelRows = channelsWithAll.data ?? [];
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

  // Two-Stage Fast Hydration:
  // - Khi truyền `options.initialLimit` (90): chỉ lấy 90 video mới nhất để First Paint < 200ms
  // - Khi không giới hạn (Giai đoạn 2 chạy ngầm): lấy 100% kho 6.000+ video qua vòng lặp `.range(from, from + 999)`
  const [
    selectedVideosResult,
    globalTheatricalVideos,
    progressRes,
    seriesStatusRes,
    watchLaterRes,
  ] = await Promise.all([
    fetchAllSelectedVideos(admin, selectedChannelIds, options?.initialLimit),
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

  const selectedVideos = selectedVideosResult.rows;
  const hasMoreVideos = selectedVideosResult.hasMore;

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

  const nowMs = Date.now();
  const hotBaselines = computeChannelHotnessBaselines(fetchedVideos, nowMs);

  const mergedVideos: CinemaVideoItem[] = fetchedVideos
    .filter((v) => v.is_unavailable !== true)
    .map((v) => {
      const progress = progressMap.get(v.video_id);
      const channel = channelMap.get(v.channel_id);
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
        description: v.description ?? null,
        ai_summary: v.ai_summary ?? null,
        youtube_playlist_id: v.youtube_playlist_id ?? null,
        playlist_position: v.playlist_position ?? null,
        view_count: v.view_count ?? 0,
        like_count: v.like_count ?? 0,
        comment_count: v.comment_count ?? 0,
        hot_badge: hasStoredHot
          ? storedBadge
          : (fallbackHot?.hot_badge ?? null),
        hot_score: hasStoredHot
          ? storedScore
          : (fallbackHot?.hot_score ?? 0),
        detected_genre:
          v.detected_genre === 'Phim AI'
            ? 'Phim AI'
            : v.detected_genre === 'HH2D' || String(v.detected_genre) === '2D'
              ? 'HH2D'
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
    hasMoreVideos,
    lastSyncedAt,
  };
}
