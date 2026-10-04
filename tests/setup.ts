import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import viteConfig from '../vite.config';
// Vitest redefine BASE_URL para '/'; exercitar o valor real do build.
vi.stubEnv('BASE_URL', viteConfig.base!);
afterEach(() => {
  cleanup();
  localStorage.clear();
});
