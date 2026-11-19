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