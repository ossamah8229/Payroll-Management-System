import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { LocalFilesystemStorageProvider } from '../src/lib/storage/local-filesystem-storage-provider';
import { resolveObjectPath } from '../src/lib/storage/safe-path';
import { resolveStorageRoot } from '../src/lib/storage/resolve-root';
import {
  StorageConfigError,
  StorageIOError,
  StorageKeyError,
  StorageNotFoundError,
} from '../src/lib/storage/errors';

/**
 * Pure unit tests, no database involved (mirrors `date-utils.test.ts`/`calc-net.test.ts`'s pattern
 * for a `lib`-level utility). Every test constructs its own `LocalFilesystemStorageProvider`
 * against an isolated `fs.mkdtemp()` directory and removes it afterward — never the developer's
 * real, env-configured storage directory (`backend/storage/`, gitignored).
 */
describe('LocalFilesystemStorageProvider', () => {
  let tmpRoot: string;
  let provider: LocalFilesystemStorageProvider;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-storage-test-'));
    provider = new LocalFilesystemStorageProvider(tmpRoot);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  describe('write / read', () => {
    it('writes and reads binary data byte-for-byte', async () => {
      const data = Buffer.from([0, 1, 2, 255, 254, 253, 10, 13, 127, 128]);
      await provider.write('objects/a.bin', data);
      const read = await provider.read('objects/a.bin');
      expect(read.equals(data)).toBe(true);
    });

    it('creates nested directories automatically', async () => {
      await provider.write('a/b/c/d/file.txt', Buffer.from('nested'));
      const read = await provider.read('a/b/c/d/file.txt');
      expect(read.toString('utf8')).toBe('nested');
      const stat = await fs.stat(path.join(tmpRoot, 'a', 'b', 'c', 'd', 'file.txt'));
      expect(stat.isFile()).toBe(true);
    });

    it('returns correct metadata from write', async () => {
      const data = Buffer.from('hello world');
      const meta = await provider.write('meta.txt', data, { contentType: 'text/plain' });
      expect(meta).toEqual({ key: 'meta.txt', sizeBytes: data.length, contentType: 'text/plain' });
    });

    it('writes from a readable stream, not only a Buffer', async () => {
      const data = Buffer.from('streamed content, not a buffer argument');
      const stream = Readable.from([data]);
      await provider.write('streamed.bin', stream);
      const read = await provider.read('streamed.bin');
      expect(read.equals(data)).toBe(true);
    });

    it('writes and reads a zero-byte file', async () => {
      const meta = await provider.write('empty.bin', Buffer.alloc(0));
      expect(meta.sizeBytes).toBe(0);
      const read = await provider.read('empty.bin');
      expect(read.length).toBe(0);
    });

    it('writes and reads large-enough binary content without corruption (proves this is not text-oriented)', async () => {
      const large = Buffer.alloc(5 * 1024 * 1024);
      for (let i = 0; i < large.length; i++) large[i] = i % 256;
      await provider.write('large.bin', large);
      const read = await provider.read('large.bin');
      expect(read.equals(large)).toBe(true);
    });

    it('overwrites an existing key — last write wins', async () => {
      await provider.write('overwrite.txt', Buffer.from('first'));
      await provider.write('overwrite.txt', Buffer.from('second'));
      const read = await provider.read('overwrite.txt');
      expect(read.toString('utf8')).toBe('second');
    });

    it('resolves concurrent writes to the same key to exactly one, fully-written value — never a mix, with each write using a collision-resistant temp name and none leaked behind', async () => {
      const values = Array.from({ length: 12 }, (_, i) => Buffer.from(`value-${i}`.repeat(50)));
      await Promise.all(values.map((v) => provider.write('concurrent.txt', v)));
      const read = await provider.read('concurrent.txt');
      const matches = values.filter((v) => v.equals(read));
      // Exactly one of the concurrent writes' exact byte sequences must be the final content — the
      // atomic temp-file-then-rename publish guarantees a reader never observes a partial or
      // interleaved write, whichever write happened to land last.
      expect(matches).toHaveLength(1);
      // Every one of the 12 concurrent writes gets its own randomly-named temp file (never a
      // collision) and every one is cleaned up by its own successful rename — nothing named
      // `.tmp-*` should ever remain once every write has settled.
      const entries = await fs.readdir(tmpRoot);
      expect(entries.filter((name) => name.startsWith('.tmp-'))).toHaveLength(0);
    });

    it('cleans up its temp file after a failed write (the write itself fails)', async () => {
      const failingStream = new Readable({
        read() {
          this.destroy(new Error('simulated stream failure'));
        },
      });
      await expect(provider.write('failing.bin', failingStream)).rejects.toThrow();
      const entries = await fs.readdir(tmpRoot);
      const tempFiles = entries.filter((name) => name.startsWith('.tmp-'));
      expect(tempFiles).toHaveLength(0);
      // The target key itself must never have been published either.
      expect(await provider.exists('failing.bin')).toBe(false);
    });

    it('cleans up its temp file when the final rename fails (the write succeeds but publication does not)', async () => {
      // Pre-occupy the destination with a non-empty directory — renaming a file onto an existing
      // directory is rejected on every POSIX platform regardless of whether that directory is
      // empty, giving a deterministic way to force the *rename* step specifically to fail, as
      // opposed to the write-to-temp-file step the test above already covers.
      const targetDir = path.join(tmpRoot, 'rename-fail', 'target.txt');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'occupant.txt'), 'already here');

      await expect(provider.write('rename-fail/target.txt', Buffer.from('new content'))).rejects.toThrow();

      const dirEntries = await fs.readdir(path.join(tmpRoot, 'rename-fail'));
      expect(dirEntries.filter((name) => name.startsWith('.tmp-'))).toHaveLength(0);
      // The pre-existing occupied directory is completely untouched by the failed publish attempt.
      expect(await fs.readdir(targetDir)).toEqual(['occupant.txt']);
    });
  });

  describe('read of a missing key', () => {
    it('throws StorageNotFoundError, not a raw ENOENT', async () => {
      await expect(provider.read('missing.bin')).rejects.toThrow(StorageNotFoundError);
    });
  });

  describe('createReadStream', () => {
    it('streams the full object content', async () => {
      const data = Buffer.from('stream me back out again');
      await provider.write('stream-read.bin', data);
      const stream = await provider.createReadStream('stream-read.bin');
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).equals(data)).toBe(true);
    });

    it('throws StorageNotFoundError for a missing key, not a stream error event', async () => {
      await expect(provider.createReadStream('nope.bin')).rejects.toThrow(StorageNotFoundError);
    });

    it('returns the real underlying stream unmodified — a later failure still surfaces as a normal stream error event, never swallowed', async () => {
      // Deterministic by construction, rather than racing a real filesystem failure against the
      // stream's own internal open() timing (which would be flaky): proves this method does not
      // wrap, buffer, or intercept the stream in any way that could suppress or transform an error
      // occurring after the stream has already been handed back to the caller — exactly the
      // contract this method's own doc comment describes.
      await provider.write('will-error-later.bin', Buffer.from('some content'));
      const stream = await provider.createReadStream('will-error-later.bin');

      const errorPromise = new Promise<Error>((resolve) => stream.once('error', resolve));
      const injected = new Error('simulated downstream failure');
      (stream as import('fs').ReadStream).destroy(injected);

      await expect(errorPromise).resolves.toBe(injected);
    });
  });

  describe('exists', () => {
    it('returns true for an existing key', async () => {
      await provider.write('exists.txt', Buffer.from('x'));
      expect(await provider.exists('exists.txt')).toBe(true);
    });

    it('returns false for a missing key, without throwing', async () => {
      await expect(provider.exists('missing.txt')).resolves.toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an existing object', async () => {
      await provider.write('to-delete.txt', Buffer.from('x'));
      await provider.delete('to-delete.txt');
      expect(await provider.exists('to-delete.txt')).toBe(false);
    });

    it('is idempotent — deleting a key that never existed does not throw', async () => {
      await expect(provider.delete('never-existed.txt')).resolves.toBeUndefined();
    });

    it('never removes the parent directory or a sibling object — only the one targeted key', async () => {
      await provider.write('shared-dir/keep.txt', Buffer.from('keep me'));
      await provider.write('shared-dir/remove.txt', Buffer.from('remove me'));

      await provider.delete('shared-dir/remove.txt');

      expect(await provider.exists('shared-dir/remove.txt')).toBe(false);
      expect(await provider.exists('shared-dir/keep.txt')).toBe(true);
      const parentEntries = await fs.readdir(path.join(tmpRoot, 'shared-dir'));
      expect(parentEntries).toEqual(['keep.txt']);
    });
  });

  describe('path security — rejected at the provider boundary before any filesystem access', () => {
    const badKeys: Array<[string, string]> = [
      ['parent traversal', '../escape.txt'],
      ['nested parent traversal', 'a/../../escape.txt'],
      ['parent traversal mid-path', 'a/../b.txt'],
      ['absolute POSIX path', '/etc/passwd'],
      ['backslash traversal', '..\\..\\escape.txt'],
      ['backslash as separator', 'a\\b.txt'],
      ['windows drive prefix, backslash', 'C:\\Windows\\system32'],
      ['windows drive prefix, forward slash', 'C:/Windows/system32'],
      ['empty key', ''],
      ['empty path segment (double slash)', 'a//b.txt'],
      ['null byte', 'a\0b.txt'],
      ['single dot segment', './a.txt'],
    ];

    it.each(badKeys)('rejects %s ("%s") across every operation', async (_label, key) => {
      await expect(provider.write(key, Buffer.from('x'))).rejects.toThrow(StorageKeyError);
      await expect(provider.read(key)).rejects.toThrow(StorageKeyError);
      await expect(provider.createReadStream(key)).rejects.toThrow(StorageKeyError);
      await expect(provider.delete(key)).rejects.toThrow(StorageKeyError);
      await expect(provider.exists(key)).rejects.toThrow(StorageKeyError);
    });

    it('never writes outside the configured root even when a traversal key is attempted', async () => {
      await provider.write('legit/file.txt', Buffer.from('ok'));
      const outside = path.resolve(tmpRoot, '..');
      const entriesBefore = await fs.readdir(outside);
      await expect(provider.write('../escape.txt', Buffer.from('bad'))).rejects.toThrow(StorageKeyError);
      const entriesAfter = await fs.readdir(outside);
      expect(entriesAfter).toEqual(entriesBefore);
    });

    it('rejects writes through a symlinked subdirectory that escapes the storage root, and never names an absolute path in the thrown error', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-storage-outside-'));
      try {
        const linkPath = path.join(tmpRoot, 'escape-link');
        await fs.symlink(outsideDir, linkPath, 'dir');

        const key = 'escape-link/evil.txt';
        let caught: unknown;
        try {
          await provider.write(key, Buffer.from('bad'));
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(StorageIOError);
        const message = (caught as StorageIOError).message;
        // The error must name the *key*, not an absolute filesystem path — application-level
        // errors are a plausible thing for a future caller to log, and neither this storage root
        // nor the escape target's absolute path should ever appear there.
        expect(message).toContain(key);
        expect(message).not.toContain(tmpRoot);
        expect(message).not.toContain(outsideDir);

        const outsideEntries = await fs.readdir(outsideDir);
        expect(outsideEntries).toEqual([]);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it("resolves containment against the storage root's real location, even when the configured root itself is a symlink", async () => {
      const realTarget = await fs.mkdtemp(path.join(os.tmpdir(), 'payroll-storage-real-'));
      try {
        const symlinkRoot = path.join(tmpRoot, 'root-symlink');
        await fs.symlink(realTarget, symlinkRoot, 'dir');
        const symlinkProvider = new LocalFilesystemStorageProvider(symlinkRoot);

        await symlinkProvider.write('inside.txt', Buffer.from('via symlink root'));

        // The object must land in the *real* target directory, not merely "somewhere reachable via
        // the symlink path" — confirms the containment baseline is the resolved real location
        // (`fs.realpathSync` at construction), not the configured (possibly symlinked) one.
        const realFile = await fs.readFile(path.join(realTarget, 'inside.txt'));
        expect(realFile.toString('utf8')).toBe('via symlink root');

        // A traversal attempt through the symlinked root is still rejected exactly as it would be
        // for a non-symlinked root.
        await expect(symlinkProvider.write('../escape.txt', Buffer.from('bad'))).rejects.toThrow(
          StorageKeyError,
        );
      } finally {
        await fs.rm(realTarget, { recursive: true, force: true });
      }
    });
  });

  describe('construction', () => {
    it('creates the storage root directory recursively if it does not exist yet', async () => {
      const nested = path.join(tmpRoot, 'nested', 'root');
      const createdProvider = new LocalFilesystemStorageProvider(nested);
      const stat = await fs.stat(nested);
      expect(stat.isDirectory()).toBe(true);
      await createdProvider.write('x.txt', Buffer.from('x'));
      expect((await createdProvider.read('x.txt')).toString('utf8')).toBe('x');
    });

    it('rejects a filesystem-root storage root at construction, before any write is attempted', () => {
      expect(() => new LocalFilesystemStorageProvider('/')).toThrow(StorageConfigError);
    });
  });

  describe('filesystem permissions', () => {
    it('creates a freshly-provisioned storage root with owner-only permissions (0o700)', async () => {
      // A fresh path, not the already-existing `tmpRoot` — `fs.mkdtemp` (used to create `tmpRoot`
      // itself in `beforeEach`) already happens to default to 0o700 on most platforms, which would
      // make asserting on `tmpRoot` a test of `mkdtemp`'s behavior, not this provider's; recursive
      // `mkdir` is also a no-op on a directory that already exists, so it would never have a chance
      // to apply its own mode to `tmpRoot` regardless.
      const freshRoot = path.join(tmpRoot, 'fresh-root');
      const freshProvider = new LocalFilesystemStorageProvider(freshRoot);
      const stat = await fs.stat(freshRoot);
      expect(stat.mode & 0o777).toBe(0o700);
      await freshProvider.write('x.txt', Buffer.from('x'));
    });

    it('creates nested object directories with owner-only permissions (0o700)', async () => {
      await provider.write('perm-check/nested/file.txt', Buffer.from('x'));
      const nestedStat = await fs.stat(path.join(tmpRoot, 'perm-check', 'nested'));
      expect(nestedStat.mode & 0o777).toBe(0o700);
    });

    it('writes object files with owner-only permissions (0o600)', async () => {
      await provider.write('perm-file.txt', Buffer.from('x'));
      const fileStat = await fs.stat(path.join(tmpRoot, 'perm-file.txt'));
      expect(fileStat.mode & 0o777).toBe(0o600);
    });

    it('writes a stream-sourced object with the same owner-only permissions (0o600)', async () => {
      await provider.write('perm-stream.bin', Readable.from([Buffer.from('streamed')]));
      const fileStat = await fs.stat(path.join(tmpRoot, 'perm-stream.bin'));
      expect(fileStat.mode & 0o777).toBe(0o600);
    });
  });

  describe('log hygiene', () => {
    it('never writes to console/stdout/stderr itself, across success and failure paths alike', async () => {
      // This module has no logger dependency at all — it is the caller's responsibility to decide
      // whether/how to log a thrown error (see `errors.ts`'s `StorageIOError` doc comment). This
      // test is the runtime confirmation of that: exercise a representative mix of successful and
      // failing operations and confirm none of them produced any console/stdout/stderr output.
      const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        await provider.write('log-hygiene.txt', Buffer.from('data'));
        await provider.read('log-hygiene.txt');
        await provider.exists('log-hygiene.txt');
        await provider.delete('log-hygiene.txt');
        await expect(provider.read('log-hygiene.txt')).rejects.toThrow(StorageNotFoundError);
        await expect(provider.write('../escape.txt', Buffer.from('x'))).rejects.toThrow(StorageKeyError);

        expect(consoleLog).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(consoleWarn).not.toHaveBeenCalled();
        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(stderrWrite).not.toHaveBeenCalled();
      } finally {
        consoleLog.mockRestore();
        consoleError.mockRestore();
        consoleWarn.mockRestore();
        stdoutWrite.mockRestore();
        stderrWrite.mockRestore();
      }
    });
  });
});

describe('resolveStorageRoot', () => {
  it('resolves a relative value against the given working directory', () => {
    const resolved = resolveStorageRoot('storage', '/tmp/some-app');
    expect(resolved).toBe(path.resolve('/tmp/some-app', 'storage'));
  });

  it('resolves an already-absolute value unchanged', () => {
    const resolved = resolveStorageRoot('/var/payroll/storage', '/tmp/some-app');
    expect(resolved).toBe(path.resolve('/var/payroll/storage'));
  });

  it('rejects a value that resolves to the working directory itself', () => {
    expect(() => resolveStorageRoot('.', '/tmp/some-app')).toThrow(StorageConfigError);
    expect(() => resolveStorageRoot('', '/tmp/some-app')).toThrow(StorageConfigError);
  });
});

describe('resolveObjectPath', () => {
  it('resolves a valid nested key beneath the root', () => {
    expect(resolveObjectPath('/tmp/root', 'a/b/c.txt')).toBe(path.resolve('/tmp/root', 'a/b/c.txt'));
  });

  it('rejects a key that is not a string-shaped, well-formed relative path', () => {
    expect(() => resolveObjectPath('/tmp/root', '../escape')).toThrow(StorageKeyError);
  });
});
