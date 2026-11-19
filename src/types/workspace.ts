import type {
  ChannelRow,
  GenreTag,
  ProfileRow,
  UserChannelRow,
  VideoRow,
  WatchProgressRow,
} from '@/types/database';

export type WorkspaceViewMode = 'cinema' | 'continue';
export type VideoTypeFilter = 'all' | 'episode' | 'full_movie';
export type GenreFilter =
  | 'all'
  | Extract<GenreTag, 'Phim AI' | 'HH2D' | 'Hoạt hình cát'>;

export interface ChannelWithSelection extends ChannelRow {
  is_selected: boolean;
  genre_tag: GenreTag;
  user_channel_id?: UserChannelRow['id'];
}

export interface CinemaVideoItem extends VideoRow {
  channel_title?: string;
  progress_seconds: WatchProgressRow['progress_seconds'];
  is_completed: WatchProgressRow['is_completed'];
}

export type WorkspaceAuthStatus =
  | 'unauthenticated'
  | 'unauthorized_whitelist'
  | 'authenticated';

export interface WorkspaceUserState {
  status: WorkspaceAuthStatus;
  profile: ProfileRow | null;
}

export const GENRE_OPTIONS: GenreTag[] = [
  'Phim AI',
  'HH2D',
  'Hoạt hình cát',
  'Khác',
];

export const GENRE_DOT_STYLES: Record<
  Extract<GenreTag, 'Phim AI' | 'HH2D' | 'Hoạt hình cát'>,
  { dotClass: string; badgeClass: string; label: string }
> = {
  'Phim AI': {
    dotClass: 'bg-purple-500 dark:bg-purple-400',
    badgeClass:
      'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/35',
    label: 'Phim AI',
  },
  HH2D: {
    dotClass: 'bg-sky-500 dark:bg-sky-400',
    badgeClass:
      'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35',
    label: 'HH2D',
  },
  'Hoạt hình cát': {
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    badgeClass:
      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
    label: 'Hoạt hình cát',
  },
};

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function getProgressPercent(
  progressSeconds: number,
  durationSeconds: number,
): number {
  if (!durationSeconds || progressSeconds <= 0) return 0;
  return Math.min(100, Math.round((progressSeconds / durationSeconds) * 100));
}
