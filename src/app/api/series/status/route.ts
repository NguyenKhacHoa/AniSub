import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import type { UserSeriesStatus } from '@/types/database';

const VALID_STATUSES: UserSeriesStatus[] = ['following', 'completed', 'hidden'];

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    channelId?: string;
    seriesKey?: string;
    status?: UserSeriesStatus | null;
  };
  try {
    body = (await request.json()) as {
      channelId?: string;
      seriesKey?: string;
      status?: UserSeriesStatus | null;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  const seriesKey = body.seriesKey?.trim();
  const status = body.status ?? null;

  if (!channelId || !seriesKey) {
    return NextResponse.json(
      { error: 'Thiếu channelId hoặc seriesKey.' },
      { status: 400 },
    );
  }

  if (status !== null && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: 'Trạng thái bộ phim không hợp lệ.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  if (status === null) {
    const { error } = await admin
      .from('user_series_status')
      .delete()
      .eq('user_id', auth.userId)
      .eq('series_key', seriesKey);

    if (error) {
      console.error('[SeriesStatus] Lỗi xóa trạng thái:', error);
      return NextResponse.json({
        seriesKey,
        status: null,
        warning:
          'Chưa tạo bảng user_series_status trong Supabase. Hãy chạy SQL trong docs/03-DATABASE.md để lưu bền vững.',
      });
    }

    return NextResponse.json({ seriesKey, status: null });
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin.from('user_series_status').upsert(
    {
      user_id: auth.userId,
      channel_id: channelId,
      series_key: seriesKey,
      status,
      updated_at: nowIso,
    },
    { onConflict: 'user_id,series_key' },
  );

  if (error) {
    console.error('[SeriesStatus] Lỗi upsert trạng thái:', error);
    return NextResponse.json({
      seriesKey,
      status,
      warning:
        'Chưa tạo bảng user_series_status trong Supabase. Hãy chạy SQL trong docs/03-DATABASE.md để lưu bền vững.',
    });
  }

  return NextResponse.json({ seriesKey, status, updatedAt: nowIso });
}
