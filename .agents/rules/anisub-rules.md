# AniSub — Quy tắc phát triển & Bảo mật (Agent Rules)

## 1. Tech Stack Cố Định
- **Framework:** Next.js (App Router) với TypeScript (`strict: true`).
- **Styling & UI:** Tailwind CSS + `shadcn/ui` + `lucide-react`. Mặc định giao diện Dark Mode chuẩn rạp chiếu phim.
- **Database, Auth & Realtime:** Supabase (PostgreSQL, Google OAuth, Supabase Realtime).
- **AI Engine:** Google Gen AI SDK mới nhất (`@google/genai`). KHÔNG dùng SDK cũ `@google/generative-ai`.
  - Model phân loại nền: `gemini-3.5-flash-lite` (bắt buộc dùng Structured Outputs JSON Schema).
  - Model tóm tắt nội dung: `gemini-4-hydrogen`.
- **YouTube Integration:** YouTube Data API v3 (chỉ dùng để lấy danh sách kênh đăng ký) + YouTube WebSub / PubSubHubbub (nhận video mới thời gian thực).

## 2. Quy tắc Bảo mật 4 Lớp (Zero-Tolerance)
1. **Khóa truy cập Whitelist:** Mọi API Route và Server Action đều phải kiểm tra session của user qua Supabase Auth VÀ xác minh email của user có tồn tại trong bảng `allowed_emails` với trạng thái `is_active = true`. Nếu không có, trả về HTTP `403 Forbidden`.
2. **Giấu kín Secret Keys:** Các biến `GEMINI_API_KEY`, `YOUTUBE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_WEBHOOK_SECRET` chỉ được phép sử dụng ở phía Server (Server Components, Route Handlers, Server Actions). Tuyệt đối KHÔNG gắn tiền tố `NEXT_PUBLIC_`.
3. **Xác thực Webhook WebSub (HMAC-SHA1):** Endpoint `POST /api/webhooks/youtube` bắt buộc phải kiểm tra header `X-Hub-Signature` bằng thuật toán HMAC-SHA1 với khóa `YOUTUBE_WEBHOOK_SECRET`. Từ chối ngay lập tức (`401 Unauthorized`) nếu chữ ký không khớp.
4. **Row Level Security (RLS):** Mọi truy vấn dữ liệu cá nhân (`user_channels`, `watch_progress`) từ phía client đều phải đi qua Supabase Client có gắn token người dùng để áp dụng RLS. Chỉ dùng `SUPABASE_SERVICE_ROLE_KEY` ở Webhook nền và Cron Job.

## 3. Quy tắc Tiết kiệm Quota & Chi phí API
- **YouTube Quota:** Chặn người dùng bấm đồng bộ danh sách kênh (`subscriptions.list`) quá 1 lần trong vòng 6 giờ dựa trên cột `last_synced_at` trong bảng `profiles`.
- **Gemini Cache:** Chỉ gọi `gemini-3.5-flash-lite` **1 lần duy nhất** khi video mới lần đầu được lưu vào bảng `videos`. Chỉ gọi `gemini-4-hydrogen` tóm tắt khi cột `ai_summary` của video đó đang `NULL`, sau đó lưu kết quả vào DB để tái sử dụng cho mọi người dùng khác.

## 4. Quy chuẩn Code TypeScript & Next.js
- Ưu tiên Server Components để tải dữ liệu ban đầu; chỉ dùng `'use client'` cho các thành phần tương tác (trình phát video, bộ lọc tab realtime, nút sync).
- Luôn định nghĩa rõ ràng `interface` hoặc `type` cho dữ liệu trả về từ YouTube API, WebSub XML parser và Gemini JSON Schema.
- **Quy chuẩn Giao diện & Theme (Bắt buộc):** Mọi component UI bắt buộc phải dùng bộ biến CSS từ `docs/06-UI-UX-GUIDELINES.md` (`--bg-canvas`, `--bg-surface`, `--bg-elevated`, `--border-subtle`, `--text-primary`, `--text-secondary`, `--accent-primary`, `--accent-foreground`) để đảm bảo độ tương phản chữ/nền chuẩn xác trên mọi Theme (`midnight-void`, `deep-abyss`, `velvet-espresso`, `crisp-daylight`). Tuyệt đối không dùng màu cứng (hardcoded colors) và không tự ý tạo dữ liệu video giả (mock data).