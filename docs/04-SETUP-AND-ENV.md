# 04 - Hướng dẫn Cấu hình Dịch vụ & Biến Môi Trường

## 1. Cấu hình Google Cloud Console (YouTube API & OAuth)
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) và tạo Project mới tên `AniSub`.
2. Vào **APIs & Services > Library**, tìm và kích hoạt **YouTube Data API v3**.
3. Vào **APIs & Services > Credentials > Create Credentials > API Key** -> Lưu lại làm `YOUTUBE_API_KEY`.
4. Vào **APIs & Services > OAuth consent screen**:
   - Chọn **External**, điền tên ứng dụng `AniSub`.
   - Tại mục **Scopes**, thêm scope: `https://www.googleapis.com/auth/youtube.readonly`.
   - Giữ trạng thái ứng dụng ở chế độ **Testing** (KHÔNG bấm Publish).
   - Tại mục **Test users**, thêm email Google của bạn và nhóm bạn bè được phép dùng web (tối đa 100 email).
5. Vào **Credentials > Create Credentials > OAuth client ID** (Web application):
   - Authorized redirect URIs: Điền URL Callback lấy từ Supabase Auth (dạng `https://<PROJECT_REF>.supabase.co/auth/v1/callback`).
   - Lưu lại `Client ID` và `Client Secret`.

## 2. Cấu hình Supabase
1. Tạo Project mới trên [Supabase](https://supabase.com/).
2. Chạy toàn bộ mã SQL trong `docs/03-DATABASE.md` tại mục **SQL Editor**.
3. Thêm email của bạn vào bảng `allowed_emails`:
   ```sql
   INSERT INTO public.allowed_emails (email, note) VALUES ('email_cua_ban@gmail.com', 'Admin');
   ```

## 3. Cấu hình Tự động đồng bộ 24/7 mỗi 3 tiếng (GitHub Actions Cron + `/api/cron/auto-sync`)
Vì gói Vercel Hobby chỉ hỗ trợ Vercel Cron 1 lần/ngày, AniSub sử dụng **GitHub Actions** (`.github/workflows/auto-sync.yml`) chạy lịch `0 */3 * * *` (8 lần/ngày) gọi thẳng tới `/api/cron/auto-sync`:
1. Trên **Vercel → Project Settings → Environment Variables**, thêm biến:
   - `CRON_SECRET`: chuỗi bí mật ngẫu nhiên (ví dụ 32 ký tự hex).
2. Trên **GitHub Repository → Settings → Secrets and variables → Actions → New repository secret**, thêm 2 biến:
   - `APP_URL`: URL production của dự án (ví dụ `https://anisub.vercel.app`).
   - `CRON_SECRET`: giá trị khớp 100% với `CRON_SECRET` trên Vercel.
3. Mở tab **Actions → AniSub 3-Hour Automated Sync → Run workflow** để chạy thử ngay bất cứ lúc nào.