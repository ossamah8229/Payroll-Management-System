import path from 'path';
import { env } from '../../config/env';
import { StorageConfigError } from './errors';

/**
 * Resolves the configured storage root to an absolute path, relative to the process's working
 * directory when not already absolute — the same convention `DATABASE_URL`/other env-driven paths
 * in this codebase already follow. Split into its own file (rather than living in `./index.ts`
 * alongside the singleton) so it stays a pure function of its arguments — importable and testable
 * without triggering `index.ts`'s module-level `LocalFilesystemStorageProvider` construction
 * (`backend/tests/storage.test.ts`).
 *
 * `STORAGE_ROOT` has no schema default (`backend/src/config/env.ts`), so a missing value fails at
 * startup via the existing `loadEnv()` fail-fast path before this function ever runs; this
 * function's own check catches the *other* unsafe case — a value that's present but points at the
 * application's own working directory (docs/architecture/system-conventions.md §2, "production
 * does not silently fall back to an unsafe working-directory path").
 */
export function resolveStorageRoot(
  storageRootValue: string = env.STORAGE_ROOT,
  cwd: string = process.cwd(),
): string {
  const resolvedCwd = path.resolve(cwd);
  const resolved = path.resolve(resolvedCwd, storageRootValue);

  if (resolved === resolvedCwd) {
    throw new StorageConfigError(
      `STORAGE_ROOT ("${storageRootValue}") resolves to the process's own working directory ` +
        `("${resolvedCwd}") — this would treat the application's working directory (source, ` +
        `config, and build output included) as the storage root. Configure a dedicated ` +
        `subdirectory instead (e.g. "storage").`,
    );
  }

  return resolved;
}
