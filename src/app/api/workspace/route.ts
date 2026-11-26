import { NextResponse } from 'next/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await loadWorkspaceDataForUser(auth.userId);
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
