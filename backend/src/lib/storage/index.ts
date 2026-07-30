import { env } from '../../config/env';
import { LocalFilesystemStorageProvider } from './local-filesystem-storage-provider';
import { R2StorageProvider } from './r2-storage-provider';
import { resolveStorageRoot } from './resolve-root';
import type { StorageProvider } from './storage-provider';

/**
 * The one place `STORAGE_PROVIDER` is read (Phase 7C) — every other module imports `storageProvider`
 * itself and never branches on which implementation backs it, per this checkpoint's own "the
 * application layer must not branch on local versus R2" requirement. Swapping providers really is
 * the one-line change this file's previous doc comment always promised: add a `case`, nothing else.
 */
function createStorageProvider(): StorageProvider {
  switch (env.STORAGE_PROVIDER) {
    case 'r2':
      // `env`'s own `.superRefine` (config/env.ts) already guarantees these five are present
      // whenever `STORAGE_PROVIDER=r2` — this process never starts otherwise.
      return new R2StorageProvider({
        accountId: env.R2_ACCOUNT_ID!,
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        bucket: env.R2_BUCKET_NAME!,
        endpoint: env.R2_ENDPOINT!,
      });
    case 'local':
    default:
      return new LocalFilesystemStorageProvider(resolveStorageRoot());
  }
}

/**
 * The single app-wide `StorageProvider` instance (docs/architecture/system-conventions.md §2).
 * `LocalFilesystemStorageProvider` remains the default and the local/dev/test implementation;
 * `R2StorageProvider` (Phase 7C) is the cloud-backed implementation this file's own doc comment
 * always anticipated, selected via `STORAGE_PROVIDER` (`createStorageProvider` above) — no module
 * that imports `storageProvider` needs to change regardless of which one is active.
 *
 * Constructed eagerly at import time (module-level, matching this codebase's existing
 * `lib/prisma.ts` singleton convention) so a misconfigured/unwritable storage root, or invalid R2
 * credentials shape, fails at startup, not on the first request that happens to need it.
 * `backend/tests/storage.test.ts` deliberately tests `LocalFilesystemStorageProvider`/
 * `resolveStorageRoot` directly instead of importing this file, so the existing test suite never
 * triggers this constructor as a side effect.
 */
export const storageProvider: StorageProvider = createStorageProvider();

export type { StorageObjectMetadata, StorageProvider, StorageWriteOptions } from './storage-provider';
export { StorageConfigError, StorageError, StorageIOError, StorageKeyError, StorageNotFoundError } from './errors';
export { LocalFilesystemStorageProvider } from './local-filesystem-storage-provider';
export { R2StorageProvider } from './r2-storage-provider';
export { resolveStorageRoot } from './resolve-root';
