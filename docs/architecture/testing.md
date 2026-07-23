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
the same code — **with one documented exception: `payslips.test.ts`**, which launches a real
Puppeteer/Chrome-for-Testing browser (see "PDF rendering" row above) and is therefore genuinely
subject to host-level timing/resource variability the same way the E2E suite is, just without a
real network/frontend involved. See "Payslip PDF test reliability" below for the full investigation,
fix, and its measured limits. The E2E suite is the other layer that is genuinely a real browser
driving a real running stack, and is treated differently for that reason (see below).

## Payslip PDF test reliability (Pre-Deployment Reliability Checkpoint)

`payslips.test.ts` intermittently failed under full-backend-suite load (11 failures in one observed
run) — investigated by extensive controlled reproduction (20+ isolated runs, 15+ full-suite runs,
both before and after the fix, with `vm_stat`/process-count sampling throughout). Full record:
`docs/PROJECT_PROGRESS.md`'s "Pre-Deployment Reliability Checkpoint" entry and
`docs/release/KNOWN_ISSUES_v1.0.md` KI-10.

**Root cause**: every failure was a hard Jest timeout (`Exceeded timeout of Nms`) on an otherwise
*correct* operation — a `beforeEach`/`afterAll` hook (`cleanTestData()`) or an individual PDF render
— never an incorrect PDF, an incorrect response, or a leaked process/handle (both confirmed
directly: zero orphaned Chrome processes and full memory recovery after every single reproduction
run, clean or failing). The proximate trigger is this host's own measured, genuine resource
contention from processes *outside* this test suite (other concurrent sessions on this shared
sandbox) — `vm_stat` sampling during reproduction showed free memory dropping as low as ~15-20MB and
the shared Puppeteer browser's own RSS reaching ~600-700MB during this file's heaviest test (a
300-employee batch render). This is genuinely a resource-availability problem, not a code-level
leak or a design defect in the singleton-browser lifecycle (`backend/src/lib/pdf/browser.ts`), which
was reviewed and found correctly bounded (try/finally page cleanup, concurrency-safe relaunch,
`closeBrowser()` in `afterAll`).

**Fix** (three parts, all in `backend/src/lib/pdf/browser.ts`/`render-pdf.ts` and
`backend/tests/payslips.test.ts` — no payslip business logic touched):
1. `renderHtmlToPdf` now retries exactly once, against a freshly discarded-and-relaunched browser,
   if a render fails for any reason — closes a real gap in `getBrowser()`'s own health check
   (`browser.connected` only detects a fully crashed process, not one alive but unable to service a
   new page under transient resource pressure).
2. The 300-employee batch test — by far the single heaviest consumer of the shared browser's
   resources in this file — now explicitly recycles the browser (`closeBrowser()`) immediately after
   it succeeds, so its own outsized footprint doesn't compound into every test that runs after it.
3. This file's own Jest timeout is raised from the global 15000ms default (`tests/setup.ts`, still
   15000ms for the other 44 suites) to 45000ms, `jest.setTimeout()` scoped to this file alone —
   justified by the same measured contention above, not a blind increase.

**Measured result — a real, large reduction, not a claim of absolute zero**: comparing 20 isolated +
10 full-suite runs before the fix against the same battery after: PDF/timeout-specific failures in
isolated runs went from 2/20 to 0/20; in full-suite runs, from 2/10 to 1/10, and that one remaining
case coincided with a directly measured, severe host slowdown (this file alone took 368s vs. its
normal ~70s — a >5x slowdown) that no finite, principled timeout can fully absorb without becoming
unrealistic. **This is the honest limit of an application-level fix**: the remaining, much-reduced
residual risk is tied to genuinely severe ambient contention on a shared host outside this codebase's
control, not a bug left unfixed.

**A separate, unrelated flake found (not fully resolved) during this same investigation**:
`'issues a constant number of queries regardless of batch size (no N+1)'` — a pure Prisma/Postgres
query-count assertion with no Puppeteer involvement at all — occasionally observed an off-by-one
query count under contention (a connection-pool-level effect, not an N+1 regression: `small`/`large`
result lengths were always correct). The test's own warm-up was broadened to prime all three batch
shapes instead of one, which reduced but did not eliminate the ~5-10% recurrence rate seen in
reproduction. Left as a known, separate, lower-priority issue (KI-10 covers it) rather than weakening
its exact-equality assertion, which the checkpoint's own instructions for this investigation
explicitly forbid.

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
