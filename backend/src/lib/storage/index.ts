import { LocalFilesystemStorageProvider } from './local-filesystem-storage-provider';
import { resolveStorageRoot } from './resolve-root';
import type { StorageProvider } from './storage-provider';

/**
 * The single app-wide `StorageProvider` instance (docs/architecture/system-conventions.md §2).
 * `LocalFilesystemStorageProvider` is the only implementation today — suitable for local
 * development and for a self-hosted production deployment with no cloud object storage (§3 item
 * 13's portability requirement). Swapping to a cloud-backed implementation later is a one-line
 * change here; no module that imports `storageProvider` needs to change.
 *
 * Constructed eagerly at import time (module-level, matching this codebase's existing
 * `lib/prisma.ts` singleton convention) so a misconfigured/unwritable storage root fails at
 * startup, not on the first request that happens to need it. Nothing in this checkpoint imports
 * this module yet (no route or service wires it up) — the Backup Package checkpoint (Phase 5) is
 * its first real consumer; `backend/tests/storage.test.ts` deliberately tests
 * `LocalFilesystemStorageProvider`/`resolveStorageRoot` directly instead of importing this file,
 * so the existing test suite never triggers this constructor as a side effect.
 */
export const storageProvider: StorageProvider = new LocalFilesystemStorageProvider(resolveStorageRoot());

export type { StorageObjectMetadata, StorageProvider, StorageWriteOptions } from './storage-provider';
export { StorageConfigError, StorageError, StorageIOError, StorageKeyError, StorageNotFoundError } from './errors';
export { LocalFilesystemStorageProvider } from './local-filesystem-storage-provider';
export { resolveStorageRoot } from './resolve-root';
