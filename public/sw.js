// AniSub Progressive Web App — Service Worker (Standalone Pass-Through)
// Thiết kế gọn nhẹ, ưu tiên dữ liệu luôn mới nhất (không cache cứng API động / Auth)

const SW_VERSION = 'anisub-sw-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== SW_VERSION)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Chỉ xử lý request GET cùng origin; bỏ qua mọi API, Auth, WebSub và cross-origin (YouTube/Supabase)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/_next/webpack-hmr')
  ) {
    return;
  }

  // Pass-through trực tiếp qua mạng để đảm bảo dữ liệu phim, tiến độ xem và AI Insight luôn realtime
  event.respondWith(fetch(request));
});
