import { createAdminClient } from '@/lib/supabase/server';
import {
  fetchChannelPlaylists,
  fetchChannelVideosPage,
  fetchPlaylistTailVideos,
  fetchPlaylistVideosAll,
  type YouTubeFetchedVideo,
} from '@/lib/youtube/api';
import {
  classifyVideosMultimodalBatch,
  verifyTheatricalReleaseWithGoogleSearch,
  type MultimodalClassificationResult,
} from '@/lib/ai/classifier';
import {
  extractSeriesInfo,
  normalizeSeriesSlug,
  parseEpisodeInfo,
} from '@/lib/series-parser';
import type { Database, HotBadge } from '@/types/database';
import {
  VERIFIED_THEATRICAL_TAG,
  computeChannelHotnessBaselines,
  computeVideoHotness,
  isPotentialTheatricalCandidate,
  mapDefaultCategoryToGenre,
  type PrimaryGenreTag,
} from '@/types/workspace';

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
    const genre: PrimaryGenreTag =
      item.detectedGenre === 'Phim AI'
        ? 'Phim AI'
        : item.detectedGenre === 'HH2D'
          ? 'HH2D'
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
  playlistsSyncedCount?: number;
  nextPageToken: string | null;
  warning: string | null;
}

interface ExistingVideoMetaRow {
  video_id: string;
  detected_genre: string | null;
  is_manual_tag?: boolean;
  series_name: string | null;
  video_type: Database['public']['Tables']['videos']['Row']['video_type'];
  is_theatrical_movie?: boolean | null;
}

async function fetchExistingVideosMetaChunked(
  admin: ReturnType<typeof createAdminClient>,
  videoIds: string[],
): Promise<Map<string, ExistingVideoMetaRow>> {
  const existingMap = new Map<string, ExistingVideoMetaRow>();
  let supportsExtended = true;

  for (let i = 0; i < videoIds.length; i += DB_CHUNK_SIZE) {
    const chunk = videoIds.slice(i, i + DB_CHUNK_SIZE);
    if (supportsExtended) {
      const res = await admin
        .from('videos')
        .select(
          'video_id, detected_genre, is_manual_tag, series_name, video_type, is_theatrical_movie',
        )
        .in('video_id', chunk);

      if (!res.error) {
        for (const row of (res.data ?? []) as unknown as ExistingVideoMetaRow[]) {
          existingMap.set(row.video_id, row);
        }
        continue;
      }
      supportsExtended = false;
    }

    const fallback = await admin
      .from('videos')
      .select('video_id, detected_genre, series_name, video_type')
      .in('video_id', chunk);

    for (const row of (fallback.data ?? []) as unknown as ExistingVideoMetaRow[]) {
      existingMap.set(row.video_id, row);
    }
  }

  return existingMap;
}

function stripExtendedSyncColumns(item: VideoInsertRow): Record<string, unknown> {
  const copy = { ...item } as Record<string, unknown>;
  delete copy.youtube_playlist_id;
  delete copy.playlist_position;
  delete copy.view_count;
  delete copy.like_count;
  delete copy.comment_count;
  delete copy.hot_badge;
  delete copy.hot_score;
  delete copy.is_upcoming;
  delete copy.scheduled_start_at;
  return copy;
}

