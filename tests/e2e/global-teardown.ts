import { stopEnvironment } from './setup/e2e-environment';

/** Playwright's documented `globalTeardown` entry point — runs once after every test file has
 * finished (pass or fail). See `tests/e2e/setup/e2e-environment.ts` for the corresponding
 * `stopEnvironment`'s own cleanup guarantees. */
export default async function globalTeardown(): Promise<void> {
  await stopEnvironment();
}
