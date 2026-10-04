import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  base: '/CHATGPT/',
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true },
});
