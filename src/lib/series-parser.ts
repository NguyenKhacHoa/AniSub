import {
  PRIMARY_GENRE_OPTIONS,
  isTheatricalMovieVideo,
  type CinemaVideoItem,
  type PrimaryGenreTag,
} from '@/types/workspace';

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export interface ParsedEpisodeInfo {
  episodeLabel: string;
  episodeSortNumber: number;
  seasonNumber: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
  hasExplicitMarker: boolean;
}

export interface SeriesEpisodeItem {
  video: CinemaVideoItem;
  episodeLabel: string;
  episodeSortNumber: number;
  seasonNumber: number | null;
  isNew: boolean;
  isWatched: boolean;
  isInProgress: boolean;
}

export interface SeriesGroup {
  seriesKey: string;
  seriesTitle: string;
  channelId: string;
  channelTitle: string;
  detectedGenre: PrimaryGenreTag;
  coverThumbnailUrl: string | null;
  totalEpisodes: number;
  latestEpisode: SeriesEpisodeItem;
  latestPublishedAt: string;
  episodes: SeriesEpisodeItem[];
  hasNewEpisode: boolean;
  lastWatchedEpisode: SeriesEpisodeItem | null;
  recommendedEpisode: SeriesEpisodeItem;
}

/**
 * Kiểm tra một Bộ phim (SeriesGroup) đã được xác minh là Phim Chiếu Rạp trong DB chưa
 * (Tuyệt đối không tự suy diễn ở frontend theo từ khóa tiêu đề hay thời lượng)
 */
export function isTheatricalSeries(series: SeriesGroup): boolean {
  if (series.detectedGenre === 'Phim AI') return false;
  return series.episodes.some((ep) => isTheatricalMovieVideo(ep.video));
}

/**
 * Chuẩn hóa chuỗi tiếng Việt thành slug không dấu để gom nhóm chính xác
 */
export function normalizeSeriesSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kiểm tra video có thuộc loại Phim Full / Tổng hợp / Trọn bộ / Marathon nhiều giờ cần loại khỏi tab Tập mới không
 */
export function isFullMovieTitle(title: string): boolean {
  const normalized = title.toLowerCase();
  // 1. Từ khóa tổng hợp / trọn bộ / full
  if (
    /\b(trọn\s*bộ|tron\s*bo|tổng\s*hợp|tong\s*hop|full\s*bộ|full\s*bo|full\s*phim|full\s*movie|full\s*season|full\s*mùa|full\s*mua|full\s*tập|full\s*tap|tất\s*cả\s*các\s*tập|all\s*episodes|review\s*phim|tóm\s*tắt\s*phim)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }

  // 2. Thời lượng tổng hợp kiểu "8H35", "24 GIỜ", "10 TIẾNG", "3H20P", "2H"
  if (
    /\b\d{1,2}\s*(?:h\d{1,2}p?|giờ|gio|tiếng|tieng)\b/i.test(normalized) ||
    /\[\s*\d{1,2}\s*h(?:\d{1,2})?\s*\]/i.test(normalized) ||
    /(?:^|[\s|(\[-])\d{1,2}h(?:\d{1,2})?(?:$|[\s|)\]-])/i.test(normalized)
  ) {
    return true;
  }

  // 3. Từ "full" đứng độc lập (nhưng không loại "Full HD" ở tập lẻ)
  const withoutFullHd = normalized.replace(/\bfull\s*hd\b/gi, '');
  if (/\bfull\b/i.test(withoutFullHd)) {
    return true;
  }

  return false;
}

/**
 * Kiểm tra tiêu đề có dấu hiệu phân tập / phần / mùa
 */
export function hasEpisodeMarkerInTitle(title: string): boolean {
  return /\b(tập|tap|phần|phan|mùa|mua|season|ss|ep|episode|chương|chuong)\s*\.?\s*\d+/i.test(
    title,
  );
}

/**
 * Điều kiện lọc video vào tab Tập mới (Series Playlist):
 * - Loại bỏ Shorts, Trailer và Phim Full / Trọn bộ / Tổng hợp / Marathon nhiều giờ
 * - Loại bỏ video gộp quá nhiều tập trong 1 clip (vd: Tập 1-50, Tập 1-20)
 * - Chấp nhận video có dấu hiệu phân tập trong tiêu đề hoặc video_type === 'episode'
 */
