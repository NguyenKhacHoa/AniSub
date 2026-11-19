import { getGeminiClient } from '@/lib/gemini/client';

export const GEMINI_SUMMARY_MODEL = 'gemini-2.5-flash' as const;

/**
 * Tạo 3 gạch đầu dòng tóm tắt nội dung ngắn gọn, KHÔNG spoil cái kết.
 */
export async function generateVideoSummaryWithGemini(input: {
  title: string;
  description: string | null;
  detectedGenre: string | null;
  durationSeconds: number;
}): Promise<string> {
  const ai = getGeminiClient();

  const prompt = `Bạn là biên tập viên rạp chiếu phim AniSub. Hãy viết tóm tắt nhanh cho video sau bằng tiếng Việt gồm ĐÚNG 3 gạch đầu dòng ngắn gọn (mỗi dòng bắt đầu bằng "- "), hấp dẫn và TUYỆT ĐỐI KHÔNG tiết lộ cái kết (no spoiler).

- Tiêu đề: ${input.title}
- Thể loại: ${input.detectedGenre ?? 'Hoạt hình'}
- Thời lượng: ${Math.round(input.durationSeconds / 60)} phút
- Mô tả gốc: ${(input.description ?? 'Không có mô tả chi tiết').slice(0, 1200)}

Chỉ trả về đúng 3 dòng bắt đầu bằng "- ", không thêm lời mở đầu hay kết luận.`;

  const response = await ai.models.generateContent({
    model: GEMINI_SUMMARY_MODEL,
    contents: prompt,
    config: {
      temperature: 0.4,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini không trả về nội dung tóm tắt.');
  }

  return text;
}
