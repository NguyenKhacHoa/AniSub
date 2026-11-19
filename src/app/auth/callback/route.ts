import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isEmailAllowed } from '@/lib/auth/whitelist';
import type { Database } from '@/types/database';

function resolveEffectiveOrigin(request: Request): string {
  const { origin } = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';

  if (process.env.NODE_ENV !== 'development' && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const effectiveOrigin = resolveEffectiveOrigin(request);

  const oauthError = searchParams.get('error');
  const oauthErrorDesc = searchParams.get('error_description');
  if (oauthError) {
    console.error('[AuthCallback] OAuth provider error:', {
      oauthError,
      oauthErrorDesc,
    });
    const reason = oauthErrorDesc || oauthError;
    return NextResponse.redirect(
      `${effectiveOrigin}/login?error=auth_failed&reason=${encodeURIComponent(reason)}`,
    );
  }

  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const safeNext =
    next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(
      `${effectiveOrigin}/login?error=missing_code`,
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(
      `${effectiveOrigin}/login?error=auth_failed&reason=${encodeURIComponent('Thiếu cấu hình Supabase trên server.')}`,
    );
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(`${effectiveOrigin}${safeNext}`);
  const pendingCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Bỏ qua nếu cookieStore không hỗ trợ ghi trực tiếp trong ngữ cảnh hiện tại
          }
          pendingCookies.push({ name, value, options });
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: exchangeData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error('[AuthCallback] exchangeCodeForSession failed:', {
      message: exchangeError.message,
      status: exchangeError.status,
      code: exchangeError.code,
    });
    return NextResponse.redirect(
      `${effectiveOrigin}/login?error=auth_failed&reason=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  const user =
    exchangeData.user ?? (await supabase.auth.getUser()).data.user ?? null;

  if (!user?.email) {
    console.error('[AuthCallback] Missing user email after PKCE exchange');
    return NextResponse.redirect(
      `${effectiveOrigin}/login?error=auth_failed&reason=${encodeURIComponent('Không đọc được email tài khoản Google sau khi xác thực.')}`,
    );
  }

  const allowed = await isEmailAllowed(user.email, supabase);
  const providerToken = exchangeData.session?.provider_token;

  const attachProviderToken = (res: NextResponse) => {
    if (providerToken) {
      res.cookies.set('anisub_yt_token', providerToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 3500, // ~58 phút (thời hạn access token Google OAuth)
      });
    }
  };

  if (!allowed) {
    const unauthorizedResponse = NextResponse.redirect(
      `${effectiveOrigin}/login?status=unauthorized`,
    );
    // Sao chép toàn bộ cookie session PKCE sang response redirect để /login nhận ngay phiên user
    pendingCookies.forEach(({ name, value, options }) => {
      unauthorizedResponse.cookies.set(name, value, options);
    });
    attachProviderToken(unauthorizedResponse);
    return unauthorizedResponse;
  }

  attachProviderToken(response);
  return response;
}
