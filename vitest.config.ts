import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/CHATGPT/',
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
