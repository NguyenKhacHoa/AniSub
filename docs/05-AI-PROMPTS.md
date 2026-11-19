# 05 - Đặc tả Prompt & Structured Outputs cho Gemini API

Sử dụng SDK chính thức `@google/genai` phía server trên endpoint `v1beta`, hợp nhất helper gọi model tại `src/lib/gemini/client.ts`, bộ phân loại tại `src/lib/ai/classifier.ts` và hệ thống phân tích & hỏi đáp tại `src/lib/ai/cinema-insight.ts`.

## 1. Chuỗi Model Fallback & Timeout Chuẩn (`src/lib/gemini/client.ts`)
- **Thứ tự model ưu tiên (`GEMINI_FALLBACK_MODELS` trên `v1beta`):**
  1. `gemini-2.5-flash` (ưu tiên 1 — ổn định, hỗ trợ JSON mode chuẩn)
  2. `gemini-3.5-flash-lite` (ưu tiên 2 — phản hồi cực nhanh, ít nghẽn)
  3. `gemini-3.8-flash` (ưu tiên 3 — dự phòng khi 2 model trên chạm rate limit)
- **Timeout, Tự động xoay model & Retry khi `503` High Demand (`callGeminiWithFallback`):**
  - Dùng chung một nguồn duy nhất cho cả `/api/ai/summary` và `/api/ai/chat`.
  - Mỗi lượt gọi model có `AbortSignal.timeout(4500)` kết hợp `Promise.race` (tối đa **4.5 giây**).
  - Nếu gặp lỗi `404` (Not Found), `503` (High Demand / Unavailable), `429` (Resource Exhausted) hoặc quá `4.5s` (`504` Timeout), hệ thống lập tức hủy request hiện tại và chuyển sang model dự phòng kế tiếp (`gemini-2.5-flash` $\rightarrow$ `gemini-3.5-flash-lite` $\rightarrow$ `gemini-3.8-flash`).
  - **Auto-Retry 1 lần (`1200ms`):** Nếu toàn bộ chuỗi model trong lượt đầu gặp lỗi quá tải tạm thời (`503` / `429` / `504`), hệ thống tự động nghỉ ngắn `1200ms` (1.2 giây) rồi gọi lại `gemini-2.5-flash` thêm 1 lần nữa trước khi dừng.
  - **Thông báo lỗi tiếng Việt thân thiện (`formatFriendlyGeminiError`):** Nếu sau khi retry vẫn quá tải, luôn trả về thông điệp *"Máy chủ AI Google đang quá tải tạm thời, bạn bấm gửi lại sau vài giây nhé!"*, tuyệt đối không hiển thị chuỗi JSON lỗi thô của Google ra giao diện.

## 2. Phân loại Đa Phương Thức Series-Aware Gemini Vision (`src/lib/ai/classifier.ts`)
- **Áp dụng:** Chỉ chạy cho các video thuộc kênh bật **từ 2 nhãn trở lên** (`['Phim AI', 'HH2D']`) và **chưa kế thừa được nhãn** từ các tập cùng `(channel_id, seriesKey)` đã có trong DB (kênh 1 nhãn được gán thẳng 100%, và luôn bỏ qua các video đã khóa thủ công `is_manual_tag = true`).
- **Series-Representative Batching & Rate Limit Protection:**
  - Gom nhóm theo `(channel_id, seriesKey)` (`extractSeriesInfo`), chỉ gửi **1 video đại diện / 1 bộ phim** rồi lan truyền kết quả cho toàn bộ các tập cùng bộ (giảm tới ~90% lượng gọi API).
  - Gom **4 bộ phim đại diện / 1 request**, sử dụng ảnh thumbnail `hqdefault.jpg` (480×360, fallback `mqdefault.jpg`) để nhìn rõ nét viền lineart vs khối da/tóc 3D AI.
  - Xoay vòng tuần tự theo `GEMINI_FALLBACK_MODELS` (`['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']`).
- **Tiêu chí nhận diện thị giác (2 nhãn thể loại + cờ `isMovie` Phim Chiếu Rạp):**
  - **`Phim AI`:** Đồ họa tả thực, 3D AI rendering (Midjourney, Kling, Flux, Hailuo, Vidu, Sora...), ánh sáng volumetric/cinematic, da và tóc có độ khối mịn, **KHÔNG** có nét viền mực đen kiểu vẽ tay.
  - **`HH2D`:** Tranh vẽ 2D Manhua / Manhwa / Motion Comic / Anime 2D, tô màu mảng phẳng (cel-shading), **CÓ** đường viền nét vẽ (lineart) rõ ràng quanh nhân vật và bối cảnh truyện tranh.
  - **`isMovie` / `is_theatrical_movie` (Phim Chiếu Rạp — Auto-Discover, Google Search Grounding & Scoped Anti-Horror Policy):**
    - **Cấm tuyệt đối** tự gắn mác `Chiếu Rạp` dựa trên thời lượng hay từ khóa chung (`full`, `bản full`, `trọn bộ`, `ova`, `special`).
    - **Loại trừ cứng 100%:** Mọi video thuộc `Phim AI`, có thời lượng ngoài ngưỡng **65–165 phút (`3900s–9900s`)**, hoặc tiêu đề chứa dấu hiệu tổng hợp/ghép tập (`giờ`, `tiếng`, `tập 1`, `trọn bộ`, `tổng hợp`, `review`, `tóm tắt`) đều trả về `false`.
    - **Chính sách Chặn Kinh Dị 2 Lớp (Scoped Anti-Horror Policy — CHỈ ÁP DỤNG RIÊNG CHO PHIM CHIẾU RẠP):**
      1. *Lớp 1 (Pre-filter từ khóa trong `/api/cinema/discover` & `isHardExcludedFromTheatrical`):* Loại bỏ ngay video chiếu rạp có tiêu đề/mô tả chứa `kinh dị`, `horror`, `ma ám`, `quỷ ám`, `trừ tà`, `exorcist`, `ác quỷ`, `xác sống`, `zombie`, `ma cà rồng`, `slasher`, `giết người hàng loạt`, `máu me`, `gore`, `creepy`, `rùng rợn`, `ma quái`, `linh dị`, `cương thi`.
      2. *Lớp 2 (Google Search Grounding trên `v1beta` kèm `tools: [{ googleSearch: {} }]`):* Tra cứu Google xác nhận đồng thời `isTheatricalMovie === true` (đã từng công chiếu thương mại ngoài rạp kèm `canonicalTitle` và `releaseYear`) VÀ `isHorrorOrGore === false`.
      3. *Phạm vi cô lập:* Tuyệt đối **không** áp dụng bộ lọc kinh dị/linh dị/ma quái lên luồng phân loại `HH2D`, `2D` và `Phim AI` thông thường.
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
