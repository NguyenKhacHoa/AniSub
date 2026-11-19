import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { videoId?: string; detectedGenre?: PrimaryGenreTag };
  try {
    body = (await request.json()) as {
      videoId?: string;
      detectedGenre?: PrimaryGenreTag;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  const detectedGenre = body.detectedGenre;

  if (
    !videoId ||
    !detectedGenre ||
    !PRIMARY_GENRE_OPTIONS.includes(detectedGenre)
  ) {
    return NextResponse.json(
      { error: 'Thiếu videoId hoặc thể loại không hợp lệ.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  let warning: string | null = null;

  // Cập nhật detected_genre + khóa is_manual_tag = true (bypass RLS bằng Admin Client)
  const { error } = await admin
    .from('videos')
    .update({
      detected_genre: detectedGenre,
      is_manual_tag: true,
    })
    .eq('video_id', videoId);

  if (error) {
    // Fallback tương thích ngược nếu chưa chạy SQL thêm cột is_manual_tag
    const { error: fallbackErr } = await admin
      .from('videos')
      .update({ detected_genre: detectedGenre })
      .eq('video_id', videoId);

    if (fallbackErr) {
      console.error('[UpdateGenre] Lỗi cập nhật videos:', fallbackErr);
      return NextResponse.json(
        { error: 'Không thể lưu thể loại mới cho video.' },
        { status: 500 },
      );
    }

    warning =
      'Đã đổi tag, nhưng hãy chạy SQL thêm cột is_manual_tag trong docs/03-DATABASE.md để khóa tag khi quét AI lại.';
  }

  return NextResponse.json({
    videoId,
    detectedGenre,
    isManualTag: true,
    warning,
  });
}
