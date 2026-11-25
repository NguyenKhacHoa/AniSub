# 06 - Đặc tả Kiến trúc Giao diện Unified Cinema Workspace: AniSub

Tài liệu này là **chuẩn mực bắt buộc** cho mọi thành phần giao diện của **AniSub** (kết hợp cùng quy trình kiểm tra tại `.agents/skills/ui-ux/`).

---

## 1. Kiến trúc Unified Cinema Workspace (`100dvh`)

Toàn bộ trải nghiệm rạp chiếu phim được hợp nhất trên **1 màn hình `100dvh`** (`overflow-hidden` khung ngoài, cuộn nội bộ ở vùng trung tâm), loại bỏ chuyển trang rườm rà và **tuyệt đối không sử dụng dữ liệu video giả (mock data) hay ảnh thumbnail giả**.

### 1.1. Thanh Điều Hướng Nổi Thu Gọn (Collapsible Floating Rail)
- **Desktop / Tablet (`md` trở lên):** Thanh nổi cạnh trái rộng `64px` (có nút mở rộng lên `224px`), bo góc `16px`, đặt trên nền `--bg-surface` với viền `--border-subtle`.
- **Mobile (`< md`):** Tự động chuyển thành thanh **Bottom Bar** cố định dưới đáy màn hình (`h-16`, `pb-[env(safe-area-inset-bottom)]`).
- **Thành phần bên trong:**
  1. Logo **AniSub**: Bấm để tải lại toàn trang (`window.location.reload()` giúp PWA nhận ngay bản deploy Vercel mới nhất mà không cần đóng/mở lại app), đồng thời nếu không tích chọn sắp xếp nào (hoặc đang ở mặc định) thì liên tục đảo ngẫu nhiên (`shuffleSeed`) danh sách phim mỗi lần bấm. Bấm lại vào nút sắp xếp đang sáng cũng tự bỏ chọn để chuyển sang chế độ đảo ngẫu nhiên.
  2. Chuyển không gian & chế độ xem: **Đã đăng ký (Rạp Phim)**, **Khám phá YouTube (Explore)**, **Đang Cày Dở**, **Xem sau (`{count}`)**, nút mở **Kho Kênh Đăng Ký**, và nút **Khiên Quản Trị** (dành riêng Admin).
  3. Cụm chấm lọc nhanh 2 thể loại chuẩn: `Phim AI`, `HH2D`.
  4. Cụm đáy: Nút **Đổi Theme** (chọn nhanh 4 bộ Theme) + nút **Tài khoản Google** (Avatar + tên thật, Popover quản lý Whitelist & Đăng xuất).

### 1.2. Không Gian Trung Tâm Biến Hình (Vùng A & Vùng B)
- **Vùng A — Trạng thái 1 (`Command Hub`, khi chưa chọn video):**
  - **Cụm chuyển 3 Không gian chính trên cùng (góc trái):** **`Đã đăng ký`** (`viewMode === 'cinema'`) | **`Khám phá`** (`viewMode === 'explore'`) | **`Phim Chiếu Rạp`** (`viewMode === 'theatrical'`, icon `Clapperboard`). Không gian **`Phim Chiếu Rạp`** hoạt động độc lập, bỏ qua hoàn toàn bộ lọc kênh Đã đăng ký.
  - Ô tìm kiếm nhanh hỗ trợ phím tắt `Ctrl + K` / `⌘K`.
  - Chỉ báo trạng thái kết nối `WebSub Live`, nút xoay **"Cập nhật tập mới"** (kích hoạt Smart Delta Sync khi ở `Đã đăng ký`, hoặc kích hoạt `/api/cinema/discover?force=true` khi ở `Phim Chiếu Rạp`) ngay cạnh bộ đếm phim.
  - **Đã gỡ bỏ hoàn toàn sự trùng lặp:** Cụm tab định dạng bên phải khi ở `Đã đăng ký` chỉ gồm 3 nút: `Tất cả` | `Phim Bộ` | `Phim Full`. Thanh lọc con bên dưới khi ở `Đã đăng ký` chỉ gồm: `Tất cả thể loại` | `Phim AI` | `HH2D` (kèm công tắc `Hiện Trailer`, bộ chọn sắp xếp **`Mới nhất` | `🔥 Phim Hot` | `Xem nhiều nhất` | `Dài nhất` | `Tên A-Z`** và nút `Chưa xem`).
  - **Thanh lọc con 2 nhóm riêng khi ở `Phim Chiếu Rạp` (`viewMode === 'theatrical'`):**
    1. *Nhóm Định dạng rạp:* `Tất cả định dạng` | `Anime / Hoạt hình` | `Phim Người Đóng`.
    2. *Nhóm Thể loại an toàn & Sắp xếp:* `Tất cả thể loại` | `Hành động` | `Phiêu lưu` | `Giả tưởng` | `Tình cảm` | `Viễn tưởng` | `Hài hước` | `Tâm lý`, cùng thanh sắp xếp (**`Mới nhất`** | **`🔥 Phim Hot`** | **`Xem nhiều nhất`** | **`Dài nhất`** | **`Tên A-Z`**) và nút **`Chưa xem`**, ẩn hoàn toàn các nút không liên quan như `Phim AI` hay `Phim Bộ`.
  - **Thẻ Phim Chiếu Rạp & Tải Vô Tận (Unlimited Infinite Scroll):** Hiển thị đúng bộ đếm `Đang hiển thị X / Tổng Y phim chiếu rạp`, gắn badge định dạng thật trên mỗi thẻ (`Anime / Hoạt hình` hoặc `Phim Người Đóng`, không gắn cứng `HH2D`) kèm tối đa 2 tag thể loại phụ, nhãn độ hot **`🔥 Phim Hot` / `⭐ Đáng xem`**, thông số `{lượt xem} • {thời gian đăng}`, và tích hợp Cuộn vô tận (`IntersectionObserver`) + nút **"Tải thêm phim chiếu rạp"** để đào sâu tích lũy không giới hạn sang các trang YouTube tiếp theo.
  - **Thanh "Xem Tiếp" (`ContinueWatchingShelf`) & Lịch Công Chiếu (`UpcomingPremieresShelf`):** Hàng thẻ ngang tối đa 6 video xem dở (`> 30s`, `< 92%`) và thanh Lịch công chiếu (chỉ hiển thị khi có video `is_upcoming = true`, đếm ngược thời gian thực tới `scheduled_start_at`) ngay dưới Command Hub ở tab `Đã đăng ký`.
