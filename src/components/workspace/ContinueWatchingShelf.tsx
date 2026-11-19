'use client';

import React from 'react';
import { Clock, Play, X } from 'lucide-react';
import { VideoThumbnail } from '@/components/workspace/VideoThumbnail';
import { extractSeriesTitle, parseEpisodeInfo } from '@/lib/series-parser';
import { getProgressPercent, type CinemaVideoItem } from '@/types/workspace';

interface ContinueWatchingShelfProps {
  videos: CinemaVideoItem[];
  onResumeVideo: (video: CinemaVideoItem) => void;
  onRemoveFromContinue: (videoId: string) => void;
}

function formatRemainingTime(progressSeconds: number, durationSeconds: number): string {
  const remaining = Math.max(0, Math.floor(durationSeconds - progressSeconds));
  if (remaining <= 0) return 'Sắp hết';
  if (remaining < 60) return `Còn ${remaining} giây`;
  const hours = Math.floor(remaining / 3600);
  const mins = Math.ceil((remaining % 3600) / 60);
  if (hours > 0) {
    return mins > 0 ? `Còn ${hours}g ${mins}p` : `Còn ${hours} giờ`;
  }
  return `Còn ${mins} phút`;
}

export function ContinueWatchingShelf({
  videos,
  onResumeVideo,
  onRemoveFromContinue,
}: ContinueWatchingShelfProps) {
  if (videos.length === 0) return null;

  return (
    <section
      aria-label="Xem tiếp — Continue Watching"
      className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-primary)]">
            <Clock className="size-3.5" />
          </span>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Xem tiếp
          </h2>
          <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
            {videos.length}
          </span>
        </div>
        <span className="text-[11px] text-[var(--text-secondary)]">
          Bấm vào để tua tiếp đúng vị trí đang dở
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {videos.map((video) => {
          const percent = getProgressPercent(
            video.progress_seconds,
            video.duration_seconds,
          );
          const epInfo = parseEpisodeInfo(video.title, video.episode_number);
          const cleanTitle = extractSeriesTitle(
            video.title,
            video.channel_title,
            video.series_name,
          );
          const remainingText = formatRemainingTime(
            video.progress_seconds,
            video.duration_seconds,
          );

          return (
            <div
              key={video.video_id}
              role="button"
              tabIndex={0}
              onClick={() => onResumeVideo(video)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onResumeVideo(video);
                }
              }}
              className="group relative flex w-[235px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-left transition-colors hover:border-[var(--accent-primary)]/70 cursor-pointer sm:w-[255px]"
            >
              {/* Ảnh bìa + Thanh tiến độ đáy ảnh + Nút xóa nhanh */}
              <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg-elevated)]">
                <VideoThumbnail
                  videoId={video.video_id}
                  thumbnailUrl={video.thumbnail_url}
                  alt={video.title}
                  sizes="260px"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />

                {/* Lớp phủ Play khi hover */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
                  <div className="flex size-9 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--accent-foreground)] opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                    <Play className="ml-0.5 size-4 fill-current" />
                  </div>
                </div>

                {/* Nút xóa nhanh khỏi Xem tiếp */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromContinue(video.video_id);
                  }}
                  aria-label="Xóa khỏi danh sách xem tiếp"
                  title="Xóa khỏi danh sách xem tiếp"
                  className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/75 text-white/85 opacity-90 backdrop-blur-sm transition-colors hover:bg-rose-500 hover:text-white cursor-pointer sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>

                {/* Nhãn thời gian còn lại */}
                <span className="absolute bottom-2 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">
                  {remainingText}
                </span>

                {/* Thanh tiến độ nổi bật ở đáy ảnh */}
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
                  <div
                    className="h-full bg-[var(--accent-primary)] transition-[width] duration-300"
                    style={{ width: `${Math.max(4, percent)}%` }}
                  />
                </div>
              </div>

              {/* Tên phim / tập đang dở */}
              <div className="flex flex-col gap-0.5 p-2.5">
                <h3 className="line-clamp-1 text-xs font-semibold text-[var(--text-primary)]">
                  {cleanTitle || video.title}
                </h3>
                <div className="flex items-center justify-between gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <span className="truncate font-medium text-[var(--accent-primary)]">
                    {epInfo.hasExplicitMarker ? epInfo.episodeLabel : 'Đang xem'}
                  </span>
                  <span className="shrink-0 tabular-nums">{percent}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
