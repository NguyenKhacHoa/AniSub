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
 * Dấu hiệu xác minh chính thức trong DB sau khi Gemini + Google Search Grounding
 * xác nhận bộ phim là Anime Movie / Bản điện ảnh đã phát hành chiếu rạp (Theatrical Release).
 */
export const VERIFIED_THEATRICAL_TAG = '[CHIẾU RẠP]' as const;

/**
 * Từ khóa LOẠI TRỪ CỨNG: Mọi video chứa dấu hiệu ghép tập, tổng hợp nhiều giờ,
 * trọn bộ, tập lẻ, review, tóm tắt, OVA/Special hoặc thuộc danh mục `Phim AI`
 * đều KHÔNG BAO GIỜ được gắn mác `Chiếu Rạp`.
 */
export const THEATRICAL_HARD_EXCLUSION_RE =
  /\b(trọn\s*bộ|tron\s*bo|tổng\s*hợp|tong\s*hop|full\s*bộ|full\s*bo|full\s*mùa|full\s*mua|full\s*tập|full\s*tap|tất\s*cả\s*các\s*tập|all\s*episodes|review|tóm\s*tắt|tom\s*tat|tập|tap|ep|episode|chương|chuong|mùa\s*\d|mua\s*\d|phần\s*\d|phan\s*\d|season\s*\d|ss\s*\d|ova|oad|ona|special|trailer|teaser|preview)\b|\b\d{1,2}\s*(?:h\d{0,2}p?|giờ|gio|tiếng|tieng)\b/i;

/**
 * Từ khóa ứng viên cần kiểm tra Google Search Grounding xem có phải Bản Điện Ảnh Chiếu Rạp thật không.
 * (Tuyệt đối KHÔNG chứa từ khóa chung chung như `full`, `bản full`, `ova`, `special`).
 */
export const THEATRICAL_CANDIDATE_KEYWORDS_RE =
  /\b(the\s*movie|anime\s*movie|bản\s*điện\s*ảnh|ban\s*dien\s*anh|phim\s*điện\s*ảnh|chiếu\s*rạp|chieu\s*rap|theatrical)\b|劇場版/i;

export const LICENSED_DISTRIBUTOR_CHANNEL_RE =
  /\b(muse\s*việt\s*nam|muse\s*viet\s*nam|muse\s*asia|ani-one|anione|pops\s*anime|bilibili|tropics\s*anime)\b/i;

/**
 * Kiểm tra xem video có bị loại trừ cứng khỏi danh mục Phim Chiếu Rạp hay không:
 * - Thuộc thể loại `Phim AI`
 * - Là YouTube Shorts hoặc Trailer
 * - Tiêu đề chứa dấu hiệu tổng hợp/ghép tập (`giờ`, `tiếng`, `tập 1`, `trọn bộ`, `tổng hợp`, `review`, `tóm tắt`, `ova`, `special`...)
 */
export function isHardExcludedFromTheatrical(video: {
  title: string;
  series_name?: string | null;
  detected_genre?: string | null;
  episode_number?: number | null;
  video_type?: string | null;
  is_short?: boolean;
}): boolean {
  if (video.is_short) return true;
  if (video.video_type === 'trailer') return true;
  if (video.detected_genre === 'Phim AI') return true;
  if (
    typeof video.episode_number === 'number' &&
    Number.isFinite(video.episode_number)
  ) {
    return true;
  }
  if (THEATRICAL_HARD_EXCLUSION_RE.test(video.title)) {
    return true;
  }
  return false;
}

/**
 * Kiểm tra xem video có đủ điều kiện đưa vào bước xác minh Google Search Grounding của AI Classifier không.
 */
export function isPotentialTheatricalCandidate(video: {
  title: string;
  channel_title?: string | null;
  series_name?: string | null;
  detected_genre?: string | null;
  episode_number?: number | null;
  video_type?: string | null;
  is_short?: boolean;
}): boolean {
  if (isHardExcludedFromTheatrical(video)) return false;

  if (THEATRICAL_CANDIDATE_KEYWORDS_RE.test(video.title)) {
    return true;
  }

  if (
    video.channel_title &&
    LICENSED_DISTRIBUTOR_CHANNEL_RE.test(video.channel_title) &&
    /\b(movie|điện\s*ảnh|dien\s*anh|chiếu\s*rạp|chieu\s*rap)\b|劇場版/i.test(
      video.title,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Giao diện Frontend CHỈ hiển thị video trong tab "Phim Chiếu Rạp" và gắn badge `CHIẾU RẠP`
 * khi bản ghi trong database thực sự đã được xác minh cờ/tag `[CHIẾU RẠP]` hợp lệ
 * (tuyệt đối KHÔNG tự suy diễn theo thời lượng >= 65 phút hay chữ "Full").
 */
export function isTheatricalMovieVideo(video: {
  title: string;
  series_name?: string | null;
  description?: string | null;
  duration_seconds?: number;
  detected_genre?: string | null;
  episode_number?: number | null;
  video_type?: string | null;
  is_short?: boolean;
}): boolean {
  if (isHardExcludedFromTheatrical(video)) {
    return false;
  }

  if (video.video_type === 'theatrical') {
    return true;
  }

  if (
    typeof video.series_name === 'string' &&
    video.series_name.includes(VERIFIED_THEATRICAL_TAG)
  ) {
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
