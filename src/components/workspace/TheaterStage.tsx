'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  RectangleHorizontal,
  Minimize2,
  X,
  SkipForward,
  Sparkles,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GENRE_DOT_STYLES,
  formatDuration,
  getProgressPercent,
  type CinemaVideoItem,
} from '@/types/workspace';

interface TheaterStageProps {
  video: CinemaVideoItem;
  nextVideo: CinemaVideoItem | null;
  onSelectVideo: (video: CinemaVideoItem) => void;
  onClose: () => void;
}

export function TheaterStage({
  video,
  nextVideo,
  onSelectVideo,
  onClose,
}: TheaterStageProps) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [isTheaterWide, setIsTheaterWide] = useState(false);
  const [showAiSummary, setShowAiSummary] = useState(false);

  const handleToggleFullscreen = () => {
    const el = playerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  };

  // Hỗ trợ phím tắt F (Fullscreen), T (Theater Wide Mode), Escape (Đóng trình phát)
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

  const progressPercent = getProgressPercent(
    video.progress_seconds,
    video.duration_seconds,
  );

  const genreStyle =
    video.detected_genre && video.detected_genre !== 'Khác'
      ? GENRE_DOT_STYLES[video.detected_genre]
      : null;

  const summaryBullets = video.ai_summary
    ? video.ai_summary
        .split('\n')
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

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
            {video.series_name || video.channel_title || 'Đang trình chiếu'}
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
        {/* CỘT TRÁI: Khung YouTube IFrame 16:9 */}
        <div className={isTheaterWide ? 'w-full' : 'lg:col-span-8'}>
          <div
            ref={playerContainerRef}
            className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black"
          >
            <iframe
              key={video.video_id}
              src={`https://www.youtube-nocookie.com/embed/${video.video_id}?rel=0&modestbranding=1&start=${video.progress_seconds}`}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="size-full border-0"
            />
          </div>
        </div>

        {/* CỘT PHẢI: Thông tin tập, Tập tiếp theo, Tóm tắt nhanh AI */}
        <div
          className={`flex flex-col justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 ${
            isTheaterWide ? 'w-full' : 'lg:col-span-4'
          }`}
        >
          <div>
            <h1 className="text-base font-semibold leading-snug text-[var(--text-primary)] sm:text-lg">
              {video.title}
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock className="size-3.5" />
                {formatDuration(video.progress_seconds)} /{' '}
                {formatDuration(video.duration_seconds)} ({progressPercent}%)
              </span>
              {video.is_completed && (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  <span>Đã xem</span>
                </span>
              )}
            </div>

            {video.description && (
              <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)] text-pretty">
                {video.description}
              </p>
            )}

            {/* Nút hành động: Tập tiếp theo + Tóm tắt nhanh bằng AI */}
            <div className="mt-4 flex flex-col gap-2">
              {nextVideo && (
                <Button
                  type="button"
                  onClick={() => onSelectVideo(nextVideo)}
                  className="h-10 w-full rounded-xl bg-[var(--accent-primary)] text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
                >
                  <span>Tập tiếp theo</span>
                  <SkipForward className="ml-2 size-4" />
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAiSummary((prev) => !prev)}
                aria-expanded={showAiSummary}
                className={`h-10 w-full rounded-xl border text-sm font-medium cursor-pointer ${
                  showAiSummary
                    ? 'border-[var(--ai-accent)] bg-violet-500/15 text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                <Sparkles className="mr-2 size-4 text-[var(--ai-accent)]" />
                <span>Tóm tắt nhanh bằng AI</span>
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
                    Tóm tắt Gemini AI (3 ý chính)
                  </p>
                  {summaryBullets.length > 0 ? (
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
                      Chưa có bản tóm tắt lưu cache cho video này. Khi kết nối
                      Gemini API (`gemini-4-hydrogen`), 3 gạch đầu dòng tóm tắt
                      sẽ được lưu vào cột `ai_summary`.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <p className="border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-secondary)]">
            Phím tắt: <kbd className="font-mono">F</kbd> Toàn màn hình •{' '}
            <kbd className="font-mono">T</kbd> Rạp rộng •{' '}
            <kbd className="font-mono">Esc</kbd> Đóng
          </p>
        </div>
      </div>
    </section>
  );
}
