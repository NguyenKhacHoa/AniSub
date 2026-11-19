import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { callGeminiWithFallback } from '@/lib/gemini/client';
import { parseIso8601Duration } from '@/lib/youtube/api';
import type { CinemaFormat } from '@/types/database';
import {
  CINEMA_HORROR_PREFILTER_RE,
  SAFE_CINEMA_GENRES,
  THEATRICAL_HARD_EXCLUSION_RE,
  THEATRICAL_MAX_DURATION_SECONDS,
  THEATRICAL_MIN_DURATION_SECONDS,
  VERIFIED_THEATRICAL_TAG,
  isTheatricalMovieVideo,
  resolveCinemaFormat,
  type CinemaVideoItem,
} from '@/types/workspace';

export const maxDuration = 30;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const DB_BATCH_SIZE = 1000;
const MAX_CANDIDATES_PER_BATCH = 18;

/**
 * Bộ từ khóa mở rộng bao quát cả Anime/Hoạt hình chiếu rạp lẫn Phim điện ảnh người đóng (Live-Action)
 */
const CINEMA_DISCOVER_QUERIES = [
  'anime movie vietsub',
  'phim hoạt hình chiếu rạp vietsub',
  'phim điện ảnh chiếu rạp vietsub',
  'bản điện ảnh full vietsub',
  'phim lẻ chiếu rạp vietsub',
] as const;

const YOUTUBE_SEARCH_ORDERS = ['relevance', 'date', 'viewCount'] as const;

// Trạng thái phân trang tích lũy trên server (kết hợp nhận thêm từ client để bền vững trên serverless)
let lastGlobalDiscoverAtMs = 0;
let serverDiscoveryRound = 0;
let serverPageTokens: Record<string, string> = {};

interface CandidateMovieItem {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  durationSeconds: number;
  isExistingBackfill?: boolean;
}

interface GroundedMovieVerification {
  videoId: string;
  isTheatricalMovie: boolean;
  isHorrorOrGore: boolean;
  canonicalTitle: string | null;
  releaseYear: number | null;
  cinemaFormat: CinemaFormat;
  cinemaGenres: string[];
}

function normalizeCinemaFormat(
  raw: unknown,
  candidate?: CandidateMovieItem,
): CinemaFormat {
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    if (
      lower.includes('người đóng') ||
      lower.includes('nguoi dong') ||
      lower.includes('live-action') ||
      lower.includes('live action')
    ) {
      return 'Phim Người Đóng';
    }
    if (
      lower.includes('anime') ||
      lower.includes('hoạt hình') ||
      lower.includes('hoat hinh') ||
      lower.includes('animation')
    ) {
      return 'Anime / Hoạt hình';
    }
  }
  if (candidate) {
    return resolveCinemaFormat({
      title: candidate.title,
      description: candidate.description,
      channel_title: candidate.channelTitle,
    });
  }
  return 'Anime / Hoạt hình';
}

function normalizeSafeCinemaGenres(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const validSet = new Set<string>();
  const safeLowerMap = new Map<string, string>(
    SAFE_CINEMA_GENRES.map((g) => [g.toLowerCase(), g]),
  );

  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    // Tuyệt đối loại bỏ mọi tag kinh dị nếu lỡ lọt
    if (CINEMA_HORROR_PREFILTER_RE.test(lower)) continue;

    const exact = safeLowerMap.get(lower);
    if (exact) {
      validSet.add(exact);
      continue;
    }

    for (const [k, canonical] of safeLowerMap.entries()) {
      if (lower.includes(k) || k.includes(lower)) {
        validSet.add(canonical);
        break;
      }
    }
  }

  return Array.from(validSet).slice(0, 3);
}

/**
 * Lớp 1 (Pre-filter):
 * - Thời lượng chuẩn rạp: 65 phút (3900s) -> 165 phút (9900s)
 * - Loại bỏ từ khóa rác: tóm tắt, review, tổng hợp, tập 1, trọn bộ, full bộ, phim AI
 * - Bộ luật Chặn Kinh Dị Lớp 1 (CHỈ ÁP DỤNG RIÊNG CHO PHIM CHIẾU RẠP):
 *   loại bỏ kinh dị, horror, ma ám, quỷ ám, trừ tà, exorcist, ác quỷ, xác sống, zombie,
 *   ma cà rồng, slasher, giết người hàng loạt, máu me, gore, creepy, rùng rợn, ma quái, linh dị, cương thi.
 */
