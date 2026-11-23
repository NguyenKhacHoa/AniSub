import { Type, type Schema } from '@google/genai';
import {
  GEMINI_FALLBACK_MODELS,
  GEMINI_PRIMARY_MODEL,
  callGeminiWithFallback,
  getGeminiClient,
  getGeminiErrorStatus,
  isRetryableGeminiModelError,
} from '@/lib/gemini/client';
import { extractSeriesInfo, parseEpisodeInfo } from '@/lib/series-parser';
import {
  VERIFIED_THEATRICAL_TAG,
  isHardExcludedFromTheatrical,
  isPotentialTheatricalCandidate,
  type PrimaryGenreTag,
} from '@/types/workspace';

export const GEMINI_VISION_MODELS = GEMINI_FALLBACK_MODELS;

const BATCH_CHUNK_SIZE = 4;
const INTER_CHUNK_DELAY_MS = 2000;

export interface MultimodalVideoInput {
  video_id: string;
  channel_id?: string;
  channel_title?: string;
  title: string;
  description: string | null;
  tags?: string[];
  thumbnail_url: string | null;
  vision_thumbnail_url?: string | null;
  series_name?: string | null;
  duration_seconds: number;
}

export interface MultimodalClassificationResult {
  videoId: string;
  detectedGenre: PrimaryGenreTag;
  seriesName: string | null;
  episodeNumber: number | null;
  isMovie?: boolean;
  confidence: number;
  source: 'fixed' | 'gemini' | 'fallback';
}

export interface TheatricalVerificationResult {
  isTheatricalMovie: boolean;
  originalTitle: string | null;
  releaseYear: number | null;
}

/**
 * Xác minh thực tế qua Google Search Grounding (`tools: [{ googleSearch: {} }]` / `google_search` trên `v1beta`):
 * - Chỉ kích hoạt với các video có dấu hiệu bản điện ảnh thực thụ (`The Movie`, `Bản Điện Ảnh`, `Chiếu Rạp`
 *   hoặc thuộc các kênh phát hành chính hãng *Muse Việt Nam*, *Ani-One Vietnam*, *POPS Anime*, *Bilibili*)
 *   và KHÔNG thuộc danh sách loại trừ cứng (`Phim AI`, `giờ`, `tiếng`, `tập 1`, `trọn bộ`, `tổng hợp`, `review`, `tóm tắt`...).
 * - Tra cứu Google xem tác phẩm có thực sự là Anime Movie / Phim điện ảnh từng công chiếu tại rạp (Theatrical Release)
 *   kèm tên gốc tiếng Anh/Nhật và năm công chiếu rạp hay không.
 */
