import { Type, type Schema } from '@google/genai';
import {
  GEMINI_FALLBACK_MODELS,
  callGeminiWithFallback,
} from '@/lib/gemini/client';
import type {
  CinemaChatMessage,
  CinemaInsightData,
  CommentSentiment,
} from '@/types/ai-insight';

const MAX_TRANSCRIPT_CHARS = 3500;
const MAX_COMMENTS_COUNT = 25;
const MAX_COMMENT_TEXT_CHARS = 180;
const MAX_COMMENTS_CHARS = 1500;
const MAX_PROMPT_CHARS = 5800;
const MAX_SAMPLED_SEGMENTS = 600;

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

interface RawTranscriptSegment {
  startSec: number;
  text: string;
}

export interface FetchedCommentItem {
  author: string;
  text: string;
  likes: number;
}

function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(secs)}`
    : `${pad(mins)}:${pad(secs)}`;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function selectPreferredCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const valid = tracks.filter((t) => Boolean(t.baseUrl));
  if (valid.length === 0) return null;

  // Ưu tiên: Tiếng Việt thủ công -> Tiếng Việt tự động (ASR) -> Tiếng Anh -> Track đầu tiên
  const viManual = valid.find(
    (t) =>
      (t.languageCode === 'vi' || t.languageCode?.startsWith('vi-')) &&
      t.kind !== 'asr',
  );
  if (viManual) return viManual;

  const viAny = valid.find(
    (t) => t.languageCode === 'vi' || t.languageCode?.startsWith('vi-'),
  );
  if (viAny) return viAny;

  const enManual = valid.find(
    (t) =>
      (t.languageCode === 'en' || t.languageCode?.startsWith('en-')) &&
      t.kind !== 'asr',
  );
  if (enManual) return enManual;

  const enAny = valid.find(
    (t) => t.languageCode === 'en' || t.languageCode?.startsWith('en-'),
  );
  if (enAny) return enAny;

  return valid[0];
}

async function fetchCaptionTracksForVideo(
  videoId: string,
): Promise<CaptionTrack[]> {
  // Cách 1: Gọi InnerTube ANDROID player API (nhanh, gọn JSON, ít bị captcha)
  try {
    const res = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              hl: 'vi',
              gl: 'VN',
            },
          },
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      },
    );

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        captions?: {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: CaptionTrack[];
          };
        };
      } | null;

      const tracks =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (tracks.length > 0) return tracks;
    }
  } catch {
    // Chuyển sang fallback đọc watch page HTML
  }

  // Cách 2: Fallback đọc captionTracks từ trang watch HTML
  try {
    const watchRes = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=vi`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!watchRes.ok) return [];
    const html = await watchRes.text();
    const match = html.match(/"captionTracks":(\[[\s\S]*?\])(?=,"audioTracks"|,"translationLanguages"|,"defaultAudioTrackIndex"|\})/);
    if (!match?.[1]) return [];
    const parsed = JSON.parse(match[1]) as CaptionTrack[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildCompactTimestampedTranscript(
  segments: RawTranscriptSegment[],
): string {
  if (segments.length === 0) return '';

  // Với các video siêu dài (10-12 tiếng, có thể tới 15.000+ câu thoại),
  // lấy mẫu đều phần ĐẦU + GIỮA + CUỐI trước khi gom nhóm để xử lý tức thì (< 5ms)
  let sampledSegments = segments;
  if (segments.length > MAX_SAMPLED_SEGMENTS) {
    const partSize = Math.floor(MAX_SAMPLED_SEGMENTS / 3); // 400 đoạn mỗi vùng
    const midStart = Math.floor((segments.length - partSize) / 2);
    sampledSegments = [
      ...segments.slice(0, partSize),
      ...segments.slice(midStart, midStart + partSize),
      ...segments.slice(-partSize),
    ];
  }

  const lines: string[] = [];
  let bucketText: string[] = [];
  let bucketStart = sampledSegments[0].startSec;
  let lastStamp = sampledSegments[0].startSec;

  for (const seg of sampledSegments) {
    const clean = seg.text.replace(/\s+/g, ' ').trim();
    if (!clean) continue;

    if (seg.startSec - lastStamp >= 35 && bucketText.length > 0) {
      lines.push(`[${formatTimestamp(bucketStart)}] ${bucketText.join(' ')}`);
      bucketText = [clean];
      bucketStart = seg.startSec;
      lastStamp = seg.startSec;
    } else {
      bucketText.push(clean);
    }
  }

  if (bucketText.length > 0) {
    lines.push(`[${formatTimestamp(bucketStart)}] ${bucketText.join(' ')}`);
  }

  const fullText = lines.join('\n');
  if (fullText.length <= MAX_TRANSCRIPT_CHARS) {
    return fullText;
  }

  // Giới hạn transcript tối đa ~3.500 ký tự (ĐẦU 1.3k + GIỮA 1.1k + CUỐI 1.1k) để tổng prompt
  // nằm dưới ~1.500 tokens, giúp gemini-2.5-flash không chạm ngưỡng TPM 429 và trả JSON trong 1.5-2.5s.
  const headLen = 1300;
  const midLen = 1100;
  const tailLen = 1100;
  const midStart = Math.max(
    headLen,
    Math.floor((fullText.length - midLen) / 2),
  );

  return [
    fullText.slice(0, headLen),
    '\n... [đoạn giữa phim] ...\n',
    fullText.slice(midStart, midStart + midLen),
    '\n... [đoạn gần cuối phim] ...\n',
    fullText.slice(-tailLen),
  ].join('');
}

/**
 * Nguồn 2: Tải lời thoại / phụ đề thực tế bên trong video YouTube kèm mốc thời gian [MM:SS].
 * Fallback an toàn: không bao giờ ném lỗi nếu video không có phụ đề.
 */
export async function fetchYouTubeTranscript(videoId: string): Promise<{
  text: string | null;
  hasTranscript: boolean;
}> {
  try {
    const tracks = await fetchCaptionTracksForVideo(videoId);
    const chosen = selectPreferredCaptionTrack(tracks);
    if (!chosen?.baseUrl) {
      return { text: null, hasTranscript: false };
    }

    const baseUrl = chosen.baseUrl.replace(/\\u0026/g, '&');
    const jsonUrl = baseUrl.includes('fmt=')
      ? baseUrl.replace(/fmt=[^&]+/, 'fmt=json3')
      : `${baseUrl}&fmt=json3`;

    const segments: RawTranscriptSegment[] = [];

    // Ưu tiên JSON3
    const jsonRes = await fetch(jsonUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (jsonRes.ok) {
      const rawText = await jsonRes.text();
      if (rawText.trim().startsWith('{')) {
        const parsed = JSON.parse(rawText) as {
          events?: Array<{
            tStartMs?: number;
            segs?: Array<{ utf8?: string }>;
          }>;
        };
        for (const ev of parsed.events ?? []) {
          if (!Array.isArray(ev.segs)) continue;
          const combined = ev.segs
            .map((s) => s.utf8 ?? '')
            .join('')
            .replace(/\n/g, ' ')
            .trim();
          if (!combined) continue;
          segments.push({
            startSec: Math.floor((ev.tStartMs ?? 0) / 1000),
            text: decodeHtmlEntities(combined),
          });
        }
      }
    }

    // Fallback sang XML timedtext nếu JSON3 rỗng
    if (segments.length === 0) {
      const xmlRes = await fetch(baseUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (xmlRes.ok) {
        const xml = await xmlRes.text();
        const tagRe = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
        let match: RegExpExecArray | null;
        while ((match = tagRe.exec(xml)) !== null) {
          const startSec = Math.floor(Number(match[1]) || 0);
          const cleaned = decodeHtmlEntities(
            match[2].replace(/<[^>]+>/g, ' ').replace(/\n/g, ' '),
          ).trim();
          if (cleaned) {
            segments.push({ startSec, text: cleaned });
          }
        }
      }
    }

    const formatted = buildCompactTimestampedTranscript(segments);
    if (!formatted || formatted.length < 40) {
      return { text: null, hasTranscript: false };
    }

    return { text: formatted, hasTranscript: true };
  } catch {
    return { text: null, hasTranscript: false };
  }
}

const SPAM_COMMENT_RE =
  /(https?:\/\/|www\.|t\.me\/|telegram|zalo\.me|bit\.ly|tinyurl|shopee|lazada|kiếm\s*tiền|vay\s*tiền|casino|nhà\s*cái|kèo\s*bóng)/i;

/**
 * Nguồn 3: Quét bình luận thật từ YouTube Data API v3 (`commentThreads`).
 * Lọc bỏ spam/link rác, sắp xếp theo lượt like giảm dần và chỉ giữ tối đa 25 bình luận nhiều like nhất (mỗi bình luận <= 180 ký tự).
 * Fallback an toàn khi video tắt bình luận hoặc thiếu API key.
 */
export async function fetchYouTubeComments(videoId: string): Promise<{
  comments: FetchedCommentItem[];
  hasComments: boolean;
}> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return { comments: [], hasComments: false };
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('maxResults', '45');
    url.searchParams.set('textFormat', 'plainText');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return { comments: [], hasComments: false };
    }

    const data = (await res.json().catch(() => ({}))) as {
      items?: Array<{
        snippet?: {
          topLevelComment?: {
            snippet?: {
              authorDisplayName?: string;
              textDisplay?: string;
              textOriginal?: string;
              likeCount?: number;
            };
          };
        };
      }>;
    };

    const seenTexts = new Set<string>();
    const filtered: FetchedCommentItem[] = [];

    for (const item of data.items ?? []) {
      const snip = item.snippet?.topLevelComment?.snippet;
      const rawText = (snip?.textOriginal || snip?.textDisplay || '').trim();
      const compact = rawText.replace(/\s+/g, ' ').trim();
      if (compact.length < 4) continue;
      if (SPAM_COMMENT_RE.test(compact)) continue;

      const dedupeKey = compact.toLowerCase().slice(0, 80);
      if (seenTexts.has(dedupeKey)) continue;
      seenTexts.add(dedupeKey);

      filtered.push({
        author: (snip?.authorDisplayName || 'Khán giả YouTube')
          .replace(/^@/, '')
          .slice(0, 40),
        text: compact.slice(0, MAX_COMMENT_TEXT_CHARS),
        likes: Math.max(0, Number(snip?.likeCount) || 0),
      });
    }

    const topLiked = filtered
      .sort((a, b) => b.likes - a.likes)
      .slice(0, MAX_COMMENTS_COUNT);

    return {
      comments: topLiked,
      hasComments: topLiked.length > 0,
    };
  } catch {
    return { comments: [], hasComments: false };
  }
}

