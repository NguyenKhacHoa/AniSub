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
  2. Chuyển không gian & chế độ xem: **Đã đăng ký (Rạp Phim)**, **Khám phá YouTube (Explore)**, **Đang Cày Dở**, **Xem sau (`{count}`)**, nút mở **Kho Kênh Đăng Ký**, và nút **Khiên Quản Trị** (dành riêng Admin).
  3. Cụm chấm lọc nhanh 2 thể loại chuẩn: `Phim AI`, `HH2D`.
  4. Cụm đáy: Nút **Đổi Theme** (chọn nhanh 4 bộ Theme) + nút **Tài khoản Google** (Avatar + tên thật, Popover quản lý Whitelist & Đăng xuất).

### 1.2. Không Gian Trung Tâm Biến Hình (Vùng A & Vùng B)
- **Vùng A — Trạng thái 1 (`Command Hub`, khi chưa chọn video):**
  - Ô tìm kiếm nhanh hỗ trợ phím tắt `Ctrl + K` / `⌘K`.
  - Chỉ báo trạng thái kết nối `WebSub Live`, nút xoay **"Cập nhật tập mới"** (Smart Delta Sync) ngay cạnh bộ đếm phim.
  - Tabs lọc dạng video: `Tất cả` | `Phim Bộ` | `Phim Chiếu Rạp` (icon `Clapperboard`) | `Phim Full`.
  - Công tắc gạt `Hiện Trailer`, các pill lọc danh mục/thể loại (`Tất cả thể loại`, `Phim AI`, `HH2D`, `Phim Chiếu Rạp`), bộ chọn sắp xếp nhanh (**`Mới nhất`** | **`Dài nhất`** | **`Tên A-Z`**) và nút bật/tắt **`Chưa xem`** (ẩn phim đã xem $\ge 90\%$).
  - **Thanh "Xem Tiếp" (`ContinueWatchingShelf`):** Hàng thẻ ngang tối đa 6 video xem dở (`> 30s`, `< 92%`) ngay dưới Command Hub ở tab `Tất cả` & `Phim Bộ`, gồm thanh tiến độ đáy ảnh, thời gian còn lại và nút xóa nhanh.
- **Vùng A — Trạng thái 2 (`Theater Stage`, khi bấm vào một khe phim hoặc Thẻ Bộ Phim):**
  - Thiết kế bố cục 2 cột chuẩn rạp chiếu trên Desktop (`lg:grid-cols-12`, chiều cao cột phải khớp khung video, không làm trôi màn hình phim):
    - *Cột trái (chiếm ~65–70% chiều rộng / 8 cột — hoặc 12 cột khi bật Rạp rộng `T`):* Khung YouTube IFrame Player API `16:9` cố định ở trên cùng, hỗ trợ đồng bộ tiến độ thực từng giây, **Auto-Next** khi `YT.PlayerState.ENDED`, **Full Screen (phím `F`)**, **Theater Wide Mode / Rạp rộng (phím `T`)**, nút **Bookmark Xem sau**, **Floating Mini-Player** (chuyển class `fixed bottom-4 right-4` qua `IntersectionObserver` không unmount player khi cuộn xuống kèm 3 nút Phóng to / Tập tiếp theo / Đóng), **Web Media Session API (`navigator.mediaSession`)**, thanh công cụ nhanh (**Tua Bỏ Intro `+30s`, `+60s` phím `S`, `+90s`** + **Khóa Tốc Độ Phát `1x` – `2x`**), và thanh thông tin tập đang chiếu bên dưới kèm nút bật/tắt **"Phân tích & Đánh giá AI"** (có `AbortController` timeout 20s).
    - *Cột phải (chiếm ~30–35% chiều rộng / 4 cột, chiều cao cố định `lg:h-[540px]` với thanh cuộn nội bộ độc lập):*
      1. **Chế độ AI Cinema Insight & Trợ lý Hỏi Đáp (`AiCinemaInsightPanel`):** Gồm 2 tab chuyển đổi mượt (**`Tổng quan & Điểm 100`** với vòng tròn điểm SVG `/100`, 4 thanh chỉ số Cốt truyện/Hình ảnh/Âm thanh/Nhịp độ, mốc thời gian `[MM:SS]` bấm để tua video, Điểm cộng/Điểm trừ cộng đồng, 3 bình luận tiêu biểu; và **`Chat với AI`** với 4 gợi ý hỏi nhanh + khung chat cuộn độc lập).
      2. **Chế độ Danh sách phát Bộ phim (`Series Playlist`):** Bảng cuộn dọc hiển thị tên bộ phim, tổng số tập, nút **`⭐ Theo dõi`**, **`Ẩn`**, nút đảo chiều (**Mới nhất** ↔ **Từ Tập 1**), đánh dấu nổi bật tập đang phát (`▶`), badge **`MỚI`**, và dấu tích đã xem (`✓`).
