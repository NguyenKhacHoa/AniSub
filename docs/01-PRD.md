# 01 - Product Requirements Document (PRD): AniSub

## 1. Tổng quan sản phẩm
- **Tên dự án:** AniSub
- **Mục tiêu:** Giải quyết tình trạng "bội thực" kênh đăng ký cũ trên YouTube bằng cách tạo một không gian rạp chiếu phim cá nhân hóa chia làm 2 không gian: **Phim Đã Đăng Ký** và **Khám Phá Cá Nhân Hóa**. Người dùng chỉ chọn lọc các kênh yêu thích (**Phim AI**, **HH2D**), hệ thống tự động cập nhật video mới theo thời gian thực và phân loại chuẩn xác bằng Gemini Vision.
- **Đối tượng sử dụng:** Cá nhân chủ sở hữu và nhóm bạn bè thân thiết được cấp quyền qua danh sách Whitelist.

## 2. Các tính năng cốt lõi (Core Features)

### 2.1. Đăng nhập, Gửi đơn xin duyệt & Quản trị Whitelist (Access Request + Admin Panel)
- **Cổng đăng nhập `/login`:** Đăng nhập bằng tài khoản Google (thông qua Supabase Auth `provider: 'google'`) kèm scope bắt buộc `https://www.googleapis.com/auth/youtube.readonly` và `https://www.googleapis.com/auth/youtube.force-ssl` cùng tham số `access_type: 'offline'`, `prompt: 'consent'` để đồng bộ kênh và đăng ký kênh mới trực tiếp từ web.
- **Route Callback `/auth/callback` & Proxy bảo vệ (`src/proxy.ts`):**
  - Chưa đăng nhập -> tự động chuyển hướng sang `/login`.
  - Đã đăng nhập nhưng email chưa có trong `allowed_emails` (`is_active = true`) -> chuyển hướng sang `/login?status=unauthorized` và kiểm tra trạng thái trong bảng `access_requests`:
    - *Chưa gửi đơn:* Hiển thị Avatar, Tên, Email, ô nhập lời nhắn ngắn (tùy chọn) và nút **"Gửi đơn xin cấp quyền"** (`status = 'pending'`).
    - *Đang chờ duyệt (`pending`):* Hiển thị *"Đã gửi yêu cầu — Đang chờ Admin phê duyệt"*, thời gian gửi và nút kiểm tra lại trạng thái.
    - *Bị từ chối (`rejected`):* Hiển thị thông báo từ chối lịch sự và nút Đăng xuất / Đổi tài khoản.
  - Hợp lệ -> cho phép truy cập Unified Cinema Workspace (`/`).
- **Bảng điều khiển Quản trị Admin (`/admin`):**
  - Chỉ email Admin (`ADMIN_EMAIL` trong `.env.local`, mặc định `hoa590472@gmail.com`) mới được phép truy cập `/admin`; hiển thị nút biểu tượng Khiên Quản Trị kèm badge đếm số đơn `pending` trên thanh Floating Rail.
  - Gồm 2 khu vực: **Đơn xin cấp quyền đang chờ** (Phê duyệt 1 chạm tự động `UPSERT` vào `allowed_emails` với `is_active = true`, hoặc Từ chối) và **Quản lý Thành viên Whitelist** (thêm email trực tiếp, bật/tắt `Switch`).

### 2.2. Chọn lọc kênh đăng ký, Phân loại 2 Nhãn (`Phim AI` / `HH2D`) & Khám phá Cá nhân hóa
- Kéo toàn bộ danh sách kênh người dùng đã đăng ký trên YouTube về giao diện quản lý (`Channel Vault Drawer`).
- Cho phép người dùng gán **1 hoặc 2 nhãn thể loại (`genre_tags TEXT[]`)** cho từng kênh thông qua 2 nút Pill bật/tắt (`Phim AI`, `HH2D`, giữ tối thiểu 1 nhãn):
  - Nếu kênh chọn **1 nhãn**: tự động gán trực tiếp nhãn đó cho toàn bộ video của kênh.
  - Nếu kênh chọn **2 nhãn**: chạy **100% Gemini Vision** phân tích trực tiếp ảnh thumbnail + metadata để phân biệt `Phim AI` và `HH2D` (bỏ qua các video đã khóa thủ công `is_manual_tag = true`).
