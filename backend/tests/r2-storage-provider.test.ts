import { S3Client, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import { R2StorageProvider } from '../src/lib/storage/r2-storage-provider';
import { StorageIOError, StorageKeyError, StorageNotFoundError } from '../src/lib/storage/errors';

/**
 * Unit tests for `R2StorageProvider` against a fully mocked S3-compatible transport
 * (`aws-sdk-client-mock` — never a real Cloudflare R2 bucket, matching this codebase's existing
 * "no live external service in the test suite" convention). Mirrors `storage.test.ts`'s own
 * coverage of `LocalFilesystemStorageProvider` so both `StorageProvider` implementations are held
 * to the same observable contract.
 */
describe('R2StorageProvider', () => {
  const s3Mock = mockClient(S3Client);
  let provider: R2StorageProvider;

  beforeEach(() => {
    s3Mock.reset();
    provider = new R2StorageProvider({
      accountId: 'test-account',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      bucket: 'test-bucket',
      endpoint: 'https://test-account.r2.cloudflarestorage.com',
    });
  });

  describe('write', () => {
    it('writes a Buffer and returns metadata matching the interface contract', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      const data = Buffer.from('hello world');

      const meta = await provider.write('objects/a.bin', data, { contentType: 'text/plain' });

      expect(meta).toEqual({ key: 'objects/a.bin', sizeBytes: data.length, contentType: 'text/plain' });
      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args[0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'objects/a.bin',
        ContentType: 'text/plain',
      });
    });

    it('buffers and writes a readable stream, not only a Buffer argument', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      const data = Buffer.from('streamed content');
      const stream = Readable.from([data]);

      const meta = await provider.write('streamed.bin', stream);

      expect(meta.sizeBytes).toBe(data.length);
      const call = s3Mock.commandCalls(PutObjectCommand)[0]!;
      expect(Buffer.isBuffer(call.args[0].input.Body)).toBe(true);
      expect((call.args[0].input.Body as Buffer).equals(data)).toBe(true);
    });

    it('wraps a transport failure in StorageIOError', async () => {
      s3Mock.on(PutObjectCommand).rejects(new Error('network failure'));
      await expect(provider.write('x.txt', Buffer.from('x'))).rejects.toThrow(StorageIOError);
    });

    it('rejects an invalid key before ever calling the S3 transport', async () => {
      await expect(provider.write('../escape.txt', Buffer.from('x'))).rejects.toThrow(StorageKeyError);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
  });

  describe('read', () => {
    it('reads the full object body into a Buffer', async () => {
      const data = Buffer.from('some content');
      s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([data]) as never });

      const read = await provider.read('objects/a.bin');
      expect(read.equals(data)).toBe(true);
    });

    it('throws StorageNotFoundError, not a raw SDK error, when the object does not exist', async () => {
      s3Mock.on(GetObjectCommand).rejects(new NotFound({ message: 'not found', $metadata: {} }));
      await expect(provider.read('missing.bin')).rejects.toThrow(StorageNotFoundError);
    });

    it('wraps any other transport failure in StorageIOError', async () => {
      s3Mock.on(GetObjectCommand).rejects(new Error('transient failure'));
      await expect(provider.read('x.bin')).rejects.toThrow(StorageIOError);
    });
  });

  describe('createReadStream', () => {
    it('checks existence first and throws StorageNotFoundError synchronously for a missing key', async () => {
      s3Mock.on(HeadObjectCommand).rejects(new NotFound({ message: 'not found', $metadata: {} }));
      await expect(provider.createReadStream('missing.bin')).rejects.toThrow(StorageNotFoundError);
      expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    });

    it('returns the object stream once the existence check succeeds', async () => {
      s3Mock.on(HeadObjectCommand).resolves({});
      const data = Buffer.from('stream me back out');
      s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([data]) as never });

      const stream = await provider.createReadStream('stream-read.bin');
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).equals(data)).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns true when HeadObject succeeds', async () => {
      s3Mock.on(HeadObjectCommand).resolves({});
      expect(await provider.exists('present.txt')).toBe(true);
    });

    it('returns false for a missing key, without throwing', async () => {
      s3Mock.on(HeadObjectCommand).rejects(new NotFound({ message: 'not found', $metadata: {} }));
      await expect(provider.exists('missing.txt')).resolves.toBe(false);
    });

    it('throws StorageIOError for a non-404 transport failure', async () => {
      s3Mock.on(HeadObjectCommand).rejects(new Error('permission denied'));
      await expect(provider.exists('x.txt')).rejects.toThrow(StorageIOError);
    });
  });

  describe('delete', () => {
    it('is idempotent — S3 DeleteObject succeeds even for a key that never existed', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});
      await expect(provider.delete('never-existed.txt')).resolves.toBeUndefined();
    });

    it('wraps a transport failure in StorageIOError', async () => {
      s3Mock.on(DeleteObjectCommand).rejects(new Error('network failure'));
      await expect(provider.delete('x.txt')).rejects.toThrow(StorageIOError);
    });
  });

  describe('path security — rejected before any S3 call, same rules as LocalFilesystemStorageProvider', () => {
    const badKeys: Array<[string, string]> = [
      ['parent traversal', '../escape.txt'],
      ['absolute POSIX path', '/etc/passwd'],
      ['backslash as separator', 'a\\b.txt'],
      ['empty key', ''],
      ['null byte', 'a\0b.txt'],
    ];

    it.each(badKeys)('rejects %s ("%s") across every operation', async (_label, key) => {
      await expect(provider.write(key, Buffer.from('x'))).rejects.toThrow(StorageKeyError);
      await expect(provider.read(key)).rejects.toThrow(StorageKeyError);
      await expect(provider.createReadStream(key)).rejects.toThrow(StorageKeyError);
      await expect(provider.delete(key)).rejects.toThrow(StorageKeyError);
      await expect(provider.exists(key)).rejects.toThrow(StorageKeyError);
    });
  });
});
