import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEmailAllowed } from '@/lib/auth/whitelist';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const allowed = await isEmailAllowed(user.email);
  if (!allowed) {
    return NextResponse.redirect(`${origin}/login?status=unauthorized`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
