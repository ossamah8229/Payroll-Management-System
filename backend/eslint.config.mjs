// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    // A CLI script, not application code — console output here is the intended, user-facing
    // progress reporting for whoever runs `npm run prisma:seed`, not a substitute for the
    // structured pino logging application code uses (src/lib/logger.ts).
    files: ['prisma/seed.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'jest.config.js', 'eslint.config.mjs'],
  },
);