- **Vùng B — Dòng Chảy Nội Dung Cấu Trúc (`Structured Cinema Rows` & `Series Grid`):**
  - Tự động hiển thị badge **`CHIẾU RẠP`** (icon `Clapperboard` màu vàng hổ phách trên nền tối) trên góc trái poster của các bộ phim / video thỏa điều kiện **Phim Chiếu Rạp** (chứa từ khóa `movie`, `chiếu rạp`, `the movie`, `bản điện ảnh`, `phim lẻ`, `full movie`, `ova`, `special`, `bản full` hoặc thời lượng $\ge 65$ phút).
  - Tại tab **`Phim Bộ`**: hiển thị **Lưới Thẻ Bộ Phim (`SeriesGrid`)** trượt dọc với hiệu ứng xếp lớp danh sách phát, ghim nhóm **`⭐ THEO DÕI`** lên đầu, badge góc trái **`🔥 TẬP MỚI`** hoặc **`Đã xem Tập X`**, badge góc phải **`≡ N tập`**, nút **`⭐ Theo dõi`** / **`Ẩn`** và nút khôi phục *"Hiện X bộ đã ẩn"* ở cuối trang.
  - Tại các tab khác (`Tất cả`, `Phim Chiếu Rạp`, `Phim Full`, `Đang cày dở`, `Xem sau`): hiển thị lưới thẻ video thực từ **Full-Catalog In-Memory Store** (`allVideos`), lọc tức thì **0ms** bằng `useMemo` và tự động **lưu/khôi phục vị trí cuộn của từng Tab (`scrollPositionsRef`)**.
  - Tại không gian **Khám phá YouTube (`Explore`)**: gắn **Cuộn Vô Hạn (`IntersectionObserver` + `exploreSentinelRef`)** và nút dự phòng **"Khám phá thêm phim mới"** kèm nút **"+ Đăng ký kênh"** 1 chạm chuyển ngay sang **"Đã theo dõi"**.

### 1.3. Ngăn Kéo Quản Lý Kênh Trượt Ngang (`Slide-over Channel Vault Drawer`)
- Trượt mượt từ cạnh phải vào (`500ms` vào / `350ms` ra) chiếm **75% chiều rộng màn hình** trên Desktop (`w-full lg:w-[75vw]`), làm mờ nền phía sau (`backdrop-blur-md`).
- Chia 2 cột:
  - *Cột trái:*
    - Mục **"Gợi ý kênh Anime Bản Quyền Miễn Phí (Nhiều Movie Chiếu Rạp)"** với ô nhập `@handle` / URL kênh bất kỳ và nút **"Thêm nhanh"** 1 chạm cho 3 kênh chính hãng (**Muse Việt Nam** `@MuseVietNam`, **Ani-One Vietnam** `@AniOneVietnam`, **POPS Anime** `@POPSAnime`) để tự động phân giải Channel ID thật và đồng bộ video từ YouTube Data API v3.
    - Danh sách kênh đồng bộ từ YouTube, nút **"Đồng bộ kênh từ YouTube"** kèm bộ đếm cooldown 6 tiếng (`last_synced_at`) ở production và nút **"Quét lại nhãn AI"** toàn bộ.
  - *Cột phải:* Danh sách kênh đang kích hoạt trên AniSub kèm cụm **2 nút Pill Multi-Tag** (`Phim AI`, `HH2D`, bắt buộc giữ tối thiểu 1 nhãn), nút **"Đồng bộ đủ video"** và nút **"Quét AI lại"** riêng cho từng kênh đa nhãn.

### 1.5. Hệ Thống Phản Hồi Tải Toàn Cục (Global Loading Feedback)
- **Thanh tiến trình chuyển trang (`NextTopLoader` trong `src/app/layout.tsx`):** Màu `#14B8A6` (teal), cao `3px`, không hiển thị spinner góc màn hình, tự động kích hoạt khi điều hướng `<Link>` giữa `/`, `/admin`, `/login`.
- **Màn hình khung xương (`src/app/loading.tsx` & `src/app/admin/loading.tsx`):** Skeleton UI đồng bộ 100% bố cục rạp phim và trang quản trị trong lúc Server Component tải dữ liệu.
- **Trạng thái chờ trên nút bấm (Button Pending States):** Mọi nút hành động bất đồng bộ đều hiển thị spinner `Loader2 animate-spin`, đổi nhãn trạng thái và khóa `disabled` chống bấm đúp.

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
