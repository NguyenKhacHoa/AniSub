'use client';

import React, { useEffect, useRef, useTransition } from 'react';
import {
  Search,
  Radio,
  X,
  Compass,
  Clapperboard,
  Film,
  RefreshCw,
  Sparkles,
  ArrowUpDown,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CINEMA_FORMAT_STYLES,
  GENRE_DOT_STYLES,
  type CinemaFormatFilter,
  type GenreFilter,
  type SortOption,
  type TheatricalCategoryFilter,
  type VideoTypeFilter,
  type WorkspaceViewMode,
} from '@/types/workspace';

interface CommandHubProps {
  viewMode: WorkspaceViewMode;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  searchQuery: string;
  onChangeSearch: (value: string) => void;
  videoType: VideoTypeFilter;
  onChangeVideoType: (value: VideoTypeFilter) => void;
  showTrailers: boolean;
  onToggleTrailers: (checked: boolean) => void;
  genreFilter: GenreFilter;
  onChangeGenreFilter: (genre: GenreFilter) => void;
  cinemaFormatFilter?: CinemaFormatFilter;
  onChangeCinemaFormatFilter?: (fmt: CinemaFormatFilter) => void;
  theatricalCategory?: TheatricalCategoryFilter;
  onChangeTheatricalCategory?: (cat: TheatricalCategoryFilter) => void;
  totalTheatricalCount?: number;
  sortBy?: SortOption;
  onChangeSortBy?: (sort: SortOption) => void;
  onlyUnwatched?: boolean;
  onToggleOnlyUnwatched?: (checked: boolean) => void;
  isRealtimeConnected?: boolean;
  totalMatchingVideos: number;
  exploreKeywords?: string[];
  isLoadingExplore?: boolean;
  onRefreshExplore?: () => void;
  isDeltaSyncing?: boolean;
  onTriggerDeltaSync?: () => void;
}

const GENRE_PILLS: Array<{ value: GenreFilter; label: string }> = [
  { value: 'all', label: 'Tất cả thể loại' },
  { value: 'Phim AI', label: 'Phim AI' },
  { value: 'HH2D', label: 'HH2D' },
];

const CINEMA_FORMAT_PILLS: Array<{ value: CinemaFormatFilter; label: string }> =
  [
    { value: 'all', label: 'Tất cả định dạng' },
    { value: 'Anime / Hoạt hình', label: 'Anime / Hoạt hình' },
    { value: 'Phim Người Đóng', label: 'Phim Người Đóng' },
  ];

const THEATRICAL_CATEGORY_PILLS: Array<{
  value: TheatricalCategoryFilter;
  label: string;
}> = [
  { value: 'all', label: 'Tất cả thể loại' },
  { value: 'Hành động', label: 'Hành động' },
  { value: 'Phiêu lưu', label: 'Phiêu lưu' },
  { value: 'Giả tưởng', label: 'Giả tưởng' },
  { value: 'Tình cảm', label: 'Tình cảm' },
  { value: 'Viễn tưởng', label: 'Viễn tưởng' },
  { value: 'Hài hước', label: 'Hài hước' },
  { value: 'Tâm lý', label: 'Tâm lý' },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'longest', label: 'Dài nhất' },
  { value: 'title_asc', label: 'Tên A-Z' },
];

