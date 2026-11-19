'use client';

import React, { useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VideoThumbnail } from '@/components/workspace/VideoThumbnail';
import {
  GENRE_DOT_STYLES,
  PRIMARY_GENRE_OPTIONS,
  formatDuration,
  getProgressPercent,
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

export function StructuredCinemaRows({
  authStatus,
  selectedChannelCount,
  videos,
  activeVideoId,
  viewMode,
  sectionHeading,
  sectionSubtitle,
  isLoadingExplore = false,
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
  onOpenVault,
  onTriggerGoogleSignIn,
}: StructuredCinemaRowsProps) {
  const exploreSentinelRef = useRef<HTMLDivElement>(null);
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

  const shouldObserveExploreSentinel =
    viewMode === 'explore' &&
    videos.length > 0 &&
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

  // 3b. Trạng thái: Đã đăng nhập nhưng chưa chọn kênh theo dõi nào (chỉ áp dụng ngoài tab Khám phá)
  if (viewMode !== 'explore' && selectedChannelCount === 0) {
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

  // 4. Trạng thái: Chưa có video (riêng Khám phá và Xem sau hiển thị empty gọn)
  if (videos.length === 0) {
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

  // 5. Khi có dữ liệu thực từ Supabase: hiển thị lưới khe phim tương tác
  const displayVideos =
    viewMode === 'continue'
      ? videos.filter((v) => v.progress_seconds > 0 && !v.is_completed)
      : videos;

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayVideos.map((video) => {
            const isPlaying = video.video_id === activeVideoId;
            const percent = getProgressPercent(
              video.progress_seconds,
              video.duration_seconds,
            );
            const currentPrimaryGenre: PrimaryGenreTag =
              video.detected_genre &&
              PRIMARY_GENRE_OPTIONS.includes(
                video.detected_genre as PrimaryGenreTag,
              )
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
                key={video.video_id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectVideo(video)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectVideo(video);
                  }
                }}
                className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-colors cursor-pointer ${
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
                  />

                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                    <div className="flex size-10 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-foreground)] opacity-0 transition-opacity group-hover:opacity-100">
                      <Play className="ml-0.5 size-4 fill-current" />
                    </div>
                  </div>

                  {onToggleWatchLater && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWatchLater(video.video_id);
                      }}
                      aria-label={
                        watchLaterIds?.has(video.video_id)
                          ? 'Xóa khỏi danh sách Xem sau'
                          : 'Lưu vào danh sách Xem sau'
                      }
                      title={
                        watchLaterIds?.has(video.video_id)
                          ? 'Đã lưu Xem sau — Bấm để gỡ'
                          : 'Lưu Xem sau'
                      }
                      className={`absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg backdrop-blur-sm transition-all cursor-pointer ${
                        watchLaterIds?.has(video.video_id)
                          ? 'bg-amber-500 text-black shadow-md opacity-100'
                          : 'bg-black/70 text-white/85 opacity-85 hover:bg-black/90 hover:text-white sm:opacity-0 sm:group-hover:opacity-100'
                      }`}
                    >
                      <Bookmark
                        className={`size-3.5 ${
                          watchLaterIds?.has(video.video_id)
                            ? 'fill-current'
                            : ''
                        }`}
                      />
                    </button>
                  )}

                  <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
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
                    <div className="flex items-center justify-between gap-2">
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
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">
                      {video.title}
                    </h3>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-[var(--text-secondary)]">
                      {video.channel_title || video.channel_id}
                    </p>

                    {viewMode === 'explore' &&
                      (selectedChannelIds?.has(video.channel_id) ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3" />
                          <span>Đã theo dõi</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={subscribingChannelId === video.channel_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSubscribeChannel?.(
                              video.channel_id,
                              video.channel_title,
                            );
                          }}
                          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-[var(--accent-primary)] px-2.5 text-[11px] font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
                        >
                          {subscribingChannelId === video.channel_id ? (
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
          })}
        </div>
      )}

      {viewMode === 'cinema' && displayVideos.length > 0 && (
        <div className="flex items-center justify-center pt-3 pb-4">
          <p className="py-2 text-xs text-[var(--text-secondary)]">
            Đang hiển thị toàn bộ {displayVideos.length} phim trong kho
          </p>
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
