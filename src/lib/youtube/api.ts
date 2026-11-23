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

interface YouTubeVideosResponse {
  items?: Array<{
    id: string;
    snippet?: {
      channelId?: string;
      title?: string;
      description?: string;
      tags?: string[];
      publishedAt?: string;
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

  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,contentDetails');
  videosUrl.searchParams.set('id', videoIds.slice(0, 50).join(','));
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

  const results: YouTubeFetchedVideo[] = [];

  for (const item of videosData.items ?? []) {
    const title = item.snippet?.title?.trim();
    if (!item.id || !title) continue;

    const description = item.snippet?.description?.trim() ?? '';
    const durationSeconds = parseIso8601Duration(item.contentDetails?.duration);
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

    results.push({
      video_id: item.id,
      channel_id: item.snippet?.channelId || channelId,
      title,
      description: description ? description.slice(0, 2000) : null,
      tags: Array.isArray(item.snippet?.tags) ? item.snippet.tags : [],
      thumbnail_url: thumbnailUrl,
      vision_thumbnail_url: visionThumbnailUrl,
      published_at: item.snippet?.publishedAt || new Date().toISOString(),
      duration_seconds: durationSeconds,
      is_short,
      video_type,
    });
  }

  return { videos: results, nextPageToken };
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