export function CommandHub({
  viewMode,
  onChangeViewMode,
  searchQuery,
  onChangeSearch,
  videoType,
  onChangeVideoType,
  showTrailers,
  onToggleTrailers,
  genreFilter,
  onChangeGenreFilter,
  cinemaFormatFilter = 'all',
  onChangeCinemaFormatFilter,
  theatricalCategory = 'all',
  onChangeTheatricalCategory,
  totalTheatricalCount,
  sortBy = 'newest',
  onChangeSortBy,
  onlyUnwatched = false,
  onToggleOnlyUnwatched,
  isRealtimeConnected = true,
  totalMatchingVideos,
  exploreKeywords = [],
  isLoadingExplore = false,
  onRefreshExplore,
  isDeltaSyncing = false,
  onTriggerDeltaSync,
}: CommandHubProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [isFilterPending, startFilterTransition] = useTransition();

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

  const isExplore = viewMode === 'explore';
  const isTheatrical = viewMode === 'theatrical';
  const isSubscribedSpace = !isExplore && !isTheatrical;

  return (
    <section
      aria-label="Command Hub — Thanh điều khiển và lọc nhanh"
      className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 sm:p-4"
    >
      {/* Hàng 1: Chuyển 3 Không gian chính ngang hàng (Đã đăng ký | Khám phá | Phim Chiếu Rạp) + Tìm kiếm (Ctrl+K) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Chuyển 3 Không gian Rạp Chiếu ngang hàng */}
          <div
            role="group"
            aria-label="Chuyển không gian rạp chiếu"
            className="inline-flex h-10 flex-wrap items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('cinema')}
              aria-pressed={isSubscribedSpace}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors cursor-pointer ${
                isSubscribedSpace
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Film className="size-3.5" />
              <span>Đã đăng ký</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('explore')}
              aria-pressed={isExplore}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors cursor-pointer ${
                isExplore
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Compass className="size-3.5" />
              <span>Khám phá</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('theatrical')}
              aria-pressed={isTheatrical}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors cursor-pointer ${
                isTheatrical
                  ? 'bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Clapperboard className="size-3.5" />
              <span>Phim Chiếu Rạp</span>
            </button>
          </div>

          {/* Ô tìm kiếm nhanh Ctrl+K */}
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-secondary)]" />
            <Input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder={
                isTheatrical
                  ? 'Tìm phim chiếu rạp, tên phim, kênh...'
                  : 'Tìm nhanh phim hoặc kênh...'
              }
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
        </div>

        {/* Cụm phải: Theo đúng từng không gian */}
        {isExplore ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingExplore}
              onClick={onRefreshExplore}
              className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <RefreshCw
                className={`mr-1.5 size-3.5 text-[var(--accent-primary)] ${
                  isLoadingExplore ? 'animate-spin' : ''
                }`}
              />
              <span>
                {isLoadingExplore ? 'Đang săn kênh mới...' : 'Làm mới gợi ý'}
              </span>
            </Button>
          </div>
        ) : isTheatrical ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-medium text-amber-600 dark:text-amber-300">
              <Clapperboard className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
              <span>65–165 phút • Anime &amp; Người Đóng • Không Kinh Dị</span>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2.5 lg:justify-end">
            <div className="hidden h-10 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium xl:inline-flex">
              <Radio
                className={`size-3.5 ${
                  isRealtimeConnected
                    ? 'text-emerald-500 dark:text-emerald-400 animate-pulse'
                    : 'text-[var(--text-secondary)]'
                }`}
              />
              <span className="text-[var(--text-primary)]">WebSub Live</span>
            </div>

            <Tabs
              value={videoType}
              onValueChange={(val) =>
                startFilterTransition(() =>
                  onChangeVideoType(val as VideoTypeFilter),
                )
              }
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
                  Phim Bộ
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
        )}
      </div>

      {/* Hàng 2: Thanh lọc phụ theo đúng ngữ cảnh từng không gian (không lặp lại Phim Chiếu Rạp) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
        {isExplore ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ai-accent)]">
              <Sparkles className="size-3.5" />
              <span>Từ khóa đúng gu:</span>
            </span>
            {exploreKeywords.length > 0 ? (
              exploreKeywords.map((kw) => (
                <span
                  key={kw}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
                >
                  {kw}
                </span>
              ))
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">
                Đang học từ lịch sử xem & Like YouTube của bạn...
              </span>
            )}
          </div>
        ) : isTheatrical ? (
          <div className="flex flex-1 flex-col gap-2.5">
            {/* Nhóm 1: Định dạng Phim Chiếu Rạp (Anime / Hoạt hình | Phim Người Đóng) */}
            <div
              role="group"
              aria-label="Lọc định dạng Phim Chiếu Rạp"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Định dạng:
              </span>
              {CINEMA_FORMAT_PILLS.map((pill) => {
                const active = cinemaFormatFilter === pill.value;
                const style =
                  pill.value !== 'all' ? CINEMA_FORMAT_STYLES[pill.value] : null;
                return (
                  <button
                    key={pill.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      startFilterTransition(() =>
                        onChangeCinemaFormatFilter?.(pill.value),
                      )
                    }
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? style
                          ? `${style.badgeClass} ring-1 ring-current`
                          : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{pill.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Nhóm 2: Thể loại an toàn & Sắp xếp + Chưa xem */}
            <div
              role="group"
              aria-label="Lọc thể loại Phim Chiếu Rạp"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Thể loại:
              </span>
              {THEATRICAL_CATEGORY_PILLS.map((pill) => {
                const active = theatricalCategory === pill.value;
                return (
                  <button
                    key={pill.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      startFilterTransition(() =>
                        onChangeTheatricalCategory?.(pill.value),
                      )
                    }
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{pill.label}</span>
                  </button>
                );
              })}

              {/* Bộ chọn Sắp xếp nhanh (Mới nhất / Dài nhất / Tên A-Z) */}
              {onChangeSortBy && (
                <div
                  role="group"
                  aria-label="Sắp xếp danh sách phim"
                  className="inline-flex h-8 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
                >
                  <ArrowUpDown className="mx-1.5 size-3.5 shrink-0 text-[var(--text-secondary)]" />
                  {SORT_OPTIONS.map((opt) => {
                    const active = sortBy === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          startFilterTransition(() => onChangeSortBy(opt.value))
                        }
                        className={`h-6 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Nút lọc nhanh Chưa xem */}
              {onToggleOnlyUnwatched && (
                <button
                  type="button"
                  aria-pressed={onlyUnwatched}
                  onClick={() =>
                    startFilterTransition(() =>
                      onToggleOnlyUnwatched(!onlyUnwatched),
                    )
                  }
                  title="Ẩn các phim đã xem xong (>= 90%)"
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer ${
                    onlyUnwatched
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)] text-[var(--accent-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <EyeOff className="size-3.5 shrink-0" />
                  <span>Chưa xem</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            role="group"
            aria-label="Bộ lọc danh sách phim"
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
                  onClick={() =>
                    startFilterTransition(() =>
                      onChangeGenreFilter(pill.value),
                    )
                  }
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors cursor-pointer ${
                    active
                      ? style
                        ? `${style.badgeClass} ring-1 ring-current`
                        : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-foreground)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {style && (
                    <span
                      className={`size-2 rounded-full ${style.dotClass}`}
                    />
                  )}
                  <span>{pill.label}</span>
                </button>
              );
            })}

            {/* Bộ chọn Sắp xếp nhanh (Mới nhất / Dài nhất / Tên A-Z) */}
            {onChangeSortBy && (
              <div
                role="group"
                aria-label="Sắp xếp danh sách phim"
                className="inline-flex h-8 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
              >
                <ArrowUpDown className="mx-1.5 size-3.5 shrink-0 text-[var(--text-secondary)]" />
                {SORT_OPTIONS.map((opt) => {
                  const active = sortBy === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        startFilterTransition(() => onChangeSortBy(opt.value))
                      }
                      className={`h-6 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Nút lọc nhanh Chưa xem (ẩn phim đã xem >= 90%) */}
            {onToggleOnlyUnwatched && (
              <button
                type="button"
                aria-pressed={onlyUnwatched}
                onClick={() =>
                  startFilterTransition(() =>
                    onToggleOnlyUnwatched(!onlyUnwatched),
                  )
                }
                title="Ẩn các phim hoặc bộ phim đã xem xong (>= 90%)"
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer ${
                  onlyUnwatched
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)] text-[var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                }`}
              >
                <EyeOff className="size-3.5 shrink-0" />
                <span>Chưa xem</span>
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2.5">
          {isFilterPending && (
            <Loader2 className="size-3.5 animate-spin text-[var(--accent-primary)]" />
          )}
          {!isExplore && onTriggerDeltaSync && (
            <button
              type="button"
              disabled={isDeltaSyncing}
              onClick={onTriggerDeltaSync}
              title={
                isTheatrical
                  ? 'Quét & xác minh thêm Phim Chiếu Rạp mới từ YouTube'
                  : 'Quét nhanh 10 video mới nhất của các kênh đang bật'
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-primary)]/50 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw
                className={`size-3.5 text-[var(--accent-primary)] ${
                  isDeltaSyncing ? 'animate-spin' : ''
                }`}
              />
              <span>
                {isDeltaSyncing
                  ? isTheatrical
                    ? 'Đang săn phim rạp...'
                    : 'Đang quét tập mới...'
                  : 'Cập nhật tập mới'}
              </span>
            </button>
          )}

          <span className="text-xs tabular-nums text-[var(--text-secondary)]">
            {isTheatrical ? (
              <>
                Đang hiển thị{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  {totalMatchingVideos}
                </strong>{' '}
                / Tổng{' '}
                <strong className="font-semibold text-[var(--text-primary)]">
                  {totalTheatricalCount ?? totalMatchingVideos}
                </strong>{' '}
                phim chiếu rạp
              </>
            ) : (
              <>
                <strong className="font-semibold text-[var(--text-primary)]">
                  {totalMatchingVideos}
                </strong>{' '}
                {isExplore ? 'video đề xuất' : 'khe phim sẵn sàng'}
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