export async function verifyTheatricalReleaseWithGoogleSearch(
  video: MultimodalVideoInput,
  detectedGenre: PrimaryGenreTag = 'HH2D',
): Promise<TheatricalVerificationResult> {
  if (
    detectedGenre === 'Phim AI' ||
    isHardExcludedFromTheatrical({
      title: video.title,
      series_name: video.series_name,
      detected_genre: detectedGenre,
    }) ||
    !isPotentialTheatricalCandidate({
      title: video.title,
      channel_title: video.channel_title,
      series_name: video.series_name,
      detected_genre: detectedGenre,
    })
  ) {
    return {
      isTheatricalMovie: false,
      originalTitle: null,
      releaseYear: null,
    };
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return {
      isTheatricalMovie: false,
      originalTitle: null,
      releaseYear: null,
    };
  }

  const ai = getGeminiClient();
  const prompt = `Hãy sử dụng công cụ Google Search để tra cứu thông tin thực tế về video sau:
- Tiêu đề video YouTube: "${video.title}"
- Kênh đăng tải: "${video.channel_title || 'Không rõ'}"
- Mô tả ngắn: "${(video.description || '').slice(0, 300)}"

Nhiệm vụ kiểm chứng nghiêm ngặt:
1. Tra cứu trên Google xem tác phẩm trong video này có phải là một bộ **Anime Movie / Phim hoạt hình điện ảnh đã từng phát hành chiếu rạp chính thức (Theatrical Release)** hay không.
2. Kiểm tra xem tác phẩm có thuộc thể loại **Kinh dị / Máu me (Horror / Gore / Supernatural Horror)** hay không ("isHorrorOrGore": boolean).
3. Tìm chính xác tên tiếng Anh hoặc tiếng Nhật gốc của bản Movie điện ảnh đó (originalTitle) và năm công chiếu tại rạp (releaseYear).
4. Nếu đây chỉ là TV Series nhiều tập, Web Drama, Hoạt hình 3D/AI, OVA, ONA, Special, hoặc video ghép/tổng hợp nhiều tập phim truyền hình thì BẮT BUỘC đặt "isTheatricalMovie": false.

Trả về DUY NHẤT 1 đối tượng JSON hợp lệ theo định dạng sau (không thêm markdown hay giải thích ngoài JSON):
{"isTheatricalMovie": boolean, "isHorrorOrGore": boolean, "originalTitle": string | null, "releaseYear": number | null}`;

  for (const modelName of GEMINI_VISION_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.1,
          abortSignal: AbortSignal.timeout(4500),
        },
      });

      const raw = response.text?.trim() || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]) as {
        isTheatricalMovie?: boolean;
        isHorrorOrGore?: boolean;
        originalTitle?: string | null;
        releaseYear?: number | null;
      };

      const year =
        typeof parsed.releaseYear === 'number' &&
        parsed.releaseYear >= 1970 &&
        parsed.releaseYear <= 2028
          ? Math.floor(parsed.releaseYear)
          : null;
      const origTitle =
        typeof parsed.originalTitle === 'string' &&
        parsed.originalTitle.trim().length >= 2
          ? parsed.originalTitle.trim()
          : null;

      const verified =
        parsed.isTheatricalMovie === true &&
        parsed.isHorrorOrGore !== true &&
        origTitle !== null &&
        year !== null;

      console.log(
        `[Google Search Grounding] (${modelName}) "${video.title}" -> isTheatricalMovie=${verified} (Original: ${origTitle ?? 'N/A'}, Year: ${year ?? 'N/A'})`,
      );

      return {
        isTheatricalMovie: verified,
        originalTitle: verified ? origTitle : null,
        releaseYear: verified ? year : null,
      };
    } catch (err) {
      if (isRetryableGeminiModelError(err)) {
        continue;
      }
      break;
    }
  }

  return {
    isTheatricalMovie: false,
    originalTitle: null,
    releaseYear: null,
  };
}

export interface BatchClassificationOutcome {
  results: Map<string, MultimodalClassificationResult>;
  geminiSuccessCount: number;
  geminiErrorCount: number;
  seriesTotalCount: number;
  seriesScannedCount: number;
  lastErrorMessage: string | null;
}

type ContentPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } };

const MULTIMODAL_SYSTEM_INSTRUCTION = `Bạn là chuyên gia thị giác máy tính (Multimodal Vision) & phân loại phim hoạt hình YouTube Việt Nam cho nền tảng AniSub (Hệ thống Phân loại Chuẩn xác 3 Tầng).

Tiêu chí nhận diện BẮT BUỘC theo thứ tự ưu tiên (3 nhãn: "Phim AI" | "HH2D" | "2D"):
1. "Phim AI" (Ưu tiên kiểm tra trước):
   - Đồ họa tả thực / 3D AI rendering (Midjourney, Kling, Flux, Hailuo, Vidu, Sora...), ánh sáng volumetric/cinematic, da và tóc khối mịn, KHÔNG nét viền mực đen.
   - Hoặc video truyện tranh AI / audio drama AI / recap AI (mô-típ truyện hệ thống, xuyên không đô thị, tổng tài, trọng sinh báo thù, mạt thế, thời lượng tổng hợp dài > 45 phút, kênh dạng "Bản Tin...", "Trùm Phim...", "Review Phim...").

2. "HH2D" (Hoạt hình 3D Trung Quốc / Donghua & Manhua thuyết minh):
   - Các tác phẩm Donghua / Hoạt hình 3D Trung Quốc (Tiên Nghịch, Đấu Phá Thương Khung, Phàm Nhân Tu Tiên, Thế Giới Hoàn Mỹ, Thôn Phệ Tinh Không, Đấu La Đại Lục, Tru Tiên, Già Thiên, Mục Thần Ký, Kiếm Lai...) hoặc Manhua/Motion Comic Trung Quốc.

3. "2D" (Anime Nhật Bản / Hoạt hình 2D truyền thống):
   - Anime Nhật Bản 2D (One Piece, Naruto, Conan, Doraemon, Kimetsu no Yaiba, Jujutsu Kaisen, Frieren, Solo Leveling, Ghibli, Muse Việt Nam, Ani-One Vietnam, POPS Anime...) hoặc hoạt hình 2D cel-shading có đường viền lineart rõ ràng.

Quy tắc đầu ra:
- Mỗi video trong batch là 1 tập đại diện cho cả bộ phim (Series).
- Trả về ĐÚNG 1 phần tử JSON cho mỗi videoId trong batch.
- Chỉ được chọn \`detectedGenre\` nằm trong danh sách \`allowedTags\` được cung cấp ("Phim AI", "HH2D", hoặc "2D").
- Trích xuất \`seriesName\` (tên bộ phim sạch, bỏ số tập và tên kênh), \`episodeNumber\` (số nguyên hoặc null), và cờ \`isMovie\` (true nếu là bản điện ảnh chiếu rạp, ngược lại false).`;