function clampScore(value: unknown, fallback = 75): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function sanitizeSentiment(val: unknown): CommentSentiment {
  if (val === 'positive' || val === 'mixed' || val === 'critical') return val;
  return 'positive';
}

const INSIGHT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    overallScore: { type: Type.INTEGER },
    verdictLabel: { type: Type.STRING },
    metrics: {
      type: Type.OBJECT,
      properties: {
        plot: { type: Type.INTEGER },
        visuals: { type: Type.INTEGER },
        audio: { type: Type.INTEGER },
        pacing: { type: Type.INTEGER },
      },
      required: ['plot', 'visuals', 'audio', 'pacing'],
    },
    overview: { type: Type.STRING },
    highlights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          time: { type: Type.STRING },
          description: { type: Type.STRING },
        },
        required: ['time', 'description'],
      },
    },
    communityPros: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    communityCons: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    featuredComments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          author: { type: Type.STRING },
          text: { type: Type.STRING },
          likes: { type: Type.INTEGER },
          sentiment: {
            type: Type.STRING,
            enum: ['positive', 'mixed', 'critical'],
          },
        },
        required: ['author', 'text', 'likes', 'sentiment'],
      },
    },
    storyContext: { type: Type.STRING },
  },
  required: [
    'overallScore',
    'verdictLabel',
    'metrics',
    'overview',
    'highlights',
    'communityPros',
    'communityCons',
    'featuredComments',
    'storyContext',
  ],
};

