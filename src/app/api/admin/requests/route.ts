import { NextResponse } from 'next/server';
import { verifyAdminUser } from '@/lib/auth/whitelist';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/requests
 * Chỉ Admin mới được phép lấy danh sách đơn xin cấp quyền.
 */
export async function GET() {
  const auth = await verifyAdminUser();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('access_requests')
    .select('id, email, full_name, avatar_url, message, status, reviewed_at, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Không thể tải danh sách đơn xin cấp quyền.' },
      { status: 500 },
    );
  }

  const requests = data ?? [];
  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return NextResponse.json({ requests, pendingCount });
}

/**
 * PATCH /api/admin/requests
 * Phê duyệt 1 chạm (status = 'approved' + UPSERT allowed_emails với is_active = true)
 * hoặc Từ chối (status = 'rejected').
 */
export async function PATCH(request: Request) {
  const auth = await verifyAdminUser();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { id?: string; action?: 'approve' | 'reject' };
  try {
    body = (await request.json()) as { id?: string; action?: 'approve' | 'reject' };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.id || (body.action !== 'approve' && body.action !== 'reject')) {
    return NextResponse.json(
      { error: 'Thiếu id hoặc action (approve / reject).' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: target, error: findError } = await admin
    .from('access_requests')
    .select('id, email, full_name, avatar_url, message, status')
    .eq('id', body.id)
    .maybeSingle();

  if (findError || !target) {
    return NextResponse.json(
      { error: 'Không tìm thấy đơn xin cấp quyền.' },
      { status: 404 },
    );
  }

  const nextStatus = body.action === 'approve' ? 'approved' : 'rejected';
  const nowIso = new Date().toISOString();

  const { data: updatedRequest, error: updateError } = await admin
    .from('access_requests')
    .update({ status: nextStatus, reviewed_at: nowIso })
    .eq('id', body.id)
    .select('id, email, full_name, avatar_url, message, status, reviewed_at, created_at')
    .single();

  if (updateError) {
    return NextResponse.json(
      { error: 'Không thể cập nhật trạng thái đơn.' },
      { status: 500 },
    );
  }

  let whitelistedItem = null;

  if (body.action === 'approve') {
    // Luôn lấy đúng email từ bản ghi access_requests (target.email), tuyệt đối không dùng session Admin
    const applicantEmail = target.email.trim().toLowerCase();
    const { data: upsertedEmail, error: upsertError } = await admin
      .from('allowed_emails')
      .upsert(
        {
          email: applicantEmail,
          note: target.full_name
            ? `${target.full_name} (Duyệt qua đơn)`
            : 'Duyệt qua đơn xin cấp quyền',
          is_active: true,
        },
        { onConflict: 'email' },
      )
      .select('email, note, is_active, created_at')
      .single();

    if (upsertError) {
      return NextResponse.json(
        { error: 'Đã cập nhật đơn nhưng không thể thêm vào allowed_emails.' },
        { status: 500 },
      );
    }

    whitelistedItem = upsertedEmail;
  }

  return NextResponse.json({
    request: updatedRequest,
    whitelistedItem,
  });
}
