import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Tạo Supabase client dùng ở phía Browser (Client Components).
 * Mọi truy vấn qua client này đều tự động gắn JWT của user và áp dụng RLS.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
