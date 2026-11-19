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
  - **Đã đăng ký (`Subscribed`):** Video từ các kênh user đã chọn (`is_selected = true`), lọc `Phim AI` / `HH2D`, `Tập mới` (gom nhóm Series Playlist) / `Phim Full`, hỗ trợ **Two-Stage Infinite Scroll** (Giai đoạn 1 phân trang 60 phim/lần từ Supabase DB → Giai đoạn 2 khi chạm đáy DB tự động gọi `POST /api/channels/load-more-all` kéo thêm 50 video cũ/kênh từ YouTube và nạp nối tiếp vô tận cho đến khi cạn lịch sử toàn bộ kênh).
  - **Khám phá YouTube (`Explore`):** Học thói quen từ `watch_progress` + video user Like trên YouTube, nhờ Gemini sinh 3 từ khóa tìm kiếm tiếng Việt đúng gu, lọc bỏ Shorts và đề xuất video từ kênh lạ (cache 6 tiếng, có nút **"Làm mới gợi ý"**) kèm nút **"+ Đăng ký kênh"** 1 chạm đồng bộ thẳng lên YouTube và kho AniSub.

### 2.3. Cập nhật Video Thời gian thực & Tự động Phân loại
- Ngay khi kênh được chọn đăng video mới lên YouTube, video xuất hiện trên AniSub trong vài giây thông qua YouTube WebSub.
- Tự động loại bỏ YouTube Shorts (video có thời lượng dưới 60 giây hoặc chứa `#shorts`).
- Tự động gọi Gemini AI để phân tích tiêu đề + mô tả video và phân loại vào các ngăn:
  - **Tập mới (Series Playlist Grouping):** Tự động nhận diện các tập phim lẻ (`Tập`, `Phần`, `Mùa`, `SS`, `Season`, `Ep`, `Chương`, loại bỏ `Full` / `Trọn bộ` / `Tổng hợp`), chuẩn hóa tên gốc bộ phim (gỡ tiền tố số tập, tên kênh, tên chữ Hán phụ) để gom nhóm thành **Thẻ Bộ Phim (Series Cards)** theo từng cặp `(channel_id, seriesKey)` kèm trạng thái **`🔥 TẬP MỚI`** (ra trong 48h hoặc có tập mới hơn tiến độ đã xem) và tổng số tập.
  - **Phim Full / Tổng hợp:** Video dài (thường trên 45 phút) hoặc có từ khóa *Full, Trọn bộ, Thuyết minh*.
  - **Trailer / Khác:** Video giới thiệu, hậu trường (có nút ẩn/hiện riêng trên giao diện).

### 2.4. Trải nghiệm Cày phim (Cinema Player)
- Trình phát nhúng YouTube IFrame Player API tối giản, loại bỏ hoàn toàn video gợi ý lan man của YouTube.
- **Tự động lưu tiến độ xem:** Lưu lại số giây đang xem dở của từng video cho riêng từng người dùng để xem tiếp bất cứ lúc nào.
- **Chuyển tập thông minh & Danh sách phát Bộ phim (Series Playlist):** Khi mở một Thẻ Bộ Phim, cột phải của `TheaterStage` chuyển sang chế độ **Bảng Danh Sách Tập cuộn dọc** khớp chiều cao khung video, cho phép đảo chiều sắp xếp (**Mới nhất trước** ↔ **Từ Tập 1**), đánh dấu tập đang phát (`▶`), tập mới (`MỚI`), tập đã xem (`✓`), và tự động chuyển tập tiếp theo (**Auto-Next**) khi `YT.PlayerState.ENDED`.
- **Tóm tắt nhanh bằng AI:** Nút bấm gọi Gemini tóm tắt nội dung chính của video trước khi xem (có lưu cache vào database).