- **Vùng A — Trạng thái 2 (`Theater Stage`, khi bấm vào một khe phim hoặc Thẻ Bộ Phim):**
  - Thiết kế bố cục 2 cột chuẩn rạp chiếu trên Desktop (`lg:grid-cols-12`, chiều cao cột phải khớp khung video, không làm trôi màn hình phim):
    - *Cột trái (chiếm ~65–70% chiều rộng / 8 cột — hoặc 12 cột khi bật Rạp rộng `T`):* Khung YouTube IFrame Player API `16:9` cố định ở trên cùng, hỗ trợ đồng bộ tiến độ thực từng giây, **Auto-Next** (ưu tiên `watchQueue[0]` rồi tới tập kế tiếp), **Full Screen (`F`)**, **Rạp rộng (`T`)**, nút **Thu nhỏ (`Floating Miniplayer` `360x202px` góc dưới phải — kích hoạt khi bấm nút Thu nhỏ, chuyển tab `Khám phá`/`Phim Chiếu Rạp`, hoặc cuộn quá Vùng A, giữ phát liên tục không unmount kèm nút Play/Pause, Tiếp theo, Phóng to, Đóng)**, nút **Hàng đợi (`N`)**, nút **Bookmark Xem sau**, **Web Media Session API**, thanh công cụ nhanh (**Tua Bỏ Intro `+30s`, `+60s` phím `S`, `+90s`**, **Nhớ & Tự động bỏ qua Intro/Outro theo bộ**, **Khóa Tốc Độ Phát `1x` – `2x`**), dải **Chapters** tự động trích xuất từ mô tả và dải **`⚡ Cảnh đắt giá từ cộng đồng`** (bình luận gắn mốc giờ bấm tua trực tiếp).
    - *Cột phải (chiếm ~30–35% chiều rộng / 4 cột, chiều cao cố định `lg:h-[540px]` với thanh cuộn nội bộ độc lập):*
      1. **Chế độ Hàng đợi phát tức thì (`TheaterQueuePanel`):** Danh sách các video chờ phát từ nút `+ Hàng đợi`, hỗ trợ đổi thứ tự lên/xuống, phát ngay, xóa từng mục hoặc xóa hết.
      2. **Chế độ AI Cinema Insight & Trợ lý Hỏi Đáp (`AiCinemaInsightPanel`):** Gồm 2 tab chuyển đổi mượt (**`Tổng quan & Điểm 100`** với vòng tròn điểm SVG `/100`, 4 thanh chỉ số Cốt truyện/Hình ảnh/Âm thanh/Nhịp độ, mốc thời gian `[MM:SS]` bấm để tua video, Điểm cộng/Điểm trừ cộng đồng, 3 bình luận tiêu biểu; và **`Chat với AI`** với 4 gợi ý hỏi nhanh + khung chat cuộn độc lập).
      3. **Chế độ Danh sách phát Bộ phim (`Series Playlist`):** Bảng cuộn dọc hiển thị tên bộ phim, tổng số tập, nút **`⭐ Theo dõi`**, **`Ẩn`**, nút đảo chiều (**Mới nhất** ↔ **Từ Tập 1**), đánh dấu nổi bật tập đang phát (`▶`), badge **`MỚI`**, và dấu tích đã xem (`✓`).