/**
 * Tầng 2 — Bộ quy tắc nhận diện cứng theo thứ tự ưu tiên cho tab "Đã đăng ký" (`Phim AI` -> `HH2D` -> `2D`):
 * Trả về nhãn chuẩn xác ngay lập tức (0ms, không đoán mò) nếu khớp tín hiệu đặc trưng mạnh.
 */
const PHIM_AI_CHANNEL_RE =
  /\b(bản\s*tin|ban\s*tin|trùm\s*phim|trum\s*phim|review\s*phim|tóm\s*tắt\s*phim|tom\s*tat\s*phim|truyện\s*tranh\s*ai|phim\s*ai|ai\s*movie|ai\s*cinema|góc\s*review|kể\s*chuyện\s*ai)\b/i;

const PHIM_AI_MOTIF_RE =
  /\b(phim\s*ai|3d\s*ai|ai\s*3d|truyện\s*hệ\s*thống|truyen\s*he\s*thong|hệ\s*thống\s*báo\s*thù|xuyên\s*không\s*đô\s*thị|xuyen\s*khong\s*do\s*thi|tổng\s*tài|tong\s*tai|trọng\s*sinh\s*báo\s*thù|trong\s*sinh\s*bao\s*thu|phế\s*vật\s*nghịch\s*tập|ngược\s*tra|tài\s*phiệt|mạt\s*thế\s*trọng\s*sinh|truyện\s*tranh\s*thuyết\s*minh|audio\s*truyện|recap\s*ai|review\s*truyện)\b/i;

const DONGHUA_HH2D_RE =
  /\b(tiên\s*nghịch|tien\s*nghich|đấu\s*phá\s*thương\s*khung|dau\s*pha\s*thuong\s*khung|phàm\s*nhân\s*tu\s*tiên|pham\s*nhan\s*tu\s*tien|thế\s*giới\s*hoàn\s*mỹ|the\s*gioi\s*hoan\s*my|thôn\s*phệ\s*tinh\s*không|thon\s*phe\s*tinh\s*khong|đấu\s*la\s*đại\s*lục|dau\s*la\s*dai\s*luc|tru\s*tiên|tru\s*tien|già\s*thiên|gia\s*thien|mục\s*thần\s*ký|muc\s*than\s*ky|kiếm\s*lai|kiem\s*lai|nhất\s*niệm\s*vĩnh\s*hằng|nhat\s*niem\s*vinh\s*hang|thần\s*ấn\s*vương\s*tọa|than\s*an\s*vuong\s*toa|bách\s*luyện\s*thành\s*thần|luyện\s*khí\s*mười\s*vạn\s*năm|nghịch\s*thiên\s*chí\s*tôn|võ\s*thần\s*chúa\s*tể|tinh\s*thần\s*biến|yêu\s*thần\s*ký|vạn\s*giới\s*độc\s*tôn|linh\s*kiếm\s*tôn|độc\s*bộ\s*tiêu\s*dao|sư\s*huynh\s*a\s*sư\s*huynh|đại\s*chúa\s*tể|thương\s*nguyên\s*đồ|trường\s*sinh\s*giới|donghua|hh3d|hoạt\s*hình\s*3d\s*trung\s*quốc|hoạt\s*hình\s*trung\s*quốc|hh2d)\b/i;

