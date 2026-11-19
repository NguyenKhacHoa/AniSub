import { Type, type Schema } from '@google/genai';
import type { GenreTag, VideoType } from '@/types/database';

/**
 * Kiểu dữ liệu trả về từ Gemini Structured Outputs khi phân loại video.
 */
export interface VideoClassificationResult {
  video_type: VideoType;
  detected_genre: GenreTag;
  series_name: string | null;
  episode_number: number | null;
}

/**
 * System Instruction chuẩn theo `docs/05-AI-PROMPTS.md` cho `gemini-3.5-flash-lite`.
 */
export const VIDEO_CLASSIFICATION_SYSTEM_INSTRUCTION = `Bạn là hệ thống phân tích và phân loại metadata phim hoạt hình từ YouTube cho nền tảng AniSub.
Nhiệm vụ của bạn là đọc tiêu đề video, mô tả ngắn, thời lượng (tính bằng giây) và thể loại mặc định của kênh để trích xuất thông tin chuẩn xác dưới dạng JSON.

Quy tắc phân loại \`video_type\`:
- "full_movie": Video có thời lượng >= 2400 giây (40 phút), HOẶC tiêu đề chứa các từ khóa như "Full", "Trọn bộ", "Tổng hợp", "Tập 1 -", "All Episodes".
- "trailer": Tiêu đề chứa "Trailer", "Teaser", "Preview", "Nhá hàng", "OST", "Nhạc phim", "Hậu trường", hoặc thời lượng < 180 giây mà không phải một tập phim hoàn chỉnh.
- "episode": Các tập phim lẻ thông thường (ví dụ: Tập 1, Ep 12, Phần 2 Tập 5...).

Quy tắc phân loại \`detected_genre\`:
- Ưu tiên dựa vào từ khóa trong tiêu đề/mô tả để phân loại vào 1 trong 4 nhóm: "Phim AI", "HH2D", "Hoạt hình cát", "Khác".
- Nếu tiêu đề không nêu rõ, hãy kế thừa từ \`channel_default_genre\` được cung cấp.

Quy tắc trích xuất \`series_name\` và \`episode_number\`:
- Loại bỏ các từ nhiễu như "[Thuyết Minh]", "[Vietsub]", "4K", "60fps", tên kênh để lấy tên bộ phim sạch sẽ nhất (ví dụ: "Đấu Phá Thương Khung").
- Nếu xác định được số tập cụ thể, trả về số nguyên (ví dụ: 15). Nếu là phim tổng hợp nhiều tập hoặc không rõ số tập, trả về null.`;

/**
 * JSON Schema bắt buộc cho Structured Outputs của `@google/genai` (`responseSchema`).
 */
export const videoClassificationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    video_type: {
      type: Type.STRING,
      enum: ['episode', 'full_movie', 'trailer'],
      description: 'Phân loại dạng video: episode (Tập mới), full_movie (Phim Full / Tổng hợp), hoặc trailer (Trailer / Khác).',
    },
    detected_genre: {
      type: Type.STRING,
      enum: ['Phim AI', 'HH2D', 'Hoạt hình cát', 'Khác'],
      description: 'Thể loại video được nhận diện hoặc kế thừa từ thể loại mặc định của kênh.',
    },
    series_name: {
      type: Type.STRING,
      nullable: true,
      description: 'Tên bộ phim sạch đã loại bỏ từ nhiễu (vd: "[Vietsub]", "4K"). Null nếu không xác định được.',
    },
    episode_number: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Số tập cụ thể dạng số nguyên. Null nếu là phim tổng hợp nhiều tập hoặc không rõ số tập.',
    },
  },
  required: ['video_type', 'detected_genre', 'series_name', 'episode_number'],
};
