import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { YouTubeApiError } from '@/lib/youtube/api';
import { syncChannelVideosChunk } from '@/lib/youtube/channel-sync';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

export const maxDuration = 30;

/**
 * POST /api/channels/sync — Cursor-Based Chunked Channel Sync
 * Kéo tối đa 4 trang `playlistItems.list` (~200 video/lượt, chạy gọn < 4 giây), lưu ngay vào Supabase,
 * trả về `{ hasMore, nextPageToken, fetchedCount, newVideosCount, isFullySynced }` để client gọi cuốn chiếu tới Tập 1
 * mà không bao giờ bị timeout Vercel.
 */
export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    channelId?: string;
    genreTags?: PrimaryGenreTag[];
    pageToken?: string | null;
    resetCursor?: boolean;
    maxPages?: number;
  };
  try {
    body = (await request.json()) as {
      channelId?: string;
      genreTags?: PrimaryGenreTag[];
      pageToken?: string | null;
      resetCursor?: boolean;
      maxPages?: number;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ error: 'Thiếu channelId.' }, { status: 400 });
  }

  const admin = createAdminClient();
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
    const result = await syncChannelVideosChunk({
      channelId,
      genreTags,
      pageToken: body.pageToken ?? null,
      resetCursor: body.resetCursor === true,
      maxPages: body.maxPages ?? 4,
    });

    return NextResponse.json({
      ok: true,
      channelId,
      hasMore: result.hasMore,
      nextPageToken: result.nextPageToken,
      fetchedCount: result.fetchedCount,
      newVideosCount: result.newVideosCount,
      pagesFetched: result.pagesFetched,
      isFullySynced: result.isFullySynced,
      warning: result.warning,
    });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[ChannelChunkSync] Lỗi đồng bộ cụm kênh:', err);
    return NextResponse.json(
      { error: 'Không thể đồng bộ cụm video cho kênh này.' },
      { status: 500 },
    );
  }
}
