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
| PDF rendering | `backend/tests/pdf-template.test.ts`, plus the PDF-generation assertions inside `payslips.test.ts`, `statements.test.ts`, `payroll-hold-workflow.test.ts` | Jest, but real Puppeteer rendering happens in a separate persistent worker process (`backend/src/lib/pdf/worker/`) — see "Backend PDF test architecture" below | Puppeteer (bundled Chrome-for-Testing), unrelated to Playwright |

**Backend and frontend suites are "deterministic" in the sense this project's own checkpoint
instructions use the word** — no network flakiness, no browser timing, same result every run given
the same code — **with one documented exception: the real-Puppeteer suites** (`payslips.test.ts`,
`statements.test.ts`, `payroll-hold-workflow.test.ts`), which render real PDFs via a real
Chrome-for-Testing browser (see "PDF rendering" row above) and were therefore genuinely subject to
host-level timing/resource variability the same way the E2E suite is, just without a real
network/frontend involved. See "Payslip PDF test reliability" and "Backend PDF test architecture"
below for the full investigation, fix, and its measured limits. The E2E suite is the other layer
that is genuinely a real browser driving a real running stack, and is treated differently for that
reason (see below).

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

## Backend PDF test architecture (Phase 7H)

**Confirmed root cause, superseding the "resource contention" explanation above for one specific
failure shape.** PR #6's CI kept intermittently failing a real-Puppeteer assertion with the error
`"Test environment has been torn down"`. Investigation (full record: `docs/PROJECT_PROGRESS.md`'s
"Phase 7H" entry) proved this is a **Jest/`--experimental-vm-modules` VM-lifecycle race**, not host
resource contention and not an application defect:

- `backend/src/lib/pdf/browser.ts`'s dynamic `import('puppeteer')` (the documented ESM-interop
  workaround `new Function('return import("puppeteer")')`, required because Puppeteer 22+ ships
  ESM-only against this backend's CommonJS compile target) is a genuine, sometimes-slow native Node
  operation.
- Jest's `--experimental-vm-modules` mode gives every test *file* its own disposable VM realm and
  tears each one down independently once that file's tests finish.
- Under real concurrent load (many files each doing this same dynamic import around the same time),
  the import can resolve *after* Jest has already torn down the realm that started it. Jest's own
  module registry then throws `"Test environment has been torn down"` — the stack trace traces
  directly into `jest-util`'s own `invariant()`, not into any application code.
- Reproduced deterministically: 20 throwaway test files, each calling `renderHtmlToPdf()` directly
  under `--runInBand`, failed 37/40 and 18/20 across two runs. The identical render, called the
  same number of times from a plain Node script with no Jest involved at all, succeeded 20/20 every
  time — proving the render pipeline itself was never the problem.
- A child process spawned *from* a Jest test and given the same work is structurally immune — 10/10
  passed under the exact same concurrent stress that made direct in-Jest calls fail 90% of the time,
  since a child process is never itself inside any Jest VM realm.

**Old architecture**: every real-Puppeteer test file launched and owned its own in-process
Puppeteer browser via `browser.ts`'s singleton, subject to the race above.

**New architecture**: a persistent PDF test worker, `backend/src/lib/pdf/worker/`
(`pdf-worker.entry.ts` the child process itself, `pdf-worker-client.ts` the parent-side API,
`protocol.ts` the newline-delimited-JSON wire format). `render-pdf.ts`'s `renderHtmlToPdf()`
delegates to it whenever `usePdfTestWorker` (`config/env.ts`) is true — see "NODE_ENV=test does not
imply the PDF test worker" below for exactly when that is — and is unchanged for
`development`/`production`; the worker itself imports and calls the exact same
`renderOnce()`/`browser.ts` code, not a reimplementation, so production rendering output is
identical either way.

- **Spawned lazily**, once, by whichever test file first needs a real render; every other file in
  the same `--runInBand` run reuses it via a fixed socket path and a `fs.mkdirSync`-based spawn
  lock (atomic — safe if several files race to be first). Never inside any Jest VM realm, so the
  race above cannot occur regardless of concurrent load.
