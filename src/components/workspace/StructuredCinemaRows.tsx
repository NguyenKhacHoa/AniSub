'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  FolderKanban,
  LogIn,
  Play,
  Radio,
  ShieldAlert,
  Clock,
  Lock,
  Plus,
  Check,
  Loader2,
  Compass,
  Bookmark,
  Flame,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VideoThumbnail } from '@/components/workspace/VideoThumbnail';
import {
  CINEMA_FORMAT_STYLES,
  GENRE_DOT_STYLES,
  PRIMARY_GENRE_OPTIONS,
  formatDuration,
  formatRelativeTimeVi,
  formatViewCountVi,
  getProgressPercent,
  isTheatricalMovieVideo,
  normalizeHotBadge,
  resolveCinemaFormat,
  type CinemaVideoItem,
  type PrimaryGenreTag,
  type WorkspaceAuthStatus,
  type WorkspaceViewMode,
} from '@/types/workspace';

interface StructuredCinemaRowsProps {
  authStatus: WorkspaceAuthStatus;
  selectedChannelCount: number;
  videos: CinemaVideoItem[];
  activeVideoId: string | null;
  viewMode: WorkspaceViewMode;
  sectionHeading?: string;
  sectionSubtitle?: string;
  isLoadingExplore?: boolean;
  isLoadingTheatrical?: boolean;
  isLoadingMoreTheatrical?: boolean;
  totalTheatricalCount?: number;
  onRefreshTheatrical?: () => void;
  onLoadMoreTheatrical?: () => void;
  hasMoreExplore?: boolean;
  isLoadingMoreExplore?: boolean;
  onLoadMoreExplore?: () => void;
  selectedChannelIds?: Set<string>;
  watchLaterIds?: Set<string>;
  subscribingChannelId?: string | null;
  onSelectVideo: (video: CinemaVideoItem) => void;
  onCycleVideoGenre?: (video: CinemaVideoItem, nextGenre: PrimaryGenreTag) => void;
  onToggleWatchLater?: (videoId: string) => void;
  onSubscribeChannel?: (channelId: string, channelTitle?: string) => void;
  onVideoUnavailable?: (videoId: string) => void;
  onOpenVault: () => void;
  onTriggerGoogleSignIn: () => void;
}

const STRUCTURAL_ROW_DEFINITIONS = [
  {
    id: 'realtime-episodes',
    title: 'Tập mới lên sóng',
    subtitle: 'Nhận tức thì qua YouTube WebSub & phân loại bằng Gemini AI',
    badge: 'WebSub Realtime',
    slotCount: 4,
  },
  {
    id: 'continue-watching',
    title: 'Đang cày dở',
    subtitle: 'Đồng bộ tiến độ xem theo từng tài khoản trong bảng watch_progress',
    badge: 'Watch Progress',
    slotCount: 4,
  },
  {
    id: 'full-movies',
    title: 'Phim Full / Tổng hợp',
    subtitle: 'Video thời lượng >= 40 phút hoặc trọn bộ không quảng cáo',
    badge: 'Full Movie',
    slotCount: 4,
  },
];

const PROGRESSIVE_WINDOW_STEP = 30;

interface MovieCardProps {
  video: CinemaVideoItem;
  viewMode: WorkspaceViewMode;
  isPlaying: boolean;
  isWatchLater: boolean;
  isChannelSubscribed: boolean;
  isSubscribing: boolean;
  onSelectVideo: (video: CinemaVideoItem) => void;
  onCycleVideoGenre?: (
    video: CinemaVideoItem,
    nextGenre: PrimaryGenreTag,
  ) => void;
  onToggleWatchLater?: (videoId: string) => void;
  onSubscribeChannel?: (channelId: string, channelTitle?: string) => void;
  onVideoUnavailable?: (videoId: string) => void;
}

