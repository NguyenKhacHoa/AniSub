import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  fetchUserSubscriptions,
  YouTubeApiError,
} from '@/lib/youtube/api';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export async function POST() {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId || !auth.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // Kiểm tra giới hạn cooldown 6 tiếng ở môi trường production
  if (process.env.NODE_ENV !== 'development') {
    const { data: profile } = await admin
      .from('profiles')
      .select('last_synced_at')
      .eq('id', auth.userId)
      .maybeSingle();

    if (profile?.last_synced_at) {
      const elapsed = Date.now() - new Date(profile.last_synced_at).getTime();
      if (elapsed < SIX_HOURS_MS) {
        const remainingMinutes = Math.ceil((SIX_HOURS_MS - elapsed) / 60000);
        return NextResponse.json(
          {
            code: 'COOLDOWN_ACTIVE',
            error: `Bạn vừa đồng bộ gần đây. Vui lòng thử lại sau khoảng ${remainingMinutes} phút để tiết kiệm YouTube Quota.`,
          },
          { status: 429 },
        );
      }
    }
  }

  // Lấy Google provider_token từ Supabase session hoặc HttpOnly cookie
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
          'Thiếu Google Access Token (provider_token đã hết hạn). Vui lòng Đăng xuất và Đăng nhập lại bằng Google để cấp quyền đọc danh sách kênh YouTube.',
      },
      { status: 401 },
    );
  }

  try {
    const ytChannels = await fetchUserSubscriptions(providerToken);
    const nowIso = new Date().toISOString();

    // Đảm bảo profile của user tồn tại trong public.profiles
    await admin.from('profiles').upsert(
      {
        id: auth.userId,
        email: auth.email.trim().toLowerCase(),
        last_synced_at: nowIso,
      },
      { onConflict: 'id' },
    );

    if (ytChannels.length > 0) {
      // 1. UPSERT danh sách kênh vào bảng dùng chung public.channels
      const channelPayload = ytChannels.map((ch) => ({
        channel_id: ch.channel_id,
        title: ch.title,
        thumbnail_url: ch.thumbnail_url,
        custom_url: ch.custom_url,
        updated_at: nowIso,
      }));

      const { error: channelsError } = await admin
        .from('channels')
        .upsert(channelPayload, { onConflict: 'channel_id' });

      if (channelsError) {
        console.error('[AniSub Sync] Lỗi upsert channels:', channelsError);
        return NextResponse.json(
          { error: 'Không thể lưu danh sách kênh vào cơ sở dữ liệu.' },
          { status: 500 },
        );
      }

      // 2. Tạo bản ghi mặc định trong public.user_channels (ignoreDuplicates để giữ nguyên lựa chọn cũ)
      const userChannelsPayload = ytChannels.map((ch) => ({
        user_id: auth.userId!,
        channel_id: ch.channel_id,
        is_selected: false,
        genre_tag: 'HH2D' as const,
      }));

      const { error: userChannelsError } = await admin
        .from('user_channels')
        .upsert(userChannelsPayload, {
          onConflict: 'user_id,channel_id',
          ignoreDuplicates: true,
        });

      if (userChannelsError) {
        console.error(
          '[AniSub Sync] Lỗi upsert user_channels:',
          userChannelsError,
        );
        return NextResponse.json(
          { error: 'Không thể liên kết kênh với tài khoản của bạn.' },
          { status: 500 },
        );
      }
    }

    const workspaceData = await loadWorkspaceDataForUser(auth.userId);

    return NextResponse.json({
      syncedCount: ytChannels.length,
      lastSyncedAt: nowIso,
      channels: workspaceData.channels,
      videos: workspaceData.videos,
    });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      if (err.status === 401 || err.reason === 'authError') {
        return NextResponse.json(
          {
            code: 'TOKEN_EXPIRED',
            error:
              'Token YouTube từ Google đã hết hạn. Vui lòng Đăng xuất và Đăng nhập lại bằng Google.',
          },
          { status: 401 },
        );
      }

      if (err.reason === 'quotaExceeded' || err.status === 403) {
        return NextResponse.json(
          {
            code: 'QUOTA_EXCEEDED',
            error:
              'YouTube Data API v3 đã hết hạn mức (Quota) hôm nay hoặc chưa cấp đủ quyền youtube.readonly.',
          },
          { status: 429 },
        );
      }

      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('[AniSub Sync] Lỗi không xác định:', err);
    return NextResponse.json(
      { error: 'Có lỗi xảy ra khi đồng bộ kênh từ YouTube.' },
      { status: 500 },
    );
  }
}
