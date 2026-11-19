import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { generateVideoSummaryWithGemini } from '@/lib/gemini/classifier';

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { videoId?: string };
  try {
    body = (await request.json()) as { videoId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  if (!videoId) {
    return NextResponse.json({ error: 'Thiếu videoId.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: video, error: fetchError } = await admin
    .from('videos')
    .select('video_id, title, description, detected_genre, duration_seconds, ai_summary')
    .eq('video_id', videoId)
    .maybeSingle();

  if (fetchError || !video) {
    return NextResponse.json(
      { error: 'Không tìm thấy video trong cơ sở dữ liệu.' },
      { status: 404 },
    );
  }

  // Luật Gemini Cache: Nếu đã có ai_summary trong DB thì trả về ngay, không gọi lại API
  if (video.ai_summary?.trim()) {
    return NextResponse.json({
      videoId: video.video_id,
      aiSummary: video.ai_summary,
      cached: true,
    });
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu GEMINI_API_KEY trong .env.local để tạo tóm tắt AI.' },
      { status: 500 },
    );
  }

  try {
    const aiSummary = await generateVideoSummaryWithGemini({
      title: video.title,
      description: video.description,
      detectedGenre: video.detected_genre,
      durationSeconds: video.duration_seconds,
    });

    await admin
      .from('videos')
      .update({ ai_summary: aiSummary })
      .eq('video_id', video.video_id);

    return NextResponse.json({
      videoId: video.video_id,
      aiSummary,
      cached: false,
    });
  } catch (err) {
    console.error('[AniSub Summarize] Lỗi gọi Gemini:', err);
    return NextResponse.json(
      { error: 'Không thể tạo tóm tắt bằng Gemini AI lúc này.' },
      { status: 500 },
    );
  }
}
