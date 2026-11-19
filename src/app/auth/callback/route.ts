import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEmailAllowed } from '@/lib/auth/whitelist';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const safeNext =
    next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data: exchangeData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

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

  const allowed = await isEmailAllowed(user.email, supabase);
  const redirectUrl = allowed
    ? `${origin}${safeNext}`
    : `${origin}/login?status=unauthorized`;

  const response = NextResponse.redirect(redirectUrl);

  // Lưu provider_token vào HttpOnly cookie để API /api/youtube/sync-channels sử dụng tin cậy
  const providerToken = exchangeData.session?.provider_token;
  if (providerToken) {
    response.cookies.set('anisub_yt_token', providerToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 3500, // ~58 phút (thời hạn access token Google OAuth)
    });
  }

  return response;
}
