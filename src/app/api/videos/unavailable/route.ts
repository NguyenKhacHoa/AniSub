import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';

/**
 * POST /api/videos/unavailable
 * Đánh dấu video YouTube đã bị xóa/ẩn vĩnh viễn (`is_unavailable = true`) khi client phát hiện
 * cả thumbnail thật lẫn `hqdefault.jpg` đều trả về ảnh placeholder xám 120x90 của YouTube.
 */
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
  const { error } = await admin
    .from('videos')
    .update({ is_unavailable: true } as never)
    .eq('video_id', videoId);

  if (error) {
    // Graceful no-op nếu DB chưa chạy ALTER TABLE thêm cột is_unavailable
    return NextResponse.json({ ok: true, persisted: false });
  }

  return NextResponse.json({ ok: true, persisted: true, videoId });
}
