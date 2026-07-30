import { assertValidStorageKey } from './key-validation';

/**
 * The R2/S3-compatible counterpart to `safe-path.ts`'s `resolveObjectPath` — same lexical
 * validation (`assertValidStorageKey`), no filesystem containment step, since an object key has no
 * such concept: the bucket namespace is already the containment boundary, enforced by R2/S3 itself,
 * not by this application. Returns the key unchanged once validated, purely for symmetry with
 * `resolveObjectPath`'s call shape at each `R2StorageProvider` method.
 */
export function resolveObjectKey(key: string): string {
  assertValidStorageKey(key);
  return key;
}
