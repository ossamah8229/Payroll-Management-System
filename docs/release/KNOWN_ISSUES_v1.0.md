# Version 1.0 — Known Issues Register

Only verified issues are recorded here — each was reproduced or confirmed by direct code reading
during RC1 preparation (2026-07-19/20), not assumed.

---

## KI-1 — Materialized obligation on a held entry never consumes (`CANCELLED` lifecycle not implemented)

- **Description**: `BalanceAdjustmentMaterialization.status` has three enum values —
  `ACTIVE`, `CONSUMED`, `CANCELLED` (`backend/prisma/schema.prisma`) — but no code path ever sets
  `CANCELLED`. A materialization only transitions `ACTIVE → CONSUMED` when its `PayrollEntry`
  actually **releases** (`consumeMaterializationsForReleasedEntries`, called from
  `releaseProjectUnit`). If that entry is instead placed on **hold** and the cycle is finalized with
  it held (a legal finalize state — an entry only needs to be released *or* held), the
  materialization stays `ACTIVE` forever and the underlying `BalanceAdjustment` stays `PENDING` with
  its `remainingAmount` unchanged, even though its money is already "baked into" an entry that will
  never actually be paid out.
- **Impact**: The obligation appears perpetually outstanding in the Corrections Ledger/Review Queue,
  even though it's effectively (but not formally) accounted for in a held entry. **Confirmed: this
  does not cause double-payment or double-counting** — `getActiveReservedAmount` sums `ACTIVE`
  materializations across all cycles when computing `availableToMaterialize`, so the stuck
  reservation correctly blocks the same obligation from being materialized a second time. The defect
  is a bookkeeping/visibility issue (money reserved-but-never-paid, indefinitely), not a financial
  correctness issue.
- **Trigger**: (1) Approve a correction that creates a `BalanceAdjustment`. (2) Materialize it into a
  Draft cycle's `PayrollEntry` for the affected employee. (3) Place that specific entry on hold
  (`PATCH .../payroll-entries/:id` with `hold: true` — no guard currently prevents this on a
  materialized entry). (4) Finalize the cycle without releasing that entry.
- **Workaround**: Master Admin/Finance should avoid placing a hold on an entry known to carry a
  materialized obligation; if it happens, the obligation can be identified by cross-referencing
  `BalanceAdjustmentMaterialization` rows with `ACTIVE` status against `PayrollEntry.hold = true`
  (currently a direct-database check — no UI surfaces this combination specifically) and resolved by
  releasing that entry in a later cycle (which still triggers normal consumption) or via a manual
  correction.
- **Release-blocking status**: **Not a release blocker.** Verified reachable via the currently
  supported UI/workflow, but requires a specific, non-default sequence (hold an entry that
  specifically carries a materialized obligation, rather than the far more common path of releasing
  it normally); does not corrupt data, lose money, or double-pay; and was already explicitly
  identified and deliberately deferred by the project's own prior scope decision — see
  `docs/architecture/workflows/corrections-and-balance-adjustments.md` and
  `docs/PROJECT_PROGRESS.md`, both of which record the `CANCELLED` transition as "explicitly out of
  scope, by the user's own stated boundary." Per the RC1 checkpoint's own instructions, `CANCELLED`
  is not implemented in this checkpoint absent an explicit decision to reopen financial lifecycle
  scope.
- **Intended future treatment**: A `CANCELLED` lifecycle transition (freeing the reservation when its
  carrying entry is held-and-never-released) is the natural fix, scoped for a future checkpoint —
  requires an explicit product decision on when/how it should trigger (immediately on hold? only
  after the cycle finalizes with the entry still held? does the Balance Adjustment need to re-open
  for a fresh correction cycle?).

---

## KI-2 — Cross-site cookie behavior unverified against a real Render deployment

