// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

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
  {
    // Puppeteer's own config-file convention (`lilconfig`'s `searchPlaces`) requires plain
    // CommonJS, not ESM — this can't be a `.ts`/`.mjs` file.
    files: ['.puppeteerrc.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  prettierConfig,
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'jest.config.js',
      'eslint.config.mjs',
      // Puppeteer's downloaded Chrome binary (backend/.puppeteerrc.cjs's project-local
      // cacheDirectory) — not source code, ships its own bundled/minified browser JS resources.
      '.cache/',
    ],
  },
);
