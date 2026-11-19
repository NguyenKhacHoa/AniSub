import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { isEmailAllowed } from '@/lib/auth/whitelist';

/**
 * GET /api/access-requests
 * Dành cho user đã đăng nhập Google (kể cả chưa có trong allowed_emails)
 * để kiểm tra xem họ đã được duyệt chưa hoặc đơn xin duyệt đang ở trạng thái nào.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const allowed = await isEmailAllowed(normalizedEmail, supabase);

  const admin = createAdminClient();
  const { data: requestRow } = await admin
    .from('access_requests')
    .select('id, email, full_name, avatar_url, message, status, reviewed_at, created_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  return NextResponse.json({
    allowed,
    email: normalizedEmail,
    request: requestRow ?? null,
  });
}

/**
 * POST /api/access-requests
 * Gửi đơn xin cấp quyền truy cập AniSub (lưu vào bảng `access_requests` với status = 'pending').
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { message?: string } = {};
  try {
    body = (await request.json()) as { message?: string };
  } catch {
    body = {};
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const meta = user.user_metadata as
    | { full_name?: string; name?: string; avatar_url?: string; picture?: string }
    | undefined;

  const fullName = meta?.full_name ?? meta?.name ?? null;
  const avatarUrl = meta?.avatar_url ?? meta?.picture ?? null;
  const message = body.message?.trim().slice(0, 300) || null;

  const admin = createAdminClient();

  // Kiểm tra nếu đã có đơn bị từ chối hoặc đang chờ
  const { data: existing } = await admin
    .from('access_requests')
    .select('id, status')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing?.status === 'rejected') {
    return NextResponse.json(
      { error: 'Yêu cầu trước đó của tài khoản này đã bị từ chối.' },
      { status: 403 },
    );
  }

  const { data, error } = await admin
    .from('access_requests')
    .upsert(
      {
        email: normalizedEmail,
        full_name: fullName,
        avatar_url: avatarUrl,
        message,
        status: 'pending',
        reviewed_at: null,
      },
      { onConflict: 'email' },
    )
    .select('id, email, full_name, avatar_url, message, status, reviewed_at, created_at')
    .single();

  if (error) {
    console.error('[AniSub AccessRequest] Lỗi lưu đơn:', error);
    return NextResponse.json(
      {
        error:
          'Không thể gửi đơn lúc này. Hãy đảm bảo bảng public.access_requests đã được tạo trên Supabase.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ request: data }, { status: 201 });
}