- **Ownership/cleanup**: `tests/globalTeardown.ts` sends one `shutdown` message at the very end of
  the whole Jest run, regardless of which suites passed or failed. Test files that used to call
  `browser.ts`'s `closeBrowser()` directly (to proactively recycle memory, e.g. after a
  300-employee batch render) now call `render-pdf.ts`'s `closePdfRenderer()` instead — in
  `NODE_ENV=test` that recycles the worker's browser, not a local one that's no longer ever used.
- **Two real bugs found and fixed during stress-testing this architecture itself**, both about
  Chrome specifically outliving the process meant to own it: (1) the client's own "is a worker
  already running" check could false-negative under load, letting a second worker start and steal
  the socket from a still-healthy first one — fixed by making the *worker's own* startup bind-first
  and only fall back to a liveness check on `EADDRINUSE`, removing the check-then-act race entirely.
  (2) Puppeteer launches Chrome **detached into its own OS process group**, separate from the
  worker's — confirmed directly via `ps -eo pid,ppid,pgid` — so `browser.close()` not fully
  terminating every Chrome helper process (a real, if uncommon, Puppeteer behavior) previously left
  orphans with nothing left to notice or clean them up. The worker now tracks Chrome's own pid
  (`peekBrowserProcessPid()`, `browser.ts`) and, on shutdown/recycle, kills Chrome's own process
  group directly as a backstop; a hard-killed worker (simulating an external OOM kill) records
  Chrome's pid to disk beforehand so the *next* spawn can sweep up that orphan too.
- **Observability**: a retry-exhausted render (both the in-process and worker paths share this)
  tags the failing error with which stage broke (`browser-launch`/`new-page`/`set-content`/
  `pdf-generation`/`page-close`) and emits one structured diagnostic via `console.error` — the only
  exception to `backend/src/lib/logger.ts`'s `NODE_ENV=test` silence, added because the original
  investigation found CI logs had *no trace* of the underlying exception at all. `normalizeError()`
  (`lib/pdf/normalize-error.ts`) extracts name/message/stack by duck-typing rather than
  `instanceof Error`, so a cross-realm error (exactly the kind this was built to catch) is reported
  accurately instead of collapsing to a generic `"object"` fallback. Never logs HTML, employee
  names, or salary data — only the caught error's own identity plus fixed retry bookkeeping.

**Verification**: each real-PDF suite run in isolation 5×, all real-PDF suites together 5×, the
full backend suite 3× (3,843 total test executions across the three full runs) — zero
`"Test environment has been torn down"` occurrences, zero lingering Chrome/CDP/worker processes
after any run. The one failure seen across all of this repetition was `corrections-service.test.ts`'s
already-documented, unrelated concurrency-timing flake (see that file's own history in
`docs/PROJECT_PROGRESS.md`) — not misclassified as a PDF issue.

**KI-10 status**: the Jest-VM-teardown failure mode this section documents is resolved by
construction (the worker is structurally immune, not merely less likely to fail) and confirmed
via the repetition above — **substantially improved for this specific failure shape**. The
*separate* off-by-one query-count flake (next section) is unchanged and still open; KI-10 in
`docs/release/KNOWN_ISSUES_v1.0.md` is updated to distinguish the two rather than treating them as
one issue with one status.

### NODE_ENV=test does not imply the PDF test worker (Phase 3A CI-hardening fix)

