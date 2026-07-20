# Version 1.0 — Configuration Reference

Every environment variable the application reads, gathered in one place for RC1. Sources: `backend/src/config/env.ts` (validated centrally with `zod`, fails fast at startup — this is the single place backend env vars are read; `grep`-confirmed no other file reads `process.env` directly except `backend/prisma/seed.ts`'s three seed-only overrides), `backend/.env.example`, `frontend/.env.example`, `frontend/src/lib/api-client.ts`.

## Backend (`backend/.env`, copy from `backend/.env.example`)

| Variable | Required? | Dev purpose | Prod purpose | Safe example | Secret? | Missing behavior |
|---|---|---|---|---|---|---|
| `NODE_ENV` | Optional (default `development`) | Enables verbose dev logging, non-secure cookies | `production` disables `createTableIfMissing` on the session store, enables `secure` cookies, gates several safety checks (`isProduction`) | `production` | No | Defaults to `development` — **must be explicitly set to `production` in production**, nothing enforces this automatically |
| `PORT` | Optional (default `4000`) | Local dev port | Render sets this via `render.yaml` | `4000` | No | Defaults to 4000 |
| `DATABASE_URL` | **Required** | Local Postgres connection string | Render-provisioned managed Postgres connection string (injected via `render.yaml`'s `fromDatabase`) | `postgresql://payroll:payroll_dev_password@localhost:5432/payroll_dev?schema=public` | **Yes** (contains credentials) | Process exits at startup with a readable validation error listing every invalid/missing field |
| `SESSION_SECRET` | **Required**, min 16 chars | Signs the `express-session` cookie | Same, must be a real random value in production | `dev-only-session-secret-change-me` (dev only) — generate via `openssl rand -base64 48` for anything beyond local dev | **Yes** | Same fail-fast startup error |
| `CSRF_SECRET` | **Required**, min 16 chars | Reserved for the CSRF double-submit implementation (`common/middleware/csrf.ts`) | Same | `dev-only-csrf-secret-change-me` (dev only) | **Yes** | Same fail-fast startup error |
| `CORS_ORIGIN` | **Required** | The frontend dev-server origin allowed to make credentialed cross-origin requests | The deployed frontend's real origin (Render Static Site URL, or custom domain) | `http://localhost:5173` (dev) | No | Same fail-fast startup error |
| `STORAGE_ROOT` | **Required** | Root directory for `LocalFilesystemStorageProvider` — resolved relative to the backend process's CWD if not already absolute; created automatically if missing | Local dev only — production is expected to move to a cloud object-storage provider behind the same `StorageProvider` abstraction (`docs/architecture/system-conventions.md §2`), but **no cloud provider is implemented yet in v1.0** (local filesystem is the only `StorageProvider` implementation that exists) — see Known Issues | `storage` | No, but the resolved path must not equal the process's own working directory (a second safety check in `lib/storage/index.ts` beyond the schema's presence check) | Same fail-fast startup error — deliberately no unsafe default path |
| `SEED_MASTER_ADMIN_EMAIL` | Optional (seed-time only) | Overrides the seeded Master Admin email | Should always be overridden before seeding a real environment | `admin@yourcompany.com` | No | Defaults to `admin@broomservices.pk` |
| `SEED_MASTER_ADMIN_PASSWORD` | Optional (seed-time only) | Overrides the seeded Master Admin password | **Must** be overridden before seeding a real environment — the seed script itself warns when this is left at its default | Generate a real random value | **Yes** | Defaults to the well-known placeholder `ChangeMe123!` — the seed script prints a warning reminding the operator to change it after first login when this var isn't set |
| `SEED_COMPANY_NAME` | Optional (seed-time only) | Overrides the seeded company name | Set to the real client company name before seeding production | `Broom Services Private Limited` | No | Defaults to `Broom Services Private Limited` (the actual client name — a placeholder in name only) |

Not yet used by any code path (reserved names only, no current effect): none found — the schema in `env.ts` is exactly the set of variables actually consumed.

## Frontend (`frontend/.env.local`, copy from `frontend/.env.example`)

| Variable | Required? | Dev purpose | Prod purpose | Safe example | Secret? | Missing behavior |
|---|---|---|---|---|---|---|
| `VITE_API_URL` | Optional, empty by default | Left empty to use Vite dev server's own `/api` proxy (`vite.config.ts`) | **Must** be set to the deployed backend's real origin at *build time* (Vite inlines env vars into the built bundle — this cannot be changed after `npm run build` without rebuilding) | Empty (dev) / `https://payroll-backend.onrender.com` (prod) | No | `api-client.ts` falls back to `''` (relative paths), which only works when frontend and backend share an origin or a proxy is in front of both |

## Session/CSRF cookie security posture (derived from `secure: isProduction`, `sameSite: 'lax'`)

- **`app.set('trust proxy', 1)`** is already configured (`backend/src/app.ts`) — required for `secure` cookies and `req.ip` to work correctly behind Render's TLS-terminating edge, which forwards `X-Forwarded-Proto: https`. **Verified empirically during RC1 Step 6**: with `NODE_ENV=production` behind a reverse proxy that sets `X-Forwarded-Proto: https` (matching Render's real topology), login/session/CSRF all work correctly. Without a proxy in front (plain HTTP directly to the Express process), `express-session` deliberately refuses to set the session cookie (`secure: true` cookie over a connection it can't prove is HTTPS) — this is expected, correct behavior, not a bug, but it means **the backend must never be exposed to real users directly over plain HTTP in production**; it must always sit behind Render's (or an equivalent) TLS-terminating proxy.
- **`SameSite=Lax`** on both the session and CSRF cookies is only safe for genuinely cross-*site* frontend/backend origins if the browser still attaches the cookie to the relevant requests. See `docs/release/SECURITY_REVIEW_v1.0.md` for the flagged risk around Render's `*.onrender.com` subdomains being registered on the Public Suffix List (making frontend and backend cross-*site*, not just cross-*origin*) and its interaction with `SameSite=Lax`.

## Startup validation behavior (all required vars)

Confirmed live during RC1 validation: `backend/src/config/env.ts` parses `process.env` through a single `zod` schema at import time. Any missing or malformed required variable prints a readable, itemized list of every problem (not just the first) to stderr and calls `process.exit(1)` — the process never starts partially configured. No unsafe fallback exists for any secret-bearing variable.
