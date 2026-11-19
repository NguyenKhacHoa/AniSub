'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface YTPlayerInstance {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (suggestedRate: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
}

interface YTPlayerEvent {
  target: YTPlayerInstance;
  data: number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: {
        autoplay?: 0 | 1;
        rel?: 0 | 1;
        modestbranding?: 0 | 1;
        start?: number;
        playsinline?: 0 | 1;
      };
      events?: {
        onReady?: (event: YTPlayerEvent) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState: {
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Client only'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT) {
        resolve(window.YT);
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

interface UseYouTubePlayerOptions {
  videoId: string;
  initialProgressSeconds: number;
  initialDurationSeconds: number;
  playbackRate?: number;
  onSaveProgress: (
    videoId: string,
    progressSeconds: number,
    durationSeconds: number,
  ) => void;
  onEnded?: () => void;
}

export function useYouTubePlayer({
  videoId,
  initialProgressSeconds,
  initialDurationSeconds,
  playbackRate = 1,
  onSaveProgress,
  onEnded,
}: UseYouTubePlayerOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedAtRef = useRef<number>(0);
  const latestTimeRef = useRef<number>(initialProgressSeconds);
  const latestDurationRef = useRef<number>(initialDurationSeconds);
  const initialProgressRef = useRef<number>(initialProgressSeconds);
  const initialDurationRef = useRef<number>(initialDurationSeconds);
  const playbackRateRef = useRef<number>(playbackRate);
  const onSaveRef = useRef(onSaveProgress);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    initialProgressRef.current = initialProgressSeconds;
  }, [initialProgressSeconds]);

  useEffect(() => {
    initialDurationRef.current = initialDurationSeconds;
  }, [initialDurationSeconds]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    const p = playerRef.current;
    if (p) {
      try {
        p.setPlaybackRate(playbackRate);
      } catch {
        // Ignore if player not ready yet
      }
    }
  }, [playbackRate]);

  useEffect(() => {
    onSaveRef.current = onSaveProgress;
  }, [onSaveProgress]);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const [currentTime, setCurrentTime] = useState<number>(
    initialProgressSeconds,
  );
  const [duration, setDuration] = useState<number>(initialDurationSeconds);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Chỉ khởi tạo lại YT.Player khi đổi videoId (tuyệt đối KHÔNG hủy iframe khi lưu tiến độ 10s/lần)
  useEffect(() => {
    let cancelled = false;
    const targetVideoId = videoId;
    const startSec = Math.max(0, Math.floor(initialProgressRef.current));
    const initDur = Math.max(0, Math.floor(initialDurationRef.current));
    latestTimeRef.current = startSec;
    latestDurationRef.current = initDur;
    lastSavedAtRef.current = Date.now();

    const clearTicker = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const flushSave = (force = false) => {
      const now = Date.now();
      if (!force && now - lastSavedAtRef.current < 10_000) return;
      lastSavedAtRef.current = now;
      if (latestTimeRef.current > 0) {
        onSaveRef.current(
          targetVideoId,
          Math.floor(latestTimeRef.current),
          Math.floor(latestDurationRef.current),
        );
      }
    };

    async function mountPlayer() {
      try {
        const YT = await loadYouTubeIframeApi();
        if (cancelled || !containerRef.current) return;

        // Dọn sạch mount node trước khi khởi tạo YT.Player mới
        containerRef.current.innerHTML = '';
        const mountNode = document.createElement('div');
        mountNode.style.width = '100%';
        mountNode.style.height = '100%';
        containerRef.current.appendChild(mountNode);

        playerRef.current = new YT.Player(mountNode, {
          videoId: targetVideoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            start: startSec > 0 ? startSec : undefined,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              const realDuration = event.target.getDuration();
              if (realDuration > 0) {
                latestDurationRef.current = realDuration;
                setDuration(Math.floor(realDuration));
              }
              try {
                event.target.setPlaybackRate(playbackRateRef.current);
              } catch {
                // Ignore if player rejects rate before playing
              }
              setCurrentTime(startSec);
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const state = event.data;

              if (state === YT.PlayerState.PLAYING) {
                setIsPlaying(true);
                try {
                  event.target.setPlaybackRate(playbackRateRef.current);
                } catch {
                  // Ignore
                }
                clearTicker();
                intervalRef.current = setInterval(() => {
                  const p = playerRef.current;
                  if (!p) return;
                  const t = p.getCurrentTime();
                  const d = p.getDuration();
                  if (Number.isFinite(t)) {
                    latestTimeRef.current = t;
                    setCurrentTime(Math.floor(t));
                  }
                  if (Number.isFinite(d) && d > 0) {
                    latestDurationRef.current = d;
                    setDuration(Math.floor(d));
                  }
                  // Tự động lưu tiến độ mỗi 10 giây
                  flushSave(false);
                }, 1000);
              } else {
                setIsPlaying(false);
                clearTicker();

                const p = playerRef.current;
                if (p) {
                  const t = p.getCurrentTime();
                  const d = p.getDuration();
                  if (Number.isFinite(t)) {
                    latestTimeRef.current = t;
                    setCurrentTime(Math.floor(t));
                  }
                  if (Number.isFinite(d) && d > 0) {
                    latestDurationRef.current = d;
                    setDuration(Math.floor(d));
                  }
                }

                // Lưu ngay khi Tạm dừng (PAUSED) hoặc Kết thúc (ENDED)
                if (
                  state === YT.PlayerState.PAUSED ||
                  state === YT.PlayerState.ENDED
                ) {
                  flushSave(true);
                }

                // Tự động chuyển tập tiếp theo (Auto-Next) khi video kết thúc
                if (state === YT.PlayerState.ENDED) {
                  onEndedRef.current?.();
                }
              }
            },
          },
        });
      } catch {
        // Ignore API load failure on unmount
      }
    }

