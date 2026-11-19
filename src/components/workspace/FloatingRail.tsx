'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Clapperboard,
  Film,
  Clock,
  FolderKanban,
  Palette,
  UserCircle2,
  PanelLeftOpen,
  PanelLeftClose,
  Check,
  Shield,
  ShieldCheck,
  LogOut,
  Users,
  LogIn,
} from 'lucide-react';
import {
  ANISUB_THEMES,
  useTheme,
  type AniSubThemeId,
} from '@/components/providers/ThemeProvider';
import {
  GENRE_DOT_STYLES,
  type GenreFilter,
  type WorkspaceAuthStatus,
  type WorkspaceViewMode,
} from '@/types/workspace';

interface FloatingRailProps {
  viewMode: WorkspaceViewMode;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  genreFilter: GenreFilter;
  onChangeGenreFilter: (genre: GenreFilter) => void;
  isVaultOpen: boolean;
  onOpenVault: () => void;
  selectedChannelCount: number;
  authStatus: WorkspaceAuthStatus;
  isAdmin?: boolean;
  pendingRequestsCount?: number;
  userEmail?: string | null;
  userFullName?: string | null;
  userAvatarUrl?: string | null;
  onNavigateLogin: () => void;
  onOpenWhitelistModal: () => void;
  onSignOut: () => void;
}

const GENRE_DOTS: Array<
  Extract<GenreFilter, 'Phim AI' | 'HH2D' | 'Hoạt hình cát'>
> = ['Phim AI', 'HH2D', 'Hoạt hình cát'];

