// Runs before any test file's imports (Jest `setupFiles`), so src/config/env.ts sees a valid
// environment even if the developer hasn't created a backend/.env file. Real projects running
// these tests in CI or locally against docker-compose's Postgres can override any of these via
// actual environment variables — these are fallbacks, not fixed values.

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://payroll:payroll_dev_password@localhost:5432/payroll_dev?schema=public';
process.env.SESSION_SECRET ??= 'test-only-session-secret-not-for-production-use';
process.env.CSRF_SECRET ??= 'test-only-csrf-secret-not-for-production-use';
process.env.CORS_ORIGIN ??= 'http://localhost:5173';
