import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAdminEmail, isEmailAllowed } from '@/lib/auth/whitelist';
import type { Database } from '@/types/database';

const PUBLIC_PATHS = ['/login', '/auth/callback'];

function isBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/auth/check-whitelist') ||
    pathname.startsWith('/api/access-requests') ||
    pathname.startsWith('/auth/callback')
  );
}

function isPublicOrBypassPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return true;
  }
  return isBypassPath(pathname);
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, searchParams } = request.nextUrl;

  if (isBypassPath(pathname)) {
    return response;
  }

  const isWhitelisted = user?.email
    ? await isEmailAllowed(user.email, supabase)
    : false;
  const isAdmin = user?.email ? isAdminEmail(user.email) : false;

  // Xử lý trang /login (tránh redirect loop tuyệt đối)
  if (pathname === '/login') {
    if (!user) {
      return response;
    }

    if (isWhitelisted) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    if (searchParams.get('status') === 'unauthorized') {
      return response;
    }

    return NextResponse.redirect(
      new URL('/login?status=unauthorized', request.url),
    );
  }

  // Bảo vệ riêng khu vực Quản trị Admin (/admin và /api/admin/*)
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (!user) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (!isWhitelisted) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(
        new URL('/login?status=unauthorized', request.url),
      );
    }

    if (!isAdmin) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }

    return response;
  }

  // Các route bảo vệ khác (như /, /api/whitelist)
  if (!isPublicOrBypassPath(pathname)) {
    if (!user) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (!isWhitelisted) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(
        new URL('/login?status=unauthorized', request.url),
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