const MovieCard = React.memo(function MovieCard({
  video,
  viewMode,
  isPlaying,
  isWatchLater,
  isChannelSubscribed,
  isSubscribing,
  onSelectVideo,
  onCycleVideoGenre,
  onToggleWatchLater,
  onSubscribeChannel,
  onVideoUnavailable,
}: MovieCardProps) {
  const percent = getProgressPercent(
    video.progress_seconds,
    video.duration_seconds,
  );
  const currentPrimaryGenre: PrimaryGenreTag =
    video.detected_genre &&
    PRIMARY_GENRE_OPTIONS.includes(video.detected_genre as PrimaryGenreTag)
      ? (video.detected_genre as PrimaryGenreTag)
      : 'HH2D';
  const nextGenre: PrimaryGenreTag =
    PRIMARY_GENRE_OPTIONS[
      (PRIMARY_GENRE_OPTIONS.indexOf(currentPrimaryGenre) + 1) %
        PRIMARY_GENRE_OPTIONS.length
    ];
  const genreStyle = GENRE_DOT_STYLES[currentPrimaryGenre];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectVideo(video)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectVideo(video);
        }
      }}
      className={`cinema-card-cv group flex flex-col overflow-hidden rounded-xl border text-left transition-colors cursor-pointer ${
        isPlaying
          ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent-primary)]/60'
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg-elevated)]">
        <VideoThumbnail
          videoId={video.video_id}
          thumbnailUrl={video.thumbnail_url}
          alt={video.title}
          sizes="(max-width: 640px) 100vw, 25vw"
          className="object-cover"
          onUnavailable={onVideoUnavailable}
        />

        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
          <div className="flex size-10 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-foreground)] opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="ml-0.5 size-4 fill-current" />
          </div>
        </div>

        {(isTheatricalMovieVideo(video) || normalizeHotBadge(video.hot_badge)) && (
          <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1 pr-10">
            {isTheatricalMovieVideo(video) && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-black/85 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-300 shadow-sm">
                <Clapperboard className="size-3 shrink-0 text-amber-400" />
                <span>CHIẾU RẠP</span>
              </span>
            )}
            {normalizeHotBadge(video.hot_badge) === 'Phim Hot' && (
              <span className="inline-flex items-center gap-1 rounded-md border border-orange-400/60 bg-orange-600/95 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white shadow-sm">
                <Flame className="size-3 shrink-0 fill-current" />
                <span>Phim Hot</span>
              </span>
            )}
            {normalizeHotBadge(video.hot_badge) === 'Đáng xem' && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-black/85 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-300 shadow-sm">
                <Star className="size-3 shrink-0 fill-current text-amber-400" />
                <span>Đáng xem</span>
              </span>
            )}
          </div>
        )}

        {onToggleWatchLater && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatchLater(video.video_id);
            }}
            aria-label={
              isWatchLater
                ? 'Xóa khỏi danh sách Xem sau'
                : 'Lưu vào danh sách Xem sau'
            }
            title={
              isWatchLater ? 'Đã lưu Xem sau — Bấm để gỡ' : 'Lưu Xem sau'
            }
            className={`absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg transition-all cursor-pointer ${
              isWatchLater
                ? 'bg-amber-500 text-black shadow-md opacity-100'
                : 'bg-black/80 text-white/85 opacity-85 hover:bg-black/95 hover:text-white sm:opacity-0 sm:group-hover:opacity-100'
            }`}
          >
            <Bookmark
              className={`size-3.5 ${isWatchLater ? 'fill-current' : ''}`}
            />
          </button>
        )}

        <span className="absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
          {formatDuration(video.duration_seconds)}
        </span>

        {percent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div
              className="h-full bg-[var(--accent-primary)]"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between p-3.5">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {viewMode === 'theatrical' ? (
              <>
                {(() => {
                  const fmt = resolveCinemaFormat(video);
                  const fmtStyle = CINEMA_FORMAT_STYLES[fmt];
                  return (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${fmtStyle.badgeClass}`}
                    >
                      {fmtStyle.label}
                    </span>
                  );
                })()}
                {Array.isArray(video.cinema_genres) &&
                  video.cinema_genres.slice(0, 2).map((g) => (
                    <span
                      key={g}
                      className="inline-flex items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
                    >
                      {g}
                    </span>
                  ))}
              </>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCycleVideoGenre?.(video, nextGenre);
                }}
                title={
                  video.is_manual_tag
                    ? `Đã khóa thủ công (${genreStyle.label}) — Bấm để đổi sang ${nextGenre}`
                    : `Bấm để đổi nhanh sang ${nextGenre}`
                }
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-85 cursor-pointer ${genreStyle.badgeClass}`}
              >
                {video.is_manual_tag && (
                  <Lock className="size-2.5 shrink-0" />
                )}
                <span>
                  {genreStyle.label}
                  {video.episode_number !== null
                    ? ` • Tập ${video.episode_number}`
                    : ''}
                </span>
              </button>
            )}
          </div>
          <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">
            {video.title}
          </h3>
        </div>

        <div className="mt-2.5 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-[var(--text-secondary)]">
              {video.channel_title || video.channel_id}
            </p>
            {(() => {
              const meta = [
                formatViewCountVi(video.view_count),
                formatRelativeTimeVi(video.published_at),
              ]
                .filter(Boolean)
                .join(' • ');
              return meta ? (
                <p className="mt-0.5 truncate text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                  {meta}
                </p>
              ) : null;
            })()}
          </div>

          {(viewMode === 'explore' || viewMode === 'theatrical') &&
            (isChannelSubscribed ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" />
                <span>Đã theo dõi</span>
              </span>
            ) : (
              <button
                type="button"
                disabled={isSubscribing}
                onClick={(e) => {
                  e.stopPropagation();
                  onSubscribeChannel?.(video.channel_id, video.channel_title);
                }}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[var(--accent-primary)] px-2.5 text-[11px] font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {isSubscribing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Plus className="size-3" />
                )}
                <span>Đăng ký kênh</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
});

export function StructuredCinemaRows({
  authStatus,
  selectedChannelCount,
  videos,
  activeVideoId,
  viewMode,
  sectionHeading,
  sectionSubtitle,
  isLoadingExplore = false,
  isLoadingTheatrical = false,
  isLoadingMoreTheatrical = false,
  totalTheatricalCount,
  onRefreshTheatrical,
  onLoadMoreTheatrical,
  hasMoreExplore = false,
  isLoadingMoreExplore = false,
  onLoadMoreExplore,
  selectedChannelIds,
  watchLaterIds,
  subscribingChannelId = null,
  onSelectVideo,
  onCycleVideoGenre,
  onToggleWatchLater,
  onSubscribeChannel,
  onVideoUnavailable,
  onOpenVault,
  onTriggerGoogleSignIn,
}: StructuredCinemaRowsProps) {
  const exploreSentinelRef = useRef<HTMLDivElement>(null);
  const windowSentinelRef = useRef<HTMLDivElement>(null);
  const exploreObserverRef = useRef({
    hasMoreExplore,
    isLoadingMoreExplore,
    isLoadingExplore,
    onLoadMoreExplore,
  });

  useEffect(() => {
    exploreObserverRef.current = {
      hasMoreExplore,
      isLoadingMoreExplore,
      isLoadingExplore,
      onLoadMoreExplore,
    };
  });

  const displayVideos = useMemo(
    () =>
      viewMode === 'continue'
        ? videos.filter((v) => v.progress_seconds > 0 && !v.is_completed)
        : videos,
    [videos, viewMode],
  );

  // Zero-Latency Progressive Window Rendering (30 thẻ/lô từ RAM, reset về 30 khi đổi tab/bộ lọc)
  const windowKey = `${viewMode}|${displayVideos.length}|${displayVideos[0]?.video_id ?? ''}`;
  const [windowState, setWindowState] = useState<{
    key: string;
    count: number;
  }>({ key: windowKey, count: PROGRESSIVE_WINDOW_STEP });

  const visibleCount =
    windowState.key === windowKey ? windowState.count : PROGRESSIVE_WINDOW_STEP;
  const renderedVideos = useMemo(
    () => displayVideos.slice(0, visibleCount),
    [displayVideos, visibleCount],
  );
  const hasMoreInMemory = visibleCount < displayVideos.length;

  useEffect(() => {
    if (!hasMoreInMemory) return;
    const node = windowSentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setWindowState((prev) => {
          const current =
            prev.key === windowKey ? prev.count : PROGRESSIVE_WINDOW_STEP;
          if (current >= displayVideos.length) return prev;
          return {
            key: windowKey,
            count: Math.min(
              displayVideos.length,
              current + PROGRESSIVE_WINDOW_STEP,
            ),
          };
        });
      },
      { rootMargin: '0px 0px 800px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreInMemory, windowKey, displayVideos.length]);

  const shouldObserveExploreSentinel =
    viewMode === 'explore' &&
    !hasMoreInMemory &&
    displayVideos.length > 0 &&
    hasMoreExplore &&
    Boolean(onLoadMoreExplore);

  useEffect(() => {
    if (!shouldObserveExploreSentinel) return;
    const node = exploreSentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const st = exploreObserverRef.current;
        if (
          st.isLoadingMoreExplore ||
          st.isLoadingExplore ||
          !st.hasMoreExplore ||
          !st.onLoadMoreExplore
        ) {
          return;
        }
        st.onLoadMoreExplore();
      },
      { rootMargin: '260px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldObserveExploreSentinel]);

  // 1. Trạng thái: Chưa đăng nhập Google
  if (authStatus === 'unauthenticated') {
    return (
      <section
        aria-label="Yêu cầu đăng nhập Google"
        className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-14 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-primary)]">
          <LogIn className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
          Chưa đăng nhập tài khoản Google
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-[var(--text-secondary)] text-pretty">
          Đăng nhập bằng Google (quyền chỉ đọc{' '}
          <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">
            youtube.readonly
          </code>
          ) và xác minh email trong bảng{' '}
          <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">
            allowed_emails
          </code>{' '}
          để kích hoạt rạp chiếu phim cá nhân AniSub.
        </p>
        <Button
          type="button"
          onClick={onTriggerGoogleSignIn}
          className="mt-5 h-11 rounded-xl bg-[var(--accent-primary)] px-5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
        >
          <LogIn className="mr-2 size-4" />
          <span>Đăng nhập bằng Google</span>
        </Button>
      </section>
    );
  }

  // 2. Trạng thái: Đã đăng nhập nhưng email chưa có trong Whitelist
  if (authStatus === 'unauthorized_whitelist') {
    return (
      <section
        aria-label="Thông báo Whitelist"
        className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-amber-500/30 bg-[var(--bg-surface)] px-6 py-14 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
          <ShieldAlert className="size-6" />
        </div>
        <span className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
          403 • Whitelist Restricted
        </span>
        <h2 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
          Tài khoản chưa được cấp quyền truy cập AniSub
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-[var(--text-secondary)] text-pretty">
          Email của bạn hiện chưa tồn tại hoặc chưa kích hoạt trong bảng{' '}
          <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-xs">
            public.allowed_emails
          </code>{' '}
          trên Supabase.
        </p>
      </section>
    );
  }

  // 3. Trạng thái: Đang tải Khám phá YouTube
  if (viewMode === 'explore' && isLoadingExplore) {
    return (
      <section
        aria-label="Đang tải đề xuất Khám phá YouTube"
        className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-16 text-center"
      >
        <Loader2 className="size-7 animate-spin text-[var(--accent-primary)]" />
        <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
          Gemini AI đang phân tích gu xem & săn kênh mới cho bạn...
        </h2>
        <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
          Đang tổng hợp lịch sử xem, video đã Like trên YouTube và lọc bỏ
          YouTube Shorts.
        </p>
      </section>
    );
  }

  // 3a. Trạng thái: Đang săn & xác minh Phim Chiếu Rạp qua Google Search Grounding
  if (viewMode === 'theatrical' && isLoadingTheatrical && videos.length === 0) {
    return (
      <section
        aria-label="Đang săn & kiểm duyệt Phim Chiếu Rạp"
        className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-16 text-center"
      >
        <Loader2 className="size-7 animate-spin text-amber-500 dark:text-amber-400" />
        <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
          Gemini AI & Google Search đang săn Phim Chiếu Rạp miễn phí trên YouTube...
        </h2>
        <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
          Đang lọc khung thời lượng chuẩn rạp (65–165 phút), xác minh phát hành
          chiếu rạp thương mại và loại bỏ phim kinh dị.
        </p>
      </section>
    );
  }

  // 3b. Trạng thái: Đã đăng nhập nhưng chưa chọn kênh theo dõi nào và không có phim hiển thị (chỉ áp dụng ở không gian Đã đăng ký)
  if (
    viewMode !== 'explore' &&
    viewMode !== 'theatrical' &&
    selectedChannelCount === 0 &&
    videos.length === 0
  ) {
    return (
      <section
        aria-label="Chưa chọn kênh theo dõi"
        className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-14 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-primary)]">
          <FolderKanban className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
          Chưa chọn kênh theo dõi trong Kho Kênh
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-[var(--text-secondary)] text-pretty">
          Mở ngăn kéo Kho Kênh Đăng Ký để đồng bộ danh sách kênh từ YouTube và
          bật theo dõi các kênh Phim AI hoặc HH2D yêu thích.
        </p>
        <Button
          type="button"
          onClick={onOpenVault}
          className="mt-5 h-11 rounded-xl bg-[var(--accent-primary)] px-5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
        >
          <FolderKanban className="mr-2 size-4" />
          <span>Mở Kho Kênh Đăng Ký</span>
        </Button>
      </section>
    );
  }

  // 4. Trạng thái: Chưa có video (riêng Khám phá, Phim Chiếu Rạp và Xem sau hiển thị empty gọn)
  if (videos.length === 0) {
    if (viewMode === 'theatrical') {
      return (
        <section
          aria-label="Kho Phim Chiếu Rạp đang cập nhật"
          className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-14 text-center"
        >
          <Clapperboard className="size-7 text-amber-500 dark:text-amber-400" />
          <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            Chưa có phim chiếu rạp nào khớp bộ lọc hiện tại
          </h2>
          <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Bấm nút &ldquo;Cập nhật tập mới&rdquo; bên dưới để hệ thống tự động
            săn và xác minh Phim Chiếu Rạp miễn phí trên toàn YouTube.
          </p>
          {onRefreshTheatrical && (
            <Button
              type="button"
              disabled={isLoadingTheatrical}
              onClick={onRefreshTheatrical}
              className="mt-4 h-10 rounded-xl bg-[var(--accent-primary)] px-4 text-xs font-semibold text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
            >
              {isLoadingTheatrical ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  <span>Đang săn Phim Chiếu Rạp...</span>
                </>
              ) : (
                <>
                  <Clapperboard className="mr-1.5 size-3.5" />
                  <span>Quét Phim Chiếu Rạp ngay</span>
                </>
              )}
            </Button>
          )}
        </section>
      );
    }

    if (viewMode === 'watch_later') {
      return (
        <section
          aria-label="Danh sách Xem sau trống"
          className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-14 text-center"
        >
          <Bookmark className="size-7 text-[var(--text-secondary)]" />
          <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            Danh sách Xem sau đang trống
          </h2>
          <p className="mt-1.5 max-w-md text-xs text-[var(--text-secondary)]">
            Bấm biểu tượng Bookmark trên bất kỳ thẻ phim nào hoặc trong trình
            phát để lưu lại cày sau.
          </p>
        </section>
      );
    }

    if (viewMode === 'explore') {
      return (
        <section
          aria-label="Chưa có video khám phá"
          className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-14 text-center"
        >
          <Compass className="size-7 text-[var(--text-secondary)]" />
          <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            Chưa có video đề xuất nào
          </h2>
          <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Bấm nút &ldquo;Làm mới gợi ý&rdquo; trên thanh Command Hub để Gemini
            AI săn kênh mới phù hợp với gu của bạn.
          </p>
        </section>
      );
    }
    const rowsToShow =
      viewMode === 'continue'
        ? STRUCTURAL_ROW_DEFINITIONS.filter((r) => r.id === 'continue-watching')
        : STRUCTURAL_ROW_DEFINITIONS;

    return (
      <section
        aria-label="Dòng chảy nội dung cấu trúc sẵn sàng nhận dữ liệu Real-time"
        className="flex flex-col gap-5"
      >
        {/* Banner trạng thái sẵn sàng kết nối Backend */}
        <div className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Radio className="size-4 animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Sẵn sàng nhận dữ liệu Real-time từ Backend
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Đang lắng nghe Supabase Realtime trên bảng{' '}
                <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5">
                  public.videos
                </code>{' '}
                cho {selectedChannelCount} kênh đã kích hoạt.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onOpenVault}
            className="h-9 shrink-0 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            <FolderKanban className="mr-1.5 size-3.5" />
            <span>Quản lý Kho Kênh</span>
          </Button>
        </div>

        {/* Các hàng khung giữ chỗ cấu trúc (không dùng ảnh giả) */}
        {rowsToShow.map((row) => (
          <div key={row.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {row.title}
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {row.subtitle}
                </p>
              </div>
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                {row.badge}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: row.slotCount }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex flex-col overflow-hidden rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)]/60"
                >
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-[var(--bg-elevated)] px-3 text-center">
                    <Clapperboard className="size-5 text-[var(--text-secondary)]" />
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Khe chờ dữ liệu Real-time #{idx + 1}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 p-3">
                    <div className="h-3.5 w-3/4 rounded bg-[var(--bg-elevated)]" />
                    <div className="h-3 w-1/2 rounded bg-[var(--bg-elevated)]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  }

  // 5. Khi có dữ liệu thực từ Supabase: hiển thị lưới khe phim tương tác (30 thẻ/lô cuốn chiếu 0ms từ RAM)
  return (
    <section aria-label="Danh sách khe phim" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {sectionHeading ||
              (viewMode === 'continue'
                ? 'Đang cày dở'
                : viewMode === 'watch_later'
                  ? 'Danh sách Xem sau'
                  : 'Kho phim cập nhật')}
          </h2>
          {sectionSubtitle && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {sectionSubtitle}
            </p>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--text-secondary)]">
          <span>
            {viewMode === 'explore'
              ? `${displayVideos.length} video`
              : `Đang hiển thị ${displayVideos.length} phim`}
          </span>
        </span>
      </div>

      {displayVideos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10 text-center">
          <Clock className="size-7 text-[var(--text-secondary)]" />
          <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
            Không có video nào đang xem dở
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {renderedVideos.map((video) => (
              <MovieCard
                key={video.video_id}
                video={video}
                viewMode={viewMode}
                isPlaying={video.video_id === activeVideoId}
                isWatchLater={Boolean(watchLaterIds?.has(video.video_id))}
                isChannelSubscribed={Boolean(
                  selectedChannelIds?.has(video.channel_id),
                )}
                isSubscribing={subscribingChannelId === video.channel_id}
                onSelectVideo={onSelectVideo}
                onCycleVideoGenre={onCycleVideoGenre}
                onToggleWatchLater={onToggleWatchLater}
                onSubscribeChannel={onSubscribeChannel}
                onVideoUnavailable={onVideoUnavailable}
              />
            ))}
          </div>

          {/* Sentinel cuốn chiếu 30 thẻ từ RAM (rootMargin 800px — 0ms, không skeleton/spinner) */}
          {hasMoreInMemory && (
            <div
              ref={windowSentinelRef}
              aria-hidden="true"
              className="h-4 w-full"
            />
          )}
        </>
      )}

      {viewMode === 'cinema' && displayVideos.length > 0 && !hasMoreInMemory && (
        <div className="flex items-center justify-center pt-3 pb-4">
          <p className="py-2 text-xs text-[var(--text-secondary)]">
            Đang hiển thị toàn bộ {displayVideos.length} phim trong kho
          </p>
        </div>
      )}

      {/* Nút Tải thêm phim chiếu rạp không giới hạn khi đã hiển thị hết phim trong RAM */}
      {viewMode === 'theatrical' &&
        displayVideos.length > 0 &&
        !hasMoreInMemory && (
          <div className="flex flex-col items-center justify-center gap-2.5 pt-3 pb-5">
            <p className="text-xs tabular-nums text-[var(--text-secondary)]">
              Đang hiển thị{' '}
              <strong className="font-semibold text-[var(--text-primary)]">
                {displayVideos.length}
            </strong>{' '}
            / Tổng{' '}
            <strong className="font-semibold text-[var(--text-primary)]">
              {totalTheatricalCount ?? displayVideos.length}
            </strong>{' '}
            phim chiếu rạp
          </p>
          {onLoadMoreTheatrical && (
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingTheatrical || isLoadingMoreTheatrical}
              onClick={onLoadMoreTheatrical}
              className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-primary)]/60 hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              {isLoadingTheatrical || isLoadingMoreTheatrical ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin text-[var(--accent-primary)]" />
                  <span>Đang săn &amp; xác minh thêm phim chiếu rạp...</span>
                </>
              ) : (
                <>
                  <Clapperboard className="mr-2 size-4 text-amber-500 dark:text-amber-400" />
                  <span>Tải thêm phim chiếu rạp</span>
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Cuộn vô hạn & nút Khám phá thêm phim mới dành riêng cho tab Khám phá YouTube */}
      {viewMode === 'explore' && displayVideos.length > 0 && (
        <div
          ref={exploreSentinelRef}
          className="flex flex-col items-center justify-center gap-2 pt-3 pb-5"
        >
          {hasMoreExplore && onLoadMoreExplore ? (
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingMoreExplore}
              onClick={onLoadMoreExplore}
              className="h-10 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-primary)]/60 hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              {isLoadingMoreExplore ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin text-[var(--accent-primary)]" />
                  <span>Đang săn thêm phim mới...</span>
                </>
              ) : (
                <span>Khám phá thêm phim mới</span>
              )}
            </Button>
          ) : (
            <p className="py-2 text-xs text-[var(--text-secondary)]">
              Đã hiển thị hết gợi ý hiện tại — Bấm &quot;Làm mới gợi ý&quot; để săn thêm kênh mới
            </p>
          )}
        </div>
      )}
    </section>
  );
}
