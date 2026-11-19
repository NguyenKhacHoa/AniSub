import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { YouTubeApiError } from '@/lib/youtube/api';
import { syncAllChannelVideos } from '@/lib/youtube/channel-sync';
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

  // Lấy genre_tags hiện tại của kênh
  let genreTags: PrimaryGenreTag[] = (body.genreTags ?? []).filter((t) =>
    PRIMARY_GENRE_OPTIONS.includes(t),
  );

  if (genreTags.length === 0) {
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
      genreTags = dbTags;
    } else if (
      uc?.genre_tag &&
      PRIMARY_GENRE_OPTIONS.includes(uc.genre_tag as PrimaryGenreTag)
    ) {
      genreTags = [uc.genre_tag as PrimaryGenreTag];
    } else {
      genreTags = ['HH2D'];
    }
  }

  try {
    const syncResult = await syncAllChannelVideos({
      channelId,
      genreTags,
    });

    const workspaceData = await loadWorkspaceDataForUser(auth.userId);

    return NextResponse.json({
      channelId,
      fetchedCount: syncResult.fetchedCount,
      newVideosCount: syncResult.newVideosCount,
      aiClassifiedCount: syncResult.aiClassifiedCount,
      hasMoreChannelVideos: Boolean(syncResult.nextPageToken),
      warning: syncResult.warning,
      channels: workspaceData.channels,
      videos: workspaceData.videos,
      totalVideosCount: workspaceData.totalVideosCount,
      hasMoreVideos: workspaceData.hasMoreVideos,
    });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[LoadMoreChannel] Lỗi kéo thêm 50 video cũ:', err);
    return NextResponse.json(
      { error: 'Không thể kéo thêm video cũ cho kênh này.' },
      { status: 500 },
    );
  }
}