function extractMissingColumnName(errorMessage?: string | null): string | null {
  if (!errorMessage) return null;
  const match = errorMessage.match(
    /(?:Could not find the|column)\s+['"]([a-zA-Z0-9_]+)['"]/i,
  );
  return match?.[1] ?? null;
}

async function upsertVideosChunked(
  admin: ReturnType<typeof createAdminClient>,
  rows: VideoInsertRow[],
): Promise<{
  upsertedCount: number;
  droppedColumns: string[];
  errorMessage: string | null;
}> {
  if (rows.length === 0) {
    return { upsertedCount: 0, droppedColumns: [], errorMessage: null };
  }

  let upsertedCount = 0;
  const droppedColumns = new Set<string>();
  let lastErrorMessage: string | null = null;

  for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
    const rawChunk = rows.slice(i, i + DB_CHUNK_SIZE);
    let workingChunk: Array<Record<string, unknown>> = rawChunk.map((item) => {
      const copy = { ...item } as Record<string, unknown>;
      for (const col of droppedColumns) {
        delete copy[col];
      }
      return copy;
    });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { error } = await admin
        .from('videos')
        .upsert(workingChunk as never, { onConflict: 'video_id' });

      if (!error) {
        upsertedCount += workingChunk.length;
        break;
      }

      lastErrorMessage = error.message || String(error);
      const missingCol = extractMissingColumnName(error.message);

      if (missingCol && !droppedColumns.has(missingCol)) {
        console.warn(
          `[SyncChannelVideos] Cột "${missingCol}" chưa tồn tại trên bảng videos -> tự động bỏ qua cột này để lưu ${workingChunk.length} video.`,
        );
        droppedColumns.add(missingCol);
        workingChunk = workingChunk.map((item) => {
          const rest = { ...item };
          delete rest[missingCol];
          return rest;
        });
        continue;
      }

      if (attempt === 0) {
        console.warn(
          `[SyncChannelVideos] Lỗi upsert chunk (${error.message}), thử lược bỏ các cột mở rộng để vẫn lưu video...`,
        );
        workingChunk = workingChunk.map((item) => {
          const rest = stripExtendedSyncColumns(
            item as unknown as VideoInsertRow,
          );
          delete rest.is_manual_tag;
          return rest;
        });
        continue;
      }

      console.error(
        `[SyncChannelVideos] Upsert thất bại cho chunk ${workingChunk.length} video:`,
        error,
      );
      break;
    }
  }

  return {
    upsertedCount,
    droppedColumns: Array.from(droppedColumns),
    errorMessage: upsertedCount > 0 ? null : lastErrorMessage,
  };
}

/**
 * Tính chỉ số độ hot (`hot_badge`, `hot_score`) cho các video vừa kéo về,
 * đối chiếu với mặt bằng view thực tế của kênh trong DB + batch hiện tại.
 */
async function computeHotnessForFetchedBatch(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  fetchedVideos: YouTubeFetchedVideo[],
): Promise<Map<string, { hot_badge: HotBadge; hot_score: number }>> {
  const hotnessMap = new Map<
    string,
    { hot_badge: HotBadge; hot_score: number }
  >();
  if (fetchedVideos.length === 0) return hotnessMap;

  // Lấy thêm mẫu tối đa 200 video của kênh từ DB để trung bình kênh (avgViews & top15Velocity) chính xác hơn
  const samplePool: Array<{
    channel_id: string;
    published_at: string;
    view_count?: number | null;
  }> = fetchedVideos.map((v) => ({
    channel_id: v.channel_id,
    published_at: v.published_at,
    view_count: v.view_count,
  }));

  const dbSampleRes = await admin
    .from('videos')
    .select('channel_id, published_at, view_count')
    .eq('channel_id', channelId)
    .order('published_at', { ascending: false })
    .limit(200);

  if (!dbSampleRes.error && Array.isArray(dbSampleRes.data)) {
    for (const row of dbSampleRes.data) {
      if (typeof row.view_count === 'number' && row.view_count > 0) {
        samplePool.push({
          channel_id: row.channel_id,
          published_at: row.published_at,
          view_count: row.view_count,
        });
      }
    }
  }

  const nowMs = Date.now();
  const baselines = computeChannelHotnessBaselines(samplePool, nowMs);

  for (const v of fetchedVideos) {
    const baseline = baselines.get(v.channel_id);
    const computed = computeVideoHotness(
      {
        published_at: v.published_at,
        view_count: v.view_count,
        like_count: v.like_count,
        comment_count: v.comment_count,
      },
      baseline,
      nowMs,
    );
    hotnessMap.set(v.video_id, {
      hot_badge: computed.hot_badge,
      hot_score: computed.hot_score,
    });
  }

  return hotnessMap;
}