/**
 * Phân tích chuyên sâu đa nguồn (Metadata + Transcript + Bình luận YouTube) bằng Gemini API
 * trả về Structured JSON thang điểm 100 + storyContext làm trí nhớ cho Chat.
 */
export async function generateCinemaInsightWithGemini(input: {
  title: string;
  description: string | null;
  channelTitle: string | null;
  detectedGenre: string | null;
  durationSeconds: number;
  transcriptText: string | null;
  hasTranscript: boolean;
  comments: FetchedCommentItem[];
  hasComments: boolean;
}): Promise<CinemaInsightData> {
  const topComments = [...input.comments]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, MAX_COMMENTS_COUNT);

  const rawCommentsBlock =
    topComments.length > 0
      ? topComments
          .map(
            (c, idx) =>
              `${idx + 1}. [${c.author} | 👍 ${c.likes}]: ${c.text.slice(0, MAX_COMMENT_TEXT_CHARS)}`,
          )
          .join('\n')
      : '(Video hiện không có bình luận hoặc đã tắt bình luận)';
  const commentsBlock = rawCommentsBlock.slice(0, MAX_COMMENTS_CHARS);

  const transcriptBlock = input.transcriptText
    ? input.transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)
    : '(Video không có phụ đề/lời thoại khả dụng — hãy phân tích khách quan từ tiêu đề, mô tả và bình luận khán giả, tuyệt đối không bịa mốc thời gian không có thật)';

  const rawPrompt = `Bạn là nhà phê bình điện ảnh & chuyên gia phân tích hoạt hình/Phim AI của rạp chiếu phim AniSub.
Hãy phân tích chuyên sâu video dưới đây từ 3 nguồn dữ liệu THỰC TẾ (Metadata, Lời thoại/Phụ đề bên trong phim, và Bình luận khán giả YouTube) rồi trả về đúng JSON theo schema.

=== NGUỒN 1: METADATA PHIM ===
- Tiêu đề: ${input.title.slice(0, 180)}
- Kênh: ${(input.channelTitle || 'Không rõ').slice(0, 80)}
- Thể loại: ${input.detectedGenre || 'Hoạt hình'}
- Thời lượng: ${Math.round(input.durationSeconds / 60)} phút (${input.durationSeconds} giây)
- Mô tả: ${(input.description || '(Không có mô tả)').slice(0, 400)}

=== NGUỒN 2: LỜI THOẠI / PHỤ ĐỀ TRONG PHIM (Có sẵn: ${input.hasTranscript ? 'CÓ' : 'KHÔNG'}) ===
${transcriptBlock}

=== NGUỒN 3: BÌNH LUẬN THẬT CỦA KHÁN GIẢ YOUTUBE (${topComments.length} bình luận nhiều like nhất) ===
${commentsBlock}

=== YÊU CẦU PHÂN TÍCH NGHIÊM NGẶT (TIẾNG VIỆT TỰ NHIÊN) ===
1. overallScore (0-100): Chấm điểm khách quan tổng hợp từ phản hồi thực tế của khán giả trong bình luận và chất lượng nội dung lời thoại (không chấm 100 bừa bãi; thường phân bổ hợp lý 55-96 tùy chất lượng thực tế).
2. verdictLabel: Nhãn ngắn 2-5 từ súc tích (vd: "Siêu phẩm cuốn hút", "Đáng cày ngay", "Giải trí ổn áp", "Kén người xem").
3. metrics: 4 điểm 0-100 riêng biệt:
   - plot (Cốt truyện & Diễn biến)
   - visuals (Hình ảnh / Kỹ xảo / Hoạt họa)
   - audio (Âm thanh / Thuyết minh / Nhạc nền)
   - pacing (Nhịp độ & Mức độ lôi cuốn)
4. overview: 3-4 câu tổng quan mạch lạc, nắm chắc bối cảnh và diễn biến thực tế từ lời thoại phim, TUYỆT ĐỐI KHÔNG spoil đoạn kết.
5. highlights: 2-3 mốc cảnh/tình tiết đáng chú ý. Nếu có transcript kèm mốc [MM:SS], trích xuất đúng mốc thời gian "MM:SS" thực tế; nếu không có transcript thì để time là "" và nêu điểm đáng chú ý từ mô tả/bình luận.
6. communityPros: 2-3 điểm cộng cụ thể được khán giả khen nhiều nhất (nếu không có bình luận thì nêu ưu điểm nổi bật dựa trên nội dung phim).
7. communityCons: 1-2 điểm trừ hoặc lưu ý nhỏ thực tế từ bình luận (nếu không có phàn nàn rõ rệt thì ghi 1 nhận xét khách quan hữu ích cho người xem).
8. featuredComments: Trích tối đa 3 bình luận đắt giá/thú vị nhất TỪ ĐÚNG DANH SÁCH NGUỒN 3 ở trên (giữ đúng tác giả, số likes, tóm gọn nếu quá dài và gắn sentiment 'positive' | 'mixed' | 'critical'). Nếu Nguồn 3 rỗng thì trả về mảng rỗng [].
9. storyContext: Bản ghi nhớ khoảng 900-1.400 ký tự tổng hợp đầy đủ tên nhân vật, phe phái, tình tiết quan trọng theo trình tự từ lời thoại (nếu có) và các luồng ý kiến nổi bật trong bình luận, để làm trí nhớ chính xác cho trợ lý Chat hỏi đáp ngay sau đó.`;

  const prompt = rawPrompt.slice(0, MAX_PROMPT_CHARS);

  const { text: raw } = await callGeminiWithFallback({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: INSIGHT_RESPONSE_SCHEMA,
      temperature: 0.25,
    },
  });

  const parsed = JSON.parse(raw) as Partial<CinemaInsightData>;

  const metrics = {
    plot: clampScore(parsed.metrics?.plot, 76),
    visuals: clampScore(parsed.metrics?.visuals, 78),
    audio: clampScore(parsed.metrics?.audio, 75),
    pacing: clampScore(parsed.metrics?.pacing, 76),
  };

  const avgFallback = Math.round(
    (metrics.plot + metrics.visuals + metrics.audio + metrics.pacing) / 4,
  );

  const featuredComments =
    input.comments.length > 0 && Array.isArray(parsed.featuredComments)
      ? parsed.featuredComments
          .filter((c) => c && typeof c.text === 'string' && c.text.trim())
          .slice(0, 3)
          .map((c) => ({
            author: String(c.author || 'Khán giả YouTube').slice(0, 50),
            text: String(c.text).trim().slice(0, 260),
            likes: Math.max(0, Math.round(Number(c.likes) || 0)),
            sentiment: sanitizeSentiment(c.sentiment),
          }))
      : [];

  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
        .filter(
          (h) =>
            h && typeof h.description === 'string' && h.description.trim(),
        )
        .slice(0, 3)
        .map((h) => ({
          time: input.hasTranscript ? String(h.time || '').trim() : '',
          description: String(h.description).trim(),
        }))
    : [];

  return {
    overallScore: clampScore(parsed.overallScore, avgFallback),
    verdictLabel:
      parsed.verdictLabel?.trim() ||
      (avgFallback >= 80
        ? 'Đáng cày ngay'
        : avgFallback >= 65
          ? 'Giải trí ổn áp'
          : 'Kén người xem'),
    metrics,
    overview:
      parsed.overview?.trim() ||
      'Chưa đủ dữ liệu chi tiết để tóm tắt sâu, mời bạn xem trực tiếp tập phim.',
    highlights,
    communityPros: Array.isArray(parsed.communityPros)
      ? parsed.communityPros
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 3)
      : [],
    communityCons: Array.isArray(parsed.communityCons)
      ? parsed.communityCons
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 2)
      : [],
    featuredComments,
    analyzedCommentCount: input.comments.length,
    hasTranscript: input.hasTranscript,
    hasComments: input.hasComments,
    storyContext:
      parsed.storyContext?.trim().slice(0, 3500) ||
      parsed.overview?.trim() ||
      '',
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Hội thoại hỏi đáp nhiều lượt theo ngữ cảnh tập phim (AI Cinema Assistant).
 */
