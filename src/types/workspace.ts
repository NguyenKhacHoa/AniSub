import type {
  ChannelRow,
  GenreTag,
  ProfileRow,
  UserChannelRow,
  VideoRow,
  WatchProgressRow,
} from '@/types/database';

export type WorkspaceViewMode = 'cinema' | 'explore' | 'continue' | 'watch_later';
export type VideoTypeFilter = 'all' | 'episode' | 'theatrical' | 'full_movie';
export type GenreFilter = 'all' | GenreTag;
export type PrimaryGenreTag = GenreTag;
export type SortOption = 'newest' | 'longest' | 'title_asc';

/**
 * Từ khóa nhận diện tự động Phim Chiếu Rạp / Bản Điện Ảnh / Anime Movie / OVA / Special
 */
export const THEATRICAL_MOVIE_KEYWORDS_RE =
  /\b(the\s*movie|full\s*movie|anime\s*movie|movie|chiếu\s*rạp|chieu\s*rap|bản\s*điện\s*ảnh|ban\s*dien\s*anh|phim\s*điện\s*ảnh|phim\s*lẻ|phim\s*le|ova|oad|special|bản\s*full|ban\s*full)\b|劇場版/i;

export const THEATRICAL_MIN_DURATION_SECONDS = 3900; // 65 phút

/**
 * Kiểm tra một video có thuộc danh mục "Phim Chiếu Rạp" hay không:
 * 1. Tiêu đề, series_name hoặc thẻ phân loại chứa các từ khóa đặc trưng:
 *    `movie`, `chiếu rạp`, `the movie`, `bản điện ảnh`, `phim lẻ`, `full movie`, `ova`, `special`, `bản full`.
 * 2. Hoặc thời lượng video từ 65 phút trở lên (`duration_seconds >= 3900` giây) thuộc nhóm phim lẻ/bản điện ảnh.
 */
export function isTheatricalMovieVideo(video: {
  title: string;
  series_name?: string | null;
  description?: string | null;
  duration_seconds: number;
  video_type?: string | null;
  is_short?: boolean;
}): boolean {
  if (video.is_short) return false;
  if (video.video_type === 'trailer') return false;

  if (THEATRICAL_MOVIE_KEYWORDS_RE.test(video.title)) {
    return true;
  }
  if (video.series_name && THEATRICAL_MOVIE_KEYWORDS_RE.test(video.series_name)) {
    return true;
  }
  if (video.video_type === 'theatrical') {
    return true;
  }
  if (video.duration_seconds >= THEATRICAL_MIN_DURATION_SECONDS) {
    return true;
  }
  return false;
}

export const PRIMARY_GENRE_OPTIONS: PrimaryGenreTag[] = ['Phim AI', 'HH2D'];
export const GENRE_OPTIONS: GenreTag[] = ['Phim AI', 'HH2D'];

export interface ChannelWithSelection extends ChannelRow {
  is_selected: boolean;
  genre_tag: GenreTag;
  genre_tags: PrimaryGenreTag[];
  user_channel_id?: UserChannelRow['id'];
}

export interface CinemaVideoItem extends VideoRow {
  channel_title?: string;
  progress_seconds: WatchProgressRow['progress_seconds'];
  is_completed: WatchProgressRow['is_completed'];
  last_watched_at?: string | null;
  matched_keyword?: string;
}

export type WorkspaceAuthStatus =
  | 'unauthenticated'
  | 'unauthorized_whitelist'
  | 'authenticated';

export interface WorkspaceUserState {
  status: WorkspaceAuthStatus;
  profile: ProfileRow | null;
}

export const GENRE_DOT_STYLES: Record<
  PrimaryGenreTag,
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
};

/**
 * Chuẩn hóa nhãn cũ ('Hoạt hình cát', 'Khác', null) về 2 nhãn chuẩn ('Phim AI' | 'HH2D').
 */
export function normalizeGenreTag(value: string | null | undefined): GenreTag {
  return value === 'Phim AI' ? 'Phim AI' : 'HH2D';
}

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
