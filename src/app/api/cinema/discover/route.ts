import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { callGeminiWithFallback } from '@/lib/gemini/client';
import { parseIso8601Duration } from '@/lib/youtube/api';
import {
  CINEMA_HORROR_PREFILTER_RE,
  THEATRICAL_HARD_EXCLUSION_RE,
  THEATRICAL_MAX_DURATION_SECONDS,
  THEATRICAL_MIN_DURATION_SECONDS,
  VERIFIED_THEATRICAL_TAG,
  isTheatricalMovieVideo,
  type CinemaVideoItem,
} from '@/types/workspace';

export const maxDuration = 30;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Bộ từ khóa chuyên biệt để tự động săn Phim Chiếu Rạp miễn phí trên toàn YouTube
 */
const CINEMA_DISCOVER_QUERIES = [
  'anime movie vietsub',
  'phim hoạt hình chiếu rạp vietsub',
  'bản điện ảnh vietsub',
] as const;

let lastGlobalDiscoverAtMs = 0;

interface CandidateMovieItem {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  durationSeconds: number;
}

interface GroundedMovieVerification {
  videoId: string;
  isTheatricalMovie: boolean;
  isHorrorOrGore: boolean;
  canonicalTitle: string | null;
  releaseYear: number | null;
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
 * Lớp 2: Xác minh thực tế qua Gemini + Google Search Grounding (`tools: [{ googleSearch: {} }]` / `google_search` trên `v1beta`)
 * - Kiểm tra 1: Có phải là Phim Điện Ảnh / Anime Movie từng công chiếu thương mại ngoài rạp (Theatrical Release) không?
 * - Kiểm tra 2: Có thuộc thể loại Kinh dị / Máu me (Horror / Gore / Supernatural Horror) không?
 * - Điều kiện lưu: isTheatricalMovie === true VÀ isHorrorOrGore === false.
 */
async function verifyCandidatesWithGoogleSearchGrounding(
  candidates: CandidateMovieItem[],
): Promise<Map<string, GroundedMovieVerification>> {
  const verifiedMap = new Map<string, GroundedMovieVerification>();
  if (candidates.length === 0 || !process.env.GEMINI_API_KEY?.trim()) {
    return verifiedMap;
  }

  const batch = candidates.slice(0, 12);
  const candidatesBlock = batch
    .map(
      (c, idx) =>
        `${idx + 1}. videoId: "${c.videoId}"
   - Tiêu đề: "${c.title}"
   - Kênh: "${c.channelTitle}"
   - Thời lượng: ${Math.round(c.durationSeconds / 60)} phút
   - Mô tả ngắn: "${c.description.slice(0, 220).replace(/\s+/g, ' ')}"`,
    )
    .join('\n\n');

  const prompt = `Bạn là hệ thống kiểm duyệt Phim Chiếu Rạp của AniSub. Hãy sử dụng công cụ Google Search để tra cứu thông tin phát hành thực tế cho từng video ứng viên dưới đây:

${candidatesBlock}

YÊU CẦU KIỂM DUYỆT NGHIÊM NGẶT CHO TỪNG VIDEO:
1. "isTheatricalMovie": Tra cứu Google xem tác phẩm này có phải là một bộ **Phim Điện Ảnh / Anime Movie đã từng công chiếu thương mại ngoài rạp (Theatrical Release)** hay không. Nếu chỉ là TV Series ghép tập, Web Drama, OVA, ONA, Phim AI 3D hoặc video tổng hợp thì BẮT BUỘC đặt false.
2. "isHorrorOrGore": Kiểm tra xem bộ phim có thuộc thể loại **Kinh dị / Máu me / Rùng rợn / Ma ám / Xác sống (Horror / Gore / Supernatural Horror / Slasher)** hay không. Nếu có yếu tố kinh dị/máu me thì BẮT BUỘC đặt true. (Chỉ các thể loại an toàn như Hành động, Phiêu lưu, Giả tưởng, Viễn tưởng, Tình cảm/Đời thường, Hài hước, Gia đình, Võ thuật/Tu tiên mới đặt false).
3. "canonicalTitle": Tên bộ phim điện ảnh chuẩn hóa ngắn gọn (tiếng Việt hoặc tên quốc tế chính thức).
4. "releaseYear": Năm công chiếu tại rạp (số nguyên 4 chữ số, ví dụ 2022).

Trả về DUY NHẤT 1 mảng JSON hợp lệ (không giải thích ngoài JSON) theo cấu trúc:
[
  {
    "videoId": "string",
    "isTheatricalMovie": boolean,
    "isHorrorOrGore": boolean,
    "canonicalTitle": "string | null",
    "releaseYear": 2022
  }
]`;

  try {
    const { text } = await callGeminiWithFallback({
      contents: prompt,
      perModelTimeoutMs: 8000,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });

    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return verifiedMap;

    const parsed = JSON.parse(arrayMatch[0]) as Array<{
      videoId?: string;
      isTheatricalMovie?: boolean;
      isHorrorOrGore?: boolean;
      canonicalTitle?: string | null;
      releaseYear?: number | null;
    }>;

    if (!Array.isArray(parsed)) return verifiedMap;

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

      verifiedMap.set(item.videoId, {
        videoId: item.videoId,
        isTheatricalMovie: isApproved,
        isHorrorOrGore: Boolean(item.isHorrorOrGore),
        canonicalTitle: isApproved ? cleanTitle : null,
        releaseYear: isApproved ? year : null,
      });
    }
  } catch (err) {
    console.warn(
      '[Cinema Discover] Không thể xác minh Google Search Grounding lúc này:',
      err,
    );
  }

