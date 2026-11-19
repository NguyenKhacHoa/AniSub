import { createAdminClient } from '@/lib/supabase/server';
import {
  fetchChannelVideosPage,
  type YouTubeFetchedVideo,
} from '@/lib/youtube/api';
import {
  classifyVideosMultimodalBatch,
  type MultimodalClassificationResult,
} from '@/lib/ai/classifier';
import type { PrimaryGenreTag } from '@/types/workspace';

type ClassificationRecord = {
  detectedGenre: PrimaryGenreTag;
  seriesName: string | null;
  episodeNumber: number | null;
};

/**
 * Chuẩn hóa kết quả trả về từ classifyVideosMultimodalBatch một cách an toàn (null-safe):
 * hỗ trợ Map, Array, Plain Object hoặc undefined để không bao giờ gây TypeError 500.
 */
function normalizeClassificationMap(
  outcome: unknown,
  fallbackGenre: PrimaryGenreTag,
): Map<string, ClassificationRecord> {
  const map = new Map<string, ClassificationRecord>();
  if (!outcome || typeof outcome !== 'object') {
    return map;
  }

  const rawResults =
    'results' in outcome
      ? (outcome as { results?: unknown }).results
      : outcome;

  if (!rawResults) {
    return map;
  }

  const toRecord = (val: unknown): ClassificationRecord | null => {
    if (!val || typeof val !== 'object') return null;
    const item = val as Partial<MultimodalClassificationResult>;
    const genre =
      item.detectedGenre === 'Phim AI' || item.detectedGenre === 'HH2D'
        ? item.detectedGenre
        : fallbackGenre;
    return {
      detectedGenre: genre,
      seriesName: typeof item.seriesName === 'string' ? item.seriesName : null,
      episodeNumber:
        typeof item.episodeNumber === 'number' &&
        Number.isFinite(item.episodeNumber)
          ? Math.floor(item.episodeNumber)
          : null,
    };
  };

  if (rawResults instanceof Map) {
    for (const [key, val] of rawResults.entries()) {
      if (typeof key === 'string') {
        const rec = toRecord(val);
        if (rec) map.set(key, rec);
      }
    }
    return map;
  }

  if (Array.isArray(rawResults)) {
    for (const entry of rawResults) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as {
        videoId?: string;
        video_id?: string;
      };
      const vid = item.videoId ?? item.video_id;
      if (typeof vid === 'string' && vid) {
        const rec = toRecord(entry);
        if (rec) map.set(vid, rec);
      }
    }
    return map;
  }

  if (typeof rawResults === 'object') {
    for (const [key, val] of Object.entries(
      rawResults as Record<string, unknown>,
    )) {
      const rec = toRecord(val);
      if (rec) map.set(key, rec);
    }
  }

  return map;
}

// Hằng số đánh dấu kênh đã kéo hết toàn bộ lịch sử video trên YouTube
export const CHANNEL_HISTORY_END_TOKEN = '__END__' as const;

// Fallback lưu nextPageToken trong bộ nhớ server nếu chưa chạy SQL thêm cột next_page_token
const memoryNextPageTokens = new Map<string, string | null>();

export function isChannelHistoryExhausted(token: string | null | undefined): boolean {
  return token === CHANNEL_HISTORY_END_TOKEN;
}

export async function getChannelNextPageToken(
  channelId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('channels')
    .select('next_page_token')
    .eq('channel_id', channelId)
    .maybeSingle();

  if (!error && data && typeof data.next_page_token === 'string') {
    return data.next_page_token;
  }

  return memoryNextPageTokens.get(channelId) ?? null;
}

export async function saveChannelNextPageToken(
  channelId: string,
  token: string | null,
): Promise<void> {
  const storedValue = token ?? CHANNEL_HISTORY_END_TOKEN;
  memoryNextPageTokens.set(channelId, storedValue);
  const admin = createAdminClient();
  await admin
    .from('channels')
    .update({ next_page_token: storedValue })
    .eq('channel_id', channelId);
}

export interface SyncChannelVideosPageResult {
  fetchedCount: number;
  newVideosCount: number;
  aiClassifiedCount: number;
  nextPageToken: string | null;
  warning: string | null;
}

/**
 * Kéo 1 trang tối đa 50 video của kênh (hỗ trợ pageToken),
 * CHỈ chạy Gemini Vision cho các video CHƯA từng có trong DB để tiết kiệm tốc độ & quota.
 */
