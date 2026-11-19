'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FloatingRail } from '@/components/workspace/FloatingRail';
import { CommandHub } from '@/components/workspace/CommandHub';
import { ContinueWatchingShelf } from '@/components/workspace/ContinueWatchingShelf';
import { TheaterStage } from '@/components/workspace/TheaterStage';
import { StructuredCinemaRows } from '@/components/workspace/StructuredCinemaRows';
import { SeriesGrid } from '@/components/workspace/SeriesGrid';
import { ChannelVaultDrawer } from '@/components/workspace/ChannelVaultDrawer';
import { WhitelistModal } from '@/components/workspace/WhitelistModal';
import { createClient } from '@/lib/supabase/client';
import {
  extractSeriesInfo,
  groupVideosIntoSeries,
  type SeriesGroup,
} from '@/lib/series-parser';
import {
  isTheatricalMovieVideo,
  type ChannelWithSelection,
  type CinemaVideoItem,
  type GenreFilter,
  type PrimaryGenreTag,
  type SortOption,
  type VideoTypeFilter,
  type WorkspaceAuthStatus,
  type WorkspaceViewMode,
} from '@/types/workspace';
import type { UserSeriesStatus } from '@/types/database';

const DELTA_SYNC_STORAGE_KEY = 'anisub_last_delta_sync_at';
const DELTA_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 60 phút

export interface InitialWorkspaceUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  lastSyncedAt: string | null;
}

interface UnifiedCinemaWorkspaceProps {
  initialAuthStatus: WorkspaceAuthStatus;
  initialUser: InitialWorkspaceUser | null;
  initialChannels?: ChannelWithSelection[];
  initialVideos?: CinemaVideoItem[];
  initialSeriesStatuses?: Record<string, UserSeriesStatus>;
  initialWatchLaterIds?: string[];
  initialTotalVideosCount?: number;
  isAdmin?: boolean;
  pendingRequestsCount?: number;
}

/**
 * Xáo trộn ngẫu nhiên Fisher-Yates (không đột biến mảng gốc)
 */
function fisherYatesShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Xây dựng danh sách gợi ý ở Vùng B khi đang xem 1 video:
 * - Loại bỏ chính video đang phát
 * - Nhóm 1 (Ưu tiên): Tập tiếp theo thuộc cùng `series_name` hoặc cùng kênh (`channel_id`)
 * - Nhóm 2: Cùng thể loại (`detected_genre`) đã xáo trộn ngẫu nhiên
 * - Nhóm 3: Các thể loại khác đã xáo trộn ngẫu nhiên
 */
function buildRecommendationIds(
  pool: CinemaVideoItem[],
  current: CinemaVideoItem,
): string[] {
  const candidates = pool.filter((v) => v.video_id !== current.video_id);

  // Nhóm 1: Cùng series hoặc cùng kênh
  const group1 = candidates
    .filter(
      (v) =>
        (current.series_name && v.series_name === current.series_name) ||
        v.channel_id === current.channel_id,
    )
    .sort((a, b) => {
      if (a.episode_number !== null && b.episode_number !== null) {
        if (current.episode_number !== null) {
          const aIsNext = a.episode_number > current.episode_number ? 0 : 1;
          const bIsNext = b.episode_number > current.episode_number ? 0 : 1;
          if (aIsNext !== bIsNext) return aIsNext - bIsNext;
        }
        return a.episode_number - b.episode_number;
      }
      return (
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );
    });

  const group1Ids = new Set(group1.map((v) => v.video_id));
  const remaining = candidates.filter((v) => !group1Ids.has(v.video_id));

  // Nhóm 2: Cùng thể loại (Fisher-Yates Shuffle)
  const sameGenre = fisherYatesShuffle(
    remaining.filter(
      (v) =>
        current.detected_genre && v.detected_genre === current.detected_genre,
    ),
  );
  const sameGenreIds = new Set(sameGenre.map((v) => v.video_id));

  // Nhóm 3: Thể loại khác (Fisher-Yates Shuffle)
  const otherGenres = fisherYatesShuffle(
    remaining.filter((v) => !sameGenreIds.has(v.video_id)),
  );

  return [...group1, ...sameGenre, ...otherGenres].map((v) => v.video_id);
}

