'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FloatingRail } from '@/components/workspace/FloatingRail';
import { CommandHub } from '@/components/workspace/CommandHub';
import { TheaterStage } from '@/components/workspace/TheaterStage';
import { StructuredCinemaRows } from '@/components/workspace/StructuredCinemaRows';
import { ChannelVaultDrawer } from '@/components/workspace/ChannelVaultDrawer';
import { WhitelistModal } from '@/components/workspace/WhitelistModal';
import { createClient } from '@/lib/supabase/client';
import {
  type ChannelWithSelection,
  type CinemaVideoItem,
  type GenreFilter,
  type VideoTypeFilter,
  type WorkspaceAuthStatus,
  type WorkspaceViewMode,
} from '@/types/workspace';
import type { GenreTag } from '@/types/database';

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
  isAdmin?: boolean;
  pendingRequestsCount?: number;
}

export function UnifiedCinemaWorkspace({
  initialAuthStatus,
  initialUser,
  isAdmin = false,
  pendingRequestsCount = 0,
}: UnifiedCinemaWorkspaceProps) {
  const router = useRouter();

  const [authStatus, setAuthStatus] =
    useState<WorkspaceAuthStatus>(initialAuthStatus);
  const [user, setUser] = useState<InitialWorkspaceUser | null>(initialUser);
  const [channels, setChannels] = useState<ChannelWithSelection[]>([]);
  const [videos] = useState<CinemaVideoItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    initialUser?.lastSyncedAt ?? null,
  );
  const [isSyncing, setIsSyncing] = useState(false);

  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('cinema');
  const [searchQuery, setSearchQuery] = useState('');
  const [videoType, setVideoType] = useState<VideoTypeFilter>('all');
  const [showTrailers, setShowTrailers] = useState(false);
  const [genreFilter, setGenreFilter] = useState<GenreFilter>('all');

  const [activeVideo, setActiveVideo] = useState<CinemaVideoItem | null>(null);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [isWhitelistOpen, setIsWhitelistOpen] = useState(false);

  const selectedChannelIds = useMemo(
    () =>
      new Set(
        channels.filter((c) => c.is_selected).map((c) => c.channel_id),
      ),
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

  const nextVideo = useMemo(() => {
    if (!activeVideo || filteredVideos.length < 2) return null;
    const idx = filteredVideos.findIndex(
      (v) => v.video_id === activeVideo.video_id,
    );
    if (idx >= 0 && idx + 1 < filteredVideos.length) {
      return filteredVideos[idx + 1];
    }
    return null;
  }, [activeVideo, filteredVideos]);

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

  const handleSyncFromYouTube = () => {
    if (authStatus !== 'authenticated') {
      toast.warning('Vui lòng đăng nhập Google hợp lệ trước khi đồng bộ YouTube.');
      return;
    }
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      if (process.env.NODE_ENV !== 'development') {
        setLastSyncedAt(new Date().toISOString());
      } else {
        setLastSyncedAt(null);
      }
      toast.info(
        'Đã sẵn sàng kết nối Server Action đồng bộ YouTube Data API v3.',
      );
    }, 400);
  };

  const handleToggleChannel = (channelId: string, nextSelected: boolean) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.channel_id === channelId ? { ...ch, is_selected: nextSelected } : ch,
      ),
    );
  };

  const handleChangeChannelGenre = (channelId: string, nextGenre: GenreTag) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.channel_id === channelId ? { ...ch, genre_tag: nextGenre } : ch,
      ),
    );
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg-canvas)] p-2 pb-18 md:gap-3 md:p-3 md:pb-3">
      <FloatingRail
        viewMode={viewMode}
        onChangeViewMode={(mode) => {
          setViewMode(mode);
          setIsVaultOpen(false);
        }}
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

      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {activeVideo ? (
          <TheaterStage
            video={activeVideo}
            nextVideo={nextVideo}
            onSelectVideo={(vid) => setActiveVideo(vid)}
            onClose={() => setActiveVideo(null)}
          />
        ) : (
          <CommandHub
            searchQuery={searchQuery}
            onChangeSearch={setSearchQuery}
            videoType={videoType}
            onChangeVideoType={setVideoType}
            showTrailers={showTrailers}
            onToggleTrailers={setShowTrailers}
            genreFilter={genreFilter}
            onChangeGenreFilter={setGenreFilter}
            isRealtimeConnected={authStatus === 'authenticated'}
            totalMatchingVideos={filteredVideos.length}
          />
        )}

        <StructuredCinemaRows
          authStatus={authStatus}
          selectedChannelCount={selectedChannelIds.size}
          videos={filteredVideos}
          activeVideoId={activeVideo?.video_id ?? null}
          viewMode={viewMode}
          onSelectVideo={(vid) => setActiveVideo(vid)}
          onOpenVault={() => setIsVaultOpen(true)}
          onTriggerGoogleSignIn={handleNavigateLogin}
        />
      </main>

      <ChannelVaultDrawer
        open={isVaultOpen}
        onClose={() => setIsVaultOpen(false)}
        channels={channels}
        lastSyncedAt={lastSyncedAt}
        isSyncing={isSyncing}
        onSyncFromYouTube={handleSyncFromYouTube}
        onToggleChannel={handleToggleChannel}
        onChangeChannelGenre={handleChangeChannelGenre}
      />

      <WhitelistModal
        open={isWhitelistOpen}
        onClose={() => setIsWhitelistOpen(false)}
        currentUserEmail={user?.email}
      />
    </div>
  );
}