export async function syncChannelVideosPage(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  maxResults?: number;
  pageToken?: string | null;
}): Promise<SyncChannelVideosPageResult> {
  const { channelId, genreTags, maxResults = 50, pageToken } = options;
  const primaryGenre: PrimaryGenreTag = genreTags[0] ?? 'HH2D';

  if (isChannelHistoryExhausted(pageToken)) {
    return {
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      nextPageToken: null,
      warning: null,
    };
  }

  const page = await fetchChannelVideosPage(channelId, maxResults, pageToken);
  await saveChannelNextPageToken(channelId, page.nextPageToken);

  const fetchedVideos = page.videos;
  if (fetchedVideos.length === 0) {
    return {
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      nextPageToken: page.nextPageToken,
      warning: null,
    };
  }

  const admin = createAdminClient();
  const fetchedIds = fetchedVideos.map((v) => v.video_id);

  // Kiểm tra những video nào đã tồn tại trong public.videos để tránh chạy Gemini lặp lại
  const { data: existingRows } = await admin
    .from('videos')
    .select('video_id')
    .in('video_id', fetchedIds);

  const existingIds = new Set((existingRows ?? []).map((r) => r.video_id));
  const brandNewVideos: YouTubeFetchedVideo[] = fetchedVideos.filter(
    (v) => !existingIds.has(v.video_id),
  );

  // Nếu kênh chỉ bật 1 tag -> đồng bộ thẳng nhãn cho cả video mới lẫn video cũ chưa khóa thủ công
  if (genreTags.length === 1) {
    if (brandNewVideos.length > 0) {
      const insertPayload = brandNewVideos.map((v) => ({
        video_id: v.video_id,
        channel_id: v.channel_id,
        title: v.title,
        description: v.description,
        thumbnail_url: v.thumbnail_url,
        published_at: v.published_at,
        duration_seconds: v.duration_seconds,
        is_short: v.is_short,
        video_type: v.video_type,
        detected_genre: primaryGenre,
      }));

      const { error: insertErr } = await admin
        .from('videos')
        .upsert(insertPayload, { onConflict: 'video_id' });
      if (insertErr) {
        console.error('[SyncChannelVideos] Lỗi insert 1-tag:', insertErr);
      }
    }

    // Cập nhật đồng bộ nhãn cho video cũ của kênh (bỏ qua video đã khóa thủ công nếu có cột)
    const { error: updateErr } = await admin
      .from('videos')
      .update({ detected_genre: primaryGenre })
      .eq('channel_id', channelId)
      .eq('is_manual_tag', false);

    if (updateErr) {
      await admin
        .from('videos')
        .update({ detected_genre: primaryGenre })
        .eq('channel_id', channelId);
    }

    return {
      fetchedCount: fetchedVideos.length,
      newVideosCount: brandNewVideos.length,
      aiClassifiedCount: 0,
      nextPageToken: page.nextPageToken,
      warning: null,
    };
  }

  // Kênh bật 2 tag ('Phim AI', 'HH2D') -> CHỈ chạy Gemini Vision cho các video MỚI chưa có trong DB
  if (brandNewVideos.length === 0) {
    return {
      fetchedCount: fetchedVideos.length,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      nextPageToken: page.nextPageToken,
      warning: null,
    };
  }

  let warning: string | null = null;
  let aiClassifiedCount = 0;

  const nonShortNew = brandNewVideos.filter((v) => !v.is_short);
  let classificationMap = new Map<string, ClassificationRecord>();

  if (nonShortNew.length > 0 && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const outcome = await classifyVideosMultimodalBatch(
        nonShortNew.map((v) => ({
          video_id: v.video_id,
          title: v.title,
          description: v.description,
          tags: v.tags,
          thumbnail_url: v.thumbnail_url,
          vision_thumbnail_url: v.vision_thumbnail_url,
          duration_seconds: v.duration_seconds,
        })),
        genreTags,
      );

      classificationMap = normalizeClassificationMap(outcome, primaryGenre);
      aiClassifiedCount =
        typeof outcome?.geminiSuccessCount === 'number'
          ? outcome.geminiSuccessCount
          : classificationMap.size;

      if (
        typeof outcome?.geminiErrorCount === 'number' &&
        outcome.geminiErrorCount > 0 &&
        outcome.lastErrorMessage
      ) {
        warning = `Một số video mới gặp lỗi Gemini Vision: ${outcome.lastErrorMessage}`;
      }
    } catch (aiErr) {
      console.error(
        '[SyncChannelVideos] Lỗi khi gọi Gemini Vision (vẫn lưu video với nhãn mặc định):',
        aiErr,
      );
      warning =
        aiErr instanceof Error
          ? `Không thể phân loại Gemini Vision lúc này (${aiErr.message}). Video đã được lưu với nhãn mặc định ${primaryGenre}.`
          : `Không thể phân loại Gemini Vision lúc này. Video đã được lưu với nhãn mặc định ${primaryGenre}.`;
    }
  }

  const insertPayload = brandNewVideos.map((v) => {
    const cls = classificationMap.get(v.video_id);
    return {
      video_id: v.video_id,
      channel_id: v.channel_id,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnail_url,
      published_at: v.published_at,
      duration_seconds: v.duration_seconds,
      is_short: v.is_short,
      video_type: v.video_type,
      detected_genre: cls?.detectedGenre ?? primaryGenre,
      series_name: cls?.seriesName ?? null,
      episode_number: cls?.episodeNumber ?? null,
    };
  });

  const { error: upsertErr } = await admin
    .from('videos')
    .upsert(insertPayload, { onConflict: 'video_id' });
  if (upsertErr) {
    console.error('[SyncChannelVideos] Lỗi upsert multi-tag:', upsertErr);
  }

  return {
    fetchedCount: fetchedVideos.length,
    newVideosCount: brandNewVideos.length,
    aiClassifiedCount,
    nextPageToken: page.nextPageToken,
    warning,
  };
}
