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
   * Ưu tiên dùng sddefault.jpg (640x480) sắc nét trên desktop -> tự động fallback về hqdefault.jpg (480x360)
   * nếu video YouTube không có bản SD. Tuyệt đối không dùng mqdefault.jpg (320x180) làm ảnh chính.
   */
  preferHq?: boolean;
}

const YT_MQ_RE =
  /^https?:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([^/]+)\/mqdefault\.(?:jpg|webp)(?:\?.*)?$/i;

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

  const sdFallback = videoId
    ? `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`
    : null;
  const hqFallback = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : null;

  if (preferHq && videoId) {
    // Chuẩn HD sắc nét cho desktop: sddefault (640x480) -> fallback hqdefault (480x360)
    pushUnique(sdFallback);
    pushUnique(hqFallback);
  }

  if (thumbnailUrl?.trim() && !YT_MQ_RE.test(thumbnailUrl.trim())) {
    pushUnique(thumbnailUrl.trim());
  }

  pushUnique(hqFallback);
  pushUnique(sdFallback);

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
