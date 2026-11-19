# DESIGN.md — AniSub (Unified Cinema Workspace)

## 1. Kiến trúc tổng thể (`100dvh`, Zero Mock Data)
- **Unified Cinema Workspace (`src/app/page.tsx`):** Hợp nhất toàn bộ trải nghiệm trên 1 màn hình `100dvh` (`FloatingRail` + Vùng A biến hình + Vùng B dòng chảy cấu trúc + `ChannelVaultDrawer`), không chuyển trang rườm rà và không chứa dữ liệu giả hay ảnh demo.

## 2. Hệ thống 3 Theme CSS Variables (`src/app/globals.css` & `ThemeProvider.tsx`)
- `obsidian-cyan`: Đen sâu (`#06080D`) + Xanh ngọc (`#06B6D4`)
- `warm-editorial`: Than ấm (`#12100E`) + Vàng hổ phách (`#F59E0B`)
- `pure-light`: Sáng tối giản (`#F4F4F6`) + Xanh ngọc đậm (`#0F766E`)

## 3. Thành phần cốt lõi (`src/components/workspace/`)
- `FloatingRail.tsx`: Thanh điều hướng nổi 64px bên trái (mở rộng được trên Desktop, Bottom Bar trên Mobile) với Logo, chuyển chế độ xem (*Rạp Phim*, *Đang Cày Dở*, *Kho Kênh Đăng Ký*), cụm chấm lọc thể loại, Đổi Theme và Tài khoản Google.
- `CommandHub.tsx`: Vùng A Trạng thái 1 (tìm kiếm `Ctrl + K`, trạng thái `WebSub Live`, tab lọc dạng phim, công tắc `Hiện Trailer`, pill thể loại).
- `TheaterStage.tsx`: Vùng A Trạng thái 2 (trình phát YouTube IFrame `16:9`, phím `F` Full Screen, phím `T` Theater Wide Mode, `Tập tiếp theo`, `Tóm tắt nhanh bằng AI`, phím `Esc` / nút `X` đóng).
- `StructuredCinemaRows.tsx`: Vùng B hiển thị 3 trạng thái cấu trúc thực tế (*Chưa đăng nhập Google*, *Chưa chọn kênh theo dõi*, *Sẵn sàng nhận dữ liệu Real-time từ Backend*).
- `ChannelVaultDrawer.tsx`: Ngăn kéo trượt ngang 75% màn hình từ cạnh phải, 2 cột (*Kênh đồng bộ YouTube* + Cooldown 6h | *Kênh kích hoạt AniSub* + Dropdown thể loại mặc định).
