'use client';

import React, { useEffect, useRef } from 'react';
import Image from 'next/image';
import {
  Film,
  ListVideo,
  Play,
  Flame,
  CheckCircle2,
  Loader2,
  FolderKanban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GENRE_DOT_STYLES } from '@/types/workspace';
import type { SeriesGroup } from '@/lib/series-parser';

interface SeriesGridProps {
  seriesList: SeriesGroup[];
  activeSeriesKey: string | null;
  totalEpisodesCount: number;
  totalVideosCount?: number;
  hasMoreVideos?: boolean;
  hasMoreYouTubeHistory?: boolean;
  isLoadingFeed?: boolean;
  isLoadingMoreVideos?: boolean;
  isFetchingYouTubeHistory?: boolean;
  onSelectSeries: (series: SeriesGroup) => void;
  onLoadMoreVideos?: () => void;
  onFetchMoreFromYouTube?: () => void;
  onOpenVault?: () => void;
}

export function SeriesGrid({
  seriesList,
  activeSeriesKey,
  totalEpisodesCount,
  totalVideosCount,
  hasMoreVideos = false,
  hasMoreYouTubeHistory = false,
  isLoadingFeed = false,
  isLoadingMoreVideos = false,
  isFetchingYouTubeHistory = false,
  onSelectSeries,
  onLoadMoreVideos,
  onFetchMoreFromYouTube,
  onOpenVault,
}: SeriesGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canStage1 = hasMoreVideos && Boolean(onLoadMoreVideos);
    const canStage2 =
      !hasMoreVideos && hasMoreYouTubeHistory && Boolean(onFetchMoreFromYouTube);
    if (!canStage1 && !canStage2) return;

    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          !entries[0]?.isIntersecting ||
          isLoadingMoreVideos ||
          isFetchingYouTubeHistory ||
          isLoadingFeed
        ) {
          return;
        }
        if (canStage1) {
          onLoadMoreVideos?.();
        } else if (canStage2) {
          onFetchMoreFromYouTube?.();
        }
      },
      { rootMargin: '260px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [
    hasMoreVideos,
    hasMoreYouTubeHistory,
    isLoadingMoreVideos,
    isFetchingYouTubeHistory,
    isLoadingFeed,
    onLoadMoreVideos,
    onFetchMoreFromYouTube,
  ]);
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
            Tự động gom nhóm các tập lẻ theo từng bộ phim • Ưu tiên bộ vừa ra
            tập mới nhất
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--text-secondary)]">
          {isLoadingFeed && (
            <Loader2 className="size-3.5 animate-spin text-[var(--accent-primary)]" />
          )}
          <span>
            {seriesList.length} bộ phim • Đang hiển thị {totalEpisodesCount}
            {typeof totalVideosCount === 'number' &&
            totalVideosCount > totalEpisodesCount
              ? ` / ${totalVideosCount}`
              : ''}{' '}
            tập
          </span>
        </span>
      </div>

      {isLoadingFeed && seriesList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-14 text-center">
          <Loader2 className="size-7 animate-spin text-[var(--accent-primary)]" />
          <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
            Đang tải và gom nhóm bộ phim...
          </p>
        </div>
      ) : seriesList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-12 text-center">
          <ListVideo className="size-7 text-[var(--text-secondary)]" />
          <p className="mt-2.5 text-sm font-semibold text-[var(--text-primary)]">
            Chưa có bộ phim tập lẻ nào khớp bộ lọc
          </p>
          <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Thử đổi bộ lọc thể loại, xóa từ khóa tìm kiếm hoặc kéo thêm 50 video
            cũ trong Kho Kênh Đăng Ký.
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {seriesList.map((series) => {
            const isSelected = series.seriesKey === activeSeriesKey;
            const genreStyle = GENRE_DOT_STYLES[series.detectedGenre];

            return (
              <div
                key={series.seriesKey}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSeries(series)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSeries(series);
                  }
                }}
                className="group flex flex-col text-left cursor-pointer focus:outline-none"
              >
                {/* Hiệu ứng xếp lớp phía sau (Playlist Stack) */}
                <div className="mx-3 h-1.5 rounded-t-lg border-x border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/55 transition-colors group-hover:border-[var(--accent-primary)]/40" />
                <div className="mx-1.5 h-1.5 rounded-t-lg border-x border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/85 transition-colors group-hover:border-[var(--accent-primary)]/60" />

                {/* Thân thẻ Bộ phim */}
                <div
                  className={`flex flex-1 flex-col overflow-hidden rounded-xl border transition-colors ${
                    isSelected
                      ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] group-hover:border-[var(--accent-primary)]/70'
                  }`}
                >
                  {/* Ảnh bìa tập mới nhất */}
                  <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg-elevated)]">
                    {series.coverThumbnailUrl ? (
                      <Image
                        src={series.coverThumbnailUrl}
                        alt={series.seriesTitle}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <Film className="size-6 text-[var(--text-secondary)]" />
                      </div>
                    )}

                    {/* Lớp phủ hover Play */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-foreground)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        <Play className="ml-0.5 size-5 fill-current" />
                      </div>
                    </div>

                    {/* Badge góc trái: TẬP MỚI hoặc Đã xem Tập X */}
                    <div className="absolute left-2 top-2 flex items-center gap-1">
                      {series.hasNewEpisode ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-primary)] px-2 py-0.5 text-[11px] font-bold tracking-wide text-[var(--accent-foreground)] shadow-sm">
                          <Flame className="size-3 shrink-0" />
                          <span>TẬP MỚI</span>
                        </span>
                      ) : series.lastWatchedEpisode ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-medium text-emerald-300 backdrop-blur-sm">
                          <CheckCircle2 className="size-3 shrink-0" />
                          <span>
                            Đã xem {series.lastWatchedEpisode.episodeLabel}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    {/* Badge góc phải: ≡ {totalEpisodes} tập */}
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/85 px-2 py-0.5 text-xs font-semibold tabular-nums text-white backdrop-blur-sm">
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

                    <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
                      <p className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                        {series.channelTitle}
                      </p>
                      {series.lastWatchedEpisode && series.hasNewEpisode && (
                        <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                          Đã xem {series.lastWatchedEpisode.episodeLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {seriesList.length > 0 && (
        <div
          ref={sentinelRef}
          className="flex flex-col items-center justify-center gap-2.5 pt-2 pb-4"
        >
          {hasMoreVideos && onLoadMoreVideos ? (
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingMoreVideos}
              onClick={onLoadMoreVideos}
              className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              {isLoadingMoreVideos ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin text-[var(--accent-primary)]" />
                  <span>Đang tự động tải thêm tập phim...</span>
                </>
              ) : (
                <span>Tải thêm phim để gom thêm tập cũ</span>
              )}
            </Button>
          ) : hasMoreYouTubeHistory && onFetchMoreFromYouTube ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3.5 text-center">
              <p className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                {isFetchingYouTubeHistory && (
                  <Loader2 className="size-3.5 animate-spin text-[var(--accent-primary)]" />
                )}
                <span>
                  {isFetchingYouTubeHistory
                    ? `Đã hết ${Math.max(totalEpisodesCount, totalVideosCount ?? totalEpisodesCount)} phim lưu sẵn — Đang tự động kéo thêm phim cũ từ YouTube...`
                    : `Đã hết ${Math.max(totalEpisodesCount, totalVideosCount ?? totalEpisodesCount)} phim lưu sẵn trong kho`}
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={isFetchingYouTubeHistory}
                onClick={onFetchMoreFromYouTube}
                className="h-9 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                {isFetchingYouTubeHistory ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin text-[var(--accent-primary)]" />
                    <span>Đang kéo từ YouTube...</span>
                  </>
                ) : (
                  <span>📥 Kéo thêm phim cũ từ YouTube</span>
                )}
              </Button>
            </div>
          ) : (
            <p className="py-2 text-xs text-[var(--text-secondary)]">
              Đã tải toàn bộ video từ tất cả các kênh
            </p>
          )}
        </div>
      )}
    </section>
  );
}
