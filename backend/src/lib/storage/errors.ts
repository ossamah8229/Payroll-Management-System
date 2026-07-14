/**
 * Typed errors for the storage abstraction (docs/architecture/system-conventions.md §2). Deliberately
 * not `HttpError` (backend/src/common/http-error.ts) — `StorageProvider` has no knowledge of HTTP and
 * must stay usable from any caller (a route, a background step, a future CLI). A route that surfaces
 * one of these to a client is responsible for translating it into an `HttpError` itself, the same way
 * it already translates a Prisma error.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** An invalid storage key — traversal, an absolute path, a null byte, an empty segment, or a key
 * that otherwise resolves outside the configured storage root. Thrown before any filesystem
 * operation is attempted. */
export class StorageKeyError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

/** `read`/`createReadStream` against a key with no corresponding object. Deliberately not thrown by
 * `delete` (idempotent, see `local-filesystem-storage-provider.ts`) or `exists` (returns `false`). */
export class StorageNotFoundError extends StorageError {
  constructor(public readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

/** The storage abstraction itself is misconfigured (e.g. an unsafe or unwritable storage root) —
 * always thrown at provider construction, never mid-request, per this checkpoint's "fail clearly at
 * startup or provider initialization" requirement. */
export class StorageConfigError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/** An unexpected filesystem failure (permissions, disk full, etc.) on an otherwise-valid key —
 * wraps the underlying `NodeJS.ErrnoException` so every caller sees one typed error shape rather
 * than a raw `fs` error some call sites happen to check for and others don't.
 *
 * **Log-hygiene note:** every `StorageError` subclass's own `message` is guaranteed safe to log —
 * `local-filesystem-storage-provider.ts` deliberately names the caller-supplied *key*, never an
 * absolute filesystem path, anywhere a message is constructed. `cause`, however, is the raw
 * underlying Node error where one exists, and Node's own `ENOENT`/`EACCES`-style errors carry an
 * absolute `.path`. `cause` exists for local, interactive debugging (stack trace, `.code`) — a
 * logging pipeline that persists or forwards errors to a shared/external sink should log `code`/
 * `message` only, not serialize this object's `cause` wholesale. */
export class StorageIOError extends StorageError {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageIOError';
  }
}
