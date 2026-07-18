import { startEnvironment } from './setup/e2e-environment';

/** Playwright's documented `globalSetup` entry point — runs once, before any test file. See
 * `tests/e2e/setup/e2e-environment.ts` for what it actually provisions. */
export default async function globalSetup(): Promise<void> {
  await startEnvironment();
}
