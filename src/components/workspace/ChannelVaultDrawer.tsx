'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  RefreshCw,
  Clock,
  Search,
  Radio,
  FolderKanban,
  Tv,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GENRE_OPTIONS,
  type ChannelWithSelection,
} from '@/types/workspace';
import type { GenreTag } from '@/types/database';

interface ChannelVaultDrawerProps {
  open: boolean;
  onClose: () => void;
  channels: ChannelWithSelection[];
  lastSyncedAt: string | null;
  isSyncing: boolean;
  onSyncFromYouTube: () => void;
  onToggleChannel: (channelId: string, nextSelected: boolean) => void;
  onChangeChannelGenre: (channelId: string, nextGenre: GenreTag) => void;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function ChannelVaultDrawer({
  open,
  onClose,
  channels,
  lastSyncedAt,
  isSyncing,
  onSyncFromYouTube,
  onToggleChannel,
  onChangeChannelGenre,
}: ChannelVaultDrawerProps) {
  const [drawerSearch, setDrawerSearch] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  const isDev = process.env.NODE_ENV === 'development';

  const cooldownSeconds = useMemo(() => {
    if (isDev || !lastSyncedAt) return 0;
    const elapsed = nowMs - new Date(lastSyncedAt).getTime();
    const remaining = SIX_HOURS_MS - elapsed;
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }, [isDev, lastSyncedAt, nowMs]);

  const formatCooldown = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600)
      .toString()
      .padStart(2, '0');
    const m = Math.floor((totalSec % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const filteredChannels = useMemo(() => {
    const q = drawerSearch.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.custom_url?.toLowerCase().includes(q) ?? false),
    );
  }, [channels, drawerSearch]);

  const activeChannels = useMemo(
    () => channels.filter((c) => c.is_selected),
    [channels],
  );

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-50 flex justify-end transition-opacity ${
        open
          ? 'pointer-events-auto opacity-100 duration-300'
          : 'pointer-events-none opacity-0 duration-200'
      }`}
    >
      {/* Lớp phủ làm mờ nền phía sau */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
      />

      {/* Ngăn kéo trượt ngang chiếm 75% màn hình trên Desktop */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Kho Kênh Đăng Ký YouTube"
        className={`relative z-10 flex h-dvh w-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl transition-transform lg:w-[75vw] ${
          open
            ? 'translate-x-0 duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]'
            : 'translate-x-full duration-350 ease-[cubic-bezier(0.32,0.72,0,1)]'
        }`}
      >
        {/* Header của Drawer */}
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-primary)]">
              <FolderKanban className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Kho Kênh Đăng Ký (Channel Vault)
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Đồng bộ kênh từ YouTube (giới hạn 1 lần / 6 tiếng) & gán thể loại
                mặc định cho Gemini AI
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {cooldownSeconds > 0 ? (
              <div className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 text-xs font-medium tabular-nums text-[var(--text-secondary)]">
                <Clock className="size-4 text-amber-400" />
                <span>Đồng bộ lại sau {formatCooldown(cooldownSeconds)}</span>
              </div>
            ) : (
              <Button
                type="button"
                onClick={onSyncFromYouTube}
                disabled={isSyncing}
                className="h-10 rounded-xl bg-[var(--accent-primary)] px-4 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
              >
                <RefreshCw
                  className={`mr-2 size-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                <span>
                  {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ kênh từ YouTube'}
                </span>
              </Button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng Kho Kênh"
              className="flex size-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Nội dung 2 cột */}
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--border-subtle)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {/* CỘT TRÁI: Danh sách kênh đồng bộ từ YouTube */}
          <div className="flex min-h-0 flex-col p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                1. Kênh đồng bộ từ YouTube ({channels.length})
              </h3>
              <span className="text-xs text-[var(--text-secondary)]">
                subscriptions.list
              </span>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <Input
                type="search"
                value={drawerSearch}
                onChange={(e) => setDrawerSearch(e.target.value)}
                placeholder="Tìm kênh theo tên hoặc @handle..."
                className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-9 text-sm text-[var(--text-primary)]"
              />
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {filteredChannels.length === 0 ? (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-6 text-center">
                  <Tv className="size-7 text-[var(--text-secondary)]" />
                  <p className="mt-2.5 text-sm font-medium text-[var(--text-primary)]">
                    Chưa có kênh YouTube nào được đồng bộ
                  </p>
                  <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                    Bấm nút &ldquo;Đồng bộ kênh từ YouTube&rdquo; ở góc trên để
                    kéo danh sách kênh đăng ký của bạn về đây.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredChannels.map((ch) => (
                    <div
                      key={ch.channel_id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {ch.title}
                        </p>
                        <p className="truncate text-xs text-[var(--text-secondary)]">
                          {ch.custom_url || ch.channel_id}
                        </p>
                      </div>
                      <Switch
                        checked={ch.is_selected}
                        onCheckedChange={(checked) =>
                          onToggleChannel(ch.channel_id, checked)
                        }
                        aria-label={`Kích hoạt kênh ${ch.title}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CỘT PHẢI: Danh sách kênh đang kích hoạt trên AniSub + Dropdown thể loại mặc định */}
          <div className="flex min-h-0 flex-col p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                2. Kênh đang kích hoạt trên AniSub ({activeChannels.length})
              </h3>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <Radio className="size-3" />
                <span>WebSub</span>
              </span>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {activeChannels.length === 0 ? (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-6 text-center">
                  <Radio className="size-7 text-[var(--text-secondary)]" />
                  <p className="mt-2.5 text-sm font-medium text-[var(--text-primary)]">
                    Chưa kích hoạt kênh nào
                  </p>
                  <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
                    Gạt công tắc ở cột bên trái để đưa kênh vào rạp phim AniSub
                    và gán nhãn thể loại mặc định.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {activeChannels.map((ch) => (
                    <div
                      key={ch.channel_id}
                      className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {ch.title}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          WebSub: {ch.websub_status}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <Select
                          value={ch.genre_tag}
                          onValueChange={(val) => {
                            if (val) {
                              onChangeChannelGenre(
                                ch.channel_id,
                                val as GenreTag,
                              );
                            }
                          }}
                        >
                          <SelectTrigger
                            aria-label={`Thể loại mặc định của ${ch.title}`}
                            className="h-9 w-36 rounded-lg border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-medium text-[var(--text-primary)]"
                          >
                            <SelectValue placeholder="Thể loại" />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                            {GENRE_OPTIONS.map((genre) => (
                              <SelectItem
                                key={genre}
                                value={genre}
                                className="text-xs cursor-pointer"
                              >
                                {genre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Switch
                          checked={ch.is_selected}
                          onCheckedChange={(checked) =>
                            onToggleChannel(ch.channel_id, checked)
                          }
                          aria-label={`Tắt kênh ${ch.title}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
