'use client';

import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ListVideo,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { VideoThumbnail } from '@/components/workspace/VideoThumbnail';
import { formatDuration, type CinemaVideoItem } from '@/types/workspace';

interface TheaterQueuePanelProps {
  queue: CinemaVideoItem[];
  onPlayItem: (video: CinemaVideoItem) => void;
  onRemoveItem: (videoId: string) => void;
  onMoveItem: (index: number, direction: 'up' | 'down') => void;
  onClearQueue: () => void;
  onClosePanel: () => void;
}

export function TheaterQueuePanel({
  queue,
  onPlayItem,
  onRemoveItem,
  onMoveItem,
  onClearQueue,
  onClosePanel,
}: TheaterQueuePanelProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
        <div className="flex items-center gap-2">
          <ListVideo className="size-4 text-[var(--accent-primary)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Hàng đợi phát ({queue.length})
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={onClearQueue}
              title="Xóa toàn bộ hàng đợi"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-rose-500/40 hover:text-rose-400 cursor-pointer"
            >
              <Trash2 className="size-3" />
              <span>Xóa hết</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClosePanel}
            aria-label="Đóng ngăn Hàng đợi"
            className="flex size-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <ListVideo className="size-8 text-[var(--text-secondary)] opacity-60" />
          <p className="mt-2.5 text-sm font-medium text-[var(--text-primary)]">
            Hàng đợi đang trống
          </p>
          <p className="mt-1 max-w-xs text-xs text-[var(--text-secondary)]">
            Bấm nút &ldquo;+ Hàng đợi&rdquo; trên bất kỳ thẻ phim nào để thêm vào
            danh sách phát liên tục tiếp theo.
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
          {queue.map((item, idx) => (
            <div
              key={item.video_id}
              className="group flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5 transition-colors hover:border-[var(--accent-primary)]/50"
            >
              <button
                type="button"
                onClick={() => onPlayItem(item)}
                className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-black/60 cursor-pointer"
                title="Phát ngay video này"
              >
                <VideoThumbnail
                  videoId={item.video_id}
                  thumbnailUrl={item.thumbnail_url}
                  alt={item.title}
                  className="size-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/45">
                  <Play className="size-4 fill-white text-white opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                {item.duration_seconds > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 py-0.2 text-[9px] font-semibold tabular-nums text-white">
                    {formatDuration(item.duration_seconds)}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => onPlayItem(item)}
                className="min-w-0 flex-1 text-left cursor-pointer"
              >
                <p className="line-clamp-2 text-xs font-medium leading-snug text-[var(--text-primary)]">
                  {item.title}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">
                  #{idx + 1} • {item.channel_title || item.channel_id}
                </p>
              </button>

              <div className="flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => onMoveItem(idx, 'up')}
                  aria-label="Đưa lên trên"
                  className="flex size-5 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={idx === queue.length - 1}
                  onClick={() => onMoveItem(idx, 'down')}
                  aria-label="Đưa xuống dưới"
                  className="flex size-5 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer"
                >
                  <ArrowDown className="size-3" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => onRemoveItem(item.video_id)}
                aria-label="Xóa khỏi hàng đợi"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