  return verifiedMap;
}

async function fetchVerifiedTheatricalMoviesFromDb(
  admin: ReturnType<typeof createAdminClient>,
): Promise<CinemaVideoItem[]> {
  let rows: Array<{
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
    created_at: string;
  }> = [];

  const withTheatricalCol = await admin
    .from('videos')
    .select(
      'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, is_manual_tag, is_theatrical_movie, theatrical_release_year, created_at',
    )
    .or('is_theatrical_movie.eq.true,series_name.ilike.%[CHIẾU RẠP]%')
    .order('published_at', { ascending: false })
    .limit(120);

  if (withTheatricalCol.error) {
    const fallbackRes = await admin
      .from('videos')
      .select(
        'video_id, channel_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, video_type, detected_genre, series_name, episode_number, ai_summary, created_at',
      )
      .ilike('series_name', '%[CHIẾU RẠP]%')
      .order('published_at', { ascending: false })
      .limit(120);
    rows = (fallbackRes.data ?? []) as typeof rows;
  } else {
    rows = (withTheatricalCol.data ?? []) as typeof rows;
  }

  const validRows = rows.filter((r) => isTheatricalMovieVideo(r));
  if (validRows.length === 0) return [];

  const channelIds = Array.from(new Set(validRows.map((r) => r.channel_id)));
  const { data: chRows } = await admin
    .from('channels')
    .select('channel_id, title')
    .in('channel_id', channelIds);

  const channelTitleById = new Map(
    (chRows ?? []).map((c) => [c.channel_id, c.title]),
  );

  return validRows.map((v) => ({
    ...v,
    detected_genre: v.detected_genre ?? 'HH2D',
    channel_title: channelTitleById.get(v.channel_id) ?? v.channel_id,
    progress_seconds: 0,
    is_completed: false,
    last_watched_at: null,
  }));
}

