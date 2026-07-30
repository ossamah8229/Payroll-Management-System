import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';
import type { StorageObjectMetadata, StorageProvider, StorageWriteOptions } from './storage-provider';
import { StorageIOError, StorageNotFoundError } from './errors';
import { resolveObjectKey } from './safe-key';

export interface R2StorageProviderConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

/**
 * Cloudflare R2 (S3-compatible) `StorageProvider` implementation (Phase 7C) — the second
 * implementation of the interface `docs/architecture/system-conventions.md §2` and
 * `lib/storage/index.ts`'s own doc comment always anticipated. Satisfies exactly the same five
 * methods as `LocalFilesystemStorageProvider`, with no caller-visible difference: every module that
 * already imports `storageProvider` (Backup Packages, Payslips, and this checkpoint's Company Logo
 * feature) works unchanged regardless of which implementation `STORAGE_PROVIDER` selects.
 *
 * The bucket itself stays private (this checkpoint's own requirement) — this class has no concept
 * of a public URL, a signed URL, or an ACL; it only ever moves bytes between the caller and R2. Any
 * public-facing image serving is the caller's job (`modules/settings/company-logo.routes.ts`
 * proxies bytes through an authenticated Express response), never this provider's.
 */
export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2StorageProviderConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async write(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    options: StorageWriteOptions = {},
  ): Promise<StorageObjectMetadata> {
    const objectKey = resolveObjectKey(key);
    const body = Buffer.isBuffer(data) ? data : await bufferizeStream(data);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: body,
          ContentType: options.contentType,
        }),
      );
    } catch (err) {
      throw new StorageIOError(`Failed to write storage object "${key}"`, err);
    }

    return { key, sizeBytes: body.length, contentType: options.contentType };
  }

  async read(key: string): Promise<Buffer> {
    const objectKey = resolveObjectKey(key);

    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return await bufferizeStream(result.Body as Readable);
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new StorageNotFoundError(key);
      }
      throw new StorageIOError(`Failed to read storage object "${key}"`, err);
    }
  }

  /** Matches `LocalFilesystemStorageProvider`'s own contract exactly: a missing key is rejected
   * synchronously (via a `HeadObject` existence check) before any stream is returned; a failure
   * after the stream has been handed back surfaces as an ordinary `'error'` event, never
   * intercepted here — see that class's own doc comment for the full missing-vs-later-error
   * reasoning, unchanged for this implementation. */
  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const objectKey = resolveObjectKey(key);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new StorageNotFoundError(key);
      }
      throw new StorageIOError(`Failed to stat storage object "${key}"`, err);
    }

    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return result.Body as Readable;
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new StorageNotFoundError(key);
      }
      throw new StorageIOError(`Failed to read storage object "${key}"`, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    const objectKey = resolveObjectKey(key);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch (err) {
      if (isNotFoundError(err)) {
        return false;
      }
      throw new StorageIOError(`Failed to check storage object "${key}"`, err);
    }
  }

  /** Idempotent for free — S3-compatible `DeleteObject` already succeeds on a key that does not
   * exist, matching `StorageProvider`'s documented convention with no extra handling needed here
   * (unlike `LocalFilesystemStorageProvider`, which has to translate `ENOENT` itself). */
  async delete(key: string): Promise<void> {
    const objectKey = resolveObjectKey(key);

    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (err) {
      throw new StorageIOError(`Failed to delete storage object "${key}"`, err);
    }
  }
}

function isNotFoundError(err: unknown): boolean {
  if (err instanceof NotFound) return true;
  const name = (err as { name?: string } | undefined)?.name;
  const httpStatus = (err as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || httpStatus === 404;
}

async function bufferizeStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
