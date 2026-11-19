# 02 - Kiến trúc Hệ thống & Luồng Dữ liệu: AniSub

## 1. Sơ đồ luồng dữ liệu tổng thể

```text
[1. Đồng bộ Kênh & Kéo Video]
User bấm Sync -> POST /api/youtube/sync-channels -> YouTube Data API (subscriptions.list)
                                                          │
                                                          ▼
                                               Lưu vào `channels` & `user_channels`
                                                          │
User bật kênh / đăng ký kênh -> POST /api/channels/toggle | /api/youtube/subscribe | /api/channels/load-more
                                                          │
                                                          ▼
             syncAllChannelVideos: Duyệt hết 100% các trang nextPageToken (50 video/trang)
                                                          │
                         ┌────────────────────────────────┴────────────────────────────────┐
                         ▼                                                                 ▼
         [Kế thừa tag theo Series từ DB]                           [Kênh 2 tag -> 1 đại diện / 1 Series]
         (Ưu tiên is_manual_tag = true)                            (Gemini Vision 4 series/batch, hqdefault.jpg,
                                                                    xoay vòng 3 model dự phòng)
                                                                                           │
                                                                                           ▼
                                                                    Lưu vào bảng `videos` (Supabase)

[2. Full-Catalog In-Memory Store & Instant Filtering (0ms)]
Mở ứng dụng (SSR) -> loadWorkspaceDataForUser() -> Truy vấn phân đoạn .range() theo lô 1.000 dòng lấy 100% kho video
                                                          │
                                                          ▼
              Giữ toàn bộ `allVideos` trong bộ nhớ `UnifiedCinemaWorkspace` + Per-Tab Scroll Restoration
                                                          │
                         ┌────────────────────────────────┴────────────────────────────────┐
                         ▼                                                                 ▼
             [Tab Tập mới -> SeriesGrid]                                  [Các tab khác -> Grid thẻ phim]
     (Lọc & gom nhóm tức thì 0ms bằng useMemo)                            (1 chạm lan truyền tag cả bộ phim)
```

## 2. Danh sách API Routes hiện hành (`src/app/api/`)

Tất cả các API dữ liệu người dùng đều bắt buộc đi qua kiểm tra bảo mật 4 lớp (`verifyWhitelistedUser()`).

