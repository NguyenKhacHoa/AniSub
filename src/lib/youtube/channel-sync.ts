import { createAdminClient } from '@/lib/supabase/server';
import {
  fetchChannelVideosPage,
  type YouTubeFetchedVideo,
} from '@/lib/youtube/api';
import {
  classifyVideosMultimodalBatch,
  type MultimodalClassificationResult,
} from '@/lib/ai/classifier';
import { extractSeriesInfo, parseEpisodeInfo } from '@/lib/series-parser';
import type { Database } from '@/types/database';
import type { PrimaryGenreTag } from '@/types/workspace';

type VideoInsertRow = Database['public']['Tables']['videos']['Insert'] & {
  is_manual_tag?: boolean;
};

const DB_CHUNK_SIZE = 200;
const FULL_SYNC_MAX_PAGES = 100; // Tối đa 5.000 video / kênh / lần đồng bộ

type ClassificationRecord = {
  detectedGenre: PrimaryGenreTag;
  seriesName: string | null;
  episodeNumber: number | null;
  isMovie?: boolean;
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
      isMovie: Boolean(item.isMovie),
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
export const CHANNEL_HISTORY_EXHAUSTED_TOKEN = '__EXHAUSTED__' as const;

const memoryNextPageTokens = new Map<string, string | null>();

export function isChannelHistoryExhausted(token?: string | null): boolean {
  return (
    token === CHANNEL_HISTORY_END_TOKEN ||
    token === CHANNEL_HISTORY_EXHAUSTED_TOKEN
  );
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
  pagesFetched?: number;
  nextPageToken: string | null;
  warning: string | null;
}

async function fetchExistingVideoIdsChunked(
  admin: ReturnType<typeof createAdminClient>,
  videoIds: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < videoIds.length; i += DB_CHUNK_SIZE) {
    const chunk = videoIds.slice(i, i + DB_CHUNK_SIZE);
    const { data } = await admin
      .from('videos')
      .select('video_id')
      .in('video_id', chunk);
    for (const row of data ?? []) {
      existing.add(row.video_id);
    }
  }
  return existing;
}

async function upsertVideosChunked(
  admin: ReturnType<typeof createAdminClient>,
  rows: VideoInsertRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + DB_CHUNK_SIZE);
    const { error } = await admin
      .from('videos')
      .upsert(chunk, { onConflict: 'video_id' });

    if (error) {
      // Fallback nếu DB chưa có cột is_manual_tag
      const fallbackChunk: Database['public']['Tables']['videos']['Insert'][] =
        chunk.map((item) => {
          const rest = { ...item };
          delete rest.is_manual_tag;
          return rest;
        });
      const { error: fallbackErr } = await admin
        .from('videos')
        .upsert(fallbackChunk, { onConflict: 'video_id' });
      if (fallbackErr) {
        console.error('[SyncChannelVideos] Lỗi upsert chunk:', fallbackErr);
      }
    }
  }
}

/**
 * Lưu và phân loại Series-Aware cho danh sách video vừa kéo từ YouTube:
 * - Kênh 1 tag -> gán thẳng 100% (0 API call).
 * - Kênh >= 2 tag -> kế thừa tag theo Series từ DB trước, chỉ gửi 1 video đại diện / 1 Series mới qua Gemini Vision.
 */