const ANIME_2D_CHANNEL_RE =
  /\b(muse\s*việt\s*nam|muse\s*viet\s*nam|muse\s*asia|ani-one|anione|pops\s*anime|tropics\s*anime|crunchyroll)\b/i;

const ANIME_2D_TITLES_RE =
  /\b(one\s*piece|vua\s*hải\s*tặc|naruto|boruto|bleach|dragon\s*ball|bảy\s*viên\s*ngọc\s*rồng|conan|thám\s*tử\s*lừng\s*danh|doraemon|kimetsu\s*no\s*yaiba|thanh\s*gươm\s*diệt\s*quỷ|demon\s*slayer|jujutsu\s*kaisen|chú\s*thuật\s*hồi\s*chiến|attack\s*on\s*titan|solo\s*leveling|frieren|blue\s*lock|spy\s*x\s*family|chainsaw\s*man|my\s*hero\s*academia|hunter\s*x\s*hunter|ghibli|pokémon|pokemon|digimon|gundam|evangelion|shinchan|crayon\s*shin|black\s*clover|fairy\s*tail|mushoku\s*tensei|re:zero|overlord|sword\s*art\s*online|danmachi|anime\s*vietsub|anime\s*thuyết\s*minh|hoạt\s*hình\s*nhật\s*bản)\b/i;

export function classifyByGroundedRules(
  video: MultimodalVideoInput,
  allowedTags: PrimaryGenreTag[],
): PrimaryGenreTag | null {
  const title = video.title || '';
  const channel = video.channel_title || '';
  const desc = (video.description || '').slice(0, 400);
  const hay = `${title} ${desc}`;

  // 1. Ưu tiên 1: Nhận diện Phim AI
  if (allowedTags.includes('Phim AI')) {
    const isAiChannel = PHIM_AI_CHANNEL_RE.test(channel);
    const hasAiMotif = PHIM_AI_MOTIF_RE.test(hay);
    const isLongSummaryMotif =
      video.duration_seconds > 2700 &&
      /\b(hệ\s*thống|xuyên\s*không|trọng\s*sinh|tổng\s*tài|báo\s*thù|đô\s*thị|mạt\s*thế|full\s*truyện|trọn\s*bộ\s*truyện)\b/i.test(
        hay,
      );
    if (isAiChannel || hasAiMotif || isLongSummaryMotif) {
      return 'Phim AI';
    }
  }

  // 2. Ưu tiên 2: Nhận diện HH2D (Hoạt hình 2D / Anime Nhật Bản & Donghua Trung Quốc)
  if (allowedTags.includes('HH2D')) {
    if (
      DONGHUA_HH2D_RE.test(hay) ||
      /\b(hh3d|donghua)\b/i.test(channel) ||
      ANIME_2D_CHANNEL_RE.test(channel) ||
      ANIME_2D_TITLES_RE.test(hay)
    ) {
      return 'HH2D';
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown Gemini API error';
  }
}

/**
 * Tải thumbnail rõ nét vừa đủ (`hqdefault.jpg` 480x360 -> fallback `mqdefault.jpg`)
 * để Gemini Vision nhìn rõ đường viền lineart 2D vs độ khối da/tóc 3D AI.
 */
async function fetchCompactThumbnailAsInlineData(
  video: MultimodalVideoInput,
): Promise<{ inlineData: { data: string; mimeType: string } } | null> {
  const candidateUrls = [
    `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${video.video_id}/mqdefault.jpg`,
    video.vision_thumbnail_url,
    video.thumbnail_url,
  ].filter((u): u is string => Boolean(u));

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      });
      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength === 0) continue;

      return {
        inlineData: {
          data: Buffer.from(buffer).toString('base64'),
          mimeType,
        },
      };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Gọi Gemini Vision cho 1 batch nhỏ (tối đa 4 series đại diện / request)
 * kèm cơ chế xoay vòng 3 model dự phòng nếu gặp 429 hoặc 404.
 */