| Endpoint | Method | Vai trò |
| :--- | :--- | :--- |
| `/api/videos` | `GET` | Trả về 100% toàn bộ video khớp ngữ cảnh bằng truy vấn phân đoạn `.range()` theo từng lô 1.000 dòng (không giới hạn `limit=60`). |
| `/api/workspace` | `GET` | Tải danh sách kênh + 100% kho video (`loadWorkspaceDataForUser`). |
| `/api/youtube/sync-channels` | `POST` | Đồng bộ danh sách kênh YouTube của user (`subscriptions.list`, cooldown 6 giờ ở production). |
| `/api/channels/toggle` | `POST` | Bật/tắt kênh, cập nhật đa nhãn `genre_tags` (`Phim AI` / `HH2D`), chạy `syncAllChannelVideos` kéo trọn vẹn 100% video từ Tập 1 đến Tập mới nhất (Series-Aware AI). |
| `/api/channels/load-more` | `POST` | Chạy `syncAllChannelVideos` đồng bộ trọn vẹn lịch sử video của 1 kênh. |
| `/api/channels/delta-sync` | `POST` | Smart Delta Sync: quét nhanh 10 video mới nhất (`maxResults=10`, 1 điểm quota/kênh) của các kênh đang bật (tự động chạy ngầm khi qua ≥ 60 phút hoặc chạy chủ động `force: true`), tự động phân loại Series-Aware và trả về kho cập nhật. |
| `/api/series/status` | `POST` | Lưu/xóa trạng thái `following` (⭐ Theo dõi), `completed` hoặc `hidden` (Ẩn bớt) cho từng bộ phim trong `public.user_series_status`. |
| `/api/videos/watch-later` | `POST` | Toggle thêm/xóa video khỏi danh sách **Lưu Xem Sau** (`public.user_watch_later`). |
| `/api/channels/load-more-all` | `POST` | Kéo thêm 50 video cũ/kênh cho tối đa 3 kênh đang bật chưa hết lịch sử YouTube (Giai đoạn 2 của Two-Stage Infinite Scroll). |
| `/api/channels/reclassify` | `POST` | Chạy lại Gemini Vision (1 đại diện / 1 Series) cho toàn bộ video của 1 kênh đa nhãn (bỏ qua `is_manual_tag = true` và kế thừa các bộ đã khóa tay). |
| `/api/videos/reclassify-all` | `POST` | Quét lại nhãn bằng Gemini Vision theo cơ chế **1 đại diện / 1 Series** (4 series / batch) cho toàn bộ kho video chưa khóa tay (`is_manual_tag = false`) của các kênh đang bật. |
| `/api/videos/update-genre` | `POST` | Đổi nhanh nhãn `Phim AI` ↔ `HH2D` 1 chạm, tự động **lan truyền đồng loạt** `detected_genre` và khóa `is_manual_tag = true` cho toàn bộ các tập cùng `(channel_id, seriesKey)`. |
| `/api/videos/summarize` | `POST` | Endpoint tương thích ngược tóm tắt 3 ý chính không spoil và cache vào `ai_summary`. |
| `/api/ai/summary` | `POST` | **AI Cinema Insight (`maxDuration = 30`):** Kết hợp song song 3 nguồn (Metadata + YouTube Transcript rút gọn Đầu-Giữa-Cuối <= 3.500 ký tự kèm `[MM:SS]` + 25 bình luận YouTube nhiều like nhất từ `commentThreads`), gọi `callGeminiWithFallback` (`gemini-2.5-flash` -> `gemini-3.5-flash-lite` -> `gemini-3.8-flash` trên `v1beta`, timeout 4.5s/model, tự động nghỉ `1200ms` và retry `gemini-2.5-flash` nếu cả chuỗi gặp `503`/`429`) chấm điểm thang 100 và cache 7 ngày trong `videos.insight_data`. |
| `/api/ai/chat` | `POST` | **AI Cinema Assistant (`maxDuration = 30`):** Hội thoại nhiều lượt theo ngữ cảnh tập phim dựa trên `storyContext` + dữ liệu phân tích + lịch sử tin nhắn, dùng chung `callGeminiWithFallback` (Multi-Model Fallback + Retry `1200ms` khi `503` High Demand + thông báo lỗi tiếng Việt thân thiện qua `formatFriendlyGeminiError`). |
| `/api/watch-progress` | `POST` | Lưu tiến độ xem thời gian thực (`progress_seconds`, `is_completed`) vào `watch_progress`. |
| `/api/youtube/explore` | `GET` | Đề xuất video từ kênh lạ hợp gu hỗ trợ phân trang vô hạn (`?page=1&refresh=false&pageTokens=...&excludeIds=...`): Trang 1 cache 6 tiếng, Trang ≥ 2 dùng `nextPageToken` hoặc mở rộng từ khóa qua Gemini AI, lọc bỏ Shorts (`<= 65s`) và trả về `nextPage`, `hasMore`, `pageTokens`. |
| `/api/youtube/subscribe` | `POST` | Hỗ trợ truyền `channelId` (`UC...`), `@handle` (vd: `@MuseVietNam`, `@AniOneVietnam`, `@POPSAnime`) hoặc URL kênh YouTube; tự động phân giải Channel ID thật qua YouTube Data API v3 (`channels.list?forHandle` / `search.list`), đăng ký kênh và chạy `syncAllChannelVideos` kéo 100% video thật vào AniSub. |
| `/api/cinema/discover` | `GET`/`POST` | **Auto-Discover & Kiểm duyệt Phim Chiếu Rạp:** Tự động tìm kiếm trên toàn YouTube (`search.list` + `videos.list`, thời lượng chuẩn rạp 65–165 phút), áp dụng **Bộ luật Chặn Kinh Dị 2 Lớp (Scoped Anti-Horror Policy chỉ dành riêng cho Phim Chiếu Rạp)** + xác minh phát hành rạp thực tế qua Gemini Google Search Grounding (`isTheatricalMovie === true && isHorrorOrGore === false`). Kích hoạt tự động qua Background Auto-Sync (chu kỳ 12h, `keepalive: true`) và Vercel Cron Job (`0 2 * * *` trong `vercel.json`). |
| `/api/access-requests` | `GET`/`POST` | Kiểm tra hoặc gửi đơn xin cấp quyền truy cập cho email ngoài Whitelist. |
| `/api/admin/requests` | `GET`/`POST`/`PATCH` | Phê duyệt hoặc từ chối đơn xin truy cập (chỉ dành cho `ADMIN_EMAIL`). |
| `/api/admin/clean-cinema-tags` | `POST` | Quét và gỡ bỏ ngay lập tức các nhãn/cờ `Chiếu Rạp` bị gắn nhầm khỏi toàn bộ video `Phim AI`, video ghép nhiều giờ và video tổng hợp `HH2D` trong Supabase, trả lại đúng danh mục gốc. |
| `/api/whitelist` | `GET`/`POST`/`PATCH`/`DELETE` | Quản lý danh sách email được cấp quyền trong `allowed_emails`. |