**Confirmed root cause of a Phase 3 E2E CI failure**, distinct from the Jest-VM-teardown race
above. Wiring the Playwright suite into CI (`.github/workflows/ci.yml`'s `e2e` job) surfaced a
second, unrelated defect in the same delegation decision: `renderHtmlToPdf()` originally gated the
test-worker delegation on bare `NODE_ENV=test`, on the assumption that any `NODE_ENV=test` process
*is* a Jest test file. That assumption is false for this project's own E2E harness —
`tests/e2e/setup/e2e-environment.ts` deliberately starts the real *compiled* backend
(`node dist/server.js`) with `NODE_ENV=test`, needed only so `auth.routes.ts`'s login rate limiter
relaxes from 10 to 1000 attempts (`isTest ? 1000 : 10` — the E2E suite performs many real logins
from one IP). That real server's `dist/` build never contains the worker's own source-only entry
point (`pdf-worker-client.ts`'s `WORKER_ENTRY`, resolved as `pdf-worker.entry.ts` — `tsc` only ever
emits `.js`), so every PDF request in the compiled E2E backend tried to spawn a file that doesn't
exist, got `ERR_MODULE_NOT_FOUND`, and `renderWithOneRetry`'s own attempt→discard→retry sequence
burned three independent 30-second worker-ready timeouts (confirmed by direct reproduction: ~90s
before a 500 response) — comfortably past `15-statements.spec.ts`'s 60-second
`page.waitForEvent('download')` wait, and the only E2E spec in the whole suite that exercises real
PDF rendering (every other download spec covers xlsx/csv, which never touch this code path).

**Fix**: `config/env.ts` adds a dedicated `PDF_TEST_WORKER` env var (schema-validated, defaults to
`'0'`) and exports `usePdfTestWorker = isTest && env.PDF_TEST_WORKER === '1'` — both conditions
required, so neither signal alone can select the worker. `backend/tests/env.setup.ts` (Jest's own
`setupFiles`, applied to every backend test file automatically) sets `PDF_TEST_WORKER=1`; nothing
else in the codebase ever sets it, so:

| Runtime | `NODE_ENV` | `PDF_TEST_WORKER` | Renderer used |
|---|---|---|---|
| Backend Jest | `test` | `1` (`tests/env.setup.ts`) | Jest-only test worker |
| E2E harness (real compiled backend) | `test` | unset | Real in-process Puppeteer renderer |
| Production / any real deployment | `production` | unset | Real in-process Puppeteer renderer |
| Misconfigured production-like runtime | `production`/`development` | `1` (accidental) | Real in-process Puppeteer renderer — the `isTest &&` half of `usePdfTestWorker` ignores `PDF_TEST_WORKER` outside `NODE_ENV=test`, so this can never accidentally select the worker |

`backend/tests/pdf-worker-mode-selection.test.ts` proves all four rows directly — both
`usePdfTestWorker`'s own value (reloading `config/env.ts` fresh per case via `jest.isolateModules`)
and `renderHtmlToPdf()`'s actual routing (mocking the worker client and `browser.ts` to observe
which one a render call reaches, never launching real Chrome).

**Verified**: the full backend Jest suite (1830/1831 — the one unrelated failure is
`overtime-report-performance.test.ts`'s already-self-documented, Postgres-planner-dependent
EXPLAIN-plan assertion, not an auth/PDF issue) on a fresh database; `15-statements.spec.ts` three
consecutive times against the real E2E stack (11/11 each run, Export PDF in 4-5s, zero worker
crash/pid files, zero orphaned processes after teardown — confirming the compiled E2E backend never
attempts to resolve `pdf-worker.entry.ts` at all).

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

## Backend Jest heap

`npm run test --workspace backend` (`backend/package.json`'s own `test` script) sets
`NODE_OPTIONS='--experimental-vm-modules --max-old-space-size=3072'` — the `--max-old-space-size`
half exists because the full `--runInBand` run, taken together, accumulates enough live data from
this suite's several 10k–30k-row performance/boundary fixtures (each cleaned up by its own
`afterAll`, but the run is one long-lived process the whole way through) to reach V8's ~2.2GB default
old-space ceiling and crash with `FATAL ERROR: Reached heap limit … JavaScript heap out of memory` —
reproduced deterministically, always partway through the run (suite ~62/93 on the measured host), never
in an individual file run alone. 3072MB was the smallest round increase that let a real, reproduced-clean
run complete all 93/93 suites. This is scoped to the `test` script only — `dev`/`start`/`build` and the
runtime server are untouched, so production memory behavior does not change.

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

## Continuous integration (Test Reliability Remediation Phase 3)

`.github/workflows/ci.yml` runs on every pull request and every push to `main`, as three
independent jobs on `ubuntu-latest`. Any job failing (a test, typecheck, lint, build, migration, or
seed step) fails the whole workflow — nothing is retried away or suppressed.

