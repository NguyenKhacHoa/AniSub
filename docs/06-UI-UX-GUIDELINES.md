# 06 - Đặc tả Kiến trúc Giao diện Unified Cinema Workspace: AniSub

Tài liệu này là **chuẩn mực bắt buộc** cho mọi thành phần giao diện của **AniSub** (kết hợp cùng quy trình kiểm tra tại `.agents/skills/ui-ux/`).

---

## 1. Kiến trúc Unified Cinema Workspace (`100dvh`)

Toàn bộ trải nghiệm rạp chiếu phim được hợp nhất trên **1 màn hình `100dvh`** (`overflow-hidden` khung ngoài, cuộn nội bộ ở vùng trung tâm), loại bỏ chuyển trang rườm rà và **tuyệt đối không sử dụng dữ liệu video giả (mock data) hay ảnh thumbnail giả**.

### 1.1. Thanh Điều Hướng Nổi Thu Gọn (Collapsible Floating Rail)
- **Desktop / Tablet (`md` trở lên):** Thanh nổi cạnh trái rộng `64px` (có nút mở rộng lên `224px`), bo góc `16px`, đặt trên nền `--bg-surface` với viền `--border-subtle`.
- **Mobile (`< md`):** Tự động chuyển thành thanh **Bottom Bar** cố định dưới đáy màn hình (`h-16`, `pb-[env(safe-area-inset-bottom)]`).
- **Thành phần bên trong:**
  1. Logo **AniSub** (reset về không gian Đã đăng ký).
  2. Chuyển không gian & chế độ xem: **Đã đăng ký (Rạp Phim)**, **Khám phá YouTube (Explore)**, **Đang Cày Dở**, nút mở **Kho Kênh Đăng Ký**, và nút **Khiên Quản Trị** (dành riêng Admin).
  3. Cụm chấm lọc nhanh 2 thể loại chuẩn: `Phim AI`, `HH2D`.
  4. Cụm đáy: Nút **Đổi Theme** (chọn nhanh 4 bộ Theme) + nút **Tài khoản Google** (Avatar + tên thật, Popover quản lý Whitelist & Đăng xuất).

### 1.2. Không Gian Trung Tâm Biến Hình (Vùng A & Vùng B)
- **Vùng A — Trạng thái 1 (`Command Hub`, khi chưa chọn video):**
  - Ô tìm kiếm nhanh hỗ trợ phím tắt `Ctrl + K` / `⌘K`.
  - Chỉ báo trạng thái kết nối `WebSub Live`.
  - Tabs lọc dạng video: `Tất cả` | `Tập mới` | `Phim Full`.
  - Công tắc gạt `Hiện Trailer` và các pill lọc thể loại (`Tất cả thể loại`, `Phim AI`, `HH2D`).
- **Vùng A — Trạng thái 2 (`Theater Stage`, khi bấm vào một khe phim hoặc Thẻ Bộ Phim):**
  - Mở rộng mượt mà thành sân khấu trình chiếu 2 cột:
    - *Cột trái:* Khung YouTube IFrame Player API `16:9` hỗ trợ đồng bộ tiến độ thực từng giây, **Auto-Next** khi `YT.PlayerState.ENDED`, **Full Screen (phím `F`)** và **Theater Wide Mode / Rạp rộng (phím `T`)**.
    - *Cột phải (Video lẻ):* Thông tin tập đang chiếu, tiến độ thời gian thực, nút **Tập tiếp theo**, nút **Tóm tắt nhanh bằng AI** (hiển thị 3 gạch đầu dòng từ cache `ai_summary`), và nút **Đóng trình phát (`X` / `Esc`)**.
    - *Cột phải (Chế độ Danh sách phát Bộ phim — Series Playlist):* Bảng cuộn dọc có chiều cao cố định khớp khung video, hiển thị tên bộ phim, tổng số tập, nút đảo chiều (**Mới nhất** ↔ **Từ Tập 1**), đánh dấu nổi bật tập đang phát (`▶`), badge **`MỚI`**, và dấu tích đã xem (`✓`) đồng bộ từ `watch_progress`.
