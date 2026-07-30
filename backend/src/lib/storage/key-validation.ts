import { StorageKeyError } from './errors';

/**
 * The lexical storage-key validation rules shared by every `StorageProvider` implementation
 * (`local-filesystem-storage-provider.ts`'s `resolveObjectPath` and `r2-storage-provider.ts`'s
 * `resolveObjectKey`) — extracted here (Phase 7C) so a second implementation enforces exactly the
 * same "treat storage keys as untrusted at the provider boundary" rule
 * (docs/architecture/system-conventions.md §2) as the first, rather than a second, independently
 * drifting copy of the same checks. Filesystem-specific containment (resolving against a root
 * directory, symlink-escape defense) stays local to `safe-path.ts` — an S3-compatible key has no
 * such concept, it's just a validated string handed to the SDK.
 */
export function assertValidStorageKey(key: string): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new StorageKeyError('Storage key must be a non-empty string');
  }
  if (key.includes('\0')) {
    throw new StorageKeyError('Storage key must not contain null bytes');
  }
  if (key.includes('\\')) {
    throw new StorageKeyError('Storage key must not contain backslashes — use forward slashes only');
  }
  if (key.startsWith('/')) {
    throw new StorageKeyError('Storage key must be relative, not an absolute path');
  }
  // Windows drive-letter prefix (e.g. "C:\..." or "C:/...") — rejected even on a POSIX host, since
  // this codebase's self-hosted deployment target is not fixed to one platform (§3 item 13).
  if (/^[A-Za-z]:/.test(key)) {
    throw new StorageKeyError('Storage key must not contain a drive-letter prefix');
  }

  const segments = key.split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new StorageKeyError('Storage key must not contain empty path segments');
    }
    if (segment === '.' || segment === '..') {
      throw new StorageKeyError('Storage key must not contain "." or ".." path segments');
    }
  }
}