/**
 * Lưu và phân loại Series-Aware cho danh sách video vừa kéo từ YouTube:
 * - Luôn cập nhật `view_count`, `like_count`, `comment_count`, `hot_badge`, `hot_score` (cả video cũ lẫn video mới)
 *   và `youtube_playlist_id` / `playlist_position` / `series_name` nếu video thuộc Playlist chính thức của kênh.
 * - Tầng 1: Kênh khóa `default_category` hoặc 1 tag -> gán thẳng 100% (0 API call AI).
 * - Tầng 2: Kế thừa theo Series trong DB + quy tắc cứng + Gemini Vision (1 đại diện / 1 Series).
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
  const [existingMap, hotnessMap] = await Promise.all([
    fetchExistingVideosMetaChunked(admin, fetchedIds),
    computeHotnessForFetchedBatch(admin, channelId, fetchedVideos),
  ]);

  const brandNewVideos: YouTubeFetchedVideo[] = fetchedVideos.filter(
    (v) => !existingMap.has(v.video_id),
  );
  const existingVideos: YouTubeFetchedVideo[] = fetchedVideos.filter((v) =>
    existingMap.has(v.video_id),
  );

  // Tự động kế thừa `youtube_playlist_id` cho các tập mới kéo từ luồng `uploads`
  // nếu bộ phim đó đã có Playlist chính thức trong DB -> tập mới nổi ngay lên đầu bộ phim!
  const needsPlaylistInheritance = brandNewVideos.some(
    (v) => !v.youtube_playlist_id && !v.is_short && v.video_type !== 'trailer',
  );
  if (needsPlaylistInheritance) {
    const plRowsRes = await admin
      .from('videos')
      .select('title, series_name, youtube_playlist_id')
      .eq('channel_id', channelId)
      .not('youtube_playlist_id', 'is', null)
      .limit(1000);

    if (!plRowsRes.error && Array.isArray(plRowsRes.data) && plRowsRes.data.length > 0) {
      const playlistBySlug = new Map<
        string,
        { playlistId: string; playlistTitle: string | null }
      >();
      for (const row of plRowsRes.data as Array<{
        title: string;
        series_name: string | null;
        youtube_playlist_id: string | null;
      }>) {
        const pid = row.youtube_playlist_id?.trim();
        if (!pid) continue;
        if (row.series_name && !row.series_name.includes('[CHIẾU RẠP]')) {
          const plSlug = normalizeSeriesSlug(row.series_name);
          if (plSlug.length >= 2 && !playlistBySlug.has(plSlug)) {
            playlistBySlug.set(plSlug, {
              playlistId: pid,
              playlistTitle: row.series_name,
            });
          }
        }
        const extracted = extractSeriesInfo({
          videoId: pid,
          channelId,
          title: row.title,
          seriesName: row.series_name,
        });
        if (!extracted.isStandalone && !playlistBySlug.has(extracted.seriesSlug)) {
          playlistBySlug.set(extracted.seriesSlug, {
            playlistId: pid,
            playlistTitle: row.series_name ?? extracted.seriesTitle,
          });
        }
      }

      if (playlistBySlug.size > 0) {
        for (const v of brandNewVideos) {
          if (v.youtube_playlist_id || v.is_short || v.video_type === 'trailer') {
            continue;
          }
          const info = extractSeriesInfo({
            videoId: v.video_id,
            channelId: v.channel_id,
            title: v.title,
          });
          if (!info.isStandalone) {
            const matched = playlistBySlug.get(info.seriesSlug);
            if (matched) {
              v.youtube_playlist_id = matched.playlistId;
              if (!v.playlist_title && matched.playlistTitle) {
                v.playlist_title = matched.playlistTitle;
              }
              v.video_type = 'episode';
            }
          }
        }
      }
    }
  }

  // Luôn cập nhật thống kê lượt xem, độ hot & thông tin Playlist chính thức cho video đã có trong DB
  if (existingVideos.length > 0) {
    const refreshRows: VideoInsertRow[] = existingVideos.map((v) => {
      const old = existingMap.get(v.video_id)!;
      const hot = hotnessMap.get(v.video_id);
      const isFromPlaylist = Boolean(v.youtube_playlist_id);
      const safeGenre: PrimaryGenreTag =
        old.detected_genre === 'Phim AI'
          ? 'Phim AI'
          : old.detected_genre === 'HH2D'
            ? 'HH2D'
            : primaryGenre;

      return {
        video_id: v.video_id,
        channel_id: v.channel_id,
        title: v.title,
        thumbnail_url: v.thumbnail_url,
        published_at: v.published_at,
        duration_seconds: v.duration_seconds,
        is_short: v.is_short,
        video_type:
          isFromPlaylist && !v.is_short && v.video_type !== 'trailer'
            ? 'episode'
            : old.video_type,
        detected_genre: safeGenre,
        series_name:
          isFromPlaylist && v.playlist_title && !old.is_theatrical_movie
            ? v.playlist_title
            : old.series_name,
        view_count: v.view_count,
        like_count: v.like_count,
        comment_count: v.comment_count,
        hot_badge: hot?.hot_badge ?? null,
        hot_score: hot?.hot_score ?? 0,
        is_upcoming: v.is_upcoming === true,
        scheduled_start_at: v.scheduled_start_at ?? null,
        ...(isFromPlaylist
          ? {
              youtube_playlist_id: v.youtube_playlist_id,
              playlist_position: v.playlist_position ?? null,
            }
          : {}),
      };
    });

    await upsertVideosChunked(admin, refreshRows);
  }

  // Kiểm tra khóa kênh (Channel Master Lock) từ bảng `channels`
  const { data: channelRowWithCat } = await admin
    .from('channels')
    .select('title, default_category')
    .eq('channel_id', channelId)
    .maybeSingle();

  let channelTitle = channelRowWithCat?.title ?? undefined;
  const channelLockedGenre = mapDefaultCategoryToGenre(
    channelRowWithCat?.default_category,
  );

  if (!channelRowWithCat) {
    const { data: fallbackCh } = await admin
      .from('channels')
      .select('title')
      .eq('channel_id', channelId)
      .maybeSingle();
    channelTitle = fallbackCh?.title ?? undefined;
  }

  // Nếu kênh chỉ bật 1 tag hoặc đã khóa `default_category` khác AUTO -> gán thẳng 100% (0 API call phân loại)
  if (channelLockedGenre || genreTags.length === 1) {
    const fixedGenre = channelLockedGenre ?? primaryGenre;

    if (brandNewVideos.length > 0) {
      const verifiedMovieIds = new Set<string>();
      if (fixedGenre === 'HH2D' && process.env.GEMINI_API_KEY?.trim()) {
        for (const v of brandNewVideos) {
          if (v.is_short || v.video_type === 'trailer' || v.youtube_playlist_id) {
            continue;
          }
          const parsedEp = parseEpisodeInfo(v.title, null).episodeStart;
          if (
            isPotentialTheatricalCandidate({
              title: v.title,
              channel_title: channelTitle,
              detected_genre: fixedGenre,
              episode_number: parsedEp,
              video_type: v.video_type,
              is_short: v.is_short,
            })
          ) {
            const check = await verifyTheatricalReleaseWithGoogleSearch(
              {
                video_id: v.video_id,
                channel_id: v.channel_id,
                channel_title: channelTitle,
                title: v.title,
                description: v.description,
                thumbnail_url: v.thumbnail_url,
                duration_seconds: v.duration_seconds,
              },
              fixedGenre,
            );
            if (check.isTheatricalMovie) {
              verifiedMovieIds.add(v.video_id);
            }
          }
        }
      }

      const insertPayload: VideoInsertRow[] = brandNewVideos.map((v) => {
        const hot = hotnessMap.get(v.video_id);
        const isVerifiedTheatrical = verifiedMovieIds.has(v.video_id);
        const seriesInfo = isVerifiedTheatrical
          ? extractSeriesInfo({
              videoId: v.video_id,
              channelId: v.channel_id,
              title: v.title,
              channelTitle,
            })
          : null;

        const resolvedSeriesName = isVerifiedTheatrical && seriesInfo
          ? `${seriesInfo.seriesTitle} ${VERIFIED_THEATRICAL_TAG}`
          : (v.playlist_title ?? null);

        return {
          video_id: v.video_id,
          channel_id: v.channel_id,
          title: v.title,
          description: v.description,
          thumbnail_url: v.thumbnail_url,
          published_at: v.published_at,
          duration_seconds: v.duration_seconds,
          is_short: v.is_short,
          video_type:
            v.youtube_playlist_id && !v.is_short && v.video_type !== 'trailer'
              ? 'episode'
              : v.video_type,
          detected_genre: fixedGenre,
          series_name: resolvedSeriesName,
          episode_number: parseEpisodeInfo(v.title, null).episodeStart,
          youtube_playlist_id: v.youtube_playlist_id ?? null,
          playlist_position: v.playlist_position ?? null,
          view_count: v.view_count,
          like_count: v.like_count,
          comment_count: v.comment_count,
          hot_badge: hot?.hot_badge ?? null,
          hot_score: hot?.hot_score ?? 0,
          is_upcoming: v.is_upcoming === true,
          scheduled_start_at: v.scheduled_start_at ?? null,
        };
      });
      await upsertVideosChunked(admin, insertPayload);
    }

    if (genreTags.length === 1 && !channelLockedGenre) {
      const { error: updateErr } = await admin
        .from('videos')
        .update({ detected_genre: fixedGenre })
        .eq('channel_id', channelId)
        .eq('is_manual_tag', false);

      if (updateErr) {
        await admin
          .from('videos')
          .update({ detected_genre: fixedGenre })
          .eq('channel_id', channelId);
      }
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

  // Kênh bật >= 2 tag -> chỉ phân loại các video MỚI chưa có trong DB
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

  // Bước 1: Kế thừa tag theo Series từ các video đã có của cùng kênh (ưu tiên is_manual_tag = true)
  const existingSeriesGenreMap = new Map<
    string,
    { genre: PrimaryGenreTag; isManual: boolean; seriesName: string | null }
  >();

  const existingChannelVideos: Array<{
    video_id: string;
    title: string;
    series_name: string | null;
    detected_genre: string | null;
    is_manual_tag?: boolean;
  }> = [];

  // Vượt giới hạn 1.000 dòng PostgREST bằng vòng lặp `.range(from, from + 999)`
  let fromExisting = 0;
  let supportsManualCol = true;
  while (true) {
    if (supportsManualCol) {
      const withManualRes = await admin
        .from('videos')
        .select('video_id, title, series_name, detected_genre, is_manual_tag')
        .eq('channel_id', channelId)
        .eq('is_short', false)
        .range(fromExisting, fromExisting + 999);

      if (withManualRes.error) {
        supportsManualCol = false;
        continue;
      }
      const batch = withManualRes.data ?? [];
      existingChannelVideos.push(...batch);
      if (batch.length < 1000) break;
      fromExisting += 1000;
    } else {
      const fallbackRes = await admin
        .from('videos')
        .select('video_id, title, series_name, detected_genre')
        .eq('channel_id', channelId)
        .eq('is_short', false)
        .range(fromExisting, fromExisting + 999);
      const batch = fallbackRes.data ?? [];
      existingChannelVideos.push(...batch);
      if (batch.length < 1000) break;
      fromExisting += 1000;
    }
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
      seriesName: v.playlist_title ?? null,
    });
    const inherited = !info.isStandalone
      ? existingSeriesGenreMap.get(info.seriesKey)
      : undefined;

    if (inherited) {
      classificationMap.set(v.video_id, {
        detectedGenre: inherited.genre,
        seriesName: v.playlist_title || inherited.seriesName || info.seriesTitle,
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
          series_name: v.playlist_title ?? null,
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

  const insertPayload: VideoInsertRow[] = brandNewVideos.map((v) => {
    const cls = classificationMap.get(v.video_id);
    const hot = hotnessMap.get(v.video_id);
    const resolvedVideoType =
      v.youtube_playlist_id && !v.is_short && v.video_type !== 'trailer'
        ? 'episode'
        : cls?.isMovie && v.video_type !== 'trailer'
          ? 'full_movie'
          : v.video_type;

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
      series_name: v.playlist_title ?? cls?.seriesName ?? null,
      episode_number:
        cls?.episodeNumber ?? parseEpisodeInfo(v.title, null).episodeStart,
      youtube_playlist_id: v.youtube_playlist_id ?? null,
      playlist_position: v.playlist_position ?? null,
      view_count: v.view_count,
      like_count: v.like_count,
      comment_count: v.comment_count,
      hot_badge: hot?.hot_badge ?? null,
      hot_score: hot?.hot_score ?? 0,
      is_upcoming: v.is_upcoming === true,
      scheduled_start_at: v.scheduled_start_at ?? null,
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
 * Đồng bộ trực tiếp toàn bộ Danh sách phát (YouTube Playlists) chính thức của kênh:
 * - Gọi `playlists.list` lấy toàn bộ Playlist của kênh.
 * - Với mỗi Playlist, kéo 100% video bên trong (`playlistItems.list` + `videos.list?part=snippet,contentDetails,statistics`).
 * - Gắn chuẩn `youtube_playlist_id`, `playlist_position` và tên bộ phim gốc `playlist.snippet.title`
 *   làm Source of Truth cho tab Phim Bộ.
 */
