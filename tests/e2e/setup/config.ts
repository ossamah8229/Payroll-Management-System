import path from 'node:path';

/**
 * AUD-013 (Post-Phase-5 Stabilization Checkpoint 4) — every port, credential, and path the E2E
 * harness uses, gathered in one place so `global-setup.ts`/`global-teardown.ts`/`playwright.config.ts`
 * agree on them without duplicating literals. Every value here is deliberately distinct from this
 * project's own normal local-dev setup (`backend/.env.example`'s `payroll_dev` on port 5432, the
 * dev servers on 4000/5173) — the harness must never be able to collide with, or accidentally
 * operate against, a developer's real local database or already-running dev servers.
 */

export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const E2E_TMP_DIR = path.join(REPO_ROOT, 'tests/e2e/.tmp');
export const PG_DATA_DIR = path.join(E2E_TMP_DIR, 'pgdata');
export const STORAGE_ROOT = path.join(E2E_TMP_DIR, 'storage');
export const STATE_FILE = path.join(E2E_TMP_DIR, 'environment-state.json');

export const PG_PORT = 55432;
export const PG_USER = 'payroll_e2e';
export const PG_PASSWORD = 'payroll_e2e_password';
export const PG_DATABASE = 'payroll_e2e';

export const BACKEND_PORT = 4100;
export const FRONTEND_PORT = 4200;

export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
export const DATABASE_URL = `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DATABASE}?schema=public`;

/** Never a real secret — E2E runs entirely over plain HTTP on localhost, never exposed. Long
 * enough to satisfy `backend/src/config/env.ts`'s own `.min(16)` validation. */
export const SESSION_SECRET = 'e2e-harness-session-secret-not-for-production-use';
export const CSRF_SECRET = 'e2e-harness-csrf-secret-not-for-production-use-000';

/** A deliberately obvious, documented, non-production credential — see `tests/e2e/README.md`. */
export const MASTER_ADMIN_EMAIL = 'admin@broomservices.pk';
export const MASTER_ADMIN_PASSWORD = 'E2E-Harness-Password-1!';
