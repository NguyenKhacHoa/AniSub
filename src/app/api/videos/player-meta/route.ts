import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { fetchYouTubeComments } from '@/lib/ai/cinema-insight';
import {
  extractTimestampHighlights,
  parseVideoChapters,
  type TimestampHighlight,
  type VideoChapter,
} from '@/lib/youtube/chapters';

export const maxDuration = 20;

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút

interface PlayerMetaCacheEntry {
  cachedAt: number;
  chapters: VideoChapter[];
  timestampHighlights: TimestampHighlight[];
}

const playerMetaCache = new Map<string, PlayerMetaCacheEntry>();

/**
 * GET /api/videos/player-meta?videoId=...
 * Tải nhẹ Chapters (trích xuất từ mô tả video) & Timestamp Highlights
 * (tối đa 8 bình luận gắn mốc giờ có lượt thích cao nhất) cho TheaterStage.
 */
export async function GET(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId')?.trim();
  if (!videoId) {
    return NextResponse.json({ error: 'Thiếu videoId.' }, { status: 400 });
  }

  const cached = playerMetaCache.get(videoId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      videoId,
      chapters: cached.chapters,
      timestampHighlights: cached.timestampHighlights,
      cached: true,
    });
  }

  const admin = createAdminClient();
  const [{ data: videoRow }, commentsRes] = await Promise.all([
    admin
      .from('videos')
      .select('description, duration_seconds')
      .eq('video_id', videoId)
      .maybeSingle(),
    fetchYouTubeComments(videoId).catch(() => ({
      comments: [],
      hasComments: false,
    })),
  ]);

  let description = videoRow?.description ?? null;
  const durationSeconds = videoRow?.duration_seconds ?? 0;

  // Nếu DB chưa có description và có YOUTUBE_API_KEY -> gọi nhẹ videos.list?part=snippet
  if (!description && process.env.YOUTUBE_API_KEY?.trim()) {
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('id', videoId);
      url.searchParams.set('key', process.env.YOUTUBE_API_KEY.trim());
      const ytRes = await fetch(url.toString(), {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (ytRes.ok) {
        const ytJson = (await ytRes.json().catch(() => ({}))) as {
          items?: Array<{ snippet?: { description?: string } }>;
        };
        const ytDesc = ytJson.items?.[0]?.snippet?.description?.trim() ?? null;
        if (ytDesc) {
          description = ytDesc;
        }
      }
    } catch {
      // Bỏ qua nếu YouTube timeout
    }
  }

  const chapters = parseVideoChapters(description, durationSeconds || undefined);
  const timestampHighlights = extractTimestampHighlights(
    commentsRes.comments,
    durationSeconds || undefined,
    8,
  );

  playerMetaCache.set(videoId, {
    cachedAt: Date.now(),
    chapters,
    timestampHighlights,
  });

  // Giữ kích thước cache gọn (< 300 entries)
  if (playerMetaCache.size > 300) {
    const oldestKey = playerMetaCache.keys().next().value;
    if (oldestKey) playerMetaCache.delete(oldestKey);
  }

  return NextResponse.json({
    videoId,
    chapters,
    timestampHighlights,
    cached: false,
  });
}