- **2 Không gian Rạp Chiếu:**
  - **Đã đăng ký (`Subscribed`):** Nạp **100% toàn bộ kho video** thuộc các kênh user đang chọn (`is_selected = true`) trong **1 lần tải duy nhất** (Server-side segmented fetch `.range()` theo lô 1.000 dòng → **Full-Catalog In-Memory Store**). Chuyển qua lại giữa `Tất cả`, `Phim Bộ` (Series Playlist), `Phim Chiếu Rạp` (Theatrical Movies / OVA), `Phim Full`, `Đang cày dở`, lọc `Phim AI` / `HH2D`, hay tìm kiếm đều xử lý tức thì **0ms** ngay trong bộ nhớ bằng `useMemo`, không gọi lại API, không reset trắng và tự động **lưu/khôi phục vị trí cuộn của từng Tab (Per-Tab Scroll Restoration)**.
  - **Gợi ý kênh Anime Bản Quyền Miễn Phí (Nhiều Movie Chiếu Rạp):** Trong `Channel Vault Drawer`, tích hợp mục thêm nhanh 1 chạm cho 3 kênh Anime bản quyền chính hãng tại Việt Nam (**Muse Việt Nam** `@MuseVietNam`, **Ani-One Vietnam** `@AniOneVietnam`, **POPS Anime** `@POPSAnime`) cùng ô nhập `@handle` / URL kênh bất kỳ để tự động phân giải Channel ID thật và đồng bộ 100% video từ YouTube Data API v3.
  - **Full Channel Sync:** Khi bật kênh mới hoặc đăng ký kênh, hệ thống tự động duyệt hết toàn bộ các trang `nextPageToken` của YouTube `playlistItems.list` từ Tập 1 đến Tập mới nhất trong 1 lần chạy, gom nhóm theo Series và chỉ gửi 1 đại diện / 1 bộ phim qua Gemini Vision.
  - **Khám phá YouTube (`Explore`):** Học thói quen từ `watch_progress` + video user Like trên YouTube, nhờ Gemini sinh 3 từ khóa tìm kiếm tiếng Việt đúng gu (Trang 1 cache 6 tiếng theo `user_id`), lọc bỏ Shorts (`<= 65s`) và đề xuất video từ kênh lạ. Hỗ trợ **Cuộn Vô Hạn (`Infinite Scroll`)** + nút **"Khám phá thêm phim mới"** (Trang ≥ 2 tận dụng `nextPageToken` hoặc nhờ Gemini mở rộng bộ từ khóa mới, tự động lọc trùng `video_id`), nút **"Làm mới gợi ý"** reset về Trang 1 với bộ từ khóa mới, và nút **"+ Đăng ký kênh"** 1 chạm đồng bộ thẳng lên YouTube & đổi sang **"Đã theo dõi"** ngay lập tức.

### 2.3. Cập nhật Video Thời gian thực & Tự động Phân loại
- Ngay khi kênh được chọn đăng video mới lên YouTube, video xuất hiện trên AniSub trong vài giây thông qua YouTube WebSub.
- Tự động loại bỏ YouTube Shorts (video có thời lượng dưới 60 giây hoặc chứa `#shorts`).
- Tự động gọi Gemini AI để phân tích tiêu đề + mô tả video và phân loại vào các ngăn:
  - **Phim Bộ (Series Playlist Grouping):** Tự động nhận diện các tập phim lẻ (`Tập`, `Phần`, `Mùa`, `SS`, `Season`, `Ep`, `Chương`, loại bỏ `Full` / `Trọn bộ` / `Tổng hợp`), chuẩn hóa tên gốc bộ phim (gỡ tiền tố số tập, tên kênh, tên chữ Hán phụ) để gom nhóm thành **Thẻ Bộ Phim (Series Cards)** theo từng cặp `(channel_id, seriesKey)` kèm trạng thái **`🔥 TẬP MỚI`** (ra trong 48h hoặc có tập mới hơn tiến độ đã xem) và tổng số tập.
  - **Phim Chiếu Rạp (`theatrical`):** Tự động nhận diện các bộ Anime Movie / Bản điện ảnh chiếu rạp mà không cần gắn tay từng video khi thỏa mãn ít nhất 1 trong 2 điều kiện: (1) Tiêu đề, `series_name` hoặc thẻ phân loại chứa các từ khóa đặc trưng (`movie`, `chiếu rạp`, `the movie`, `bản điện ảnh`, `phim lẻ`, `full movie`, `ova`, `special`, `bản full`), hoặc (2) Thời lượng video từ **65 phút trở lên** (`duration_seconds >= 3900` giây) thuộc nhóm phim lẻ/bản điện ảnh. Tự động gắn badge **`CHIẾU RẠP`** sắc nét trên thẻ phim.
  - **Phim Full / Tổng hợp:** Video dài (thường trên 45 phút) hoặc có từ khóa *Full, Trọn bộ, Thuyết minh*.
  - **Trailer / Khác:** Video giới thiệu, hậu trường (có nút ẩn/hiện riêng trên giao diện).

