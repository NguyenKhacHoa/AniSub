import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

/**
 * Tạo Supabase client dùng trong Server Components, Server Actions và Route Handlers.
 * Gắn cookie session của user để áp dụng Row Level Security (RLS).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Bỏ qua khi gọi từ Server Component (chỉ đọc cookie, middleware/route handler sẽ ghi).
          }
        },
      },
    },
  );
}

/**
 * Tạo Supabase Admin client dùng `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS).
 * CHỈ được phép dùng ở phía Server cho Webhook nền (/api/webhooks/youtube)
 * và Cron Job (/api/cron/renew-websub). Tuyệt đối không expose ra client.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() chỉ được phép chạy ở phía Server.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong biến môi trường.',
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