async function persistAndClassifyFetchedVideos(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  fetchedVideos: YouTubeFetchedVideo[];
  nextPageToken: string | null;
  pagesFetched: number;
}): Promise<SyncChannelVideosPageResult> {
  const { channelId, genreTags, fetchedVideos, nextPageToken, pagesFetched } =
    options;
  const primaryGenre: PrimaryGenreTag = genreTags[0] ?? 'HH2D';

  if (fetchedVideos.length === 0) {
    return {
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      pagesFetched,
      nextPageToken,
      warning: null,
    };
  }

  const admin = createAdminClient();
  const fetchedIds = fetchedVideos.map((v) => v.video_id);
  const existingIds = await fetchExistingVideoIdsChunked(admin, fetchedIds);
  const brandNewVideos: YouTubeFetchedVideo[] = fetchedVideos.filter(
    (v) => !existingIds.has(v.video_id),
  );

  // Kênh chỉ bật 1 tag -> gán thẳng 100% (0 API call)
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
      await upsertVideosChunked(admin, insertPayload);
    }

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
      pagesFetched,
      nextPageToken,
      warning: null,
    };
  }

  // Kênh bật >= 2 tag -> chỉ xử lý các video MỚI chưa có trong DB
  if (brandNewVideos.length === 0) {
    return {
      fetchedCount: fetchedVideos.length,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      pagesFetched,
      nextPageToken,
      warning: null,
    };
  }

  let warning: string | null = null;
  let aiClassifiedCount = 0;

  const nonShortNew = brandNewVideos.filter((v) => !v.is_short);
  const classificationMap = new Map<string, ClassificationRecord>();
  const inheritedManualIds = new Set<string>();

  const { data: channelRow } = await admin
    .from('channels')
    .select('title')
    .eq('channel_id', channelId)
    .maybeSingle();
  const channelTitle = channelRow?.title ?? undefined;

  // Bước 1: Kế thừa tag theo Series từ các video đã có của cùng kênh (ưu tiên is_manual_tag = true)
  const existingSeriesGenreMap = new Map<
    string,
    { genre: PrimaryGenreTag; isManual: boolean; seriesName: string | null }
  >();

  let existingChannelVideos: Array<{
    video_id: string;
    title: string;
    series_name: string | null;
    detected_genre: string | null;
    is_manual_tag?: boolean;
  }> = [];

  const withManualRes = await admin
    .from('videos')
    .select('video_id, title, series_name, detected_genre, is_manual_tag')
    .eq('channel_id', channelId)
    .eq('is_short', false)
    .limit(2500);

  if (withManualRes.error) {
    const fallbackRes = await admin
      .from('videos')
      .select('video_id, title, series_name, detected_genre')
      .eq('channel_id', channelId)
      .eq('is_short', false)
      .limit(2500);
    existingChannelVideos = fallbackRes.data ?? [];
  } else {
    existingChannelVideos = withManualRes.data ?? [];
  }

  for (const row of existingChannelVideos) {
    const genre =
      row.detected_genre === 'Phim AI' || row.detected_genre === 'HH2D'
        ? (row.detected_genre as PrimaryGenreTag)
        : null;
    if (!genre || !genreTags.includes(genre)) continue;

    const info = extractSeriesInfo({
      videoId: row.video_id,
      channelId,
      title: row.title,
      channelTitle,
      seriesName: row.series_name,
    });
    if (info.isStandalone) continue;

    const isManual = Boolean(row.is_manual_tag);
    const prev = existingSeriesGenreMap.get(info.seriesKey);
    if (!prev || (!prev.isManual && isManual)) {
      existingSeriesGenreMap.set(info.seriesKey, {
        genre,
        isManual,
        seriesName: row.series_name || info.seriesTitle,
      });
    }
  }

  const videosNeedingAi: YouTubeFetchedVideo[] = [];
  let inheritedCount = 0;

  for (const v of nonShortNew) {
    const info = extractSeriesInfo({
      videoId: v.video_id,
      channelId,
      title: v.title,
      channelTitle,
    });
    const inherited = !info.isStandalone
      ? existingSeriesGenreMap.get(info.seriesKey)
      : undefined;

    if (inherited) {
      classificationMap.set(v.video_id, {
        detectedGenre: inherited.genre,
        seriesName: inherited.seriesName || info.seriesTitle,
        episodeNumber: parseEpisodeInfo(v.title, null).episodeStart,
      });
      if (inherited.isManual) {
        inheritedManualIds.add(v.video_id);
      }
      inheritedCount += 1;
    } else {
      videosNeedingAi.push(v);
    }
  }

  if (inheritedCount > 0) {
    console.log(
      `[SyncChannelVideos] Kênh ${channelId}: kế thừa tag theo Series cho ${inheritedCount}/${nonShortNew.length} video (không tốn quota AI).`,
    );
  }

  // Bước 2: Gọi Gemini Vision 1 đại diện / 1 Series cho các bộ phim hoàn toàn mới
  if (videosNeedingAi.length > 0 && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const outcome = await classifyVideosMultimodalBatch(
        videosNeedingAi.map((v) => ({
          video_id: v.video_id,
          channel_id: v.channel_id,
          channel_title: channelTitle,
          title: v.title,
          description: v.description,
          tags: v.tags,
          thumbnail_url: v.thumbnail_url,
          vision_thumbnail_url: v.vision_thumbnail_url,
          duration_seconds: v.duration_seconds,
        })),
        genreTags,
      );

      const aiMap = normalizeClassificationMap(outcome, primaryGenre);
      for (const [vid, rec] of aiMap.entries()) {
        classificationMap.set(vid, rec);
      }

      aiClassifiedCount =
        typeof outcome?.geminiSuccessCount === 'number'
          ? outcome.geminiSuccessCount
          : aiMap.size;

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
    const resolvedVideoType =
      cls?.isMovie && v.video_type !== 'trailer' ? 'full_movie' : v.video_type;
    return {
      video_id: v.video_id,
      channel_id: v.channel_id,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnail_url,
      published_at: v.published_at,
      duration_seconds: v.duration_seconds,
      is_short: v.is_short,
      video_type: resolvedVideoType,
      detected_genre: cls?.detectedGenre ?? primaryGenre,
      series_name: cls?.seriesName ?? null,
      episode_number: cls?.episodeNumber ?? null,
      ...(inheritedManualIds.has(v.video_id) ? { is_manual_tag: true } : {}),
    };
  });

  await upsertVideosChunked(admin, insertPayload);

  return {
    fetchedCount: fetchedVideos.length,
    newVideosCount: brandNewVideos.length,
    aiClassifiedCount,
    pagesFetched,
    nextPageToken,
    warning,
  };
}

