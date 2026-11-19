import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    videoId?: string;
    progressSeconds?: number;
    durationSeconds?: number;
  };
  try {
    body = (await request.json()) as {
      videoId?: string;
      progressSeconds?: number;
      durationSeconds?: number;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  if (!videoId || typeof body.progressSeconds !== 'number') {
    return NextResponse.json(
      { error: 'Thiếu videoId hoặc progressSeconds.' },
      { status: 400 },
    );
  }

  const safeProgress = Math.max(0, Math.floor(body.progressSeconds));
  const safeDuration = Math.max(0, Math.floor(body.durationSeconds ?? 0));
  const isCompleted =
    safeDuration > 0 ? safeProgress / safeDuration >= 0.9 : false;

  // Dùng Supabase Server Client có JWT user để áp dụng đúng RLS của watch_progress
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from('watch_progress').upsert(
    {
      user_id: auth.userId,
      video_id: videoId,
      progress_seconds: safeProgress,
      is_completed: isCompleted,
      last_watched_at: nowIso,
    },
    { onConflict: 'user_id,video_id' },
  );

  if (error) {
    console.error('[AniSub WatchProgress] Lỗi lưu tiến độ:', error);
    return NextResponse.json(
      { error: 'Không thể lưu tiến độ xem phim.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    videoId,
    progressSeconds: safeProgress,
    isCompleted,
    lastWatchedAt: nowIso,
  });
}

export async function DELETE(request: Request) {
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

  const supabase = await createClient();
  const { error } = await supabase
    .from('watch_progress')
    .delete()
    .eq('user_id', auth.userId)
    .eq('video_id', videoId);

  if (error) {
    console.error('[AniSub WatchProgress] Lỗi xóa tiến độ:', error);
    return NextResponse.json(
      { error: 'Không thể xóa khỏi danh sách xem tiếp.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ videoId, removed: true });
}
