/**
 * `STORAGE_PROVIDER` selection (Phase 7C) — `jest.isolateModules` + a mutated `process.env`,
 * mirroring `csrf-cross-origin.test.ts`'s own established pattern for re-importing a
 * module-level singleton under a different environment than the one `tests/env.setup.ts` already
 * loaded for the rest of the suite. `lib/storage/index.ts`'s `storageProvider` singleton is
 * constructed eagerly at import time, so every case here freshly re-imports it inside its own
 * isolated module registry rather than touching the already-loaded module the rest of the test
 * process shares.
 *
 * Asserted via `constructor.name` rather than `instanceof` — `jest.isolateModules` gives the
 * required module its own separate registry, so a class imported at this file's top level and the
 * "same" class re-required inside `isolateModules` are two distinct constructor references
 * (identical in name and behavior, but `instanceof` compares object identity) — the exact
 * cross-realm gotcha `local-filesystem-storage-provider.ts`'s own `isErrnoException` doc comment
 * already documents for `instanceof Error` under Jest, applied here to a codebase-defined class
 * instead of a built-in one.
 */
describe('Storage provider selection (STORAGE_PROVIDER)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to LocalFilesystemStorageProvider when STORAGE_PROVIDER is unset', () => {
    let providerClassName!: string;

    jest.isolateModules(() => {
      delete process.env.STORAGE_PROVIDER;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storageProvider } = require('../src/lib/storage') as typeof import('../src/lib/storage');
      providerClassName = storageProvider.constructor.name;
    });

    expect(providerClassName).toBe('LocalFilesystemStorageProvider');
  });

  it('explicitly selects LocalFilesystemStorageProvider for STORAGE_PROVIDER=local', () => {
    let providerClassName!: string;

    jest.isolateModules(() => {
      process.env.STORAGE_PROVIDER = 'local';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storageProvider } = require('../src/lib/storage') as typeof import('../src/lib/storage');
      providerClassName = storageProvider.constructor.name;
    });

    expect(providerClassName).toBe('LocalFilesystemStorageProvider');
  });

  it('selects R2StorageProvider for STORAGE_PROVIDER=r2 with all five R2_* variables present', () => {
    let providerClassName!: string;

    jest.isolateModules(() => {
      process.env.STORAGE_PROVIDER = 'r2';
      process.env.R2_ACCOUNT_ID = 'test-account';
      process.env.R2_ACCESS_KEY_ID = 'test-access-key';
      process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
      process.env.R2_BUCKET_NAME = 'test-bucket';
      process.env.R2_ENDPOINT = 'https://test-account.r2.cloudflarestorage.com';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storageProvider } = require('../src/lib/storage') as typeof import('../src/lib/storage');
      providerClassName = storageProvider.constructor.name;
    });

    expect(providerClassName).toBe('R2StorageProvider');
  });

  it('fails fast at startup (never mid-request) when STORAGE_PROVIDER=r2 is missing any required R2_* variable', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      jest.isolateModules(() => {
        process.env.STORAGE_PROVIDER = 'r2';
        process.env.R2_ACCOUNT_ID = 'test-account';
        // R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT all deliberately unset.
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
        delete process.env.R2_ENDPOINT;

        expect(() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../src/config/env');
        }).toThrow('process.exit called');
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const loggedIssues = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedIssues).toContain('R2_ACCESS_KEY_ID');
      expect(loggedIssues).toContain('R2_SECRET_ACCESS_KEY');
      expect(loggedIssues).toContain('R2_BUCKET_NAME');
      expect(loggedIssues).toContain('R2_ENDPOINT');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
