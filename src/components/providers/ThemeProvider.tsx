'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type AniSubThemeId =
  | 'midnight-void'
  | 'deep-abyss'
  | 'velvet-espresso'
  | 'crisp-daylight';

export interface ThemeMeta {
  id: AniSubThemeId;
  label: string;
  description: string;
  swatchBg: string;
  swatchAccent: string;
  isDark: boolean;
}

export const ANISUB_THEMES: ThemeMeta[] = [
  {
    id: 'midnight-void',
    label: 'Midnight Void',
    description: 'Đen sâu rạp chiếu + Đỏ điện ảnh',
    swatchBg: '#06070A',
    swatchAccent: '#E11D48',
    isDark: true,
  },
  {
    id: 'deep-abyss',
    label: 'Deep Abyss',
    description: 'Xanh thẫm đại dương + Xanh ngọc',
    swatchBg: '#040B14',
    swatchAccent: '#22D3EE',
    isDark: true,
  },
  {
    id: 'velvet-espresso',
    label: 'Velvet Espresso',
    description: 'Than ấm + Vàng hổ phách',
    swatchBg: '#110D0B',
    swatchAccent: '#F59E0B',
    isDark: true,
  },
  {
    id: 'crisp-daylight',
    label: 'Crisp Daylight',
    description: 'Sáng tối giản + Xanh ngọc đậm',
    swatchBg: '#F4F5F7',
    swatchAccent: '#0F766E',
    isDark: false,
  },
];

const STORAGE_KEY = 'anisub-workspace-theme';

interface ThemeContextValue {
  theme: AniSubThemeId;
  themeMeta: ThemeMeta;
  setTheme: (theme: AniSubThemeId) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AniSubThemeId>('midnight-void');

  const applyThemeToDom = useCallback((nextTheme: AniSubThemeId) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', nextTheme);
    const meta = ANISUB_THEMES.find((t) => t.id === nextTheme);
    if (meta?.isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as AniSubThemeId | null;
      if (saved && ANISUB_THEMES.some((t) => t.id === saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeState(saved);
        applyThemeToDom(saved);
      } else {
        applyThemeToDom('midnight-void');
      }
    } catch {
      applyThemeToDom('midnight-void');
    }
  }, [applyThemeToDom]);

  const setTheme = useCallback(
    (nextTheme: AniSubThemeId) => {
      setThemeState(nextTheme);
      applyThemeToDom(nextTheme);
      try {
        localStorage.setItem(STORAGE_KEY, nextTheme);
      } catch {
        // Ignore storage errors
      }
    },
    [applyThemeToDom],
  );

  const cycleTheme = useCallback(() => {
    const idx = ANISUB_THEMES.findIndex((t) => t.id === theme);
    const next = ANISUB_THEMES[(idx + 1) % ANISUB_THEMES.length];
    setTheme(next.id);
  }, [theme, setTheme]);

  const themeMeta =
    ANISUB_THEMES.find((t) => t.id === theme) ?? ANISUB_THEMES[0];

  return (
    <ThemeContext.Provider value={{ theme, themeMeta, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme phải được sử dụng bên trong <ThemeProvider>.');
  }
  return ctx;
}
