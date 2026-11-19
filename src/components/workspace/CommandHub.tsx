'use client';

import React, { useEffect, useRef } from 'react';
import { Search, Radio, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  GENRE_DOT_STYLES,
  type GenreFilter,
  type VideoTypeFilter,
} from '@/types/workspace';

interface CommandHubProps {
  searchQuery: string;
  onChangeSearch: (value: string) => void;
  videoType: VideoTypeFilter;
  onChangeVideoType: (value: VideoTypeFilter) => void;
  showTrailers: boolean;
  onToggleTrailers: (checked: boolean) => void;
  genreFilter: GenreFilter;
  onChangeGenreFilter: (genre: GenreFilter) => void;
  isRealtimeConnected?: boolean;
  totalMatchingVideos: number;
}

const GENRE_PILLS: Array<{ value: GenreFilter; label: string }> = [
  { value: 'all', label: 'Tất cả thể loại' },
  { value: 'Phim AI', label: 'Phim AI' },
  { value: 'HH2D', label: 'HH2D' },
  { value: 'Hoạt hình cát', label: 'Hoạt hình cát' },
];

export function CommandHub({
  searchQuery,
  onChangeSearch,
  videoType,
  onChangeVideoType,
  showTrailers,
  onToggleTrailers,
  genreFilter,
  onChangeGenreFilter,
  isRealtimeConnected = true,
  totalMatchingVideos,
}: CommandHubProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <section
      aria-label="Command Hub — Thanh điều khiển và lọc nhanh"
      className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 sm:p-4"
    >
      {/* Hàng 1: Tìm kiếm (Ctrl+K) + Trạng thái WebSub Live + Tabs Dạng phim + Switch Hiện Trailer */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Ô tìm kiếm nhanh Ctrl+K */}
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-secondary)]" />
            <Input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder="Tìm nhanh phim, series hoặc kênh..."
              aria-label="Tìm kiếm nhanh phim hoặc kênh"
              className="h-10 w-full rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-9 pr-16 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => onChangeSearch('')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)] sm:inline-block">
                Ctrl + K
              </kbd>
            )}
          </div>

          {/* Trạng thái WebSub Live */}
          <div className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium">
            <Radio
              className={`size-3.5 ${
                isRealtimeConnected
                  ? 'text-emerald-500 dark:text-emerald-400 animate-pulse'
                  : 'text-[var(--text-secondary)]'
              }`}
            />
            <span className="text-[var(--text-primary)]">WebSub Live</span>
          </div>
        </div>

        {/* Cụm Tab dạng phim + Switch Hiện Trailer */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 lg:justify-end">
          <Tabs
            value={videoType}
            onValueChange={(val) => onChangeVideoType(val as VideoTypeFilter)}
          >
            <TabsList className="h-10 rounded-xl bg-[var(--bg-canvas)] p-1">
              <TabsTrigger
                value="all"
                className="rounded-lg px-3 text-xs font-medium data-[state=active]:bg-[var(--accent-primary)] data-[state=active]:text-[var(--accent-foreground)] cursor-pointer"
              >
                Tất cả
              </TabsTrigger>
              <TabsTrigger
                value="episode"
                className="rounded-lg px-3 text-xs font-medium data-[state=active]:bg-[var(--accent-primary)] data-[state=active]:text-[var(--accent-foreground)] cursor-pointer"
              >
                Tập mới
              </TabsTrigger>
              <TabsTrigger
                value="full_movie"
                className="rounded-lg px-3 text-xs font-medium data-[state=active]:bg-[var(--accent-primary)] data-[state=active]:text-[var(--accent-foreground)] cursor-pointer"
              >
                Phim Full
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-secondary)] cursor-pointer">
            <span>Hiện Trailer</span>
            <Switch
              checked={showTrailers}
              onCheckedChange={onToggleTrailers}
              aria-label="Hiện Trailer"
            />
          </label>
        </div>
      </div>

      {/* Hàng 2: Các pill lọc thể loại + Bộ đếm video */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
        <div
          role="group"
          aria-label="Lọc theo thể loại"
          className="flex flex-wrap items-center gap-2"
        >
          {GENRE_PILLS.map((pill) => {
            const active = genreFilter === pill.value;
            const style =
              pill.value !== 'all' ? GENRE_DOT_STYLES[pill.value] : null;

            return (
              <button
                key={pill.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChangeGenreFilter(pill.value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? style
                      ? `${style.badgeClass} ring-1 ring-current`
                      : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                }`}
              >
                {style && (
                  <span className={`size-2 rounded-full ${style.dotClass}`} />
                )}
                <span>{pill.label}</span>
              </button>
            );
          })}
        </div>

        <span className="text-xs tabular-nums text-[var(--text-secondary)]">
          <strong className="font-semibold text-[var(--text-primary)]">
            {totalMatchingVideos}
          </strong>{' '}
          khe phim sẵn sàng
        </span>
      </div>
    </section>
  );
}
