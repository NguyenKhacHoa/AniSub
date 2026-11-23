'use client';

import React, { useMemo, useState } from 'react';
import { Film } from 'lucide-react';

interface VideoThumbnailProps {
  videoId: string;
  thumbnailUrl?: string | null;
  alt: string;
  sizes?: string;
  className?: string;
  preferHq?: boolean;
  /**
   * Callback gọi khi cả thumbnail thật lẫn hqdefault.jpg đều trả về ảnh placeholder xám 120x90
   * (tức là video gốc trên YouTube đã bị xóa/ẩn vĩnh viễn).
   */
  onUnavailable?: (videoId: string) => void;
}

const YT_MQ_OR_DEFAULT_RE =
  /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([^/]+)\/(?:mqdefault|default)\.(?:jpg|webp)(?:\?.*)?$/i;

function buildThumbnailCandidates(
  videoId: string,
  thumbnailUrl: string | null | undefined,
): string[] {
  const candidates: string[] = [];
  const pushUnique = (url: string | null | undefined) => {
    const trimmed = url?.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  // 1. Ưu tiên tuyệt đối URL thumbnail thật lưu từ YouTube API (standard?.url || high?.url)
  // Tuyệt đối không tự ép mù quáng sddefault.jpg cho các video không có bản SD
  if (thumbnailUrl?.trim() && !YT_MQ_OR_DEFAULT_RE.test(thumbnailUrl.trim())) {
    pushUnique(thumbnailUrl.trim());
  }

  // 2. Fallback chuẩn sắc nét 480x360 có mặt trên mọi video hợp lệ của YouTube
  if (videoId) {
    pushUnique(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  }

  return candidates;
}

export const VideoThumbnail = React.memo(function VideoThumbnail({
  videoId,
  thumbnailUrl,
  alt,
  className = 'object-cover',
  onUnavailable,
}: VideoThumbnailProps) {
  const candidates = useMemo(
    () => buildThumbnailCandidates(videoId, thumbnailUrl),
    [videoId, thumbnailUrl],
  );

  const sourceKey = `${videoId}|${thumbnailUrl ?? ''}`;
  const [errorState, setErrorState] = useState<{
    key: string;
    index: number;
  }>({ key: sourceKey, index: 0 });

  const activeIndex = errorState.key === sourceKey ? errorState.index : 0;
  const currentSrc = candidates[activeIndex] ?? null;

  const advanceToFallback = () => {
    const nextIndex = activeIndex + 1;
    setErrorState({ key: sourceKey, index: nextIndex });
    if (nextIndex >= candidates.length && videoId) {
      onUnavailable?.(videoId);
    }
  };

  if (!currentSrc) {
    return (
      <div className="flex size-full items-center justify-center">
        <Film className="size-6 text-[var(--text-secondary)]" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`absolute inset-0 size-full ${className}`}
      onError={advanceToFallback}
      onLoad={(e) => {
        // Phát hiện ảnh placeholder xám 3 dấu chấm kích thước 120x90 của YouTube
        if (e.currentTarget.naturalWidth <= 120) {
          advanceToFallback();
        }
      }}
    />
  );
});
