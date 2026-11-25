# 🎬 AniSub — Rạp Chiếu Phim Cá Nhân Hóa Từ Kênh YouTube Của Bạn

> **AniSub** là nền tảng rạp chiếu phim cá nhân hóa giúp bạn chọn lọc riêng các kênh **Phim AI** và **Hoạt Hình 2D (HH2D)** yêu thích từ tài khoản YouTube, tự động gom tập thành từng bộ phim (**Series Playlist**), phân loại thị giác bằng **Gemini Vision**, lưu tiến độ xem thực theo tài khoản và săn thêm kênh mới hợp gu — hoàn toàn không còn quảng cáo rác hay video gợi ý lan man của YouTube.

---

## Mục Lục

- [Phần I: Hướng Dẫn Sử Dụng Dành Cho Người Xem (Bạn Bè)](#phần-i-hướng-dẫn-sử-dụng-dành-cho-người-xem-bạn-bè)
  - [1. AniSub khác gì so với xem trực tiếp trên YouTube?](#1-anisub-khác-gì-so-với-xem-trực-tiếp-trên-youtube)
  - [2. Đăng nhập Google & Xin cấp quyền truy cập (Whitelist)](#2-đăng-nhập-google--xin-cấp-quyền-truy-cập-whitelist)
  - [3. Thiết lập Kho Kênh & Phân loại Phim AI / HH2D](#3-thiết-lập-kho-kênh--phân-loại-phim-ai--hh2d)
  - [4. Cày phim chuẩn rạp chiếu trên Unified Cinema Workspace](#4-cày-phim-chuẩn-rạp-chiếu-trên-unified-cinema-workspace)
  - [5. Khám Phá YouTube — Săn kênh mới đúng gu cá nhân](#5-khám-phá-youtube--săn-kênh-mới-đúng-gu-cá-nhân)
  - [6. Bảng Phím Tắt Nhanh](#6-bảng-phím-tắt-nhanh)
- [Phần II: Hướng Dẫn Cài Đặt, Cấu Hình & Deploy Từ A → Z (Admin / Dev)](#phần-ii-hướng-dẫn-cài-đặt-cấu-hình--deploy-từ-a--z-admin--dev)
  - [1. Kiến trúc hệ thống & Tech Stack](#1-kiến-trúc-hệ-thống--tech-stack)
  - [2. Tạo dự án Google Cloud Console (YouTube Data API v3 & OAuth)](#2-tạo-dự-án-google-cloud-console-youtube-data-api-v3--oauth)
  - [3. Lấy Gemini API Key từ Google AI Studio](#3-lấy-gemini-api-key-từ-google-ai-studio)
  - [4. Thiết lập Supabase (Auth, Redirect URLs & SQL Schema + RLS)](#4-thiết-lập-supabase-auth-redirect-urls--sql-schema--rls)
  - [5. Cấu hình biến môi trường (`.env.local`) & Chạy Local](#5-cấu-hình-biến-môi-trường-envlocal--chạy-local)
  - [6. Deploy lên Vercel & Cập nhật Domain Redirect URI](#6-deploy-lên-vercel--cập-nhật-domain-redirect-uri)
  - [7. Hướng dẫn Quản trị viên duyệt thành viên tại `/admin`](#7-hướng-dẫn-quản-trị-viên-duyệt-thành-viên-tại-admin)

---

# Phần I: Hướng Dẫn Sử Dụng Dành Cho Người Xem (Bạn Bè)

## 1. AniSub khác gì so với xem trực tiếp trên YouTube?

| Trải nghiệm | YouTube mặc định | AniSub |
| :--- | :--- | :--- |
| **Bội thực kênh đăng ký** | Hàng trăm kênh đủ thể loại trộn lẫn | Chỉ hiển thị đúng các kênh **Phim AI / HH2D** bạn chọn bật |
| **Tìm tập cũ / Xem theo bộ** | Phải cuộn tìm từng tập rời rạc | Tự động gom thành **Thẻ Bộ Phim (Series Playlist)**, đảo chiều **Mới nhất ↔ Từ Tập 1** |
| **Bỏ qua YouTube Shorts** | Shorts chen ngang bảng tin | Tự động lọc bỏ 100% YouTube Shorts |
| **Phân biệt Phim AI & HH2D** | Không phân loại | **Gemini Vision** soi ảnh bìa phân tách rõ `Phim AI` và `HH2D`, đổi 1 chạm lan truyền cả bộ |
| **Trải nghiệm cày phim** | Đề xuất lan man, quên tốc độ khi đổi tập | **Khóa tốc độ phát**, **Tua bỏ Intro (`S`)**, **Mini-Player nổi**, **Tóm tắt AI không spoil**, tự động chuyển tập |

## 2. Đăng nhập Google & Xin cấp quyền truy cập (Whitelist)

AniSub là rạp chiếu phim riêng tư dành cho chủ sở hữu và nhóm bạn bè được phê duyệt:

1. Truy cập địa chỉ web AniSub và bấm **"Đăng nhập bằng Google"**.
2. Cấp quyền đọc danh sách kênh đã đăng ký YouTube (`youtube.readonly`) và đăng ký kênh mới (`youtube.force-ssl`) để AniSub đồng bộ kênh giúp bạn.
3. **Nếu email của bạn đã có trong Whitelist:** Hệ thống đưa bạn vào thẳng Rạp Chiếu (`/`).
4. **Nếu email chưa được duyệt (`/login?status=unauthorized`):**
   - Nhập lời nhắn ngắn (tùy chọn, ví dụ *"Mình là Nam đây, duyệt giúp nhé!"*) và bấm **"Gửi đơn xin cấp quyền"**.
   - Sau khi Admin phê duyệt, bấm **"Kiểm tra lại trạng thái"** (hoặc tải lại trang) để vào xem phim ngay.
5. *Lưu ý phiên Google:* Token YouTube của Google có thời hạn nhất định. Nếu bấm đồng bộ kênh hoặc đăng ký kênh mới thấy thông báo hết hạn phiên, chỉ cần bấm nút **"Đăng nhập lại"** trên thông báo để làm mới trong 2 giây.

## 3. Thiết lập Kho Kênh, Kênh Anime Bản Quyền & Phân loại `Phim AI` / `HH2D`

1. Bấm biểu tượng **Kho Kênh** trên thanh điều hướng bên trái (hoặc thanh dưới cùng trên điện thoại).
2. **Thêm nhanh Kênh Anime Bản Quyền Miễn Phí (Nhiều Movie Chiếu Rạp):**
   - Ngay đầu cột trái có mục gợi ý 3 kênh Anime bản quyền chính hãng tại Việt Nam: **Muse Việt Nam** (`@MuseVietNam`), **Ani-One Vietnam** (`@AniOneVietnam`) và **POPS Anime** (`@POPSAnime`), cùng ô nhập `@handle` / URL kênh bất kỳ.
   - Bấm **"Thêm nhanh"** 1 chạm để tự động phân giải kênh thật và đồng bộ toàn bộ video từ YouTube API vào AniSub.
3. Hoặc bấm **"Đồng bộ kênh từ YouTube"** để kéo toàn bộ danh sách kênh bạn đang theo dõi trên YouTube về AniSub, rồi gạt công tắc bật những kênh bạn muốn đưa vào rạp chiếu.
4. Ở cột phải (**Kênh đang kích hoạt**), gắn nhãn thể loại cho từng kênh bằng 2 nút Pill:
   - **Chọn 1 nhãn (`Phim AI` hoặc `HH2D`):** Gán thẳng 100% video của kênh theo nhãn đó.
   - **Chọn cả 2 nhãn (`Phim AI` + `HH2D`):** Gemini Vision tự động phân tích ảnh bìa theo từng bộ phim (1 đại diện / 1 Series) để tách chuẩn xác `Phim AI` (đồ họa tả thực/3D AI không viền mực) và `HH2D` (tranh vẽ 2D/Manhua có nét viền lineart), đồng thời nhận diện cờ `isMovie` cho các bản điện ảnh chiếu rạp.
5. **Hệ thống Phân loại Chuẩn xác 3 Tầng (Channel Lock + Series Inheritance + TMDB/AniList Grounding):**
   - Trong `Channel Vault Drawer`, có thể chọn **Khóa kênh (`AUTO` | `HH2D` | `2D` | `PHIM_AI`)** để 100% video mới từ kênh đó nhận đúng phân loại mà không bị AI đoán lệch tập, hoặc bấm **"Chạy lại chuẩn hóa phân loại"** cho toàn bộ kho phim.
   - Khi đổi tag 1 chạm trên thẻ phim, AniSub cập nhật Optimistic UI 0ms cho toàn bộ các tập cùng bộ phim và gợi ý nút **"Áp dụng cho cả kênh"** (Smart Learn on Manual Fix).
   - Riêng mục **Phim Chiếu Rạp** bắt buộc đối chiếu tên gốc trên **TMDB / AniList / IMDb** qua Google Search Grounding, gắn chuẩn `Anime / Hoạt hình` hoặc `Phim Người Đóng` cùng tối đa 2 thể loại an toàn.

## 4. Cày phim chuẩn rạp chiếu trên Unified Cinema Workspace

- **3 Không gian Rạp Chiếu Chính (`Đã đăng ký` | `Khám phá` | `Phim Chiếu Rạp`):** Toàn bộ kho phim được nạp sẵn trong bộ nhớ. Bạn có thể chuyển qua lại tức thì (**0ms**) giữa:
  - **`Đã đăng ký`**: Chỉ hiển thị video thuộc các kênh bạn bật theo dõi (`Tất cả` | `Phim Bộ` | `Phim Full`), lọc `Phim AI` / `HH2D`.
  - **`Khám phá`**: Săn kênh YouTube mới hợp gu cá nhân từ lịch sử xem & Like.
  - **`Phim Chiếu Rạp`**: Không gian điện ảnh độc lập không giới hạn số lượng phim — tự động săn tích lũy liên tục theo 5 từ khóa & `nextPageToken` trên YouTube (đón nhận cả **`Anime / Hoạt hình`** lẫn **`Phim Người Đóng` Live-Action** thời lượng 65–165 phút) qua Background Auto-Sync 12h, Vercel Cron Job hằng ngày (`0 2 * * *`) và **tải vô tận (Infinite Scroll + nút "Tải thêm phim chiếu rạp")**; được Gemini xác minh phát hành rạp thực tế qua Google Search Grounding kèm **Chính sách Chặn Kinh Dị 2 Lớp (chỉ áp dụng riêng cho Phim Chiếu Rạp, giữ nguyên tự do 100% cho `HH2D` và `Phim AI`)** và bộ lọc 2 nhóm (Định dạng + 7 thể loại an toàn).
- **Bộ lọc nhanh, Sắp xếp thông minh & Nhãn độ hot tự động (`🔥 Phim Hot` / `⭐ Đáng xem`):** Lọc theo **`Phim AI` / `HH2D`** (khi ở `Đã đăng ký`) hoặc theo thể loại phim rạp an toàn (khi ở `Phim Chiếu Rạp`), hiển thị lượt xem & thời gian đăng trên mọi thẻ phim (`45,2N lượt xem • 1 giờ trước`), tự động chấm độ hot theo vận tốc view + tương tác + điểm AI (hỗ trợ nạp bù toàn bộ kho cũ qua `/api/videos/backfill` 250 video/lượt ngay khi bấm **"Cập nhật tập mới"**), lọc **`🔥 Phim Hot`** / sắp xếp **`Xem nhiều nhất`**, **`Mới nhất`**, **`Dài nhất`**, **`Tên A-Z`**, hoặc bật nút **`Chưa xem`** để ẩn toàn bộ phim đã xem xong ($\ge 90\%$).
- **Thanh "Xem Tiếp" (Continue Watching):** Nằm ngay đầu rạp chiếu (tối đa 6 phim gần nhất đang xem dở), hiển thị thời gian còn lại — bấm vào là tua thẳng đến đúng giây đang dở.
- **Kiến trúc Hiệu năng 60fps, 2-Phase Micro-Batch Sync & Chống ảnh xám 120×90:** Two-Stage Fast Hydration (`< 200ms` First Paint với 90 video mới nhất, nạp ngầm 100% kho 6.000+ phim qua `.range(from, from + 999)`), nút tổng **"Đồng bộ toàn bộ kho phim"** trên header Kho Kênh chạy tuần tự qua 100% kênh đang bật theo 2 pha siêu nhanh (`/api/channels/sync`: lô 6 YouTube Playlists/lượt → 3 trang `uploads`/lượt tới Tập 1, tự động fallback cột thiếu trên Supabase, chống treo & chống timeout Vercel 100%), **Playlist Source-of-Truth Grouping** + Normalized Unicode NFC, **YouTube 120×90 Placeholder Detection** (`onLoad naturalWidth <= 120` tự lùi `hqdefault.jpg` và ẩn video chết link `is_unavailable = true`), **Render cuốn chiếu 30 thẻ/lô (`rootMargin: 800px`)** + `React.memo` + `content-visibility: auto` + Debounce tìm kiếm `250ms` + **Optimistic UI 0ms**.
- **Lưu Xem Sau (Bookmark):** Bấm biểu tượng **Bookmark** trên góc thẻ phim hoặc trên trình phát để lưu vào mục **`Xem sau`** trên thanh điều hướng.
- **Trình phát `TheaterStage` 2 cột & AI Cinema Insight:**
  - **Bố cục 2 cột ngang hàng:** Cột trái giữ trình phát video cố định tầm nhìn; cột phải hiển thị **Bảng Phân Tích & Khung Chat AI** (hoặc **Danh Sách Tập Series Playlist**) với thanh cuộn độc lập.
  - **AI Cinema Insight & Trợ lý Hỏi Đáp:** Tự động đọc lời thoại/phụ đề thực tế bên trong video (`Transcript` kèm mốc `[MM:SS]` bấm để tua nhanh), quét 25 bình luận nhiều like nhất từ YouTube, chấm điểm thang **100** (kèm 4 chỉ số *Cốt truyện, Hình ảnh, Âm thanh, Nhịp độ*), tổng hợp *Điểm cộng / Điểm trừ cộng đồng*, và cho phép **Chat hỏi đáp trực tiếp với AI** theo ngữ cảnh tập phim (cache 7 ngày trên Supabase).
  - **Tua bỏ Intro 1 chạm:** Các nút `+30s`, **`+60s (Bỏ Intro)`** (phím **`S`**), `+90s`.
  - **Khóa tốc độ phát (`1x` – `2x`):** Chọn tốc độ ưa thích một lần, AniSub tự lưu và giữ nguyên tốc độ đó cho mọi tập kế tiếp khi **Auto-Next**.
  - **Floating Mini-Player:** Khi đang xem mà cuộn xuống tìm phim khác, khung video tự thu nhỏ nổi góc dưới bên phải và phát liên tục không bị gián đoạn.
  - **Điều khiển Media hệ thống:** Hỗ trợ phím Play/Pause/Next/Prev trên bàn phím và màn hình khóa điện thoại qua Web Media Session API.
- **Tự động đồng bộ 24/7 mỗi 3 tiếng (3-Hour Automated Sync Pipeline):** GitHub Actions (`.github/workflows/auto-sync.yml`, lịch `0 */3 * * *`) tự động gọi `/api/cron/auto-sync` (xác thực `CRON_SECRET`, chạy bằng Supabase Service Role không phụ thuộc trình duyệt) để kéo tập mới, đồng bộ YouTube Playlists, cập nhật lượt xem/`🔥 Phim Hot` và quét Phim Chiếu Rạp mỗi 3 tiếng/lần. Trên giao diện cũng hiển thị đồng hồ đếm ngược 3 giờ kèm nút **"Cập nhật tập mới"** / **"Đồng bộ toàn bộ kho phim"** để ép đồng bộ ngay bất cứ lúc nào.

## 5. Khám Phá YouTube — Săn kênh mới đúng gu cá nhân

1. Chuyển sang không gian **Khám phá YouTube** (biểu tượng La bàn).
2. AI tự học từ lịch sử xem trên AniSub + các video bạn từng bấm Like trên YouTube để đề xuất video từ **những kênh bạn chưa theo dõi** (đã lọc bỏ Shorts).
3. Cuộn xuống cuối trang để hệ thống tự động tải thêm vô hạn (hoặc bấm **"Khám phá thêm phim mới"**).
4. Bấm **"Làm mới gợi ý"** nếu muốn AI sinh bộ từ khóa săn kênh hoàn toàn mới.
5. Thấy kênh hay? Bấm **"+ Đăng ký kênh"** ngay trên thẻ phim để đăng ký thẳng lên YouTube và kéo toàn bộ video của kênh đó vào AniSub.

## 6. Bảng Phím Tắt Nhanh

| Phím tắt | Tác dụng |
| :--- | :--- |
| `Ctrl + K` / `⌘ + K` | Focus nhanh vào ô tìm kiếm phim / kênh |
| `S` | Tua nhanh `+60s` (Bỏ qua Intro) khi đang mở trình phát |
| `T` | Bật / tắt chế độ **Rạp rộng (Theater Wide Mode)** |
| `F` | Bật / tắt **Toàn màn hình (Full Screen)** |
| `Esc` | Đóng trình phát `TheaterStage` |
| Phím Media (`⏯`, `⏭`, `⏮`) | Phát/Dừng, chuyển tập kế tiếp/trước đó (Web Media Session) |

---

# Phần II: Hướng Dẫn Cài Đặt, Cấu Hình & Deploy Từ A → Z (Admin / Dev)

## 1. Kiến trúc hệ thống & Tech Stack

- **Framework:** Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS v4)
- **Database & Auth:** Supabase (PostgreSQL, Row Level Security, Google OAuth)
- **AI Engine:** Google Gemini API (`@google/genai` trên `v1beta` — chuỗi fallback tự động `gemini-2.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.8-flash` với timeout 4.5s/model)
- **Video & Metadata:** YouTube Data API v3 + YouTube IFrame Player API
- **UI & Components:** Radix/Base UI, Lucide Icons, Sonner Toast, 4 bộ Theme CSS Variables (`midnight-void`, `deep-abyss`, `velvet-espresso`, `crisp-daylight`)
- **PWA Standalone App:** Next.js App Router Manifest (`src/app/manifest.ts`), bộ icon PNG `192x192` & `512x512` (`public/icons/`), `src/app/icon.tsx`, `src/app/apple-icon.tsx` và Service Worker pass-through (`public/sw.js` + `PwaRegister.tsx`) cho phép cài đặt ứng dụng độc lập trên Windows/macOS/Android/iOS.

## 2. Tạo dự án Google Cloud Console (YouTube Data API v3 & OAuth)

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) → Tạo Project mới tên **`AniSub`**.
2. Vào **APIs & Services → Library**, tìm và bấm **Enable** cho **YouTube Data API v3**.
3. Tạo API Key phía server:
   - Vào **APIs & Services → Credentials → Create Credentials → API Key**.
   - Lưu lại làm biến `YOUTUBE_API_KEY`.
4. Cấu hình **OAuth Consent Screen**:
   - Chọn loại **External**, điền App name là `AniSub`, email hỗ trợ là email của bạn.
   - Ở bước **Scopes**, bấm **Add or Remove Scopes** và thêm 2 quyền:
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/youtube.force-ssl`
   - **Nếu dùng nội bộ với bạn bè (< 100 người):** Giữ trạng thái ở chế độ **Testing** và vào mục **Test users** thêm từng email Google của bạn bè (không cần qua quy trình Google Verification).
   - **Nếu muốn mở rộng:** Chuyển sang **Publish App** và gửi xác minh OAuth.
5. Tạo **OAuth Client ID**:
   - Vào **Credentials → Create Credentials → OAuth client ID** → Chọn **Web application**.
   - Tại **Authorized redirect URIs**, điền Callback URL từ Supabase Auth:
     ```text
     https://<PROJECT_REF>.supabase.co/auth/v1/callback
     ```
   - Lưu lại **Client ID** và **Client Secret**.

## 3. Lấy Gemini API Key từ Google AI Studio

1. Truy cập [Google AI Studio](https://aistudio.google.com/apikey).
2. Bấm **Create API Key** → Chọn project vừa tạo (hoặc tạo mới).
3. Copy khóa API để điền vào biến `GEMINI_API_KEY`.

## 4. Thiết lập Supabase (Auth, Redirect URLs & SQL Schema + RLS)

### 4.1. Cấu hình Google Auth Provider & Redirect URLs
1. Tạo Project mới trên [Supabase](https://supabase.com/).
2. Vào **Authentication → Providers → Google**:
   - Bật **Enable Sign in with Google**.
   - Dán **Client ID** và **Client Secret** từ Google Cloud Console vào → Bấm **Save**.
3. Vào **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000` (khi deploy đổi thành `https://<your-domain>.vercel.app`).
   - **Redirect URLs:** Thêm cả 2 URL sau:
     ```text
     http://localhost:3000/auth/callback
     https://<your-domain>.vercel.app/auth/callback
     ```

### 4.2. Chạy SQL khởi tạo toàn bộ Database & RLS
Vào **Supabase → SQL Editor → New query**, dán và chạy toàn bộ đoạn SQL sau:

```sql
-- 1. Bảng Whitelist Email được phép truy cập hệ thống
CREATE TABLE IF NOT EXISTS public.allowed_emails (
  email TEXT PRIMARY KEY,
  note TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow authenticated users to check their own email"
  ON public.allowed_emails FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- 2. Bảng Profiles người dùng (Mở rộng từ auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Bảng Danh sách Kênh YouTube (Dùng chung toàn hệ thống)
CREATE TABLE IF NOT EXISTS public.channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  custom_url TEXT,
  websub_status TEXT DEFAULT 'pending',
  websub_expires_at TIMESTAMPTZ,
  next_page_token TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read channels"
  ON public.channels FOR SELECT
  TO authenticated
  USING (TRUE);

-- 4. Bảng Kênh yêu thích của từng User (Đa nhãn Phim AI / HH2D)
CREATE TABLE IF NOT EXISTS public.user_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  is_selected BOOLEAN DEFAULT FALSE,
  genre_tag TEXT DEFAULT 'HH2D',
  genre_tags TEXT[] DEFAULT ARRAY['HH2D']::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel_id)
);

ALTER TABLE public.user_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own channel selections"
  ON public.user_channels FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Bảng Videos (Dùng chung toàn hệ thống)
CREATE TABLE IF NOT EXISTS public.videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  is_short BOOLEAN DEFAULT FALSE,
  video_type TEXT DEFAULT 'episode',
  detected_genre TEXT,
  series_name TEXT,
  episode_number INTEGER,
  ai_summary TEXT,
  is_manual_tag BOOLEAN DEFAULT FALSE,
  youtube_playlist_id TEXT,
  playlist_position INTEGER,
  view_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  hot_badge TEXT,
  hot_score NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_channel_published ON public.videos(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_type ON public.videos(video_type, is_short);
CREATE INDEX IF NOT EXISTS idx_videos_playlist ON public.videos(channel_id, youtube_playlist_id, playlist_position);
CREATE INDEX IF NOT EXISTS idx_videos_view_count ON public.videos(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_videos_hot_score ON public.videos(hot_badge, hot_score DESC);

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read videos"
  ON public.videos FOR SELECT
  TO authenticated
  USING (TRUE);

-- 6. Bảng Tiến độ xem phim của từng User
CREATE TABLE IF NOT EXISTS public.watch_progress (
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

-- 7. Bảng Đơn xin cấp quyền truy cập (Access Requests)
CREATE TABLE IF NOT EXISTS public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status ON public.access_requests(status, created_at DESC);

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own access request"
  ON public.access_requests FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- 8. Bảng Cache đề xuất Khám Phá Cá Nhân Hóa (6 tiếng / user)
CREATE TABLE IF NOT EXISTS public.explore_cache (
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

-- 9. Bảng Trạng thái Theo Dõi / Ẩn Bộ Phim (Series Status)
CREATE TABLE IF NOT EXISTS public.user_series_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES public.channels(channel_id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('following', 'completed', 'hidden')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, series_key)
);

CREATE INDEX IF NOT EXISTS idx_user_series_status_user ON public.user_series_status(user_id, status);

ALTER TABLE public.user_series_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own series status"
  ON public.user_series_status FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 10. Bảng Danh sách Lưu Xem Sau (Watch Later / Bookmarks)
CREATE TABLE IF NOT EXISTS public.user_watch_later (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES public.videos(video_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watch_later_user ON public.user_watch_later(user_id, created_at DESC);

ALTER TABLE public.user_watch_later ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own watch later"
  ON public.user_watch_later FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 11. Thêm email Admin đầu tiên vào Whitelist (thay bằng email của bạn)
INSERT INTO public.allowed_emails (email, note, is_active)
VALUES ('email_admin_cua_ban@gmail.com', 'Admin', TRUE)
ON CONFLICT (email) DO NOTHING;
```

## 5. Cấu hình biến môi trường (`.env.local`) & Chạy Local

Tạo file `.env.local` ở thư mục gốc dự án với các biến sau:

| Biến môi trường | Bắt buộc | Mô tả |
| :--- | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Có | URL dự án Supabase (Settings → API → Project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Có | Public Anon Key của Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Có | Service Role Key (chỉ dùng phía server, **không** để lộ ra client) |
| `YOUTUBE_API_KEY` | Có | API Key của YouTube Data API v3 từ Google Cloud Console |
| `GEMINI_API_KEY` | Có | API Key từ Google AI Studio dùng cho Gemini Vision & Tóm tắt AI |
| `ADMIN_EMAIL` | Có | Email quản trị viên được phép truy cập `/admin` (vd: `ban@gmail.com`) |
| `NEXT_PUBLIC_SITE_URL` | Khuyến nghị | URL chính thức của ứng dụng (vd: `http://localhost:3000` hoặc `https://anisub.vercel.app`) |
| `WEBSUB_HUB_SECRET` | Tùy chọn | Chuỗi bí mật HMAC để xác thực chữ ký từ YouTube WebSub |

Cài đặt dependencies và khởi chạy môi trường phát triển:

```bash
npm install
npm run dev
```

Truy cập `http://localhost:3000`.

## 6. Deploy lên Vercel & Cập nhật Domain Redirect URI

1. Đẩy mã nguồn lên GitHub Repository (đảm bảo `.env.local` đã nằm trong `.gitignore`).
2. Đăng nhập [Vercel](https://vercel.com/) → **Add New Project** → Import repository `AniSub`.
3. Tại mục **Environment Variables**, khai báo đầy đủ tất cả các biến môi trường như bảng trên (cập nhật `NEXT_PUBLIC_SITE_URL` thành domain Vercel, vd: `https://anisub.vercel.app`).
4. Bấm **Deploy** và chờ build hoàn tất.
5. **Bước quan trọng sau khi có domain Vercel:**
   - Vào **Supabase → Authentication → URL Configuration**:
     - Cập nhật **Site URL** thành `https://<your-domain>.vercel.app`.
     - Thêm `https://<your-domain>.vercel.app/auth/callback` vào **Redirect URLs**.
   - Nếu Google OAuth đang ở chế độ **Testing**, nhớ thêm email bạn bè vào **Google Cloud Console → OAuth consent screen → Test users**.

## 7. Hướng dẫn Quản trị viên duyệt thành viên tại `/admin`

- Khi đăng nhập bằng tài khoản khớp `ADMIN_EMAIL`, trên thanh **Floating Rail** bên trái sẽ hiện biểu tượng **Khiên Quản Trị (Admin)** kèm badge đỏ đếm số đơn đang chờ duyệt.
- Truy cập `/admin` để:
  1. **Duyệt đơn xin cấp quyền (`Pending Requests`):** Xem tên, email, lời nhắn của bạn bè → bấm **Phê duyệt** (tự động thêm vào `allowed_emails` với `is_active = true`) hoặc **Từ chối**.
  2. **Quản lý Whitelist (`allowed_emails`):** Chủ động thêm sẵn email bạn bè hoặc bật/tắt quyền truy cập tức thì bằng công tắc `Switch`.