function passesCinemaLayer1PreFilter(candidate: CandidateMovieItem): boolean {
  if (
    candidate.durationSeconds < THEATRICAL_MIN_DURATION_SECONDS ||
    candidate.durationSeconds > THEATRICAL_MAX_DURATION_SECONDS
  ) {
    return false;
  }

  if (THEATRICAL_HARD_EXCLUSION_RE.test(candidate.title)) {
    return false;
  }

  if (
    CINEMA_HORROR_PREFILTER_RE.test(candidate.title) ||
    CINEMA_HORROR_PREFILTER_RE.test(candidate.description)
  ) {
    return false;
  }

  return true;
}

/**
 * Lớp 2: Xác minh thực tế qua Gemini + Google Search Grounding (`tools: [{ googleSearch: {} }]` trên `v1beta`)
 * - Đón nhận cả Anime/Hoạt hình chiếu rạp lẫn Phim điện ảnh người đóng (Live-Action)
 * - Chặn tuyệt đối Kinh dị / Máu me (`isHorrorOrGore === false`)
 * - Trả về đầy đủ `cinemaFormat` (`Anime / Hoạt hình` | `Phim Người Đóng`) và `cinemaGenres` an toàn
 */
async function verifyCandidatesWithGoogleSearchGrounding(
  candidates: CandidateMovieItem[],
): Promise<Map<string, GroundedMovieVerification>> {
  const verifiedMap = new Map<string, GroundedMovieVerification>();
  if (candidates.length === 0 || !process.env.GEMINI_API_KEY?.trim()) {
    return verifiedMap;
  }

  const batch = candidates.slice(0, MAX_CANDIDATES_PER_BATCH);
  const candidateById = new Map(batch.map((c) => [c.videoId, c]));

  const candidatesBlock = batch
    .map(
      (c, idx) =>
        `${idx + 1}. videoId: "${c.videoId}"
   - Tiêu đề: "${c.title}"
   - Kênh: "${c.channelTitle}"
   - Thời lượng: ${Math.round(c.durationSeconds / 60)} phút
   - Mô tả ngắn: "${c.description.slice(0, 200).replace(/\s+/g, ' ')}"`,
    )
    .join('\n\n');

  const prompt = `Bạn là hệ thống kiểm duyệt & phân loại Phim Chiếu Rạp của AniSub. Hãy sử dụng công cụ Google Search để tra cứu thông tin phát hành thực tế cho từng video ứng viên dưới đây:

${candidatesBlock}

YÊU CẦU KIỂM DUYỆT & PHÂN LOẠI NGHIÊM NGẶT CHO TỪNG VIDEO:
1. "isTheatricalMovie": Tra cứu Google xem tác phẩm này có phải là một bộ **Phim Điện Ảnh Chiếu Rạp (bao gồm cả Anime/Hoạt hình chiếu rạp LẪN Phim điện ảnh người đóng Live-Action đã từng công chiếu thương mại ngoài rạp — Theatrical Release)** hay không. Nếu chỉ là TV Series ghép tập, Web Drama, OVA, Phim AI 3D hoặc video tổng hợp/review thì BẮT BUỘC đặt false.
2. "isHorrorOrGore": Kiểm tra xem bộ phim có thuộc thể loại **Kinh dị / Máu me / Rùng rợn / Ma ám / Xác sống (Horror / Gore / Supernatural Horror / Slasher)** hay không. Nếu có yếu tố kinh dị/máu me thì BẮT BUỘC đặt true.
3. "canonicalTitle": Tên bộ phim điện ảnh chuẩn hóa ngắn gọn (tiếng Việt hoặc tên quốc tế chính thức).
4. "releaseYear": Năm công chiếu tại rạp (số nguyên 4 chữ số, ví dụ 2022).
5. "cinemaFormat": Chọn CHÍNH XÁC 1 trong 2 chuỗi sau:
   - "Anime / Hoạt hình" (nếu là phim hoạt hình 2D, anime, hoạt hình 3D chiếu rạp)
   - "Phim Người Đóng" (nếu là phim điện ảnh người thật đóng / Live-Action chiếu rạp)
6. "cinemaGenres": Mảng 1 đến 3 thể loại an toàn phù hợp nhất từ danh sách chuẩn: ["Hành động", "Phiêu lưu", "Giả tưởng", "Viễn tưởng", "Tình cảm", "Hài hước", "Tâm lý", "Võ thuật"].

Trả về DUY NHẤT 1 mảng JSON hợp lệ (không giải thích ngoài JSON) theo cấu trúc:
[
  {
    "videoId": "string",
    "isTheatricalMovie": boolean,
    "isHorrorOrGore": boolean,
    "canonicalTitle": "string | null",
    "releaseYear": 2022,
    "cinemaFormat": "Anime / Hoạt hình" | "Phim Người Đóng",
    "cinemaGenres": ["Hành động", "Phiêu lưu"]
  }
]`;

  const parseVerificationResponse = (rawText: string) => {
    const arrayMatch = rawText.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return 0;

    let added = 0;
    try {
      const parsed = JSON.parse(arrayMatch[0]) as Array<{
        videoId?: string;
        isTheatricalMovie?: boolean;
        isHorrorOrGore?: boolean;
        canonicalTitle?: string | null;
        releaseYear?: number | null;
        cinemaFormat?: string | null;
        cinemaGenres?: string[] | null;
      }>;

      if (!Array.isArray(parsed)) return 0;

      for (const item of parsed) {
        if (!item?.videoId) continue;
        const year =
          typeof item.releaseYear === 'number' &&
          item.releaseYear >= 1970 &&
          item.releaseYear <= 2028
            ? Math.floor(item.releaseYear)
            : null;
        const cleanTitle =
          typeof item.canonicalTitle === 'string' &&
          item.canonicalTitle.trim().length >= 2
            ? item.canonicalTitle.trim()
            : null;

        const isApproved =
          item.isTheatricalMovie === true &&
          item.isHorrorOrGore === false &&
          cleanTitle !== null &&
          year !== null;

        const candidate = candidateById.get(item.videoId);
        const format = normalizeCinemaFormat(item.cinemaFormat, candidate);
        const genres = normalizeSafeCinemaGenres(item.cinemaGenres);

        verifiedMap.set(item.videoId, {
          videoId: item.videoId,
          isTheatricalMovie: isApproved,
          isHorrorOrGore: Boolean(item.isHorrorOrGore),
          canonicalTitle: isApproved ? cleanTitle : null,
          releaseYear: isApproved ? year : null,
          cinemaFormat: format,
          cinemaGenres: genres,
        });
        if (isApproved) added += 1;
      }
    } catch {
      return 0;
    }
    return added;
  };

  // Lượt 1: Bật Google Search Grounding (`tools: [{ googleSearch: {} }]` trên `v1beta`)
  try {
    const { text } = await callGeminiWithFallback({
      contents: prompt,
      perModelTimeoutMs: 11000,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });
    parseVerificationResponse(text);
  } catch (err) {
    console.warn(
      '[Cinema Discover] Google Search Grounding timeout/quá tải, thử lại chế độ JSON chuẩn:',
      err,
    );
  }

  // Dự phòng an toàn nếu công cụ Google Search Grounding trên key bị giới hạn quota/timeout
  if (verifiedMap.size === 0) {
    try {
      const { text } = await callGeminiWithFallback({
        contents: prompt,
        perModelTimeoutMs: 6500,
        config: {
          temperature: 0.1,
        },
      });
      parseVerificationResponse(text);
    } catch (fallbackErr) {
      console.warn(
        '[Cinema Discover] Không thể xác minh danh sách ứng viên lúc này:',
        fallbackErr,
      );
    }
  }

  return verifiedMap;
}

