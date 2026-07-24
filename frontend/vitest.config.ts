import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Separate from vite.config.ts (dev/build) — most unit tests here are plain deterministic-logic
// tests (2026-07-13 Layout Integrity correction: "avoid fragile screenshot-only checks when
// deterministic width logic can be unit tested"), so the default environment stays the lightweight
// Node one, not jsdom, for every `.test.ts` file.
//
// **Revised, Operational Stabilization Checkpoint (2026-07-24):** that decision covered *width*
// calculation, which genuinely is pure logic — but the Payroll Entry grid's actual header/body/
// totals *cell-ordering* drifted out of alignment in a way no pure-logic test could see (the totals
// row's hand-written JSX simply omitted one column's placeholder cell; `computeColumnWidths`'s own
// 100%-covered pure tests never rendered a single component, so they never had a chance to catch
// it). `.test.tsx` files now also run, under a per-file `// @vitest-environment jsdom` pragma
// (not a global `environment: 'jsdom'`, so every existing `.test.ts` file's lightweight Node
// environment is completely unaffected) — real component rendering is the only way to prove
// header/body/totals cell order actually agrees at runtime, not just in a column-definition array.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
