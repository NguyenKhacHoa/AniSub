'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  X,
  RefreshCw,
  Clock,
  Search,
  Radio,
  FolderKanban,
  Tv,
  Loader2,
  Sparkles,
  Check,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  GENRE_DOT_STYLES,
  PRIMARY_GENRE_OPTIONS,
  type ChannelWithSelection,
  type PrimaryGenreTag,
} from '@/types/workspace';

interface ChannelVaultDrawerProps {
  open: boolean;
  onClose: () => void;
  channels: ChannelWithSelection[];
  lastSyncedAt: string | null;
  isSyncing: boolean;
  isReclassifyingAll?: boolean;
  busyChannelId?: string | null;
  onSyncFromYouTube: () => void;
  onReclassifyAll: () => void;
  onToggleChannel: (channelId: string, nextSelected: boolean) => void;
  onToggleChannelGenreTag: (channelId: string, tag: PrimaryGenreTag) => void;
  onReclassifyChannel: (channelId: string) => void;
  onLoadMoreChannelVideos: (channelId: string) => void;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function ChannelVaultDrawer({
  open,
  onClose,
  channels,
  lastSyncedAt,
  isSyncing,
  isReclassifyingAll = false,
  busyChannelId = null,
  onSyncFromYouTube,
  onReclassifyAll,
  onToggleChannel,
  onToggleChannelGenreTag,
  onReclassifyChannel,
  onLoadMoreChannelVideos,
}: ChannelVaultDrawerProps) {
  const [drawerSearch, setDrawerSearch] = useState('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [channelAction, setChannelAction] = useState<{
    channelId: string;
    type: 'load_more' | 'reclassify' | 'toggle';
  } | null>(null);

  const activeChannelAction =
    busyChannelId && channelAction?.channelId === busyChannelId
      ? channelAction.type
      : null;

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
                Chọn 1 hoặc nhiều thể loại cho từng kênh — chọn từ 2 tag trở lên
                sẽ kích hoạt Gemini AI phân loại từng video
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeChannels.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={onReclassifyAll}
                disabled={isReclassifyingAll || isSyncing}
                title="Quét lại toàn bộ video của các kênh đang bật bằng Gemini Vision"
                className="h-10 rounded-xl border-[var(--ai-accent)]/45 bg-violet-500/10 px-3.5 text-xs font-medium text-[var(--ai-accent)] hover:bg-violet-500/20 cursor-pointer"
              >
                {isReclassifyingAll ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 size-4" />
                )}
                <span>
                  {isReclassifyingAll
                    ? 'Đang quét AI...'
                    : 'Quét lại nhãn AI'}
                </span>
              </Button>
            )}

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
                  {filteredChannels.map((ch) => {
                    const isBusy = busyChannelId === ch.channel_id;
                    return (
                      <div
                        key={ch.channel_id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          {ch.thumbnail_url ? (
                            <Image
                              src={ch.thumbnail_url}
                              alt={ch.title}
                              width={36}
                              height={36}
                              className="size-9 shrink-0 rounded-full border border-[var(--border-subtle)] object-cover"
                            />
                          ) : (
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                              <Tv className="size-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                              {ch.title}
                            </p>
                            <p className="truncate text-xs text-[var(--text-secondary)]">
                              {ch.custom_url || ch.channel_id}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isBusy && (
                            <Loader2 className="size-4 animate-spin text-[var(--accent-primary)]" />
                          )}
                          <Switch
                            checked={ch.is_selected}
                            disabled={isBusy}
                            onCheckedChange={(checked) =>
                              onToggleChannel(ch.channel_id, checked)
                            }
                            aria-label={`Kích hoạt kênh ${ch.title}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* CỘT PHẢI: Danh sách kênh đang kích hoạt + Cụm 3 nút Pill Multi-Tag */}
          <div className="flex min-h-0 flex-col p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                2. Kênh đang kích hoạt trên AniSub ({activeChannels.length})
              </h3>
              <span className="inline-flex items-center gap-1 text-xs text-emerald-500 dark:text-emerald-400">
                <Radio className="size-3" />
                <span>Multi-Tag + AI</span>
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
                    và chọn 1 hoặc nhiều thể loại cho kênh.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activeChannels.map((ch) => {
                    const isBusy = busyChannelId === ch.channel_id;
                    const isMultiTag = ch.genre_tags.length >= 2;

                    return (
                      <div
                        key={ch.channel_id}
                        className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            {ch.thumbnail_url ? (
                              <Image
                                src={ch.thumbnail_url}
                                alt={ch.title}
                                width={32}
                                height={32}
                                className="size-8 shrink-0 rounded-full border border-[var(--border-subtle)] object-cover"
                              />
                            ) : (
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                                <Tv className="size-3.5" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                                {ch.title}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                <span>WebSub: {ch.websub_status}</span>
                                {isMultiTag ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-[var(--ai-accent)]">
                                    <Sparkles className="size-3" />
                                    <span>Gemini Vision đang phân loại</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-medium text-[var(--text-secondary)]">
                                    Gán cố định 1 nhãn
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {isBusy && (
                              <Loader2 className="size-4 animate-spin text-[var(--accent-primary)]" />
                            )}
                            <Switch
                              checked={ch.is_selected}
                              disabled={isBusy}
                              onCheckedChange={(checked) =>
                                onToggleChannel(ch.channel_id, checked)
                              }
                              aria-label={`Tắt kênh ${ch.title}`}
                            />
                          </div>
                        </div>

                        {/* Cụm 3 nút Pill bật/tắt nhiều lựa chọn + Nút Quét AI lại */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                          <div
                            role="group"
                            aria-label={`Chọn thể loại cho kênh ${ch.title}`}
                            className="flex flex-wrap items-center gap-2"
                          >
                            {PRIMARY_GENRE_OPTIONS.map((tag) => {
                              const isSelectedTag = ch.genre_tags.includes(tag);
                              const style = GENRE_DOT_STYLES[tag];

                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  disabled={isBusy}
                                  aria-pressed={isSelectedTag}
                                  onClick={() =>
                                    onToggleChannelGenreTag(ch.channel_id, tag)
                                  }
                                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-60 ${
                                    isSelectedTag
                                      ? `${style.badgeClass} ring-1 ring-current`
                                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                                  }`}
                                >
                                  {isSelectedTag ? (
                                    <Check className="size-3.5 shrink-0" />
                                  ) : (
                                    <span
                                      className={`size-2 shrink-0 rounded-full ${style.dotClass}`}
                                    />
                                  )}
                                  <span>{style.label}</span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setChannelAction({
                                  channelId: ch.channel_id,
                                  type: 'load_more',
                                });
                                onLoadMoreChannelVideos(ch.channel_id);
                              }}
                              title="Đồng bộ trọn vẹn toàn bộ video từ Tập 1 đến Tập mới nhất cho kênh này"
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-60 cursor-pointer"
                            >
                              {isBusy && activeChannelAction === 'load_more' ? (
                                <Loader2 className="size-3.5 animate-spin text-[var(--accent-primary)]" />
                              ) : (
                                <History className="size-3.5 text-[var(--accent-primary)]" />
                              )}
                              <span>
                                {isBusy && activeChannelAction === 'load_more'
                                  ? 'Đang kéo video...'
                                  : 'Đồng bộ đủ video'}
                              </span>
                            </button>

                            {isMultiTag && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setChannelAction({
                                    channelId: ch.channel_id,
                                    type: 'reclassify',
                                  });
                                  onReclassifyChannel(ch.channel_id);
                                }}
                                title="Chạy lại Gemini Vision (1 đại diện / 1 Series) cho toàn bộ video của kênh này"
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ai-accent)]/40 bg-violet-500/10 px-2.5 text-xs font-medium text-[var(--ai-accent)] transition-colors hover:bg-violet-500/20 disabled:opacity-60 cursor-pointer"
                              >
                                {isBusy && activeChannelAction === 'reclassify' ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Sparkles className="size-3.5" />
                                )}
                                <span>
                                  {isBusy && activeChannelAction === 'reclassify'
                                    ? 'Đang quét AI...'
                                    : 'Quét AI lại'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
