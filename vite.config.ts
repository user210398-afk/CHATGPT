import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  base: '/CHATGPT/',
  publicDir: '../public',
  // Vite HMR injects development styles/scripts. Production retains the strict meta CSP.
  plugins: [
    {
      name: 'development-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>/, '');
      },
    },
  ],
  build: { outDir: '../dist', emptyOutDir: true },
});