export function isSeriesEpisodeCandidate(video: CinemaVideoItem): boolean {
  if (video.is_short) return false;
  if (video.video_type === 'trailer') return false;
  if (video.video_type === 'full_movie') return false;
  if (isFullMovieTitle(video.title)) return false;

  const parsed = parseEpisodeInfo(video.title, video.episode_number);
  if (
    parsed.episodeStart !== null &&
    parsed.episodeEnd !== null &&
    parsed.episodeEnd - parsed.episodeStart >= 8
  ) {
    return false;
  }

  if (hasEpisodeMarkerInTitle(video.title)) return true;
  if (video.episode_number !== null) return true;
  if (video.video_type === 'episode') return true;

  return false;
}

/**
 * Trích xuất nhãn tập & số thứ tự sắp xếp từ tiêu đề video
 * Hỗ trợ: "Tập 258-259 (Mùa 3)", "TẬP 01-02", "Phần 2 - Tập 10", "SS2 Ep 14", "Chương 5"
 */
export function parseEpisodeInfo(
  title: string,
  fallbackEpisodeNumber: number | null = null,
): ParsedEpisodeInfo {
  const seasonMatch = title.match(
    /\b(?:mùa|mua|season|ss|phần|phan)\s*\.?\s*(\d{1,2})\b/i,
  );
  const seasonKeywordRaw = seasonMatch?.[0] ?? '';
  const seasonNumber = seasonMatch ? Number.parseInt(seasonMatch[1], 10) : null;
  const isPartKeyword = /^(?:phần|phan)/i.test(seasonKeywordRaw.trim());

  // Tìm số tập (hỗ trợ dải tập như 01-02, 258-259, 10 - 11, 12&13)
  const epMatch = title.match(
    /\b(?:tập|tap|ep|episode|chương|chuong)\s*\.?\s*(\d{1,4})(?:\s*[-–~&+]\s*(\d{1,4}))?\b/i,
  );

  if (epMatch) {
    const startNum = Number.parseInt(epMatch[1], 10);
    const endNum = epMatch[2] ? Number.parseInt(epMatch[2], 10) : startNum;
    const isChapter = /^(?:chương|chuong)/i.test(epMatch[0].trim());
    const prefix = isChapter ? 'Chương' : 'Tập';
    const epRangeStr =
      epMatch[2] && endNum !== startNum
        ? `${epMatch[1]}-${epMatch[2]}`
        : `${epMatch[1]}`;

    let episodeLabel = `${prefix} ${epRangeStr}`;
    if (seasonNumber !== null) {
      episodeLabel = isPartKeyword
        ? `Phần ${seasonNumber} - ${episodeLabel}`
        : `${episodeLabel} (Mùa ${seasonNumber})`;
    }

    const sortBase = Math.max(startNum, endNum);
    const episodeSortNumber =
      seasonNumber !== null ? seasonNumber * 100_000 + sortBase : sortBase;

    return {
      episodeLabel,
      episodeSortNumber,
      seasonNumber,
      episodeStart: startNum,
      episodeEnd: endNum,
      hasExplicitMarker: true,
    };
  }

  // Trường hợp chỉ ghi "Phần X" hoặc "Mùa X" mà không ghi số tập
  if (seasonNumber !== null) {
    const label = isPartKeyword
      ? `Phần ${seasonNumber}`
      : `Mùa ${seasonNumber}`;
    return {
      episodeLabel: label,
      episodeSortNumber: seasonNumber,
      seasonNumber,
      episodeStart: seasonNumber,
      episodeEnd: seasonNumber,
      hasExplicitMarker: true,
    };
  }

  // Fallback sang episode_number do AI trích xuất trong DB
  if (fallbackEpisodeNumber !== null && Number.isFinite(fallbackEpisodeNumber)) {
    return {
      episodeLabel: `Tập ${fallbackEpisodeNumber}`,
      episodeSortNumber: fallbackEpisodeNumber,
      seasonNumber: null,
      episodeStart: fallbackEpisodeNumber,
      episodeEnd: fallbackEpisodeNumber,
      hasExplicitMarker: true,
    };
  }

  return {
    episodeLabel: 'Tập mới',
    episodeSortNumber: 0,
    seasonNumber: null,
    episodeStart: null,
    episodeEnd: null,
    hasExplicitMarker: false,
  };
}

