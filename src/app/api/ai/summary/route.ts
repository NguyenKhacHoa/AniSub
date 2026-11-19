import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  fetchYouTubeComments,
  fetchYouTubeTranscript,
  generateCinemaInsightWithGemini,
} from '@/lib/ai/cinema-insight';
import type { CinemaInsightData } from '@/types/ai-insight';
import type { Json } from '@/types/database';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Fallback cache trong bộ nhớ server nếu chưa chạy ALTER TABLE thêm cột `insight_data`
const memoryInsightCache = new Map<string, CinemaInsightData>();

function isValidCachedInsight(data: unknown): data is CinemaInsightData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Partial<CinemaInsightData>;
  return (
    typeof obj.overallScore === 'number' &&
    typeof obj.verdictLabel === 'string' &&
    typeof obj.overview === 'string' &&
    typeof obj.metrics === 'object' &&
    obj.metrics !== null &&
    typeof obj.analyzedAt === 'string'
  );
}

function isFreshCache(analyzedAt: string): boolean {
  const ts = new Date(analyzedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < SEVEN_DAYS_MS;
}

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    videoId?: string;
    title?: string;
    description?: string | null;
    channelTitle?: string | null;
    detectedGenre?: string | null;
    durationSeconds?: number;
    forceRefresh?: boolean;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  if (!videoId) {
    return NextResponse.json({ error: 'Thiếu videoId.' }, { status: 400 });
  }

  const forceRefresh = Boolean(body.forceRefresh);
  const admin = createAdminClient();

  // 1. Lấy metadata video + kiểm tra cache trên Supabase (cột `insight_data`, fallback nếu chưa có cột)
  let dbVideo: {
    video_id: string;
    channel_id: string;
    title: string;
    description: string | null;
    detected_genre: string | null;
    duration_seconds: number;
    insight_data?: unknown;
  } | null = null;
  let hasInsightColumn = true;

  const withInsightRes = await admin
    .from('videos')
    .select(
      'video_id, channel_id, title, description, detected_genre, duration_seconds, insight_data',
    )
    .eq('video_id', videoId)
    .maybeSingle();

  if (withInsightRes.error) {
    hasInsightColumn = false;
    const fallbackRes = await admin
      .from('videos')
      .select(
        'video_id, channel_id, title, description, detected_genre, duration_seconds',
      )
      .eq('video_id', videoId)
      .maybeSingle();
    dbVideo = fallbackRes.data ?? null;
  } else {
    dbVideo = withInsightRes.data ?? null;
  }

  // Trả ngay từ Cache nếu còn hạn (< 7 ngày) và không bấm Quét lại
  if (!forceRefresh) {
    if (
      dbVideo?.insight_data &&
      isValidCachedInsight(dbVideo.insight_data) &&
      isFreshCache(dbVideo.insight_data.analyzedAt)
    ) {
      return NextResponse.json({
        videoId,
        insight: dbVideo.insight_data,
        cached: true,
      });
    }

    const memCached = memoryInsightCache.get(videoId);
    if (memCached && isFreshCache(memCached.analyzedAt)) {
      return NextResponse.json({
        videoId,
        insight: memCached,
        cached: true,
      });
    }
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu GEMINI_API_KEY trong .env.local để phân tích bằng AI.' },
      { status: 500 },
    );
  }

  // Lấy tên kênh từ DB nếu client không truyền lên
  let channelTitle = body.channelTitle?.trim() || null;
  if (!channelTitle && dbVideo?.channel_id) {
    const { data: chRow } = await admin
      .from('channels')
      .select('title')
      .eq('channel_id', dbVideo.channel_id)
      .maybeSingle();
    channelTitle = chRow?.title ?? null;
  }

  const resolvedTitle = dbVideo?.title || body.title?.trim() || videoId;
  const resolvedDescription = dbVideo?.description ?? body.description ?? null;
  const resolvedGenre = dbVideo?.detected_genre ?? body.detectedGenre ?? null;
  const resolvedDuration =
    dbVideo?.duration_seconds ?? body.durationSeconds ?? 0;

  // 2. Thu thập song song Nguồn 2 (Transcript) và Nguồn 3 (Bình luận YouTube)
  const [transcriptResult, commentsResult] = await Promise.all([
    fetchYouTubeTranscript(videoId),
    fetchYouTubeComments(videoId),
  ]);

  try {
    // 3. Phân tích chuyên sâu với Gemini Structured JSON Output
    const insight = await generateCinemaInsightWithGemini({
      title: resolvedTitle,
      description: resolvedDescription,
      channelTitle,
      detectedGenre: resolvedGenre,
      durationSeconds: resolvedDuration,
      transcriptText: transcriptResult.text,
      hasTranscript: transcriptResult.hasTranscript,
      comments: commentsResult.comments,
      hasComments: commentsResult.hasComments,
    });

    // Lưu memory cache ngay lập tức
    memoryInsightCache.set(videoId, insight);

    // Lưu vào Supabase nếu video tồn tại trong DB và đã có cột insight_data
    if (dbVideo && hasInsightColumn) {
      const { error: saveErr } = await admin
        .from('videos')
        .update({
          insight_data: insight as unknown as Json,
        })
        .eq('video_id', videoId);

      if (saveErr) {
        console.warn(
          '[AI Insight] Không thể lưu insight_data vào Supabase (đã cache memory):',
          saveErr.message,
        );
      }
    }

    return NextResponse.json({
      videoId,
      insight,
      cached: false,
    });
  } catch (err) {
    console.error('[POST /api/ai/summary] Lỗi phân tích Gemini:', err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Không thể phân tích tập phim lúc này: ${err.message}`
            : 'Không thể phân tích tập phim bằng Gemini AI lúc này.',
      },
      { status: 500 },
    );
  }
}
