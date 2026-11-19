import { NextResponse } from 'next/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  DEFAULT_FEED_PAGE_SIZE,
  loadWorkspaceDataForUser,
} from '@/lib/workspace/loader';

export async function GET(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const offset = Number(searchParams.get('offset') ?? 0) || 0;
  const limit =
    Number(searchParams.get('limit') ?? DEFAULT_FEED_PAGE_SIZE) ||
    DEFAULT_FEED_PAGE_SIZE;

  const data = await loadWorkspaceDataForUser(auth.userId, { offset, limit });
  return NextResponse.json(data);
}
