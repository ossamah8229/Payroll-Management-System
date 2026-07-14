import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the backend needs, validated once at startup. Fails fast with a
 * readable error if anything required is missing or malformed, rather than surfacing an obscure
 * error later from whichever module first touches the bad value.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