- **Vùng B — Dòng Chảy Nội Dung Cấu Trúc (`Structured Cinema Rows` & `Series Grid`):**
  - Tại tab **`Tập mới`**: hiển thị **Lưới Thẻ Bộ Phim (`SeriesGrid`)** trượt dọc với hiệu ứng xếp lớp danh sách phát, badge góc trái **`🔥 TẬP MỚI`** hoặc **`Đã xem Tập X`**, badge góc phải **`≡ N tập`**, tên gốc bộ phim, nhãn **`Mới nhất: ...`**, thể loại (`Phim AI` / `HH2D`) và tên kênh.
  - Tại các tab khác: hiển thị khung giữ chỗ cấu trúc sắc nét (không ảnh giả) cho 3 trạng thái thực tế hoặc lưới thẻ video thực từ `public.videos` kèm **Two-Stage Infinite Scroll (DB Pagination → YouTube History Auto-Fetch)**:
    - *Giai đoạn 1:* `IntersectionObserver` tự động nạp 60 phim/lần từ `/api/videos` theo đúng bộ lọc đang xem + nút dự phòng **"Tải thêm phim"** và bộ đếm `Đang hiển thị X / Y phim`.
    - *Giai đoạn 2:* Khi đã chạm đáy kho DB (`loadedCount >= totalCount`) và vẫn còn kênh chưa cạn lịch sử YouTube, tự động gọi `POST /api/channels/load-more-all` (có khóa chống gọi trùng & nút thủ công **"📥 Kéo thêm phim cũ từ YouTube"**) để tiếp tục mở rộng kho phim vô tận, chỉ dừng khi hiển thị *"Đã tải toàn bộ video từ tất cả các kênh"*.

### 1.3. Ngăn Kéo Quản Lý Kênh Trượt Ngang (`Slide-over Channel Vault Drawer`)
- Trượt mượt từ cạnh phải vào (`500ms` vào / `350ms` ra) chiếm **75% chiều rộng màn hình** trên Desktop (`w-full lg:w-[75vw]`), làm mờ nền phía sau (`backdrop-blur-md`).
- Chia 2 cột:
  - *Cột trái:* Danh sách kênh đồng bộ từ YouTube, nút **"Đồng bộ kênh từ YouTube"** kèm bộ đếm cooldown 6 tiếng (`last_synced_at`) ở production và nút **"Quét lại nhãn AI"** toàn bộ.
  - *Cột phải:* Danh sách kênh đang kích hoạt trên AniSub kèm cụm **2 nút Pill Multi-Tag** (`Phim AI`, `HH2D`, bắt buộc giữ tối thiểu 1 nhãn), nút **"+50 video cũ"** (kéo trang tiếp theo qua `next_page_token`) và nút **"Quét AI lại"** riêng cho từng kênh đa nhãn.

### 1.4. Cổng Đăng Nhập (`/login`), Luồng Xin Duyệt & Bảng Điều Khiển Admin (`/admin`)
- **Màn hình `/login`:** Thiết kế tối giản theo phong cách rạp chiếu phim sử dụng đầy đủ CSS Variables của Theme hiện tại, kèm nút đổi nhanh Theme ở góc trên.
  - *Trạng thái 1 (Chưa đăng nhập):* Logo AniSub, mô tả *"Rạp chiếu phim hoạt hình cá nhân hóa từ kênh đăng ký YouTube của bạn"*, nút lớn **"Đăng nhập bằng Google"** (`youtube.readonly`, `access_type: 'offline'`, `prompt: 'consent'`).
  - *Trạng thái 2 (Chưa có trong `allowed_emails` — `?status=unauthorized`):* Tự động kiểm tra bảng `access_requests` để hiển thị 1 trong 3 giao diện:
    1. **Chưa gửi đơn:** Avatar, Tên, Email, ô nhập lời nhắn ngắn (tùy chọn) và nút **"Gửi đơn xin cấp quyền"**.
    2. **Đang chờ duyệt (`pending`):** Trạng thái *"Đã gửi yêu cầu — Đang chờ Admin phê duyệt"*, thời gian gửi và nút **Kiểm tra lại trạng thái**.
    3. **Bị từ chối (`rejected`):** Thông báo từ chối lịch sự và nút **Đăng xuất / Đổi tài khoản**.
- **Khu vực Tài khoản & Nút Admin trên Floating Rail:**
  - Hiển thị Avatar thật + Tên người dùng từ Google; bấm vào mở Popover gồm **Quản lý quyền truy cập (Whitelist)** và **Đăng xuất**.
  - Riêng tài khoản Admin (`ADMIN_EMAIL`) có thêm nút biểu tượng **Khiên Quản Trị (Admin)** dẫn tới `/admin` kèm badge số đơn đang chờ duyệt (`pending`).
