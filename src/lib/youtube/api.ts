import type { VideoType } from '@/types/database';

export interface YouTubeChannelItem {
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  custom_url: string | null;
}

export interface YouTubeFetchedVideo {
  video_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  tags: string[];
  thumbnail_url: string | null;
  vision_thumbnail_url: string | null;
  published_at: string;
  duration_seconds: number;
  is_short: boolean;
  video_type: VideoType;
  youtube_playlist_id?: string | null;
  playlist_position?: number | null;
  playlist_title?: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  is_upcoming?: boolean;
  scheduled_start_at?: string | null;
}

export interface YouTubePlaylistSummary {
  playlist_id: string;
  channel_id: string;
  title: string;
  item_count: number;
}

interface YouTubeSubscriptionsResponse {
  nextPageToken?: string;
  items?: Array<{
    snippet?: {
      title?: string;
      resourceId?: {
        channelId?: string;
      };
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

interface YouTubePlaylistItemsResponse {
  nextPageToken?: string;
  items?: Array<{
    contentDetails?: {
      videoId?: string;
    };
    snippet?: {
      title?: string;
      position?: number;
      resourceId?: {
        videoId?: string;
      };
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

interface YouTubePlaylistsResponse {
  nextPageToken?: string;
  items?: Array<{
    id?: string;
    snippet?: {
      channelId?: string;
      title?: string;
    };
    contentDetails?: {
      itemCount?: number;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

interface YouTubeVideosResponse {
  items?: Array<{
    id: string;
    snippet?: {
      channelId?: string;
      title?: string;
      description?: string;
      tags?: string[];
      publishedAt?: string;
      liveBroadcastContent?: string;
      thumbnails?: {
        maxres?: { url?: string };
        standard?: { url?: string };
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
    contentDetails?: {
      duration?: string;
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    liveStreamingDetails?: {
      scheduledStartTime?: string;
      actualStartTime?: string;
      actualEndTime?: string;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

export class YouTubeApiError extends Error {
  status: number;
  reason: string;

  constructor(message: string, status: number, reason = 'unknown') {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Chuyển đổi chuỗi thời lượng ISO 8601 từ YouTube (`PT1H23M45S`, `PT58S`) sang tổng số giây.
 */
export function parseIso8601Duration(isoDuration?: string): number {
  if (!isoDuration) return 0;
  const match = isoDuration.match(
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
  );
  if (!match) return 0;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * Phân loại sơ bộ Shorts và video_type từ tiêu đề, mô tả và thời lượng.
 */
export function classifyVideoHeuristic(
  title: string,
  description: string,
  durationSeconds: number,
): { is_short: boolean; video_type: VideoType } {
  const lowerTitle = title.toLowerCase();
  const lowerDesc = description.toLowerCase();

  const isShort =
    durationSeconds <= 65 ||
    /#shorts\b/i.test(lowerTitle) ||
    /#shorts\b/i.test(lowerDesc);

  const isTrailer =
    /\b(trailer|teaser|preview|ost)\b/i.test(lowerTitle) ||
    lowerTitle.includes('nhá hàng') ||
    lowerTitle.includes('nhạc phim') ||
    lowerTitle.includes('hậu trường');

  if (isTrailer) {
    return { is_short: isShort, video_type: 'trailer' };
  }

  const isFullMovie =
    durationSeconds >= 2400 ||
    /\b(full|all episodes)\b/i.test(lowerTitle) ||
    lowerTitle.includes('tổng hợp') ||
    lowerTitle.includes('trọn bộ');

  if (isFullMovie) {
    return { is_short: isShort, video_type: 'full_movie' };
  }

  return { is_short: isShort, video_type: 'episode' };
}

/**
 * Kéo toàn bộ danh sách kênh người dùng đã đăng ký qua YouTube Data API v3 (`subscriptions.list`).
 */
export async function fetchUserSubscriptions(
  providerToken: string,
): Promise<YouTubeChannelItem[]> {
  const channels: YouTubeChannelItem[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 20;

  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('mine', 'true');
    url.searchParams.set('maxResults', '50');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${providerToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const data = (await res.json().catch(() => ({}))) as YouTubeSubscriptionsResponse;

    if (!res.ok) {
      const reason = data.error?.errors?.[0]?.reason ?? 'api_error';
      const msg =
        data.error?.message || `YouTube API trả về mã lỗi HTTP ${res.status}`;
      throw new YouTubeApiError(msg, res.status, reason);
    }

    for (const item of data.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      const title = item.snippet?.title?.trim();
      if (!channelId || !title || seen.has(channelId)) continue;

      seen.add(channelId);
      const thumb =
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        null;

      channels.push({
        channel_id: channelId,
        title,
        thumbnail_url: thumb,
        custom_url: null,
      });
    }

    pageToken = data.nextPageToken;
    pageCount += 1;
  } while (pageToken && pageCount < MAX_PAGES);

  return channels;
}

export interface ChannelVideosPageResult {
  videos: YouTubeFetchedVideo[];
  nextPageToken: string | null;
}

/**
 * Lấy tối đa 50 video của một kênh YouTube thông qua Uploads Playlist (`UU...`)
 * hỗ trợ phân trang `pageToken` để kéo thêm video cũ (chỉ tốn 2 quota units / 50 video).
 */
export async function fetchChannelVideosPage(
  channelId: string,
  maxResults = 50,
  pageToken?: string | null,
): Promise<ChannelVideosPageResult> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new YouTubeApiError(
      'Thiếu biến môi trường YOUTUBE_API_KEY trên máy chủ.',
      500,
      'missing_api_key',
    );
  }

  const clampedMax = Math.min(50, Math.max(1, maxResults));

  // Đổi prefix UC -> UU để lấy trực tiếp Uploads Playlist của kênh (tiết kiệm quota)
  const uploadsPlaylistId = channelId.startsWith('UC')
    ? `UU${channelId.slice(2)}`
    : channelId;

  const playlistUrl = new URL(
    'https://www.googleapis.com/youtube/v3/playlistItems',
  );
  playlistUrl.searchParams.set('part', 'snippet,contentDetails');
  playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
  playlistUrl.searchParams.set('maxResults', String(clampedMax));
  if (pageToken) {
    playlistUrl.searchParams.set('pageToken', pageToken);
  }
  playlistUrl.searchParams.set('key', apiKey);

  const playlistRes = await fetch(playlistUrl.toString(), {
    cache: 'no-store',
  });
  const playlistData = (await playlistRes
    .json()
    .catch(() => ({}))) as YouTubePlaylistItemsResponse;

  if (!playlistRes.ok) {
    const reason = playlistData.error?.errors?.[0]?.reason ?? 'api_error';
    if (playlistRes.status === 404 || reason === 'playlistNotFound') {
      return { videos: [], nextPageToken: null };
    }
    const msg =
      playlistData.error?.message ||
      `Lỗi lấy playlist video (HTTP ${playlistRes.status})`;
    throw new YouTubeApiError(msg, playlistRes.status, reason);
  }

  const nextPageToken = playlistData.nextPageToken ?? null;

  const videoIds = (playlistData.items ?? [])
    .map(
      (item) =>
        item.contentDetails?.videoId || item.snippet?.resourceId?.videoId,
    )
    .filter((id): id is string => Boolean(id));

  if (videoIds.length === 0) {
    return { videos: [], nextPageToken };
  }

  const results = await fetchVideoDetailsByIds(
    videoIds.slice(0, 50),
    channelId,
    apiKey,
  );

  return { videos: results, nextPageToken };
}

/**
 * Helper dùng chung: Gọi `videos.list` (`part=snippet,contentDetails,statistics`) cho danh sách video ID
 * để lấy chính xác `published_at`, `duration_seconds`, `thumbnail_url` và `view_count`/`like_count`/`comment_count`.
 */
export async function fetchVideoDetailsByIds(
  videoIds: string[],
  fallbackChannelId: string,
  apiKeyInput?: string,
): Promise<YouTubeFetchedVideo[]> {
  const apiKey = apiKeyInput ?? process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey || videoIds.length === 0) return [];

  const results: YouTubeFetchedVideo[] = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batchIds = videoIds.slice(i, i + 50);
    const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videosUrl.searchParams.set(
      'part',
      'snippet,contentDetails,statistics,liveStreamingDetails',
    );
    videosUrl.searchParams.set('id', batchIds.join(','));
    videosUrl.searchParams.set('key', apiKey);

    const videosRes = await fetch(videosUrl.toString(), {
      cache: 'no-store',
    });
    const videosData = (await videosRes
      .json()
      .catch(() => ({}))) as YouTubeVideosResponse;

    if (!videosRes.ok) {
      const reason = videosData.error?.errors?.[0]?.reason ?? 'api_error';
      const msg =
        videosData.error?.message ||
        `Lỗi lấy chi tiết video (HTTP ${videosRes.status})`;
      throw new YouTubeApiError(msg, videosRes.status, reason);
    }

    for (const item of videosData.items ?? []) {
      const title = item.snippet?.title?.trim();
      if (
        !item.id ||
        !title ||
        title === 'Deleted video' ||
        title === 'Private video'
      ) {
        continue;
      }

      const description = item.snippet?.description?.trim() ?? '';
      const durationSeconds = parseIso8601Duration(
        item.contentDetails?.duration,
      );
      const { is_short, video_type } = classifyVideoHeuristic(
        title,
        description,
        durationSeconds,
      );

      // Ưu tiên lưu trực tiếp URL thumbnail thật chất lượng cao nhất từ YouTube API (standard -> high -> medium)
      const thumbnailUrl =
        item.snippet?.thumbnails?.standard?.url ||
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;

      const visionThumbnailUrl =
        item.snippet?.thumbnails?.high?.url ||
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;

      const viewCount = Number(item.statistics?.viewCount ?? 0);
      const likeCount = Number(item.statistics?.likeCount ?? 0);
      const commentCount = Number(item.statistics?.commentCount ?? 0);
      const isUpcoming = item.snippet?.liveBroadcastContent === 'upcoming';
      const scheduledStartAt = isUpcoming
        ? (item.liveStreamingDetails?.scheduledStartTime ?? null)
        : null;

      results.push({
        video_id: item.id,
        channel_id: item.snippet?.channelId || fallbackChannelId,
        title,
        description: description ? description.slice(0, 2000) : null,
        tags: Array.isArray(item.snippet?.tags) ? item.snippet.tags : [],
        thumbnail_url: thumbnailUrl,
        vision_thumbnail_url: visionThumbnailUrl,
        published_at: item.snippet?.publishedAt || new Date().toISOString(),
        duration_seconds: durationSeconds,
        is_short: isUpcoming ? false : is_short,
        video_type,
        view_count: Number.isFinite(viewCount) ? viewCount : 0,
        like_count: Number.isFinite(likeCount) ? likeCount : 0,
        comment_count: Number.isFinite(commentCount) ? commentCount : 0,
        is_upcoming: isUpcoming,
        scheduled_start_at: scheduledStartAt,
      });
    }
  }

  return results;
}

/**
 * Lấy toàn bộ Danh sách phát (Playlists) chính thức của một kênh qua `playlists.list`
 * (Source of Truth cho tên bộ phim và danh sách tập đầy đủ).
 */
export async function fetchChannelPlaylists(
  channelId: string,
  maxPages = 20,
): Promise<YouTubePlaylistSummary[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return [];

  const playlists: YouTubePlaylistSummary[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlists');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('maxResults', '50');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = (await res
      .json()
      .catch(() => ({}))) as YouTubePlaylistsResponse;

    if (!res.ok) {
      console.warn(
        `[YouTube API] playlists.list thất bại cho kênh ${channelId} (HTTP ${res.status}):`,
        data.error?.message,
      );
      break;
    }

    for (const item of data.items ?? []) {
      const pid = item.id?.trim();
      const title = item.snippet?.title?.trim();
      if (!pid || !title || seen.has(pid)) continue;
      seen.add(pid);

      playlists.push({
        playlist_id: pid,
        channel_id: item.snippet?.channelId || channelId,
        title,
        item_count: Number(item.contentDetails?.itemCount ?? 0) || 0,
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    pageCount += 1;
  }

  return playlists;
}

/**
 * Kéo 100% video nằm trong một Playlist cụ thể (`playlistItems.list` + `videos.list`),
 * gắn chuẩn `youtube_playlist_id`, `playlist_position`, `playlist_title` và `statistics` (`view_count`, `like_count`, `comment_count`).
 */
export async function fetchPlaylistVideosAll(
  channelId: string,
  playlistId: string,
  playlistTitle: string,
  maxPages = 50,
): Promise<YouTubeFetchedVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return [];

  const positionByVideoId = new Map<string, number>();
  const orderedIds: string[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = (await res
      .json()
      .catch(() => ({}))) as YouTubePlaylistItemsResponse;

    if (!res.ok) {
      break;
    }

    for (const item of data.items ?? []) {
      const rawTitle = item.snippet?.title?.trim();
      if (rawTitle === 'Deleted video' || rawTitle === 'Private video') {
        continue;
      }
      const vid =
        item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (!vid || positionByVideoId.has(vid)) continue;
      const pos =
        typeof item.snippet?.position === 'number'
          ? item.snippet.position
          : orderedIds.length;
      positionByVideoId.set(vid, pos);
      orderedIds.push(vid);
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    pageCount += 1;
  }

  if (orderedIds.length === 0) return [];

  const details = await fetchVideoDetailsByIds(orderedIds, channelId, apiKey);
  return details.map((v) => ({
    ...v,
    // Video nằm trong Playlist bộ phim luôn ưu tiên video_type = 'episode' (trừ Short hoặc Trailer)
    video_type:
      v.is_short || v.video_type === 'trailer' ? v.video_type : 'episode',
    youtube_playlist_id: playlistId,
    playlist_position: positionByVideoId.get(v.video_id) ?? null,
    playlist_title: playlistTitle,
  }));
}

/**
 * Phiên bản tốc độ cao cho Cron 3 giờ: Kéo trang đầu (50 mục) VÀ trang cuối cùng (50 mục mới nhất)
 * của một Playlist YouTube để không bao giờ bỏ sót tập mới nhất nằm ở cuối Playlist (khi Playlist > 50 tập).
 */
export async function fetchPlaylistTailVideos(
  channelId: string,
  playlistId: string,
  playlistTitle: string,
  maxWalkPages = 20,
): Promise<YouTubeFetchedVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) return [];

  let firstPageEntries: Array<{ vid: string; pos: number }> = [];
  let lastPageEntries: Array<{ vid: string; pos: number }> = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  while (pageCount < maxWalkPages) {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = (await res
      .json()
      .catch(() => ({}))) as YouTubePlaylistItemsResponse;

    if (!res.ok) {
      break;
    }

    const currentEntries: Array<{ vid: string; pos: number }> = [];
    for (const item of data.items ?? []) {
      const rawTitle = item.snippet?.title?.trim();
      if (rawTitle === 'Deleted video' || rawTitle === 'Private video') {
        continue;
      }
      const vid =
        item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (!vid) continue;
      const pos =
        typeof item.snippet?.position === 'number'
          ? item.snippet.position
          : pageCount * 50 + currentEntries.length;
      currentEntries.push({ vid, pos });
    }

    if (pageCount === 0) {
      firstPageEntries = currentEntries;
    }
    lastPageEntries = currentEntries;

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    pageCount += 1;
  }

  const positionByVideoId = new Map<string, number>();
  const targetIds: string[] = [];
  for (const entry of [...lastPageEntries, ...firstPageEntries]) {
    if (!positionByVideoId.has(entry.vid)) {
      positionByVideoId.set(entry.vid, entry.pos);
      targetIds.push(entry.vid);
    }
  }

  if (targetIds.length === 0) return [];

  const details = await fetchVideoDetailsByIds(targetIds, channelId, apiKey);
  return details.map((v) => ({
    ...v,
    video_type:
      v.is_short || v.video_type === 'trailer' ? v.video_type : 'episode',
    youtube_playlist_id: playlistId,
    playlist_position: positionByVideoId.get(v.video_id) ?? null,
    playlist_title: playlistTitle,
  }));
}

/**
 * Helper tương thích ngược lấy nhanh danh sách video mới nhất (mặc định 50 video).
 */
export async function fetchChannelLatestVideos(
  channelId: string,
  maxResults = 50,
): Promise<YouTubeFetchedVideo[]> {
  const page = await fetchChannelVideosPage(channelId, maxResults);
  return page.videos;
}
