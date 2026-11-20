'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { Film } from 'lucide-react';

interface VideoThumbnailProps {
  videoId: string;
  thumbnailUrl?: string | null;
  alt: string;
  sizes?: string;
  className?: string;
  /**
   * Ưu tiên dùng mqdefault/hqdefault cho thẻ lưới ngoài danh sách:
   * nhẹ hơn nhiều so với maxresdefault.jpg, tăng tốc độ giải mã ảnh và đảm bảo 60fps khi cuộn.
   */
  preferHq?: boolean;
}

const YT_HIGH_RES_RE =
  /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([^/]+)\/(?:maxresdefault|sddefault)\.(?:jpg|webp)(?:\?.*)?$/i;

function buildThumbnailCandidates(
  videoId: string,
  thumbnailUrl: string | null | undefined,
  preferHq: boolean,
): string[] {
  const candidates: string[] = [];
  const pushUnique = (url: string | null | undefined) => {
    const trimmed = url?.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  const mqFallback = videoId
    ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
    : null;
  const hqFallback = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : null;

  if (preferHq && mqFallback) {
    pushUnique(mqFallback);
  }

  if (thumbnailUrl?.trim()) {
    const normalized =
      preferHq && videoId && YT_HIGH_RES_RE.test(thumbnailUrl.trim())
        ? hqFallback
        : thumbnailUrl.trim();
    pushUnique(normalized);
  }

  pushUnique(hqFallback);
  pushUnique(mqFallback);

  return candidates;
}

export const VideoThumbnail = React.memo(function VideoThumbnail({
  videoId,
  thumbnailUrl,
  alt,
  sizes = '(max-width: 640px) 100vw, 25vw',
  className = 'object-cover',
  preferHq = true,
}: VideoThumbnailProps) {
  const candidates = useMemo(
    () => buildThumbnailCandidates(videoId, thumbnailUrl, preferHq),
    [videoId, thumbnailUrl, preferHq],
  );

  const sourceKey = `${videoId}|${thumbnailUrl ?? ''}|${preferHq ? '1' : '0'}`;
  const [errorState, setErrorState] = useState<{
    key: string;
    index: number;
  }>({ key: sourceKey, index: 0 });

  const activeIndex = errorState.key === sourceKey ? errorState.index : 0;
  const currentSrc = candidates[activeIndex] ?? null;

  if (!currentSrc) {
    return (
      <div className="flex size-full items-center justify-center">
        <Film className="size-6 text-[var(--text-secondary)]" />
      </div>
    );
  }

  return (
    <Image
      src={currentSrc}
      alt={alt}
      fill
      unoptimized
      loading="lazy"
      decoding="async"
      sizes={sizes}
      className={className}
      onError={() => {
        setErrorState((prev) => {
          const nextIndex = prev.key === sourceKey ? prev.index + 1 : 1;
          return { key: sourceKey, index: nextIndex };
        });
      }}
    />
  );
});
