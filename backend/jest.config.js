/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/env.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Phase 7H — shuts down the shared PDF test worker (src/lib/pdf/worker/) exactly once, after
  // every suite in the run has finished, regardless of which ones passed or failed.
  globalTeardown: '<rootDir>/tests/globalTeardown.ts',
  clearMocks: true,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
