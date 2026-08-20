import { closeSessionPool } from '../src/app';

// Integration tests in this suite talk to a real Postgres instance (per
// docs/architecture/tech-stack.md's testing philosophy — correctness over mocking the database),
// so allow more time than Jest's 5s default for connection setup + queries.
jest.setTimeout(15000);

/**
 * Reliability Checkpoint 2 — centralized session-pool teardown, so none of the ~71 test files that
 * call `createApp()` need their own copy of this cleanup. Jest gives every test file its own
 * module registry (even under `--runInBand`), and this `setupFilesAfterEnv` file is loaded into
 * that *same* registry alongside the test file itself — so importing `../src/app` here resolves
 * to the exact same module instance (and therefore the exact same lazily-created `sessionPool`,
 * see `app.ts`) that the test file's own `createApp()` call used, not a separate one.
 *
 * Registered at the root level (outside any `describe`), so it runs only after every nested
 * `describe` block's own hooks (e.g. each file's existing `afterAll(() => prisma.$disconnect())`)
 * have already finished — Jest always runs an outer/root `afterAll` after all of a file's nested
 * suites complete, never before. `closeSessionPool()` itself is idempotent and a no-op for the
 * handful of test files that never call `createApp()` at all (no pool was ever created for them
 * to close), so this is safe to run unconditionally for every file.
 */
afterAll(async () => {
  await closeSessionPool();
});
