# 02 - Kiến trúc Hệ thống & Luồng Dữ liệu: AniSub

## 1. Sơ đồ luồng dữ liệu tổng thể

```text
[1. Đồng bộ Kênh & Kéo Video]
User bấm Sync -> POST /api/youtube/sync-channels -> YouTube Data API (subscriptions.list)
                                                          │
                                                          ▼
                                               Lưu vào `channels` & `user_channels`
                                                          │
User bật kênh / bấm "+50 video cũ" -> POST /api/channels/toggle | /api/channels/load-more
                                                          │
                                                          ▼
                        YouTube playlistItems.list (maxResults=50, lưu next_page_token)
                                                          │
                         ┌────────────────────────────────┴────────────────────────────────┐
                         ▼                                                                 ▼
         [Lọc bỏ Shorts (< 60s) & Video đã có]                     [Kênh 2 tag -> Gemini Vision Batch]
                                                                   (4 video/batch, mqdefault.jpg,
                                                                    xoay vòng 3 model dự phòng)
                                                                                           │
                                                                                           ▼
                                                                    Lưu vào bảng `videos` (Supabase)

[2. Hiển thị & Cuộn Vô Hạn Theo Ngữ Cảnh (Context-Aware Infinite Scroll)]
UI đổi bộ lọc (Tất cả | Phim AI | HH2D) / Tab (Tất cả | Tập mới | Phim Full) / Tìm kiếm / Cuộn đáy
                                                          │
                                                          ▼
             GET /api/videos?offset=...&limit=60&genre=...&tab=...&q=...
                                                          │
                                                          ▼
     Truy vấn trực tiếp Supabase (Genre-Aware Filtering + watch_progress + count: exact)
                                                          │
                         ┌────────────────────────────────┴────────────────────────────────┐
                         ▼                                                                 ▼
             [Tab Tập mới -> SeriesGrid]                                  [Các tab khác -> Grid thẻ phim]
     (Gom nhóm theo channel_id + seriesKey)                               (1 chạm đổi nhãn is_manual_tag)
```

## 2. Danh sách API Routes hiện hành (`src/app/api/`)

Tất cả các API dữ liệu người dùng đều bắt buộc đi qua kiểm tra bảo mật 4 lớp (`verifyWhitelistedUser()`).

| Endpoint | Method | Vai trò |
| :--- | :--- | :--- |
| `/api/videos` | `GET` | Phân trang 60 video/lần theo ngữ cảnh (`offset`, `limit`, `genre`, `tab`, `showTrailers`, `q`) phục vụ Context-Aware Infinite Scroll. |
| `/api/workspace` | `GET` | Tải danh sách kênh + video trang đầu kèm `totalVideosCount` & `hasMoreVideos`. |
| `/api/youtube/sync-channels` | `POST` | Đồng bộ danh sách kênh YouTube của user (`subscriptions.list`, cooldown 6 giờ ở production). |
| `/api/channels/toggle` | `POST` | Bật/tắt kênh và cập nhật đa nhãn `genre_tags` (`Phim AI` / `HH2D`), kéo tối đa 50 video mới nhất (chỉ quét Gemini cho video chưa có trong DB). |
| `/api/channels/load-more` | `POST` | Kéo thêm 50 video cũ hơn của riêng 1 kênh bằng `next_page_token` đã lưu. |
| `/api/channels/load-more-all` | `POST` | Kéo thêm 50 video cũ/kênh cho tối đa 3 kênh đang bật chưa hết lịch sử YouTube (Giai đoạn 2 của Two-Stage Infinite Scroll). |
| `/api/channels/reclassify` | `POST` | Chạy lại Gemini Vision cho tối đa 50 video của 1 kênh đa nhãn (bỏ qua `is_manual_tag = true`). |
| `/api/videos/reclassify-all` | `POST` | Quét lại nhãn bằng Gemini Vision cho toàn bộ các kênh đang bật (bỏ qua `is_manual_tag = true`). |
| `/api/videos/update-genre` | `POST` | Đổi nhanh nhãn `Phim AI` ↔ `HH2D` 1 chạm trên thẻ phim và khóa `is_manual_tag = true`. |
| `/api/videos/summarize` | `POST` | Gọi Gemini tóm tắt 3 ý chính không spoil và cache vào cột `ai_summary`. |
| `/api/watch-progress` | `POST` | Lưu tiến độ xem thời gian thực (`progress_seconds`, `is_completed`) vào `watch_progress`. |
| `/api/youtube/explore` | `GET` | Đề xuất video từ kênh lạ hợp gu (học từ `watch_progress` + Like YouTube, cache 6 tiếng). |
| `/api/youtube/subscribe` | `POST` | Đăng ký kênh mới trực tiếp lên YouTube (`youtube.force-ssl`) và kéo ngay 50 video vào AniSub. |
| `/api/access-requests` | `GET`/`POST` | Kiểm tra hoặc gửi đơn xin cấp quyền truy cập cho email ngoài Whitelist. |
| `/api/admin/requests` | `GET`/`POST` | Phê duyệt hoặc từ chối đơn xin truy cập (chỉ dành cho `ADMIN_EMAIL`). |
| `/api/whitelist` | `GET`/`POST`/`PATCH`/`DELETE` | Quản lý danh sách email được cấp quyền trong `allowed_emails`. |
