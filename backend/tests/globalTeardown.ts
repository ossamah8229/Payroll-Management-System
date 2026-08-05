import { shutdownTestWorker } from '../src/lib/pdf/worker/pdf-worker-client';

/**
 * Phase 7H — Jest's `globalTeardown` runs exactly once, after every test file in the run has
 * finished (pass or fail), in a process untouched by any individual file's own VM teardown — the
 * one reliable place to shut down the shared PDF test worker regardless of which suites ran or how
 * they exited. Individual suites do not need their own worker-shutdown logic.
 */
export default async function globalTeardown(): Promise<void> {
  await shutdownTestWorker();
}
