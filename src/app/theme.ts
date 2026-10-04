import { useState } from 'react';
const THEME_KEY = 'chatgpt-exams:preferences:v1';
type Theme = 'light' | 'dark';
function readTheme(): Theme {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null');
    if (
      saved &&
      typeof saved === 'object' &&
      'version' in saved &&
      saved.version === 1 &&
      'theme' in saved &&
      (saved.theme === 'light' || saved.theme === 'dark')
    )
      return saved.theme;
  } catch {
    /* Preferência inválida ou storage indisponível: usar preferência do sistema. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyInitialTheme() {
  document.documentElement.dataset.theme = readTheme();
}
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  const [warning, setWarning] = useState(false);
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify({ version: 1, theme: next }));
      setWarning(false);
    } catch {
      setWarning(true);
    }
  }
  return { theme, toggleTheme, warning };
}
