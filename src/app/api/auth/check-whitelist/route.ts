import { NextResponse } from 'next/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';

export async function GET() {
  const result = await verifyWhitelistedUser();
  return NextResponse.json({
    allowed: result.allowed,
    email: result.email,
  });
}