/**
 * Kiểm tra 1 đoạn phân cách bởi "|" có phải chỉ là nhãn số tập/kênh/sub không
 */
function isMetadataOnlySegment(segment: string, channelTitle?: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return true;

  // Khớp tên kênh
  if (channelTitle) {
    const normSeg = normalizeSeriesSlug(trimmed);
    const normCh = normalizeSeriesSlug(channelTitle);
    if (normSeg && normCh && (normSeg === normCh || normCh.includes(normSeg))) {
      return true;
    }
  }

  // Chỉ chứa số tập / mùa / phần / từ khóa chất lượng
  const stripped = trimmed
    .replace(
      /\b(?:tập|tap|ep|episode|chương|chuong|phần|phan|mùa|mua|season|ss)\s*\.?\s*\d+(?:\s*[-–~&+]\s*\d+)?/gi,
      '',
    )
    .replace(
      /\b(?:vietsub|thuyết\s*minh|thuyet\s*minh|full\s*hd|4k|2k|1080p|720p|hd|sub|raw|engsub|hh3d|hh2d|hoạt\s*hình|phim\s*ai|ai\s*movie|official|anime|review|mới\s*nhất|new|end|cuối|tập\s*cuối)\b/gi,
      '',
    )
    .replace(/[\s\-–—:|•()[\]【】#!?.,/]+/g, '')
    .trim();

  return stripped.length === 0;
}

/**
 * Chuẩn hóa tên gốc bộ phim từ tiêu đề video:
 * - Cắt bỏ tiền tố/hậu tố số tập ("TẬP 01-02 |", "TẬP 258-259 MÙA 3 |")
 * - Cắt bỏ tên kênh phía sau ("| 2K Sub", "| Aan VietSub")
 * - Cắt bỏ tên gốc chữ Hán phụ ("- 见微知燃")
 */
export function extractSeriesTitle(
  title: string,
  channelTitle?: string,
  fallbackSeriesName?: string | null,
): string {
  // 1. Gỡ các thẻ ngoặc vuông/ngoặc hoa chứa sub/tag kỹ thuật
  const cleanedRaw = title
    .replace(/\[[^\]]*(?:vietsub|thuyết\s*minh|thuyet\s*minh|4k|2k|hd|hh3d|hh2d|sub|raw|full|tập|ep|mùa|phần|ss)[^\]]*\]/gi, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\((?:vietsub|thuyết\s*minh|thuyet\s*minh|full\s*hd|4k|2k|hd|end|tập\s*cuối)\)/gi, ' ')
    .trim();

  // 2. Tách theo dấu gạch đứng | ｜ │ ┃
  const pipeSegments = cleanedRaw
    .split(/\s*[|｜│┃]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  let candidate = '';
  for (const seg of pipeSegments) {
    if (!isMetadataOnlySegment(seg, channelTitle)) {
      candidate = seg;
      break;
    }
  }

  if (!candidate) {
    candidate = pipeSegments[0] ?? cleanedRaw;
  }

  // 3. Cắt bỏ tiền tố số tập / phần / mùa ở đầu chuỗi
  candidate = candidate.replace(
    /^(?:(?:tập|tap|ep|episode|chương|chuong|phần|phan|mùa|mua|season|ss)\s*\.?\s*\d+(?:\s*[-–~&+]\s*\d+)?\s*[-–—:•]?\s*)+/i,
    '',
  );

  // 4. Cắt bỏ hậu tố số tập từ "Tập X..." hoặc "Ep X..." trở về sau
  candidate = candidate.replace(
    /\s*[-–—:•(]?\s*\b(?:tập|tap|ep|episode|chương|chuong)\s*\.?\s*\d+(?:\s*[-–~&+]\s*\d+)?.*$/i,
    '',
  );

  // 4b. Gỡ nhãn mùa / phần ở cuối tên phim (vd: "Mùa 3", "Phần 2", "SS2") để gom chung các mùa về 1 bộ
  candidate = candidate.replace(
    /\s*[-–—:•(]?\s*\b(?:mùa|mua|phần|phan|season|ss)\s*\.?\s*\d{1,2}\)?\s*$/i,
    '',
  );

  // 5. Cắt bỏ tên gốc chữ Hán phụ sau dấu gạch ngang hoặc cuối chuỗi
  candidate = candidate
    .replace(/\s*[-–—~:/]\s*[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef].*$/, '')
    .replace(/\s*\([\u4e00-\u9fff\u3400-\u4dbf\s]+\)\s*/g, ' ')
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]+/g, ' ');

  // 6. Cắt bỏ hậu tố chất lượng / sub / hashtag
  candidate = candidate
    .replace(/#\S+/g, ' ')
    .replace(
      /\s*[-–—:•]?\s*\b(?:vietsub|thuyết\s*minh|thuyet\s*minh|full\s*hd|4k|2k|1080p|hd|engsub|raw)\b.*$/i,
      '',
    )
    .replace(/^[\s\-–—:|•,.;!?()[\]]+|[\s\-–—:|•,.;!?()[\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (candidate.length >= 2) {
    return candidate;
  }

  if (fallbackSeriesName?.trim()) {
    return fallbackSeriesName.trim();
  }

  return title.trim();
}

export interface ExtractedSeriesInfo {
  seriesTitle: string;
  seriesSlug: string;
  seriesKey: string;
  isStandalone: boolean;
}

/**
 * Trích xuất thông tin định danh Bộ Phim (seriesTitle, seriesSlug, seriesKey)
 * dùng chung cho gom nhóm Series Playlist, lan truyền tag thủ công & phân loại AI theo bộ.
 */
export function extractSeriesInfo(params: {
  videoId: string;
  channelId: string;
  title: string;
  channelTitle?: string;
  seriesName?: string | null;
}): ExtractedSeriesInfo {
  const seriesTitle = extractSeriesTitle(
    params.title,
    params.channelTitle,
    params.seriesName,
  );
  const slug = normalizeSeriesSlug(seriesTitle);
  const isStandalone = !slug || slug.length < 2;
  const seriesSlug = isStandalone ? params.videoId : slug;
  const seriesKey = `${params.channelId}::${seriesSlug}`;

  return {
    seriesTitle,
    seriesSlug,
    seriesKey,
    isStandalone,
  };
}

function resolvePrimaryGenre(genre: string | null): PrimaryGenreTag {
  if (genre && PRIMARY_GENRE_OPTIONS.includes(genre as PrimaryGenreTag)) {
    return genre as PrimaryGenreTag;
  }
  return 'HH2D';
}

/**
 * Gom danh sách video thành các Bộ phim (SeriesGroup[]),
 * ưu tiên bộ có tập mới nhất lên đầu.
 */
export function groupVideosIntoSeries(
  videos: CinemaVideoItem[],
  nowMs: number = Date.now(),
): SeriesGroup[] {
  const buckets = new Map<
    string,
    {
      channelId: string;
      channelTitle: string;
      titles: string[];
      items: SeriesEpisodeItem[];
    }
  >();

  for (const video of videos) {
    if (!isSeriesEpisodeCandidate(video)) continue;

    const parsed = parseEpisodeInfo(video.title, video.episode_number);
    const { seriesTitle, seriesKey } = extractSeriesInfo({
      videoId: video.video_id,
      channelId: video.channel_id,
      title: video.title,
      channelTitle: video.channel_title,
      seriesName: video.series_name,
    });

    const publishedMs = new Date(video.published_at).getTime();
    const isNew =
      Number.isFinite(publishedMs) && nowMs - publishedMs <= FORTY_EIGHT_HOURS_MS;

    const duration = video.duration_seconds;
    const progressRatio = duration > 0 ? video.progress_seconds / duration : 0;
    const isWatched = video.is_completed || progressRatio >= 0.9;
    const isInProgress = !isWatched && video.progress_seconds > 15;

    const epItem: SeriesEpisodeItem = {
      video,
      episodeLabel: parsed.episodeLabel,
      episodeSortNumber: parsed.episodeSortNumber,
      seasonNumber: parsed.seasonNumber,
      isNew,
      isWatched,
      isInProgress,
    };

    const existing = buckets.get(seriesKey);
    if (existing) {
      existing.items.push(epItem);
      existing.titles.push(seriesTitle);
    } else {
      buckets.set(seriesKey, {
        channelId: video.channel_id,
        channelTitle: video.channel_title || video.channel_id,
        titles: [seriesTitle],
        items: [epItem],
      });
    }
  }

  const groups: SeriesGroup[] = [];

  for (const [seriesKey, bucket] of buckets.entries()) {
    // Sắp xếp danh sách tập giảm dần (Mới nhất trước): theo số tập -> ngày đăng
    const sortedDesc = [...bucket.items].sort((a, b) => {
      if (a.episodeSortNumber !== b.episodeSortNumber) {
        return b.episodeSortNumber - a.episodeSortNumber;
      }
      return (
        new Date(b.video.published_at).getTime() -
        new Date(a.video.published_at).getTime()
      );
    });

    const latestEpisode = sortedDesc[0];

    // Tập mới nhất theo thời gian đăng thực tế (phục vụ sắp xếp bộ phim)
    const latestByDate = [...bucket.items].sort(
      (a, b) =>
        new Date(b.video.published_at).getTime() -
        new Date(a.video.published_at).getTime(),
    )[0];

    // Chọn tên bộ phim sạch nhất (ngắn gọn nhất nhưng >= 2 ký tự)
    const displayTitle =
      bucket.titles
        .filter((t) => t.trim().length >= 2)
        .sort((a, b) => a.length - b.length)[0] ?? latestEpisode.video.title;

    // Tìm tập gần nhất mà user đã xem / đang xem dở (theo số tập cao nhất)
    const watchedOrInProgress = sortedDesc.filter(
      (ep) => ep.isWatched || ep.isInProgress,
    );
    const lastWatchedEpisode = watchedOrInProgress[0] ?? null;

    // Xác định hasNewEpisode:
    // 1) Tập mới nhất đăng trong vòng 48 giờ gần đây, HOẶC
    // 2) Bộ phim có tập mới hơn tập gần nhất mà user đã xem trong watch_progress
    const hasNewerThanWatched =
      lastWatchedEpisode !== null &&
      latestEpisode.video.video_id !== lastWatchedEpisode.video.video_id &&
      (latestEpisode.episodeSortNumber > lastWatchedEpisode.episodeSortNumber ||
        new Date(latestEpisode.video.published_at).getTime() >
          new Date(lastWatchedEpisode.video.published_at).getTime());

    const hasNewEpisode = latestByDate.isNew || hasNewerThanWatched;

    // Chọn tập phù hợp nhất khi user click vào thẻ bộ phim:
    // Ưu tiên 1: Tập đang xem dở mới nhất
    // Ưu tiên 2: Tập kế tiếp sau tập vừa xem xong
    // Ưu tiên 3: Tập mới nhất
    const inProgressEp = sortedDesc.find((ep) => ep.isInProgress);
    let recommendedEpisode: SeriesEpisodeItem = latestEpisode;

    if (inProgressEp) {
      recommendedEpisode = inProgressEp;
    } else if (lastWatchedEpisode && lastWatchedEpisode.isWatched) {
      const sortedAsc = [...sortedDesc].reverse();
      const watchedIdx = sortedAsc.findIndex(
        (ep) => ep.video.video_id === lastWatchedEpisode.video.video_id,
      );
      if (watchedIdx >= 0 && watchedIdx + 1 < sortedAsc.length) {
        recommendedEpisode = sortedAsc[watchedIdx + 1];
      }
    }

    groups.push({
      seriesKey,
      seriesTitle: displayTitle,
      channelId: bucket.channelId,
      channelTitle: bucket.channelTitle,
      detectedGenre: resolvePrimaryGenre(latestEpisode.video.detected_genre),
      coverThumbnailUrl: latestEpisode.video.thumbnail_url,
      totalEpisodes: sortedDesc.length,
      latestEpisode,
      latestPublishedAt: latestByDate.video.published_at,
      episodes: sortedDesc,
      hasNewEpisode,
      lastWatchedEpisode,
      recommendedEpisode,
    });
  }

  // Ưu tiên bộ có tập mới & bộ vừa đăng tập mới nhất lên đầu
  groups.sort((a, b) => {
    if (a.hasNewEpisode !== b.hasNewEpisode) {
      return a.hasNewEpisode ? -1 : 1;
    }
    return (
      new Date(b.latestPublishedAt).getTime() -
      new Date(a.latestPublishedAt).getTime()
    );
  });

  return groups;
}
