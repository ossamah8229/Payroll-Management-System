# Backend — Payroll Management System

Express + TypeScript API. See `docs/architecture/*.md` at the repo root for the architecture this
implements; this file is setup/operational only.

## First-time setup

```bash
# from the repo root
npm install
docker compose up -d          # starts local Postgres on localhost:5432

cp backend/.env.example backend/.env   # fill in real values if you're not using the defaults

npm run build:shared          # backend/prisma/seed.ts imports @payroll/shared/dist — build it first
npm run prisma:generate --workspace backend
npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

As of `v1.0.0-rc1`, `prisma/migrations/` contains 18 migrations (see `RC1_VALIDATION_REPORT.md` and
`docs/release/` for the full RC1 record) — `migrate deploy` applies whichever of them haven't run
yet; there's nothing to generate. Most are Prisma-managed schema migrations; a few (the Audit Log
immutability trigger, and the `session` table used by `connect-pg-simple`, see "Running" below) are
hand-written SQL for things `schema.prisma` itself can't express — each says why at the top of its
own `migration.sql`.

If you'll be running Payslip PDF generation (Puppeteer) or E2E tests, Chrome needs to be present:

```bash
npx puppeteer browsers install chrome   # normally runs automatically via postinstall; run manually
                                         # if your environment has install scripts disabled
npx playwright install chromium         # only needed for `npm run test:e2e`
```

Seed the database (idempotent — safe to re-run):

```bash
npm run prisma:seed --workspace backend
```

This creates the permission/role registry and role-permission grants, the Master Admin account,
three banks, seven adjustment types, and the singleton company settings row. Override the seeded
email/password via `SEED_MASTER_ADMIN_EMAIL` / `SEED_MASTER_ADMIN_PASSWORD`, and the placeholder
company name via `SEED_COMPANY_NAME`, before seeding a real environment — the defaults are for local
development only.

## Running

```bash
npm run dev --workspace backend     # tsx watch, http://localhost:4000
```

`GET /health` returns `200 { status: "ok" }` without touching the database — a liveness check
independent of Postgres/session-store health, used by Render's health check and useful for
confirming the process itself started.

**Production mode** (`NODE_ENV=production`, e.g. `npm run build --workspace backend && npm run start --workspace backend`)
changes two things relevant to a first deploy: `secure` cookies are enforced (the process must sit
behind a TLS-terminating proxy — Render's own edge satisfies this via `X-Forwarded-Proto`, already
trusted through `app.set('trust proxy', 1)`), and `connect-pg-simple`'s `session` table is **not**
auto-created (`createTableIfMissing: false` in production, deliberately, to avoid a first-request
race) — it's provided by the `20260719120000_session_store_table` migration instead, so a normal
`prisma migrate deploy` already covers it. Don't run the app against a database that skipped that
migration.

## Testing

```bash
npm run test --workspace backend
```

Requires the same `DATABASE_URL` as development (tests run against a real Postgres instance —
migrations must already be applied, and the database must already be seeded, since several suites
depend on the seeded Company Settings row and adjustment types). Covers the full implemented scope
through Phase 6 (Auth/RBAC/Audit Log, Project Sites/Employee Registry/Settings/Users, Payroll Entry
& Processing, Release/Bank Sheets/Cash Receiving/Advances/Payslips, Cycle Finalization/Archiving/
Backups, Corrections & Balance Adjustments) — see `docs/IMPLEMENTATION_PLAN.md`'s per-phase testing
strategy and `docs/release/RC1_VALIDATION_REPORT.md` for the current full-suite baseline.

## Adding a new migration later

Standard Prisma workflow — edit `schema.prisma`, then:

```bash
npx prisma migrate dev --name <description> --schema backend/prisma/schema.prisma
```

## What's deliberately not here yet

As of `v1.0.0-rc1`, Phases 0–6 are implemented (see `docs/release/RELEASE_SCOPE_v1.0.md` for the
full v1.0 scope statement and its explicit exclusions). Not yet built, by design: Employee
Statements/Fines & EOBI Report/Dashboard (Phase 7), a dedicated Audit Log viewer UI (Phase 8 — the
`AuditLog` table, immutability trigger, and per-record audit trail all exist and are exercised by
every module; there is simply no HTTP route or UI to browse the full log), and Render production
deployment / a dedicated further hardening pass (Phase 9).

Generated/persisted files are written under `STORAGE_ROOT` (`.env.example`, default `storage` —
resolves to `backend/storage/`, gitignored, created automatically if missing). Required in every
environment; there is no unsafe fallback if it's left unset. Only `LocalFilesystemStorageProvider`
exists — no cloud object-storage `StorageProvider` implementation has been built yet (see
`docs/release/KNOWN_ISSUES_v1.0.md`).
