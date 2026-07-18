# Testing

**Owner module(s):** cross-cutting — every module contributes to the backend/frontend suites; the
E2E harness (`tests/e2e/`) is owned by no single module.

**Contains:** what kind of test lives where, how each suite is run, how the database each needs is
provisioned, and the one deliberate coverage boundary between the backend integration suite and the
E2E harness (AUD-011's crash-recovery path).

This document exists because Post-Phase-5 Stabilization Checkpoint 4 (AUD-013) found this project's
own testing story spread across several stale, sometimes-contradictory notes in
`docs/SESSION_HANDOFF.md` and `docs/IMPLEMENTATION_PLAN.md` — outdated test counts asserted as
current, and language implying browser verification was "ad hoc" when a permanent harness now
exists. This is the one place that story is current and consolidated; the other two documents defer
to it rather than repeating it.

## The four kinds of test in this codebase

| Kind | Location | Runner | Against |
|---|---|---|---|
| Backend unit/integration | `backend/tests/*.test.ts` | Jest (`npm run test --workspace backend`) | Real PostgreSQL (see below) |
| Frontend unit | `frontend/src/**/*.test.tsx` | Vitest (`npm run test --workspace frontend`) | jsdom, no network/DB |
| Browser end-to-end | `tests/e2e/specs/*.spec.ts` | Playwright (`npm run test:e2e`, repo root) | The real compiled backend + real production frontend build + real PostgreSQL, all three provisioned and torn down per run |
| PDF rendering | `backend/tests/pdf-template.test.ts`, plus the PDF-generation assertions inside `payslips.test.ts` | Jest, same process as backend tests | Puppeteer (bundled Chrome-for-Testing), unrelated to Playwright |

**Backend and frontend suites are "deterministic" in the sense this project's own checkpoint
instructions use the word** — no network flakiness, no browser timing, same result every run given
the same code. The E2E suite is the one layer that is genuinely a real browser driving a real
running stack, and is treated differently for that reason (see below).

## Why Puppeteer *and* Playwright both exist in this repository

They serve two unrelated purposes and are not redundant with each other:

- **Puppeteer** (`backend/package.json` dependency) is the payslip **PDF rendering engine**
  (`backend/src/lib/pdf/`) — a production runtime dependency, not a test tool. It renders HTML to
  PDF for the `GET .../payslips/:employeeId/pdf` route and batch ZIP export. It ships with the
  application; it is not part of "testing" at all, despite living in the same dependency graph a
  test suite also touches.
- **Playwright** (`@playwright/test`, root devDependency) is the browser-automation **test**
  framework, used only by `tests/e2e/`. Chosen over adding a second Puppeteer-based test harness
  because this project's own real-browser verification (every phase and stabilization checkpoint
  before this one) had already been using Puppeteer/Playwright-style automation successfully — see
  `tests/e2e/README.md`'s own "Tool choice" note for the fuller reasoning.

Neither replaces the other. Do not add a third browser-automation dependency for either purpose.

## Database provisioning per suite

Every suite that touches PostgreSQL provisions its own, deliberately never the same database twice:

| Suite | Database | Port | Lifecycle |
|---|---|---|---|
| Backend Jest | `payroll_dev` (or whatever `backend/.env`'s `DATABASE_URL` points at) | `5432` (default) | Provisioned once per development session, reused across runs — see below |
| E2E (`tests/e2e/`) | `payroll_e2e`, dedicated credentials | `55432` | Provisioned fresh at the start of every `npm run test:e2e` invocation, fully torn down (including its own data directory) at the end — never reused, never the developer's own database |

**Local backend-test provisioning, no Docker required:** this project's own `docker-compose.yml`
(root) is the normal, developer-machine path to a local `payroll_dev` Postgres. In a sandboxed
environment with no Docker available, the `embedded-postgres` npm package (real PostgreSQL binaries,
no system install, no root) is an equally valid, already-proven alternative — install it, `initdb`,
start it, create the `payroll` role and `payroll_dev` database matching `backend/.env.example`, then
`cp backend/.env.example backend/.env`, `npx prisma migrate deploy` (from `backend/`), seed
(`npm run prisma:seed`), and `npm run test --workspace backend`. This exact recipe is what
`tests/e2e/setup/e2e-environment.ts` automates end-to-end for its own dedicated `payroll_e2e`
database — see `tests/e2e/README.md` for the fully-automated equivalent, which needs no manual
steps at all.

**Do not point any test suite's `DATABASE_URL` at a database you also use for manual/browser
verification of unrelated work** — `backend/tests/helpers.ts`'s own `cleanTestData()` only deletes
rows matching this suite's own naming/scoping conventions (an `@test.local` email domain, a
`Test Site ` name prefix, a `year >= 2900` sentinel), not a blanket truncate; unrelated manually
created rows are never automatically cleaned up and can silently inflate counts other tests assert
against (a real incident from Post-Phase-5 Stabilization Checkpoint 3 — leftover manual-verification
fixture data broke unrelated backend tests until it was found and removed by hand). The E2E harness
avoids this entire class of problem by never reusing a database across runs in the first place.

## Running everything, in the order a fresh clone should

```bash
npm install
npx playwright install chromium   # once — Playwright's own browser binaries, not npm-installed

npm run typecheck
npm run lint
npm run build

npm run test:backend              # requires a provisioned payroll_dev — see above
npm run test:frontend             # no database needed
npm run test:e2e                  # provisions and tears down its own database — see above
```

## Current verified counts

As of Post-Phase-5 Stabilization Checkpoint 4 (2026-07-18): backend **516/516** (unchanged — this
checkpoint touched no backend code), frontend **23/23** (unchanged), E2E **15/15** (new). These numbers *will* drift as new checkpoints/phases add tests — treat any specific
count anywhere in `docs/SESSION_HANDOFF.md` or `docs/IMPLEMENTATION_PLAN.md` as a historical record
of what was true *at that checkpoint*, not a live figure; `docs/PROJECT_PROGRESS.md` §1's most recent
dated entry and this file are the two places that should stay current going forward.
