import type { MetadataRoute } from 'next';

/**
 * Web App Manifest chuẩn Next.js App Router cho AniSub PWA (Standalone Window).
 * Màu chủ đạo tuân thủ Theme mặc định `midnight-void` trong `docs/06-UI-UX-GUIDELINES.md`:
 * - background_color: #06070A (--bg-canvas)
 * - theme_color: #E11D48 (--accent-primary — Đỏ điện ảnh)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AniSub — Cinema & Anime Workspace',
    short_name: 'AniSub',
    description:
      'Rạp chiếu Anime & Phim điện ảnh cá nhân tích hợp AI Cinema Insight',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#06070A',
    theme_color: '#E11D48',
    categories: ['entertainment', 'video'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
