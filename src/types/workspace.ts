import type {
  ChannelRow,
  CinemaFormat,
  GenreTag,
  ProfileRow,
  UserChannelRow,
  VideoRow,
  WatchProgressRow,
} from '@/types/database';

export type WorkspaceViewMode =
  | 'cinema'
  | 'explore'
  | 'theatrical'
  | 'continue'
  | 'watch_later';
export type VideoTypeFilter = 'all' | 'episode' | 'full_movie';
export type GenreFilter = 'all' | GenreTag;
export type PrimaryGenreTag = GenreTag;
export type SortOption = 'newest' | 'longest' | 'title_asc';
export type CinemaFormatFilter = 'all' | CinemaFormat;
export type TheatricalCategoryFilter =
  | 'all'
  | 'Hành động'
  | 'Phiêu lưu'
  | 'Giả tưởng'
  | 'Tình cảm'
  | 'Viễn tưởng'
  | 'Hài hước'
  | 'Tâm lý';

export const SAFE_CINEMA_GENRES = [
  'Hành động',
  'Phiêu lưu',
  'Giả tưởng',
  'Tình cảm',
  'Viễn tưởng',
  'Hài hước',
  'Tâm lý',
  'Võ thuật',
] as const;

export const CINEMA_FORMAT_STYLES: Record<
  CinemaFormat,
  { badgeClass: string; label: string }
> = {
  'Anime / Hoạt hình': {
    badgeClass:
      'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35',
    label: 'Anime / Hoạt hình',
  },
  'Phim Người Đóng': {
    badgeClass:
      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
    label: 'Phim Người Đóng',
  },
};

/**
 * Dấu hiệu xác minh chính thức trong DB sau khi Gemini + Google Search Grounding
 * xác nhận bộ phim là Anime Movie / Bản điện ảnh đã phát hành chiếu rạp (Theatrical Release).
 */
export const VERIFIED_THEATRICAL_TAG = '[CHIẾU RẠP]' as const;

/**
 * Giới hạn thời lượng chuẩn cho Phim Chiếu Rạp (65 phút = 3900s đến 165 phút = 9900s).
 * Loại bỏ tuyệt đối các video tổng hợp 3-12 tiếng và các clip ngắn/trailer.
 */
export const THEATRICAL_MIN_DURATION_SECONDS = 3900; // 65 phút
export const THEATRICAL_MAX_DURATION_SECONDS = 9900; // 165 phút

/**
 * Bộ lọc Chặn Kinh Dị Lớp 1 — CHỈ ÁP DỤNG RIÊNG CHO CHUYÊN MỤC PHIM CHIẾU RẠP:
 * Tuyệt đối KHÔNG áp dụng cho HH2D, 2D hay Phim AI thông thường.
 */
export const CINEMA_HORROR_PREFILTER_RE =
  /\b(kinh\s*dị|kinh\s*di|horror|ma\s*ám|ma\s*am|quỷ\s*ám|quy\s*am|trừ\s*tà|tru\s*ta|exorcist|ác\s*quỷ|ac\s*quy|xác\s*sống|xac\s*song|zombie|ma\s*cà\s*rồng|ma\s*ca\s*rong|slasher|giết\s*người\s*hàng\s*loạt|giet\s*nguoi\s*hang\s*loat|máu\s*me|mau\s*me|gore|creepy|rùng\s*rợn|rung\s*ron|ma\s*quái|ma\s*quai|linh\s*dị|linh\s*di|cương\s*thi|cuong\s*thi)\b/i;

/**
 * Từ khóa LOẠI TRỪ CỨNG: Mọi video chứa dấu hiệu ghép tập, tổng hợp nhiều giờ,
 * trọn bộ, tập lẻ (`tập 1`, `ep 1`...), review, tóm tắt hoặc thuộc danh mục `Phim AI`
 * đều KHÔNG BAO GIỜ được gắn mác `Chiếu Rạp`.
 */
