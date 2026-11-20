'use client';

import { useEffect } from 'react';

/**
 * Tự động đăng ký Service Worker `/sw.js` phía client để trình duyệt (Chrome/Edge/Safari)
 * kích hoạt nút "Cài đặt AniSub" (Standalone PWA Window) ngay trên thanh địa chỉ.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const registerSw = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        void registration.update();
      } catch (err) {
        console.warn('[AniSub PWA] Không thể đăng ký Service Worker:', err);
      }
    };

    if (document.readyState === 'complete') {
      void registerSw();
    } else {
      window.addEventListener('load', registerSw, { once: true });
      return () => window.removeEventListener('load', registerSw);
    }
  }, []);

  return null;
}
