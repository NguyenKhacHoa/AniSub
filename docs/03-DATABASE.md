# 03 - Thiết kế Cơ sở Dữ liệu (Supabase PostgreSQL)

Chạy toàn bộ đoạn mã SQL dưới đây trong **Supabase SQL Editor** để khởi tạo cấu trúc bảng, phân quyền bảo mật (RLS) và kích hoạt tính năng Realtime.

```sql
-- 1. Bảng Whitelist Email được phép truy cập hệ thống
CREATE TABLE public.allowed_emails (
  email TEXT PRIMARY KEY,
  note TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bật RLS (Chỉ Service Role hoặc Admin mới sửa được)
ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated users to check their own email"
  ON public.allowed_emails FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- 2. Bảng Profiles người dùng (Mở rộng từ auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view and update own profile"
  ON public.profiles FOR ALL
  TO authenticated
  USING (auth.uid() = id);

-- Trigger tự động tạo profile khi user đăng nhập lần đầu
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Bảng Danh sách Kênh YouTube (Dùng chung toàn hệ thống để tránh trùng lặp WebSub)
CREATE TABLE public.channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  custom_url TEXT,
  websub_status TEXT DEFAULT 'pending', -- 'pending' | 'active' | 'expired'
  websub_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read channels"
  ON public.channels FOR SELECT
  TO authenticated
  USING (TRUE);

-- 4. Bảng Kênh yêu thích của từng User (Whitelist cá nhân & Phân loại kênh)
CREATE TABLE public.user_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  is_selected BOOLEAN DEFAULT FALSE, -- TRUE = Hiển thị trên bảng tin rạp phim
  genre_tag TEXT DEFAULT 'HH2D', -- 'Phim AI' | 'HH2D' | 'Hoạt hình cát' | 'Khác'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel_id)
);

ALTER TABLE public.user_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own channel selections"
  ON public.user_channels FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Bảng Videos (Lưu video từ WebSub & Kết quả phân loại của Gemini)
CREATE TABLE public.videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  is_short BOOLEAN DEFAULT FALSE,
  -- Các trường được phân loại tự động bởi Gemini API:
  video_type TEXT DEFAULT 'episode', -- 'episode' (Tập mới) | 'full_movie' (Phim Full) | 'trailer' (Trailer/Khác)
  detected_genre TEXT, -- 'Phim AI' | 'HH2D' | 'Hoạt hình cát' | 'Khác'
  series_name TEXT, -- Tên bộ phim trích xuất từ tiêu đề (để gom nhóm các tập)
  episode_number INTEGER, -- Số tập trích xuất được (nếu có)
  ai_summary TEXT, -- Cache tóm tắt nội dung từ Gemini
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_videos_channel_published ON public.videos(channel_id, published_at DESC);
CREATE INDEX idx_videos_type ON public.videos(video_type, is_short);

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read videos"
  ON public.videos FOR SELECT
  TO authenticated
  USING (TRUE);

-- 6. Bảng Tiến độ xem phim của từng User
CREATE TABLE public.watch_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES public.videos(video_id) ON DELETE CASCADE,
  progress_seconds INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  last_watched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

ALTER TABLE public.watch_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own watch progress"
  ON public.watch_progress FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 7. Kích hoạt Supabase Realtime cho bảng videos
ALTER PUBLICATION supabase_realtime ADD TABLE public.videos;

-- 8. Bảng Đơn xin cấp quyền truy cập (Access Requests)
CREATE TABLE public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_access_requests_status ON public.access_requests(status, created_at DESC);

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own access request"
  ON public.access_requests FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');