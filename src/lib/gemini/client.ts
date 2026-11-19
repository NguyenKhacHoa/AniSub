import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';

/**
 * Model mặc định mới nhất trên endpoint `v1beta` cho toàn bộ hệ thống AniSub.
 */
export const GEMINI_PRIMARY_MODEL = 'gemini-3.8-flash' as const;

/**
 * Chuỗi model ưu tiên & dự phòng tự động:
 * Ưu tiên `gemini-3.8-flash`, nếu gặp 404/NOT_FOUND hoặc 429 tự động chuyển sang `gemini-2.5-flash` -> `gemini-2.5-flash-lite`.
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;

export const GEMINI_CLASSIFICATION_MODEL = GEMINI_PRIMARY_MODEL;
export const GEMINI_SUMMARY_MODEL = GEMINI_PRIMARY_MODEL;

let geminiClientInstance: GoogleGenAI | null = null;

/**
 * Khởi tạo và trả về singleton client của `@google/genai` trên `v1beta`.
 * Chỉ được phép chạy ở phía Server (dùng `GEMINI_API_KEY`).
 */
export function getGeminiClient(): GoogleGenAI {
  if (typeof window !== 'undefined') {
    throw new Error('getGeminiClient() chỉ được phép chạy ở phía Server.');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu GEMINI_API_KEY trong biến môi trường.');
  }

  if (!geminiClientInstance) {
    geminiClientInstance = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
    });
  }

  return geminiClientInstance;
}

export function getGeminiErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.message === 'string') {
    const upper = e.message.toUpperCase();
    if (upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED')) {
      return 429;
    }
    if (upper.includes('404') || upper.includes('NOT_FOUND')) {
      return 404;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CallGeminiWithFallbackOptions {
  contents: GenerateContentParameters['contents'];
  config?: GenerateContentParameters['config'];
  models?: readonly string[];
  retry429DelayMs?: number;
}

/**
 * Helper dùng chung gọi Gemini `generateContent` trên `v1beta`:
 * - Ưu tiên `models/gemini-3.8-flash:generateContent`.
 * - Tự động fallback ngay lập tức sang `models/gemini-2.5-flash:generateContent`
 *   khi gặp 404 / NOT_FOUND (hoặc 429) để ứng dụng không bao giờ bị gián đoạn.
 */
export async function callGeminiWithFallback(
  options: CallGeminiWithFallbackOptions,
): Promise<{ text: string; model: string }> {
  const ai = getGeminiClient();
  const models =
    options.models && options.models.length > 0
      ? options.models
      : GEMINI_FALLBACK_MODELS;
  const retry429DelayMs = options.retry429DelayMs ?? 0;

  let lastError: unknown = null;

  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: options.contents,
        config: options.config,
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error(`Model ${modelName} trả về phản hồi rỗng.`);
      }

      return { text, model: modelName };
    } catch (err) {
      lastError = err;
      const status = getGeminiErrorStatus(err);
      const hasNext = i < models.length - 1;

      if (hasNext && (status === 404 || status === 429)) {
        if (status === 429 && retry429DelayMs > 0) {
          console.warn(
            `[Gemini Fallback] Model ${modelName} bị 429, chờ ${retry429DelayMs / 1000}s rồi xoay sang ${models[i + 1]}...`,
          );
          await sleep(retry429DelayMs);
        } else {
          console.warn(
            `[Gemini Fallback] Model ${modelName} trả ${status} (NOT_FOUND/429), tự động chuyển sang ${models[i + 1]}...`,
          );
        }
        continue;
      }

      break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Không thể nhận phản hồi từ Gemini API.');
}
