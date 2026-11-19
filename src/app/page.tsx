import React from 'react';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { isAdminEmail, isEmailAllowed } from '@/lib/auth/whitelist';
import {
  UnifiedCinemaWorkspace,
  type InitialWorkspaceUser,
} from '@/components/workspace/UnifiedCinemaWorkspace';
import type { WorkspaceAuthStatus } from '@/types/workspace';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let authStatus: WorkspaceAuthStatus = 'unauthenticated';
  let initialUser: InitialWorkspaceUser | null = null;
  let isAdmin = false;
  let pendingRequestsCount = 0;

  const isSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (isSupabaseConfigured) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        const allowed = await isEmailAllowed(user.email, supabase);
        if (allowed) {
          authStatus = 'authenticated';
          isAdmin = isAdminEmail(user.email);

          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url, last_synced_at')
            .eq('id', user.id)
            .maybeSingle();

          const meta = user.user_metadata as
            | {
                full_name?: string;
                name?: string;
                avatar_url?: string;
                picture?: string;
              }
            | undefined;

          initialUser = {
            id: user.id,
            email: user.email,
            fullName: profile?.full_name ?? meta?.full_name ?? meta?.name ?? null,
            avatarUrl:
              profile?.avatar_url ?? meta?.avatar_url ?? meta?.picture ?? null,
            lastSyncedAt: profile?.last_synced_at ?? null,
          };

          if (isAdmin && process.env.SUPABASE_SERVICE_ROLE_KEY) {
            const admin = createAdminClient();
            const { count } = await admin
              .from('access_requests')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'pending');
            pendingRequestsCount = count ?? 0;
          }
        } else {
          authStatus = 'unauthorized_whitelist';
        }
      }
    } catch {
      authStatus = 'unauthenticated';
    }
  }

  return (
    <UnifiedCinemaWorkspace
      initialAuthStatus={authStatus}
      initialUser={initialUser}
      isAdmin={isAdmin}
      pendingRequestsCount={pendingRequestsCount}
    />
  );
}