async function classifyChunkWithModelRotation(
  chunk: MultimodalVideoInput[],
  allowedTags: PrimaryGenreTag[],
): Promise<{
  map: Map<string, MultimodalClassificationResult>;
  succeeded: boolean;
  errorMessage: string | null;
}> {
  const chunkMap = new Map<string, MultimodalClassificationResult>();
  const defaultTag: PrimaryGenreTag = allowedTags[0] ?? 'HH2D';

  const thumbnails = await Promise.all(
    chunk.map((v) => fetchCompactThumbnailAsInlineData(v)),
  );

  const contents: ContentPart[] = [
    {
      text: `Phân loại ${chunk.length} bộ phim đại diện sau đây vào ĐÚNG 1 thể loại trong danh sách: ${JSON.stringify(allowedTags)}. Quan sát trực tiếp ảnh thumbnail hqdefault.jpg đi kèm: Phim AI (đồ họa tả thực/3D AI rendering, ánh sáng volumetric/cinematic, da tóc khối mịn, KHÔNG nét viền mực đen) vs HH2D (tranh vẽ 2D Manhua/Motion Comic/Anime 2D, tô màu mảng phẳng cel-shading, CÓ đường viền nét vẽ lineart rõ ràng).`,
    },
  ];

  chunk.forEach((video, idx) => {
    const imagePart = thumbnails[idx];
    const tagsStr = (video.tags ?? []).slice(0, 12).join(', ') || '(không có)';
    const descStr = (video.description ?? '').slice(0, 220) || '(không có)';

    contents.push({
      text: `--- SERIES REPRESENTATIVE ${idx + 1} ---
Video ID: ${video.video_id}
Title: ${video.title}
Tags: ${tagsStr}
Description: ${descStr}
Allowed Tags: ${JSON.stringify(allowedTags)}
Thumbnail attached: ${imagePart ? 'YES' : 'NO'}`,
    });

    if (imagePart) {
      contents.push(imagePart);
    }
  });

  const batchSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        videoId: { type: Type.STRING },
        detectedGenre: {
          type: Type.STRING,
          enum: allowedTags,
        },
        seriesName: {
          type: Type.STRING,
          nullable: true,
        },
        episodeNumber: {
          type: Type.INTEGER,
          nullable: true,
        },
        isMovie: {
          type: Type.BOOLEAN,
          nullable: true,
        },
        confidence: {
          type: Type.NUMBER,
        },
      },
      required: [
        'videoId',
        'detectedGenre',
        'seriesName',
        'episodeNumber',
        'isMovie',
        'confidence',
      ],
    },
  };

  const ai = getGeminiClient();
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < GEMINI_VISION_MODELS.length; mIdx++) {
    const modelName = GEMINI_VISION_MODELS[mIdx];

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction: MULTIMODAL_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: batchSchema,
          temperature: 0.1,
        },
      });

      const raw = response.text?.trim();
      if (!raw) {
        throw new Error(`Model ${modelName} trả về phản hồi rỗng.`);
      }

      const parsed = JSON.parse(raw) as Array<{
        videoId: string;
        detectedGenre: PrimaryGenreTag;
        seriesName: string | null;
        episodeNumber: number | null;
        isMovie?: boolean | null;
        confidence: number;
      }>;

      if (!Array.isArray(parsed)) {
        throw new Error(`Model ${modelName} không trả về mảng JSON hợp lệ.`);
      }

      for (const item of parsed) {
        if (item.videoId && allowedTags.includes(item.detectedGenre)) {
          chunkMap.set(item.videoId, {
            videoId: item.videoId,
            detectedGenre: item.detectedGenre,
            seriesName: item.seriesName?.trim() || null,
            episodeNumber:
              typeof item.episodeNumber === 'number'
                ? Math.floor(item.episodeNumber)
                : null,
            isMovie: false,
            confidence:
              typeof item.confidence === 'number'
                ? Math.max(0, Math.min(1, item.confidence))
                : 0.85,
            source: 'gemini',
          });
        }
      }

      // Chỉ kích hoạt xác minh Google Search Grounding với các ứng viên có dấu hiệu Bản Điện Ảnh thực thụ
      for (const video of chunk) {
        if (!chunkMap.has(video.video_id)) {
          chunkMap.set(video.video_id, {
            videoId: video.video_id,
            detectedGenre: defaultTag,
            seriesName: null,
            episodeNumber: null,
            isMovie: false,
            confidence: 0.4,
            source: 'fallback',
          });
        }

        const res = chunkMap.get(video.video_id)!;
        if (
          res.detectedGenre !== 'Phim AI' &&
          isPotentialTheatricalCandidate({
            title: video.title,
            channel_title: video.channel_title,
            series_name: res.seriesName ?? video.series_name,
            detected_genre: res.detectedGenre,
            episode_number: res.episodeNumber,
          })
        ) {
          const verified = await verifyTheatricalReleaseWithGoogleSearch(
            video,
            res.detectedGenre,
          );
          res.isMovie = verified.isTheatricalMovie;
        }
      }

      chunk.forEach((video, idx) => {
        const res = chunkMap.get(video.video_id)!;
        console.log(
          `[AI Classifier] (${modelName}) Series Rep: ${video.title} | Allowed: ${allowedTags.join(', ')} | Thumbnail loaded: ${Boolean(thumbnails[idx])} -> Result: ${res.detectedGenre}${res.isMovie ? ' [VERIFIED CHIẾU RẠP]' : ''}`,
        );
      });

      return { map: chunkMap, succeeded: true, errorMessage: null };
    } catch (err) {
      lastError = err;
      const status = getGeminiErrorStatus(err);
      console.error(`[AI Classifier ERROR] (${modelName}):`, err);

      if (
        isRetryableGeminiModelError(err) &&
        mIdx < GEMINI_VISION_MODELS.length - 1
      ) {
        const nextModel = GEMINI_VISION_MODELS[mIdx + 1];
        console.warn(
          `[AI Classifier] Model ${modelName} trả lỗi ${status ?? 'quá tải/không khả dụng'} (404/503/429), tự động chuyển ngay sang model dự phòng ${nextModel}...`,
        );
        continue;
      }

      break;
    }
  }

  const errMsg = extractErrorMessage(lastError);
  for (const video of chunk) {
    chunkMap.set(video.video_id, {
      videoId: video.video_id,
      detectedGenre: defaultTag,
      seriesName: null,
      episodeNumber: null,
      isMovie: false,
      confidence: 0,
      source: 'fallback',
    });
  }

  return { map: chunkMap, succeeded: false, errorMessage: errMsg };
}