export const THEATRICAL_HARD_EXCLUSION_RE =
  /\b(trọn\s*bộ|tron\s*bo|tổng\s*hợp|tong\s*hop|full\s*bộ|full\s*bo|full\s*mùa|full\s*mua|full\s*tập|full\s*tap|tất\s*cả\s*các\s*tập|all\s*episodes|review|tóm\s*tắt|tom\s*tat|tập\s*\.?\s*\d+|tap\s*\.?\s*\d+|ep\s*\.?\s*\d+|episode\s*\.?\s*\d+|chương\s*\.?\s*\d+|chuong\s*\.?\s*\d+|mùa\s*\d+|mua\s*\d+|phần\s*\d+\s*[-–:]?\s*tập|season\s*\d+\s*ep|trailer|teaser|preview|phim\s*ai|3d\s*ai)\b|\b\d{1,2}\s*(?:h\d{0,2}p?|giờ|gio|tiếng|tieng)\b/i;

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
 * - Thời lượng ngoài ngưỡng chuẩn rạp (nhỏ hơn 65 phút hoặc lớn hơn 165 phút)
 * - Chứa từ khóa Kinh dị / Máu me (Scoped Anti-Horror Policy dành riêng cho Phim Chiếu Rạp)
 * - Tiêu đề chứa dấu hiệu tổng hợp/ghép tập (`giờ`, `tiếng`, `tập 1`, `trọn bộ`, `tổng hợp`, `review`, `tóm tắt`...)
 */
