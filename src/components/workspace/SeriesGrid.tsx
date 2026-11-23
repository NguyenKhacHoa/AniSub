'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  ListVideo,
  Play,
  Flame,
  CheckCircle2,
  FolderKanban,
  Star,
  EyeOff,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VideoThumbnail } from '@/components/workspace/VideoThumbnail';
import { GENRE_DOT_STYLES, type SortOption } from '@/types/workspace';
import { isTheatricalSeries, type SeriesGroup } from '@/lib/series-parser';
import type { UserSeriesStatus } from '@/types/database';

const PROGRESSIVE_WINDOW_STEP = 30;

interface SeriesGridProps {
  seriesList: SeriesGroup[];
  activeSeriesKey: string | null;
  totalEpisodesCount: number;
  seriesStatuses: Record<string, UserSeriesStatus>;
  sortBy?: SortOption;
  onSelectSeries: (series: SeriesGroup) => void;
  onUpdateSeriesStatus: (
    series: SeriesGroup,
    nextStatus: UserSeriesStatus | null,
  ) => void;
  onVideoUnavailable?: (videoId: string) => void;
  onOpenVault?: () => void;
}

interface SeriesCardProps {
  series: SeriesGroup;
  isSelected: boolean;
  status: UserSeriesStatus | null;
  isHiddenView: boolean;
  onSelectSeries: (series: SeriesGroup) => void;
  onUpdateSeriesStatus: (
    series: SeriesGroup,
    nextStatus: UserSeriesStatus | null,
  ) => void;
  onVideoUnavailable?: (videoId: string) => void;
}