export function UnifiedCinemaWorkspace({
  initialAuthStatus,
  initialUser,
  initialChannels = [],
  initialVideos = [],
  initialSeriesStatuses = {},
  initialWatchLaterIds = [],
  isAdmin = false,
  pendingRequestsCount = 0,
}: UnifiedCinemaWorkspaceProps) {
  const router = useRouter();
  const mainScrollRef = useRef<HTMLElement>(null);
  const theaterStageRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<string, number>>({});
  const skipNextScrollRestoreRef = useRef(false);
  const hasTriggeredAutoDeltaRef = useRef(false);

  const [authStatus, setAuthStatus] =
    useState<WorkspaceAuthStatus>(initialAuthStatus);
  const [user, setUser] = useState<InitialWorkspaceUser | null>(initialUser);
  const [channels, setChannels] =
    useState<ChannelWithSelection[]>(initialChannels);
  // Full-Catalog In-Memory Store: giữ 100% toàn bộ video trong kho để lọc tức thì 0ms
  const [allVideos, setAllVideos] = useState<CinemaVideoItem[]>(initialVideos);
  const [seriesStatuses, setSeriesStatuses] = useState<
    Record<string, UserSeriesStatus>
  >(initialSeriesStatuses);
  const [watchLaterList, setWatchLaterList] =
    useState<string[]>(initialWatchLaterIds);
  const watchLaterSet = useMemo(() => new Set(watchLaterList), [watchLaterList]);
  const [isDeltaSyncing, setIsDeltaSyncing] = useState(false);
  const [exploreVideos, setExploreVideos] = useState<CinemaVideoItem[]>([]);
  const [exploreKeywords, setExploreKeywords] = useState<string[]>([]);
  const [explorePage, setExplorePage] = useState<number>(1);
  const [hasMoreExplore, setHasMoreExplore] = useState<boolean>(false);
  const [hasLoadedExplore, setHasLoadedExplore] = useState(false);
  const [isLoadingExplore, setIsLoadingExplore] = useState(false);
  const [isLoadingMoreExplore, setIsLoadingMoreExplore] = useState(false);
  const isLoadingMoreExploreRef = useRef(false);
  const explorePageTokensRef = useRef<Record<string, string>>({});
  const [subscribingChannelId, setSubscribingChannelId] = useState<
    string | null
  >(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    initialUser?.lastSyncedAt ?? null,
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReclassifyingAll, setIsReclassifyingAll] = useState(false);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('cinema');
  const [searchQuery, setSearchQuery] = useState('');
  const [videoType, setVideoType] = useState<VideoTypeFilter>('all');
  const [showTrailers, setShowTrailers] = useState(false);
  const [genreFilter, setGenreFilter] = useState<GenreFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [onlyUnwatched, setOnlyUnwatched] = useState(false);

  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null);
  const [recommendedOrderIds, setRecommendedOrderIds] = useState<string[]>([]);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [isWhitelistOpen, setIsWhitelistOpen] = useState(false);

  const currentTabKey =
    viewMode === 'explore'
      ? 'explore'
      : viewMode === 'continue'
        ? 'continue'
        : viewMode === 'watch_later'
          ? 'watch_later'
          : videoType === 'episode'
            ? 'episode'
            : videoType === 'theatrical'
              ? 'theatrical'
              : videoType === 'full_movie'
                ? 'full'
                : 'all';

  const saveCurrentTabScroll = useCallback(() => {
    const top =
      mainScrollRef.current?.scrollTop ??
      (typeof window !== 'undefined' ? window.scrollY : 0);
    scrollPositionsRef.current[currentTabKey] = top;
  }, [currentTabKey]);

  // Khôi phục đúng vị trí cuộn của từng Tab khi quay trở lại
  useEffect(() => {
    if (skipNextScrollRestoreRef.current) {
      skipNextScrollRestoreRef.current = false;
      return;
    }
    const savedTop = scrollPositionsRef.current[currentTabKey] ?? 0;
    const rafId = requestAnimationFrame(() => {
      if (mainScrollRef.current) {
        mainScrollRef.current.scrollTop = savedTop;
      }
      if (typeof window !== 'undefined' && window.scrollY !== savedTop) {
        window.scrollTo({ top: savedTop, behavior: 'auto' });
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [currentTabKey]);

  const selectedChannelIds = useMemo(
    () =>
      new Set(channels.filter((c) => c.is_selected).map((c) => c.channel_id)),
    [channels],
  );

  const filteredVideos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matched = allVideos.filter((v) => {
      if (v.is_short) return false;
      if (selectedChannelIds.size > 0 && !selectedChannelIds.has(v.channel_id)) {
        return false;
      }
      if (viewMode === 'watch_later') {
        if (!watchLaterSet.has(v.video_id)) return false;
      } else if (viewMode === 'continue') {
        if (!(v.progress_seconds > 0 && !v.is_completed)) return false;
      } else {
        if (!showTrailers && v.video_type === 'trailer') return false;
        if (videoType === 'episode' && v.video_type !== 'episode') return false;
        if (videoType === 'theatrical' && !isTheatricalMovieVideo(v)) {
          return false;
        }
        if (videoType === 'full_movie' && v.video_type !== 'full_movie') {
          return false;
        }
      }
      if (onlyUnwatched) {
        const isWatched =
          v.is_completed ||
          (v.duration_seconds > 0 &&
            v.progress_seconds / v.duration_seconds >= 0.9);
        if (isWatched) return false;
      }
      if (genreFilter !== 'all' && v.detected_genre !== genreFilter) {
        return false;
      }
      if (query) {
        const matchTitle = v.title.toLowerCase().includes(query);
        const matchSeries =
          v.series_name?.toLowerCase().includes(query) ?? false;
        const matchChannel =
          v.channel_title?.toLowerCase().includes(query) ?? false;
        if (!matchTitle && !matchSeries && !matchChannel) return false;
      }
      return true;
    });

    if (sortBy === 'longest') {
      return [...matched].sort(
        (a, b) => b.duration_seconds - a.duration_seconds,
      );
    }
    if (sortBy === 'title_asc') {
      return [...matched].sort((a, b) => a.title.localeCompare(b.title, 'vi'));
    }
    // Mặc định: Mới nhất (published_at DESC)
    return [...matched].sort(
      (a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    );
  }, [
    allVideos,
    selectedChannelIds,
    watchLaterSet,
    viewMode,
    showTrailers,
    videoType,
    onlyUnwatched,
    genreFilter,
    searchQuery,
    sortBy,
  ]);

  const activeVideo = useMemo(() => {
    if (!activeVideoId) return null;
    return (
      allVideos.find((v) => v.video_id === activeVideoId) ??
      exploreVideos.find((v) => v.video_id === activeVideoId) ??
      null
    );
  }, [allVideos, exploreVideos, activeVideoId]);

  // Gom nhóm toàn bộ video tập lẻ thành các Bộ phim (Series Playlist) ngay trong bộ nhớ
  const allSeriesGroups = useMemo(() => {
    const channelVideos = allVideos.filter(
      (v) =>
        selectedChannelIds.size === 0 || selectedChannelIds.has(v.channel_id),
    );
    return groupVideosIntoSeries(channelVideos);
  }, [allVideos, selectedChannelIds]);

  const filteredSeriesGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allSeriesGroups.filter((series) => {
      if (genreFilter !== 'all' && series.detectedGenre !== genreFilter) {
        return false;
      }
      if (
        onlyUnwatched &&
        series.episodes.length > 0 &&
        series.episodes.every((ep) => ep.isWatched)
      ) {
        return false;
      }
      if (query) {
        const matchSeries = series.seriesTitle.toLowerCase().includes(query);
        const matchChannel = series.channelTitle.toLowerCase().includes(query);
        const matchEp = series.episodes.some((ep) =>
          ep.video.title.toLowerCase().includes(query),
        );
        if (!matchSeries && !matchChannel && !matchEp) return false;
      }
      return true;
    });
  }, [allSeriesGroups, genreFilter, onlyUnwatched, searchQuery]);

  const totalSeriesEpisodesCount = useMemo(
    () => filteredSeriesGroups.reduce((acc, s) => acc + s.totalEpisodes, 0),
    [filteredSeriesGroups],
  );

  // Thanh "Xem tiếp" (Continue Watching Shelf): tối đa 6 video xem > 30s và tiến độ < 92%, sắp xếp gần nhất trước
  const continueWatchingVideos = useMemo(() => {
    return allVideos
      .filter((v) => {
        if (v.is_short) return false;
        if (selectedChannelIds.size > 0 && !selectedChannelIds.has(v.channel_id)) {
          return false;
        }
        if (v.is_completed) return false;
        if (v.progress_seconds <= 30) return false;
        if (
          v.duration_seconds > 0 &&
          v.progress_seconds / v.duration_seconds >= 0.92
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = new Date(a.last_watched_at ?? a.published_at).getTime();
        const bTime = new Date(b.last_watched_at ?? b.published_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 6);
  }, [allVideos, selectedChannelIds]);

  const activeSeries = useMemo(() => {
    if (!activeSeriesKey) return null;
    return (
      allSeriesGroups.find((s) => s.seriesKey === activeSeriesKey) ?? null
    );
  }, [activeSeriesKey, allSeriesGroups]);

  const filteredExploreVideos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return exploreVideos.filter((v) => {
      if (query) {
        const matchTitle = v.title.toLowerCase().includes(query);
        const matchChannel =
          v.channel_title?.toLowerCase().includes(query) ?? false;
        if (!matchTitle && !matchChannel) return false;
      }
      return true;
    });
  }, [exploreVideos, searchQuery]);

  // Danh sách hiển thị ở Vùng B:
  // - Khi ở tab Khám phá: hiển thị video đề xuất (loại video đang phát nếu có)
  // - Khi đang xem phim ở tab Đã đăng ký: dùng danh sách gợi ý đã xáo trộn & loại video đang phát
  const displayFeedVideos = useMemo(() => {
    if (viewMode === 'explore') {
      return activeVideo
        ? filteredExploreVideos.filter(
            (v) => v.video_id !== activeVideo.video_id,
          )
        : filteredExploreVideos;
    }

    if (!activeVideo) {
      return filteredVideos;
    }

    const videoMap = new Map(allVideos.map((v) => [v.video_id, v]));
    const ordered: CinemaVideoItem[] = [];
    for (const id of recommendedOrderIds) {
      if (id === activeVideo.video_id) continue;
      const item = videoMap.get(id);
      if (item && !item.is_short) {
        ordered.push(item);
      }
    }
    return ordered;
  }, [
    viewMode,
    activeVideo,
    filteredExploreVideos,
    filteredVideos,
    allVideos,
    recommendedOrderIds,
  ]);

  const nextVideo = useMemo(() => {
    if (!activeVideo || displayFeedVideos.length === 0) return null;
    return displayFeedVideos[0];
  }, [activeVideo, displayFeedVideos]);

  // Chọn video -> cập nhật danh sách gợi ý xáo trộn + tự động cuộn mượt lên Theater Stage
  const handleSelectVideo = useCallback(
    (video: CinemaVideoItem) => {
      skipNextScrollRestoreRef.current = true;
      setActiveVideoId(video.video_id);
      if (
        activeSeries &&
        !activeSeries.episodes.some((ep) => ep.video.video_id === video.video_id)
      ) {
        setActiveSeriesKey(null);
      }
      const pool = allVideos.filter(
        (v) =>
          !v.is_short &&
          (selectedChannelIds.size === 0 ||
            selectedChannelIds.has(v.channel_id)),
      );
      setRecommendedOrderIds(buildRecommendationIds(pool, video));

      requestAnimationFrame(() => {
        mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        theaterStageRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    },
    [allVideos, selectedChannelIds, activeSeries],
  );

  // Chọn 1 Bộ phim (Series Card) -> mở sân khấu TheaterStage ở chế độ Playlist & phát tập phù hợp nhất
  const handleSelectSeries = useCallback(
    (series: SeriesGroup) => {
      skipNextScrollRestoreRef.current = true;
      const targetVideo = series.recommendedEpisode.video;
      setActiveSeriesKey(series.seriesKey);
      setActiveVideoId(targetVideo.video_id);

      const pool = allVideos.filter(
        (v) =>
          !v.is_short &&
          (selectedChannelIds.size === 0 ||
            selectedChannelIds.has(v.channel_id)),
      );
      setRecommendedOrderIds(buildRecommendationIds(pool, targetVideo));

      requestAnimationFrame(() => {
        mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        theaterStageRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    },
    [allVideos, selectedChannelIds],
  );

  // Tự động lưu tiến độ xem (UPSERT public.watch_progress) + cập nhật state local tức thì
  const handleSaveWatchProgress = useCallback(
    (videoId: string, progressSeconds: number, durationSeconds: number) => {
      const safeProgress = Math.max(0, Math.floor(progressSeconds));
      const safeDuration = Math.max(0, Math.floor(durationSeconds));
      const isCompleted =
        safeDuration > 0 ? safeProgress / safeDuration >= 0.9 : false;

      const nowIso = new Date().toISOString();
      setAllVideos((prev) =>
        prev.map((v) =>
          v.video_id === videoId
            ? {
                ...v,
                progress_seconds: safeProgress,
                duration_seconds:
                  safeDuration > 0 ? safeDuration : v.duration_seconds,
                is_completed: v.is_completed || isCompleted,
                last_watched_at: nowIso,
              }
            : v,
        ),
      );

      if (authStatus !== 'authenticated') return;

      void fetch('/api/watch-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          videoId,
          progressSeconds: safeProgress,
          durationSeconds: safeDuration,
        }),
      }).catch(() => {
        // Bỏ qua lỗi mạng tạm thời khi tự động lưu ngầm
      });
    },
    [authStatus],
  );

  const loadExploreFeed = useCallback(
    async (forceRefresh = false) => {
      if (authStatus !== 'authenticated') return;
      setIsLoadingExplore(true);
      isLoadingMoreExploreRef.current = false;
      setIsLoadingMoreExplore(false);
      explorePageTokensRef.current = {};

      try {
        const res = await fetch(
          `/api/youtube/explore?page=1${forceRefresh ? '&refresh=true' : ''}`,
        );
        const payload = (await res.json().catch(() => ({}))) as {
          keywords?: string[];
          videos?: CinemaVideoItem[];
          page?: number;
          hasMore?: boolean;
          pageTokens?: Record<string, string>;
          cached?: boolean;
          error?: string;
        };

        if (!res.ok) {
          toast.error(payload.error || 'Không thể tải đề xuất Khám phá.');
          return;
        }

        setExploreKeywords(payload.keywords ?? []);
        setExploreVideos(payload.videos ?? []);
        setExplorePage(payload.page ?? 1);
        setHasMoreExplore(Boolean(payload.hasMore));
        explorePageTokensRef.current = payload.pageTokens ?? {};
        setHasLoadedExplore(true);

        if (forceRefresh) {
          toast.success(
            `Đã làm mới ${payload.videos?.length ?? 0} video đề xuất đúng gu!`,
          );
        }
      } catch {
        toast.error('Lỗi kết nối khi tải đề xuất Khám phá YouTube.');
      } finally {
        setIsLoadingExplore(false);
      }
    },
    [authStatus],
  );

  const handleLoadMoreExplore = useCallback(async () => {
    if (
      isLoadingMoreExploreRef.current ||
      isLoadingExplore ||
      !hasMoreExplore ||
      authStatus !== 'authenticated'
    ) {
      return;
    }

    isLoadingMoreExploreRef.current = true;
    setIsLoadingMoreExplore(true);

    const nextPage = explorePage + 1;
    const recentExcludeIds = exploreVideos
      .slice(-120)
      .map((v) => v.video_id)
      .join(',');

    const params = new URLSearchParams({
      page: String(nextPage),
      refresh: 'false',
    });
    if (Object.keys(explorePageTokensRef.current).length > 0) {
      params.set('pageTokens', JSON.stringify(explorePageTokensRef.current));
    }
    if (recentExcludeIds) {
      params.set('excludeIds', recentExcludeIds);
    }

    try {
      const res = await fetch(`/api/youtube/explore?${params.toString()}`);
      const payload = (await res.json().catch(() => ({}))) as {
        keywords?: string[];
        videos?: CinemaVideoItem[];
        page?: number;
        hasMore?: boolean;
        pageTokens?: Record<string, string>;
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Không thể tải thêm đề xuất Khám phá.');
        if (res.status === 429) {
          setHasMoreExplore(false);
        }
        return;
      }

      const incoming = payload.videos ?? [];
      if (incoming.length > 0) {
        setExploreVideos((prev) => {
          const seen = new Set(prev.map((v) => v.video_id));
          const merged = [...prev];
          for (const item of incoming) {
            if (!seen.has(item.video_id)) {
              seen.add(item.video_id);
              merged.push(item);
            }
          }
          return merged;
        });
      }

      if (payload.keywords && payload.keywords.length > 0) {
        setExploreKeywords((prev) =>
          Array.from(new Set([...prev, ...payload.keywords!])).slice(0, 9),
        );
      }

      setExplorePage(payload.page ?? nextPage);
      setHasMoreExplore(Boolean(payload.hasMore));
      explorePageTokensRef.current = payload.pageTokens ?? {};
    } catch {
      toast.error('Lỗi kết nối khi tải thêm gợi ý Khám phá.');
    } finally {
      isLoadingMoreExploreRef.current = false;
      setIsLoadingMoreExplore(false);
    }
  }, [
    authStatus,
    isLoadingExplore,
    hasMoreExplore,
    explorePage,
    exploreVideos,
  ]);

  const handleChangeViewMode = useCallback(
    (mode: WorkspaceViewMode) => {
      saveCurrentTabScroll();
      setViewMode(mode);
      setIsVaultOpen(false);
      if (mode === 'explore' && !hasLoadedExplore && !isLoadingExplore) {
        void loadExploreFeed(false);
      }
    },
    [saveCurrentTabScroll, hasLoadedExplore, isLoadingExplore, loadExploreFeed],
  );

  const handleChangeVideoType = useCallback(
    (nextType: VideoTypeFilter) => {
      saveCurrentTabScroll();
      setVideoType(nextType);
    },
    [saveCurrentTabScroll],
  );

  const handleSubscribeChannel = useCallback(
    async (
      channelIdOrHandle: string,
      channelTitle?: string,
      genreTags?: PrimaryGenreTag[],
    ) => {
      const cleanTarget = channelIdOrHandle.trim();
      if (!cleanTarget) return;
      setSubscribingChannelId(cleanTarget);
      try {
        const res = await fetch('/api/youtube/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: cleanTarget,
            handleOrUrl: cleanTarget,
            channelTitle,
            genreTags,
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          channelTitle?: string;
          fetchedVideosCount?: number;
          channels?: ChannelWithSelection[];
          videos?: CinemaVideoItem[];
          code?: string;
          error?: string;
        };

        if (!res.ok) {
          if (payload.code === 'TOKEN_EXPIRED' || res.status === 401) {
            toast.error(
              payload.error ||
                'Token Google đã hết hạn hoặc thiếu quyền đăng ký kênh. Vui lòng đăng nhập lại bằng Google.',
              {
                duration: 8000,
                action: {
                  label: 'Đăng nhập lại',
                  onClick: () => router.push('/login'),
                },
              },
            );
          } else {
            toast.error(payload.error || 'Không thể thêm kênh này.');
          }
          return;
        }

        if (payload.channels) setChannels(payload.channels);
        if (payload.videos) setAllVideos(payload.videos);
        router.refresh();

        toast.success(
          `Đã thêm "${payload.channelTitle || channelTitle || cleanTarget}" & đồng bộ ${payload.fetchedVideosCount ?? 0} video thật từ YouTube vào AniSub!`,
        );
      } catch {
        toast.error('Lỗi kết nối khi thêm kênh YouTube.');
      } finally {
        setSubscribingChannelId(null);
      }
    },
    [router],
  );

  const handleNavigateLogin = () => {
    router.push('/login');
  };

  const handleSignOut = async () => {
    try {
      if (
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ) {
        const supabase = createClient();
        await supabase.auth.signOut();
      }
      setUser(null);
      setAuthStatus('unauthenticated');
      toast.info('Đã đăng xuất khỏi AniSub.');
      router.push('/login');
      router.refresh();
    } catch {
      toast.error('Không thể đăng xuất lúc này.');
    }
  };

  const handleSyncFromYouTube = async () => {
    if (authStatus !== 'authenticated') {
      toast.warning(
        'Vui lòng đăng nhập Google hợp lệ trước khi đồng bộ YouTube.',
      );
      return;
    }

    setIsSyncing(true);
    try {
      const res = await fetch('/api/youtube/sync-channels', {
        method: 'POST',
      });

      const payload = (await res.json().catch(() => ({}))) as {
        syncedCount?: number;
        lastSyncedAt?: string;
        channels?: ChannelWithSelection[];
        videos?: CinemaVideoItem[];
        code?: string;
        error?: string;
      };

      if (!res.ok) {
        if (payload.code === 'TOKEN_EXPIRED' || res.status === 401) {
          toast.error(
            payload.error ||
              'Google Access Token đã hết hạn. Vui lòng đăng nhập lại bằng Google để làm mới phiên.',
            {
              duration: 8000,
              action: {
                label: 'Đăng nhập lại',
                onClick: () => router.push('/login'),
              },
            },
          );
        } else {
          toast.error(payload.error || 'Không thể đồng bộ kênh từ YouTube.');
        }
        return;
      }

      if (payload.channels) {
        setChannels(payload.channels);
      }
      if (payload.videos) {
        setAllVideos(payload.videos);
      }
      if (process.env.NODE_ENV !== 'development' && payload.lastSyncedAt) {
        setLastSyncedAt(payload.lastSyncedAt);
      } else {
        setLastSyncedAt(null);
      }

      toast.success(
        `Đã đồng bộ thành công ${payload.syncedCount ?? 0} kênh đăng ký từ YouTube!`,
      );
    } catch {
      toast.error('Lỗi kết nối máy chủ khi đồng bộ kênh YouTube.');
    } finally {
      setIsSyncing(false);
    }
  };

  const persistChannelToggle = async (
    channelId: string,
    isSelected: boolean,
    genreTags: PrimaryGenreTag[],
  ) => {
    setBusyChannelId(channelId);
    const previousChannels = channels;

    setChannels((prev) =>
      prev.map((ch) =>
        ch.channel_id === channelId
          ? {
              ...ch,
              is_selected: isSelected,
              genre_tag: genreTags[0],
              genre_tags: genreTags,
            }
          : ch,
      ),
    );

    try {
      const res = await fetch('/api/channels/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          isSelected,
          genreTags,
          genreTag: genreTags[0],
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        fetchedVideosCount?: number;
        newVideosCount?: number;
        aiClassified?: boolean;
        warning?: string | null;
        channels?: ChannelWithSelection[];
        videos?: CinemaVideoItem[];
        totalVideosCount?: number;
        hasMoreVideos?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setChannels(previousChannels);
        toast.error(payload.error || 'Không thể cập nhật kênh.');
        return;
      }

      if (payload.channels) {
        setChannels(payload.channels);
      }
      if (payload.videos) {
        setAllVideos(payload.videos);
      }

      if (payload.warning) {
        toast.warning(payload.warning);
      } else if (isSelected) {
        if (genreTags.length >= 2 && payload.aiClassified) {
          toast.success(
            `Gemini Vision đã phân loại ${payload.newVideosCount ?? payload.fetchedVideosCount ?? 0} video mới theo ${genreTags.join(' / ')}!`,
          );
        } else {
          toast.success(
            `Đã cập nhật kênh (${genreTags.join(' / ')}) & đồng bộ ${payload.fetchedVideosCount ?? 0} video (${payload.newVideosCount ?? 0} mới)!`,
          );
        }
      } else {
        toast.info('Đã ẩn kênh khỏi rạp phim AniSub.');
      }
    } catch {
      setChannels(previousChannels);
      toast.error('Lỗi kết nối khi cập nhật kênh.');
    } finally {
      setBusyChannelId(null);
    }
  };

  const handleToggleChannel = (channelId: string, nextSelected: boolean) => {
    const current = channels.find((c) => c.channel_id === channelId);
    const genreTags: PrimaryGenreTag[] =
      current?.genre_tags && current.genre_tags.length > 0
        ? current.genre_tags
        : ['HH2D'];
    void persistChannelToggle(channelId, nextSelected, genreTags);
  };

  const handleToggleChannelGenreTag = (
    channelId: string,
    tag: PrimaryGenreTag,
  ) => {
    const current = channels.find((c) => c.channel_id === channelId);
    if (!current) return;

    const currentTags =
      current.genre_tags && current.genre_tags.length > 0
        ? current.genre_tags
        : (['HH2D'] as PrimaryGenreTag[]);

    const exists = currentTags.includes(tag);
    if (exists && currentTags.length === 1) {
      toast.warning('Mỗi kênh đang bật cần giữ ít nhất 1 thể loại.');
      return;
    }

    const nextTags = exists
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];

    void persistChannelToggle(channelId, current.is_selected, nextTags);
  };

  const handleReclassifyChannel = async (channelId: string) => {
    const current = channels.find((c) => c.channel_id === channelId);
    if (!current) return;

    setBusyChannelId(channelId);
    try {
      const res = await fetch('/api/channels/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          genreTags: current.genre_tags,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        reclassifiedCount?: number;
        channels?: ChannelWithSelection[];
        videos?: CinemaVideoItem[];
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Không thể quét lại phân loại AI.');
        return;
      }

      if (payload.channels) setChannels(payload.channels);
      if (payload.videos) setAllVideos(payload.videos);

      toast.success(
        `Gemini Vision đã phân loại lại ${payload.reclassifiedCount ?? 0} video cho kênh "${current.title}"!`,
      );
    } catch {
      toast.error('Lỗi kết nối khi chạy Quét AI lại.');
    } finally {
      setBusyChannelId(null);
    }
  };

  const handleLoadMoreChannelVideos = async (channelId: string) => {
    const current = channels.find((c) => c.channel_id === channelId);
    if (!current) return;

    setBusyChannelId(channelId);
    try {
      const res = await fetch('/api/channels/load-more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          genreTags: current.genre_tags,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        fetchedCount?: number;
        newVideosCount?: number;
        aiClassifiedCount?: number;
        hasMoreChannelVideos?: boolean;
        warning?: string | null;
        channels?: ChannelWithSelection[];
        videos?: CinemaVideoItem[];
        totalVideosCount?: number;
        hasMoreVideos?: boolean;
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Không thể kéo thêm video cũ cho kênh này.');
        return;
      }

      if (payload.channels) setChannels(payload.channels);
      if (payload.videos) setAllVideos(payload.videos);

      if (payload.warning) {
        toast.warning(payload.warning);
      } else if ((payload.fetchedCount ?? 0) === 0) {
        toast.info(`Kênh "${current.title}" không còn video cũ hơn để kéo.`);
      } else {
        toast.success(
          `Đã đồng bộ trọn bộ ${payload.fetchedCount ?? 0} video (${payload.newVideosCount ?? 0} mới) cho kênh "${current.title}"!`,
        );
      }
    } catch {
      toast.error('Lỗi kết nối khi đồng bộ toàn bộ video kênh.');
    } finally {
      setBusyChannelId(null);
    }
  };

  const handleCycleVideoGenre = useCallback(
    async (video: CinemaVideoItem, nextGenre: PrimaryGenreTag) => {
      const previousVideos = allVideos;

      // Tính toán optimistic seriesKey để cập nhật tức thì mọi tập cùng bộ đang hiển thị
      const targetInfo = extractSeriesInfo({
        videoId: video.video_id,
        channelId: video.channel_id,
        title: video.title,
        channelTitle: video.channel_title,
        seriesName: video.series_name,
      });

      setAllVideos((prev) =>
        prev.map((v) => {
          if (v.video_id === video.video_id) {
            return { ...v, detected_genre: nextGenre, is_manual_tag: true };
          }
          if (
            !targetInfo.isStandalone &&
            v.channel_id === video.channel_id
          ) {
            const vInfo = extractSeriesInfo({
              videoId: v.video_id,
              channelId: v.channel_id,
              title: v.title,
              channelTitle: v.channel_title,
              seriesName: v.series_name,
            });
            if (vInfo.seriesKey === targetInfo.seriesKey) {
              return { ...v, detected_genre: nextGenre, is_manual_tag: true };
            }
          }
          return v;
        }),
      );

      try {
        const res = await fetch('/api/videos/update-genre', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: video.video_id,
            detectedGenre: nextGenre,
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          updatedVideoIds?: string[];
          propagatedCount?: number;
          seriesTitle?: string;
          warning?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setAllVideos(previousVideos);
          toast.error(payload.error || 'Không thể đổi nhãn cho video.');
          return;
        }

        const updatedSet = new Set(
          payload.updatedVideoIds?.length
            ? payload.updatedVideoIds
            : [video.video_id],
        );
        const propagatedCount = payload.propagatedCount ?? updatedSet.size;

        setAllVideos((prev) =>
          prev.map((v) =>
            updatedSet.has(v.video_id)
              ? { ...v, detected_genre: nextGenre, is_manual_tag: true }
              : v,
          ),
        );

        if (payload.warning) {
          toast.warning(payload.warning);
        } else {
          toast.success(
            `Đã cập nhật tag ${nextGenre} cho toàn bộ ${propagatedCount} tập của bộ phim`,
          );
        }
      } catch {
        setAllVideos(previousVideos);
        toast.error('Lỗi kết nối khi lưu nhãn thủ công.');
      }
    },
    [allVideos],
  );

  const handleReclassifyAll = async () => {
    setIsReclassifyingAll(true);
    try {
      const channelTags: Record<string, PrimaryGenreTag[]> = {};
      for (const ch of channels) {
        if (ch.is_selected) {
          channelTags[ch.channel_id] = ch.genre_tags;
        }
      }

      const res = await fetch('/api/videos/reclassify-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelTags }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        totalVideos?: number;
        updatedCount?: number;
        changedCount?: number;
        skippedManualCount?: number;
        aiScannedCount?: number;
        seriesScannedCount?: number;
        warning?: string | null;
        channels?: ChannelWithSelection[];
        videos?: CinemaVideoItem[];
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Không thể quét lại nhãn AI toàn bộ.');
        return;
      }

      if (payload.channels) setChannels(payload.channels);
      if (payload.videos) setAllVideos(payload.videos);
      router.refresh();

      if (payload.warning) {
        toast.warning(payload.warning);
      } else {
        const seriesNote =
          typeof payload.seriesScannedCount === 'number' &&
          payload.seriesScannedCount > 0
            ? `quét ${payload.seriesScannedCount} bộ phim và `
            : '';
        toast.success(
          `Gemini Vision đã ${seriesNote}phân loại lại ${payload.updatedCount ?? 0}/${payload.totalVideos ?? 0} video (đổi nhãn: ${payload.changedCount ?? 0}, khóa thủ công: ${payload.skippedManualCount ?? 0})!`,
        );
      }
    } catch {
      toast.error('Lỗi kết nối khi chạy Quét lại nhãn AI.');
    } finally {
      setIsReclassifyingAll(false);
    }
  };

  const handleResumeContinueVideo = useCallback(
    (video: CinemaVideoItem) => {
      const matchedSeries = allSeriesGroups.find((s) =>
        s.episodes.some((ep) => ep.video.video_id === video.video_id),
      );
      if (matchedSeries) {
        setActiveSeriesKey(matchedSeries.seriesKey);
      }
      handleSelectVideo(video);
    },
    [allSeriesGroups, handleSelectVideo],
  );

  const handleRemoveFromContinue = useCallback(
    async (videoId: string) => {
      const previousVideos = allVideos;
      setAllVideos((prev) =>
        prev.map((v) =>
          v.video_id === videoId
            ? {
                ...v,
                progress_seconds: 0,
                is_completed: false,
                last_watched_at: null,
              }
            : v,
        ),
      );

      if (authStatus !== 'authenticated') return;

      try {
        const res = await fetch('/api/watch-progress', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId }),
        });
        if (!res.ok) {
          setAllVideos(previousVideos);
          toast.error('Không thể xóa khỏi danh sách xem tiếp.');
        }
      } catch {
        setAllVideos(previousVideos);
        toast.error('Lỗi kết nối khi xóa khỏi danh sách xem tiếp.');
      }
    },
    [allVideos, authStatus],
  );

  const handleUpdateSeriesStatus = useCallback(
    async (series: SeriesGroup, nextStatus: UserSeriesStatus | null) => {
      const prevStatuses = seriesStatuses;
      setSeriesStatuses((prev) => {
        const copy = { ...prev };
        if (nextStatus === null) {
          delete copy[series.seriesKey];
        } else {
          copy[series.seriesKey] = nextStatus;
        }
        return copy;
      });

      try {
        const res = await fetch('/api/series/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: series.channelId,
            seriesKey: series.seriesKey,
            status: nextStatus,
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          warning?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setSeriesStatuses(prevStatuses);
          toast.error(payload.error || 'Không thể cập nhật trạng thái bộ phim.');
          return;
        }

        if (payload.warning) {
          toast.warning(payload.warning);
        } else if (nextStatus === 'following') {
          toast.success(`⭐ Đã theo dõi & ghim "${series.seriesTitle}" lên đầu`);
        } else if (nextStatus === 'hidden') {
          toast.info(`Đã ẩn bộ phim "${series.seriesTitle}"`);
        } else {
          toast.info(`Đã khôi phục trạng thái mặc định cho "${series.seriesTitle}"`);
        }
      } catch {
        setSeriesStatuses(prevStatuses);
        toast.error('Lỗi kết nối khi lưu trạng thái bộ phim.');
      }
    },
    [seriesStatuses],
  );

  // Smart Delta Sync: Quét nhanh 10 video mới nhất của các kênh đang bật (background hoặc thủ công)
  const runDeltaSync = useCallback(
    async (force: boolean) => {
      if (
        authStatus !== 'authenticated' ||
        selectedChannelIds.size === 0 ||
        isDeltaSyncing
      ) {
        return;
      }

      setIsDeltaSyncing(true);
      try {
        const res = await fetch('/api/channels/delta-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          skipped?: boolean;
          newVideosCount?: number;
          syncedChannelsCount?: number;
          videos?: CinemaVideoItem[];
          channels?: ChannelWithSelection[];
          warning?: string | null;
          error?: string;
        };

        if (!res.ok) {
          if (force) {
            toast.error(payload.error || 'Không thể kiểm tra tập mới lúc này.');
          }
          return;
        }

        try {
          window.localStorage.setItem(
            DELTA_SYNC_STORAGE_KEY,
            String(Date.now()),
          );
        } catch {
          // Ignore storage error
        }

        if (payload.channels) {
          setChannels(payload.channels);
        }
        if (Array.isArray(payload.videos) && payload.videos.length > 0) {
          setAllVideos(payload.videos);
        }

        if ((payload.newVideosCount ?? 0) > 0) {
          toast.success(
            `🔔 Đã cập nhật ${payload.newVideosCount} tập mới từ các kênh theo dõi!`,
          );
        } else if (force) {
          toast.info('Kho phim đã ở trạng thái mới nhất!');
        }
      } catch {
        if (force) {
          toast.error('Lỗi kết nối khi kiểm tra tập mới.');
        }
      } finally {
        setIsDeltaSyncing(false);
      }
    },
    [authStatus, selectedChannelIds.size, isDeltaSyncing],
  );

  // Tự động chạy ngầm Smart Delta Sync khi mở app nếu đã quá >= 60 phút từ lần quét trước
  useEffect(() => {
    if (
      hasTriggeredAutoDeltaRef.current ||
      authStatus !== 'authenticated' ||
      selectedChannelIds.size === 0
    ) {
      return;
    }

    hasTriggeredAutoDeltaRef.current = true;

    let shouldRun = true;
    try {
      const raw = window.localStorage.getItem(DELTA_SYNC_STORAGE_KEY);
      const lastTs = raw ? Number(raw) : 0;
      if (Number.isFinite(lastTs) && lastTs > 0) {
        if (Date.now() - lastTs < DELTA_SYNC_INTERVAL_MS) {
          shouldRun = false;
        }
      }
    } catch {
      // Fallback sang server cooldown
    }

    if (shouldRun) {
      void runDeltaSync(false);
    }
  }, [authStatus, selectedChannelIds.size, runDeltaSync]);

  const handleScrollToMainStage = useCallback(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    theaterStageRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  const handleToggleWatchLater = useCallback(
    async (videoId: string) => {
      const prevList = watchLaterList;
      const alreadySaved = prevList.includes(videoId);

      setWatchLaterList((prev) =>
        alreadySaved
          ? prev.filter((id) => id !== videoId)
          : [videoId, ...prev],
      );

      if (authStatus !== 'authenticated') return;

      try {
        const res = await fetch('/api/videos/watch-later', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          saved?: boolean;
          warning?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setWatchLaterList(prevList);
          toast.error(payload.error || 'Không thể cập nhật danh sách Xem sau.');
          return;
        }

        if (payload.warning) {
          toast.warning(payload.warning);
        } else if (payload.saved) {
          toast.success('Đã lưu vào danh sách Xem sau');
        } else {
          toast.info('Đã xóa khỏi danh sách Xem sau');
        }
      } catch {
        setWatchLaterList(prevList);
        toast.error('Lỗi kết nối khi lưu Xem sau.');
      }
    },
    [watchLaterList, authStatus],
  );

  const handleSummaryGenerated = useCallback(
    (videoId: string, aiSummary: string) => {
      setAllVideos((prev) =>
        prev.map((v) =>
          v.video_id === videoId ? { ...v, ai_summary: aiSummary } : v,
        ),
      );
    },
    [],
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg-canvas)] p-2 pb-18 md:gap-3 md:p-3 md:pb-3">
      <FloatingRail
        viewMode={viewMode}
        onChangeViewMode={handleChangeViewMode}
        genreFilter={genreFilter}
        onChangeGenreFilter={setGenreFilter}
        isVaultOpen={isVaultOpen}
        onOpenVault={() => setIsVaultOpen(true)}
        selectedChannelCount={selectedChannelIds.size}
        watchLaterCount={watchLaterList.length}
        authStatus={authStatus}
        isAdmin={isAdmin}
        pendingRequestsCount={pendingRequestsCount}
        userEmail={user?.email}
        userFullName={user?.fullName}
        userAvatarUrl={user?.avatarUrl}
        onNavigateLogin={handleNavigateLogin}
        onOpenWhitelistModal={() => setIsWhitelistOpen(true)}
        onSignOut={handleSignOut}
      />

      <main
        ref={mainScrollRef}
        className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5"
      >
        <div ref={theaterStageRef}>
          {activeVideo ? (
            <TheaterStage
              key={activeVideo.video_id}
              video={activeVideo}
              nextVideo={nextVideo}
              activeSeries={activeSeries}
              activeSeriesStatus={
                activeSeries
                  ? (seriesStatuses[activeSeries.seriesKey] ?? null)
                  : null
              }
              onUpdateSeriesStatus={handleUpdateSeriesStatus}
              isWatchLater={watchLaterSet.has(activeVideo.video_id)}
              onToggleWatchLater={handleToggleWatchLater}
              onScrollToMainStage={handleScrollToMainStage}
              isChannelSubscribed={selectedChannelIds.has(
                activeVideo.channel_id,
              )}
              isSubscribingChannel={
                subscribingChannelId === activeVideo.channel_id
              }
              onSubscribeChannel={handleSubscribeChannel}
              onSelectVideo={handleSelectVideo}
              onSaveProgress={handleSaveWatchProgress}
              onSummaryGenerated={handleSummaryGenerated}
              onClose={() => {
                setActiveVideoId(null);
                setActiveSeriesKey(null);
              }}
            />
          ) : (
            <CommandHub
              viewMode={viewMode}
              onChangeViewMode={handleChangeViewMode}
              searchQuery={searchQuery}
              onChangeSearch={setSearchQuery}
              videoType={videoType}
              onChangeVideoType={handleChangeVideoType}
              showTrailers={showTrailers}
              onToggleTrailers={setShowTrailers}
              genreFilter={genreFilter}
              onChangeGenreFilter={setGenreFilter}
              sortBy={sortBy}
              onChangeSortBy={setSortBy}
              onlyUnwatched={onlyUnwatched}
              onToggleOnlyUnwatched={setOnlyUnwatched}
              isRealtimeConnected={authStatus === 'authenticated'}
              totalMatchingVideos={
                viewMode === 'cinema' && videoType === 'episode'
                  ? filteredSeriesGroups.length
                  : displayFeedVideos.length
              }
              exploreKeywords={exploreKeywords}
              isLoadingExplore={isLoadingExplore}
              onRefreshExplore={() => void loadExploreFeed(true)}
              isDeltaSyncing={isDeltaSyncing}
              onTriggerDeltaSync={
                authStatus === 'authenticated' && selectedChannelIds.size > 0
                  ? () => void runDeltaSync(true)
                  : undefined
              }
            />
          )}
        </div>

        {/* Thanh "Xem Tiếp" (Continue Watching Shelf) ngay dưới Command Hub ở tab Tất cả & Tập mới */}
        {!activeVideo &&
          authStatus === 'authenticated' &&
          viewMode === 'cinema' &&
          (videoType === 'all' || videoType === 'episode') &&
          continueWatchingVideos.length > 0 && (
            <ContinueWatchingShelf
              videos={continueWatchingVideos}
              onResumeVideo={handleResumeContinueVideo}
              onRemoveFromContinue={handleRemoveFromContinue}
            />
          )}

        {authStatus === 'authenticated' &&
        viewMode === 'cinema' &&
        videoType === 'episode' &&
        selectedChannelIds.size > 0 ? (
          <SeriesGrid
            seriesList={filteredSeriesGroups}
            activeSeriesKey={activeSeriesKey}
            totalEpisodesCount={totalSeriesEpisodesCount}
            seriesStatuses={seriesStatuses}
            sortBy={sortBy}
            onSelectSeries={handleSelectSeries}
            onUpdateSeriesStatus={handleUpdateSeriesStatus}
            onOpenVault={() => setIsVaultOpen(true)}
          />
        ) : (
          <StructuredCinemaRows
            authStatus={authStatus}
            selectedChannelCount={selectedChannelIds.size}
            videos={displayFeedVideos}
            activeVideoId={activeVideo?.video_id ?? null}
            viewMode={viewMode}
            isLoadingExplore={isLoadingExplore}
            hasMoreExplore={hasMoreExplore}
            isLoadingMoreExplore={isLoadingMoreExplore}
            onLoadMoreExplore={handleLoadMoreExplore}
            selectedChannelIds={selectedChannelIds}
            watchLaterIds={watchLaterSet}
            subscribingChannelId={subscribingChannelId}
            sectionHeading={
              viewMode === 'explore'
                ? 'Khám phá YouTube — Kênh mới hợp gu của bạn'
                : viewMode === 'watch_later'
                  ? `Danh sách Xem sau (${watchLaterList.length})`
                  : activeVideo
                    ? `Đề xuất cùng thể loại [${activeVideo.detected_genre ?? 'HH2D'}] & Tập tiếp theo`
                    : videoType === 'theatrical'
                      ? 'Phim Chiếu Rạp & Bản Điện Ảnh (Theatrical Movies / OVA)'
                      : undefined
            }
            sectionSubtitle={
              viewMode === 'explore'
                ? 'Gợi ý cá nhân hóa từ lịch sử xem & Like YouTube (đã lọc bỏ Shorts, ưu tiên kênh chưa theo dõi)'
                : viewMode === 'watch_later'
                  ? 'Các video bạn đã đánh dấu lưu lại để cày sau — bấm biểu tượng Bookmark để gỡ sau khi xem xong'
                  : activeVideo
                    ? 'Ưu tiên tập kế tiếp cùng bộ/kênh, theo sau là gợi ý cùng thể loại đã làm mới ngẫu nhiên'
                    : videoType === 'theatrical'
                      ? 'Tự động nhận diện Anime Movie, Bản điện ảnh chiếu rạp, OVA/Special hoặc phim lẻ từ 65 phút trở lên'
                      : undefined
            }
            onSelectVideo={handleSelectVideo}
            onCycleVideoGenre={handleCycleVideoGenre}
            onToggleWatchLater={handleToggleWatchLater}
            onSubscribeChannel={handleSubscribeChannel}
            onOpenVault={() => setIsVaultOpen(true)}
            onTriggerGoogleSignIn={handleNavigateLogin}
          />
        )}
      </main>

      <ChannelVaultDrawer
        open={isVaultOpen}
        onClose={() => setIsVaultOpen(false)}
        channels={channels}
        lastSyncedAt={lastSyncedAt}
        isSyncing={isSyncing}
        isReclassifyingAll={isReclassifyingAll}
        busyChannelId={busyChannelId}
        quickAddingHandle={subscribingChannelId}
        onSyncFromYouTube={handleSyncFromYouTube}
        onReclassifyAll={handleReclassifyAll}
        onToggleChannel={handleToggleChannel}
        onToggleChannelGenreTag={handleToggleChannelGenreTag}
        onReclassifyChannel={handleReclassifyChannel}
        onLoadMoreChannelVideos={handleLoadMoreChannelVideos}
        onQuickAddChannel={handleSubscribeChannel}
      />

      <WhitelistModal
        open={isWhitelistOpen}
        onClose={() => setIsWhitelistOpen(false)}
        currentUserEmail={user?.email}
      />
    </div>
  );
}