export async function syncChannelPlaylistsAll(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  maxPlaylists?: number;
  timeBudgetMs?: number;
}): Promise<{
  playlistsCount: number;
  fetchedCount: number;
  newVideosCount: number;
  warning: string | null;
}> {
  const {
    channelId,
    genreTags,
    maxPlaylists = 200,
    timeBudgetMs = 22_000,
  } = options;

  const startedAt = Date.now();
  const playlists = await fetchChannelPlaylists(channelId);
  const nonEmptyPlaylists = playlists.filter((p) => p.item_count > 0);
  if (nonEmptyPlaylists.length === 0) {
    return {
      playlistsCount: 0,
      fetchedCount: 0,
      newVideosCount: 0,
      warning: null,
    };
  }

  // Sắp xếp để nếu 1 video xuất hiện ở nhiều playlist thì ưu tiên giữ Playlist riêng (nhỏ/chuyên biệt hơn playlist tổng hợp khổng lồ)
  const sortedPlaylists = [...nonEmptyPlaylists]
    .sort((a, b) => a.item_count - b.item_count)
    .slice(0, maxPlaylists);

  const videoMap = new Map<string, YouTubeFetchedVideo>();
  const CONCURRENCY = 6;

  for (let i = 0; i < sortedPlaylists.length; i += CONCURRENCY) {
    if (Date.now() - startedAt >= timeBudgetMs) break;
    const batch = sortedPlaylists.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((pl) =>
        fetchPlaylistVideosAll(channelId, pl.playlist_id, pl.title).catch(
          () => [] as YouTubeFetchedVideo[],
        ),
      ),
    );
    for (const videos of batchResults) {
      for (const v of videos) {
        if (!videoMap.has(v.video_id)) {
          videoMap.set(v.video_id, v);
        }
      }
    }
  }

  const allPlaylistVideos = Array.from(videoMap.values());
  if (allPlaylistVideos.length === 0) {
    return {
      playlistsCount: sortedPlaylists.length,
      fetchedCount: 0,
      newVideosCount: 0,
      warning: null,
    };
  }

  const persisted = await persistAndClassifyFetchedVideos({
    channelId,
    genreTags,
    fetchedVideos: allPlaylistVideos,
    nextPageToken: null,
    pagesFetched: sortedPlaylists.length,
  });

  return {
    playlistsCount: sortedPlaylists.length,
    fetchedCount: persisted.fetchedCount,
    newVideosCount: persisted.newVideosCount,
    warning: persisted.warning,
  };
}

