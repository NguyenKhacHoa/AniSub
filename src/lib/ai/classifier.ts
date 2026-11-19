import { Type, type Schema } from '@google/genai';
import { getGeminiClient } from '@/lib/gemini/client';
import { extractSeriesInfo, parseEpisodeInfo } from '@/lib/series-parser';
import type { PrimaryGenreTag } from '@/types/workspace';

export const GEMINI_VISION_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
] as const;

const BATCH_CHUNK_SIZE = 4;
const INTER_CHUNK_DELAY_MS = 2000;
const RETRY_429_DELAY_MS = 8000;

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
  confidence: number;
  source: 'fixed' | 'gemini' | 'fallback';
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

const MULTIMODAL_SYSTEM_INSTRUCTION = `Bạn là chuyên gia thị giác máy tính (Multimodal Vision) phân loại video hoạt hình/phim thuyết minh Việt Nam trên YouTube cho nền tảng AniSub.

QUAN TRỌNG NHẤT: HÃY QUAN SÁT TRỰC TIẾP ĐỒ HỌA, NÉT VẼ VÀ ÁNH SÁNG TRÊN ẢNH THUMBNAIL (hqdefault.jpg) để phân biệt tuyệt đối chính xác giữa "Phim AI" và "HH2D". KHÔNG đoán mò theo từ khóa cốt truyện (như "tu tiên", "trọng sinh", "xuyên không", "thuyết minh", tên chữ Hán...) vì cả hai thể loại đều dùng chung các cụm từ này.

Tiêu chí nhận diện thị giác BẮT BUỘC (2 thể loại duy nhất):
1. "Phim AI":
   - Đồ họa tả thực, 3D AI rendering (Midjourney, Kling, Flux, Hailuo, Vidu, Sora...).
   - Ánh sáng volumetric / cinematic có chiều sâu, đổ bóng mềm tự nhiên.
   - Khuôn mặt, làn da và mái tóc có độ khối mịn tả thực (hoặc bán tả thực 3D).
   - KHÔNG có nét viền mực đen kiểu vẽ tay (no ink outlines / no comic lineart).

2. "HH2D":
   - Tranh vẽ 2D Manhua / Manhwa / Motion Comic / Anime 2D.
   - Tô màu mảng phẳng (flat shading / cel-shading), nét mắt và biểu cảm cách điệu 2D.
   - CÓ đường viền nét vẽ (lineart) màu đen hoặc sẫm màu rõ ràng bao quanh nhân vật, mái tóc, trang phục và bối cảnh truyện tranh.

Quy tắc đầu ra:
- Mỗi video trong batch là 1 tập đại diện cho cả bộ phim (Series).
- Trả về ĐÚNG 1 phần tử JSON cho mỗi videoId trong batch.
- Chỉ được chọn \`detectedGenre\` nằm trong danh sách \`allowedTags\` được cung cấp ("Phim AI" hoặc "HH2D").
- Trích xuất \`seriesName\` (tên bộ phim sạch, bỏ số tập và tên kênh) và \`episodeNumber\` (số nguyên hoặc null).`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.message === 'string') {
    if (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED')) {
      return 429;
    }
    if (e.message.includes('404') || e.message.includes('NOT_FOUND')) {
      return 404;
    }
  }
  return null;
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
        confidence: {
          type: Type.NUMBER,
        },
      },
      required: [
        'videoId',
        'detectedGenre',
        'seriesName',
        'episodeNumber',
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
            confidence:
              typeof item.confidence === 'number'
                ? Math.max(0, Math.min(1, item.confidence))
                : 0.85,
            source: 'gemini',
          });
        }
      }

      chunk.forEach((video, idx) => {
        if (!chunkMap.has(video.video_id)) {
          chunkMap.set(video.video_id, {
            videoId: video.video_id,
            detectedGenre: defaultTag,
            seriesName: null,
            episodeNumber: null,
            confidence: 0.4,
            source: 'fallback',
          });
        }
        const res = chunkMap.get(video.video_id)!;
        console.log(
          `[AI Classifier] (${modelName}) Series Rep: ${video.title} | Allowed: ${allowedTags.join(', ')} | Thumbnail loaded: ${Boolean(thumbnails[idx])} -> Result: ${res.detectedGenre}`,
        );
      });

      return { map: chunkMap, succeeded: true, errorMessage: null };
    } catch (err) {
      lastError = err;
      const status = getErrorStatus(err);
      console.error(`[AI Classifier ERROR] (${modelName}):`, err);

      if (
        (status === 429 || status === 404) &&
        mIdx < GEMINI_VISION_MODELS.length - 1
      ) {
        if (status === 429) {
          console.warn(
            `[AI Classifier] Model ${modelName} bị 429, chờ ${RETRY_429_DELAY_MS / 1000}s rồi xoay sang ${GEMINI_VISION_MODELS[mIdx + 1]}...`,
          );
          await sleep(RETRY_429_DELAY_MS);
        } else {
          console.warn(
            `[AI Classifier] Model ${modelName} trả 404, xoay ngay sang ${GEMINI_VISION_MODELS[mIdx + 1]}...`,
          );
        }
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
      confidence: 0,
      source: 'fallback',
    });
  }

  return { map: chunkMap, succeeded: false, errorMessage: errMsg };
}

/**
 * Series-Aware Gemini Vision Batching:
 * - Kênh chỉ bật 1 tag -> gán thẳng (0 API call).
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

  // Kênh chỉ bật 1 tag -> gán cố định (0 API call)
  if (allowedTags.length === 1) {
    const fixedTag = allowedTags[0];
    for (const v of videos) {
      results.set(v.video_id, {
        videoId: v.video_id,
        detectedGenre: fixedTag,
        seriesName: v.series_name ?? null,
        episodeNumber: parseEpisodeInfo(v.title, null).episodeStart,
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
  const representatives = groupList.map((g) => g.representative);
  const groupByRepId = new Map(
    groupList.map((g) => [g.representative.video_id, g]),
  );

  console.log(
    `[AI Classifier] Series-Aware Batching: ${videos.length} video -> gom còn ${representatives.length} bộ phim đại diện (tiết kiệm ${videos.length - representatives.length} lượt gọi Vision).`,
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
        results.set(member.video_id, {
          videoId: member.video_id,
          detectedGenre: repRes.detectedGenre,
          seriesName:
            repRes.seriesName || member.series_name || group.seriesTitle || null,
          episodeNumber: isRep
            ? (repRes.episodeNumber ?? parsedEp)
            : parsedEp,
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