    void mountPlayer();

    return () => {
      cancelled = true;
      clearTicker();
      // Lưu tiến độ lần cuối trước khi đổi video hoặc đóng TheaterStage
      flushSave(true);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore destroy error if DOM already detached
        }
        playerRef.current = null;
      }
    };
  }, [videoId]);

  const seekBy = useCallback((deltaSeconds: number) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      const curr = p.getCurrentTime();
      const dur = p.getDuration();
      const rawTarget = (Number.isFinite(curr) ? curr : latestTimeRef.current) + deltaSeconds;
      const clampedTarget =
        Number.isFinite(dur) && dur > 0
          ? Math.max(0, Math.min(dur - 1, rawTarget))
          : Math.max(0, rawTarget);
      p.seekTo(clampedTarget, true);
      latestTimeRef.current = clampedTarget;
      setCurrentTime(Math.floor(clampedTarget));
    } catch {
      // Ignore if player not ready
    }
  }, []);

  const seekTo = useCallback((targetSeconds: number) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      const dur = p.getDuration();
      const clamped =
        Number.isFinite(dur) && dur > 0
          ? Math.max(0, Math.min(dur - 1, targetSeconds))
          : Math.max(0, targetSeconds);
      p.seekTo(clamped, true);
      latestTimeRef.current = clamped;
      setCurrentTime(Math.floor(clamped));
    } catch {
      // Ignore if player not ready
    }
  }, []);

  const applyPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate;
    const p = playerRef.current;
    if (!p) return;
    try {
      p.setPlaybackRate(rate);
    } catch {
      // Ignore if player not ready
    }
  }, []);

  const playVideo = useCallback(() => {
    try {
      playerRef.current?.playVideo();
    } catch {
      // Ignore
    }
  }, []);

  const pauseVideo = useCallback(() => {
    try {
      playerRef.current?.pauseVideo();
    } catch {
      // Ignore
    }
  }, []);

  return {
    containerRef,
    currentTime,
    duration,
    isPlaying,
    seekBy,
    seekTo,
    applyPlaybackRate,
    playVideo,
    pauseVideo,
  };
}