export function isHardExcludedFromTheatrical(video: {
  title: string;
  description?: string | null;
  series_name?: string | null;
  detected_genre?: string | null;
  episode_number?: number | null;
  duration_seconds?: number;
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
  if (
    typeof video.duration_seconds === 'number' &&
    video.duration_seconds > 0 &&
    (video.duration_seconds < THEATRICAL_MIN_DURATION_SECONDS ||
      video.duration_seconds > THEATRICAL_MAX_DURATION_SECONDS)
  ) {
    return true;
  }
  if (THEATRICAL_HARD_EXCLUSION_RE.test(video.title)) {
    return true;
  }
  // Lớp 1 Chặn Kinh Dị (chỉ áp dụng riêng cho Phim Chiếu Rạp)
  if (
    CINEMA_HORROR_PREFILTER_RE.test(video.title) ||
    (video.description && CINEMA_HORROR_PREFILTER_RE.test(video.description))
  ) {
    return true;
  }
  return false;
}

/**
 * Kiểm tra xem video có đủ điều kiện đưa vào bước xác minh Google Search Grounding của AI Classifier không.
 */
export function isPotentialTheatricalCandidate(video: {
  title: string;
  description?: string | null;
  channel_title?: string | null;
  series_name?: string | null;
  detected_genre?: string | null;
  episode_number?: number | null;
  duration_seconds?: number;
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
 * khi bản ghi trong database thực sự đã được xác minh cờ `is_theatrical_movie = true` hoặc tag `[CHIẾU RẠP]` hợp lệ
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
  is_theatrical_movie?: boolean | null;
}): boolean {
  if (isHardExcludedFromTheatrical(video)) {
    return false;
  }

  if (video.is_theatrical_movie === true) {
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

/**
 * Xác định định dạng Phim Chiếu Rạp (`Anime / Hoạt hình` hoặc `Phim Người Đóng`).
 * Ưu tiên cột `cinema_format` đã được Gemini + Google Search Grounding lưu trong Supabase;
 * nếu bản ghi cũ chưa có cột này thì suy luận chính xác từ tiêu đề, tên kênh và mô tả.
 */
export function resolveCinemaFormat(video: {
  title: string;
  description?: string | null;
  series_name?: string | null;
  channel_title?: string | null;
  cinema_format?: CinemaFormat | string | null;
}): CinemaFormat {
  if (
    video.cinema_format === 'Anime / Hoạt hình' ||
    video.cinema_format === 'Phim Người Đóng'
  ) {
    return video.cinema_format;
  }

  const hay =
    `${video.title} ${video.series_name ?? ''} ${video.channel_title ?? ''} ${(video.description ?? '').slice(0, 300)}`.toLowerCase();

  // Dấu hiệu rõ ràng của Anime / Hoạt hình chiếu rạp
  if (
    /\b(anime|hoạt\s*hình|hoat\s*hinh|animation|animated|cartoon|ghibli|conan|doraemon|one\s*piece|naruto|bleach|jujutsu|kimetsu|thanh\s*gươm|dragon\s*ball|suzume|your\s*name|kimi\s*no\s*na|shinchan|crayon\s*shin|pokemon|digimon|gundam|evangelion|muse\s*việt\s*nam|ani-one|pops\s*anime|hh3d|hh2d|3d\s*animation|pixar|dreamworks)\b|劇場版/i.test(
      hay,
    )
  ) {
    return 'Anime / Hoạt hình';
  }

  // Dấu hiệu phim điện ảnh người đóng (Live-Action)
  if (
    /\b(live[\s-]*action|người\s*đóng|nguoi\s*dong|phim\s*lẻ|phim\s*le|phim\s*điện\s*ảnh|phim\s*dien\s*anh|thuyết\s*minh|thuyet\s*minh|lồng\s*tiếng|long\s*tieng|hồng\s*kông|hong\s*kong|hàn\s*quốc|han\s*quoc|trung\s*quốc|trung\s*quoc|âu\s*mỹ|au\s*my|hollywood|võ\s*thuật|vo\s*thuat|kiếm\s*hiệp|kiem\s*hiep|châu\s*tinh\s*trì|thành\s*long|chân\s*tử\s*đan|lý\s*liên\s*kiệt)\b/i.test(
      hay,
    )
  ) {
    return 'Phim Người Đóng';
  }

  return 'Anime / Hoạt hình';
}

/**
 * Lọc nhanh theo nhóm thể loại an toàn trong không gian Phim Chiếu Rạp.
 * Ưu tiên kiểm tra mảng `cinema_genres` từ Gemini + Google Search Grounding;
 * fallback sang nhận diện từ khóa trên tiêu đề/mô tả nếu bản ghi cũ chưa cập nhật `cinema_genres`.
 */
export function matchesTheatricalSafeCategory(
  video: {
    title: string;
    description?: string | null;
    series_name?: string | null;
    cinema_genres?: string[] | null;
  },
  category: TheatricalCategoryFilter,
): boolean {
  if (category === 'all') return true;

  if (Array.isArray(video.cinema_genres) && video.cinema_genres.length > 0) {
    const normalizedGenres = video.cinema_genres.map((g) => g.toLowerCase());
    const target = category.toLowerCase();
    if (normalizedGenres.some((g) => g.includes(target))) {
      return true;
    }
    // Cho phép Võ thuật khớp với Hành động nếu người dùng lọc Hành động
    if (
      category === 'Hành động' &&
      normalizedGenres.some((g) => g.includes('võ thuật'))
    ) {
      return true;
    }
    return false;
  }

  const hay =
    `${video.title} ${video.series_name ?? ''} ${video.description ?? ''}`.toLowerCase();

  switch (category) {
    case 'Hành động':
      return /\b(hành\s*động|hanh\s*dong|chiến\s*đấu|chien\s*dau|action|võ\s*thuật|vo\s*thuat|kiếm\s*hiệp|thanh\s*gươm|jujutsu|chú\s*thuật|conan|thám\s*tử|naruto|dragon\s*ball|bleach|hunter|đặc\s*nhiệm|sát\s*thủ)\b/i.test(
        hay,
      );
    case 'Phiêu lưu':
      return /\b(phiêu\s*lưu|phieu\s*luu|adventure|thám\s*hiểm|tham\s*hiem|hành\s*trình|hanh\s*trinh|one\s*piece|doraemon|pokemon|digimon|kho\s*báu)\b/i.test(
        hay,
      );
    case 'Giả tưởng':
      return /\b(giả\s*tưởng|gia\s*tuong|phép\s*thuật|phep\s*thuat|ma\s*thuật|fantasy|magic|isekai|dị\s*giới|thần\s*thoại|tiên\s*hiệp|suzume|ghibli|spirited|mononoke|howl|vùng\s*đất|lâu\s*đài)\b/i.test(
        hay,
      );
    case 'Tình cảm':
      return /\b(tình\s*cảm|tinh\s*cam|lãng\s*mạn|lang\s*man|đời\s*thường|doi\s*thuong|học\s*đường|hoc\s*duong|romance|slice\s*of\s*life|your\s*name|kimi\s*no\s*na|weathering|đứa\s*con\s*của\s*thời\s*tiết|dáng\s*hình\s*thanh\s*âm|violet|5cm|khu\s*vườn\s*ngôn\s*từ)\b/i.test(
        hay,
      );
    case 'Viễn tưởng':
      return /\b(viễn\s*tưởng|vien\s*tuong|tương\s*lai|tuong\s*lai|vũ\s*trụ|vu\s*tru|cơ\s*giáp|mecha|sci-fi|scifi|robot|gundam|evangelion|cyber|không\s*gian|du\s*hành\s*thời\s*gian)\b/i.test(
        hay,
      );
    case 'Hài hước':
      return /\b(hài\s*hước|hai\s*huoc|comedy|hài|vui\s*nhộn|shinchan|crayon\s*shin|châu\s*tinh\s*trì|gia\s*đình|family)\b/i.test(
        hay,
      );
    case 'Tâm lý':
      return /\b(tâm\s*lý|tam\s*ly|drama|chính\s*kịch|chinh\s*kich|cảm\s*động|cam\s*dong|trinh\s*thám|trinh\s*tham|bí\s*ẩn|bi\s*an)\b/i.test(
        hay,
      );
    default:
      return true;
  }
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
