import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Separate from vite.config.ts (dev/build) — unit tests here are plain deterministic-logic tests
// (2026-07-13 Layout Integrity correction: "avoid fragile screenshot-only checks when
// deterministic width logic can be unit tested"), not component/DOM tests, so no jsdom/happy-dom
// environment is pulled in; the default Node environment is enough and keeps the dependency
// footprint minimal.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
