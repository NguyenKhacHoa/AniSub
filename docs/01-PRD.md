# 01 - Product Requirements Document (PRD): AniSub

## 1. Tổng quan sản phẩm
- **Tên dự án:** AniSub
- **Mục tiêu:** Giải quyết tình trạng "bội thực" kênh đăng ký cũ trên YouTube bằng cách tạo một không gian rạp chiếu phim cá nhân hóa. Người dùng chỉ chọn lọc các kênh yêu thích (Phim AI, Hoạt hình 2D/HH2D, Hoạt hình cát), hệ thống tự động cập nhật video mới theo thời gian thực và phân loại gọn gàng.
- **Đối tượng sử dụng:** Cá nhân chủ sở hữu và nhóm bạn bè thân thiết được cấp quyền qua danh sách Whitelist.

## 2. Các tính năng cốt lõi (Core Features)

### 2.1. Đăng nhập, Gửi đơn xin duyệt & Quản trị Whitelist (Access Request + Admin Panel)
- **Cổng đăng nhập `/login`:** Đăng nhập bằng tài khoản Google (thông qua Supabase Auth `provider: 'google'`) kèm scope bắt buộc `https://www.googleapis.com/auth/youtube.readonly` và tham số `access_type: 'offline'`, `prompt: 'consent'` để lấy đủ token đồng bộ kênh YouTube.
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

### 2.2. Chọn lọc kênh đăng ký (Channel Curation)
- Kéo toàn bộ danh sách kênh người dùng đã đăng ký trên YouTube về giao diện quản lý.
- Cho phép người dùng tích chọn (Whitelist) những kênh muốn theo dõi trên AniSub.
- Cho phép người dùng gán **Nhãn thể loại mặc định** cho từng kênh (ví dụ: `Phim AI`, `HH2D`, `Hoạt hình cát`, `Khác`).
- Giới hạn tần suất đồng bộ lại danh sách kênh từ YouTube: tối đa 1 lần / 6 tiếng.

### 2.3. Cập nhật Video Thời gian thực & Tự động Phân loại
- Ngay khi kênh được chọn đăng video mới lên YouTube, video xuất hiện trên AniSub trong vài giây thông qua YouTube WebSub.
- Tự động loại bỏ YouTube Shorts (video có thời lượng dưới 60 giây hoặc chứa `#shorts`).
- Tự động gọi Gemini AI để phân tích tiêu đề + mô tả video và phân loại vào các ngăn:
  - **Tập mới:** Các tập phim lẻ mới ra mắt.
  - **Phim Full / Tổng hợp:** Video dài (thường trên 45 phút) hoặc có từ khóa *Full, Trọn bộ, Thuyết minh*.
  - **Trailer / Khác:** Video giới thiệu, hậu trường (có nút ẩn/hiện riêng trên giao diện).

### 2.4. Trải nghiệm Cày phim (Cinema Player)
- Trình phát nhúng YouTube IFrame tối giản, loại bỏ hoàn toàn video gợi ý lan man của YouTube.
- **Tự động lưu tiến độ xem:** Lưu lại số giây đang xem dở của từng video cho riêng từng người dùng để xem tiếp bất cứ lúc nào.
- **Chuyển tập thông minh:** Hiển thị danh sách các tập khác thuộc cùng kênh ngay bên cạnh trình phát và nút *"Tập tiếp theo"* dựa trên số tập do AI trích xuất.
- **Tóm tắt nhanh bằng AI:** Nút bấm gọi Gemini tóm tắt nội dung chính của video trước khi xem (có lưu cache vào database).