export interface VideoChapter {
  startSeconds: number;
  timeLabel: string;
  title: string;
}

export interface TimestampHighlight {
  seconds: number;
  timeLabel: string;
  quote: string;
  author: string;
  likes: number;
}

/**
 * Chuyển chuỗi mốc thời gian `MM:SS` hoặc `HH:MM:SS` sang tổng số giây.
 */
export function parseTimestampToSeconds(raw: string): number | null {
  const parts = raw
    .trim()
    .split(':')
    .map((p) => Number.parseInt(p, 10));
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (parts.length === 2) {
    const [mins, secs] = parts;
    if (secs >= 60) return null;
    return mins * 60 + secs;
  }

  const [hours, mins, secs] = parts;
  if (mins >= 60 || secs >= 60) return null;
  return hours * 3600 + mins * 60 + secs;
}

/**
 * Định dạng số giây thành `MM:SS` hoặc `H:MM:SS`.
 */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(secs)}`
    : `${pad(mins)}:${pad(secs)}`;
}

/**
 * Tự động trích xuất danh sách Chapters từ phần mô tả video YouTube (`description`).
 * Hỗ trợ các định dạng phổ biến:
 * - `00:00 Giới thiệu`
 * - `05:12 - Tập 1: Mở đầu`
 * - `[1:24:30] Cao trào`
 * - `Tập 2 - 24:30`
 */
export function parseVideoChapters(
  description?: string | null,
  durationSeconds?: number,
): VideoChapter[] {
  if (!description || !description.trim()) return [];

  const maxSec =
    typeof durationSeconds === 'number' && durationSeconds > 0
      ? durationSeconds
      : Number.POSITIVE_INFINITY;

  const lines = description.split(/\r?\n/);
  const bySecond = new Map<number, VideoChapter>();

  const leadingRe =
    /^\s*(?:[-•*▪▶]\s*)?[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|•]?\s+(.+)$/;
  const trailingRe =
    /^\s*(?:[-•*▪▶]\s*)?(.+?)\s*[-–—:|•]\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length < 5) continue;

    let rawTime: string | null = null;
    let rawTitle: string | null = null;

    const leadMatch = line.match(leadingRe);
    if (leadMatch) {
      rawTime = leadMatch[1];
      rawTitle = leadMatch[2];
    } else {
      const trailMatch = line.match(trailingRe);
      if (trailMatch) {
        rawTitle = trailMatch[1];
        rawTime = trailMatch[2];
      }
    }

    if (!rawTime || !rawTitle) continue;

    const seconds = parseTimestampToSeconds(rawTime);
    if (seconds === null || seconds >= maxSec) continue;

    const cleanTitle = rawTitle
      .replace(/^[\s\-–—:|•]+/, '')
      .replace(/[\s\-–—:|•]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);

    if (!cleanTitle || cleanTitle.length < 2) continue;
    // Bỏ qua các dòng chỉ chứa link hoặc hashtag
    if (/^https?:\/\//i.test(cleanTitle)) continue;

    if (!bySecond.has(seconds)) {
      bySecond.set(seconds, {
        startSeconds: seconds,
        timeLabel: formatSecondsToTimestamp(seconds),
        title: cleanTitle,
      });
    }
  }

  const chapters = Array.from(bySecond.values()).sort(
    (a, b) => a.startSeconds - b.startSeconds,
  );

  // YouTube chỉ coi là danh sách Chapter hợp lệ khi có ít nhất 2 mốc thời gian
  return chapters.length >= 2 ? chapters : [];
}

/**
 * Trích xuất tối đa 8 bình luận gắn mốc giờ (`\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b`)
 * có lượt thích cao nhất từ cộng đồng, loại bỏ spam & trùng mốc sát nhau.
 */
export function extractTimestampHighlights(
  comments: Array<{ author: string; text: string; likes: number }>,
  durationSeconds?: number,
  maxItems = 8,
): TimestampHighlight[] {
  if (!Array.isArray(comments) || comments.length === 0) return [];

  const maxSec =
    typeof durationSeconds === 'number' && durationSeconds > 0
      ? durationSeconds
      : Number.POSITIVE_INFINITY;

  const timestampRe = /\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b/;
  const spamRe =
    /(https?:\/\/|t\.me\/|zalo\.me|shopee\.|lazada\.|nhà cái|cá cược|nhận quà|sub chéo)/i;

  const sorted = [...comments].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  const results: TimestampHighlight[] = [];
  const usedBuckets = new Set<number>();

  for (const comment of sorted) {
    if (results.length >= maxItems) break;
    const text = (comment.text || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 6 || spamRe.test(text)) continue;

    const match = text.match(timestampRe);
    if (!match?.[1]) continue;

    const seconds = parseTimestampToSeconds(match[1]);
    if (seconds === null || seconds < 5 || seconds >= maxSec) continue;

    // Gộp các bình luận chỉ vào cùng 1 khoảng 10 giây để tránh trùng lặp
    const bucket = Math.floor(seconds / 10);
    if (usedBuckets.has(bucket)) continue;
    usedBuckets.add(bucket);

    // Làm gọn trích dẫn (bỏ mốc thời gian lặp ở đầu nếu có)
    let quote = text
      .replace(new RegExp(`^${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:|•]?\\s*`), '')
      .trim();
    if (quote.length < 4) quote = text;
    if (quote.length > 110) quote = `${quote.slice(0, 107).trim()}...`;

    results.push({
      seconds,
      timeLabel: formatSecondsToTimestamp(seconds),
      quote,
      author: (comment.author || 'Khán giả').slice(0, 40),
      likes: Math.max(0, Number(comment.likes ?? 0) || 0),
    });
  }

  return results;
}