/**
 * Phiên bản tối ưu tốc độ cho Cron 3 giờ: Kéo trang đầu & trang cuối (50 tập mới nhất ở cuối Playlist)
 * cho các YouTube Playlists của kênh để tập mới nằm ở trang cuối Playlist luôn được cập nhật kịp thời.
 */
export async function syncChannelPlaylistsTail(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  maxPlaylists?: number;
  timeBudgetMs?: number;
}): Promise<{
  playlistsCount: number;
  fetchedCount: number;
  newVideosCount: number;
  warning: string | null;
}> {
  const {
    channelId,
    genreTags,
    maxPlaylists = 40,
    timeBudgetMs = 8_000,
  } = options;

  const startedAt = Date.now();
  const playlists = await fetchChannelPlaylists(channelId, 4);
  const nonEmptyPlaylists = playlists.filter((p) => p.item_count > 0);
  if (nonEmptyPlaylists.length === 0) {
    return {
      playlistsCount: 0,
      fetchedCount: 0,
      newVideosCount: 0,
      warning: null,
    };
  }

  const targetPlaylists = nonEmptyPlaylists.slice(0, maxPlaylists);
  const videoMap = new Map<string, YouTubeFetchedVideo>();
  const CONCURRENCY = 6;

  for (let i = 0; i < targetPlaylists.length; i += CONCURRENCY) {
    if (Date.now() - startedAt >= timeBudgetMs) break;
    const batch = targetPlaylists.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((pl) =>
        fetchPlaylistTailVideos(channelId, pl.playlist_id, pl.title).catch(
          () => [] as YouTubeFetchedVideo[],
        ),
      ),
    );
    for (const videos of batchResults) {
      for (const v of videos) {
        if (!videoMap.has(v.video_id)) {
          videoMap.set(v.video_id, v);
        }
      }
    }
  }

  const tailVideos = Array.from(videoMap.values());
  if (tailVideos.length === 0) {
    return {
      playlistsCount: targetPlaylists.length,
      fetchedCount: 0,
      newVideosCount: 0,
      warning: null,
    };
  }

  const persisted = await persistAndClassifyFetchedVideos({
    channelId,
    genreTags,
    fetchedVideos: tailVideos,
    nextPageToken: null,
    pagesFetched: targetPlaylists.length,
  });

  return {
    playlistsCount: targetPlaylists.length,
    fetchedCount: persisted.fetchedCount,
    newVideosCount: persisted.newVideosCount,
    warning: persisted.warning,
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
 * Full Channel Fetch: Kéo Playlist chính thức của kênh + duyệt các trang `uploads` playlist
 * (50 video / 1 điểm quota) từ Tập mới nhất đến Tập 1.
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

  // 1. Kéo YouTube Playlists chính thức làm Source of Truth (an toàn trong time budget)
  let playlistFetched = 0;
  let playlistNew = 0;
  try {
    const plOutcome = await syncChannelPlaylistsAll({
      channelId,
      genreTags,
      maxPlaylists: 200,
      timeBudgetMs: 18_000,
    });
    playlistFetched = plOutcome.fetchedCount;
    playlistNew = plOutcome.newVideosCount;
  } catch (err) {
    console.warn(`[SyncAllChannelVideos] Lỗi nhẹ khi kéo playlists kênh ${channelId}:`, err);
  }

  // 2. Tiếp tục duyệt toàn bộ trang `uploads` playlist để không sót bất kỳ video lẻ hay thống kê nào
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

  const persisted = await persistAndClassifyFetchedVideos({
    channelId,
    genreTags,
    fetchedVideos: allFetchedVideos,
    nextPageToken: currentToken,
    pagesFetched,
  });

  return {
    ...persisted,
    fetchedCount: Math.max(persisted.fetchedCount, playlistFetched),
    newVideosCount: persisted.newVideosCount + playlistNew,
  };
}