export function FloatingRail({
  viewMode,
  onChangeViewMode,
  genreFilter,
  onChangeGenreFilter,
  isVaultOpen,
  onOpenVault,
  selectedChannelCount,
  authStatus,
  isAdmin = false,
  pendingRequestsCount = 0,
  userEmail,
  userFullName,
  userAvatarUrl,
  onNavigateLogin,
  onOpenWhitelistModal,
  onSignOut,
}: FloatingRailProps) {
  const { theme, setTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const themeMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        themeMenuRef.current &&
        !themeMenuRef.current.contains(e.target as Node)
      ) {
        setThemeMenuOpen(false);
      }
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleToggleGenreDot = (
    genre: Extract<GenreFilter, 'Phim AI' | 'HH2D' | 'Hoạt hình cát'>,
  ) => {
    onChangeGenreFilter(genreFilter === genre ? 'all' : genre);
  };

  const handleSelectTheme = (nextTheme: AniSubThemeId) => {
    setTheme(nextTheme);
    setThemeMenuOpen(false);
  };

  const displayName = userFullName || userEmail || 'Tài khoản Google';

  return (
    <>
      {/* DESKTOP & TABLET: Collapsible Floating Rail (mặc định 64px) */}
      <aside
        aria-label="Thanh điều hướng nổi AniSub"
        className={`relative z-30 hidden shrink-0 flex-col justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3 transition-[width] duration-200 ease-out md:flex ${
          expanded ? 'w-56 px-3' : 'w-16 items-center px-2'
        }`}
      >
        {/* Phần trên */}
        <div
          className={`flex flex-col gap-3 ${expanded ? 'w-full' : 'items-center'}`}
        >
          <div
            className={`flex items-center ${
              expanded ? 'justify-between px-1' : 'flex-col gap-2'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onChangeViewMode('cinema');
                onChangeGenreFilter('all');
              }}
              title="AniSub — Unified Cinema Workspace"
              className="flex items-center gap-2.5 cursor-pointer"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-[var(--accent-foreground)]">
                <Clapperboard className="size-5" />
              </div>
              {expanded && (
                <span className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                  AniSub
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-label={
                expanded
                  ? 'Thu gọn thanh điều hướng'
                  : 'Mở rộng thanh điều hướng'
              }
              title={expanded ? 'Thu gọn (64px)' : 'Mở rộng thanh điều hướng'}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {expanded ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
          </div>

          <div className="my-0.5 h-px w-full bg-[var(--border-subtle)]" />

          <nav
            aria-label="Chế độ rạp chiếu"
            className="flex w-full flex-col gap-1"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('cinema')}
              aria-current={
                viewMode === 'cinema' && !isVaultOpen ? 'page' : undefined
              }
              title="Rạp Phim"
              className={`flex h-10 items-center rounded-xl transition-colors cursor-pointer ${
                expanded ? 'w-full gap-3 px-3' : 'w-full justify-center'
              } ${
                viewMode === 'cinema' && !isVaultOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Film className="size-5 shrink-0" />
              {expanded && <span className="truncate text-sm">Rạp Phim</span>}
            </button>

            <button
              type="button"
              onClick={() => onChangeViewMode('continue')}
              aria-current={
                viewMode === 'continue' && !isVaultOpen ? 'page' : undefined
              }
              title="Đang Cày Dở"
              className={`flex h-10 items-center rounded-xl transition-colors cursor-pointer ${
                expanded ? 'w-full gap-3 px-3' : 'w-full justify-center'
              } ${
                viewMode === 'continue' && !isVaultOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Clock className="size-5 shrink-0" />
              {expanded && (
                <span className="truncate text-sm">Đang Cày Dở</span>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenVault}
              aria-expanded={isVaultOpen}
              title="Kho Kênh Đăng Ký"
              className={`relative flex h-10 items-center rounded-xl transition-colors cursor-pointer ${
                expanded ? 'w-full gap-3 px-3' : 'w-full justify-center'
              } ${
                isVaultOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              }`}
            >
              <FolderKanban className="size-5 shrink-0" />
              {expanded ? (
                <>
                  <span className="flex-1 truncate text-left text-sm">
                    Kho Kênh
                  </span>
                  <span className="rounded-md bg-[var(--bg-canvas)] px-1.5 py-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
                    {selectedChannelCount}
                  </span>
                </>
              ) : (
                selectedChannelCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[10px] font-semibold tabular-nums text-[var(--accent-foreground)]">
                    {selectedChannelCount}
                  </span>
                )
              )}
            </button>

            {isAdmin && (
              <Link
                href="/admin"
                title="Bảng điều khiển Admin (Duyệt đơn & Whitelist)"
                className={`relative flex h-10 items-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer ${
                  expanded ? 'w-full gap-3 px-3' : 'w-full justify-center'
                }`}
              >
                <Shield className="size-5 shrink-0 text-[var(--accent-primary)]" />
                {expanded ? (
                  <>
                    <span className="flex-1 truncate text-left text-sm font-medium text-[var(--text-primary)]">
                      Quản trị Admin
                    </span>
                    {pendingRequestsCount > 0 && (
                      <span className="rounded-md bg-[var(--accent-primary)] px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--accent-foreground)]">
                        {pendingRequestsCount}
                      </span>
                    )}
                  </>
                ) : (
                  pendingRequestsCount > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[10px] font-semibold tabular-nums text-[var(--accent-foreground)]">
                      {pendingRequestsCount > 9 ? '9+' : pendingRequestsCount}
                    </span>
                  )
                )}
              </Link>
            )}
          </nav>

          <div className="my-0.5 h-px w-full bg-[var(--border-subtle)]" />

          {/* Cụm chấm lọc nhanh thể loại */}
          <div
            role="group"
            aria-label="Lọc nhanh thể loại"
            className={`flex w-full flex-col gap-1.5 ${
              expanded ? 'px-1' : 'items-center'
            }`}
          >
            {expanded && (
              <span className="px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Thể loại
              </span>
            )}
            {GENRE_DOTS.map((genre) => {
              const style = GENRE_DOT_STYLES[genre];
              const isSelected = genreFilter === genre;

              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => handleToggleGenreDot(genre)}
                  aria-pressed={isSelected}
                  title={`Lọc nhanh: ${style.label}`}
                  className={`flex h-9 items-center rounded-xl transition-colors cursor-pointer ${
                    expanded ? 'w-full gap-3 px-2.5' : 'size-9 justify-center'
                  } ${
                    isSelected
                      ? 'bg-[var(--bg-elevated)] ring-1 ring-[var(--accent-primary)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${style.dotClass} ${
                      isSelected
                        ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-surface)] ring-current'
                        : ''
                    }`}
                  />
                  {expanded && (
                    <span className="truncate text-xs font-medium">
                      {style.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Phần dưới: Đổi Theme + Tài khoản Google */}
        <div
          className={`flex flex-col gap-1.5 ${expanded ? 'w-full' : 'items-center'}`}
        >
          {/* Đổi Theme */}
          <div className="relative w-full" ref={themeMenuRef}>
            <button
              type="button"
              onClick={() => {
                setAccountMenuOpen(false);
                setThemeMenuOpen((prev) => !prev);
              }}
              aria-expanded={themeMenuOpen}
              title="Đổi giao diện màu (Theme Switcher)"
              className={`flex h-10 items-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer ${
                expanded ? 'w-full gap-3 px-3' : 'w-full justify-center'
              }`}
            >
              <Palette className="size-5 shrink-0" />
              {expanded && <span className="truncate text-sm">Đổi Theme</span>}
            </button>

            {themeMenuOpen && (
              <div
                role="menu"
                aria-label="Chọn bộ giao diện màu"
                className="absolute bottom-0 left-full z-50 ml-3 w-64 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-xl"
              >
                <p className="px-2.5 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                  Giao diện Workspace
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  {ANISUB_THEMES.map((item) => {
                    const active = item.id === theme;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectTheme(item.id)}
                        className={`flex items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)]"
                            style={{ backgroundColor: item.swatchBg }}
                          >
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: item.swatchAccent }}
                            />
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-primary)]">
                              {item.label}
                            </p>
                            <p className="text-[11px] text-[var(--text-secondary)]">
                              {item.description}
                            </p>
                          </div>
                        </div>
                        {active && (
                          <Check className="size-4 shrink-0 text-[var(--accent-primary)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Tài khoản Google + Popover Whitelist & Đăng xuất */}
          <div className="relative w-full" ref={accountMenuRef}>
            <button
              type="button"
              onClick={() => {
                setThemeMenuOpen(false);
                if (authStatus === 'authenticated') {
                  setAccountMenuOpen((prev) => !prev);
                } else {
                  onNavigateLogin();
                }
              }}
              aria-expanded={accountMenuOpen}
              title={displayName}
              className={`flex h-10 items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer ${
                expanded ? 'w-full gap-2.5 px-2.5' : 'w-full justify-center'
              }`}
            >
              {authStatus === 'authenticated' && userAvatarUrl ? (
                <Image
                  src={userAvatarUrl}
                  alt={displayName}
                  width={26}
                  height={26}
                  className="size-6.5 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <UserCircle2 className="size-5 shrink-0 text-[var(--text-secondary)]" />
              )}
              {expanded && (
                <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                  {authStatus === 'authenticated'
                    ? displayName
                    : 'Đăng nhập Google'}
                </span>
              )}
            </button>

            {accountMenuOpen && authStatus === 'authenticated' && (
              <div
                role="menu"
                aria-label="Menu tài khoản Google"
                className="absolute bottom-0 left-full z-50 ml-3 w-72 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 shadow-xl"
              >
                <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] pb-3">
                  {userAvatarUrl ? (
                    <Image
                      src={userAvatarUrl}
                      alt={displayName}
                      width={36}
                      height={36}
                      className="size-9 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <UserCircle2 className="size-9 shrink-0 text-[var(--text-secondary)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {displayName}
                    </p>
                    {userEmail && (
                      <p className="truncate text-xs text-[var(--text-secondary)]">
                        {userEmail}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500 dark:text-emerald-400">
                  <ShieldCheck className="size-3.5" />
                  <span>Đã xác minh Whitelist</span>
                </div>

                <div className="mt-2.5 flex flex-col gap-1">
                  {isAdmin && (
                    <>
                      <Link
                        href="/admin"
                        onClick={() => setAccountMenuOpen(false)}
                        className="flex h-10 w-full items-center justify-between gap-2.5 rounded-xl px-2.5 text-left text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface)] cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5">
                          <Shield className="size-4 text-[var(--accent-primary)]" />
                          <span>Bảng điều khiển Admin</span>
                        </span>
                        {pendingRequestsCount > 0 && (
                          <span className="rounded-md bg-[var(--accent-primary)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--accent-foreground)]">
                            {pendingRequestsCount}
                          </span>
                        )}
                      </Link>

                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onOpenWhitelistModal();
                        }}
                        className="flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface)] cursor-pointer"
                      >
                        <Users className="size-4 text-[var(--accent-primary)]" />
                        <span>Quản lý nhanh Whitelist</span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onSignOut();
                    }}
                    className="flex h-10 w-full items-center gap-2.5 rounded-xl bg-rose-500/10 px-2.5 text-left text-xs font-medium text-rose-500 dark:text-rose-400 transition-colors hover:bg-rose-500/15 cursor-pointer"
                  >
                    <LogOut className="size-4" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* MOBILE (< md): Thanh Bottom Bar cố định */}
      <nav
        aria-label="Điều hướng di động"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <button
          type="button"
          onClick={() => onChangeViewMode('cinema')}
          aria-current={
            viewMode === 'cinema' && !isVaultOpen ? 'page' : undefined
          }
          className={`flex flex-col items-center justify-center gap-1 text-xs cursor-pointer ${
            viewMode === 'cinema' && !isVaultOpen
              ? 'text-[var(--accent-primary)] font-medium'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          <Film className="size-5" />
          <span>Rạp Phim</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeViewMode('continue')}
          aria-current={
            viewMode === 'continue' && !isVaultOpen ? 'page' : undefined
          }
          className={`flex flex-col items-center justify-center gap-1 text-xs cursor-pointer ${
            viewMode === 'continue' && !isVaultOpen
              ? 'text-[var(--accent-primary)] font-medium'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          <Clock className="size-5" />
          <span>Cày Dở</span>
        </button>

        <button
          type="button"
          onClick={onOpenVault}
          className={`relative flex flex-col items-center justify-center gap-1 text-xs cursor-pointer ${
            isVaultOpen
              ? 'text-[var(--accent-primary)] font-medium'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          <FolderKanban className="size-5" />
          <span>Kho Kênh</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const idx = ANISUB_THEMES.findIndex((t) => t.id === theme);
            const next = ANISUB_THEMES[(idx + 1) % ANISUB_THEMES.length];
            setTheme(next.id);
          }}
          className="flex flex-col items-center justify-center gap-1 text-xs text-[var(--text-secondary)] cursor-pointer"
        >
          <Palette className="size-5" />
          <span>Theme</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (authStatus === 'authenticated') {
              onOpenWhitelistModal();
            } else {
              onNavigateLogin();
            }
          }}
          className="flex flex-col items-center justify-center gap-1 text-xs text-[var(--text-secondary)] cursor-pointer"
        >
          {authStatus === 'authenticated' && userAvatarUrl ? (
            <Image
              src={userAvatarUrl}
              alt={displayName}
              width={20}
              height={20}
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <LogIn className="size-5" />
          )}
          <span>{authStatus === 'authenticated' ? 'Whitelist' : 'Đăng nhập'}</span>
        </button>
      </nav>
    </>
  );
}
