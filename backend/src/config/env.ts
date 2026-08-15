import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the backend needs, validated once at startup. Fails fast with a
 * readable error if anything required is missing or malformed, rather than surfacing an obscure
 * error later from whichever module first touches the bad value.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Selects the Jest-only PDF test worker (`lib/pdf/worker/`) instead of the real in-process
  // renderer — deliberately a *separate* signal from NODE_ENV=test. The E2E harness also runs the
  // real compiled backend with NODE_ENV=test (needed for auth.routes.ts's relaxed login rate
  // limit), but its dist/ build never contains the worker's own source-only entry point, so that
  // real server must always use the real renderer. Only backend Jest (`tests/env.setup.ts`) sets
  // this to '1'; every other runtime — including a misconfigured production deploy that somehow
  // has it set — defaults it out via `usePdfTestWorker`'s own NODE_ENV=test requirement below.
  PDF_TEST_WORKER: z.enum(['0', '1']).default('0'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  CSRF_SECRET: z.string().min(16, 'CSRF_SECRET must be at least 16 characters'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),
  // No schema default, deliberately — matching SESSION_SECRET/CSRF_SECRET's pattern rather than
  // PORT's. A missing value must fail loudly at startup rather than silently falling back to some
  // guessed path (docs/architecture/system-conventions.md §2, Phase 5 Checkpoint 0). `.env.example`
  // ships a working local-dev value; `lib/storage/index.ts`'s `resolveStorageRoot()` performs a
  // second, storage-specific safety check on top of this one (rejects a value that resolves to the
  // process's own working directory).
  STORAGE_ROOT: z.string().min(1, 'STORAGE_ROOT is required'),
  // Phase 7C — selects which `StorageProvider` implementation `lib/storage/index.ts` constructs.
  // Defaults to `local` (the only implementation before this checkpoint) so every existing
  // deployment/dev setup keeps working with zero configuration change. `r2` requires the five
  // R2_* variables below (enforced by this schema's own `.superRefine` — see it for why they stay
  // individually optional here).
  STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
  // Cloudflare R2 (S3-compatible) credentials — kept individually optional in the base schema
  // (rather than `.min(1)` required) because they must be *absent-tolerant* when
  // `STORAGE_PROVIDER=local` (the default local/dev/test setup, matching every environment this
  // codebase already runs in) — `.superRefine` below is what actually enforces "all five present"
  // the moment `STORAGE_PROVIDER=r2` is chosen, so a production misconfiguration still fails fast
  // at startup exactly like `STORAGE_ROOT` already does, never silently.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.STORAGE_PROVIDER !== 'r2') return;

  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_ENDPOINT',
  ] as const;

  for (const key of required) {
    if (!value[key]) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when STORAGE_PROVIDER=r2`,
      });
    }
  }
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
// Both conditions required, on purpose: NODE_ENV=test alone (the E2E harness's real compiled
// backend) must never select the Jest-only worker, and PDF_TEST_WORKER=1 alone (e.g. an
// accidental leftover in a production-like environment) must never do so either — only Jest's own
// `tests/env.setup.ts` sets both.
export const usePdfTestWorker = isTest && env.PDF_TEST_WORKER === '1';
