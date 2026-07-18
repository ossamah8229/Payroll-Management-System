import { defineConfig, devices } from '@playwright/test';
import { FRONTEND_URL } from './tests/e2e/setup/config';

/**
 * AUD-013 (Post-Phase-5 Stabilization Checkpoint 4) — the permanent, committed E2E harness that
 * replaces this project's prior pattern of ad hoc Puppeteer verification scripts recreated (and
 * discarded) every checkpoint. See `tests/e2e/README.md` for the full harness design, database
 * provisioning strategy, and how to run this locally.
 *
 * Chromium only, deliberately — this project's own real-browser verification has always used
 * Chromium/Puppeteer, and expanding to Firefox/WebKit is not "trivial and stable" (this checkpoint's
 * own stated bar) without a reason to believe this codebase has any engine-specific behavior.
 *
 * `workers: 1` — the payroll-lifecycle spec mutates real cycle/entry state end to end (Draft ->
 * Released -> Archived); proving worker isolation for that kind of stateful flow is out of this
 * checkpoint's scope, so this harness stays single-worker rather than assume it.
 */
export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 60_000,
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
});
