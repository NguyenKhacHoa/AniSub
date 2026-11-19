import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';

/**
 * Model mặc định ổn định nhất trên endpoint `v1beta` cho toàn bộ hệ thống AniSub.
 */
export const GEMINI_PRIMARY_MODEL = 'gemini-2.5-flash' as const;

/**
 * Chuỗi model ưu tiên & dự phòng tự động:
 * 1. `gemini-2.5-flash` (ưu tiên 1 — ổn định, hỗ trợ JSON mode chuẩn)
 * 2. `gemini-3.5-flash-lite` (ưu tiên 2 — phản hồi cực nhanh, ít nghẽn)
 * 3. `gemini-3.8-flash` (ưu tiên 3 — dự phòng khi 2 model trên chạm rate limit)
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
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
  const e = err as {
    status?: number;
    code?: number;
    message?: string;
    error?: { code?: number; status?: string; message?: string };
  };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.error?.code === 'number') return e.error.code;

  const combinedMsg =
    `${e.message ?? ''} ${e.error?.status ?? ''} ${e.error?.message ?? ''}`.toUpperCase();

  if (
    combinedMsg.includes('503') ||
    combinedMsg.includes('UNAVAILABLE') ||
    combinedMsg.includes('HIGH DEMAND') ||
    combinedMsg.includes('OVERLOADED')
  ) {
    return 503;
  }
  if (
    combinedMsg.includes('429') ||
    combinedMsg.includes('RESOURCE_EXHAUSTED') ||
    combinedMsg.includes('RATE_LIMIT')
  ) {
    return 429;
  }
  if (
    combinedMsg.includes('404') ||
    combinedMsg.includes('NOT_FOUND') ||
    combinedMsg.includes('NO LONGER AVAILABLE')
  ) {
    return 404;
  }
  if (combinedMsg.includes('500') || combinedMsg.includes('INTERNAL')) {
    return 500;
  }
  if (combinedMsg.includes('502') || combinedMsg.includes('504')) {
    return 502;
  }
  return null;
}

export function isRetryableGeminiModelError(err: unknown): boolean {
  const status = getGeminiErrorStatus(err);
  return (
    status === 404 ||
    status === 429 ||
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504
  );
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
 * - Ưu tiên `models/gemini-2.5-flash:generateContent`.
 * - Nếu gặp lỗi 404 (Not Found), 503 (High Demand / Unavailable) hoặc 429 (Resource Exhausted),
 *   lập tức tự động chuyển sang `models/gemini-3.5-flash-lite:generateContent` -> `gemini-3.8-flash`
 *   để người dùng luôn nhận phản hồi mượt mà ngay cả giờ cao điểm.
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

      if (hasNext && isRetryableGeminiModelError(err)) {
        if (status === 429 && retry429DelayMs > 0) {
          console.warn(
            `[Gemini Fallback] Model ${modelName} bị 429, chờ ${retry429DelayMs / 1000}s rồi xoay sang ${models[i + 1]}...`,
          );
          await sleep(retry429DelayMs);
        } else {
          console.warn(
            `[Gemini Fallback] Model ${modelName} gặp mã ${status ?? 'quá tải'} (404/503/429), lập tức chuyển sang ${models[i + 1]}...`,
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