- **Description**: `render.yaml` deploys the frontend and backend as two independent Render services,
  each on its own `*.onrender.com` subdomain. `onrender.com` is Public-Suffix-List-registered, making
  the two services cross-*site* (not just cross-origin) to a browser. Session/CSRF cookies are
  `SameSite=Lax`, which browsers do not attach to cross-site `fetch`/`XHR` requests. This is an
  analytical finding (derived from the cookie configuration and standard browser behavior), not an
  observed failure — a real cross-site Render deployment was not available to test in this sandbox.
- **Impact**: If this holds in practice, authenticated API calls from the deployed frontend to the
  deployed backend could fail across the board on a genuine two-service Render deployment.
- **Trigger**: Deploying frontend and backend as two separate Render services without a shared parent
  domain, then using the app from a real browser.
- **Workaround**: Deploy behind one shared origin (custom domain routing, or a reverse proxy in front
  of both services) for any environment used by real users, until verified otherwise.
- **Release-blocking status**: **Not a release blocker for RC1** — RC1's own UAT environment can be
  deployed same-site (as this checkpoint's own local validation was, via a reverse proxy). It **is** a
  gating item before the real `v1.0.0` production cutover on Render specifically.
- **Intended future treatment**: Verify directly against a real two-service Render deployment before
  production go-live (this closes the same access gap already on record for Phase 4's Render smoke
  test condition). If confirmed broken, fix via a shared custom domain, a fronting reverse proxy, or
  `SameSite=None; Secure` cookies for the cross-site case.
- **Status: RESOLVED (2026-07-21).** Confirmed broken exactly as analytically predicted (real
  symptom: login failed with "Missing or invalid CSRF token" — the CSRF cookie was never attached
  to the cross-site `POST /auth/login` request in the first place). Fixed via the flagged
  `SameSite=None; Secure` option for both the session and CSRF cookies in production
  (`backend/src/app.ts`, `backend/src/common/middleware/csrf.ts`); development keeps `SameSite=Lax`
  behind the Vite proxy. This also required a companion fix to how the frontend learns the CSRF
  token in the first place — it can never read the `csrf_token` cookie via `document.cookie` since
  it belongs to the backend's own origin, so the backend now also echoes the token in an
  `x-csrf-token` response header (CORS-exposed via `exposedHeaders`), which the frontend captures
  into module memory (`frontend/src/lib/api-client.ts`) instead. See
  `docs/architecture/authentication.md` for the full current design.

---

## KI-3 — No cloud object-storage `StorageProvider` implementation

- **Description**: Only `LocalFilesystemStorageProvider` exists. Backup packages, and any future file
  uploads, are written to the application server's own local disk (`STORAGE_ROOT`).
- **Impact**: On a platform where the application server's filesystem is ephemeral or not
  network-shared (typical for PaaS web services, including Render's own web-service tier unless a
  persistent disk is explicitly attached), generated files would not survive a redeploy/restart, and
  would not be shared across multiple instances if the service is ever scaled horizontally.
- **Trigger**: Any production deployment on infrastructure with an ephemeral or non-shared filesystem.
- **Workaround**: Attach a persistent disk to the Render web service, or avoid horizontal scaling,
  until a cloud provider is implemented.
- **Release-blocking status**: Not a release blocker for RC1/UAT (a single-instance environment with
  a persistent or long-lived disk is sufficient for UAT). Should be resolved before production
  go-live if the deployment target's filesystem isn't guaranteed persistent.
- **Intended future treatment**: Implement a cloud-object-storage `StorageProvider` (e.g. S3-compatible)
  behind the existing abstraction (`docs/architecture/system-conventions.md §2`) — the abstraction was
  specifically designed for this swap.

---

## KI-4 — Six pre-existing `react-refresh/only-export-components` lint warnings

- **Description**: `npm run lint` reports 0 errors, 6 warnings, all the same rule, across
  `greeting.tsx`, `inline-cells.tsx`, `badge.tsx`, `button.tsx`, and `table.tsx` (two in the last) —
  each file exports a non-component constant/helper alongside its component(s), which defeats Vite's
  Fast Refresh for that file in dev mode only.
- **Impact**: Cosmetic/DX only — slightly slower dev-mode hot-reload for the affected files; zero
  runtime or production behavior effect.
- **Trigger**: Editing any of those five files during local development.
- **Workaround**: None needed.
- **Release-blocking status**: Not a release blocker (explicitly the kind of "minor" item the RC1
  defect policy defers).
- **Intended future treatment**: Split the non-component exports into sibling files, opportunistically,
  not urgently.

---

## KI-5 — One timing-dependent flake in `backup-packages.test.ts`

- **Description**: `"the backup Cash Receiving CSV rows are byte-identical to the live Cash Receiving
  export (generated-at excluded)"` compares two independently-generated CSVs whose only expected
  difference is a `Generated On: <date>, <time>` timestamp. The test's own redaction regex only
  strips up to the first CSV comma, leaving the seconds portion of the timestamp exposed on one side
  of that comma — if the two generations straddle a wall-clock second boundary, the assertion fails
  on a one-second timestamp mismatch that has nothing to do with the actual CSV content being tested.
- **Impact**: None on the application; a test-assertion imprecision only.
- **Trigger**: The two CSV-generation calls inside the test happening in different wall-clock seconds
  — rare, non-deterministic.
- **Evidence this is a flake, not a regression**: Observed once in a 791-test full run this
  checkpoint; immediately retried in isolation (same code, same database) and passed cleanly.
- **Release-blocking status**: Not a release blocker — non-deterministic, passes on retry, confirmed
  to be a test-assertion gap rather than an application defect (per the RC1 defect policy, only a
  *deterministic* failure blocks RC1).
- **Intended future treatment**: Widen the redaction regex to strip the full `Generated On: ...` value
  including its comma-separated time component, opportunistically.

---

## KI-6 — Puppeteer/embedded-Postgres postinstall scripts require a manual step in script-restricted environments

- **Description**: `puppeteer`'s Chrome download and `@embedded-postgres/*`'s symlink hydration both
  normally run automatically via `npm`'s `postinstall` hook. Some sandboxed/CI environments disable
  arbitrary install scripts by default (this RC1 validation's own sandbox included), silently
  skipping both. Neither `README.md` nor `backend/README.md` previously documented the manual
  fallback (`npx puppeteer browsers install chrome`) — **fixed this checkpoint**, see
  `backend/README.md`'s updated "First-time setup".
- **Impact**: A developer or CI runner on a script-restricted environment following the previously
  undocumented default flow would hit a missing-Chrome error only when first generating a payslip PDF
  or running the E2E suite, with no explanation in the docs.
- **Trigger**: `npm install`/`npm ci` on an environment with install scripts disabled or restricted.
- **Workaround**: Run `npx puppeteer browsers install chrome` manually (now documented).
- **Release-blocking status**: Not a release blocker — a normal developer machine or standard CI
  runner (GitHub Actions included) runs postinstall scripts by default; this only affects
  script-restricted sandboxes, and is now documented for the ones that hit it.
- **Intended future treatment**: None needed beyond the documentation fix already made.

---

## KI-7 — Concurrent first-contact CSRF race (intermittent login "Missing or invalid CSRF token")

- **Description**: `issueCsrfCookie` (`backend/src/common/middleware/csrf.ts`) minted a fresh
  random CSRF token any time a request arrived with no `csrf_token` cookie yet. Two requests that
  both arrived before either had round-tripped its `Set-Cookie` back to the browser — two tabs
  opened together, or several parallel first-load requests from one tab — each independently minted
  a *different* token; each tab's own in-memory copy (`frontend/src/lib/api-client.ts`) could then
  diverge from whichever `Set-Cookie` the browser's one shared cookie jar ultimately kept.
- **Impact**: A tab whose in-memory token lost that race sent a header that no longer matched the
  cookie on its next state-changing request (most visibly, login itself) and was rejected with a 403
  "Missing or invalid CSRF token" — intermittent, since it depended on request/response timing, not
  on anything a user did wrong. Distinct from KI-2 (the cross-site `SameSite` cookie-attribute
  defect, already resolved above): this is a race in *which token value* the client and server agree
  on, not whether the cookie is attached to the request at all.
- **Trigger**: Opening two browser tabs at nearly the same moment (or a rapid page refresh, or
  several parallel first-load API calls from one tab) before any request from that browser has
  completed a full round trip.
- **Workaround (while open)**: None reliable from the frontend — a single tab/session working alone
  was unaffected; retrying the failed action after the race resolved (the browser's cookie jar
  settles after the first completed round trip) typically succeeded.
- **Release-blocking status**: Root-caused (not fixed) as Post-Phase-5 Stabilization Checkpoint 4C,
  deliberately deferred to its own separate implementation checkpoint.
- **First fix attempt (2026-07-23, Post-Phase-5 Stabilization Checkpoint 4D) — REJECTED on review.**
  Made concurrent "no cookie yet" requests converge on one token via a short-lived, in-memory,
  per-process coalescing map keyed by `req.ip`. Rejected because `req.ip` is not a browser identity
  (unrelated clients can share an IP behind a NAT/proxy) and a process-local map cannot guarantee
  correctness once the backend runs as more than one instance — a mitigation whose correctness
  depends on single-process, single-request-path accidents is not a fix for a security-relevant race
  condition, even though it passed every test in this project's own single-instance sandbox.
- **Status: RESOLVED (2026-07-23, Post-Phase-5 Stabilization Checkpoint 4D correction), corrected
  design.** The backend no longer tries to prevent the race at all — `issueCsrfCookie` is the
  simplest stateless rule (mint if absent, echo on safe methods), unchanged from before Checkpoint
  4C. Instead, `csrfProtection` rejects a genuine mismatch with a specific, distinguishable code
  (`CSRF_TOKEN_MISMATCH`, never the generic code an ordinary permission denial also uses), and the
  frontend (`frontend/src/lib/api-client.ts`) performs exactly one controlled recovery on that
  specific code: refetch the token bound to the browser's actual current cookie
  (`GET /api/v1/csrf-token`, a dependency-free safe endpoint) and retry the original mutation once.
  A second mismatch is never retried again. The double-submit-cookie model, its cookie attributes,
  and its timing-safe comparison are all unweakened — this only adds a client-side "learn the real
  token and try once more" step, with no shared state, no process-topology assumption, and no client
  identity signal of any kind. CSRF token rotation (login/logout/self-service password change/admin
  self-password-reset) is unchanged from the original design — it was not part of what got rejected.
  See `docs/architecture/authentication.md`'s "Checkpoint 4C/4D" section for the full design, and
  `backend/tests/csrf-concurrency.test.ts` / `frontend/src/lib/api-client.test.ts` /
  `tests/e2e/specs/09-csrf-concurrency.spec.ts` for regression coverage.

---

## KI-8 — Custom role with `sites:manage` could not see the Project Sites list

- **Description**: `listProjectSites` (`backend/src/modules/project-sites/project-sites.service.ts`)
  granted unrestricted site visibility only to the literal seeded Master Admin `roleCode`, scoping
  every other role — including a *custom* role explicitly granted `sites:manage` — to its
  `UserSiteAssignment` rows. A brand-new custom role has none by default (nothing to assign it to
  before any site exists), so a "Payroll Manager" custom role with `sites:manage` could create a
  Project Site (`createProjectSite` was, correctly, never site-scoped) but then see an empty list.
- **Impact**: A Master User granting a custom role `sites:manage` (intending it as site-administration
  authority, the permission's evident purpose) got a role that could mutate sites but never see any
  — including ones it had itself just created — making the permission effectively unusable for its
  own stated purpose.
- **Trigger**: Create a custom role, grant it only `sites:manage`, assign a user, log in as that
  user, visit Project Sites.
- **Workaround (while open)**: A Master User could also grant the affected user explicit
  `UserSiteAssignment` rows via the Users page, but this only worked for sites that already existed
  at assignment time — a newly created site would still not appear.
- **Status: RESOLVED (2026-07-23, Post-Phase-5 Stabilization Checkpoint 4D correction, UAT Defect
  1).** `sites:manage` is one of this system's `CRITICAL_ADMIN_PERMISSIONS` — the same class as the
  already-unscoped `users:manage`/`settings:manage`. `listProjectSites` now grants the same
  unrestricted visibility to any role, system or custom, currently holding `sites:manage`, alongside
  (not replacing) the existing Master Admin `roleCode` fast path. Operational site-scoping for every
  other module (employees, payroll) is unchanged. See `docs/architecture/authentication.md`'s "UAT
  Defect 1" note and `docs/architecture/database/access-control.md`'s `UserSiteAssignment` note for
  the full design, and `backend/tests/project-sites.test.ts` /
  `tests/e2e/specs/10-site-visibility.spec.ts` for regression coverage.

---

## KI-9 — Roles & Permissions dialog had excessive empty scrolling and a frame/content desync

- **Description**: The permission matrix (`frontend/src/components/roles/permission-matrix.tsx`)
  nested its own independently `max-h-[420px]`/`overflow-y-auto` scroll region *inside*
  `ModalContent`'s own `max-h-[85vh]`/`overflow-y-auto` region
  (`frontend/src/components/ui/modal.tsx`) — two competing scroll contexts in one dialog, with
  neither the header nor footer pinned in place.
- **Impact**: Scrolling the Create/Edit Role dialog continued through a large empty area past the
  real content, and the dialog's own frame could appear to separate from its content while
  scrolling — the same class of modal-alignment issue this project has hit before in a different
  form (a static-prototype-only `justify-content` bug, AUD-007, unrelated code path — see
  `docs/PROJECT_PROGRESS.md`).
- **Trigger**: Open Create Role or Edit Role with enough permissions selected/assigned to overflow
  the matrix's own capped height, then scroll to the bottom.
- **Status: RESOLVED (2026-07-23, Post-Phase-5 Stabilization Checkpoint 4D correction, UAT Defect
  2).** Fixed at the shared `ModalContent`/`ModalFooter` level, not a one-off patch to the Roles
  page: `ModalContent` is now a proper flex column with exactly one scroll region (a `min-h-0
  flex-1 overflow-y-auto` body, required alongside `flex-1` or the parent's own height cap silently
  stops working — the classic flexbox-scrolling pitfall), a non-scrolling header, and a `sticky
  bottom-0` footer; the permission matrix's own inner scroll region was removed entirely. Every
  other dialog in the app (all sharing the same component) had its now-redundant
  `overflow-y-auto`/default `max-h-[85vh]` removed from its own `widthClassName` prop. See
  `tests/e2e/specs/11-permission-dialog-layout.spec.ts` for regression coverage — measured
  (scrollHeight/clientHeight, nested-scroll-region detection, dialog bounding-box stability while
  scrolling, footer visibility, overlay coverage) at 1366×768, 1440×900, and 1920×1080, plus a
  regression check that two other, unrelated dialogs (New User, New Project Site) are unaffected by
  the shared-component change.

---

## KI-10 — `payslips.test.ts` intermittently fails under full-backend-suite load

- **Description**: `payslips.test.ts` is the only backend suite that launches a real Puppeteer/
  Chrome-for-Testing browser (`backend/src/lib/pdf/browser.ts`) — every failure observed was a hard
  Jest timeout (`Exceeded timeout of Nms`) on an otherwise-correct operation (a `cleanTestData()`
  hook or an individual PDF render), never an incorrect PDF or response, and never a leaked process
  or handle (confirmed directly across 50+ reproduction runs: zero orphaned Chrome processes, full
  memory recovery after every run). Root cause: this host's own measured, genuine resource
  contention from processes outside this suite's control — `vm_stat` sampling during reproduction
  showed free memory dropping as low as ~15-20MB and the shared browser's own RSS reaching
  ~600-700MB during the file's heaviest test (a 300-employee batch render).
- **Impact**: Spurious CI/local test failures under system load, with no correctness impact — the
  underlying PDF rendering pipeline itself was never shown to produce incorrect output in any
  reproduction.
- **Trigger**: Running the full backend suite (or this file in isolation) on a host under genuine,
  severe concurrent resource pressure from other processes.
- **Fix (2026-07-23, Pre-Deployment Reliability Checkpoint)**: (1) `renderHtmlToPdf` now retries
  once against a freshly relaunched browser if a render fails, closing a real gap in
  `getBrowser()`'s health check (`browser.connected` only detects a fully crashed browser, not one
  alive but unable to service a new page). (2) The 300-employee batch test — the single heaviest
  consumer of the shared browser's resources in this file — now recycles the browser immediately
  after it succeeds, so its own footprint can't compound into later tests. (3) This file's own Jest
  timeout is raised from the global 15000ms default to 45000ms, scoped to this file alone (the
  other 44 suites are unaffected) — justified by the measured contention above, not a blind
  increase. See `docs/architecture/testing.md`'s "Payslip PDF test reliability" section for the
  full investigation.
- **Status: SUBSTANTIALLY IMPROVED, not claimed fully eliminated — evidence-based, not
  overclaimed.** Comparing 20 isolated + 10 full-suite runs before the fix against the same battery
  after: PDF/timeout-specific failures in isolated runs went from 2/20 to 0/20; in full-suite runs,
  from 2/10 to 1/10 — and that one remaining case coincided with a directly measured, severe host
  slowdown (this file alone took 368s against its normal ~70s, a >5x slowdown) that no finite,
  principled timeout can fully absorb. The residual risk is tied to genuinely severe ambient
  contention on a shared host outside this codebase's control, not an unfixed code defect — this is
  reported honestly rather than marked fully resolved, per this checkpoint's own explicit
  instruction not to claim resolution without repeated evidence.
- **A separate, unrelated flake found during this same investigation, not fully resolved**:
  `'issues a constant number of queries regardless of batch size (no N+1)'` — a pure Prisma
  query-count assertion with no Puppeteer involvement — occasionally observed an off-by-one query
  count under contention (a connection-pool-level effect; the actual eligible-Payslip results were
  always correct, so this is not a real N+1 regression). The test's warm-up was broadened to prime
  all three batch shapes instead of one, reducing but not eliminating the ~5-10% recurrence rate
  seen in reproduction. Not weakened (the exact-equality assertion is unchanged); left open as a
  separate, lower-priority follow-up.

---

## Summary

| ID | Issue | Blocking? |
|---|---|---|
| KI-1 | `CANCELLED` materialization lifecycle not implemented — held+materialized entries stay reserved | No |
| KI-2 | Cross-site cookie behavior unverified on real Render two-service deployment | No (gates production, not RC1) |
| KI-3 | No cloud `StorageProvider` implementation | No (gates production if filesystem is ephemeral) |
| KI-4 | 6 pre-existing cosmetic lint warnings | No |
| KI-5 | One timing-dependent test flake (confirmed non-deterministic) | No |
| KI-6 | Puppeteer/embedded-Postgres manual install step in script-restricted environments | No (now documented) |
| KI-7 | Concurrent first-contact CSRF race — intermittent login failure | No — **RESOLVED** 2026-07-23 (corrected design) |
| KI-8 | Custom role with `sites:manage` could not see the Project Sites list | No — **RESOLVED** 2026-07-23 |
| KI-9 | Roles & Permissions dialog excessive scrolling / frame desync | No — **RESOLVED** 2026-07-23 |
| KI-10 | `payslips.test.ts` intermittent full-suite-load failures | No — **substantially improved** 2026-07-23, not claimed fully eliminated (see entry) |

**No release-blocking issues were found unresolved as of this register's writing.** Two genuine
release blockers were found *and fixed* during this checkpoint (missing production `session` table
migration; see `RC1_VALIDATION_REPORT.md` Steps 2/6) — they are not listed here because they were
resolved, not left open.
