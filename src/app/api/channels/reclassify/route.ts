import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { fetchChannelLatestVideos } from '@/lib/youtube/api';
import {
  classifyVideosMultimodalBatch,
  type MultimodalVideoInput,
} from '@/lib/ai/classifier';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { channelId?: string; genreTags?: PrimaryGenreTag[] };
  try {
    body = (await request.json()) as {
      channelId?: string;
      genreTags?: PrimaryGenreTag[];
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ error: 'Thiếu channelId.' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Lấy bộ genre_tags hiện tại của kênh từ payload hoặc DB
  let allowedTags: PrimaryGenreTag[] = (body.genreTags ?? []).filter((t) =>
    PRIMARY_GENRE_OPTIONS.includes(t),
  );

  if (allowedTags.length === 0) {
    const { data: uc } = await admin
      .from('user_channels')
      .select('genre_tag, genre_tags')
      .eq('user_id', auth.userId)
      .eq('channel_id', channelId)
      .maybeSingle();

    const dbTags = (uc?.genre_tags ?? []).filter((t): t is PrimaryGenreTag =>
      PRIMARY_GENRE_OPTIONS.includes(t as PrimaryGenreTag),
    );
    if (dbTags.length > 0) {
      allowedTags = dbTags;
    } else if (
      uc?.genre_tag &&
      PRIMARY_GENRE_OPTIONS.includes(uc.genre_tag as PrimaryGenreTag)
    ) {
      allowedTags = [uc.genre_tag as PrimaryGenreTag];
    } else {
      allowedTags = ['HH2D'];
    }
  }

  // Lấy video hiện có của kênh trong DB (bỏ qua video đã khóa thủ công is_manual_tag = true)
  let existingVideos: Array<{
    video_id: string;
    title: string;
    description: string | null;
    thumbnail_url: string | null;
    duration_seconds: number;
    is_manual_tag?: boolean;
  }> = [];

  const withManualRes = await admin
    .from('videos')
    .select(
      'video_id, title, description, thumbnail_url, duration_seconds, is_manual_tag',
    )
    .eq('channel_id', channelId)
    .eq('is_short', false)
    .order('published_at', { ascending: false })
    .limit(50);

  if (withManualRes.error) {
    const fallbackRes = await admin
      .from('videos')
      .select('video_id, title, description, thumbnail_url, duration_seconds')
      .eq('channel_id', channelId)
      .eq('is_short', false)
      .order('published_at', { ascending: false })
      .limit(50);
    existingVideos = fallbackRes.data ?? [];
  } else {
    existingVideos = (withManualRes.data ?? []).filter((v) => !v.is_manual_tag);
  }

  // Thử lấy thêm snippet.tags mới nhất từ YouTube để tăng độ chính xác (nếu có YOUTUBE_API_KEY)
  const ytTagsByVideoId = new Map<
    string,
    { tags: string[]; visionThumb: string | null }
  >();
  if (process.env.YOUTUBE_API_KEY?.trim()) {
    try {
      const freshYt = await fetchChannelLatestVideos(channelId, 50);
      for (const v of freshYt) {
        ytTagsByVideoId.set(v.video_id, {
          tags: v.tags,
          visionThumb: v.vision_thumbnail_url,
        });
      }
    } catch {
      // Bỏ qua nếu YouTube hết quota, vẫn quét bằng dữ liệu DB + Thumbnail
    }
  }

  const targets: MultimodalVideoInput[] = existingVideos.map((v) => {
    const extra = ytTagsByVideoId.get(v.video_id);
    return {
      video_id: v.video_id,
      title: v.title,
      description: v.description,
      tags: extra?.tags ?? [],
      thumbnail_url: v.thumbnail_url,
      vision_thumbnail_url: extra?.visionThumb ?? v.thumbnail_url,
      duration_seconds: v.duration_seconds,
    };
  });

  if (targets.length === 0) {
    const workspaceData = await loadWorkspaceDataForUser(auth.userId);
    return NextResponse.json({
      reclassifiedCount: 0,
      channels: workspaceData.channels,
      videos: workspaceData.videos,
      totalVideosCount: workspaceData.totalVideosCount,
      hasMoreVideos: workspaceData.hasMoreVideos,
    });
  }

  if (allowedTags.length >= 2 && !process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu GEMINI_API_KEY trong .env.local.' },
      { status: 400 },
    );
  }

  const outcome = await classifyVideosMultimodalBatch(targets, allowedTags);

  if (outcome.geminiErrorCount > 0 && outcome.geminiSuccessCount === 0) {
    return NextResponse.json(
      {
        error: `Gemini Vision lỗi: ${outcome.lastErrorMessage || 'Không thể phân loại video.'}`,
      },
      { status: 502 },
    );
  }

  // Cập nhật kết quả phân loại mới vào bảng public.videos (bypass RLS bằng Admin Client)
  for (const video of targets) {
    const cls = outcome.results?.get(video.video_id);
    if (!cls || cls.source === 'fallback') continue;
    const { error: updateErr } = await admin
      .from('videos')
      .update({
        detected_genre: cls.detectedGenre,
        series_name: cls.seriesName,
        episode_number: cls.episodeNumber,
      })
      .eq('video_id', video.video_id);

    if (updateErr) {
      console.error(
        `[ReclassifyChannel] Lỗi update video ${video.video_id}:`,
        updateErr,
      );
    }
  }

  const workspaceData = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    reclassifiedCount: targets.length,
    channels: workspaceData.channels,
    videos: workspaceData.videos,
    totalVideosCount: workspaceData.totalVideosCount,
    hasMoreVideos: workspaceData.hasMoreVideos,
  });
}
