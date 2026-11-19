import { GoogleGenAI } from '@google/genai';

/**
 * Model dùng cho tác vụ phân loại video nền tại Webhook.
 */
export const GEMINI_CLASSIFICATION_MODEL = 'gemini-3.5-flash-lite' as const;

/**
 * Model dùng cho tác vụ tóm tắt nội dung video (chỉ gọi khi `ai_summary` đang NULL).
 */
export const GEMINI_SUMMARY_MODEL = 'gemini-4-hydrogen' as const;

let geminiClientInstance: GoogleGenAI | null = null;

/**
 * Khởi tạo và trả về singleton client của `@google/genai`.
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
    geminiClientInstance = new GoogleGenAI({ apiKey });
  }

  return geminiClientInstance;
}
