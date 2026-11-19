import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

const DEFAULT_ADMIN_EMAIL = 'hoa590472@gmail.com';

export interface WhitelistCheckResult {
  allowed: boolean;
  isAdmin: boolean;
  email: string | null;
  userId: string | null;
}

/**
 * Lấy email Admin chuẩn hóa từ biến môi trường `ADMIN_EMAIL` (fallback `hoa590472@gmail.com`).
 */
export function getAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
}

/**
 * Kiểm tra xem email có phải là Admin của AniSub hay không.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === getAdminEmail();
}

/**
 * Kiểm tra một email có nằm trong bảng `allowed_emails` với `is_active = true` hay không.
 * Ưu tiên dùng `createAdminClient()` (SUPABASE_SERVICE_ROLE_KEY) để không bị RLS chặn,
 * đồng thời chuẩn hóa email bằng `.trim().toLowerCase()`.
 */
export async function isEmailAllowed(
  email: string,
  fallbackClient?: SupabaseClient<Database>,
): Promise<boolean> {
  if (!email) return false;

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  // Admin luôn được phép truy cập ngay lập tức (bỏ qua check bảng allowed_emails)
  if (isAdminEmail(normalizedEmail)) {
    return true;
  }

  const hasServiceRole = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );

  const supabase = hasServiceRole
    ? createAdminClient()
    : (fallbackClient ?? (await createClient()));

  const { data, error } = await supabase
    .from('allowed_emails')
    .select('email, is_active')
    .eq('is_active', true);

  if (error) {
    console.error('[AniSub Whitelist] Lỗi truy vấn allowed_emails:', {
      email: normalizedEmail,
      hasServiceRole,
      code: error.code,
      message: error.message,
      details: error.details,
    });
    return false;
  }

  return (data ?? []).some(
    (row) =>
      row.is_active === true &&
      row.email.trim().toLowerCase() === normalizedEmail,
  );
}

/**
 * Xác thực user hiện tại từ Supabase Auth VÀ kiểm tra quyền truy cập Whitelist (`allowed_emails`).
 */
export async function verifyWhitelistedUser(): Promise<WhitelistCheckResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    return { allowed: false, isAdmin: false, email: null, userId: null };
  }

  const allowed = await isEmailAllowed(user.email, supabase);
  const admin = isAdminEmail(user.email);

  return {
    allowed,
    isAdmin: allowed && admin,
    email: user.email,
    userId: allowed ? user.id : null,
  };
}

/**
 * Xác thực quyền Admin (đã đăng nhập, hợp lệ Whitelist và khớp `ADMIN_EMAIL`).
 */
export async function verifyAdminUser(): Promise<WhitelistCheckResult> {
  const result = await verifyWhitelistedUser();
  if (!result.allowed || !result.isAdmin) {
    return {
      allowed: false,
      isAdmin: false,
      email: result.email,
      userId: null,
    };
  }
  return result;
}
