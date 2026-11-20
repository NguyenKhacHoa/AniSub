import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import type { UserSeriesStatus } from '@/types/database';

const VALID_STATUSES: UserSeriesStatus[] = ['following', 'completed', 'hidden'];

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

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
      return NextResponse.json(
        {
          error: isMissingTableError(error)
            ? 'Bảng user_series_status chưa được tạo trên Supabase.'
            : 'Không thể đồng bộ trạng thái bộ phim lên máy chủ.',
          code: isMissingTableError(error) ? 'TABLE_MISSING' : error.code,
        },
        { status: isMissingTableError(error) ? 503 : 500 },
      );
    }

    return NextResponse.json({ ok: true, seriesKey, status: null });
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
    return NextResponse.json(
      {
        error: isMissingTableError(error)
          ? 'Bảng user_series_status chưa được tạo trên Supabase.'
          : 'Không thể lưu trạng thái bộ phim lên Supabase.',
        code: isMissingTableError(error) ? 'TABLE_MISSING' : error.code,
      },
      { status: isMissingTableError(error) ? 503 : 500 },
    );
  }

  return NextResponse.json({ ok: true, seriesKey, status, updatedAt: nowIso });
}
