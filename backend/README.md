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

`prisma/migrations/` already contains two committed migrations: the initial schema, and a second
migration adding the Audit Log immutability trigger (kept separate deliberately — see the comment
at the top of that migration's SQL file for why). `migrate deploy` applies both; there's nothing
to generate.

Seed the database (idempotent — safe to re-run):

```bash
npm run prisma:seed --workspace backend
```

This creates the Master Admin account. Override the seeded email/password via
`SEED_MASTER_ADMIN_EMAIL` / `SEED_MASTER_ADMIN_PASSWORD` env vars before seeding a real
environment — the defaults are for local development only.

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
migrations must already be applied). See `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 testing strategy
for what's covered: login/logout/session-expiry, RBAC middleware boundaries, and the Audit Log
immutability trigger specifically.

## Adding a new migration later

Standard Prisma workflow — edit `schema.prisma`, then:

```bash
npx prisma migrate dev --name <description> --schema backend/prisma/schema.prisma
```

## What's deliberately not here yet

Per `docs/IMPLEMENTATION_PLAN.md`, this is Phase 1 only: authentication, RBAC/site-scoping
infrastructure, and the audit log. `Employee`, `PayrollCycle`, `PayrollEntry`, `Advance`,
`Correction`, `BalanceAdjustment`, `Bank`, `AdjustmentType`, `BackupPackage`, and `CompanySettings`
are not in `schema.prisma` yet — they're added additively (Principle 8) in the migrations that
accompany the phases that build those modules.
