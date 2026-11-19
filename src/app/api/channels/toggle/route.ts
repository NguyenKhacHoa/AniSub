import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { YouTubeApiError } from '@/lib/youtube/api';
import { syncChannelVideosPage } from '@/lib/youtube/channel-sync';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';
import type { GenreTag } from '@/types/database';

function sanitizeGenreTags(
  inputTags?: string[],
  fallbackSingle?: string,
): PrimaryGenreTag[] {
  const unique = new Set<PrimaryGenreTag>();
  for (const tag of inputTags ?? []) {
    if (PRIMARY_GENRE_OPTIONS.includes(tag as PrimaryGenreTag)) {
      unique.add(tag as PrimaryGenreTag);
    }
  }
  if (
    unique.size === 0 &&
    fallbackSingle &&
    PRIMARY_GENRE_OPTIONS.includes(fallbackSingle as PrimaryGenreTag)
  ) {
    unique.add(fallbackSingle as PrimaryGenreTag);
  }
  if (unique.size === 0) {
    unique.add('HH2D');
  }
  return Array.from(unique);
}

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    channelId?: string;
    isSelected?: boolean;
    genreTags?: GenreTag[];
    genreTag?: GenreTag;
  };
  try {
    body = (await request.json()) as {
      channelId?: string;
      isSelected?: boolean;
      genreTags?: GenreTag[];
      genreTag?: GenreTag;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  if (!channelId || typeof body.isSelected !== 'boolean') {
    return NextResponse.json(
      { error: 'Thiếu channelId hoặc isSelected.' },
      { status: 400 },
    );
  }

  const genreTags = sanitizeGenreTags(body.genreTags, body.genreTag);
  const primaryGenre: PrimaryGenreTag = genreTags[0];

  const admin = createAdminClient();
  let warningMessage: string | null = null;

  // 1. Lưu is_selected, genre_tag và genre_tags vào public.user_channels
  const { error: upsertErr } = await admin.from('user_channels').upsert(
    {
      user_id: auth.userId,
      channel_id: channelId,
      is_selected: body.isSelected,
      genre_tag: primaryGenre,
      genre_tags: genreTags,
    },
    { onConflict: 'user_id,channel_id' },
  );

  if (upsertErr) {
    // Fallback nếu user chưa chạy ALTER TABLE thêm cột genre_tags
    const { error: fallbackErr } = await admin.from('user_channels').upsert(
      {
        user_id: auth.userId,
        channel_id: channelId,
        is_selected: body.isSelected,
        genre_tag: primaryGenre,
      },
      { onConflict: 'user_id,channel_id' },
    );

    if (fallbackErr) {
      console.error(
        '[AniSub ToggleChannel] Lỗi cập nhật user_channels:',
        fallbackErr,
      );
      return NextResponse.json(
        { error: 'Không thể cập nhật trạng thái kênh.' },
        { status: 500 },
      );
    }

    warningMessage =
      'Vui lòng chạy SQL thêm cột genre_tags TEXT[] trong docs/03-DATABASE.md để lưu đa nhãn lâu dài.';
  }

  let fetchedVideosCount = 0;
  let newVideosCount = 0;
  let aiClassified = false;

  // 2. Khi kênh đang bật (isSelected === true): kéo tối đa 50 video mới nhất (chỉ chạy Gemini cho video chưa có trong DB)
  if (body.isSelected) {
    if (genreTags.length >= 2 && !process.env.GEMINI_API_KEY?.trim()) {
      return NextResponse.json(
        {
          error:
            'Thiếu GEMINI_API_KEY trong .env.local để phân loại kênh đa nhãn bằng Gemini Vision.',
        },
        { status: 400 },
      );
    }

    try {
      const syncResult = await syncChannelVideosPage({
        channelId,
        genreTags,
        maxResults: 50,
      });

      fetchedVideosCount = syncResult.fetchedCount;
      newVideosCount = syncResult.newVideosCount;
      aiClassified = syncResult.aiClassifiedCount > 0;
      if (syncResult.warning) {
        warningMessage = syncResult.warning;
      }
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        if (err.reason === 'quotaExceeded') {
          warningMessage =
            'Đã lưu kênh, nhưng YouTube API tạm hết Quota nên chưa kéo được video mới.';
        } else if (err.reason === 'missing_api_key') {
          warningMessage =
            'Đã lưu kênh, nhưng thiếu YOUTUBE_API_KEY trong .env.local.';
        } else {
          warningMessage = `Đã lưu kênh, nhưng lỗi tải video: ${err.message}`;
        }
      } else {
        console.error('[AniSub ToggleChannel] Lỗi fetch/classify video:', err);
        warningMessage = 'Đã lưu kênh nhưng gặp lỗi khi đồng bộ video.';
      }
    }
  }

  const workspaceData = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    channelId,
    isSelected: body.isSelected,
    genreTags,
    fetchedVideosCount,
    newVideosCount,
    aiClassified,
    warning: warningMessage,
    channels: workspaceData.channels,
    videos: workspaceData.videos,
    totalVideosCount: workspaceData.totalVideosCount,
    hasMoreVideos: workspaceData.hasMoreVideos,
  });
}