### 2.4. Trải nghiệm Cày phim (Cinema Player) & AI Cinema Insight
- **Thanh "Xem Tiếp" (Continue Watching Shelf):** Hiển thị ngay đầu rạp chiếu (dưới Command Hub ở tab `Tất cả` và `Phim Bộ`) tối đa 6 video đang xem dở (`> 30s` và `< 92%`), hiển thị thanh tiến độ, thời gian còn lại, nút xóa nhanh và bấm vào tua đúng vị trí đang dở.
- Trình phát nhúng YouTube IFrame Player API tối giản, loại bỏ hoàn toàn video gợi ý lan man của YouTube.
- **Điều khiển thông minh (`TheaterStage`):** Cụm nút tua nhanh bỏ qua Intro (`+30s`, `+60s (Bỏ Intro)` phím tắt **`S`**, `+90s`), bộ chọn **Khóa Tốc Độ Phát (`1x` | `1.25x` | `1.5x` | `1.75x` | `2x`)** lưu vào `localStorage` (`anisub_playback_rate`), **Floating Mini-Player** tự động thu nhỏ nổi góc dưới phải khi cuộn quá Vùng A (không unmount `YT.Player` nên phát liên tục không gián đoạn), và tích hợp **Web Media Session API (`navigator.mediaSession`)** cho phím media bàn phím & màn hình khóa thiết bị.
- **Bộ Lọc Nhanh & Sắp Xếp Thông Minh:** Sắp xếp tức thì `Mới nhất` / `Dài nhất` / `Tên A-Z` và nút lọc **`Chưa xem`** (ẩn video/bộ phim đã xem $\ge 90\%$) chạy 0ms trên `allVideos`.
- **Danh sách Lưu Xem Sau (`user_watch_later`):** Nút Bookmark 1 chạm trên từng thẻ phim & thanh điều khiển `TheaterStage`, cùng tab **`Xem sau ({count})`** trên thanh điều hướng.
- **Theo Dõi & Ẩn Bớt Bộ Phim (`user_series_status`):** Cho phép bấm **`⭐ Theo dõi`** để ghim bộ phim lên nhóm đầu tiên của tab `Phim Bộ` hoặc **`Ẩn`** để thu gọn khỏi lưới chính (kèm nút *"Hiện X bộ đã ẩn"* ở cuối trang).
- **Smart Delta Sync:** Tự động chạy ngầm kiểm tra 10 video mới nhất/kênh khi mở app sau ≥ 60 phút (và có nút **"Cập nhật tập mới"** ngay trên Command Hub) để nạp tập mới không làm gián đoạn trình phát.
- **Tự động lưu tiến độ xem:** Lưu lại số giây đang xem dở của từng video cho riêng từng người dùng để xem tiếp bất cứ lúc nào.
- **Chuyển tập thông minh & Danh sách phát Bộ phim (Series Playlist):** Khi mở một Thẻ Bộ Phim, cột phải của `TheaterStage` chuyển sang chế độ **Bảng Danh Sách Tập cuộn dọc** khớp chiều cao khung video, cho phép đảo chiều sắp xếp (**Mới nhất trước** ↔ **Từ Tập 1**), đánh dấu tập đang phát (`▶`), tập mới (`MỚI`), tập đã xem (`✓`), và tự động chuyển tập tiếp theo (**Auto-Next**) khi `YT.PlayerState.ENDED`.
- **AI Cinema Insight & Interactive Assistant (`AiCinemaInsightPanel`):**
  - Bố cục 2 cột ngang hàng trình phát (`TheaterStage` 12 cột trên Desktop: Cột trái 8 cột trình phát cố định tầm nhìn, Cột phải 4 cột chứa Bảng Phân Tích & Khung Chat AI với thanh cuộn độc lập).
  - Kết hợp đa nguồn thực tế: đọc lời thoại/phụ đề thực tế bên trong video (`Transcript` kèm mốc `[MM:SS]`, lấy mẫu thông minh Đầu-Giữa-Cuối tối đa 3.500 ký tự cho cả phim dài 11–12 tiếng) + quét 25 bình luận YouTube nhiều lượt thích nhất + chấm điểm thang 100 (`overallScore`, 4 `metrics`: Cốt truyện, Hình ảnh, Âm thanh, Nhịp độ) + `highlights` bấm để tua trình phát + `communityPros/Cons` + `featuredComments` + khung **Chat với AI** hỏi đáp trực tiếp theo ngữ cảnh tập phim (`storyContext`), cache 7 ngày trong Supabase (`videos.insight_data`).