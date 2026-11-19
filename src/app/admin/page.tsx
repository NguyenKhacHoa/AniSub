import React from 'react';
import { redirect } from 'next/navigation';
import { verifyAdminUser } from '@/lib/auth/whitelist';
import { createAdminClient } from '@/lib/supabase/server';
import { AdminDashboardClient } from '@/components/admin/AdminDashboardClient';
import type { AccessRequestRow, AllowedEmailRow } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const auth = await verifyAdminUser();

  if (!auth.isAdmin || !auth.email) {
    redirect('/');
  }

  let initialRequests: AccessRequestRow[] = [];
  let initialWhitelist: AllowedEmailRow[] = [];

  try {
    const admin = createAdminClient();
    const [requestsRes, whitelistRes] = await Promise.all([
      admin
        .from('access_requests')
        .select('id, email, full_name, avatar_url, message, status, reviewed_at, created_at')
        .order('created_at', { ascending: false }),
      admin
        .from('allowed_emails')
        .select('email, note, is_active, created_at')
        .order('created_at', { ascending: false }),
    ]);

    initialRequests = requestsRes.data ?? [];
    initialWhitelist = whitelistRes.data ?? [];
  } catch {
    initialRequests = [];
    initialWhitelist = [];
  }

  return (
    <AdminDashboardClient
      adminEmail={auth.email}
      initialRequests={initialRequests}
      initialWhitelist={initialWhitelist}
    />
  );
}
