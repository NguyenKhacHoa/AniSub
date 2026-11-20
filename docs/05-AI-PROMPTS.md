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

## 2. Kiến Trúc Phân Loại Chuẩn Xác 3 Tầng (3-Layer Grounded Classification Pipeline — `src/lib/ai/classifier.ts`)
- **Tầng 1 — Khóa Định Danh Cấp Kênh & Cấp Bộ Phim (Channel & Series Master Lock):**
  - **Channel Master Lock (`channels.default_category`):** `AUTO` | `HH2D` | `2D` | `PHIM_AI`. Nếu khác `AUTO`, 100% video mới đồng bộ từ kênh đó tự động nhận đúng phân loại của kênh, không cho AI đoán lại gây lệch tập.
  - **Series Inheritance & Smart Learn on Manual Fix:** Mọi tập cùng `(channel_id, seriesKey)` tự động kế thừa nhãn đã phân loại hoặc đã khóa tay (`is_manual_tag = true`). Khi người dùng sửa tay nhãn 1 thẻ phim, hệ thống cập nhật Optimistic UI 0ms cho cả series kèm nút 1 chạm **"Áp dụng cho cả kênh"** để khóa luôn `default_category`.
- **Tầng 2 — Phân Loại Cứng Theo Thứ Tự Ưu Tiên cho Tab "Đã đăng ký" (`classifyByGroundedRules` + Gemini Vision):**
  1. **`Phim AI` (Ưu tiên 1):** Nhận diện dòng truyện tranh AI / audio drama AI / recap AI (mô-típ truyện hệ thống, xuyên không đô thị, tổng tài, trọng sinh báo thù kèm thời lượng tổng hợp dài `> 45 phút`, kênh dạng *"Bản Tin...", "Trùm Phim...", "Review Phim..."* hoặc đồ họa 3D AI không viền mực).
  2. **`HH2D` (Ưu tiên 2 — Hoạt hình 3D Trung Quốc / Donghua):** Đối chiếu danh mục tác phẩm Donghua Trung Quốc (*Tiên Nghịch, Đấu Phá Thương Khung, Phàm Nhân Tu Tiên, Thế Giới Hoàn Mỹ, Thôn Phệ Tinh Không...*) hoặc dấu hiệu Donghua / HH3D / Manhua.
  3. **`2D` (Ưu tiên 3 — Anime Nhật Bản / Hoạt hình 2D):** Đối chiếu kênh Anime bản quyền (*Muse Việt Nam, Ani-One Vietnam, POPS Anime*) hoặc tác phẩm Anime Nhật Bản / hoạt hình 2D truyền thống.
  - Các bộ phim mơ hồ còn lại mới gom **1 đại diện / 1 Series** (4 series / batch, `hqdefault.jpg`) gửi Gemini Vision xoay vòng theo `GEMINI_FALLBACK_MODELS`.
- **Tầng 3 — Phân Loại Phim Chiếu Rạp Neo Vào TMDB / AniList / IMDb Grounding (`/api/cinema/discover`):**
  - Bắt buộc tách **tên gốc (Anh / Nhật / Trung)** và dùng Google Search Grounding (`tools: [{ googleSearch: {} }]` trên `v1beta`) tra cứu trực tiếp hồ sơ phát hành rạp trên **TMDB / AniList / IMDb** (`verifiedSource`). Không tìm thấy hồ sơ xác thực $\rightarrow$ **loại bỏ ngay**.
  - Gắn nhãn chuẩn Strict Enum: `cinema_format` (`'Anime / Hoạt hình'` | `'Phim Người Đóng'`) và tối đa **2 `cinema_genres`** từ bộ Enum cố định `["Hành động", "Phiêu lưu", "Giả tưởng", "Viễn tưởng", "Tình cảm", "Hài hước", "Tâm lý", "Võ thuật"]`, đồng thời duy trì bộ luật **chặn tuyệt đối Kinh dị (`isHorrorOrGore === false`)** riêng cho Phim Chiếu Rạp.
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
