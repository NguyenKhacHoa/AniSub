import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';

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

  const { data: existing, error: checkErr } = await admin
    .from('user_watch_later')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('video_id', videoId)
    .maybeSingle();

  if (checkErr) {
    console.error('[WatchLater] Lỗi kiểm tra user_watch_later:', checkErr);
    return NextResponse.json({
      videoId,
      saved: true,
      warning:
        'Chưa tạo bảng user_watch_later trong Supabase. Hãy chạy SQL trong docs/03-DATABASE.md để lưu bền vững.',
    });
  }

  if (existing) {
    const { error: delErr } = await admin
      .from('user_watch_later')
      .delete()
      .eq('user_id', auth.userId)
      .eq('video_id', videoId);

    if (delErr) {
      console.error('[WatchLater] Lỗi xóa bookmark:', delErr);
      return NextResponse.json(
        { error: 'Không thể xóa khỏi danh sách Xem sau.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ videoId, saved: false });
  }

  const { error: insErr } = await admin.from('user_watch_later').insert({
    user_id: auth.userId,
    video_id: videoId,
  });

  if (insErr) {
    console.error('[WatchLater] Lỗi thêm bookmark:', insErr);
    return NextResponse.json(
      { error: 'Không thể lưu vào danh sách Xem sau.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ videoId, saved: true });
}
