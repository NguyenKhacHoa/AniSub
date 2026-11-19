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

export const GEMINI_PER_MODEL_TIMEOUT_MS = 4500;
export const GEMINI_RETRY_OVERLOAD_DELAY_MS = 1200;
export const GEMINI_FRIENDLY_OVERLOAD_MESSAGE =
  'Máy chủ AI Google đang quá tải tạm thời, bạn bấm gửi lại sau vài giây nhé!';

export function formatFriendlyGeminiError(
  err: unknown,
  fallbackMessage = GEMINI_FRIENDLY_OVERLOAD_MESSAGE,
): string {
  const status = getGeminiErrorStatus(err);
  if (
    status === 503 ||
    status === 429 ||
    status === 504 ||
    status === 502 ||
    status === 500 ||
    status === 404
  ) {
    return GEMINI_FRIENDLY_OVERLOAD_MESSAGE;
  }

  if (err instanceof Error) {
    const msg = err.message.trim();
    // Không bao giờ trả chuỗi JSON thô của Google API ra giao diện người dùng
    if (
      msg.startsWith('{') ||
      msg.includes('"error"') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('NOT_FOUND') ||
      msg.includes('high demand')
    ) {
      return GEMINI_FRIENDLY_OVERLOAD_MESSAGE;
    }
    return msg;
  }

  return fallbackMessage;
}

export function getGeminiErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as {
    name?: string;
    status?: number;
    code?: number;
    message?: string;
    error?: { code?: number; status?: string; message?: string };
  };
  if (e.name === 'AbortError' || e.name === 'TimeoutError') {
    return 504;
  }
  if (typeof e.status === 'number') return e.status;
  if (typeof e.code === 'number') return e.code;
  if (typeof e.error?.code === 'number') return e.error.code;

  const combinedMsg =
    `${e.name ?? ''} ${e.message ?? ''} ${e.error?.status ?? ''} ${e.error?.message ?? ''}`.toUpperCase();

  if (
    combinedMsg.includes('ABORT') ||
    combinedMsg.includes('TIMEOUT') ||
    combinedMsg.includes('TIMED OUT') ||
    combinedMsg.includes('DEADLINE_EXCEEDED') ||
    combinedMsg.includes('408') ||
    combinedMsg.includes('504')
  ) {
    return 504;
  }
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
    combinedMsg.includes('RATE_LIMIT') ||
    combinedMsg.includes('QUOTA')
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
  if (combinedMsg.includes('502')) {
    return 502;
  }
  return null;
}

export function isRetryableGeminiModelError(err: unknown): boolean {
  const status = getGeminiErrorStatus(err);
  return (
    status === 404 ||
    status === 408 ||
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
  perModelTimeoutMs?: number;
}

/**
 * Helper dùng chung gọi Gemini `generateContent` trên `v1beta`:
 * - Mỗi lần gọi model giới hạn tối đa 4.5 giây (`AbortSignal.timeout(4500)`).
 * - Nếu quá 4.5s hoặc gặp lỗi 404/503/429, hủy ngay và nhảy sang model tiếp theo:
 *   `gemini-2.5-flash` -> `gemini-3.5-flash-lite` -> `gemini-3.8-flash`.
 * - Nếu cả 3 model trong lượt đầu cùng dính quá tải (`503` / `429` / `504`),
 *   tự động nghỉ 1.2 giây (`1200ms`) rồi gọi lại `gemini-2.5-flash` thêm 1 lần nữa.
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
  const perModelTimeoutMs =
    options.perModelTimeoutMs ?? GEMINI_PER_MODEL_TIMEOUT_MS;

  const invokeSingleModel = async (
    modelName: string,
  ): Promise<{ text: string; model: string }> => {
    const timeoutSignal = AbortSignal.timeout(perModelTimeoutMs);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutErr = new Error(
            `Model ${modelName} phản hồi quá ${perModelTimeoutMs}ms (Timeout).`,
          );
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, perModelTimeoutMs);
      });

      const response = await Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: options.contents,
          config: {
            ...options.config,
            abortSignal: timeoutSignal,
          },
        }),
        timeoutPromise,
      ]);

      const text = response.text?.trim();
      if (!text) {
        throw new Error(`Model ${modelName} trả về phản hồi rỗng.`);
      }

      return { text, model: modelName };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  let lastError: unknown = null;
  let sawOverloadOrTransientError = false;

  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      return await invokeSingleModel(modelName);
    } catch (err) {
      lastError = err;
      const status = getGeminiErrorStatus(err);
      if (
        status === 503 ||
        status === 429 ||
        status === 504 ||
        status === 502 ||
        status === 500
      ) {
        sawOverloadOrTransientError = true;
      }

      const hasNext = i < models.length - 1;
      if (hasNext && isRetryableGeminiModelError(err)) {
        if (status === 429 && retry429DelayMs > 0) {
          console.warn(
            `[Gemini Fallback] Model ${modelName} bị 429, chờ ${retry429DelayMs / 1000}s rồi xoay sang ${models[i + 1]}...`,
          );
          await sleep(retry429DelayMs);
        } else {
          console.warn(
            `[Gemini Fallback] Model ${modelName} gặp mã ${status ?? 'timeout/quá tải'} (404/503/429/504), hủy ngay và chuyển sang ${models[i + 1]}...`,
          );
        }
        continue;
      }

      break;
    }
  }

  // Nếu chuỗi model trong lượt đầu gặp 503 (High Demand) hoặc 429/504,
  // tự động nghỉ ngắn 1200ms rồi gọi lại model ổn định nhất (gemini-2.5-flash) thêm 1 lần nữa
  if (sawOverloadOrTransientError) {
    const primaryRetryModel = models[0] || GEMINI_PRIMARY_MODEL;
    console.warn(
      `[Gemini Retry] Toàn bộ chuỗi model đang bận (503/429), nghỉ ${GEMINI_RETRY_OVERLOAD_DELAY_MS}ms rồi thử lại ${primaryRetryModel}...`,
    );
    await sleep(GEMINI_RETRY_OVERLOAD_DELAY_MS);
    try {
      return await invokeSingleModel(primaryRetryModel);
    } catch (retryErr) {
      lastError = retryErr;
    }
  }

  throw new Error(formatFriendlyGeminiError(lastError));
}
