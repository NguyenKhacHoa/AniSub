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
    introSeconds?: number | null;
    outroSeconds?: number | null;
  };
  try {
    body = (await request.json()) as {
      channelId?: string;
      seriesKey?: string;
      status?: UserSeriesStatus | null;
      introSeconds?: number | null;
      outroSeconds?: number | null;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  const seriesKey = body.seriesKey?.trim();
  const status = body.status ?? null;
  const hasSkipUpdate =
    typeof body.introSeconds === 'number' ||
    typeof body.outroSeconds === 'number';
  const safeIntro =
    typeof body.introSeconds === 'number' && Number.isFinite(body.introSeconds)
      ? Math.max(0, Math.min(600, Math.floor(body.introSeconds)))
      : undefined;
  const safeOutro =
    typeof body.outroSeconds === 'number' && Number.isFinite(body.outroSeconds)
      ? Math.max(0, Math.min(600, Math.floor(body.outroSeconds)))
      : undefined;

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

  // Nếu chỉ lưu cài đặt Bỏ Intro / Outro mà không đổi status
  if (hasSkipUpdate && body.status === undefined) {
    const nowIso = new Date().toISOString();
    const { data: existingRow } = await admin
      .from('user_series_status')
      .select('status')
      .eq('user_id', auth.userId)
      .eq('series_key', seriesKey)
      .maybeSingle();

    const targetStatus: UserSeriesStatus =
      existingRow?.status && VALID_STATUSES.includes(existingRow.status as UserSeriesStatus)
        ? (existingRow.status as UserSeriesStatus)
        : 'following';

    const { error } = await admin.from('user_series_status').upsert(
      {
        user_id: auth.userId,
        channel_id: channelId,
        series_key: seriesKey,
        status: targetStatus,
        ...(safeIntro !== undefined ? { intro_seconds: safeIntro } : {}),
        ...(safeOutro !== undefined ? { outro_seconds: safeOutro } : {}),
        updated_at: nowIso,
      } as never,
      { onConflict: 'user_id,series_key' },
    );

    if (error) {
      // Nếu DB chưa thêm cột intro_seconds / outro_seconds thì vẫn trả ok (client đã lưu trên localStorage)
      return NextResponse.json({
        ok: true,
        seriesKey,
        introSeconds: safeIntro ?? 0,
        outroSeconds: safeOutro ?? 0,
        localOnly: true,
      });
    }

    return NextResponse.json({
      ok: true,
      seriesKey,
      introSeconds: safeIntro ?? 0,
      outroSeconds: safeOutro ?? 0,
      updatedAt: nowIso,
    });
  }

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
