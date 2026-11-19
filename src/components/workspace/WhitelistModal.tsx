'use client';

import React, { useEffect, useState } from 'react';
import { X, UserPlus, ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { AllowedEmailRow } from '@/types/database';

interface WhitelistModalProps {
  open: boolean;
  onClose: () => void;
  currentUserEmail?: string | null;
}

export function WhitelistModal({
  open,
  onClose,
  currentUserEmail,
}: WhitelistModalProps) {
  const [emails, setEmails] = useState<AllowedEmailRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;

    async function load() {
      try {
        if (active) setIsLoading(true);
        const res = await fetch('/api/whitelist');
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          if (active) {
            toast.error(err.error || 'Không thể tải danh sách Whitelist.');
          }
          return;
        }
        const data = (await res.json()) as { emails: AllowedEmailRow[] };
        if (active) {
          setEmails(data.emails ?? []);
        }
      } catch {
        if (active) {
          toast.error('Lỗi kết nối khi tải Whitelist.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      toast.warning('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmed,
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

      setEmails((prev) => {
        const exists = prev.some((i) => i.email === payload.item!.email);
        if (exists) {
          return prev.map((i) =>
            i.email === payload.item!.email ? payload.item! : i,
          );
        }
        return [payload.item!, ...prev];
      });
      setNewEmail('');
      setNewNote('');
      toast.success(`Đã cấp quyền truy cập cho ${payload.item.email}`);
    } catch {
      toast.error('Lỗi kết nối khi thêm email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (email: string, nextActive: boolean) => {
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

      setEmails((prev) =>
        prev.map((row) => (row.email === email ? payload.item! : row)),
      );
      toast.success(
        nextActive
          ? `Đã bật quyền cho ${email}`
          : `Đã tạm khóa quyền của ${email}`,
      );
    } catch {
      toast.error('Lỗi kết nối khi cập nhật Whitelist.');
    } finally {
      setTogglingEmail(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quản lý quyền truy cập Whitelist"
        className="relative z-10 flex max-h-[85dvh] w-full max-w-xl flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-primary)]">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Quản lý quyền truy cập (Whitelist)
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Danh sách email được phép đăng nhập AniSub (`allowed_emails`)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng quản lý Whitelist"
            className="flex size-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Form thêm email mới */}
        <form
          onSubmit={handleAddEmail}
          className="flex flex-col gap-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 p-4 sm:flex-row"
        >
          <Input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="banbe@gmail.com"
            aria-label="Email cần cấp quyền"
            className="h-10 flex-1 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
          <Input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Ghi chú (vd: Bạn thân)"
            aria-label="Ghi chú"
            className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] sm:w-40"
          />
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-10 shrink-0 rounded-xl bg-[var(--accent-primary)] px-4 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1.5 size-4" />
            )}
            <span>{isSubmitting ? 'Đang thêm...' : 'Thêm email'}</span>
          </Button>
        </form>

        {/* Danh sách allowed_emails */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-secondary)]">
              <Loader2 className="size-4 animate-spin text-[var(--accent-primary)]" />
              <span>Đang tải danh sách Whitelist...</span>
            </div>
          ) : emails.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
              Chưa có email nào trong danh sách `allowed_emails`.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {emails.map((row) => {
                const isSelf =
                  currentUserEmail &&
                  row.email.toLowerCase() ===
                    currentUserEmail.trim().toLowerCase();

                return (
                  <div
                    key={row.email}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {row.email}
                        </p>
                        {isSelf && (
                          <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-primary)]">
                            Bạn
                          </span>
                        )}
                      </div>
                      {row.note && (
                        <p className="truncate text-xs text-[var(--text-secondary)]">
                          {row.note}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {togglingEmail === row.email && (
                        <Loader2 className="size-3.5 animate-spin text-[var(--accent-primary)]" />
                      )}
                      <Switch
                        checked={row.is_active}
                        disabled={Boolean(isSelf) || togglingEmail === row.email}
                        onCheckedChange={(checked) =>
                          handleToggleActive(row.email, checked)
                        }
                        aria-label={`Bật/tắt quyền cho ${row.email}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