export async function chatWithCinemaAssistant(input: {
  videoTitle: string;
  channelTitle?: string | null;
  videoDescription?: string | null;
  insightContext?: Partial<CinemaInsightData> | null;
  messages: CinemaChatMessage[];
  models?: readonly string[];
}): Promise<string> {
  const ctx = input.insightContext;

  const commentsSnippet = (ctx?.featuredComments ?? [])
    .map((c) => `- ${c.author} (👍 ${c.likes}): "${c.text}"`)
    .join('\n');

  const systemInstruction = `Bạn là Chuyên gia phân tích hoạt hình & Trợ lý rạp phim thông minh của AniSub.
Hãy trả lời câu hỏi của người xem bằng tiếng Việt tự nhiên, súc tích, thông minh và đi thẳng vào trọng tâm (dùng gạch đầu dòng "- " hoặc **in đậm** khi cần cho dễ đọc).

NGUYÊN TẮC BẮT BUỘC:
1. Ưu tiên tuyệt đối dựa vào DỮ LIỆU THỰC TẾ bên dưới (lời thoại trong phim và bình luận khán giả) để trả lời chính xác từng nhân vật, chiêu thức, tình tiết.
2. Nếu người dùng hỏi chi tiết KHÔNG xuất hiện trong dữ liệu phim/bình luận được cung cấp, hãy nói thẳng là dữ liệu tập này không đề cập chi tiết đó — TUYỆT ĐỐI KHÔNG tự bịa đặt tình tiết.
3. Mặc định KHÔNG spoil đoạn kết/twist cuối tập trừ khi người dùng chủ động hỏi thẳng về kết cục.

=== THÔNG TIN TẬP PHIM ĐANG XEM ===
- Tiêu đề: ${input.videoTitle}
- Kênh: ${input.channelTitle || 'Không rõ'}
- Mô tả: ${(input.videoDescription || '(Không có)').slice(0, 700)}
- Điểm đánh giá tổng quan: ${ctx?.overallScore ?? 'N/A'}/100 (${ctx?.verdictLabel ?? ''})
- Có đọc được lời thoại phim: ${ctx?.hasTranscript ? 'CÓ' : 'KHÔNG'}
- Số bình luận YouTube đã quét: ${ctx?.analyzedCommentCount ?? 0}

=== TỔNG QUAN & TRÍ NHỚ NỘI DUNG TẬP PHIM ===
Tổng quan: ${ctx?.overview || '(Chưa có)'}

Chi tiết nội dung & diễn biến (storyContext):
${(ctx?.storyContext || '(Chưa có)').slice(0, 2200)}

Điểm cộng từ cộng đồng:
${(ctx?.communityPros ?? []).map((p) => `- ${p}`).join('\n') || '(Không có)'}

Điểm trừ / Lưu ý từ cộng đồng:
${(ctx?.communityCons ?? []).map((c) => `- ${c}`).join('\n') || '(Không có)'}

Bình luận tiêu biểu:
${commentsSnippet || '(Không có)'}`;

  const recentMessages = input.messages.slice(-12);
  const contents = recentMessages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content.slice(0, 1000) }],
  }));

  const { text } = await callGeminiWithFallback({
    contents,
    models: input.models ?? GEMINI_FALLBACK_MODELS,
    config: {
      systemInstruction,
      temperature: 0.4,
    },
  });

  return text;
}
