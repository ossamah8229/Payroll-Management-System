import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { pipeline } from 'stream/promises';
import type { StorageObjectMetadata, StorageProvider, StorageWriteOptions } from './storage-provider';
import { StorageConfigError, StorageError, StorageIOError, StorageNotFoundError } from './errors';
import { resolveObjectPath } from './safe-path';

/**
 * Deliberately duck-typed rather than `err instanceof Error` — Jest's `node` test environment runs
 * test files in a separate VM context from the one Node's own built-in modules construct their
 * errors in, so an `fs` rejection's `Error` prototype is not the same `Error` constructor a test
 * file sees, and `instanceof Error` silently returns `false` for a perfectly ordinary ENOENT/EACCES
 * error under Jest even though it behaves identically outside it (a known Jest/VM-realm gotcha, not
 * specific to this codebase). Checking for a `code` string property is the standard, realm-agnostic
 * way to identify a `NodeJS.ErrnoException` and is exactly what this function needs regardless.
 */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Filesystem-backed `StorageProvider` (docs/architecture/system-conventions.md §2) — the
 * development default and, for a self-hosted deployment with no cloud object storage, a
 * production-usable implementation in its own right; nothing here assumes a specific host or
 * cloud provider (§3 item 13's portability requirement). Writes land under a single configured
 * root directory (see `./index.ts`'s `resolveStorageRoot`), organized purely by the caller's own
 * key structure (e.g. `backups/<cycleId>/v1/payroll.csv`) — this class has no knowledge of what a
 * key "means."
 *
 * **Content type is accepted at `write` time and echoed back in that call's own return value only
 * — it is not persisted or independently retrievable later** (no `getMetadata`/`stat` method).
 * Nothing in Phase 5's concrete scope (Backup Package CSVs/JSON, all self-describing by file
 * extension) needs it back later; adding a metadata sidecar file now would be speculative ahead of
 * a real need (docs/PROJECT_PRINCIPLES.md Principle 8's spirit applied to this interface, not just
 * the database schema). A future consumer that genuinely needs stored content-type back can extend
 * this class then, without changing the `StorageProvider` interface's other methods.
 */
export class LocalFilesystemStorageProvider implements StorageProvider {
  /** Always the realpath of the configured root, resolved once at construction — every operation
   * compares against this exact string, so a later symlink swap of the root itself (not a
   * subdirectory under it) can't silently widen what "contained" means. */
  private readonly root: string;

  constructor(root: string) {
    const resolved = path.resolve(root);
    if (resolved === path.parse(resolved).root) {
      throw new StorageConfigError(
        `Storage root must not be a filesystem root directory (got "${resolved}")`,
      );
    }

    try {
      // Explicit mode, not the process umask, is what makes this directory private regardless of
      // the deploying environment's umask configuration (0o700 has no group/other bits to begin
      // with, so a typical umask can only ever leave it unchanged, never widen it) — confirmed on
      // this platform to apply to every directory `recursive: true` creates, not only the leaf.
      fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
      this.root = fs.realpathSync(resolved);
    } catch (err) {
      throw new StorageConfigError(
        `Failed to initialize storage root "${resolved}": ${(err as Error).message}`,
      );
    }
  }

  async write(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    options: StorageWriteOptions = {},
  ): Promise<StorageObjectMetadata> {
    const targetPath = resolveObjectPath(this.root, key);
    const dir = path.dirname(targetPath);

    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await this.assertNoSymlinkEscape(dir, key);

    // 16 hex characters (8 random bytes) of collision-resistant entropy — astronomically unlikely
    // to collide even under many concurrent writes to the same key; each concurrent write publishes
    // to its own temp file and only the final atomic rename below determines the surviving content,
    // so a temp-name collision was never load-bearing for correctness, only for cleanliness.
    const tempPath = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}-${path.basename(targetPath)}`);

    try {
      if (Buffer.isBuffer(data)) {
        await fsp.writeFile(tempPath, data, { mode: 0o600 });
      } else {
        await pipeline(data, fs.createWriteStream(tempPath, { mode: 0o600 }));
      }
      // Atomic publish: rename within the same directory (same filesystem) so a concurrent reader
      // of `key` only ever sees the fully-written previous version or the fully-written new one,
      // never a partial file — required regardless of whether this write is a first-time create or
      // an overwrite of an existing key (this interface's "last-writer-wins" policy, see
      // `./storage-provider.ts`).
      await fsp.rename(tempPath, targetPath);
    } catch (err) {
      await fsp.rm(tempPath, { force: true }).catch(() => undefined);
      if (err instanceof StorageError) throw err;
      throw new StorageIOError(`Failed to write storage object "${key}"`, err);
    }

    const stat = await fsp.stat(targetPath);
    return { key, sizeBytes: stat.size, contentType: options.contentType };
  }

  async read(key: string): Promise<Buffer> {
    const targetPath = resolveObjectPath(this.root, key);
    await this.assertNoSymlinkEscape(targetPath, key);

    try {
      return await fsp.readFile(targetPath);
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        throw new StorageNotFoundError(key);
      }
      throw new StorageIOError(`Failed to read storage object "${key}"`, err);
    }
  }

  /**
   * Contract for a missing object vs. a later stream error, deliberately different from one
   * another: a key that never existed at call time is rejected *synchronously*, as a rejected
   * Promise carrying `StorageNotFoundError` — a caller awaiting `createReadStream()` never needs to
   * attach an `'error'` listener just to detect "this key never existed." Once a stream has been
   * successfully returned, this method's job is done; any later failure (the object deleted or the
   * underlying file becoming unreadable mid-read, a genuine disk I/O fault, etc.) surfaces as an
   * ordinary Node `'error'` event on that stream, exactly as any `fs.ReadStream` behaves — it is
   * not, and cannot be, intercepted or re-typed by this method, since control has already passed to
   * the caller by then. Callers that consume the returned stream are responsible for handling that
   * event themselves (e.g. piping with error propagation, or an explicit `.on('error', ...)`).
   */
  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const targetPath = resolveObjectPath(this.root, key);
    await this.assertNoSymlinkEscape(targetPath, key);

    try {
      // Stat first so a missing object fails clearly and synchronously with `StorageNotFoundError`
      // — see this method's own doc comment above for the full missing-vs-later-error contract.
      await fsp.stat(targetPath);
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        throw new StorageNotFoundError(key);
      }
      throw new StorageIOError(`Failed to stat storage object "${key}"`, err);
    }

    return fs.createReadStream(targetPath);
  }

  async exists(key: string): Promise<boolean> {
    const targetPath = resolveObjectPath(this.root, key);
    await this.assertNoSymlinkEscape(targetPath, key);

    try {
      await fsp.stat(targetPath);
      return true;
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return false;
      }
      throw new StorageIOError(`Failed to check storage object "${key}"`, err);
    }
  }

  /** Idempotent — deleting a key that does not exist succeeds silently, matching the common
   * cloud-object-storage convention this interface is designed to stay portable to. See
   * `./storage-provider.ts`'s own doc comment for the full reasoning. */
  async delete(key: string): Promise<void> {
    const targetPath = resolveObjectPath(this.root, key);
    await this.assertNoSymlinkEscape(targetPath, key);

    // `unlink` only — never a recursive removal. This touches exactly the one file at `targetPath`
    // and nothing else: no parent directory (even if it becomes empty as a result) and no sibling
    // object are ever removed as a side effect of deleting one key.
    try {
      await fsp.unlink(targetPath);
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return;
      }
      throw new StorageIOError(`Failed to delete storage object "${key}"`, err);
    }
  }

  /**
   * Defense in depth beyond `resolveObjectPath`'s lexical validation (docs/architecture/
   * system-conventions.md §2's "symlink-based escape where reasonably preventable" requirement):
   * walks upward from `targetPath` to the nearest ancestor that actually exists on disk, resolves
   * *its* realpath, and confirms that's still beneath `this.root`. This catches a subdirectory
   * under the storage root having been replaced by a symlink pointing outside it after this
   * provider created it — a lexical check alone (which only ever inspects the *key string*) cannot
   * see that, since the escape lives in the filesystem, not in anything the caller supplied.
   *
   * Deliberately does not require `targetPath` itself to exist — `exists()`/a fresh `write()`
   * target legitimately won't. The walk always terminates: `this.root` itself is realpath-resolved
   * at construction and is guaranteed to exist, so it is always a valid stopping point.
   *
   * Takes `key` purely so any error this throws can name the caller-supplied key rather than the
   * absolute filesystem path it resolved to — `targetPath`/every intermediate `current` value below
   * is an absolute path and must never end up inside a thrown error's `message` (an application-level
   * error is a plausible thing for a future caller to log, and an absolute filesystem path has no
   * business appearing in application logs).
   */
  private async assertNoSymlinkEscape(targetPath: string, key: string): Promise<void> {
    let current = targetPath;

    for (;;) {
      try {
        const real = await fsp.realpath(current);
        if (real !== this.root && !real.startsWith(this.root + path.sep)) {
          throw new StorageIOError(
            `Storage key resolves outside the configured storage root via a symlink: "${key}"`,
          );
        }
        return;
      } catch (err) {
        if (err instanceof StorageError) throw err;
        if (isErrnoException(err) && err.code === 'ENOENT') {
          const parent = path.dirname(current);
          if (parent === current) {
            // Unreachable in practice — `this.root` is always a real, existing ancestor — but
            // fail closed rather than loop forever if the filesystem ever surprises us.
            return;
          }
          current = parent;
          continue;
        }
        throw new StorageIOError(`Failed to verify storage containment for key: "${key}"`, err);
      }
    }
  }
}
