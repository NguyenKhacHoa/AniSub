# 05 - Đặc tả Prompt & Structured Outputs cho Gemini API

Sử dụng SDK chính thức `@google/genai` phía server hợp nhất tại một nguồn duy nhất `src/lib/ai/classifier.ts`.

## 1. Phân loại Đa Phương Thức Series-Aware Gemini Vision (`src/lib/ai/classifier.ts`)
- **Áp dụng:** Chỉ chạy cho các video thuộc kênh bật **từ 2 nhãn trở lên** (`['Phim AI', 'HH2D']`) và **chưa kế thừa được nhãn** từ các tập cùng `(channel_id, seriesKey)` đã có trong DB (kênh 1 nhãn được gán thẳng 100%, và luôn bỏ qua các video đã khóa thủ công `is_manual_tag = true`).
- **Series-Representative Batching & Rate Limit Protection:**
  - Gom nhóm theo `(channel_id, seriesKey)` (`extractSeriesInfo`), chỉ gửi **1 video đại diện / 1 bộ phim** rồi lan truyền kết quả cho toàn bộ các tập cùng bộ (giảm tới ~90% lượng gọi API).
  - Gom **4 bộ phim đại diện / 1 request**, sử dụng ảnh thumbnail `hqdefault.jpg` (480×360, fallback `mqdefault.jpg`) để nhìn rõ nét viền lineart vs khối da/tóc 3D AI.
  - Xoay vòng tuần tự model dự phòng trên endpoint `v1beta` khi gặp `429` hoặc `404`:
    `['gemini-2.5-flash', 'gemini-2.5-flash-lite']`.
  - Nghỉ `2s` giữa các batch; nghỉ `8s` trước khi xoay model khi bị `429`.
- **Tiêu chí nhận diện thị giác (2 nhãn duy nhất — KHÔNG đoán mò theo từ khóa cốt truyện):**
  - **`Phim AI`:** Đồ họa tả thực, 3D AI rendering (Midjourney, Kling, Flux, Hailuo, Vidu, Sora...), ánh sáng volumetric/cinematic, da và tóc có độ khối mịn, **KHÔNG** có nét viền mực đen kiểu vẽ tay.
  - **`HH2D`:** Tranh vẽ 2D Manhua / Manhwa / Motion Comic / Anime 2D, tô màu mảng phẳng (cel-shading), **CÓ** đường viền nét vẽ (lineart) rõ ràng quanh nhân vật và bối cảnh truyện tranh.
- **Structured Output Schema (`Type.ARRAY`):**
  Trả về đúng 1 phần tử JSON cho mỗi `videoId`:
  `{ videoId, detectedGenre: 'Phim AI' | 'HH2D', seriesName: string | null, episodeNumber: integer | null, confidence: number }`.

## 2. AI Cinema Insight & Interactive Assistant (`src/lib/ai/cinema-insight.ts`)
- **Phân tích đa nguồn (`POST /api/ai/summary`):**
  - Thu thập song song 3 nguồn: Metadata video + Lời thoại phụ đề YouTube (`vi` → `en` → track đầu tiên, giới hạn ~14.000 ký tự đầu/giữa/cuối kèm mốc `[MM:SS]`) + 60 bình luận thật từ YouTube Data API v3 (`commentThreads`, lọc bỏ spam/link rác).
  - Gemini Structured JSON Output (`responseMimeType: 'application/json'`, xoay vòng 3 model dự phòng) trả về: `overallScore` (0–100), `verdictLabel`, 4 `metrics` (`plot`, `visuals`, `audio`, `pacing`), `overview` (không spoil), `highlights` (`time`, `description`), `communityPros`, `communityCons`, `featuredComments` (tối đa 3 bình luận), `analyzedCommentCount`, `hasTranscript`, `storyContext`.
  - Cache 7 ngày vào cột JSONB `public.videos.insight_data` (có fallback memory cache an toàn nếu chưa chạy migration), hỗ trợ `forceRefresh: true`.
- **Hỏi đáp theo ngữ cảnh (`POST /api/ai/chat`):**
  - Nhận `videoId`, metadata, `insightContext` (bao gồm `storyContext`) và mảng `messages`, duy trì hội thoại nhiều lượt bằng tiếng Việt, bám sát lời thoại & bình luận thực tế, tránh bịa đặt và tránh spoil kết phim.
