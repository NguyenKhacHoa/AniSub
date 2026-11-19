'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Clapperboard,
  ShieldAlert,
  Lock,
  LogOut,
  Palette,
  Loader2,
  Send,
  Clock,
  RefreshCw,
  UserCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ANISUB_THEMES,
  useTheme,
} from '@/components/providers/ThemeProvider';
import { createClient } from '@/lib/supabase/client';
import type { AccessRequestRow } from '@/types/database';

interface GoogleUserInfo {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function LoginGateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { themeMeta, cycleTheme } = useTheme();

  const isUnauthorizedParam = searchParams.get('status') === 'unauthorized';
  const errorParam = searchParams.get('error');

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [sessionUser, setSessionUser] = useState<GoogleUserInfo | null>(null);
  const [accessRequest, setAccessRequest] = useState<AccessRequestRow | null>(
    null,
  );
  const [requestMessage, setRequestMessage] = useState<string>('');
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState<boolean>(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState<boolean>(false);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  const isSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  const supabase = useMemo(
    () => (isSupabaseConfigured ? createClient() : null),
    [isSupabaseConfigured],
  );

  useEffect(() => {
    let active = true;

    async function loadUserSession() {
      if (!supabase) {
        if (active) setIsCheckingSession(false);
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!active) return;

        if (!user?.email) {
          setSessionUser(null);
          setAccessRequest(null);
          return;
        }

        const meta = user.user_metadata as
          | {
              full_name?: string;
              name?: string;
              avatar_url?: string;
              picture?: string;
            }
          | undefined;

        setSessionUser({
          email: user.email,
          fullName: meta?.full_name ?? meta?.name ?? null,
          avatarUrl: meta?.avatar_url ?? meta?.picture ?? null,
        });

        const res = await fetch('/api/access-requests');
        if (res.ok && active) {
          const payload = (await res.json()) as {
            allowed?: boolean;
            request?: AccessRequestRow | null;
          };

          if (payload.allowed) {
            routerRef.current.replace('/');
            routerRef.current.refresh();
            return;
          }

          setAccessRequest(payload.request ?? null);
        }
      } catch {
        // Ignore when env is not ready
      } finally {
        if (active) setIsCheckingSession(false);
      }
    }

    void loadUserSession();
    return () => {
      active = false;
    };
  }, [isUnauthorizedParam, supabase]);

  useEffect(() => {
    if (errorParam === 'auth_failed') {
      toast.error('Xác thực Google không thành công. Vui lòng thử lại.');
    } else if (errorParam === 'missing_code') {
      toast.warning('Thiếu mã xác thực OAuth từ Google.');
    }
  }, [errorParam]);

  const isUnauthorizedState = isUnauthorizedParam || Boolean(sessionUser);

