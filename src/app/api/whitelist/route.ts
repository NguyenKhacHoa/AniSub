import { NextResponse } from 'next/server';
import { verifyAdminUser } from '@/lib/auth/whitelist';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  const auth = await verifyAdminUser();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('allowed_emails')
    .select('email, note, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: 'Không thể tải danh sách Whitelist.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ emails: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await verifyAdminUser();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { email?: string; note?: string };
  try {
    body = (await request.json()) as { email?: string; note?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalizedEmail = body.email?.trim().toLowerCase() ?? '';
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return NextResponse.json(
      { error: 'Địa chỉ email không hợp lệ.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('allowed_emails')
    .upsert(
      {
        email: normalizedEmail,
        note: body.note?.trim() || null,
        is_active: true,
      },
      { onConflict: 'email' },
    )
    .select('email, note, is_active, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Không thể thêm email vào Whitelist.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ item: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await verifyAdminUser();
  if (!auth.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { email?: string; is_active?: boolean };
  try {
    body = (await request.json()) as { email?: string; is_active?: boolean };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalizedEmail = body.email?.trim().toLowerCase() ?? '';
  if (!normalizedEmail || typeof body.is_active !== 'boolean') {
    return NextResponse.json(
      { error: 'Thiếu email hoặc trạng thái is_active.' },
      { status: 400 },
    );
  }

  if (
    auth.email &&
    normalizedEmail === auth.email.trim().toLowerCase() &&
    !body.is_active
  ) {
    return NextResponse.json(
      { error: 'Không thể tự tắt quyền truy cập của chính bạn.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('allowed_emails')
    .update({ is_active: body.is_active })
    .eq('email', normalizedEmail)
    .select('email, note, is_active, created_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'Không thể cập nhật trạng thái Whitelist.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ item: data });
}