| Job | Runs | Database | Notes |
|---|---|---|---|
| `backend` | Prisma generate/migrate/seed, backend typecheck, backend lint, canonical backend Jest (`npm run test --workspace backend`, the Phase 2 `NODE_OPTIONS='--experimental-vm-modules --max-old-space-size=3072'` heap setting lives once in `backend/package.json`'s own `test` script), backend build | A `postgres:16-alpine` service container, fresh per run | Puppeteer's Chrome is installed via `npx puppeteer browsers install chrome` (`working-directory: backend`, so `.puppeteerrc.cjs` resolves) before the PDF-rendering tests run |
| `frontend` | Frontend typecheck, frontend lint, canonical frontend Vitest (`npm run test --workspace frontend`, non-watch `vitest run`), frontend build | None — jsdom/Node only, no network | Needs `shared/dist` built first, same as any other `@payroll/shared` consumer |
| `e2e` | E2E spec typecheck, canonical Playwright suite (`npm run test:e2e`) | `tests/e2e/setup/e2e-environment.ts`'s own disposable embedded-postgres cluster (port `55432`), provisioned and torn down entirely inside Playwright's `globalSetup`/`globalTeardown` — no CI service container | Runs only after `backend` and `frontend` both pass (`needs:`), so a broken branch fails fast before paying for the E2E stack's own build/start cost. Installs Chromium via `npx playwright install --with-deps chromium` (`--with-deps` adds the OS libraries a bare runner lacks) and, separately, Puppeteer's Chrome (`working-directory: backend`) — the real backend the harness starts renders real payslip/statement PDFs at runtime (specs 13, 15, 16) |

**Database lifecycle**: the `backend` job's Postgres is a GitHub Actions service container — created
fresh for that job's runner and discarded when the job ends, never shared across jobs or runs. The
`e2e` job has no service container at all; `tests/e2e/setup/e2e-environment.ts` (unchanged by this
work — see "Database provisioning per suite" above) provisions its own embedded PostgreSQL cluster,
builds and starts the real backend/frontend, waits on `/health` and the frontend root before handing
control to Playwright, and tears everything down in `globalTeardown` regardless of outcome. Neither
path can ever reach a developer's local `payroll_dev`.

**Readiness checks**: the `e2e` job has no explicit wait step in the workflow itself —
`e2e-environment.ts`'s `waitForUrl()` polls the backend's `/health` endpoint and the frontend root
(30s timeout each, checking the spawned process hasn't already exited) before `startEnvironment()`
returns, and Playwright's `globalSetup` blocks the whole test run until that promise resolves. The
`backend` job's Postgres service container has its own `pg_isready`-based health check
(`options:` block) that GitHub Actions waits on before any step runs.

**Artifacts**: on `e2e` job failure only, the Playwright HTML report (`playwright-report/`) and
per-test traces/screenshots/videos (`test-results/`) are uploaded as workflow artifacts (7-day
retention) — both are already gitignored, generated fresh per run. Backend/frontend step output
(Jest/Vitest/tsc/eslint) streams directly to the job log; no separate artifact step was added for
those.

**Concurrency**: a `concurrency` group keyed on `github.ref` cancels a now-superseded run on the
same branch/PR when a newer push arrives, purely to avoid paying for a stale E2E run — GitHub
Actions never lets two jobs share the same runner VM, so there is no actual port/database collision
risk between separate workflow runs to begin with.

## Current verified counts

As of Post-Phase-5 Stabilization Checkpoint 4 (2026-07-18): backend **516/516** (unchanged — this
checkpoint touched no backend code), frontend **23/23** (unchanged), E2E **15/15** (new). These numbers *will* drift as new checkpoints/phases add tests — treat any specific
count anywhere in `docs/SESSION_HANDOFF.md` or `docs/IMPLEMENTATION_PLAN.md` as a historical record
of what was true *at that checkpoint*, not a live figure; `docs/PROJECT_PROGRESS.md` §1's most recent
dated entry and this file are the two places that should stay current going forward.
