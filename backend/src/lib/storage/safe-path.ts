import path from 'path';
import { StorageKeyError } from './errors';
import { assertValidStorageKey } from './key-validation';

/**
 * Resolves an application-generated storage `key` to an absolute filesystem path beneath `root`,
 * rejecting anything that could resolve outside it — per this checkpoint's "treat storage keys as
 * untrusted at the provider boundary even when application-generated" requirement
 * (docs/architecture/system-conventions.md §2). This is the one place key validation happens; every
 * `LocalFilesystemStorageProvider` operation goes through it before touching the filesystem.
 *
 * Lexical validation itself (`assertValidStorageKey`, `./key-validation.ts`) is shared with
 * `r2-storage-provider.ts`'s `resolveObjectKey` (Phase 7C) — deliberately conservative: keys must
 * be a `/`-separated relative path with no `.`/`..` segments, no empty segments, no null bytes, and
 * no backslashes — the last of these is rejected outright (not merely normalized) so a key's
 * meaning never depends on which OS the process happens to be running on, per the portability
 * requirement (a `\` is a literal filename character on POSIX but a separator on Windows; the only
 * way to make it safe on both is to disallow it everywhere). Filesystem containment (below) is
 * specific to this implementation — an S3-compatible key has no such concept.
 */
export function resolveObjectPath(root: string, key: string): string {
  assertValidStorageKey(key);

  const segments = key.split('/');
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