- **Vùng B — Dòng Chảy Nội Dung Cấu Trúc (`Structured Cinema Rows` & `Series Grid`):**
  - Chỉ hiển thị badge **`CHIẾU RẠP`** (icon `Clapperboard` màu vàng hổ phách trên nền tối) trên góc trái poster khi bản ghi trong database thực sự đã được xác minh cờ `is_theatrical_movie = true` / `[CHIẾU RẠP]` qua Google Search Grounding (`isTheatricalMovie === true && isHorrorOrGore === false`, thời lượng chuẩn rạp 65–165 phút, loại trừ 100% `Phim AI` và video tổng hợp/ghép tập), đi kèm badge độ hot tự động **`🔥 Phim Hot`** (tốc độ tăng view top 15% trong 14 ngày đầu) hoặc **`⭐ Đáng xem`** (tổng view cao bền vững / tỷ lệ tương tác cao / điểm AI `>= 80/100`).
  - **Hiển thị Metadata Engagement (`SeriesCard` & `MovieCard`):** Ngay dưới tên kênh là dòng thông số định dạng tiếng Việt chuẩn YouTube `{số lượt xem} • {thời gian đăng}` (ví dụ `45,2N lượt xem • 1 giờ trước`; với `SeriesCard` là tổng lượt xem toàn bộ bộ phim + thời gian đăng tập mới nhất), giúp nhận diện ngay phim mới và phim đang thịnh hành. Khi chọn **`🔥 Phim Hot`**, lưới tự động lọc nhóm có badge độ hot (hoặc fallback xếp theo tốc độ `viewsPerHour` cao nhất nên không bao giờ trống); khi chọn **`Xem nhiều nhất`**, sắp xếp giảm dần theo `view_count` / `totalViews`.
  - **Hiệu năng Cuộn 60fps (Two-Stage Fast Hydration < 200ms + 30-item Progressive Window Rendering + Thumbnail HD):**
    - **Two-Stage Fast Hydration:** Giai đoạn 1 (SSR) chỉ tải 90 video mới nhất (chỉ SELECT cột nhẹ, loại bỏ `description`, `ai_summary`, `insight_data`) và render ngay 30 thẻ đầu tiên trong `< 200ms`; Giai đoạn 2 tự động chạy ngầm qua `GET /api/workspace` lặp phân trang `.range(from, from + 999)` vượt giới hạn 1.000 dòng PostgREST để nạp đủ 100% kho 6.000+ video vào RAM cho `Ctrl + K` (debounce `250ms`) và gom đủ 100% tập của Phim Bộ.
    - **Thumbnail thật & Chống ảnh placeholder xám 120×90 (`VideoThumbnail`):** Khi đồng bộ YouTube API lưu trực tiếp `standard?.url || high?.url || medium?.url` (không tự ghép cứng `sddefault.jpg` mù quáng); trên giao diện kiểm tra thêm `onLoad` (`naturalWidth <= 120`) để tự động lùi về `hqdefault.jpg`, và nếu cả `hqdefault.jpg` cũng trả về `<= 120px` (video đã bị xóa/ẩn trên YouTube) thì ẩn ngay thẻ chết link (`0ms`) và đánh dấu `is_unavailable = true` ngầm xuống DB.
    - **Ẩn bộ lọc theo ngữ cảnh tab:** Khối `THỂ LOẠI` (`Phim AI`, `HH2D` — đã gộp `2D` vào `HH2D`) ở Sidebar bên trái (`FloatingRail`) chỉ hiển thị khi ở không gian **`Đã đăng ký`** (đồng bộ 2 chiều với thanh lọc ngang `CommandHub`), tự động ẩn hoàn toàn khi chuyển sang `Phim Chiếu Rạp`, `Khám phá`, `Đang Cày Dở` hay `Xem sau`.
    - Mỗi thẻ phim (`SeriesCard`, `MovieCard`, `VideoThumbnail`) được bọc `React.memo`, gỡ bỏ `backdrop-blur` nặng GPU trên thẻ lưới (dùng nền đặc `bg-black/80` / `bg-black/85`) và bật `content-visibility: auto` (`.cinema-card-cv`).
  - Tại tab **`Phim Bộ`**: ưu tiên tuyệt đối gom nhóm theo **`youtube_playlist_id`** (Source of Truth chính thức từ YouTube Playlists để đủ 100% số tập), hiển thị **Lưới Thẻ Bộ Phim (`SeriesGrid`)** trượt dọc với hiệu ứng xếp lớp danh sách phát, ghim nhóm **`⭐ THEO DÕI`** lên đầu, badge góc trái **`🔥 TẬP MỚI`** hoặc **`Đã xem Tập X`**, badge góc phải **`≡ N tập`**, nút **`⭐ Theo dõi`** / **`Ẩn`** và nút khôi phục *"Hiện X bộ đã ẩn"* ở cuối trang.
  - Tại các tab khác (`Tất cả`, `Phim Chiếu Rạp`, `Phim Full`, `Đang cày dở`, `Xem sau`): hiển thị lưới thẻ video thực từ **Full-Catalog In-Memory Store** (`allVideos`), lọc tức thì **0ms** bằng `useMemo` và tự động **lưu/khôi phục vị trí cuộn của từng Tab (`scrollPositionsRef`)**.
  - Tại không gian **Khám phá YouTube (`Explore`)**: gắn **Cuộn Vô Hạn (`IntersectionObserver` + `exploreSentinelRef`)** và nút dự phòng **"Khám phá thêm phim mới"** kèm nút **"+ Đăng ký kênh"** 1 chạm chuyển ngay sang **"Đã theo dõi"**.

