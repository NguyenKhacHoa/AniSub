'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Maximize2,
  RectangleHorizontal,
  Minimize2,
  X,
  SkipForward,
  Sparkles,
  Clock,
  CheckCircle2,
  Loader2,
  Plus,
  Check,
  Play,
  ArrowUpDown,
  ListVideo,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useYouTubePlayer } from '@/hooks/useYouTubePlayer';
import {
  GENRE_DOT_STYLES,
  formatDuration,
  getProgressPercent,
  type CinemaVideoItem,
} from '@/types/workspace';
import type { SeriesGroup } from '@/lib/series-parser';

interface TheaterStageProps {
  video: CinemaVideoItem;
  nextVideo: CinemaVideoItem | null;
  activeSeries?: SeriesGroup | null;
  isChannelSubscribed?: boolean;
  isSubscribingChannel?: boolean;
  onSubscribeChannel?: (channelId: string, channelTitle?: string) => void;
  onSelectVideo: (video: CinemaVideoItem) => void;
  onSaveProgress: (
    videoId: string,
    progressSeconds: number,
    durationSeconds: number,
  ) => void;
  onSummaryGenerated: (videoId: string, aiSummary: string) => void;
  onClose: () => void;
}

export function TheaterStage({
  video,
  nextVideo,
  activeSeries = null,
  isChannelSubscribed = true,
  isSubscribingChannel = false,
  onSubscribeChannel,
  onSelectVideo,
  onSaveProgress,
  onSummaryGenerated,
  onClose,
}: TheaterStageProps) {
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [isTheaterWide, setIsTheaterWide] = useState(false);
  const [showAiSummary, setShowAiSummary] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [playlistSortOrder, setPlaylistSortOrder] = useState<'desc' | 'asc'>(
    'desc',
  );

  // Sắp xếp danh sách tập theo lựa chọn: Mới nhất trước (desc) <-> Từ Tập 1 (asc)
  const orderedSeriesEpisodes = useMemo(() => {
    if (!activeSeries) return [];
    if (playlistSortOrder === 'desc') return activeSeries.episodes;
    return [...activeSeries.episodes].reverse();
  }, [activeSeries, playlistSortOrder]);

  // Tập tiếp theo trong Series (theo thứ tự tăng dần từ Tập 1 -> Tập cuối)
  const effectiveNextVideo = useMemo(() => {
    if (activeSeries && activeSeries.episodes.length > 1) {
      const asc = [...activeSeries.episodes].reverse();
      const idx = asc.findIndex((ep) => ep.video.video_id === video.video_id);
      if (idx >= 0 && idx + 1 < asc.length) {
        return asc[idx + 1].video;
      }
      return null;
    }
    return nextVideo;
  }, [activeSeries, video.video_id, nextVideo]);

  const handleVideoEnded = useCallback(() => {
    if (!effectiveNextVideo) return;
    toast.info(`Đang tự động chuyển sang tập tiếp theo...`);
    onSelectVideo(effectiveNextVideo);
  }, [effectiveNextVideo, onSelectVideo]);

  const { containerRef, currentTime, duration, isPlaying } = useYouTubePlayer({
    videoId: video.video_id,
    initialProgressSeconds: video.progress_seconds,
    initialDurationSeconds: video.duration_seconds,
    onSaveProgress,
    onEnded: handleVideoEnded,
  });

  const handleToggleFullscreen = () => {
    const el = fullscreenContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  // Phím tắt F (Full Screen), T (Theater Wide Mode), Escape (Đóng trình phát)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (key === 't') {
        e.preventDefault();
        setIsTheaterWide((prev) => !prev);
      } else if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const effectiveDuration = duration > 0 ? duration : video.duration_seconds;
  const progressPercent = getProgressPercent(currentTime, effectiveDuration);
  const isCompletedLive = video.is_completed || progressPercent >= 90;

  const genreStyle =
    video.detected_genre === 'Phim AI' || video.detected_genre === 'HH2D'
      ? GENRE_DOT_STYLES[video.detected_genre]
      : null;

  const summaryBullets = video.ai_summary
    ? video.ai_summary
        .split('\n')
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const handleToggleAiSummary = async () => {
    if (showAiSummary) {
      setShowAiSummary(false);
      return;
    }

    setShowAiSummary(true);

    // Đã có cache trong DB -> hiển thị ngay không gọi lại API
    if (video.ai_summary?.trim()) {
      return;
    }

    setIsSummarizing(true);
    try {
      const res = await fetch('/api/videos/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.video_id }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        aiSummary?: string;
        error?: string;
      };

      if (!res.ok || !payload.aiSummary) {
        toast.error(payload.error || 'Không thể tóm tắt video bằng Gemini AI.');
        return;
      }

      onSummaryGenerated(video.video_id, payload.aiSummary);
    } catch {
      toast.error('Lỗi kết nối khi gọi Gemini AI tóm tắt.');
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <section
      aria-label="Sân khấu trình chiếu Theater Stage"
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 transition-all duration-300 sm:p-4"
    >
      {/* Thanh điều khiển trên cùng của Theater Stage */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {genreStyle && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${genreStyle.badgeClass}`}
            >
              <span className={`size-1.5 rounded-full ${genreStyle.dotClass}`} />
              <span>{genreStyle.label}</span>
            </span>
          )}
          {video.episode_number !== null && (
            <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--text-primary)]">
              Tập {video.episode_number}
            </span>
          )}
          <span className="text-xs text-[var(--text-secondary)]">
            {activeSeries?.seriesTitle ||
              video.series_name ||
              video.channel_title ||
              'Đang trình chiếu'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsTheaterWide((prev) => !prev)}
            title="Chế độ Rạp rộng (Phím T)"
            className={`h-8 rounded-lg border-[var(--border-subtle)] px-2.5 text-xs font-medium cursor-pointer ${
              isTheaterWide
                ? 'bg-[var(--accent-soft)] text-[var(--accent-primary)] border-[var(--accent-primary)]'
                : 'bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {isTheaterWide ? (
              <Minimize2 className="mr-1.5 size-3.5" />
            ) : (
              <RectangleHorizontal className="mr-1.5 size-3.5" />
            )}
            <span>{isTheaterWide ? 'Thu gọn (T)' : 'Rạp rộng (T)'}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleToggleFullscreen}
            title="Toàn màn hình (Phím F)"
            className="h-8 rounded-lg border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Maximize2 className="mr-1.5 size-3.5" />
            <span>Full Screen (F)</span>
          </Button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng trình phát (Esc)"
            title="Đóng trình phát (Esc)"
            className="flex size-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Bố cục 2 cột (hoặc bung Rạp rộng 100% khi isTheaterWide = true) */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          isTheaterWide ? '' : 'lg:grid-cols-12'
        }`}
      >
        {/* CỘT TRÁI: Khung YouTube IFrame Player API 16:9 */}
        <div className={isTheaterWide ? 'w-full' : 'lg:col-span-8'}>
          <div
            ref={fullscreenContainerRef}
            className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black"
          >
            <div ref={containerRef} className="size-full" />
          </div>
        </div>

        {/* CỘT PHẢI: Chế độ Playlist Bộ phim (cuộn dọc cố định chiều cao) HOẶC Thông tin video lẻ */}
        {activeSeries ? (
          <div
            className={`${
              isTheaterWide
                ? 'w-full'
                : 'lg:relative lg:col-span-4'
            }`}
          >
            <div
              className={`flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] ${
                isTheaterWide
                  ? 'max-h-[420px]'
                  : 'max-h-[420px] lg:absolute lg:inset-0 lg:max-h-none'
              }`}
            >
              {/* Header Playlist */}
              <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent-primary)]">
                      <ListVideo className="size-3.5 shrink-0" />
                      <span>Danh sách phát • {activeSeries.totalEpisodes} tập</span>
                    </div>
                    <h1 className="mt-0.5 line-clamp-1 text-sm font-semibold text-[var(--text-primary)]">
                      {activeSeries.seriesTitle}
                    </h1>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setPlaylistSortOrder((prev) =>
                        prev === 'desc' ? 'asc' : 'desc',
                      )
                    }
                    title="Đảo chiều sắp xếp danh sách tập"
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <ArrowUpDown className="size-3 shrink-0" />
                    <span>
                      {playlistSortOrder === 'desc'
                        ? 'Mới nhất'
                        : 'Từ Tập 1'}
                    </span>
                  </button>
                </div>

                {/* Tiến độ thời gian thực gọn + Nút Tập tiếp theo & Tóm tắt AI */}
                <div className="mt-2.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 font-medium tabular-nums text-[var(--text-secondary)]">
                      <Clock
                        className={`size-3 ${
                          isPlaying
                            ? 'text-[var(--accent-primary)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      />
                      <span>
                        {formatDuration(currentTime)} /{' '}
                        {formatDuration(effectiveDuration)} ({progressPercent}%)
                      </span>
                    </span>
                    {isCompletedLive && (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-500 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" />
                        <span>Đã xem</span>
                      </span>
                    )}
                  </div>

                  <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                    <div
                      className="h-full bg-[var(--accent-primary)] transition-[width] duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    {effectiveNextVideo && (
                      <Button
                        type="button"
                        onClick={() => onSelectVideo(effectiveNextVideo)}
                        className="h-8 flex-1 rounded-lg bg-[var(--accent-primary)] px-2.5 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                      >
                        <span>Tập tiếp theo</span>
                        <SkipForward className="ml-1.5 size-3.5" />
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSummarizing}
                      onClick={handleToggleAiSummary}
                      aria-expanded={showAiSummary}
                      className={`h-8 rounded-lg border px-2.5 text-xs font-medium cursor-pointer ${
                        effectiveNextVideo ? 'shrink-0' : 'flex-1'
                      } ${
                        showAiSummary
                          ? 'border-[var(--ai-accent)] bg-violet-500/15 text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                    >
                      {isSummarizing ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin text-[var(--ai-accent)]" />
                      ) : (
                        <Sparkles className="mr-1.5 size-3.5 text-[var(--ai-accent)]" />
                      )}
                      <span>Tóm tắt AI</span>
                    </Button>
                  </div>

                  {showAiSummary && (
                    <div className="rounded-lg border border-[var(--ai-accent)]/40 bg-[var(--bg-canvas)] p-2.5">
                      <p className="text-[11px] font-semibold text-[var(--ai-accent)]">
                        Tóm tắt Gemini AI (Không Spoil)
                      </p>
                      {isSummarizing ? (
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                          <Loader2 className="size-3 animate-spin text-[var(--ai-accent)]" />
                          <span>Đang phân tích...</span>
                        </div>
                      ) : summaryBullets.length > 0 ? (
                        <ul className="mt-1.5 flex flex-col gap-1 text-[11px] text-[var(--text-primary)]">
                          {summaryBullets.map((line, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                          Bấm lại nút Tóm tắt AI để tạo nội dung.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Danh sách tập cuộn dọc */}
              <div
                role="listbox"
                aria-label={`Danh sách tập phim ${activeSeries.seriesTitle}`}
                className="min-h-0 flex-1 overflow-y-auto p-2"
              >
                <div className="flex flex-col gap-1.5">
                  {orderedSeriesEpisodes.map((ep) => {
                    const isCurrent = ep.video.video_id === video.video_id;
                    const epPercent = getProgressPercent(
                      ep.video.progress_seconds,
                      ep.video.duration_seconds,
                    );

                    return (
                      <button
                        key={ep.video.video_id}
                        type="button"
                        role="option"
                        aria-selected={isCurrent}
                        onClick={() => onSelectVideo(ep.video)}
                        className={`group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                          isCurrent
                            ? 'border-[var(--accent-primary)] bg-[var(--accent-soft)]'
                            : 'border-transparent bg-[var(--bg-surface)]/70 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]'
                        }`}
                      >
                        {/* Biểu tượng trạng thái: ▶ đang phát / ✓ đã xem / chấm tròn */}
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-canvas)]">
                          {isCurrent ? (
                            <Play className="ml-0.5 size-3.5 fill-current text-[var(--accent-primary)]" />
                          ) : ep.isWatched ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500 dark:text-emerald-400" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-[var(--text-secondary)]/60" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-xs font-semibold ${
                                isCurrent
                                  ? 'text-[var(--accent-primary)]'
                                  : 'text-[var(--text-primary)]'
                              }`}
                            >
                              {ep.episodeLabel}
                            </span>

                            {ep.isNew && (
                              <span className="shrink-0 rounded bg-[var(--accent-primary)] px-1.5 py-0.2 text-[10px] font-bold text-[var(--accent-foreground)]">
                                MỚI
                              </span>
                            )}
                          </div>

                          <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-secondary)]">
                            {ep.video.title}
                          </p>

                          {ep.isInProgress && !isCurrent && epPercent > 0 && (
                            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                              <div
                                className="h-full bg-[var(--accent-primary)]"
                                style={{ width: `${epPercent}%` }}
                              />
                            </div>
                          )}
                        </div>

                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
                          {formatDuration(ep.video.duration_seconds)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`flex flex-col justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 ${
              isTheaterWide ? 'w-full' : 'lg:col-span-4'
            }`}
          >
            <div>
              <h1 className="text-base font-semibold leading-snug text-[var(--text-primary)] sm:text-lg">
                {video.title}
              </h1>

              {/* Bộ đếm tiến độ thời gian thực đồng bộ từng giây */}
              <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-[var(--text-primary)]">
                    <Clock
                      className={`size-3.5 ${
                        isPlaying
                          ? 'text-[var(--accent-primary)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    />
                    <span>
                      {formatDuration(currentTime)} /{' '}
                      {formatDuration(effectiveDuration)} ({progressPercent}%)
                    </span>
                  </span>
                  {isCompletedLive && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" />
                      <span>Đã xem</span>
                    </span>
                  )}
                </div>

                <div
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Tiến độ xem thời gian thực"
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]"
                >
                  <div
                    className="h-full bg-[var(--accent-primary)] transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {video.description && (
                <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)] text-pretty">
                  {video.description}
                </p>
              )}

              {/* Nút hành động: Đăng ký kênh (nếu từ Khám phá) + Tập tiếp theo + Tóm tắt nhanh bằng AI */}
              <div className="mt-4 flex flex-col gap-2">
                {!isChannelSubscribed && onSubscribeChannel ? (
                  <Button
                    type="button"
                    disabled={isSubscribingChannel}
                    onClick={() =>
                      onSubscribeChannel(video.channel_id, video.channel_title)
                    }
                    className="h-10 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-semibold text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                  >
                    {isSubscribingChannel ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 size-4" />
                    )}
                    <span>Đăng ký & Thêm vào AniSub</span>
                  </Button>
                ) : (
                  isChannelSubscribed &&
                  onSubscribeChannel && (
                    <div className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <Check className="size-3.5" />
                      <span>Đã theo dõi kênh này</span>
                    </div>
                  )
                )}

                {effectiveNextVideo && (
                  <Button
                    type="button"
                    onClick={() => onSelectVideo(effectiveNextVideo)}
                    className="h-10 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                  >
                    <span>Tập tiếp theo</span>
                    <SkipForward className="ml-2 size-4" />
                  </Button>
                )}

                <Button
                  type="button"
                  variant="outline"
                  disabled={isSummarizing}
                  onClick={handleToggleAiSummary}
                  aria-expanded={showAiSummary}
                  className={`h-10 w-full rounded-xl border text-sm font-medium cursor-pointer ${
                    showAiSummary
                      ? 'border-[var(--ai-accent)] bg-violet-500/15 text-[var(--text-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  {isSummarizing ? (
                    <Loader2 className="mr-2 size-4 animate-spin text-[var(--ai-accent)]" />
                  ) : (
                    <Sparkles className="mr-2 size-4 text-[var(--ai-accent)]" />
                  )}
                  <span>
                    {isSummarizing
                      ? 'Đang tóm tắt bằng AI...'
                      : 'Tóm tắt nhanh bằng AI'}
                  </span>
                </Button>
              </div>

              {/* Khung 3 gạch đầu dòng tóm tắt */}
              <div
                className={`grid transition-all duration-300 ease-out ${
                  showAiSummary ? 'mt-3 grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="rounded-xl border border-[var(--ai-accent)]/40 bg-[var(--bg-surface)] p-3">
                    <p className="text-xs font-semibold text-[var(--ai-accent)]">
                      Tóm tắt Gemini AI (3 ý chính • Không Spoil)
                    </p>
                    {isSummarizing ? (
                      <div className="mt-2 flex items-center gap-2 py-2 text-xs text-[var(--text-secondary)]">
                        <Loader2 className="size-3.5 animate-spin text-[var(--ai-accent)]" />
                        <span>Gemini đang phân tích nội dung video...</span>
                      </div>
                    ) : summaryBullets.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1.5 text-xs text-[var(--text-primary)]">
                        {summaryBullets.map((line, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                        Bấm lại nút Tóm tắt nhanh bằng AI để tạo 3 ý chính từ
                        Gemini AI.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <p className="border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-secondary)]">
              Tự động lưu tiến độ mỗi 10 giây • <kbd className="font-mono">F</kbd>{' '}
              Toàn màn hình • <kbd className="font-mono">T</kbd> Rạp rộng •{' '}
              <kbd className="font-mono">Esc</kbd> Đóng
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
