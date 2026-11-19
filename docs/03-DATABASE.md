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
  last_cinema_sync_at TIMESTAMPTZ, -- Mốc thời gian Background Auto-Sync kho Phim Chiếu Rạp (chu kỳ 12 giờ)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration bổ sung cột last_cinema_sync_at cho bảng profiles:
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_cinema_sync_at TIMESTAMPTZ;

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
  next_page_token TEXT, -- Token phân trang YouTube playlistItems để kéo thêm 50 video cũ
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration bổ sung cột next_page_token cho DB đã khởi tạo trước đó:
-- ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS next_page_token TEXT;

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read channels"
  ON public.channels FOR SELECT
  TO authenticated
  USING (TRUE);

-- 4. Bảng Kênh yêu thích của từng User (Whitelist cá nhân & Phân loại đa nhãn kênh)
CREATE TABLE public.user_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  is_selected BOOLEAN DEFAULT FALSE, -- TRUE = Hiển thị trên bảng tin rạp phim
  genre_tag TEXT DEFAULT 'HH2D', -- Nhãn chính: 'Phim AI' | 'HH2D'
  genre_tags TEXT[] DEFAULT ARRAY['HH2D']::TEXT[], -- Mảng đa nhãn: {'Phim AI','HH2D'}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel_id)
);

-- Migration tinh gọn sang 2 nhãn ('Phim AI', 'HH2D') cho DB cũ:
-- UPDATE public.videos SET detected_genre = 'HH2D' WHERE detected_genre NOT IN ('Phim AI', 'HH2D');
-- UPDATE public.user_channels SET genre_tag = 'HH2D' WHERE genre_tag NOT IN ('Phim AI', 'HH2D');
-- UPDATE public.user_channels SET genre_tags = ARRAY['HH2D']::TEXT[] WHERE genre_tags IS NULL OR array_length(genre_tags, 1) IS NULL;

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
  detected_genre TEXT, -- 'Phim AI' | 'HH2D'
  series_name TEXT, -- Tên bộ phim trích xuất từ tiêu đề (để gom nhóm các tập)
  episode_number INTEGER, -- Số tập trích xuất được (nếu có)
  ai_summary TEXT, -- Cache tóm tắt nội dung từ Gemini
  insight_data JSONB, -- Cache phân tích đa nguồn AI Cinema Insight (thang 100, transcript, bình luận, storyContext)
  is_manual_tag BOOLEAN DEFAULT FALSE, -- TRUE = Người dùng chỉnh tay (AI bỏ qua khi quét lại)
  is_theatrical_movie BOOLEAN DEFAULT FALSE, -- TRUE = Đã xác minh phát hành rạp thực tế qua Google Search Grounding (và isHorrorOrGore = false)
  theatrical_release_year INTEGER, -- Năm công chiếu tại rạp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration bổ sung cột is_manual_tag, insight_data, is_theatrical_movie và theatrical_release_year cho DB đã khởi tạo trước đó:
-- ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS is_manual_tag BOOLEAN DEFAULT FALSE;
-- ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS insight_data JSONB;
-- ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS is_theatrical_movie BOOLEAN DEFAULT FALSE;
-- ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS theatrical_release_year INTEGER;

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

-- 9. Bảng Cache đề xuất Khám Phá Cá Nhân Hóa (6 tiếng / user)
CREATE TABLE public.explore_cache (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  items JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.explore_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own explore cache"
  ON public.explore_cache FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 10. Bảng Trạng thái Theo Dõi / Ẩn Bộ Phim theo từng User (Series Status)
CREATE TABLE public.user_series_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('following', 'completed', 'hidden')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, series_key)
);

CREATE INDEX idx_user_series_status_user ON public.user_series_status(user_id, status);

ALTER TABLE public.user_series_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own series status"
  ON public.user_series_status FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 11. Bảng Danh sách Lưu Xem Sau (Watch Later / Bookmarks)
CREATE TABLE public.user_watch_later (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES public.videos(video_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

CREATE INDEX idx_user_watch_later_user ON public.user_watch_later(user_id, created_at DESC);

ALTER TABLE public.user_watch_later ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own watch later"
  ON public.user_watch_later FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);