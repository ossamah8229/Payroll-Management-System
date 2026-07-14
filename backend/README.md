# Backend — Payroll Management System

Express + TypeScript API. See `docs/architecture/*.md` at the repo root for the architecture this
implements; this file is setup/operational only.

## First-time setup

```bash
# from the repo root
npm install
docker compose up -d          # starts local Postgres on localhost:5432

cp backend/.env.example backend/.env   # fill in real values if you're not using the defaults

npm run prisma:generate --workspace backend
npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

`prisma/migrations/` already contains three committed migrations: the initial schema, a second
migration adding the Audit Log immutability trigger (kept separate deliberately — see the comment
at the top of that migration's SQL file for why), and a third (Phase 2) adding `Bank`, `Employee`,
`AdjustmentType`, and `CompanySettings`. `migrate deploy` applies all three; there's nothing to
generate.

Seed the database (idempotent — safe to re-run):

```bash
npm run prisma:seed --workspace backend
```

This creates the Master Admin account, three banks, seven adjustment types, and the singleton
company settings row. Override the seeded email/password via `SEED_MASTER_ADMIN_EMAIL` /
`SEED_MASTER_ADMIN_PASSWORD`, and the placeholder company name via `SEED_COMPANY_NAME`, before
seeding a real environment — the defaults are for local development only.

## Running

```bash
npm run dev --workspace backend     # tsx watch, http://localhost:4000
```

`GET /health` returns `200 { status: "ok" }` without touching the database — a liveness check
independent of Postgres/session-store health, used by Render's health check and useful for
confirming the process itself started.

## Testing

```bash
npm run test --workspace backend
```

Requires the same `DATABASE_URL` as development (tests run against a real Postgres instance —
migrations must already be applied). Covers Phase 1 (login/logout/session-expiry, RBAC middleware
boundaries, Audit Log immutability) and Phase 2 (Project Sites, Employee Registry incl. C11
site-scoping boundaries, Employee Registry import/export, Settings, User Management) per
`docs/IMPLEMENTATION_PLAN.md`'s testing strategy for each.

## Adding a new migration later

Standard Prisma workflow — edit `schema.prisma`, then:

```bash
npx prisma migrate dev --name <description> --schema backend/prisma/schema.prisma
```

## What's deliberately not here yet

Per `docs/IMPLEMENTATION_PLAN.md`, this covers Phase 1 (authentication, RBAC/site-scoping
infrastructure, the audit log) and Phase 2 (Project Sites, Employee Registry, Settings, User
Management, plus their `Bank`/`AdjustmentType`/`CompanySettings` master data). `PayrollCycle`,
`PayrollEntry`, `Advance`, `Correction`, and `BalanceAdjustment` are not in `schema.prisma` yet —
they're added additively (Principle 8) in the migrations that accompany the phases that build those
modules. `BackupPackage` is deferred with them (Phase 5).

File uploads (company logo, user avatar) are still not wired up to any route — the `StorageProvider`
abstraction called for in Phase 0 was never actually built until Phase 5 Checkpoint 0
(`backend/src/lib/storage/`, see `docs/architecture/system-conventions.md §2` and
`docs/PROJECT_PROGRESS.md` §3 item 4); it exists now, but no service imports it yet — the next
consumer is the `BackupPackage` checkpoint (Phase 5).

Generated/persisted files are written under `STORAGE_ROOT` (`.env.example`, default `storage` —
resolves to `backend/storage/`, gitignored, created automatically if missing). Required in every
environment; there is no unsafe fallback if it's left unset.
