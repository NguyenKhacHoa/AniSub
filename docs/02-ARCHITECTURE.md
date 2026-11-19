# 02 - Kiến trúc Hệ thống & Luồng Dữ liệu: AniSub

## 1. Sơ đồ luồng dữ liệu tổng thể

```text
[1. Đồng bộ Kênh]
User bấm Sync -> Next.js Server Action -> YouTube Data API (subscriptions.list)
                                                │
                                                ▼
                                     Lưu vào bảng `channels` & `user_channels`
                                                │
                                                ▼
                                     Gửi lệnh Subscribe tới Google PubSubHubbub Hub

[2. Nhận Video Thời gian thực (Real-time)]
Kênh YouTube đăng phim mới -> Google Hub bắn POST XML -> /api/webhooks/youtube
                                                               │
                                         ┌─────────────────────┴─────────────────────┐
                                         ▼                                           ▼
                         [Kiểm tra chữ ký HMAC-SHA1]                 [Lấy chi tiết thời lượng video]
                                         │                                           │
                                         ▼                                           ▼
                         [Lọc bỏ Shorts (< 60s)] ──────► [Gọi Gemini 3.5 Flash-Lite phân loại JSON]
                                                                                     │
                                                                                     ▼
                                                                     Lưu vào bảng `videos` (Supabase)
                                                                                     │
                                                                                     ▼
                                                             Supabase Realtime đẩy thẳng lên UI Client