export interface ChunkedChannelSyncResult extends SyncChannelVideosPageResult {
  phase: 'playlists' | 'uploads';
  processedCount: number;
  upsertedCount: number;
  totalPlaylists: number;
  nextPlaylistOffset: number;
  hasMore: boolean;
  isFullySynced: boolean;
}

/**
 * Cursor-Based Chunked Channel Sync (chống Vercel Timeout 100%, không bao giờ kẹt ở 0 video):
 * - Chế độ `mode: 'playlists'`: Kéo theo từng lô nhỏ `playlistBatchSize` (mặc định 6 Playlist/lượt, ~2–3 giây),
 *   lặp đủ 100% `nextPageToken` của từng Playlist để UPSERT toàn bộ tập gốc (`youtube_playlist_id`, `playlist_position`, `view_count`, `hot_badge`).
 * - Chế độ `mode: 'uploads'`: Kéo tối đa 3 trang `uploads` (~150 video/lượt, ~2 giây), KHÔNG dừng sớm khi gặp video trùng,
 *   chỉ kết thúc khi YouTube trả về `nextPageToken = undefined`, đồng thời làm mới `view_count`/`hot_badge`.
 */
export async function syncChannelVideosChunk(options: {
  channelId: string;
  genreTags: PrimaryGenreTag[];
  mode?: 'playlists' | 'uploads';
  playlistOffset?: number;
  playlistBatchSize?: number;
  pageToken?: string | null;
  resetCursor?: boolean;
  maxPages?: number;
}): Promise<ChunkedChannelSyncResult> {
  const {
    channelId,
    genreTags,
    mode = 'uploads',
    playlistOffset = 0,
    playlistBatchSize = 6,
    resetCursor = false,
    maxPages = 3,
  } = options;
  const admin = createAdminClient();

  // PHASE 1: Đồng bộ từng lô nhỏ YouTube Playlists (mỗi lượt ~2-3s, không bao giờ timeout Vercel)
  if (mode === 'playlists') {
    const safeOffset = Math.max(0, Math.floor(playlistOffset));
    const safeBatch = Math.min(12, Math.max(1, Math.floor(playlistBatchSize)));
    const allPlaylists = (await fetchChannelPlaylists(channelId))
      .filter((p) => p.item_count > 0)
      .sort((a, b) => a.item_count - b.item_count);

    const totalPlaylists = allPlaylists.length;
    const slice = allPlaylists.slice(safeOffset, safeOffset + safeBatch);
    const nextPlaylistOffset = safeOffset + slice.length;
    const hasMore = nextPlaylistOffset < totalPlaylists;

    if (slice.length === 0) {
      return {
        phase: 'playlists',
        fetchedCount: 0,
        processedCount: 0,
        upsertedCount: 0,
        newVideosCount: 0,
        aiClassifiedCount: 0,
        pagesFetched: 0,
        playlistsSyncedCount: 0,
        totalPlaylists,
        nextPlaylistOffset,
        nextPageToken: null,
        hasMore: false,
        isFullySynced: false,
        warning: null,
      };
    }

    const videoMap = new Map<string, YouTubeFetchedVideo>();
    const batchResults = await Promise.all(
      slice.map((pl) =>
        fetchPlaylistVideosAll(channelId, pl.playlist_id, pl.title).catch(
          (err) => {
            console.warn(
              `[ChunkSync:Playlists] Bỏ qua playlist lỗi ${pl.playlist_id}:`,
              err,
            );
            return [] as YouTubeFetchedVideo[];
          },
        ),
      ),
    );
    for (const list of batchResults) {
      for (const v of list) {
        if (!videoMap.has(v.video_id)) {
          videoMap.set(v.video_id, v);
        }
      }
    }

    const batchVideos = Array.from(videoMap.values());
    const persisted = await persistAndClassifyFetchedVideos({
      channelId,
      genreTags,
      fetchedVideos: batchVideos,
      nextPageToken: null,
      pagesFetched: slice.length,
    });

    return {
      ...persisted,
      phase: 'playlists',
      processedCount: batchVideos.length,
      upsertedCount: batchVideos.length,
      playlistsSyncedCount: slice.length,
      totalPlaylists,
      nextPlaylistOffset,
      hasMore,
      isFullySynced: false,
    };
  }

  // PHASE 2: Đồng bộ luồng uploads playlist theo cursor `pageToken` (KHÔNG dừng sớm khi gặp video trùng)
  const clampedMaxPages = Math.min(5, Math.max(1, maxPages));
  let startToken: string | null = options.pageToken ?? null;
  if (!startToken && !resetCursor) {
    const { data: chRow } = await admin
      .from('channels')
      .select('sync_page_token')
      .eq('channel_id', channelId)
      .maybeSingle();
    if (
      chRow &&
      typeof chRow.sync_page_token === 'string' &&
      chRow.sync_page_token.trim() &&
      !isChannelHistoryExhausted(chRow.sync_page_token)
    ) {
      startToken = chRow.sync_page_token.trim();
    }
  }

  const seenVideoIds = new Set<string>();
  const chunkVideos: YouTubeFetchedVideo[] = [];
  const seenTokens = new Set<string>();

  let currentToken: string | null = startToken;
  let pagesFetched = 0;

  while (pagesFetched < clampedMaxPages) {
    const page = await fetchChannelVideosPage(channelId, 50, currentToken);
    pagesFetched += 1;

    for (const v of page.videos) {
      if (!seenVideoIds.has(v.video_id)) {
        seenVideoIds.add(v.video_id);
        chunkVideos.push(v);
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

  const hasMore = Boolean(currentToken);
  const isFullySynced = !hasMore;

  // Cập nhật `sync_page_token`, `is_fully_synced` và `next_page_token` trên bảng `channels` (fallback an toàn nếu chưa chạy SQL)
  await saveChannelNextPageToken(channelId, currentToken);
  await admin
    .from('channels')
    .update({
      sync_page_token: currentToken,
      is_fully_synced: isFullySynced,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('channel_id', channelId);

  const persisted = await persistAndClassifyFetchedVideos({
    channelId,
    genreTags,
    fetchedVideos: chunkVideos,
    nextPageToken: currentToken,
    pagesFetched,
  });

  return {
    ...persisted,
    phase: 'uploads',
    processedCount: chunkVideos.length,
    upsertedCount: chunkVideos.length,
    playlistsSyncedCount: 0,
    totalPlaylists: 0,
    nextPlaylistOffset: 0,
    hasMore,
    isFullySynced,
  };
}
