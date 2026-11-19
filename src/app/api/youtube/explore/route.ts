import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Type, type Schema } from '@google/genai';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { callGeminiWithFallback } from '@/lib/gemini/client';
import {
  classifyVideoHeuristic,
  parseIso8601Duration,
} from '@/lib/youtube/api';
import type { CinemaVideoItem } from '@/types/workspace';
import type { Json } from '@/types/database';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const MAX_EXPLORE_PAGES = 10;

interface CachedExplorePayload {
  keywords: string[];
  videos: CinemaVideoItem[];
  pageTokens: Record<string, string>;
  dominantGenre: 'Phim AI' | 'HH2D';
  usedKeywords: string[];
  updatedAt: string;
}

// Cache nhẹ trong bộ nhớ server (bổ trợ DB explore_cache và lưu pageTokens + từ khóa đã dùng)
const memoryExploreCache = new Map<string, CachedExplorePayload>();

const FALLBACK_EXPANDED_KEYWORDS: Record<'Phim AI' | 'HH2D', string[]> = {
  'Phim AI': [
    'phim AI huyền huyễn thuyết minh trọn bộ',
    'phim ngắn AI viễn tưởng 3D thuyết minh',
    'hoạt hình AI cổ trang kiếm hiệp thuyết minh',
    'phim AI mạt thế sinh tồn thuyết minh mới',
    'phim hoạt hình AI 3D kinh dị thuyết minh',
    'truyện tranh manhua hệ thống thuyết minh tập mới',
  ],
  HH2D: [
    'hoạt hình 2D hệ thống trọng sinh thuyết minh',
    'manhua tu tiên phế vật nghịch thiên thuyết minh',
    'truyện tranh 2D mạt thế dị năng thuyết minh',
    'hoạt hình 2D xuyên không cổ đại thuyết minh',
    'phim AI tu tiên 3D điện ảnh thuyết minh',
    'hoạt hình 2D đô thị tu chân thuyết minh',
  ],
};

interface YouTubeLikedResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      channelTitle?: string;
    };
  }>;
}

interface YouTubeSearchResponse {
  nextPageToken?: string;
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      channelId?: string;
      channelTitle?: string;
      title?: string;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string }>;
  };
}

interface YouTubeVideosDetailResponse {
  items?: Array<{
    id: string;
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
        default?: { url?: string };
      };
    };
    contentDetails?: {
      duration?: string;
    };
  }>;
}

async function generateExploreKeywords(
  watchedTitles: string[],
  likedTitles: string[],
  channelTitles: string[],
  dominantGenre: 'Phim AI' | 'HH2D',
  excludeKeywords: string[] = [],
): Promise<string[]> {
  const defaultKeywords =
    dominantGenre === 'Phim AI'
      ? [
          'phim hoạt hình AI thuyết minh mới nhất',
          'phim AI tu tiên 3D điện ảnh thuyết minh',
          'hoạt hình 2D manhua thuyết minh tập mới',
        ]
      : [
          'hoạt hình 2D tu tiên thuyết minh mới nhất',
          'truyện tranh manhua thuyết minh tập mới',
          'phim hoạt hình AI thuyết minh 4K',
        ];

  if (!process.env.GEMINI_API_KEY?.trim()) {
    const unusedFallbacks = FALLBACK_EXPANDED_KEYWORDS[dominantGenre].filter(
      (kw) => !excludeKeywords.includes(kw),
    );
    return unusedFallbacks.length >= 3
      ? unusedFallbacks.slice(0, 3)
      : defaultKeywords;
  }

  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      keywords: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Đúng 3 cụm từ khóa tìm kiếm YouTube tiếng Việt ngắn gọn.',
      },
    },
    required: ['keywords'],
  };

  const excludeNote =
    excludeKeywords.length > 0
      ? `\n- TUYỆT ĐỐI KHÔNG lặp lại các cụm từ khóa đã dùng sau đây:\n${excludeKeywords.join('\n')}`
      : '';

  const prompt = `Bạn là hệ thống gợi ý phim cá nhân hóa của rạp chiếu AniSub (chỉ gồm 2 thể loại: "Phim AI" và "HH2D").
Dựa trên thói quen xem của người dùng bên dưới, hãy sinh ra ĐÚNG 3 cụm từ khóa tìm kiếm tiếng Việt MỚI MẺ trên YouTube để săn các kênh mới cùng gu (ưu tiên thể loại ưa thích: ${dominantGenre}):

- Các video đã xem gần đây / xem lâu nhất:
${watchedTitles.slice(0, 15).join('\n') || '(Chưa có lịch sử xem)'}

- Các video người dùng từng bấm Like trên YouTube:
${likedTitles.slice(0, 10).join('\n') || '(Không có dữ liệu Like)'}

- Các kênh người dùng đã đăng ký:
${channelTitles.slice(0, 12).join(', ') || '(Chưa có kênh)'}

Yêu cầu:
- Trả về đúng 3 cụm từ khóa tiếng Việt ngắn gọn (4–8 từ mỗi cụm), tự nhiên như người dùng tìm phim trên YouTube (ví dụ: "phim AI tu tiên thuyết minh full", "truyện tranh 2D trọng sinh thuyết minh").
- Không chứa tên kênh cụ thể để tìm ra được các kênh MỚI.${excludeNote}`;

  try {
    const { text: raw } = await callGeminiWithFallback({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: excludeKeywords.length > 0 ? 0.85 : 0.5,
      },
    });

    const parsed = JSON.parse(raw) as { keywords?: string[] };
    const cleaned = (parsed.keywords ?? [])
      .map((k) => k.trim())
      .filter((k) => k.length > 0 && !excludeKeywords.includes(k))
      .slice(0, 3);

    if (cleaned.length > 0) {
      return cleaned;
    }
  } catch (err) {
    console.error('[AniSub Explore] Lỗi sinh từ khóa:', err);
  }

  const unusedFallbacks = FALLBACK_EXPANDED_KEYWORDS[dominantGenre].filter(
    (kw) => !excludeKeywords.includes(kw),
  );
  return unusedFallbacks.length >= 3
    ? unusedFallbacks.slice(0, 3)
    : defaultKeywords;
}