/**
 * Series-Aware Gemini Vision Batching:
 * - Kênh chỉ bật 1 tag -> gán thẳng (0 API call, trừ khi video là ứng viên Bản Điện Ảnh cần xác minh Google Search Grounding).
 * - Kênh bật >= 2 tag -> gom nhóm theo `seriesKey`, chỉ gửi ĐÚNG 1 video đại diện
 *   mỗi bộ phim (4 series / batch, xoay vòng 3 model dự phòng) rồi lan truyền kết quả
 *   cho toàn bộ các tập cùng bộ.
 */
export async function classifyVideosMultimodalBatch(
  videos: MultimodalVideoInput[],
  allowedTags: PrimaryGenreTag[],
): Promise<BatchClassificationOutcome> {
  const results = new Map<string, MultimodalClassificationResult>();
  if (videos.length === 0 || allowedTags.length === 0) {
    return {
      results,
      geminiSuccessCount: 0,
      geminiErrorCount: 0,
      seriesTotalCount: 0,
      seriesScannedCount: 0,
      lastErrorMessage: null,
    };
  }

  // Kênh chỉ bật 1 tag -> gán cố định thể loại, chỉ kiểm tra Google Search Grounding nếu có ứng viên Bản Điện Ảnh
  if (allowedTags.length === 1) {
    const fixedTag = allowedTags[0];
    for (const v of videos) {
      const parsedEp = parseEpisodeInfo(v.title, null).episodeStart;
      let isVerifiedMovie = false;
      if (
        fixedTag !== 'Phim AI' &&
        isPotentialTheatricalCandidate({
          title: v.title,
          channel_title: v.channel_title,
          series_name: v.series_name,
          detected_genre: fixedTag,
          episode_number: parsedEp,
        })
      ) {
        const verified = await verifyTheatricalReleaseWithGoogleSearch(
          v,
          fixedTag,
        );
        isVerifiedMovie = verified.isTheatricalMovie;
      }

      const baseSeries =
        v.series_name ??
        extractSeriesInfo({
          videoId: v.video_id,
          channelId: v.channel_id ?? 'default',
          title: v.title,
          channelTitle: v.channel_title,
          seriesName: v.series_name,
        }).seriesTitle;

      const finalSeriesName =
        isVerifiedMovie &&
        baseSeries &&
        !baseSeries.includes(VERIFIED_THEATRICAL_TAG)
          ? `${baseSeries} ${VERIFIED_THEATRICAL_TAG}`
          : v.series_name ?? null;

      results.set(v.video_id, {
        videoId: v.video_id,
        detectedGenre: fixedTag,
        seriesName: finalSeriesName,
        episodeNumber: parsedEp,
        isMovie: isVerifiedMovie,
        confidence: 1,
        source: 'fixed',
      });
    }
    return {
      results,
      geminiSuccessCount: 0,
      geminiErrorCount: 0,
      seriesTotalCount: 0,
      seriesScannedCount: 0,
      lastErrorMessage: null,
    };
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  // Gom nhóm các video theo seriesKey -> chọn đúng 1 video đại diện mỗi bộ phim
  const seriesGroups = new Map<
    string,
    {
      representative: MultimodalVideoInput;
      seriesTitle: string;
      members: MultimodalVideoInput[];
    }
  >();

  for (const video of videos) {
    const info = extractSeriesInfo({
      videoId: video.video_id,
      channelId: video.channel_id ?? 'default',
      title: video.title,
      channelTitle: video.channel_title,
      seriesName: video.series_name,
    });

    const existing = seriesGroups.get(info.seriesKey);
    if (existing) {
      existing.members.push(video);
      // Ưu tiên chọn đại diện có sẵn thumbnail_url
      if (!existing.representative.thumbnail_url && video.thumbnail_url) {
        existing.representative = video;
      }
    } else {
      seriesGroups.set(info.seriesKey, {
        representative: video,
        seriesTitle: info.seriesTitle,
        members: [video],
      });
    }
  }

  const groupList = Array.from(seriesGroups.values());
  const groupByRepId = new Map(
    groupList.map((g) => [g.representative.video_id, g]),
  );

  // Tầng 2: Chạy bộ quy tắc nhận diện cứng theo thứ tự ưu tiên (`Phim AI` -> `HH2D` -> `2D`) trước khi gọi Gemini Vision
  const representativesNeedingVision: MultimodalVideoInput[] = [];
  let groundedRuleCount = 0;

  for (const group of groupList) {
    const ruleGenre = classifyByGroundedRules(group.representative, allowedTags);
    if (ruleGenre) {
      groundedRuleCount += 1;
      for (const member of group.members) {
        results.set(member.video_id, {
          videoId: member.video_id,
          detectedGenre: ruleGenre,
          seriesName: member.series_name ?? group.seriesTitle,
          episodeNumber: parseEpisodeInfo(member.title, null).episodeStart,
          isMovie: false,
          confidence: 0.95,
          source: 'fixed',
        });
      }
    } else {
      representativesNeedingVision.push(group.representative);
    }
  }

  const representatives = representativesNeedingVision;

  console.log(
    `[AI Classifier] Tầng 2 Grounded Rules + Series-Aware Batching: ${videos.length} video -> ${groupList.length} series (${groundedRuleCount} khớp quy tắc cứng 0ms, ${representatives.length} cần Gemini Vision).`,
  );

  let geminiSuccessCount = 0;
  let geminiErrorCount = 0;
  let seriesScannedCount = 0;
  let lastErrorMessage: string | null = null;

  for (let i = 0; i < representatives.length; i += BATCH_CHUNK_SIZE) {
    if (i > 0) {
      await sleep(INTER_CHUNK_DELAY_MS);
    }

    const chunk = representatives.slice(i, i + BATCH_CHUNK_SIZE);
    const outcome = await classifyChunkWithModelRotation(chunk, allowedTags);

    for (const rep of chunk) {
      const repRes = outcome.map.get(rep.video_id);
      const group = groupByRepId.get(rep.video_id);
      if (!repRes || !group) continue;

      for (const member of group.members) {
        const isRep = member.video_id === rep.video_id;
        const parsedEp = parseEpisodeInfo(member.title, null).episodeStart;
        const memberIsMovie =
          repRes.detectedGenre !== 'Phim AI' &&
          Boolean(repRes.isMovie) &&
          !isHardExcludedFromTheatrical({
            title: member.title,
            series_name: member.series_name,
            detected_genre: repRes.detectedGenre,
            episode_number: parsedEp,
          });
        const baseSeriesName = (
          repRes.seriesName ||
          member.series_name ||
          group.seriesTitle ||
          ''
        )
          .replace(/\s*\(Chiếu Rạp\)\s*/gi, ' ')
          .replace(/\s*\[CHIẾU RẠP\]\s*/gi, ' ')
          .trim();

        const enrichedSeriesName =
          memberIsMovie && baseSeriesName
            ? `${baseSeriesName} ${VERIFIED_THEATRICAL_TAG}`
            : baseSeriesName || null;

        results.set(member.video_id, {
          videoId: member.video_id,
          detectedGenre: repRes.detectedGenre,
          seriesName: enrichedSeriesName,
          episodeNumber: isRep
            ? (repRes.episodeNumber ?? parsedEp)
            : parsedEp,
          isMovie: memberIsMovie,
          confidence: repRes.confidence,
          source: repRes.source,
        });
      }

      if (outcome.succeeded && repRes.source === 'gemini') {
        seriesScannedCount += 1;
        geminiSuccessCount += group.members.length;
      } else {
        geminiErrorCount += group.members.length;
      }
    }

    if (!outcome.succeeded && outcome.errorMessage) {
      lastErrorMessage = outcome.errorMessage;
    }
  }

  return {
    results,
    geminiSuccessCount,
    geminiErrorCount,
    seriesTotalCount: groupList.length,
    seriesScannedCount,
    lastErrorMessage,
  };
}

export const GEMINI_SUMMARY_MODEL = GEMINI_PRIMARY_MODEL;

/**
 * Tạo 3 gạch đầu dòng tóm tắt nội dung ngắn gọn, KHÔNG spoil cái kết
 * (dùng callGeminiWithFallback: ưu tiên gemini-2.5-flash -> gemini-3.5-flash-lite -> gemini-3.8-flash).
 */
export async function generateVideoSummaryWithGemini(input: {
  title: string;
  description: string | null;
  detectedGenre: string | null;
  durationSeconds: number;
}): Promise<string> {
  const prompt = `Bạn là biên tập viên rạp chiếu phim AniSub. Hãy viết tóm tắt nhanh cho video sau bằng tiếng Việt gồm ĐÚNG 3 gạch đầu dòng ngắn gọn (mỗi dòng bắt đầu bằng "- "), hấp dẫn và TUYỆT ĐỐI KHÔNG tiết lộ cái kết (no spoiler).

- Tiêu đề: ${input.title}
- Thể loại: ${input.detectedGenre ?? 'Hoạt hình'}
- Thời lượng: ${Math.round(input.durationSeconds / 60)} phút
- Mô tả gốc: ${(input.description ?? 'Không có mô tả chi tiết').slice(0, 1200)}

Chỉ trả về đúng 3 dòng bắt đầu bằng "- ", không thêm lời mở đầu hay kết luận.`;

  const { text } = await callGeminiWithFallback({
    contents: prompt,
    config: {
      temperature: 0.4,
    },
  });

  return text;
}