const SeriesCard = React.memo(function SeriesCard({
  series,
  isSelected,
  status,
  isHiddenView,
  onSelectSeries,
  onUpdateSeriesStatus,
  onVideoUnavailable,
}: SeriesCardProps) {
  const genreStyle = GENRE_DOT_STYLES[series.detectedGenre];
  const isFollowing = status === 'following';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectSeries(series)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectSeries(series);
        }
      }}
      className="cinema-card-cv group flex flex-col text-left cursor-pointer focus:outline-none"
    >
      {/* Hiệu ứng xếp lớp phía sau (Playlist Stack) */}
      <div
        className={`mx-3 h-1.5 rounded-t-lg border-x border-t transition-colors ${
          isFollowing
            ? 'border-amber-500/40 bg-amber-500/15'
            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 group-hover:border-[var(--accent-primary)]/40'
        }`}
      />
      <div
        className={`mx-1.5 h-1.5 rounded-t-lg border-x border-t transition-colors ${
          isFollowing
            ? 'border-amber-500/60 bg-amber-500/20'
            : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/85 group-hover:border-[var(--accent-primary)]/60'
        }`}
      />

      {/* Thân thẻ Bộ phim */}
      <div
        className={`flex flex-1 flex-col overflow-hidden rounded-xl border transition-colors ${
          isSelected
            ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)]'
            : isFollowing
              ? 'border-amber-500/55 bg-[var(--bg-surface)] group-hover:border-amber-400'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] group-hover:border-[var(--accent-primary)]/70'
        }`}
      >
        {/* Ảnh bìa tập mới nhất */}
        <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg-elevated)]">
          <VideoThumbnail
            videoId={series.latestEpisode.video.video_id}
            thumbnailUrl={series.coverThumbnailUrl}
            alt={series.seriesTitle}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onUnavailable={onVideoUnavailable}
          />

          {/* Lớp phủ hover Play */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
            <div className="flex size-11 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-foreground)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              <Play className="ml-0.5 size-5 fill-current" />
            </div>
          </div>

          {/* Badge góc trái: ⭐ Theo dõi / 🎬 CHIẾU RẠP / 🔥 TẬP MỚI / Đã xem (nền đặc bg-black/85 không blur nặng GPU) */}
          <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
            {isFollowing && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-black shadow-sm">
                <Star className="size-3 fill-current" />
                <span>THEO DÕI</span>
              </span>
            )}
            {isTheatricalSeries(series) && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-black/85 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-300 shadow-sm">
                <Clapperboard className="size-3 shrink-0 text-amber-400" />
                <span>CHIẾU RẠP</span>
              </span>
            )}
            {series.hasNewEpisode ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-bold tracking-wide text-[var(--accent-foreground)] shadow-sm">
                <Flame className="size-3 shrink-0" />
                <span>TẬP MỚI</span>
              </span>
            ) : series.lastWatchedEpisode ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                <CheckCircle2 className="size-3 shrink-0" />
                <span>Đã xem {series.lastWatchedEpisode.episodeLabel}</span>
              </span>
            ) : null}
          </div>

          {/* Badge góc phải: ≡ {totalEpisodes} tập */}
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/85 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
            <ListVideo className="size-3.5 shrink-0" />
            <span>{series.totalEpisodes} tập</span>
          </span>
        </div>

        {/* Thông tin bộ phim */}
        <div className="flex flex-1 flex-col justify-between gap-2.5 p-3.5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${genreStyle.badgeClass}`}
              >
                <span
                  className={`size-1.5 rounded-full ${genreStyle.dotClass}`}
                />
                <span>{genreStyle.label}</span>
              </span>

              <span className="truncate text-[11px] font-medium text-[var(--accent-primary)]">
                Mới nhất: {series.latestEpisode.episodeLabel}
              </span>
            </div>

            <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">
              {series.seriesTitle}
            </h3>
          </div>

          <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                {series.channelTitle}
              </p>
              {series.lastWatchedEpisode && series.hasNewEpisode && (
                <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                  Đã xem {series.lastWatchedEpisode.episodeLabel}
                </span>
              )}
            </div>

            {/* Nút hành động Optimistic UI 0ms: ⭐ Theo dõi & Ẩn / Hiện lại */}
            <div className="flex items-center gap-1.5">
              {isHiddenView ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSeriesStatus(series, null);
                  }}
                  className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <Eye className="size-3.5" />
                  <span>Hiện lại bộ phim</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateSeriesStatus(
                        series,
                        isFollowing ? null : 'following',
                      );
                    }}
                    className={`inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors cursor-pointer ${
                      isFollowing
                        ? 'border-amber-500/50 bg-amber-500/15 text-amber-500 dark:text-amber-300'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Star
                      className={`size-3 shrink-0 ${
                        isFollowing ? 'fill-current' : ''
                      }`}
                    />
                    <span>{isFollowing ? 'Đang theo dõi' : 'Theo dõi'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateSeriesStatus(series, 'hidden');
                    }}
                    title="Ẩn bớt bộ phim này khỏi danh sách chính"
                    className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer"
                  >
                    <EyeOff className="size-3 shrink-0" />
                    <span>Ẩn</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export function SeriesGrid({
  seriesList,
  activeSeriesKey,
  totalEpisodesCount,
  seriesStatuses,
  sortBy = 'newest',
  onSelectSeries,
  onUpdateSeriesStatus,
  onVideoUnavailable,
  onOpenVault,
}: SeriesGridProps) {
  const [showHiddenSection, setShowHiddenSection] = useState(false);

  // Phân tách danh sách:
  // 1) Bộ phim đang hiển thị (ghim nhóm ⭐ Theo dõi lên đầu tiên, nổi bật bộ có tập mới)
  // 2) Bộ phim đã ẩn (hidden) để có thể khôi phục ở cuối trang
  const { visibleSeries, hiddenSeries, followingCount } = useMemo(() => {
    const visible: SeriesGroup[] = [];
    const hidden: SeriesGroup[] = [];

    for (const s of seriesList) {
      if (seriesStatuses[s.seriesKey] === 'hidden') {
        hidden.push(s);
      } else {
        visible.push(s);
      }
    }

    visible.sort((a, b) => {
      const aFollow = seriesStatuses[a.seriesKey] === 'following';
      const bFollow = seriesStatuses[b.seriesKey] === 'following';
      if (aFollow !== bFollow) return aFollow ? -1 : 1;

      if (sortBy === 'title_asc') {
        return a.seriesTitle.localeCompare(b.seriesTitle, 'vi');
      }
      if (sortBy === 'longest') {
        const aMax = Math.max(
          ...a.episodes.map((ep) => ep.video.duration_seconds),
          0,
        );
        const bMax = Math.max(
          ...b.episodes.map((ep) => ep.video.duration_seconds),
          0,
        );
        if (bMax !== aMax) return bMax - aMax;
        return b.totalEpisodes - a.totalEpisodes;
      }

      if (a.hasNewEpisode !== b.hasNewEpisode) return a.hasNewEpisode ? -1 : 1;
      return (
        new Date(b.latestPublishedAt).getTime() -
        new Date(a.latestPublishedAt).getTime()
      );
    });

    const fCount = visible.filter(
      (s) => seriesStatuses[s.seriesKey] === 'following',
    ).length;

    return {
      visibleSeries: visible,
      hiddenSeries: hidden,
      followingCount: fCount,
    };
  }, [seriesList, seriesStatuses, sortBy]);

  // Zero-Latency Progressive Window Rendering (cụm 30 thẻ từ RAM, tự động reset về 30 khi đổi bộ lọc)
  const windowKey = `${sortBy}|${seriesList.length}|${seriesList[0]?.seriesKey ?? ''}`;
  const [windowState, setWindowState] = useState<{
    key: string;
    count: number;
  }>({ key: windowKey, count: PROGRESSIVE_WINDOW_STEP });

  const visibleCount =
    windowState.key === windowKey ? windowState.count : PROGRESSIVE_WINDOW_STEP;
  const renderedSeries = useMemo(
    () => visibleSeries.slice(0, visibleCount),
    [visibleSeries, visibleCount],
  );
  const hasMoreInMemory = visibleCount < visibleSeries.length;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMoreInMemory) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setWindowState((prev) => {
          const currentCount =
            prev.key === windowKey ? prev.count : PROGRESSIVE_WINDOW_STEP;
          if (currentCount >= visibleSeries.length) return prev;
          return {
            key: windowKey,
            count: Math.min(
              visibleSeries.length,
              currentCount + PROGRESSIVE_WINDOW_STEP,
            ),
          };
        });
      },
      { rootMargin: '0px 0px 800px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreInMemory, windowKey, visibleSeries.length]);

  return (
    <section
      aria-label="Danh sách Bộ phim theo Series"
      className="flex flex-col gap-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Danh sách Bộ phim (Series Playlist)
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Ghim các bộ ⭐ Theo dõi lên đầu • Ưu tiên bộ vừa ra tập mới nhất
          </p>
        </div>
        <span className="inline-flex items-center gap-2 text-xs tabular-nums text-[var(--text-secondary)]">
          {followingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500 dark:text-amber-300">
              <Star className="size-3 fill-current" />
              <span>{followingCount} theo dõi</span>
            </span>
          )}
          <span>
            {visibleSeries.length} bộ phim • {totalEpisodesCount} tập
          </span>
        </span>
      </div>

      {visibleSeries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-12 text-center">
          <ListVideo className="size-7 text-[var(--text-secondary)]" />
          <p className="mt-2.5 text-sm font-semibold text-[var(--text-primary)]">
            Chưa có bộ phim tập lẻ nào khớp bộ lọc
          </p>
          <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Thử đổi bộ lọc thể loại, xóa từ khóa tìm kiếm hoặc bật thêm kênh
            trong Kho Kênh Đăng Ký.
          </p>
          {onOpenVault && (
            <Button
              type="button"
              variant="outline"
              onClick={onOpenVault}
              className="mt-4 h-9 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <FolderKanban className="mr-1.5 size-3.5" />
              <span>Mở Kho Kênh Đăng Ký</span>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {renderedSeries.map((series) => (
              <SeriesCard
                key={series.seriesKey}
                series={series}
                isSelected={series.seriesKey === activeSeriesKey}
                status={seriesStatuses[series.seriesKey] ?? null}
                isHiddenView={false}
                onSelectSeries={onSelectSeries}
                onUpdateSeriesStatus={onUpdateSeriesStatus}
                onVideoUnavailable={onVideoUnavailable}
              />
            ))}
          </div>
          {hasMoreInMemory && (
            <div ref={sentinelRef} aria-hidden="true" className="h-4 w-full" />
          )}
        </>
      )}

      {/* Khu vực cuối trang: Bộ đếm + Nút Hiện X bộ đã ẩn */}
      <div className="flex flex-col items-center justify-center gap-3 pt-2 pb-4">
        {visibleSeries.length > 0 && !hasMoreInMemory && (
          <p className="text-xs text-[var(--text-secondary)]">
            Đang hiển thị trọn bộ {visibleSeries.length} bộ phim (
            {totalEpisodesCount} tập) trong kho
          </p>
        )}

        {hiddenSeries.length > 0 && (
          <div className="flex w-full flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setShowHiddenSection((prev) => !prev)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {showHiddenSection ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              <span>
                {showHiddenSection
                  ? `Thu gọn ${hiddenSeries.length} bộ đã ẩn`
                  : `Hiện ${hiddenSeries.length} bộ đã ẩn`}
              </span>
            </button>

            {showHiddenSection && (
              <div className="grid w-full grid-cols-1 gap-4 opacity-85 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {hiddenSeries.map((series) => (
                  <SeriesCard
                    key={series.seriesKey}
                    series={series}
                    isSelected={series.seriesKey === activeSeriesKey}
                    status={seriesStatuses[series.seriesKey] ?? null}
                    isHiddenView={true}
                    onSelectSeries={onSelectSeries}
                    onUpdateSeriesStatus={onUpdateSeriesStatus}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
