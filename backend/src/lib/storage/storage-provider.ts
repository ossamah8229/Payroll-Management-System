/**
 * The storage abstraction (docs/architecture/system-conventions.md §2) — the one interface every
 * piece of generated-file business logic in this codebase depends on, never `fs`/a cloud SDK
 * directly. `LocalFilesystemStorageProvider` (this checkpoint) is the first and, for now, only
 * implementation; a future cloud-backed implementation (S3/R2/etc.) satisfies the same interface
 * with no change required in any calling module.
 *
 * Deliberately minimal — scoped to what Phase 5's Backup Packages (the first real consumer,
 * docs/IMPLEMENTATION_PLAN.md Phase 5) concretely need, not speculative cloud-storage concepts.
 * No signed URLs, multipart upload, bucket/container exposure to domain code, CDN behavior, ACLs,
 * provider-specific ETags, or lifecycle policies — any of those, if ever needed, belong to a
 * specific implementation's internals, never this interface.
 */

/** Returned by `write` — the storage key the caller supplied (never an absolute filesystem path,
 * per this checkpoint's "no direct exposure of absolute filesystem paths to API clients"
 * requirement), the object's size, and the content type the caller supplied at write time (echoed
 * back, not independently derived or persisted — see `LocalFilesystemStorageProvider`'s own doc
 * comment for why content-type retrieval is out of this checkpoint's scope). */
export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  contentType?: string;
}

export interface StorageWriteOptions {
  contentType?: string;
}

export interface StorageProvider {
  /**
   * Writes `data` to `key`, creating any intermediate directories as needed. Overwrite policy:
   * last-writer-wins — writing to an existing key replaces it (published atomically; a concurrent
   * reader never observes a partially-written file). Callers that need "never overwrite" semantics
   * (e.g. a versioned Backup Package) are responsible for choosing a unique key per version — this
   * interface does not enforce key uniqueness itself.
   */
  write(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    options?: StorageWriteOptions,
  ): Promise<StorageObjectMetadata>;

  /** Reads the whole object into memory. Throws `StorageNotFoundError` if `key` does not exist —
   * see `./errors.ts`. Suitable for the CSV/JSON-sized artifacts this codebase generates; a much
   * larger future artifact type should use `createReadStream` instead. */
  read(key: string): Promise<Buffer>;

  /** Streams the object instead of buffering it fully in memory. Throws `StorageNotFoundError`
   * (not a stream `'error'` event) if `key` does not exist at call time. */
  createReadStream(key: string): Promise<NodeJS.ReadableStream>;

  /** Whether an object currently exists at `key`. Never throws for a missing key — that is exactly
   * what a `false` result means. */
  exists(key: string): Promise<boolean>;

  /** Deletes the object at `key`. Idempotent: deleting a key that does not exist succeeds silently
   * (matches the common cloud-object-storage convention this interface is designed to stay
   * portable to, e.g. S3's `DeleteObject`), rather than throwing `StorageNotFoundError` — a future
   * cloud implementation must not have to fake a not-found error just to match local behavior. */
  delete(key: string): Promise<void>;
}
