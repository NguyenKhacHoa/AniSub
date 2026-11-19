# 05 - Đặc tả Prompt & Structured Outputs cho Gemini API

Sử dụng SDK chính thức `@google/genai` phía server (`src/lib/ai/classifier.ts` và `src/lib/gemini/classifier.ts`).

## 1. Phân loại Đa Phương Thức Series-Aware Gemini Vision (`src/lib/ai/classifier.ts`)
- **Áp dụng:** Chỉ chạy cho các video thuộc kênh bật **từ 2 nhãn trở lên** (`['Phim AI', 'HH2D']`) và **chưa kế thừa được nhãn** từ các tập cùng `(channel_id, seriesKey)` đã có trong DB (kênh 1 nhãn được gán thẳng 100%, và luôn bỏ qua các video đã khóa thủ công `is_manual_tag = true`).
- **Series-Representative Batching & Rate Limit Protection:**
  - Gom nhóm theo `(channel_id, seriesKey)` (`extractSeriesInfo`), chỉ gửi **1 video đại diện / 1 bộ phim** rồi lan truyền kết quả cho toàn bộ các tập cùng bộ (giảm tới ~90% lượng gọi API).
  - Gom **4 bộ phim đại diện / 1 request**, sử dụng ảnh thumbnail `hqdefault.jpg` (480×360, fallback `mqdefault.jpg`) để nhìn rõ nét viền lineart vs khối da/tóc 3D AI.
  - Xoay vòng tuần tự 3 model dự phòng khi gặp `429` hoặc `404`:
    `['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']`.
  - Nghỉ `2s` giữa các batch; nghỉ `8s` trước khi xoay model khi bị `429`.
- **Tiêu chí nhận diện thị giác (2 nhãn duy nhất — KHÔNG đoán mò theo từ khóa cốt truyện):**
  - **`Phim AI`:** Đồ họa tả thực, 3D AI rendering (Midjourney, Kling, Flux, Hailuo, Vidu, Sora...), ánh sáng volumetric/cinematic, da và tóc có độ khối mịn, **KHÔNG** có nét viền mực đen kiểu vẽ tay.
  - **`HH2D`:** Tranh vẽ 2D Manhua / Manhwa / Motion Comic / Anime 2D, tô màu mảng phẳng (cel-shading), **CÓ** đường viền nét vẽ (lineart) rõ ràng quanh nhân vật và bối cảnh truyện tranh.
- **Structured Output Schema (`Type.ARRAY`):**
  Trả về đúng 1 phần tử JSON cho mỗi `videoId`:
  `{ videoId, detectedGenre: 'Phim AI' | 'HH2D', seriesName: string | null, episodeNumber: integer | null, confidence: number }`.

## 2. Tóm tắt nhanh Không Spoil (`src/lib/gemini/classifier.ts`)
- **Model:** `gemini-2.5-flash`
- **Cache:** Chỉ gọi khi cột `videos.ai_summary` đang `NULL`, sau đó lưu kết quả vào DB dùng chung cho toàn hệ thống.
- **Định dạng:** Đúng **3 gạch đầu dòng** tiếng Việt ngắn gọn (`- ...`), hấp dẫn và tuyệt đối không tiết lộ cái kết.
