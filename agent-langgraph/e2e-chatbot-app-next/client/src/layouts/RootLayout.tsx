import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';

const LIGHT_THEME_COLOR = 'hsl(220deg 20% 98%)';
const DARK_THEME_COLOR = 'hsl(222deg 28% 8%)';

export default function RootLayout() {
  useEffect(() => {
    // Update theme color meta tag when theme changes
    const html = document.documentElement;
    const meta = document.getElementById('theme-color-meta');

    if (!meta) return;

    const updateThemeColor = () => {
      const isDark = html.classList.contains('dark');
      meta.setAttribute(
        'content',
        isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
      );
    };

    const observer = new MutationObserver(updateThemeColor);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    updateThemeColor();

    return () => observer.disconnect();
  }, []);

  return <Outlet />;
}