/**
 * Kéo 1 trang tối đa 50 video của kênh (hỗ trợ pageToken).
 */
export async function syncChannelVideosPage(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  maxResults?: number;
  pageToken?: string | null;
  skipSaveNextPageToken?: boolean;
}): Promise<SyncChannelVideosPageResult> {
  const {
    channelId,
    genreTags,
    maxResults = 50,
    pageToken,
    skipSaveNextPageToken = false,
  } = options;

  if (isChannelHistoryExhausted(pageToken)) {
    return {
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      pagesFetched: 0,
      nextPageToken: null,
      warning: null,
    };
  }

  const page = await fetchChannelVideosPage(channelId, maxResults, pageToken);
  if (!skipSaveNextPageToken) {
    await saveChannelNextPageToken(channelId, page.nextPageToken);
  }

  return persistAndClassifyFetchedVideos({
    channelId,
    genreTags,
    fetchedVideos: page.videos,
    nextPageToken: page.nextPageToken,
    pagesFetched: 1,
  });
}

/**
 * Full Channel Fetch: Duyệt sạch 100% các trang `nextPageToken` của YouTube `playlistItems.list`
 * (50 video / 1 điểm quota) từ Tập mới nhất đến Tập 1 trong 1 lần chạy duy nhất,
 * sau đó gom nhóm theo Series (1 đại diện / 1 bộ phim) để phân loại bằng Gemini Vision.
 */
export async function syncAllChannelVideos(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  startPageToken?: string | null;
  maxPages?: number;
}): Promise<SyncChannelVideosPageResult> {
  const {
    channelId,
    genreTags,
    startPageToken = null,
    maxPages = FULL_SYNC_MAX_PAGES,
  } = options;

  if (isChannelHistoryExhausted(startPageToken)) {
    return {
      fetchedCount: 0,
      newVideosCount: 0,
      aiClassifiedCount: 0,
      pagesFetched: 0,
      nextPageToken: null,
      warning: null,
    };
  }

  const seenVideoIds = new Set<string>();
  const allFetchedVideos: YouTubeFetchedVideo[] = [];
  const seenTokens = new Set<string>();

  let currentToken: string | null = startPageToken;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const page = await fetchChannelVideosPage(channelId, 50, currentToken);
    pagesFetched += 1;

    for (const v of page.videos) {
      if (!seenVideoIds.has(v.video_id)) {
        seenVideoIds.add(v.video_id);
        allFetchedVideos.push(v);
      }
    }

    const nextTok = page.nextPageToken;
    if (!nextTok || seenTokens.has(nextTok)) {
      currentToken = null;
      break;
    }

    seenTokens.add(nextTok);
    currentToken = nextTok;
  }

  await saveChannelNextPageToken(channelId, currentToken);

  console.log(
    `[SyncAllChannelVideos] Kênh ${channelId}: đã duyệt ${pagesFetched} trang YouTube -> thu thập trọn vẹn ${allFetchedVideos.length} video.`,
  );

  return persistAndClassifyFetchedVideos({
    channelId,
    genreTags,
    fetchedVideos: allFetchedVideos,
    nextPageToken: currentToken,
    pagesFetched,
  });
}