- **Trang Quản Trị `/admin`:** Đồng bộ 100% CSS Variables Theme, chia 2 khu vực: **Đơn xin cấp quyền đang chờ (`Pending Requests`)** với nút Phê duyệt / Từ chối 1 chạm, và **Quản lý Thành viên Whitelist (`allowed_emails`)** với form thêm email và `Switch` bật/tắt tức thì.

---

## 2. Hệ thống 4 Bộ Theme & CSS Variables Bắt Buộc

Mọi component UI **bắt buộc** sử dụng các biến CSS dưới đây (tuyệt đối không hardcode mã màu nền/chữ/viền rời rạc) để đảm bảo độ tương phản chữ/nền đạt chuẩn WCAG (>= 4.5:1, chữ sáng sắc nét trên nền tối):

### 2.1. Danh sách 8 Biến CSS Chuẩn
| Biến CSS | Vai trò |
| :--- | :--- |
| `--bg-canvas` | Màu nền chính của toàn bộ Workspace (`100dvh`) |
| `--bg-surface` | Màu bề mặt thẻ, Floating Rail, Command Hub, Drawer |
| `--bg-elevated` | Màu bề mặt nổi (Popover, Dropdown, ô chọn phụ, khung chờ) |
| `--border-subtle` | Đường viền mảnh phân tách khối |
| `--text-primary` | Màu chữ chính, tiêu đề, số liệu (độ tương phản cao nhất) |
| `--text-secondary` | Màu chữ phụ, mô tả ngắn, nhãn phụ (đảm bảo >= 4.5:1 trên `--bg-surface`) |
| `--accent-primary` | Màu nhấn chính cho nút hành động, tab đang chọn, thanh tiến độ |
| `--accent-foreground` | Màu chữ đứng trên nền `--accent-primary` |

### 2.2. Thông số Mã màu Chi tiết 4 Bộ Theme

#### 1) `midnight-void` *(Mặc định — Đen sâu rạp chiếu & Đỏ điện ảnh)*
- `--bg-canvas`: `#06070A`
- `--bg-surface`: `#0F1117`
- `--bg-elevated`: `#171B24`
- `--border-subtle`: `rgba(255, 255, 255, 0.12)`
- `--text-primary`: `#F8FAFC`
- `--text-secondary`: `#CBD5E1`
- `--accent-primary`: `#E11D48`
- `--accent-foreground`: `#FFFFFF`

#### 2) `deep-abyss` *(Xanh thẫm đại dương & Xanh ngọc sáng)*
- `--bg-canvas`: `#040B14`
- `--bg-surface`: `#0B1523`
- `--bg-elevated`: `#122136`
- `--border-subtle`: `rgba(148, 197, 255, 0.16)`
- `--text-primary`: `#F1F7FE`
- `--text-secondary`: `#BACCE0`
- `--accent-primary`: `#22D3EE`
- `--accent-foreground`: `#04131C`

#### 3) `velvet-espresso` *(Than ấm & Vàng hổ phách)*
- `--bg-canvas`: `#110D0B`
- `--bg-surface`: `#1B1512`
- `--bg-elevated`: `#261E19`
- `--border-subtle`: `rgba(245, 222, 195, 0.16)`
- `--text-primary`: `#FDF8F3`
- `--text-secondary`: `#D6C7B8`
- `--accent-primary`: `#F59E0B`
- `--accent-foreground`: `#140D03`

#### 4) `crisp-daylight` *(Sáng tối giản & Xanh ngọc đậm)*
- `--bg-canvas`: `#F4F5F7`
- `--bg-surface`: `#FFFFFF`
- `--bg-elevated`: `#EBEDF2`
- `--border-subtle`: `#D4D7DF`
- `--text-primary`: `#111827`
- `--text-secondary`: `#4B5563`
- `--accent-primary`: `#0F766E`
- `--accent-foreground`: `#FFFFFF`

### 2.3. Nhãn thể loại chuẩn (2 Loại Duy Nhất)
- `Phim AI`: Tím (`bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/35`)
- `HH2D`: Xanh dương (`bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35`)