### 1.3. Ngăn Kéo Quản Lý Kênh Trượt Ngang (`Slide-over Channel Vault Drawer`)
- Trượt mượt từ cạnh phải vào (`500ms` vào / `350ms` ra) chiếm **75% chiều rộng màn hình** trên Desktop (`w-full lg:w-[75vw]`), làm mờ nền phía sau (`backdrop-blur-md`).
- Chia 2 cột:
  - *Cột trái:*
    - Mục **"Gợi ý kênh Anime Bản Quyền Miễn Phí (Nhiều Movie Chiếu Rạp)"** với ô nhập `@handle` / URL kênh bất kỳ và nút **"Thêm nhanh"** 1 chạm cho 3 kênh chính hãng (**Muse Việt Nam** `@MuseVietNam`, **Ani-One Vietnam** `@AniOneVietnam`, **POPS Anime** `@POPSAnime`) để tự động phân giải Channel ID thật và đồng bộ video từ YouTube Data API v3.
    - Danh sách kênh đồng bộ từ YouTube, nút tổng nổi bật **"Đồng bộ toàn bộ kho phim"** ngay trên header Drawer, nhãn trạng thái **`Tự động đồng bộ mỗi 3 giờ`** kèm mốc **`Cập nhật lúc HH:mm`** và đồng hồ đếm ngược chu kỳ 3 tiếng tiếp theo, nút bấm tay **"Đồng bộ kênh từ YouTube"** luôn sẵn sàng để ép đồng bộ ngay lập tức và nút **"Chạy lại chuẩn hóa phân loại"**.
  - *Cột phải:* Danh sách kênh đang kích hoạt trên AniSub kèm cụm **2 nút Pill Multi-Tag** (`Phim AI`, `HH2D`, bắt buộc giữ tối thiểu 1 nhãn), nút **"Đồng bộ đủ video"** và nút **"Quét AI lại"** riêng cho từng kênh đa nhãn.

### 1.5. Hệ Thống Phản Hồi Tải Toàn Cục & Cài Đặt Ứng Dụng PWA (Standalone App)
- **Thanh tiến trình chuyển trang (`NextTopLoader` trong `src/app/layout.tsx`):** Màu `#14B8A6` (teal), cao `3px`, không hiển thị spinner góc màn hình, tự động kích hoạt khi điều hướng `<Link>` giữa `/`, `/admin`, `/login`.
- **Màn hình khung xương (`src/app/loading.tsx` & `src/app/admin/loading.tsx`):** Skeleton UI đồng bộ 100% bố cục rạp phim và trang quản trị trong lúc Server Component tải dữ liệu.
- **Trạng thái chờ trên nút bấm (Button Pending States):** Mọi nút hành động bất đồng bộ đều hiển thị spinner `Loader2 animate-spin`, đổi nhãn trạng thái và khóa `disabled` chống bấm đúp.
- **Progressive Web App (PWA Standalone Window):** Khai báo Web App Manifest tại `src/app/manifest.ts` (`display: 'standalone'`, `background_color: '#06070A'`, `theme_color: '#E11D48'`), bộ icon rạp chiếu PNG `192x192` & `512x512` (`any` + `maskable`) tại `public/icons/` kèm `src/app/icon.tsx` và `src/app/apple-icon.tsx`, cùng Service Worker pass-through tại `public/sw.js` đăng ký tự động qua `PwaRegister.tsx`.

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

### 2.3. Nhãn thể loại chuẩn cho Tab Đã đăng ký (2 Nhãn Rõ Ràng — Đã gộp `2D` vào `HH2D`)
- `Phim AI`: Tím (`bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/35`)
- `HH2D` (Hoạt hình 2D / Anime & Donghua): Xanh dương (`bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35`)
