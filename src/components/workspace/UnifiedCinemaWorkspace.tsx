'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FloatingRail } from '@/components/workspace/FloatingRail';
import { CommandHub } from '@/components/workspace/CommandHub';
import { TheaterStage } from '@/components/workspace/TheaterStage';
import { StructuredCinemaRows } from '@/components/workspace/StructuredCinemaRows';
import { SeriesGrid } from '@/components/workspace/SeriesGrid';
import { ChannelVaultDrawer } from '@/components/workspace/ChannelVaultDrawer';
import { WhitelistModal } from '@/components/workspace/WhitelistModal';
import { createClient } from '@/lib/supabase/client';
import {
  groupVideosIntoSeries,
  type SeriesGroup,
} from '@/lib/series-parser';
import {
  type ChannelWithSelection,
  type CinemaVideoItem,
  type GenreFilter,
  type PrimaryGenreTag,
  type VideoTypeFilter,
  type WorkspaceAuthStatus,
  type WorkspaceViewMode,
} from '@/types/workspace';

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
  initialTotalVideosCount?: number;
  initialHasMoreVideos?: boolean;
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
  initialTotalVideosCount,
  initialHasMoreVideos = false,
  isAdmin = false,
  pendingRequestsCount = 0,
}: UnifiedCinemaWorkspaceProps) {
  const router = useRouter();
  const mainScrollRef = useRef<HTMLElement>(null);
  const theaterStageRef = useRef<HTMLDivElement>(null);

  const [authStatus, setAuthStatus] =
    useState<WorkspaceAuthStatus>(initialAuthStatus);
  const [user, setUser] = useState<InitialWorkspaceUser | null>(initialUser);
  const [channels, setChannels] =
    useState<ChannelWithSelection[]>(initialChannels);
  const [videos, setVideos] = useState<CinemaVideoItem[]>(initialVideos);
  const [totalVideosCount, setTotalVideosCount] = useState<number>(
    initialTotalVideosCount ?? initialVideos.length,
  );
  const [hasMoreVideos, setHasMoreVideos] = useState<boolean>(
    initialHasMoreVideos,
  );
  const [hasMoreYouTubeHistory, setHasMoreYouTubeHistory] = useState<boolean>(
    () => initialChannels.some((c) => c.is_selected),
  );
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [isLoadingMoreVideos, setIsLoadingMoreVideos] = useState(false);
  const [isFetchingYouTubeHistory, setIsFetchingYouTubeHistory] =
    useState(false);
  const isFetchingYouTubeRef = useRef(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const hasSkippedInitialFilterFetchRef = useRef(false);
  const [exploreVideos, setExploreVideos] = useState<CinemaVideoItem[]>([]);
  const [exploreKeywords, setExploreKeywords] = useState<string[]>([]);
  const [hasLoadedExplore, setHasLoadedExplore] = useState(false);
  const [isLoadingExplore, setIsLoadingExplore] = useState(false);
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

  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null);
  const [recommendedOrderIds, setRecommendedOrderIds] = useState<string[]>([]);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [isWhitelistOpen, setIsWhitelistOpen] = useState(false);

  const selectedChannelIds = useMemo(
    () =>
      new Set(channels.filter((c) => c.is_selected).map((c) => c.channel_id)),
    [channels],
  );

  const filteredVideos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return videos.filter((v) => {
      if (v.is_short) return false;
      if (selectedChannelIds.size > 0 && !selectedChannelIds.has(v.channel_id)) {
        return false;
      }
      if (!showTrailers && v.video_type === 'trailer') return false;
      if (videoType === 'episode' && v.video_type !== 'episode') return false;
      if (videoType === 'full_movie' && v.video_type !== 'full_movie') {
        return false;
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
  }, [
    videos,
    selectedChannelIds,
    showTrailers,
    videoType,
    genreFilter,
    searchQuery,
  ]);

  const activeVideo = useMemo(() => {
    if (!activeVideoId) return null;
    return (
      videos.find((v) => v.video_id === activeVideoId) ??
      exploreVideos.find((v) => v.video_id === activeVideoId) ??
      null
    );
  }, [videos, exploreVideos, activeVideoId]);

  // Gom nhóm toàn bộ video tập lẻ thành các Bộ phim (Series Playlist)
  const allSeriesGroups = useMemo(() => {
    const channelVideos = videos.filter(
      (v) =>
        selectedChannelIds.size === 0 || selectedChannelIds.has(v.channel_id),
    );
    return groupVideosIntoSeries(channelVideos);
  }, [videos, selectedChannelIds]);

  const filteredSeriesGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allSeriesGroups.filter((series) => {
      if (genreFilter !== 'all' && series.detectedGenre !== genreFilter) {
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
  }, [allSeriesGroups, genreFilter, searchQuery]);

  const totalSeriesEpisodesCount = useMemo(
    () => filteredSeriesGroups.reduce((acc, s) => acc + s.totalEpisodes, 0),
    [filteredSeriesGroups],
  );

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

    const videoMap = new Map(videos.map((v) => [v.video_id, v]));
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
    videos,
    recommendedOrderIds,
  ]);

  const nextVideo = useMemo(() => {
    if (!activeVideo || displayFeedVideos.length === 0) return null;
    return displayFeedVideos[0];
  }, [activeVideo, displayFeedVideos]);

  // Chọn video -> cập nhật danh sách gợi ý xáo trộn + tự động cuộn mượt lên Theater Stage
  const handleSelectVideo = useCallback(
    (video: CinemaVideoItem) => {
      setActiveVideoId(video.video_id);
      if (
        activeSeries &&
        !activeSeries.episodes.some((ep) => ep.video.video_id === video.video_id)
      ) {
        setActiveSeriesKey(null);
      }
      const pool = videos.filter(
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
    [videos, selectedChannelIds, activeSeries],
  );

  // Chọn 1 Bộ phim (Series Card) -> mở sân khấu TheaterStage ở chế độ Playlist & phát tập phù hợp nhất
  const handleSelectSeries = useCallback(
    (series: SeriesGroup) => {
      const targetVideo = series.recommendedEpisode.video;
      setActiveSeriesKey(series.seriesKey);
      setActiveVideoId(targetVideo.video_id);

      const pool = videos.filter(
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
    [videos, selectedChannelIds],
  );

  // Tự động lưu tiến độ xem (UPSERT public.watch_progress) + cập nhật state local tức thì
  const handleSaveWatchProgress = useCallback(
    (videoId: string, progressSeconds: number, durationSeconds: number) => {
      const safeProgress = Math.max(0, Math.floor(progressSeconds));
      const safeDuration = Math.max(0, Math.floor(durationSeconds));
      const isCompleted =
        safeDuration > 0 ? safeProgress / safeDuration >= 0.9 : false;

      setVideos((prev) =>
        prev.map((v) =>
          v.video_id === videoId
            ? {
                ...v,
                progress_seconds: safeProgress,
                duration_seconds:
                  safeDuration > 0 ? safeDuration : v.duration_seconds,
                is_completed: v.is_completed || isCompleted,
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
      try {
        const res = await fetch(
          `/api/youtube/explore${forceRefresh ? '?refresh=true' : ''}`,
        );
        const payload = (await res.json().catch(() => ({}))) as {
          keywords?: string[];
          videos?: CinemaVideoItem[];
          cached?: boolean;
          error?: string;
        };

        if (!res.ok) {
          toast.error(payload.error || 'Không thể tải đề xuất Khám phá.');
          return;
        }

        setExploreKeywords(payload.keywords ?? []);
        setExploreVideos(payload.videos ?? []);
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

  const handleChangeViewMode = useCallback(
    (mode: WorkspaceViewMode) => {
      setViewMode(mode);
      setIsVaultOpen(false);
      if (mode === 'explore' && !hasLoadedExplore && !isLoadingExplore) {
        void loadExploreFeed(false);
      }
    },
    [hasLoadedExplore, isLoadingExplore, loadExploreFeed],
  );

  // Hàm tải lại lô 60 video đầu tiên theo đúng bộ lọc hiện tại (đồng bộ tức thì sau khi kéo video / đổi tag / đăng ký kênh)
  const refreshCurrentFeed = useCallback(async () => {
    if (authStatus !== 'authenticated' || viewMode === 'explore') return;

    const effectiveTab = viewMode === 'continue' ? 'continue' : videoType;
    const params = new URLSearchParams({
      offset: '0',
      limit: '60',
      genre: genreFilter,
      tab: effectiveTab,
      showTrailers: String(showTrailers),
    });
    if (debouncedSearchQuery) {
      params.set('q', debouncedSearchQuery);
    }

    try {
      const res = await fetch(`/api/videos?${params.toString()}`);
      if (!res.ok) return;
      const payload = (await res.json().catch(() => ({}))) as {
        videos?: CinemaVideoItem[];
        totalCount?: number;
        hasMore?: boolean;
      };
      if (Array.isArray(payload.videos)) {
        setVideos(payload.videos);
      }
      if (typeof payload.totalCount === 'number') {
        setTotalVideosCount(payload.totalCount);
      }
      if (typeof payload.hasMore === 'boolean') {
        setHasMoreVideos(payload.hasMore);
      }
    } catch {
      // Bỏ qua lỗi mạng tạm thời
    }
  }, [
    authStatus,
    viewMode,
    videoType,
    genreFilter,
    showTrailers,
    debouncedSearchQuery,
  ]);

  const handleSubscribeChannel = useCallback(
    async (channelId: string, channelTitle?: string) => {
      setSubscribingChannelId(channelId);
      try {
        const res = await fetch('/api/youtube/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId, channelTitle }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          channelTitle?: string;
          fetchedVideosCount?: number;
          channels?: ChannelWithSelection[];
          videos?: CinemaVideoItem[];
          totalVideosCount?: number;
          hasMoreVideos?: boolean;
          code?: string;
          error?: string;
        };

        if (!res.ok) {
          if (payload.code === 'TOKEN_EXPIRED') {
            toast.error(
              payload.error ||
                'Token Google đã hết hạn hoặc thiếu quyền đăng ký kênh. Vui lòng Đăng xuất và Đăng nhập lại bằng Google.',
            );
          } else {
            toast.error(payload.error || 'Không thể đăng ký kênh này.');
          }
          return;
        }

        if (payload.channels) setChannels(payload.channels);
        if (viewMode === 'explore') {
          if (payload.videos) setVideos(payload.videos);
          if (typeof payload.totalVideosCount === 'number') {
            setTotalVideosCount(payload.totalVideosCount);
          }
          if (typeof payload.hasMoreVideos === 'boolean') {
            setHasMoreVideos(payload.hasMoreVideos);
          }
        } else {
          await refreshCurrentFeed();
        }
        router.refresh();

        toast.success(
          `Đã đăng ký "${payload.channelTitle || channelTitle || channelId}" & kéo ${payload.fetchedVideosCount ?? 0} video vào AniSub!`,
        );
      } catch {
        toast.error('Lỗi kết nối khi đăng ký kênh YouTube.');
      } finally {
        setSubscribingChannelId(null);
      }
    },
    [router, viewMode, refreshCurrentFeed],
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
        if (payload.code === 'TOKEN_EXPIRED') {
          toast.error(
            payload.error ||
              'Google Access Token đã hết hạn. Vui lòng Đăng xuất và Đăng nhập lại bằng Google.',
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
        setVideos(payload.videos);
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
      if (viewMode === 'explore') {
        if (payload.videos) setVideos(payload.videos);
        if (typeof payload.totalVideosCount === 'number') {
          setTotalVideosCount(payload.totalVideosCount);
        }
        if (typeof payload.hasMoreVideos === 'boolean') {
          setHasMoreVideos(payload.hasMoreVideos);
        }
      } else {
        await refreshCurrentFeed();
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
      if (viewMode === 'explore') {
        if (payload.videos) setVideos(payload.videos);
      } else {
        await refreshCurrentFeed();
      }

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
      if (viewMode === 'explore') {
        if (payload.videos) setVideos(payload.videos);
        if (typeof payload.totalVideosCount === 'number') {
          setTotalVideosCount(payload.totalVideosCount);
        }
        if (typeof payload.hasMoreVideos === 'boolean') {
          setHasMoreVideos(payload.hasMoreVideos);
        }
      } else {
        await refreshCurrentFeed();
      }

      if (payload.warning) {
        toast.warning(payload.warning);
      } else if ((payload.fetchedCount ?? 0) === 0) {
        toast.info(`Kênh "${current.title}" không còn video cũ hơn để kéo.`);
      } else {
        toast.success(
          `Đã kéo thêm ${payload.fetchedCount ?? 0} video (${payload.newVideosCount ?? 0} mới) cho kênh "${current.title}"!`,
        );
      }
    } catch {
      toast.error('Lỗi kết nối khi kéo thêm 50 video cũ.');
    } finally {
      setBusyChannelId(null);
    }
  };

  // Debounce từ khóa tìm kiếm 300ms trước khi gọi API phân trang /api/videos
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Khi chuyển đổi bộ lọc thể loại (Tất cả / Phim AI / HH2D), tab, trailer hoặc tìm kiếm:
  // tự động reset offset = 0 và tải lô 60 video đầu tiên chuẩn ngữ cảnh từ /api/videos
  useEffect(() => {
    if (authStatus !== 'authenticated' || viewMode === 'explore') return;

    // Bỏ qua lần render đầu tiên nếu đang ở bộ lọc mặc định (đã có dữ liệu SSR)
    if (!hasSkippedInitialFilterFetchRef.current) {
      hasSkippedInitialFilterFetchRef.current = true;
      if (
        viewMode === 'cinema' &&
        genreFilter === 'all' &&
        videoType === 'all' &&
        !showTrailers &&
        !debouncedSearchQuery
      ) {
        return;
      }
    }

    const controller = new AbortController();
    const effectiveTab = viewMode === 'continue' ? 'continue' : videoType;
    const params = new URLSearchParams({
      offset: '0',
      limit: '60',
      genre: genreFilter,
      tab: effectiveTab,
      showTrailers: String(showTrailers),
    });
    if (debouncedSearchQuery) {
      params.set('q', debouncedSearchQuery);
    }

    setIsLoadingFeed(true);
    setHasMoreYouTubeHistory(selectedChannelIds.size > 0);
    fetch(`/api/videos?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json().catch(() => ({}))) as {
          videos?: CinemaVideoItem[];
          totalCount?: number;
          hasMore?: boolean;
        };
        if (controller.signal.aborted) return;
        if (Array.isArray(payload.videos)) {
          setVideos(payload.videos);
        }
        if (typeof payload.totalCount === 'number') {
          setTotalVideosCount(payload.totalCount);
        }
        if (typeof payload.hasMore === 'boolean') {
          setHasMoreVideos(payload.hasMore);
        }
      })
      .catch(() => {
        // Bỏ qua lỗi hủy request (AbortError) khi user đổi bộ lọc liên tục
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingFeed(false);
        }
      });

    return () => controller.abort();
  }, [
    authStatus,
    viewMode,
    genreFilter,
    videoType,
    showTrailers,
    debouncedSearchQuery,
    selectedChannelIds.size,
  ]);

  // Giai đoạn 2 Infinite Scroll: Khi đã chạm đáy kho DB -> tự động kéo thêm 50 video cũ/kênh từ YouTube rồi nạp tiếp
  const handleFetchMoreFromYouTube = useCallback(async () => {
    if (
      isFetchingYouTubeRef.current ||
      isFetchingYouTubeHistory ||
      isLoadingMoreVideos ||
      isLoadingFeed ||
      !hasMoreYouTubeHistory ||
      authStatus !== 'authenticated' ||
      viewMode !== 'cinema'
    ) {
      return;
    }

    isFetchingYouTubeRef.current = true;
    setIsFetchingYouTubeHistory(true);

    try {
      const res = await fetch('/api/channels/load-more-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre: genreFilter,
          maxChannels: 3,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        processedChannels?: number;
        fetchedCount?: number;
        newVideosCount?: number;
        hasMoreYouTubeHistory?: boolean;
        warning?: string | null;
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Không thể kéo thêm phim cũ từ YouTube.');
        setHasMoreYouTubeHistory(false);
        return;
      }

      const stillHasMore = Boolean(payload.hasMoreYouTubeHistory);
      setHasMoreYouTubeHistory(stillHasMore);

      if (payload.warning) {
        toast.warning(payload.warning);
      }

      // Nạp ngay lô video mới kéo về từ Supabase vào danh sách trang chủ
      const params = new URLSearchParams({
        offset: String(videos.length),
        limit: '60',
        genre: genreFilter,
        tab: videoType,
        showTrailers: String(showTrailers),
      });
      if (debouncedSearchQuery) {
        params.set('q', debouncedSearchQuery);
      }

      const feedRes = await fetch(`/api/videos?${params.toString()}`);
      if (feedRes.ok) {
        const feedPayload = (await feedRes.json().catch(() => ({}))) as {
          videos?: CinemaVideoItem[];
          totalCount?: number;
          hasMore?: boolean;
        };

        const incoming = feedPayload.videos ?? [];
        if (incoming.length > 0) {
          setVideos((prev) => {
            const existing = new Set(prev.map((v) => v.video_id));
            const merged = [...prev];
            for (const item of incoming) {
              if (!existing.has(item.video_id)) {
                existing.add(item.video_id);
                merged.push(item);
              }
            }
            return merged;
          });
        }

        if (typeof feedPayload.totalCount === 'number') {
          setTotalVideosCount(feedPayload.totalCount);
        }
        if (typeof feedPayload.hasMore === 'boolean') {
          setHasMoreVideos(feedPayload.hasMore);
        }
      }

      if ((payload.newVideosCount ?? 0) > 0) {
        toast.success(
          `Đã tự động kéo thêm +${payload.newVideosCount} phim cũ từ ${payload.processedChannels ?? 0} kênh YouTube!`,
        );
      } else if (!stillHasMore) {
        toast.info('Đã tải toàn bộ video từ tất cả các kênh.');
      }
    } catch {
      toast.error('Lỗi kết nối khi kéo thêm phim cũ từ YouTube.');
    } finally {
      isFetchingYouTubeRef.current = false;
      setIsFetchingYouTubeHistory(false);
    }
  }, [
    isFetchingYouTubeHistory,
    isLoadingMoreVideos,
    isLoadingFeed,
    hasMoreYouTubeHistory,
    authStatus,
    viewMode,
    genreFilter,
    videos.length,
    videoType,
    showTrailers,
    debouncedSearchQuery,
  ]);

  const handleLoadMoreFeedVideos = useCallback(async () => {
    if (
      isLoadingMoreVideos ||
      isLoadingFeed ||
      !hasMoreVideos ||
      viewMode === 'explore'
    ) {
      return;
    }

    setIsLoadingMoreVideos(true);
    try {
      const effectiveTab = viewMode === 'continue' ? 'continue' : videoType;
      const params = new URLSearchParams({
        offset: String(videos.length),
        limit: '60',
        genre: genreFilter,
        tab: effectiveTab,
        showTrailers: String(showTrailers),
      });
      if (debouncedSearchQuery) {
        params.set('q', debouncedSearchQuery);
      }

      const res = await fetch(`/api/videos?${params.toString()}`);
      const payload = (await res.json().catch(() => ({}))) as {
        videos?: CinemaVideoItem[];
        totalCount?: number;
        hasMore?: boolean;
        error?: string;
      };

      if (!res.ok) {
        toast.error(payload.error || 'Không thể tải thêm phim.');
        return;
      }

      const incoming = payload.videos ?? [];
      if (incoming.length > 0) {
        setVideos((prev) => {
          const existing = new Set(prev.map((v) => v.video_id));
          const merged = [...prev];
          for (const item of incoming) {
            if (!existing.has(item.video_id)) {
              existing.add(item.video_id);
              merged.push(item);
            }
          }
          return merged;
        });
      }

      if (typeof payload.totalCount === 'number') {
        setTotalVideosCount(payload.totalCount);
      }
      if (typeof payload.hasMore === 'boolean') {
        setHasMoreVideos(payload.hasMore);
      } else {
        setHasMoreVideos(false);
      }
    } catch {
      toast.error('Lỗi kết nối khi tải thêm phim.');
    } finally {
      setIsLoadingMoreVideos(false);
    }
  }, [
    isLoadingMoreVideos,
    isLoadingFeed,
    hasMoreVideos,
    viewMode,
    videoType,
    videos.length,
    genreFilter,
    showTrailers,
    debouncedSearchQuery,
  ]);

  const handleCycleVideoGenre = useCallback(
    async (video: CinemaVideoItem, nextGenre: PrimaryGenreTag) => {
      const previousVideos = videos;

      setVideos((prev) =>
        prev.map((v) =>
          v.video_id === video.video_id
            ? { ...v, detected_genre: nextGenre, is_manual_tag: true }
            : v,
        ),
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
          warning?: string | null;
          error?: string;
        };

        if (!res.ok) {
          setVideos(previousVideos);
          toast.error(payload.error || 'Không thể đổi nhãn cho video.');
          return;
        }

        if (payload.warning) {
          toast.warning(payload.warning);
        } else {
          toast.success(`Đã đổi nhãn thành "${nextGenre}" (đã khóa thủ công)`);
          if (genreFilter !== 'all' && nextGenre !== genreFilter) {
            setTotalVideosCount((prev) => Math.max(0, prev - 1));
          }
        }
      } catch {
        setVideos(previousVideos);
        toast.error('Lỗi kết nối khi lưu nhãn thủ công.');
      }
    },
    [videos, genreFilter],
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
      if (viewMode === 'explore') {
        if (payload.videos) setVideos(payload.videos);
      } else {
        await refreshCurrentFeed();
      }
      router.refresh();

      if (payload.warning) {
        toast.warning(payload.warning);
      } else {
        toast.success(
          `Gemini Vision đã phân loại lại ${payload.updatedCount ?? 0}/${payload.totalVideos ?? 0} video (đổi nhãn: ${payload.changedCount ?? 0}, khóa thủ công: ${payload.skippedManualCount ?? 0})!`,
        );
      }
    } catch {
      toast.error('Lỗi kết nối khi chạy Quét lại nhãn AI.');
    } finally {
      setIsReclassifyingAll(false);
    }
  };

  const handleSummaryGenerated = useCallback(
    (videoId: string, aiSummary: string) => {
      setVideos((prev) =>
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
              onChangeVideoType={setVideoType}
              showTrailers={showTrailers}
              onToggleTrailers={setShowTrailers}
              genreFilter={genreFilter}
              onChangeGenreFilter={setGenreFilter}
              isRealtimeConnected={authStatus === 'authenticated'}
              totalMatchingVideos={
                viewMode === 'cinema' && videoType === 'episode'
                  ? filteredSeriesGroups.length
                  : displayFeedVideos.length
              }
              exploreKeywords={exploreKeywords}
              isLoadingExplore={isLoadingExplore}
              onRefreshExplore={() => void loadExploreFeed(true)}
            />
          )}
        </div>

        {authStatus === 'authenticated' &&
        viewMode === 'cinema' &&
        videoType === 'episode' &&
        selectedChannelIds.size > 0 ? (
          <SeriesGrid
            seriesList={filteredSeriesGroups}
            activeSeriesKey={activeSeriesKey}
            totalEpisodesCount={totalSeriesEpisodesCount}
            totalVideosCount={totalVideosCount}
            hasMoreVideos={hasMoreVideos}
            hasMoreYouTubeHistory={hasMoreYouTubeHistory}
            isLoadingFeed={isLoadingFeed}
            isLoadingMoreVideos={isLoadingMoreVideos}
            isFetchingYouTubeHistory={isFetchingYouTubeHistory}
            onSelectSeries={handleSelectSeries}
            onLoadMoreVideos={handleLoadMoreFeedVideos}
            onFetchMoreFromYouTube={handleFetchMoreFromYouTube}
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
            selectedChannelIds={selectedChannelIds}
            subscribingChannelId={subscribingChannelId}
            totalVideosCount={totalVideosCount}
            hasMoreVideos={hasMoreVideos}
            hasMoreYouTubeHistory={hasMoreYouTubeHistory}
            isLoadingFeed={isLoadingFeed}
            isLoadingMoreVideos={isLoadingMoreVideos}
            isFetchingYouTubeHistory={isFetchingYouTubeHistory}
            onLoadMoreVideos={handleLoadMoreFeedVideos}
            onFetchMoreFromYouTube={handleFetchMoreFromYouTube}
            sectionHeading={
              viewMode === 'explore'
                ? 'Khám phá YouTube — Kênh mới hợp gu của bạn'
                : activeVideo
                  ? `Đề xuất cùng thể loại [${activeVideo.detected_genre ?? 'HH2D'}] & Tập tiếp theo`
                  : undefined
            }
            sectionSubtitle={
              viewMode === 'explore'
                ? 'Gợi ý cá nhân hóa từ lịch sử xem & Like YouTube (đã lọc bỏ Shorts, ưu tiên kênh chưa theo dõi)'
                : activeVideo
                  ? 'Ưu tiên tập kế tiếp cùng bộ/kênh, theo sau là gợi ý cùng thể loại đã làm mới ngẫu nhiên'
                  : undefined
            }
            onSelectVideo={handleSelectVideo}
            onCycleVideoGenre={handleCycleVideoGenre}
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
        onSyncFromYouTube={handleSyncFromYouTube}
        onReclassifyAll={handleReclassifyAll}
        onToggleChannel={handleToggleChannel}
        onToggleChannelGenreTag={handleToggleChannelGenreTag}
        onReclassifyChannel={handleReclassifyChannel}
        onLoadMoreChannelVideos={handleLoadMoreChannelVideos}
      />

      <WhitelistModal
        open={isWhitelistOpen}
        onClose={() => setIsWhitelistOpen(false)}
        currentUserEmail={user?.email}
      />
    </div>
  );
}
