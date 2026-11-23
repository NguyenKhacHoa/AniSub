import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import {
  CHANNEL_DEFAULT_CATEGORIES,
  mapDefaultCategoryToGenre,
  type ChannelDefaultCategory,
} from '@/types/workspace';

const UPDATE_CHUNK_SIZE = 200;

/**
 * POST /api/channels/default-category
 * Tầng 1 (Channel Master Lock): Khóa danh mục mặc định (`AUTO` | `HH2D` | `2D` | `PHIM_AI`)
 * cho kênh trong bảng `channels`. Nếu khác `AUTO`, tự động đồng bộ toàn bộ video chưa khóa tay
 * của kênh đó sang đúng danh mục đã khóa mà không cho AI đoán lệch tập.
 */
export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    channelId?: string;
    defaultCategory?: ChannelDefaultCategory;
    applyToExisting?: boolean;
  };
  try {
    body = (await request.json()) as {
      channelId?: string;
      defaultCategory?: ChannelDefaultCategory;
      applyToExisting?: boolean;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  const defaultCategory = body.defaultCategory;
  const applyToExisting = body.applyToExisting !== false;

  if (
    !channelId ||
    !defaultCategory ||
    !CHANNEL_DEFAULT_CATEGORIES.includes(defaultCategory)
  ) {
    return NextResponse.json(
      { error: 'Thiếu channelId hoặc defaultCategory không hợp lệ.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const lockedGenre = mapDefaultCategoryToGenre(defaultCategory);
  let warning: string | null = null;

  // 1. Lưu `default_category` trên bảng `public.channels`
  const { error: chErr } = await admin
    .from('channels')
    .update({
      default_category: defaultCategory,
      updated_at: new Date().toISOString(),
    })
    .eq('channel_id', channelId);

  if (chErr) {
    warning =
      'Cột default_category chưa tồn tại trên bảng channels. Hãy chạy SQL ALTER TABLE trong docs/03-DATABASE.md để lưu khóa kênh bền vững.';
  }

  // 2. Đồng bộ `user_channels` của user để khớp ngay với khóa kênh
  if (lockedGenre) {
    const { error: ucErr } = await admin
      .from('user_channels')
      .update({
        genre_tag: lockedGenre,
        genre_tags: [lockedGenre],
      })
      .eq('user_id', auth.userId)
      .eq('channel_id', channelId);

    if (ucErr) {
      await admin
        .from('user_channels')
        .update({ genre_tag: lockedGenre })
        .eq('user_id', auth.userId)
        .eq('channel_id', channelId);
    }
  } else {
    // Chế độ AUTO: mở đa nhãn đầy đủ để bộ phân loại Tầng 2 xử lý
    await admin
      .from('user_channels')
      .update({
        genre_tags: ['Phim AI', 'HH2D'],
      })
      .eq('user_id', auth.userId)
      .eq('channel_id', channelId);
  }

  // 3. Nếu đã khóa danh mục (khác AUTO) -> đồng bộ toàn bộ video chưa khóa tay của kênh (vượt giới hạn 1.000 dòng bằng .range())
  let updatedVideosCount = 0;
  if (lockedGenre && applyToExisting) {
    const targetIds: string[] = [];
    let from = 0;
    while (true) {
      const { data: rows, error } = await admin
        .from('videos')
        .select('video_id, is_manual_tag')
        .eq('channel_id', channelId)
        .eq('is_short', false)
        .range(from, from + 999);
      if (error || !rows || rows.length === 0) break;
      for (const r of rows) {
        if (!r.is_manual_tag) targetIds.push(r.video_id);
      }
      if (rows.length < 1000) break;
      from += 1000;
    }

    for (let i = 0; i < targetIds.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = targetIds.slice(i, i + UPDATE_CHUNK_SIZE);
      const { error } = await admin
        .from('videos')
        .update({ detected_genre: lockedGenre })
        .in('video_id', chunk);
      if (!error) {
        updatedVideosCount += chunk.length;
      }
    }
  }

  const workspace = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    ok: true,
    channelId,
    defaultCategory,
    lockedGenre,
    updatedVideosCount,
    warning,
    channels: workspace.channels,
    videos: workspace.videos,
  });
}
