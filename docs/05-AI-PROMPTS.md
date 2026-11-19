# 05 - Đặc tả Prompt & Structured Outputs cho Gemini API

Sử dụng SDK chính thức `@google/genai` phía server trên endpoint `v1beta`, hợp nhất helper gọi model tại `src/lib/gemini/client.ts`, bộ phân loại tại `src/lib/ai/classifier.ts` và hệ thống phân tích & hỏi đáp tại `src/lib/ai/cinema-insight.ts`.

## 1. Chuỗi Model Fallback & Timeout Chuẩn (`src/lib/gemini/client.ts`)
- **Thứ tự model ưu tiên (`GEMINI_FALLBACK_MODELS` trên `v1beta`):**
  1. `gemini-2.5-flash` (ưu tiên 1 — ổn định, hỗ trợ JSON mode chuẩn)
  2. `gemini-3.5-flash-lite` (ưu tiên 2 — phản hồi cực nhanh, ít nghẽn)
  3. `gemini-3.8-flash` (ưu tiên 3 — dự phòng khi 2 model trên chạm rate limit)
- **Timeout & Tự động xoay model (`callGeminiWithFallback`):**
  - Mỗi lượt gọi model có `AbortSignal.timeout(4500)` kết hợp `Promise.race` (tối đa **4.5 giây**).
  - Nếu gặp lỗi `404` (Not Found), `503` (High Demand / Unavailable), `429` (Resource Exhausted) hoặc quá `4.5s` (`504` Timeout), hệ thống lập tức hủy request hiện tại và chuyển sang model dự phòng kế tiếp.

## 2. Phân loại Đa Phương Thức Series-Aware Gemini Vision (`src/lib/ai/classifier.ts`)
- **Áp dụng:** Chỉ chạy cho các video thuộc kênh bật **từ 2 nhãn trở lên** (`['Phim AI', 'HH2D']`) và **chưa kế thừa được nhãn** từ các tập cùng `(channel_id, seriesKey)` đã có trong DB (kênh 1 nhãn được gán thẳng 100%, và luôn bỏ qua các video đã khóa thủ công `is_manual_tag = true`).
- **Series-Representative Batching & Rate Limit Protection:**
  - Gom nhóm theo `(channel_id, seriesKey)` (`extractSeriesInfo`), chỉ gửi **1 video đại diện / 1 bộ phim** rồi lan truyền kết quả cho toàn bộ các tập cùng bộ (giảm tới ~90% lượng gọi API).
  - Gom **4 bộ phim đại diện / 1 request**, sử dụng ảnh thumbnail `hqdefault.jpg` (480×360, fallback `mqdefault.jpg`) để nhìn rõ nét viền lineart vs khối da/tóc 3D AI.
  - Xoay vòng tuần tự theo `GEMINI_FALLBACK_MODELS` (`['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']`).
- **Tiêu chí nhận diện thị giác (2 nhãn thể loại + cờ `isMovie` Phim Chiếu Rạp):**
  - **`Phim AI`:** Đồ họa tả thực, 3D AI rendering (Midjourney, Kling, Flux, Hailuo, Vidu, Sora...), ánh sáng volumetric/cinematic, da và tóc có độ khối mịn, **KHÔNG** có nét viền mực đen kiểu vẽ tay.
  - **`HH2D`:** Tranh vẽ 2D Manhua / Manhwa / Motion Comic / Anime 2D, tô màu mảng phẳng (cel-shading), **CÓ** đường viền nét vẽ (lineart) rõ ràng quanh nhân vật và bối cảnh truyện tranh.
  - **`isMovie` (Phim Chiếu Rạp):** `true` nếu nội dung là Anime Movie / Bản điện ảnh chiếu rạp / OVA / Special / Phim lẻ (kết hợp cùng bộ lọc từ khóa `isTheatricalMovieVideo` và thời lượng `>= 3900s`).
- **Structured Output Schema (`Type.ARRAY`):**
  Trả về đúng 1 phần tử JSON cho mỗi `videoId`:
  `{ videoId, detectedGenre: 'Phim AI' | 'HH2D', seriesName: string | null, episodeNumber: integer | null, isMovie: boolean | null, confidence: number }`.

## 3. AI Cinema Insight & Interactive Assistant (`src/lib/ai/cinema-insight.ts`)
- **Phân tích đa nguồn (`POST /api/ai/summary`, `maxDuration = 30`):**
  - Thu thập song song 3 nguồn:
    1. **Metadata:** Tiêu đề, tên kênh, thể loại, thời lượng, mô tả (cắt gọn <= 400 ký tự).
    2. **Lời thoại phụ đề YouTube (`fetchYouTubeTranscript`):** Ưu tiên `vi` → `en` → track đầu tiên qua InnerTube ANDROID player API / watch HTML; tự động lấy mẫu đều 3 vùng **Đầu (1.3k) – Giữa (1.1k) – Cuối (1.1k)** tối đa **3.500 ký tự** kèm mốc `[MM:SS]` để xử lý mượt cả video dài 11–12 tiếng.
    3. **Bình luận thật từ YouTube (`fetchYouTubeComments`):** Gọi `commentThreads`, lọc spam/link rác, sắp xếp theo lượt like giảm dần và lấy tối đa **25 bình luận nhiều like nhất** (mỗi bình luận <= 180 ký tự).
  - Tổng độ dài prompt giữ dưới ~1.500 tokens (~5.800 ký tự) giúp `gemini-2.5-flash` không bị lỗi `429` TPM và phản hồi JSON trong **1.5 – 2.5 giây**:
    `{ overallScore (0–100), verdictLabel, metrics: { plot, visuals, audio, pacing }, overview, highlights: [{ time, description }], communityPros, communityCons, featuredComments, analyzedCommentCount, hasTranscript, storyContext }`.
  - Cache 7 ngày vào cột JSONB `public.videos.insight_data` (có fallback memory cache an toàn), hỗ trợ `forceRefresh: true`.
- **Hỏi đáp theo ngữ cảnh (`POST /api/ai/chat`, `maxDuration = 30`):**
  - Nhận `videoId`, metadata, `insightContext` (bao gồm `storyContext`) và mảng `messages`, duy trì hội thoại nhiều lượt bằng tiếng Việt, bám sát lời thoại & bình luận thực tế, tránh bịa đặt và tránh spoil kết phim.
