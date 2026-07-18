# End-to-End Test Harness (AUD-013)

A permanent, committed Playwright harness — the replacement for the ad hoc Puppeteer verification
scripts previous checkpoints wrote, ran once, and discarded. See
`docs/architecture/testing.md` for how this fits alongside the backend integration suite
(`backend/tests/`) and the frontend unit suite (`frontend/src/**/*.test.tsx`).

## Running it

```bash
npm run test:e2e            # headless, non-interactive — the default, CI-suitable command
npm run test:e2e:headed     # same suite, a visible browser window
npm run test:e2e:ui         # Playwright's interactive UI mode, for writing/debugging specs
npm run test:e2e:report     # opens the last run's HTML report
```

**Prerequisites (once per machine):**

1. `npm install` at the repo root (installs `@playwright/test` and `embedded-postgres`).
2. `npx playwright install chromium` — Playwright's own browser binaries are not npm-installed and
   must be fetched separately. Not required again unless Playwright itself is upgraded.

No other setup is required. `npm run test:e2e` provisions its own database, builds and starts the
real backend and frontend, runs the suite, and tears everything down again — see below.

## What each run does

`playwright.config.ts` (repo root) points `globalSetup`/`globalTeardown` at
`tests/e2e/global-setup.ts` / `global-teardown.ts`, thin wrappers around
`tests/e2e/setup/e2e-environment.ts`'s `startEnvironment()`/`stopEnvironment()`:

1. **Provisions a disposable PostgreSQL cluster** via the `embedded-postgres` npm package (the
   same no-Docker-required approach this project's own backend test suite has relied on since
   Post-Phase-5 Stabilization Checkpoint 1) — its own data directory, its own port (`55432`), its
   own database (`payroll_e2e`) and credentials, entirely separate from a developer's normal local
   `payroll_dev` database (port `5432`, whether provisioned via the root `docker-compose.yml` or
   the same embedded-postgres approach by hand). **This harness can never touch a developer's real
   database** — different port, different database name, different credentials, every time.
2. Builds `shared`, migrates and seeds the fresh database (the same `prisma migrate deploy` +
   `prisma/seed.ts` any environment uses), then builds `backend` and `frontend`.
3. Starts the real compiled backend (`node dist/server.js`, `NODE_ENV=test` — real behavior, not
   `production`'s `secure` cookie flag, which would break session cookies over the plain HTTP this
   harness runs on; `test` also relaxes the login rate limiter exactly as the backend's own
   integration suite already relies on, since this suite logs in repeatedly) on port `4100`, and
   the real **production frontend build** (`vite build`, then served statically via
   `vite preview`, not `vite dev`) on port `4200` — the same cross-origin topology real deployment
   uses (`docs/architecture/deployment.md`), and the only way to genuinely exercise AUD-012's
   route-level code-split chunks rather than Vite's unbundled dev module graph.
4. Waits for both `/health` (backend) and the frontend root to respond before handing control to
   the test runner.
5. After every spec finishes (pass or fail), `global-teardown.ts` kills both process groups and
   stops/removes the embedded Postgres cluster and its data directory. Nothing this harness creates
   survives a run — `tests/e2e/.tmp/` (database, build logs, storage root, process state) is
   removed unconditionally at the end, and defensively at the *start* of the next run too, in case
   a previous run was killed uncleanly.

All of the above is real infrastructure — no mocked backend, no stubbed database, no fake browser.

## Specs