function parsePageTokensParam(raw: string | null): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) {
        clean[k.trim()] = v.trim();
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pageRaw = Number(searchParams.get('page') ?? 1);
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1
      ? Math.min(MAX_EXPLORE_PAGES, Math.floor(pageRaw))
      : 1;
  const forceRefresh = searchParams.get('refresh') === 'true';
  const incomingPageTokens = parsePageTokensParam(
    searchParams.get('pageTokens'),
  );
  const excludeIdsParam = searchParams.get('excludeIds') ?? '';
  const excludeVideoIds = new Set(
    excludeIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const admin = createAdminClient();
  const supabase = await createClient();

  // TRANG 1: Kiểm tra Cache 6 tiếng (DB explore_cache -> fallback memory cache) nếu không ép refresh
  if (page === 1 && !forceRefresh) {
    const { data: dbCache, error: cacheErr } = await admin
      .from('explore_cache')
      .select('keywords, items, updated_at')
      .eq('user_id', auth.userId)
      .maybeSingle();

    const mem = memoryExploreCache.get(auth.userId);

    if (!cacheErr && dbCache?.updated_at) {
      const age = Date.now() - new Date(dbCache.updated_at).getTime();
      const cachedVideos = Array.isArray(dbCache.items)
        ? (dbCache.items as unknown as CinemaVideoItem[])
        : [];
      if (age < SIX_HOURS_MS && cachedVideos.length > 0) {
        return NextResponse.json({
          keywords: dbCache.keywords ?? [],
          videos: cachedVideos,
          page: 1,
          nextPage: 2,
          hasMore: true,
          pageTokens: mem?.pageTokens ?? {},
          cached: true,
          updatedAt: dbCache.updated_at,
        });
      }
    } else if (mem) {
      const age = Date.now() - new Date(mem.updatedAt).getTime();
      if (age < SIX_HOURS_MS && mem.videos.length > 0) {
        return NextResponse.json({
          keywords: mem.keywords,
          videos: mem.videos,
          page: 1,
          nextPage: 2,
          hasMore: true,
          pageTokens: mem.pageTokens,
          cached: true,
          updatedAt: mem.updatedAt,
        });
      }
    }
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Thiếu YOUTUBE_API_KEY trong .env.local để tìm kiếm Khám phá.' },
      { status: 500 },
    );
  }

  // BƯỚC 1: Lấy danh sách kênh user đang chọn để ưu tiên đề xuất kênh LẠ
  const { data: userChannelsRaw } = await admin
    .from('user_channels')
    .select('channel_id, is_selected, genre_tag')
    .eq('user_id', auth.userId);

  const userChannels = userChannelsRaw ?? [];
  const selectedChannelIds = new Set(
    userChannels.filter((uc) => uc.is_selected).map((uc) => uc.channel_id),
  );

  const memState = memoryExploreCache.get(auth.userId);
  let dominantGenre: 'Phim AI' | 'HH2D' = memState?.dominantGenre ?? 'HH2D';
  let activeQueries: Array<{ keyword: string; pageToken?: string }> = [];
  let allKeywordsForResponse: string[] = [];

  // BƯỚC 2: Xác định bộ từ khóa & pageTokens tùy theo trang
  const effectiveTokens: Record<string, string> =
    Object.keys(incomingPageTokens).length > 0
      ? incomingPageTokens
      : page >= 2
        ? (memState?.pageTokens ?? {})
        : {};

  if (page >= 2 && Object.keys(effectiveTokens).length > 0) {
    // Tận dụng nextPageToken từ trang trước để tiết kiệm gọi Gemini AI
    activeQueries = Object.entries(effectiveTokens)
      .slice(0, 3)
      .map(([keyword, pageToken]) => ({ keyword, pageToken }));
    allKeywordsForResponse = activeQueries.map((q) => q.keyword);
  } else {
    // Trang 1 (hoặc trang >= 2 đã cạn nextPageToken -> mở rộng từ khóa mới bằng Gemini AI)
    const { data: progressRows } = await admin
      .from('watch_progress')
      .select('video_id, progress_seconds, last_watched_at')
      .eq('user_id', auth.userId)
      .order('progress_seconds', { ascending: false })
      .order('last_watched_at', { ascending: false })
      .limit(15);

    const watchedVideoIds = (progressRows ?? []).map((p) => p.video_id);
    const watchedTitles: string[] = [];
    let aiCount = 0;
    let hh2dCount = 0;

    if (watchedVideoIds.length > 0) {
      const { data: watchedVideos } = await admin
        .from('videos')
        .select('video_id, title, detected_genre')
        .in('video_id', watchedVideoIds);

      for (const v of watchedVideos ?? []) {
        watchedTitles.push(v.title);
        if (v.detected_genre === 'Phim AI') aiCount += 1;
        else hh2dCount += 1;
      }
    }

    let channelTitles: string[] = [];
    if (userChannels.length > 0) {
      const { data: chRows } = await admin
        .from('channels')
        .select('title')
        .in(
          'channel_id',
          userChannels.slice(0, 20).map((uc) => uc.channel_id),
        );
      channelTitles = (chRows ?? []).map((c) => c.title);
    }

    const likedTitles: string[] = [];
    if (page === 1) {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const cookieStore = await cookies();
        const providerToken =
          session?.provider_token || cookieStore.get('anisub_yt_token')?.value;

        if (providerToken) {
          const likedUrl =
            'https://www.googleapis.com/youtube/v3/videos?part=snippet&myRating=like&maxResults=10';
          const likedRes = await fetch(likedUrl, {
            headers: { Authorization: `Bearer ${providerToken}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(4000),
          });
          if (likedRes.ok) {
            const likedData = (await likedRes.json()) as YouTubeLikedResponse;
            for (const item of likedData.items ?? []) {
              if (item.snippet?.title) {
                likedTitles.push(item.snippet.title);
              }
            }
          }
        }
      } catch {
        // Bỏ qua nếu token hết hạn
      }
    }

    dominantGenre = aiCount > hh2dCount ? 'Phim AI' : 'HH2D';
    const previouslyUsedKeywords =
      page >= 2 || forceRefresh ? (memState?.usedKeywords ?? []) : [];

    const generatedKeywords = await generateExploreKeywords(
      watchedTitles,
      likedTitles,
      channelTitles,
      dominantGenre,
      previouslyUsedKeywords,
    );

    activeQueries = generatedKeywords.map((keyword) => ({ keyword }));
    allKeywordsForResponse = generatedKeywords;
  }

  // BƯỚC 3: Tìm kiếm YouTube search.list song song cho các từ khóa + lưu nextPageToken
  const candidateVideoIds: string[] = [];
  const keywordByVideoId = new Map<string, string>();
  const seenIds = new Set<string>(excludeVideoIds);
  const nextPageTokens: Record<string, string> = {};

  for (const q of activeQueries) {
    try {
      const searchUrl = new URL(
        'https://www.googleapis.com/youtube/v3/search',
      );
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('type', 'video');
      searchUrl.searchParams.set('maxResults', '10');
      searchUrl.searchParams.set('order', 'relevance');
      searchUrl.searchParams.set('relevanceLanguage', 'vi');
      searchUrl.searchParams.set('q', q.keyword);
      if (q.pageToken) {
        searchUrl.searchParams.set('pageToken', q.pageToken);
      }
      searchUrl.searchParams.set('key', apiKey);

      const searchRes = await fetch(searchUrl.toString(), {
        cache: 'no-store',
      });
      const searchData = (await searchRes
        .json()
        .catch(() => ({}))) as YouTubeSearchResponse;

      if (!searchRes.ok) {
        if (searchData.error?.errors?.[0]?.reason === 'quotaExceeded') {
          return NextResponse.json(
            {
              error:
                'YouTube Data API v3 đã hết Quota tìm kiếm hôm nay. Vui lòng thử lại vào ngày mai.',
            },
            { status: 429 },
          );
        }
        continue;
      }

      if (searchData.nextPageToken) {
        nextPageTokens[q.keyword] = searchData.nextPageToken;
      }

      for (const item of searchData.items ?? []) {
        const vid = item.id?.videoId;
        if (!vid || seenIds.has(vid)) continue;
        seenIds.add(vid);
        candidateVideoIds.push(vid);
        keywordByVideoId.set(vid, q.keyword);
      }
    } catch {
      continue;
    }
  }

  const updatedAt = new Date().toISOString();

  if (candidateVideoIds.length === 0) {
    const hasMore = page < MAX_EXPLORE_PAGES && Object.keys(nextPageTokens).length > 0;
    return NextResponse.json({
      keywords: allKeywordsForResponse,
      videos: [],
      page,
      nextPage: hasMore ? page + 1 : null,
      hasMore,
      pageTokens: nextPageTokens,
      cached: false,
      updatedAt,
    });
  }

  // Gọi videos.list để lấy duration_seconds & lọc bỏ Shorts (<= 65s)
  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,contentDetails');
  videosUrl.searchParams.set('id', candidateVideoIds.slice(0, 35).join(','));
  videosUrl.searchParams.set('key', apiKey);

  const videosRes = await fetch(videosUrl.toString(), { cache: 'no-store' });
  const videosData = (await videosRes
    .json()
    .catch(() => ({}))) as YouTubeVideosDetailResponse;

  const newChannelVideos: CinemaVideoItem[] = [];
  const existingChannelVideos: CinemaVideoItem[] = [];

  for (const item of videosData.items ?? []) {
    const title = item.snippet?.title?.trim();
    const channelId = item.snippet?.channelId;
    if (!item.id || !title || !channelId) continue;

    const description = item.snippet?.description?.trim() ?? '';
    const durationSeconds = parseIso8601Duration(item.contentDetails?.duration);
    const { is_short, video_type } = classifyVideoHeuristic(
      title,
      description,
      durationSeconds,
    );

    // Bỏ qua YouTube Shorts (<= 65 giây hoặc #shorts)
    if (is_short || durationSeconds <= 65) continue;

    const thumb =
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.standard?.url ||
      item.snippet?.thumbnails?.maxres?.url ||
      `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;

    const matchedKw = keywordByVideoId.get(item.id) ?? '';
    const inferredGenre: 'Phim AI' | 'HH2D' =
      matchedKw.toLowerCase().includes('ai') ||
      title.toLowerCase().includes('phim ai') ||
      title.toLowerCase().includes('hoạt hình ai')
        ? 'Phim AI'
        : 'HH2D';

    const videoItem: CinemaVideoItem = {
      video_id: item.id,
      channel_id: channelId,
      channel_title: item.snippet?.channelTitle ?? channelId,
      title,
      description: description ? description.slice(0, 1200) : null,
      thumbnail_url: thumb,
      published_at: item.snippet?.publishedAt || new Date().toISOString(),
      duration_seconds: durationSeconds,
      is_short: false,
      video_type,
      detected_genre: inferredGenre,
      series_name: null,
      episode_number: null,
      ai_summary: null,
      is_manual_tag: false,
      created_at: updatedAt,
      progress_seconds: 0,
      is_completed: false,
      matched_keyword: matchedKw,
    };

    if (selectedChannelIds.has(channelId)) {
      existingChannelVideos.push(videoItem);
    } else {
      newChannelVideos.push(videoItem);
    }
  }

  // Ưu tiên video từ các kênh CHƯA nằm trong is_selected = true
  const finalVideos = [...newChannelVideos, ...existingChannelVideos].slice(
    0,
    24,
  );

  const mergedUsedKeywords = Array.from(
    new Set([
      ...(page === 1 && !forceRefresh ? [] : (memState?.usedKeywords ?? [])),
      ...allKeywordsForResponse,
    ]),
  ).slice(-18);

  const hasMore =
    page < MAX_EXPLORE_PAGES &&
    (Object.keys(nextPageTokens).length > 0 || finalVideos.length > 0);

  // Chỉ ghi đè cache 6 tiếng DB ở Trang 1
  if (page === 1) {
    memoryExploreCache.set(auth.userId, {
      keywords: allKeywordsForResponse,
      videos: finalVideos,
      pageTokens: nextPageTokens,
      dominantGenre,
      usedKeywords: mergedUsedKeywords,
      updatedAt,
    });

    await admin.from('explore_cache').upsert(
      {
        user_id: auth.userId,
        keywords: allKeywordsForResponse,
        items: finalVideos as unknown as Json,
        updated_at: updatedAt,
      },
      { onConflict: 'user_id' },
    );
  } else if (memState) {
    memoryExploreCache.set(auth.userId, {
      ...memState,
      pageTokens: nextPageTokens,
      usedKeywords: mergedUsedKeywords,
    });
  }

  return NextResponse.json({
    keywords: allKeywordsForResponse,
    videos: finalVideos,
    page,
    nextPage: hasMore ? page + 1 : null,
    hasMore,
    pageTokens: nextPageTokens,
    cached: false,
    updatedAt,
  });
}