async function runCinemaDiscovery(options: {
  userId?: string | null;
  force?: boolean;
}) {
  const admin = createAdminClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Lấy danh sách phim chiếu rạp đã xác minh hiện có trong DB
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
      movies: existingTheatrical,
    });
  }

  // 3. Tìm kiếm trên YouTube Data API v3 (`search.list` với type=video, videoDuration=long, maxResults=15)
  const discoveredVideoIds = new Set<string>();
  const existingIdSet = new Set(existingTheatrical.map((m) => m.video_id));

  await Promise.all(
    CINEMA_DISCOVER_QUERIES.map(async (query) => {
      try {
        const searchUrl = new URL(
          'https://www.googleapis.com/youtube/v3/search',
        );
        searchUrl.searchParams.set('part', 'snippet');
        searchUrl.searchParams.set('type', 'video');
        searchUrl.searchParams.set('videoDuration', 'long');
        searchUrl.searchParams.set('maxResults', '15');
        searchUrl.searchParams.set('relevanceLanguage', 'vi');
        searchUrl.searchParams.set('q', query);
        searchUrl.searchParams.set('key', ytApiKey);

        const res = await fetch(searchUrl.toString(), {
          cache: 'no-store',
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) return;

        const data = (await res.json().catch(() => ({}))) as {
          items?: Array<{ id?: { videoId?: string } }>;
        };
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

  // 4. Gọi `videos.list` (`part=snippet,contentDetails,statistics`) để lấy thời lượng và mô tả đầy đủ
  const candidateIds = Array.from(discoveredVideoIds).slice(0, 45);
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

          // Áp dụng Lớp 1: Lọc thời lượng 65-165 phút + lọc từ khóa rác + Chặn Kinh Dị Lớp 1
          if (passesCinemaLayer1PreFilter(candidate)) {
            candidates.push(candidate);
          }
        }
      }
    } catch {
      // Ignore error
    }
  }

  // 5. Áp dụng Lớp 2: Xác minh thực tế qua Gemini + Google Search Grounding
  const verifiedMap = await verifyCandidatesWithGoogleSearchGrounding(
    candidates,
  );
  const approvedMovies = candidates.filter(
    (c) => verifiedMap.get(c.videoId)?.isTheatricalMovie === true,
  );

  // 6. Upsert các kênh và phim đã vượt qua cả 2 lớp kiểm duyệt vào Supabase
  if (approvedMovies.length > 0) {
    const uniqueChannels = new Map<string, { channel_id: string; title: string; updated_at: string }>();
    for (const m of approvedMovies) {
      uniqueChannels.set(m.channelId, {
        channel_id: m.channelId,
        title: m.channelTitle,
        updated_at: nowIso,
      });
    }

    await admin
      .from('channels')
      .upsert(Array.from(uniqueChannels.values()), { onConflict: 'channel_id' });

    const videoRowsWithTheatricalCol = approvedMovies.map((m) => {
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
      };
    });

    const { error: upsertErr } = await admin
      .from('videos')
      .upsert(videoRowsWithTheatricalCol, { onConflict: 'video_id' });

    if (upsertErr) {
      // Fallback an toàn nếu DB chưa chạy ALTER TABLE thêm cột is_theatrical_movie
      const fallbackRows = videoRowsWithTheatricalCol.map((row) => {
        const copy = { ...row } as Record<string, unknown>;
        delete copy.is_theatrical_movie;
        delete copy.theatrical_release_year;
        return copy;
      });
      await admin
        .from('videos')
        .upsert(fallbackRows as never, { onConflict: 'video_id' });
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
    candidatesFound: candidates.length,
    discoveredCount: approvedMovies.length,
    movies: updatedMovies,
  });
}

/**
 * GET /api/cinema/discover
 * Dành cho Vercel Cron Job chạy tự động lúc 02:00 sáng hằng ngày (`0 2 * * *`),
 * hỗ trợ xác thực `CRON_SECRET` nếu được cấu hình trong biến môi trường, hoặc người dùng đã đăng nhập.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization');
  const isCronAuthorized =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (!isCronAuthorized) {
    const auth = await verifyWhitelistedUser();
    if (!auth.allowed && cronSecret) {
      return NextResponse.json({ error: 'Unauthorized Cron' }, { status: 401 });
    }
    return runCinemaDiscovery({
      userId: auth.userId ?? null,
      force: true,
    });
  }

  return runCinemaDiscovery({ userId: null, force: true });
}

/**
 * POST /api/cinema/discover
 * Kích hoạt ngầm từ phía client (Background Auto-Sync chu kỳ 12h khi mở web hoặc mở tab Phim Chiếu Rạp).
 */
export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let force = false;
  try {
    const body = (await request.json()) as { force?: boolean };
    force = Boolean(body?.force);
  } catch {
    force = false;
  }

  return runCinemaDiscovery({
    userId: auth.userId,
    force,
  });
}
