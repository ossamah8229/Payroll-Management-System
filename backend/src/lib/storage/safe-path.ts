import path from 'path';
import { StorageKeyError } from './errors';

/**
 * Resolves an application-generated storage `key` to an absolute filesystem path beneath `root`,
 * rejecting anything that could resolve outside it — per this checkpoint's "treat storage keys as
 * untrusted at the provider boundary even when application-generated" requirement
 * (docs/architecture/system-conventions.md §2). This is the one place key validation happens; every
 * `LocalFilesystemStorageProvider` operation goes through it before touching the filesystem.
 *
 * Deliberately conservative: keys must be a `/`-separated relative path with no `.`/`..` segments,
 * no empty segments, no null bytes, and no backslashes — the last of these is rejected outright
 * (not merely normalized) so a key's meaning never depends on which OS the process happens to be
 * running on, per the portability requirement (a `\` is a literal filename character on POSIX but a
 * separator on Windows; the only way to make it safe on both is to disallow it everywhere).
 */
export function resolveObjectPath(root: string, key: string): string {
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

  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);

  // Belt-and-suspenders beyond the lexical segment check above: confirm the resolved path is
  // actually still beneath the root, not merely string-prefixed by it (e.g. a sibling directory
  // like "<root>-evil" must not pass a naive `startsWith(resolvedRoot)` check).
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new StorageKeyError('Storage key resolves outside the configured storage root');
  }

  return resolvedTarget;
}
