'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Radio } from 'lucide-react';
import { VideoThumbnail } from '@/components/workspace/VideoThumbnail';
import type { CinemaVideoItem } from '@/types/workspace';

interface UpcomingPremieresShelfProps {
  videos: CinemaVideoItem[];
  onSelectVideo: (video: CinemaVideoItem) => void;
}

function formatPremiereCountdown(
  scheduledIso: string | null | undefined,
  nowMs: number,
): { countdownText: string; scheduleLabel: string; isLiveSoon: boolean } {
  if (!scheduledIso) {
    return {
      countdownText: 'Sắp công chiếu',
      scheduleLabel: '',
      isLiveSoon: true,
    };
  }

  const targetMs = new Date(scheduledIso).getTime();
  if (!Number.isFinite(targetMs)) {
    return {
      countdownText: 'Sắp công chiếu',
      scheduleLabel: '',
      isLiveSoon: true,
    };
  }

  const targetDate = new Date(targetMs);
  const nowDate = new Date(nowMs);
  const hh = targetDate.getHours().toString().padStart(2, '0');
  const mm = targetDate.getMinutes().toString().padStart(2, '0');

  const isSameDay =
    targetDate.getFullYear() === nowDate.getFullYear() &&
    targetDate.getMonth() === nowDate.getMonth() &&
    targetDate.getDate() === nowDate.getDate();

  const tomorrow = new Date(nowDate);
  tomorrow.setDate(nowDate.getDate() + 1);
  const isTomorrow =
    targetDate.getFullYear() === tomorrow.getFullYear() &&
    targetDate.getMonth() === tomorrow.getMonth() &&
    targetDate.getDate() === tomorrow.getDate();

  const dayStr = isSameDay
    ? 'hôm nay'
    : isTomorrow
      ? 'ngày mai'
      : `${targetDate.getDate().toString().padStart(2, '0')}/${(
          targetDate.getMonth() + 1
        )
          .toString()
          .padStart(2, '0')}`;

  const scheduleLabel = `${hh}:${mm} ${dayStr}`;
  const diffSec = Math.floor((targetMs - nowMs) / 1000);

  if (diffSec <= 0) {
    return {
      countdownText: 'Đang / Sắp công chiếu',
      scheduleLabel,
      isLiveSoon: true,
    };
  }

  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  const timePart =
    days > 0
      ? `${days} ngày ${pad(hours)}:${pad(mins)}:${pad(secs)}`
      : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;

  return {
    countdownText: `Công chiếu sau ${timePart}`,
    scheduleLabel,
    isLiveSoon: diffSec <= 1800,
  };
}

export function UpcomingPremieresShelf({
  videos,
  onSelectVideo,
}: UpcomingPremieresShelfProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (videos.length === 0) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [videos.length]);

  if (videos.length === 0) return null;

  return (
    <section
      aria-label="Lịch công chiếu tập sắp ra mắt"
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-[var(--accent-primary)]" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">
            Lịch công chiếu sắp ra mắt
          </h2>
          <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--accent-primary)]">
            {videos.length}
          </span>
        </div>
        <span className="hidden text-[11px] text-[var(--text-secondary)] sm:inline">
          Đếm ngược thời gian thực tới giờ công chiếu trên YouTube
        </span>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {videos.map((video) => {
          const { countdownText, scheduleLabel, isLiveSoon } =
            formatPremiereCountdown(video.scheduled_start_at, nowMs);

          return (
            <button
              key={video.video_id}
              type="button"
              onClick={() => onSelectVideo(video)}
              className="group flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-left transition-colors hover:border-[var(--accent-primary)]/60 cursor-pointer"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-black/50">
                <VideoThumbnail
                  videoId={video.video_id}
                  thumbnailUrl={video.thumbnail_url}
                  alt={video.title}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <span
                  className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide shadow-sm ${
                    isLiveSoon
                      ? 'bg-rose-600 text-white'
                      : 'border border-amber-400/50 bg-black/85 text-amber-300'
                  }`}
                >
                  <Radio className="size-3 shrink-0" />
                  <span>CÔNG CHIẾU</span>
                </span>
                {scheduleLabel && (
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/85 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                    {scheduleLabel}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between gap-1.5 p-2.5">
                <p className="line-clamp-2 text-xs font-semibold leading-snug text-[var(--text-primary)]">
                  {video.title}
                </p>
                <div className="flex flex-col gap-0.5">
                  <p className="truncate text-[11px] text-[var(--text-secondary)]">
                    {video.channel_title || video.channel_id}
                  </p>
                  <p className="truncate text-[11px] font-semibold tabular-nums text-[var(--accent-primary)]">
                    {countdownText}
                    {scheduleLabel ? ` • ${scheduleLabel}` : ''}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