/**
 * Tải KHÔNG GIỚI HẠN toàn bộ kho Phim Chiếu Rạp đã xác minh từ Supabase bằng `.range(from, to)`.
 */
async function fetchVerifiedTheatricalMoviesFromDb(
  admin: ReturnType<typeof createAdminClient>,
): Promise<CinemaVideoItem[]> {
  type DbMovieRow = {
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
    cinema_format?: CinemaFormat | null;
    cinema_genres?: string[] | null;
    created_at: string;
  };

  const rows: DbMovieRow[] = [];
  let from = 0;
  let tier: 'full' | 'theatrical' | 'basic' = 'full';

  while (true) {
    const to = from + DB_BATCH_SIZE - 1;
    if (tier === 'full') {
      const res = await admin
        .from('videos')
        .select(
          'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, is_theatrical_movie, theatrical_release_year, cinema_format, cinema_genres, created_at',
        )
        .or('is_theatrical_movie.eq.true,series_name.ilike.%[CHIẾU RẠP]%')
        .order('published_at', { ascending: false })
        .range(from, to);

      if (res.error) {
        tier = 'theatrical';
        continue;
      }
      const batch = (res.data ?? []) as unknown as DbMovieRow[];
      rows.push(...batch);
      if (batch.length < DB_BATCH_SIZE) break;
      from += DB_BATCH_SIZE;
    } else if (tier === 'theatrical') {
      const res = await admin
        .from('videos')
        .select(
          'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, is_theatrical_movie, theatrical_release_year, created_at',
        )
        .or('is_theatrical_movie.eq.true,series_name.ilike.%[CHIẾU RẠP]%')
        .order('published_at', { ascending: false })
        .range(from, to);

      if (res.error) {
        tier = 'basic';
        continue;
      }
      const batch = (res.data ?? []) as unknown as DbMovieRow[];
      rows.push(...batch);
      if (batch.length < DB_BATCH_SIZE) break;
      from += DB_BATCH_SIZE;
    } else {
      const res = await admin
        .from('videos')
        .select(
          'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, created_at',
        )
        .ilike('series_name', '%[CHIẾU RẠP]%')
        .order('published_at', { ascending: false })
        .range(from, to);

      if (res.error) break;
      const batch = (res.data ?? []) as unknown as DbMovieRow[];
      rows.push(...batch);
      if (batch.length < DB_BATCH_SIZE) break;
      from += DB_BATCH_SIZE;
    }
  }

  const validRows = rows.filter((r) => isTheatricalMovieVideo(r));
  if (validRows.length === 0) return [];

  const channelIds = Array.from(new Set(validRows.map((r) => r.channel_id)));
  const channelTitleById = new Map<string, string>();
  for (let i = 0; i < channelIds.length; i += 200) {
    const slice = channelIds.slice(i, i + 200);
    const { data: chRows } = await admin
      .from('channels')
      .select('channel_id, title')
      .in('channel_id', slice);
    for (const c of chRows ?? []) {
      channelTitleById.set(c.channel_id, c.title);
    }
  }

  return validRows.map((v) => ({
    ...v,
    detected_genre: v.detected_genre ?? 'HH2D',
    cinema_format:
      v.cinema_format ??
      resolveCinemaFormat({
        title: v.title,
        description: v.description,
        series_name: v.series_name,
        channel_title: channelTitleById.get(v.channel_id),
      }),
    cinema_genres: Array.isArray(v.cinema_genres) ? v.cinema_genres : null,
    channel_title: channelTitleById.get(v.channel_id) ?? v.channel_id,
    progress_seconds: 0,
    is_completed: false,
    last_watched_at: null,
  }));
}

