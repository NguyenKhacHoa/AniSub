import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { syncAllChannelVideos } from '@/lib/youtube/channel-sync';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import type { PrimaryGenreTag } from '@/types/workspace';

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    channelId?: string;
    channelTitle?: string;
    channelThumbnail?: string | null;
  };
  try {
    body = (await request.json()) as {
      channelId?: string;
      channelTitle?: string;
      channelThumbnail?: string | null;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ error: 'Thiếu channelId.' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const cookieStore = await cookies();
  const providerToken =
    session?.provider_token || cookieStore.get('anisub_yt_token')?.value;

  if (!providerToken) {
    return NextResponse.json(
      {
        code: 'TOKEN_EXPIRED',
        error:
          'Phiên kết nối YouTube đã hết hạn. Vui lòng Đăng xuất và Đăng nhập lại bằng Google để cấp quyền đăng ký kênh (youtube.force-ssl).',
      },
      { status: 401 },
    );
  }

  // 1. Gọi YouTube Data API v3 đăng ký kênh trực tiếp lên tài khoản YouTube của user
  const subRes = await fetch(
    'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${providerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          resourceId: {
            kind: 'youtube#channel',
            channelId,
          },
        },
      }),
    },
  );

  let resolvedTitle = body.channelTitle?.trim() || channelId;
  let resolvedThumb = body.channelThumbnail ?? null;

  if (!subRes.ok) {
    const errData = (await subRes.json().catch(() => ({}))) as {
      error?: {
        code?: number;
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
    const reason = errData.error?.errors?.[0]?.reason ?? '';

    if (reason === 'subscriptionDuplicate') {
      // Kênh đã được đăng ký sẵn trên YouTube -> vẫn tiếp tục thêm vào AniSub bình thường
    } else if (
      subRes.status === 401 ||
      subRes.status === 403 ||
      reason === 'insufficientPermissions' ||
      reason === 'authError'
    ) {
      const res = NextResponse.json(
        {
          code: 'TOKEN_EXPIRED',
          error:
            'Google Token đã hết hạn hoặc chưa có quyền đăng ký kênh (youtube.force-ssl). Vui lòng Đăng xuất và Đăng nhập lại bằng Google.',
        },
        { status: 401 },
      );
      res.cookies.delete('anisub_yt_token');
      return res;
    } else {
      return NextResponse.json(
        {
          error:
            errData.error?.message ||
            `Không thể đăng ký kênh lên YouTube (HTTP ${subRes.status}).`,
        },
        { status: subRes.status },
      );
    }
  } else {
    const subData = (await subRes.json().catch(() => ({}))) as {
      snippet?: {
        title?: string;
        thumbnails?: {
          high?: { url?: string };
          medium?: { url?: string };
          default?: { url?: string };
        };
      };
    };
    if (subData.snippet?.title) resolvedTitle = subData.snippet.title;
    const ytThumb =
      subData.snippet?.thumbnails?.high?.url ||
      subData.snippet?.thumbnails?.medium?.url ||
      subData.snippet?.thumbnails?.default?.url;
    if (ytThumb) resolvedThumb = ytThumb;
  }

  // 2. Lưu vào public.channels + public.user_channels (is_selected = true, genre_tags = ['Phim AI', 'HH2D'])
  const admin = createAdminClient();
  const defaultTags: PrimaryGenreTag[] = ['Phim AI', 'HH2D'];
  const nowIso = new Date().toISOString();

  await admin.from('channels').upsert(
    {
      channel_id: channelId,
      title: resolvedTitle,
      thumbnail_url: resolvedThumb,
      updated_at: nowIso,
    },
    { onConflict: 'channel_id' },
  );

  const { error: ucErr } = await admin.from('user_channels').upsert(
    {
      user_id: auth.userId,
      channel_id: channelId,
      is_selected: true,
      genre_tag: 'Phim AI',
      genre_tags: defaultTags,
    },
    { onConflict: 'user_id,channel_id' },
  );

  if (ucErr) {
    await admin.from('user_channels').upsert(
      {
        user_id: auth.userId,
        channel_id: channelId,
        is_selected: true,
        genre_tag: 'Phim AI',
      },
      { onConflict: 'user_id,channel_id' },
    );
  }

  // 3. Kéo sạch 100% video của kênh vừa đăng ký (Full Channel Fetch + Series-Aware Gemini Vision)
  let fetchedVideosCount = 0;
  let newVideosCount = 0;
  try {
    const syncResult = await syncAllChannelVideos({
      channelId,
      genreTags: defaultTags,
    });
    fetchedVideosCount = syncResult.fetchedCount;
    newVideosCount = syncResult.newVideosCount;
  } catch (err) {
    console.error('[AniSub Subscribe] Lỗi đồng bộ toàn bộ video kênh mới:', err);
  }

  const workspaceData = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    subscribed: true,
    channelId,
    channelTitle: resolvedTitle,
    fetchedVideosCount,
    newVideosCount,
    channels: workspaceData.channels,
    videos: workspaceData.videos,
    totalVideosCount: workspaceData.totalVideosCount,
    hasMoreVideos: workspaceData.hasMoreVideos,
  });
}
