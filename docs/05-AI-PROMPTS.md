# 05 - Đặc tả Prompt & Structured Outputs cho Gemini API

Sử dụng SDK chính thức `@google/genai` phía server (`src/lib/ai/classifier.ts` và `src/lib/gemini/classifier.ts`).

## 1. Phân loại Đa Phương Thức 100% Gemini Vision (`src/lib/ai/classifier.ts`)
- **Áp dụng:** Chỉ chạy cho các video **mới chưa có trong DB** (hoặc khi người dùng chủ động bấm Quét lại AI) thuộc các kênh bật cả 2 nhãn `['Phim AI', 'HH2D']`, và luôn **bỏ qua** các video đã khóa thủ công (`is_manual_tag = true`).
- **Batching & Rate Limit Protection:**
  - Gom **4 video / 1 request**, sử dụng ảnh thumbnail nén nhẹ `mqdefault.jpg` (fallback `hqdefault.jpg`).
  - Xoay vòng tuần tự 3 model dự phòng khi gặp `429` hoặc `404`:
    `['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']`.
  - Nghỉ `2s` giữa các batch; nghỉ `8s` trước khi xoay model khi bị `429`.
- **Tiêu chí nhận diện thị giác (2 nhãn duy nhất — KHÔNG đoán mò theo từ khóa chữ Hán):**
  - **`Phim AI`:** Nhân vật/bối cảnh tả thực hoặc 3D siêu thực (Midjourney, Flux, Kling, Hailuo, Vidu, Sora...), không có đường viền nét mực truyện tranh, hiệu ứng ánh sáng/vật liệu điện ảnh tả thực.
  - **`HH2D`:** Phong cách truyện tranh 2D / Manhua / Manhwa / Anime, có đường viền nét mực bao quanh nhân vật, tô bóng cel-shading/phẳng 2D.
- **Structured Output Schema (`Type.ARRAY`):**
  Trả về đúng 1 phần tử JSON cho mỗi `videoId`:
  `{ videoId, detectedGenre: 'Phim AI' | 'HH2D', seriesName: string | null, episodeNumber: integer | null, confidence: number }`.

## 2. Tóm tắt nhanh Không Spoil (`src/lib/gemini/classifier.ts`)
- **Model:** `gemini-2.5-flash`
- **Cache:** Chỉ gọi khi cột `videos.ai_summary` đang `NULL`, sau đó lưu kết quả vào DB dùng chung cho toàn hệ thống.
- **Định dạng:** Đúng **3 gạch đầu dòng** tiếng Việt ngắn gọn (`- ...`), hấp dẫn và tuyệt đối không tiết lộ cái kết.