async function runCinemaDiscovery(options: {
  userId?: string | null;
  force?: boolean;
  pageTokens?: Record<string, string>;
  round?: number;
}) {
  const admin = createAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Lấy toàn bộ danh sách phim chiếu rạp đã xác minh hiện có trong DB (không giới hạn)
  const existingTheatrical = await fetchVerifiedTheatricalMoviesFromDb(admin);

  // 2. Kiểm tra mốc last_cinema_sync_at (chu kỳ 12 giờ) nếu kho đã có phim và không force
  let lastSyncIso: string | null = null;
  if (options.userId) {
    const { data: prof } = await admin
      .from('profiles')
      .select('last_cinema_sync_at')
      .eq('id', options.userId)
      .maybeSingle();
    if (prof && typeof prof.last_cinema_sync_at === 'string') {
      lastSyncIso = prof.last_cinema_sync_at;
    }
  }

  const lastSyncMs = lastSyncIso
    ? new Date(lastSyncIso).getTime()
    : lastGlobalDiscoverAtMs;

  if (
    !options.force &&
    existingTheatrical.length > 0 &&
    Number.isFinite(lastSyncMs) &&
    lastSyncMs > 0 &&
    nowMs - lastSyncMs < TWELVE_HOURS_MS
  ) {
    return NextResponse.json({
      skipped: true,
      reason: 'COOLDOWN_12H',
      lastCinemaSyncAt: new Date(lastSyncMs).toISOString(),
      discoveredCount: 0,
      totalTheatricalCount: existingTheatrical.length,
      nextPageTokens: serverPageTokens,
      nextRound: serverDiscoveryRound,
      hasMore: true,
      movies: existingTheatrical,
    });
  }

  const ytApiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!ytApiKey) {
    return NextResponse.json({
      skipped: true,
      reason: 'MISSING_YOUTUBE_API_KEY',
      lastCinemaSyncAt: lastSyncIso,
      discoveredCount: 0,
      totalTheatricalCount: existingTheatrical.length,
      nextPageTokens: serverPageTokens,
      nextRound: serverDiscoveryRound,
      hasMore: false,
      movies: existingTheatrical,
    });
  }

  // 3. Incremental Discovery: Luân phiên thứ tự tìm kiếm (`relevance`, `date`, `viewCount`) + dùng `nextPageToken` đào sâu trang mới
  const activeRound =
    typeof options.round === 'number' && Number.isFinite(options.round)
      ? Math.max(0, Math.floor(options.round))
      : serverDiscoveryRound;
  const searchOrder =
    YOUTUBE_SEARCH_ORDERS[activeRound % YOUTUBE_SEARCH_ORDERS.length];
  const incomingTokens =
    options.pageTokens && Object.keys(options.pageTokens).length > 0
      ? options.pageTokens
      : serverPageTokens;
  const nextPageTokens: Record<string, string> = {};

  const discoveredVideoIds = new Set<string>();
  const existingIdSet = new Set(existingTheatrical.map((m) => m.video_id));

  await Promise.all(
    CINEMA_DISCOVER_QUERIES.map(async (query) => {
      try {
        const tokenKey = `${searchOrder}::${query}`;
        const pageToken = incomingTokens[tokenKey];

        const searchUrl = new URL(
          'https://www.googleapis.com/youtube/v3/search',
        );
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('type', 'video');
        searchUrl.searchParams.set('videoDuration', 'long');
        searchUrl.searchParams.set('maxResults', '15');
        searchUrl.searchParams.set('order', searchOrder);
        searchUrl.searchParams.set('relevanceLanguage', 'vi');
        searchUrl.searchParams.set('q', query);
        if (pageToken) {
          searchUrl.searchParams.set('pageToken', pageToken);
        }
        searchUrl.searchParams.set('key', ytApiKey);

        const res = await fetch(searchUrl.toString(), {
          cache: 'no-store',
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) return;

        const data = (await res.json().catch(() => ({}))) as {
          nextPageToken?: string;
          items?: Array<{ id?: { videoId?: string } }>;
        };
        if (data.nextPageToken) {
          nextPageTokens[tokenKey] = data.nextPageToken;
        }
        for (const item of data.items ?? []) {
          const vid = item.id?.videoId;
          if (vid && !existingIdSet.has(vid)) {
            discoveredVideoIds.add(vid);
          }
        }
      } catch {
        // Bỏ qua nếu 1 query timeout
      }
    }),
  );

  // Cập nhật trạng thái vòng quét tiếp theo (nếu hết pageToken thì chuyển sang order tiếp theo)
  const nextRound =
    Object.keys(nextPageTokens).length > 0 ? activeRound : activeRound + 1;
  serverPageTokens = nextPageTokens;
  serverDiscoveryRound = nextRound;

  // 4. Gọi `videos.list` (`part=snippet,contentDetails,statistics`) lấy thời lượng & mô tả đầy đủ (tối đa 50 IDs/request)
  const candidateIds = Array.from(discoveredVideoIds).slice(0, 50);
  const candidates: CandidateMovieItem[] = [];

  if (candidateIds.length > 0) {
    try {
      const detailsUrl = new URL(
        'https://www.googleapis.com/youtube/v3/videos',
      );
      detailsUrl.searchParams.set('part', 'snippet,contentDetails,statistics');
      detailsUrl.searchParams.set('id', candidateIds.join(','));
      detailsUrl.searchParams.set('key', ytApiKey);

      const detailsRes = await fetch(detailsUrl.toString(), {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });

      if (detailsRes.ok) {
        const detailsData = (await detailsRes.json().catch(() => ({}))) as {
          items?: Array<{
            id?: string;
            snippet?: {
              channelId?: string;
              channelTitle?: string;
              title?: string;
              description?: string;
              publishedAt?: string;
              thumbnails?: {
                maxres?: { url?: string };
                standard?: { url?: string };
                high?: { url?: string };
                medium?: { url?: string };
              };
            };
            contentDetails?: {
              duration?: string;
            };
          }>;
        };

        for (const item of detailsData.items ?? []) {
          const videoId = item.id;
          const snip = item.snippet;
          if (!videoId || !snip?.channelId || !snip?.title) continue;

          const durationSeconds = parseIso8601Duration(
            item.contentDetails?.duration,
          );
          const candidate: CandidateMovieItem = {
            videoId,
            channelId: snip.channelId,
            channelTitle: snip.channelTitle || snip.channelId,
            title: snip.title,
            description: snip.description || '',
            thumbnailUrl:
              snip.thumbnails?.maxres?.url ||
              snip.thumbnails?.standard?.url ||
              snip.thumbnails?.high?.url ||
              snip.thumbnails?.medium?.url ||
              `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            publishedAt: snip.publishedAt || nowIso,
            durationSeconds,
          };

          // Áp dụng Lớp 1: Lọc thời lượng 65-165 phút + từ khóa rác + Chặn Kinh Dị Lớp 1
          if (passesCinemaLayer1PreFilter(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    } catch {
      // Ignore error
    }
  }

  // 4b. Nếu còn dư slot trong batch, bổ sung các phim chiếu rạp cũ trong DB chưa có `cinema_genres` để cập nhật lại phân loại chuẩn xác
  const existingMissingGenres = existingTheatrical.filter(
    (m) => !Array.isArray(m.cinema_genres) || m.cinema_genres.length === 0,
  );
  if (
    candidates.length < MAX_CANDIDATES_PER_BATCH &&
    existingMissingGenres.length > 0
  ) {
    const remainingSlots = Math.min(
      6,
      MAX_CANDIDATES_PER_BATCH - candidates.length,
    );
    for (const oldMovie of existingMissingGenres.slice(0, remainingSlots)) {
      candidates.push({
        videoId: oldMovie.video_id,
        channelId: oldMovie.channel_id,
        channelTitle: oldMovie.channel_title || oldMovie.channel_id,
        title: oldMovie.title,
        description: oldMovie.description || '',
        thumbnailUrl: oldMovie.thumbnail_url,
        publishedAt: oldMovie.published_at,
        durationSeconds: oldMovie.duration_seconds,
        isExistingBackfill: true,
      });
    }
  }

  // 5. Áp dụng Lớp 2: Xác minh thực tế + Phân loại Định dạng & Thể loại qua Gemini + Google Search Grounding
  const verifiedMap = await verifyCandidatesWithGoogleSearchGrounding(
    candidates,
  );
  const approvedCandidates = candidates.filter(
    (c) => verifiedMap.get(c.videoId)?.isTheatricalMovie === true,
  );
  const newlyDiscoveredCount = approvedCandidates.filter(
    (c) => !c.isExistingBackfill,
  ).length;

  // 6. Upsert kênh (`is_subscribed = false`) và phim kèm `cinema_format`, `cinema_genres` vào Supabase
  if (approvedCandidates.length > 0) {
    const uniqueChannelsWithFlag = new Map<
      string,
      {
        channel_id: string;
        title: string;
        is_subscribed: boolean;
        updated_at: string;
      }
    >();
    for (const m of approvedCandidates) {
      if (m.isExistingBackfill) continue;
      uniqueChannelsWithFlag.set(m.channelId, {
        channel_id: m.channelId,
        title: m.channelTitle,
        is_subscribed: false,
        updated_at: nowIso,
      });
    }

    if (uniqueChannelsWithFlag.size > 0) {
      const { error: chUpsertErr } = await admin
        .from('channels')
        .upsert(Array.from(uniqueChannelsWithFlag.values()) as never, {
          onConflict: 'channel_id',
        });

      if (chUpsertErr) {
        const fallbackChannels = Array.from(
          uniqueChannelsWithFlag.values(),
        ).map(({ channel_id, title, updated_at }) => ({
          channel_id,
          title,
          updated_at,
        }));
        await admin
          .from('channels')
          .upsert(fallbackChannels, { onConflict: 'channel_id' });
      }
    }

    const videoRowsFull = approvedCandidates.map((m) => {
      const meta = verifiedMap.get(m.videoId)!;
      const canonicalSeries = `${meta.canonicalTitle} (${meta.releaseYear}) ${VERIFIED_THEATRICAL_TAG}`;
      return {
        video_id: m.videoId,
        channel_id: m.channelId,
        title: m.title,
        description: m.description,
        thumbnail_url: m.thumbnailUrl,
        published_at: m.publishedAt,
        duration_seconds: m.durationSeconds,
        is_short: false,
        video_type: 'full_movie' as const,
        detected_genre: 'HH2D' as const,
        series_name: canonicalSeries,
        episode_number: null,
        is_theatrical_movie: true,
        theatrical_release_year: meta.releaseYear,
        cinema_format: meta.cinemaFormat,
        cinema_genres: meta.cinemaGenres,
      };
    });

    const { error: upsertFullErr } = await admin
      .from('videos')
      .upsert(videoRowsFull as never, { onConflict: 'video_id' });

    if (upsertFullErr) {
      // Fallback tầng 1: Nếu DB chưa chạy ALTER TABLE thêm `cinema_format` / `cinema_genres`
      const rowsWithoutCinemaMeta = videoRowsFull.map((row) => {
        const copy = { ...row } as Record<string, unknown>;
        delete copy.cinema_format;
        delete copy.cinema_genres;
        return copy;
      });
      const { error: upsertTheatricalErr } = await admin
        .from('videos')
        .upsert(rowsWithoutCinemaMeta as never, { onConflict: 'video_id' });

      if (upsertTheatricalErr) {
        // Fallback tầng 2: Nếu DB chưa chạy ALTER TABLE thêm `is_theatrical_movie`
        const rowsBasic = rowsWithoutCinemaMeta.map((row) => {
          const copy = { ...row };
          delete copy.is_theatrical_movie;
          delete copy.theatrical_release_year;
          return copy;
        });
        await admin
          .from('videos')
          .upsert(rowsBasic as never, { onConflict: 'video_id' });
      }
    }
  }

  // Cập nhật mốc thời gian last_cinema_sync_at
  lastGlobalDiscoverAtMs = nowMs;
  if (options.userId) {
    await admin
      .from('profiles')
      .update({ last_cinema_sync_at: nowIso })
      .eq('id', options.userId);
  }

  const updatedMovies = await fetchVerifiedTheatricalMoviesFromDb(admin);

  return NextResponse.json({
    skipped: false,
    lastCinemaSyncAt: nowIso,
    searchOrder,
    candidatesFound: candidates.length,
    discoveredCount: newlyDiscoveredCount,
    totalTheatricalCount: updatedMovies.length,
    nextPageTokens,
    nextRound,
    hasMore: true,
    movies: updatedMovies,
  });
}

/**
 * GET /api/cinema/discover — Dành cho Vercel Cron Job (hỗ trợ CRON_SECRET)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  const url = new URL(request.url);
  const querySecret = url.searchParams.get('secret') ?? '';

  if (cronSecret) {
    const validHeader = authHeader === `Bearer ${cronSecret}`;
    const validQuery = querySecret === cronSecret;
    if (!validHeader && !validQuery) {
      const auth = await verifyWhitelistedUser();
      if (!auth.allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  try {
    return await runCinemaDiscovery({ force: true });
  } catch (err) {
    console.error('[Cinema Discover GET] Lỗi hệ thống:', err);
    return NextResponse.json(
      { error: 'Không thể tự động quét Phim Chiếu Rạp lúc này.' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/cinema/discover — Kích hoạt ngầm từ Client (Background Auto-Sync 12h / Tải thêm phim chiếu rạp)
 */
export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  let force = url.searchParams.get('force') === 'true';
  let pageTokens: Record<string, string> | undefined;
  let round: number | undefined;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
      pageTokens?: Record<string, string>;
      round?: number;
    };
    if (typeof body.force === 'boolean') {
      force = body.force;
    }
    if (body.pageTokens && typeof body.pageTokens === 'object') {
      pageTokens = body.pageTokens;
    }
    if (typeof body.round === 'number' && Number.isFinite(body.round)) {
      round = body.round;
    }
  } catch {
    // Empty body is valid
  }

  try {
    return await runCinemaDiscovery({
      userId: auth.userId,
      force,
      pageTokens,
      round,
    });
  } catch (err) {
    console.error('[Cinema Discover POST] Lỗi hệ thống:', err);
    return NextResponse.json(
      { error: 'Không thể tự động quét Phim Chiếu Rạp lúc này.' },
      { status: 500 },
    );
  }
}
