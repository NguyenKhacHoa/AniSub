'use client';

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  Shield,
  Check,
  X,
  UserPlus,
  Users,
  Clock,
  Palette,
  Loader2,
  UserCircle2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/components/providers/ThemeProvider';
import type { AccessRequestRow, AllowedEmailRow } from '@/types/database';

interface AdminDashboardClientProps {
  adminEmail: string;
  initialRequests: AccessRequestRow[];
  initialWhitelist: AllowedEmailRow[];
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

export function AdminDashboardClient({
  adminEmail,
  initialRequests,
  initialWhitelist,
}: AdminDashboardClientProps) {
  const { themeMeta, cycleTheme } = useTheme();

  const [requests, setRequests] = useState<AccessRequestRow[]>(initialRequests);
  const [whitelist, setWhitelist] =
    useState<AllowedEmailRow[]>(initialWhitelist);
  const [processingAction, setProcessingAction] = useState<{
    id: string;
    action: 'approve' | 'reject';
  } | null>(null);
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);
  const [isRefreshingRequests, setIsRefreshingRequests] = useState(false);

  const handleRefreshRequests = async () => {
    setIsRefreshingRequests(true);
    try {
      const res = await fetch('/api/admin/requests');
      const payload = (await res.json().catch(() => ({}))) as {
        requests?: AccessRequestRow[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(payload.error || 'Không thể tải lại danh sách đơn.');
        return;
      }
      if (Array.isArray(payload.requests)) {
        setRequests(payload.requests);
        toast.success('Đã cập nhật danh sách đơn mới nhất.');
      }
    } catch {
      toast.error('Lỗi kết nối khi làm mới danh sách đơn.');
    } finally {
      setIsRefreshingRequests(false);
    }
  };

  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isAddingEmail, setIsAddingEmail] = useState(false);

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === 'pending'),
    [requests],
  );

  const processedRequests = useMemo(
    () => requests.filter((r) => r.status !== 'pending'),
    [requests],
  );

  const activeWhitelistCount = useMemo(
    () => whitelist.filter((w) => w.is_active).length,
    [whitelist],
  );

  const handleReviewRequest = async (
    id: string,
    action: 'approve' | 'reject',
  ) => {
    setProcessingAction({ id, action });
    try {
      const res = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        request?: AccessRequestRow;
        whitelistedItem?: AllowedEmailRow | null;
        error?: string;
      };

      if (!res.ok || !payload.request) {
        toast.error(payload.error || 'Không thể xử lý đơn xin cấp quyền.');
        return;
      }

      setRequests((prev) =>
        prev.map((row) => (row.id === id ? payload.request! : row)),
      );

      if (action === 'approve' && payload.whitelistedItem) {
        const added = payload.whitelistedItem;
        setWhitelist((prev) => {
          const exists = prev.some((w) => w.email === added.email);
          return exists
            ? prev.map((w) => (w.email === added.email ? added : w))
            : [added, ...prev];
        });
        toast.success(`Đã phê duyệt & cấp quyền cho ${added.email}`);
      } else {
        toast.info(`Đã từ chối đơn của ${payload.request.email}`);
      }
    } catch {
      toast.error('Lỗi kết nối khi xử lý đơn.');
    } finally {
      setProcessingAction(null);
    }
  };

  const handleAddWhitelistEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = newEmail.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      toast.warning('Vui lòng nhập email hợp lệ.');
      return;
    }

    setIsAddingEmail(true);
    try {
      const res = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          note: newNote.trim() || undefined,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        item?: AllowedEmailRow;
        error?: string;
      };

      if (!res.ok || !payload.item) {
        toast.error(payload.error || 'Không thể thêm email.');
        return;
      }

      const added = payload.item;
      setWhitelist((prev) => {
        const exists = prev.some((w) => w.email === added.email);
        return exists
          ? prev.map((w) => (w.email === added.email ? added : w))
          : [added, ...prev];
      });
      setNewEmail('');
      setNewNote('');
      toast.success(`Đã thêm ${added.email} vào Whitelist.`);
    } catch {
      toast.error('Lỗi kết nối khi thêm email.');
    } finally {
      setIsAddingEmail(false);
    }
  };

  const handleToggleWhitelist = async (email: string, nextActive: boolean) => {
    setTogglingEmail(email);
    try {
      const res = await fetch('/api/whitelist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, is_active: nextActive }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        item?: AllowedEmailRow;
        error?: string;
      };

      if (!res.ok || !payload.item) {
        toast.error(payload.error || 'Không thể cập nhật trạng thái.');
        return;
      }

      setWhitelist((prev) =>
        prev.map((row) => (row.email === email ? payload.item! : row)),
      );
      toast.success(
        nextActive
          ? `Đã kích hoạt quyền cho ${email}`
          : `Đã tạm khóa quyền của ${email}`,
      );
    } catch {
      toast.error('Lỗi kết nối khi cập nhật Whitelist.');
    } finally {
      setTogglingEmail(null);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Header Admin Panel */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              prefetch={false}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <ArrowLeft className="size-4" />
              <span>Rạp Phim</span>
            </Link>

            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-[var(--accent-foreground)]">
                <Shield className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-[var(--text-primary)] sm:text-lg">
                  Bảng Điều Khiển Admin
                </h1>
                <p className="text-xs text-[var(--text-secondary)]">
                  Quản trị viên: {adminEmail}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={cycleTheme}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            <Palette className="size-4 text-[var(--accent-primary)]" />
            <span>{themeMeta.label}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-12">
        {/* KHU VỰC 1: Đơn xin cấp quyền đang chờ (Pending Requests) */}
        <section
          aria-label="Đơn xin cấp quyền đang chờ"
          className="flex flex-col gap-4 lg:col-span-6"
        >
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-primary)]">
                  <Clock className="size-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    Đơn xin cấp quyền đang chờ
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Phê duyệt 1 chạm sẽ tự động thêm email vào Whitelist
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isRefreshingRequests}
                  onClick={() => void handleRefreshRequests()}
                  title="Tải lại danh sách đơn từ Supabase"
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-60 cursor-pointer"
                >
                  <RefreshCw
                    className={`size-3 ${isRefreshingRequests ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isRefreshingRequests ? 'Đang tải...' : 'Làm mới'}
                  </span>
                </button>
                <span className="rounded-lg bg-[var(--accent-primary)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--accent-foreground)]">
                  {pendingRequests.length}
                </span>
              </div>
            </div>

            {pendingRequests.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-10 text-center">
                <CheckCircle2 className="size-7 text-emerald-500 dark:text-emerald-400" />
                <p className="mt-2.5 text-sm font-medium text-[var(--text-primary)]">
                  Không có đơn nào đang chờ duyệt
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Mọi yêu cầu mới từ màn hình /login sẽ hiển thị tại đây.
                </p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {pendingRequests.map((req) => {
                  const isBusy = processingAction?.id === req.id;
                  const isApproving =
                    isBusy && processingAction?.action === 'approve';
                  const isRejecting =
                    isBusy && processingAction?.action === 'reject';
                  return (
                    <article
                      key={req.id}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
                    >
                      <div className="flex items-start gap-3">
                        {req.avatar_url ? (
                          <Image
                            src={req.avatar_url}
                            alt={req.full_name || req.email}
                            width={40}
                            height={40}
                            className="size-10 shrink-0 rounded-xl object-cover"
                          />
                        ) : (
                          <UserCircle2 className="size-10 shrink-0 text-[var(--text-secondary)]" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                              {req.full_name || 'Người dùng Google'}
                            </p>
                            <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                              {formatDateTime(req.created_at)}
                            </span>
                          </div>
                          <p className="truncate font-mono text-xs text-[var(--text-secondary)]">
                            {req.email}
                          </p>
                          {req.message && (
                            <p className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] text-pretty">
                              &ldquo;{req.message}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3.5 flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => handleReviewRequest(req.id, 'reject')}
                          className="h-9 rounded-lg border-[var(--border-subtle)] bg-rose-500/10 px-3 text-xs font-medium text-rose-500 dark:text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                        >
                          {isRejecting ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <X className="mr-1.5 size-3.5" />
                          )}
                          <span>
                            {isRejecting ? 'Đang từ chối...' : 'Từ chối'}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleReviewRequest(req.id, 'approve')}
                          className="h-9 rounded-lg bg-[var(--accent-primary)] px-3.5 text-xs font-semibold text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                        >
                          {isApproving ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Check className="mr-1.5 size-3.5" />
                          )}
                          <span>
                            {isApproving ? 'Đang phê duyệt...' : 'Phê duyệt'}
                          </span>
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Lịch sử đã xử lý gần đây */}
            {processedRequests.length > 0 && (
              <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">
                  Đã xử lý gần đây ({processedRequests.length})
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {processedRequests.slice(0, 5).map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-canvas)] px-3 py-2 text-xs"
                    >
                      <span className="truncate font-mono text-[var(--text-secondary)]">
                        {req.email}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          req.status === 'approved'
                            ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400'
                            : 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
                        }`}
                      >
                        {req.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* KHU VỰC 2: Quản lý Thành viên Whitelist (allowed_emails) */}
        <section
          aria-label="Quản lý Thành viên Whitelist"
          className="flex flex-col gap-4 lg:col-span-6"
        >
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-primary)]">
                  <Users className="size-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">
                    Thành viên Whitelist
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Đang kích hoạt{' '}
                    <strong className="tabular-nums text-[var(--text-primary)]">
                      {activeWhitelistCount}
                    </strong>{' '}
                    / {whitelist.length} tài khoản (`allowed_emails`)
                  </p>
                </div>
              </div>
            </div>

            {/* Form thêm email trực tiếp */}
            <form
              onSubmit={handleAddWhitelistEmail}
              className="mt-4 flex flex-col gap-2 sm:flex-row"
            >
              <Input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email.banbe@gmail.com"
                aria-label="Email cần thêm vào Whitelist"
                className="h-10 flex-1 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
              />
              <Input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Ghi chú"
                aria-label="Ghi chú thành viên"
                className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] sm:w-36"
              />
              <Button
                type="submit"
                disabled={isAddingEmail}
                className="h-10 shrink-0 rounded-xl bg-[var(--accent-primary)] px-4 text-xs font-semibold text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
              >
                {isAddingEmail ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <UserPlus className="mr-1.5 size-4" />
                )}
                <span>{isAddingEmail ? 'Đang thêm...' : 'Thêm'}</span>
              </Button>
            </form>

            {/* Danh sách allowed_emails */}
            <div className="mt-4 flex flex-col gap-2">
              {whitelist.map((item) => {
                const isSelf =
                  item.email.trim().toLowerCase() ===
                  adminEmail.trim().toLowerCase();

                return (
                  <div
                    key={item.email}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-mono text-sm font-medium text-[var(--text-primary)]">
                          {item.email}
                        </p>
                        {isSelf && (
                          <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-primary)]">
                            Admin
                          </span>
                        )}
                      </div>
                      {item.note && (
                        <p className="truncate text-xs text-[var(--text-secondary)]">
                          {item.note}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      {togglingEmail === item.email && (
                        <Loader2 className="size-3.5 animate-spin text-[var(--accent-primary)]" />
                      )}
                      <span className="text-xs text-[var(--text-secondary)]">
                        {item.is_active ? 'Đang bật' : 'Đã khóa'}
                      </span>
                      <Switch
                        checked={item.is_active}
                        disabled={isSelf || togglingEmail === item.email}
                        onCheckedChange={(checked) =>
                          handleToggleWhitelist(item.email, checked)
                        }
                        aria-label={`Bật/tắt quyền truy cập của ${item.email}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