  const handleGoogleLogin = async () => {
    if (!supabase) {
      toast.error(
        'Chưa cấu hình NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local.',
      );
      return;
    }

    setIsSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes:
            'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) {
        toast.error(`Lỗi đăng nhập Google: ${error.message}`);
        setIsSigningIn(false);
      }
    } catch {
      toast.error('Không thể khởi tạo phiên đăng nhập Google.');
      setIsSigningIn(false);
    }
  };

  const handleSubmitAccessRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionUser) return;

    setIsSubmittingRequest(true);
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: requestMessage.trim() || undefined,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        request?: AccessRequestRow;
        error?: string;
      };

      if (!res.ok || !payload.request) {
        toast.error(payload.error || 'Không thể gửi đơn xin cấp quyền.');
        return;
      }

      setAccessRequest(payload.request);
      setRequestMessage('');
      toast.success('Đã gửi đơn xin cấp quyền thành công!');
    } catch {
      toast.error('Lỗi kết nối khi gửi đơn xin cấp quyền.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleRecheckStatus = async () => {
    setIsRefreshingStatus(true);
    try {
      const res = await fetch('/api/access-requests');
      if (!res.ok) {
        toast.error('Không thể kiểm tra trạng thái lúc này.');
        return;
      }

      const payload = (await res.json()) as {
        allowed?: boolean;
        request?: AccessRequestRow | null;
      };

      if (payload.allowed) {
        toast.success('Tài khoản đã được phê duyệt! Đang vào rạp phim...');
        router.replace('/');
        router.refresh();
        return;
      }

      setAccessRequest(payload.request ?? null);
      if (payload.request?.status === 'rejected') {
        toast.warning('Đơn xin cấp quyền của bạn đã bị từ chối.');
      } else {
        toast.info('Đơn vẫn đang chờ Admin phê duyệt.');
      }
    } catch {
      toast.error('Lỗi kết nối khi kiểm tra trạng thái.');
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      setSessionUser(null);
      setAccessRequest(null);
      router.replace('/login');
      router.refresh();
      toast.info('Đã đăng xuất. Bạn có thể chọn tài khoản Google khác.');
    } catch {
      toast.error('Lỗi khi đăng xuất.');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center bg-[var(--bg-canvas)] px-4 py-10 sm:px-6">
      {/* Nút đổi nhanh Theme ở góc trên phải */}
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <button
          type="button"
          onClick={cycleTheme}
          title={`Đổi giao diện (${ANISUB_THEMES.map((t) => t.label).join(' / ')})`}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <Palette className="size-4 text-[var(--accent-primary)]" />
          <span>{themeMeta.label}</span>
        </button>
      </div>

      {/* Thẻ Cổng Đăng Nhập */}
      <section className="w-full max-w-md rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8">
        {/* Header Logo */}
        <div className="flex items-center gap-3.5">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-primary)] text-[var(--accent-foreground)]">
            <Clapperboard className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
              AniSub Cinema
            </h1>
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              Unified Cinema Workspace
            </p>
          </div>
        </div>

        {isCheckingSession ? (
          <div className="mt-8 flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Loader2 className="size-6 animate-spin text-[var(--accent-primary)]" />
            <p className="text-sm text-[var(--text-secondary)]">
              Đang kiểm tra phiên đăng nhập...
            </p>
          </div>
        ) : isUnauthorizedState && sessionUser ? (
          <div className="mt-6">
            {/* Thông tin tài khoản Google vừa đăng nhập */}
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
              {sessionUser.avatarUrl ? (
                <Image
                  src={sessionUser.avatarUrl}
                  alt={sessionUser.fullName || sessionUser.email}
                  width={42}
                  height={42}
                  className="size-10.5 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <UserCircle2 className="size-10 shrink-0 text-[var(--text-secondary)]" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {sessionUser.fullName || 'Người dùng Google'}
                </p>
                <p className="truncate font-mono text-xs text-[var(--text-secondary)]">
                  {sessionUser.email}
                </p>
              </div>
            </div>

            {accessRequest?.status === 'pending' ? (
              /* TRẠNG THÁI 2B: Đã gửi đơn (pending) */
              <div className="mt-4">
                <div className="flex items-start gap-3 rounded-xl border border-[var(--accent-primary)]/40 bg-[var(--accent-soft)] p-4">
                  <Clock className="mt-0.5 size-5 shrink-0 text-[var(--accent-primary)]" />
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Đã gửi yêu cầu — Đang chờ Admin phê duyệt
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                      Thời gian gửi:{' '}
                      <span className="font-medium tabular-nums text-[var(--text-primary)]">
                        {formatDateTime(accessRequest.created_at)}
                      </span>
                    </p>
                    {accessRequest.message && (
                      <p className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-xs text-[var(--text-secondary)]">
                        &ldquo;{accessRequest.message}&rdquo;
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2.5">
                  <Button
                    type="button"
                    onClick={handleRecheckStatus}
                    disabled={isRefreshingStatus}
                    className="h-11 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                  >
                    <RefreshCw
                      className={`mr-2 size-4 ${isRefreshingStatus ? 'animate-spin' : ''}`}
                    />
                    <span>Kiểm tra lại trạng thái</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="h-10 w-full rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <LogOut className="mr-2 size-3.5" />
                    <span>Đăng xuất / Đổi tài khoản</span>
                  </Button>
                </div>
              </div>
            ) : accessRequest?.status === 'rejected' ? (
              /* TRẠNG THÁI 2C: Bị từ chối (rejected) */
              <div className="mt-4">
                <div className="flex items-start gap-3 rounded-xl border border-rose-500/35 bg-rose-500/10 p-4">
                  <XCircle className="mt-0.5 size-5 shrink-0 text-rose-500 dark:text-rose-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Yêu cầu truy cập chưa được chấp thuận
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)] text-pretty">
                      Rất tiếc, đơn xin cấp quyền của tài khoản này hiện chưa
                      được duyệt vào không gian rạp chiếu cá nhân AniSub. Bạn có
                      thể liên hệ trực tiếp Admin hoặc thử tài khoản Google
                      khác.
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="mt-5 h-11 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                >
                  {isSigningOut ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 size-4" />
                  )}
                  <span>Đăng xuất / Đổi tài khoản</span>
                </Button>
              </div>
            ) : (
              /* TRẠNG THÁI 2A: Chưa gửi đơn -> Form gửi đơn xin cấp quyền */
              <form onSubmit={handleSubmitAccessRequest} className="mt-4">
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500 dark:text-amber-400" />
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)] text-pretty">
                    Tài khoản của bạn chưa có trong danh sách Whitelist. Gửi đơn
                    ngay để Admin duyệt chỉ với 1 chạm.
                  </p>
                </div>

                <div className="mt-4">
                  <label
                    htmlFor="access-request-message"
                    className="block text-xs font-medium text-[var(--text-primary)]"
                  >
                    Lời nhắn ngắn cho Admin (tùy chọn)
                  </label>
                  <Input
                    id="access-request-message"
                    type="text"
                    maxLength={300}
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Mình là bạn của Hòa, xin vào xem phim chung..."
                    className="mt-1.5 h-11 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                  />
                </div>

                <div className="mt-4 flex flex-col gap-2.5">
                  <Button
                    type="submit"
                    disabled={isSubmittingRequest}
                    className="h-11 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-semibold text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                  >
                    {isSubmittingRequest ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 size-4" />
                    )}
                    <span>Gửi đơn xin cấp quyền</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="h-10 w-full rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <LogOut className="mr-2 size-3.5" />
                    <span>Đăng xuất / Đổi tài khoản</span>
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          /* TRẠNG THÁI 1: Chưa đăng nhập */
          <div className="mt-6">
            <p className="text-sm leading-relaxed text-[var(--text-secondary)] text-pretty">
              Rạp chiếu phim hoạt hình cá nhân hóa từ kênh đăng ký YouTube của
              bạn.
            </p>

            <Button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isSigningIn}
              className="mt-6 h-12 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 cursor-pointer"
            >
              {isSigningIn ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <svg
                  className="mr-2.5 size-4 shrink-0"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.81-1.5 3.34-3.2 4.37v3.62h5.18c3.03-2.79 4.78-6.9 4.78-11.8 0-.8-.08-1.57-.2-1.92Z"
                  />
                  <path
                    fill="currentColor"
                    d="M12.18 22c4.32 0 7.95-1.43 10.6-3.88l-5.18-3.62c-1.43.96-3.26 1.53-5.42 1.53-4.17 0-7.7-2.81-8.96-6.6H-2.1v3.73C.54 18.4 5.94 22 12.18 22Z"
                  />
                </svg>
              )}
              <span>
                {isSigningIn
                  ? 'Đang chuyển tới Google...'
                  : 'Đăng nhập bằng Google'}
              </span>
            </Button>

            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
              <Lock className="mt-0.5 size-4 shrink-0 text-[var(--accent-primary)]" />
              <div className="text-xs leading-relaxed text-[var(--text-secondary)] text-pretty">
                <p className="font-medium text-[var(--text-primary)]">
                  Quyền chỉ đọc YouTube (youtube.readonly)
                </p>
                <p className="mt-0.5">
                  Chỉ dùng để đồng bộ danh sách kênh bạn đã đăng ký và xác minh
                  quyền truy cập AniSub.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--bg-canvas)] text-sm text-[var(--text-secondary)]">
          Đang tải cổng đăng nhập AniSub...
        </div>
      }
    >
      <LoginGateContent />
    </Suspense>
  );
}