Numbered so `workers: 1` (see `playwright.config.ts`) runs them in a deliberate order — several
specs depend on state an earlier one creates (see each file's own header comment for exactly what):

| File | Covers |
|---|---|
| `01-startup-and-auth.spec.ts` | Backend health, frontend load, login, authenticated shell render, logout |
| `02-payroll-lifecycle.spec.ts` | The one full Draft → Released → Archived(+rollover) path, through the real UI. Owns the one-time cycle bootstrap (`POST /payroll-cycles` only ever succeeds once) |
| `03-navigation.spec.ts` | AUD-012 regression: every route loads cleanly (direct nav + client-side nav to a lazy route + nested-route refresh), no console/page errors, no failed chunk requests |
| `04-session-revocation.spec.ts` | AUD-009 regression: two independent browser sessions, password change invalidates both immediately |
| `05-backup-generation.spec.ts` | Backup Package generation reaches `READY` through the real stack; no `storageKey` leak. API-only — no frontend UI exists for this yet (Phase 5 Checkpoint 2's own approved scope) |
| `06-ui-regression.spec.ts` | Durable stabilization-era UI invariants: Payslips filter alignment (AUD-004), no document-level scroll, standard vs. compact table density, no sidebar emoji, modal centering/Escape |

### A deliberate scope boundary: AUD-011 crash recovery is *not* re-tested here

AUD-011 (stale `GENERATING` Backup Package recovery) requires killing and restarting the real
backend process mid-test to prove recovery runs on the next startup. Doing that from *inside* this
harness's own single long-lived backend process would make the harness's own lifecycle unstable —
the harness itself depends on that one backend process staying up for the rest of the suite. That
path already has dedicated, real-stack coverage in `backend/tests/backup-packages.test.ts`'s
`AUD-011: stale GENERATING recovery` block (Post-Phase-5 Stabilization Checkpoint 3), which starts
and kills the real compiled server the same way this harness does, just without a browser attached.
This is a documented, deliberate boundary, not a coverage gap.

## Fixtures and helpers

- **`fixtures/auth.ts`** — `login()`/`loginAsMasterAdmin()` drive the real login form (never a
  cookie-injection shortcut, so the suite genuinely exercises the CSRF double-submit flow);
  `authenticatedPage` is a Playwright fixture pre-logged-in as the seeded Master Admin, the common
  case almost every spec needs. A spec needing a *second*, independent session uses
  `browser.newContext()` directly instead.
- **`helpers/api.ts`** — `apiGet`/`apiPost`/`isAuthenticated`, a thin CSRF-aware wrapper around
  Playwright's `context.request`, targeting the backend directly (`BACKEND_URL`, not a path
  relative to the frontend's own `baseURL` — `vite preview` has no `/api` proxy, unlike `vite
  dev`'s dev-only one). Used for fast fixture setup and for checks that don't need a full page
  navigation.
- **`helpers/fixtures.ts`** — `createSiteWithEmployee()` (a uniquely-named Site + Unit + Employee,
  via the real API) and `ensureAnyPayrollCycleExists()` (reuse-or-bootstrap, since
  `POST /payroll-cycles` only ever succeeds for the very first cycle the whole application creates).
- **`setup/config.ts`** — every port, credential, and path this harness uses, gathered in one
  place. Every value is deliberately distinct from this project's own normal local-dev setup.

## Isolation and cleanup

- **Database**: fresh per run, never reused, never a developer's own.
- **Ports**: `55432` (Postgres), `4100` (backend), `4200` (frontend) — all distinct from the normal
  dev setup (`5432`/`4000`/`5173`), so this harness can run *alongside* a developer's own `npm run
  dev` session without port conflicts.
- **Fixture data within a run**: each spec that creates its own Site/Employee/User names it with a
  `Date.now()`-suffixed label, so re-runs and adjacent specs never collide on a unique constraint.
- **Process cleanup**: every spawned process is `detached: true` (its own process group) and killed
  by process group (`-pid`) in teardown, so a wrapper's own child processes (e.g. `npx`'s spawned
  `vite` binary) are taken down too — never left orphaned.
- **Screenshots/traces/video**: retained only on failure (`playwright.config.ts`'s `use` block),
  written to `test-results/` (gitignored). Un-committed by design — inspect locally with
  `npm run test:e2e:report`, or open a `trace.zip` with `npx playwright show-trace`.

## CI notes

- Single worker (`workers: 1`) — the payroll-lifecycle spec mutates real, shared cycle state
  end-to-end; proving worker-level isolation for that kind of stateful flow was out of this
  checkpoint's scope.
- `retries: 1` under `CI=true` only (matches `playwright.config.ts`), `0` locally — a failure
  during local development should surface immediately, not be silently retried away.
- Exit code is non-zero on any failed test — no extra wiring needed for a CI step to detect it.
- Chromium only — this project's own real-browser verification has always used a Chromium-family
  browser; adding Firefox/WebKit is not "trivial and stable" (this checkpoint's own bar) without
  reason to believe this codebase has engine-specific behavior.
