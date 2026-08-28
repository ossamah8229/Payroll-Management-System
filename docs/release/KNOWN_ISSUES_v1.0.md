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

- **Status: Resolved (Phase 7C).** `R2StorageProvider` (`backend/src/lib/storage/r2-storage-provider.ts`)
  is now a second, S3-compatible implementation of the same `StorageProvider` interface, selected via
  `STORAGE_PROVIDER=r2` (`docs/release/CONFIGURATION_REFERENCE.md`) — exactly the "intended future
  treatment" this entry originally called for. `LocalFilesystemStorageProvider` remains the `local`
  default for dev/test; setting `STORAGE_PROVIDER=r2` in production moves **every** consumer (Backup
  Packages, Company Logo assets, and anything else built against `storageProvider` later) onto
  durable, non-ephemeral storage at once — no per-module change needed, since none of them branch on
  which implementation is active.
- **Original description** (kept for history): Only `LocalFilesystemStorageProvider` existed. Backup
  packages, and any future file uploads, were written to the application server's own local disk
  (`STORAGE_ROOT`).
- **Original impact**: On a platform where the application server's filesystem is ephemeral or not
  network-shared (typical for PaaS web services, including Render's own web-service tier unless a
  persistent disk is explicitly attached), generated files would not survive a redeploy/restart, and
  would not be shared across multiple instances if the service is ever scaled horizontally.
- **Remaining action for a real go-live**: `STORAGE_PROVIDER` still defaults to `local` — an operator
  must explicitly set `STORAGE_PROVIDER=r2` and provision the five `R2_*` credentials in the Render
  dashboard (`render.yaml` declares them as `sync: false`) for production to actually benefit from
  this fix. Until that's done, this known issue's original impact still applies as-configured.

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
- **A second symptom of the same root cause, observed 2026-07-24 (Corrections Workflow Redesign /
  RBAC Consistency Completion checkpoint)**: two consecutive clean, uncontended full-suite runs both
  showed 11-12 batch-endpoint failures (`Expected: 200, Received: 400`), all from
  `POST /payroll-cycles/:cycleId/payslips/batch`'s own canary-render guard
  (`payslips.routes.ts:250-259` — the *first* employee's PDF render is attempted before any
  response is streamed; if it throws, the whole batch 400s rather than partially succeeding, by
  design) — not a timeout this time, but the same underlying cause: Puppeteer's PDF render failing
  under real host resource contention (25 concurrent Chrome-family processes were observed on the
  host at the time, `vm_stat` showing ~1.4GB free). Confirmed non-code-related: `payslips.test.ts`
  run in complete isolation passed 47/47 both times, immediately after each contended full-suite
  run, with no code change in between. Not caused by, or related to, any change this checkpoint
  made (Employee Lookup, print support, import templates, and the RBAC module migration touch
  entirely different code paths) — recorded here since it's the same documented root cause, a new
  observed symptom of it.
- **Update, 2026-08-04 (Phase 7H) — a second, distinct root cause identified for the PDF-suite
  failures above; the query-count flake is unchanged and now tracked separately.** PR #6's CI
  intermittently failed with `"Test environment has been torn down"` — traced (not inferred; full
  reproduction record in `docs/PROJECT_PROGRESS.md`'s "Phase 7H" entry) to a Jest/
  `--experimental-vm-modules` VM-lifecycle race: Jest disposes each test file's own VM realm
  independently, and `browser.ts`'s dynamic `import('puppeteer')` can resolve *after* the realm
  that started it is already gone, which Jest's own module registry rejects with that exact error
  (`jest-util`'s `invariant()`, not application code). This is a **different** mechanism from the
  resource-contention timeouts described above — it reproduced 90%+ of the time under concurrent
  Jest-file load in direct testing, regardless of host memory headroom. **Fixed** by moving real
  Puppeteer rendering to a persistent worker process (`backend/src/lib/pdf/worker/`) that is never
  itself inside a Jest VM realm — structurally immune, not merely less likely to fail; see
  `docs/architecture/testing.md`'s "Backend PDF test architecture" section for the full design.
  Verified via 5× isolated + 5× combined + 3× full-backend-suite runs (3,843 total test
  executions): zero recurrences, zero lingering processes. **This resolves the PDF-suite portion of
  KI-10.** The off-by-one query-count flake (the bullet above this one) is unrelated to Puppeteer
  entirely and was not touched — still open, still tracked here, unchanged status.
- **Confirmed on the real merge, 2026-08-05.** The commits above were opened as PR #6 and manually
  merged (squash) into `main` (`e066f49f4c7496ac1e189bed61ab63ef2daac704`). That merge's own
  post-merge GitHub Actions run showed **zero** `"Test environment has been torn down"`
  occurrences — the one failure in that run was the unrelated, already-documented KI-5 flake
  (one-second timestamp boundary in `backup-packages.test.ts`), not this issue. The PDF-suite
  portion of KI-10 is now confirmed resolved on a real, independent, post-merge CI run against
  `main`, not only on pre-merge feature-branch testing. The query-count flake remains open and
  untouched, unchanged status.

---

## KI-11 — `sites:manage`'s global authority was applied to Sites visibility only, not Unit read/create (KI-8 follow-up)

- **Description**: KI-8's fix taught `listProjectSites` that `sites:manage` grants unrestricted
  visibility, but the Project Units routes (`GET`/`POST /sites/:siteId/units`) still used a
  separate, un-updated implementation (`requireSiteAccess` middleware) that bypassed only for the
  literal Master Admin role code.
- **Impact**: A custom role holding `sites:manage` (production UAT's "Payroll Manager" persona)
  could list every Project Site but was rejected with "You do not have access to this project site"
  opening or managing that site's own Branches/Units — reachable by any real administrator-created
  custom role, not a contrived scenario.
- **Status: RESOLVED (System-Wide RBAC Consistency remediation).** The two independent
  implementations were unified into one, `common/authz-policy.ts`'s `assertSiteAccess`, which both
  `requireSiteAccess` (middleware) and every site-scoped service function now call. The Project
  Units routes now pass `{ globalPermission: PERMISSIONS.SITES_MANAGE }`. See
  `docs/architecture/authentication.md`'s "System-Wide RBAC Consistency Audit and Remediation"
  section, `backend/tests/project-units.test.ts`, and
  `tests/e2e/specs/10-site-visibility.spec.ts`'s Branch-creation regression.

---

## KI-12 — Employee Registry showed an empty list indistinguishable from "no assigned sites," and offered sites the user's own scope would reject

- **Description**: A custom role holding both `sites:manage` (global, for Site/Unit administration)
  and `employees:view`/`:create` (site-scoped, for day-to-day Employee work) — a legitimate,
  expected combination — could reach the Employee Registry and open New Employee, but the existing
  employee list came back empty with no indication why, and the site pickers (registry filter,
  New/Edit Employee form) offered every site `sites:manage` unlocked, not just the sites this same
  user's Employee scope would actually return data for.
- **Impact**: Indistinguishable from a genuine empty registry or a broken feature; the New Employee
  form could be filled out for a site the create call would then reject.
- **Status: RESOLVED (System-Wide RBAC Consistency remediation).** This is **not** a case where
  `sites:manage` should have widened Employee access — Employees stays a site-scoped operational
  domain with no global-administration permission of its own, by deliberate design (see the matrix
  in `docs/architecture/authentication.md`). The actual fixes: (1) a distinct "You have no assigned
  project sites" empty state, shown whenever a non-Master-Admin user has zero `UserSiteAssignment`
  rows, never conflated with the ordinary "No employees found" filter-empty state; (2) a new
  `useAccessibleProjectSites(user)` hook that scopes every Employee Registry site selector down to
  the user's own real accessible sites, never the broader `sites:manage`-unlocked list. See
  `backend/tests/employees.test.ts` and `tests/e2e/specs/10-site-visibility.spec.ts`'s "Employee
  Registry visibility (UAT Defect 3)" block.
- **Known, deliberately scoped-out remainder**: the identical latent site-picker inconsistency
  exists in `corrections-page.tsx`, `salary-release-page.tsx`, `payslips-page.tsx`,
  `payroll-entry-page.tsx`, `bank-sheet-page.tsx`, `advances-page.tsx`, and
  `cash-receiving-page.tsx`, all of which call the raw `useProjectSites()` directly for their own
  filters. Not part of the reported UAT defects; not fixed in this pass; the same
  `useAccessibleProjectSites` hook is the correct fix when this is picked up.

---

## KI-13 — Tasks: a `tasks:manage` holder could assign a task to someone but never see it again (found proactively)

- **Description**: `createTask`/`updateTask` (gated by `tasks:manage` alone) already let any holder
  assign a task to anyone. But `listTasks`/`getTask` (`requireTaskAccess`) bypassed
  ownership-scoping only for the literal Master Admin role code — not found in production UAT, but
  discovered during this remediation's system-wide audit as the same "can mutate but cannot list"
  pattern the audit was explicitly asked to hunt for beyond the reported modules.
- **Status: RESOLVED.** `tasks:manage` is now classified as this domain's own global-administrative
  permission; `requireTaskAccess`/`listTasks` use `hasGlobalAuthority(user, PERMISSIONS.TASKS_MANAGE)`
  in place of the literal role-code check, mirrored on the frontend (`tasks-panel.tsx`'s
  `isMasterUser` is now `canManageAllTasks(user)`). A connected bug found while fixing this — the
  Create/Edit Task assignee picker called the `users:manage`-gated `GET /api/v1/users`, 403ing for a
  `tasks:manage` holder without `users:manage` — was fixed with a new, minimally-scoped
  `GET /api/v1/users-lookup/assignable` endpoint, gated by `tasks:manage` instead. See
  `backend/tests/tasks.test.ts`.

---

## KI-14 — Roles & Permissions dialog footer still overlapped content at the bottom of a scrolled dialog (KI-9 follow-up)

- **Description**: KI-9's fix consolidated Modal scrolling to one region and made `ModalFooter`
  `position: sticky` — reachable without a further scroll, but still rendered *inside* that same
  scrollable body with nothing reserving the footer's own height in the body's normal flow. Once a
  dialog's content ran only slightly taller than its `max-h-[85vh]` cap (the Roles & Permissions
  matrix with several groups selected being the most common real case), the sticky footer visually
  sat on top of the last item(s) instead of after them.
- **Impact**: The final permission/checkbox in a long list could render fully or partially hidden
  underneath the Save/Cancel footer — exactly the residual defect production UAT reported, proving
  KI-9's own fix was necessary but not sufficient.
- **Status: RESOLVED (System-Wide RBAC Consistency remediation).** `ModalContent` now pulls any
  `ModalFooter` element out of its scrollable body and renders it as a true, non-overlaying flex
  sibling after the body — occupying real flex space the body can never scroll underneath, per the
  preferred `Header / Body (flex-1, min-h-0, overflow-y-auto) / Footer (shrink-0)` structure. No
  call site needed to change how it composes children. See
  `tests/e2e/specs/11-permission-dialog-layout.spec.ts` (unchanged assertions, now passing against
  the corrected markup) and `frontend/src/components/ui/modal.tsx`'s own doc comment for the full
  root-cause explanation.

---

## KI-15 — `corrections-service.test.ts`'s concurrent-approval race frequently fails under real GitHub
Actions CI (v1.0.4 checkpoint, found on PR #18's post-merge CI)

- **Description**: `Phase 6 Checkpoint 3... › Concurrent approval › two different requests on the
  same PayrollEntry serialize — the second recalculates after the first commits` fires two real
  concurrent approval requests via `Promise.all` and asserts both resolve `200`. Observed across
  four independent GitHub Actions CI runs on PR #18/its post-merge `main` run (three separate merge/
  rerun attempts, zero code changes to `corrections-service.ts`/`corrections.repository.ts` between
  them, one run entirely pre-dating the PR's own commits): **3 of 4 failed** on the identical
  assertion (`resA.status` expected `200`, received `400`, always the same line), 1 of 4 passed
  clean. Not reproduced locally in this session (every local run of this file passed). This is a
  *different* test from KI-10's still-open query-count flake — no file/domain overlap with the
  Advances v1.0.4 checkpoint that surfaced it (zero lines of `corrections-service.ts`/
  `corrections.repository.ts` touched by that PR).
- **Impact**: Spurious CI `Backend` job failures under real GitHub Actions runner conditions,
  unrelated to whatever change triggered the run. No evidence of an actual application defect —
  every reproduction was the same lock-contention assertion, never a data-integrity failure, and
  the underlying `PayrollEntry`-version-guarded serialization this test exercises has extensive
  other passing coverage (`corrections-service.test.ts`'s own remaining suite, `advances.test.ts`'s
  identical `updateMany({ where: { id, version } })` pattern, etc.).
- **Status: OPEN, not investigated.** Frequency (3/4 in this session) is high enough that this is
  not a rare edge case — worth a dedicated investigation pass (real concurrent-timing reproduction,
  as KI-10's Puppeteer portion received) before being called resolved. Until investigated, do not
  treat a single green run of this specific test as proof a nearby change fixed something, and do
  not treat a single red run as proof a nearby change broke something — this test's own base rate
  needs establishing first.

---

## Summary

| ID | Issue | Blocking? |
|---|---|---|
| KI-1 | `CANCELLED` materialization lifecycle not implemented — held+materialized entries stay reserved | No |
| KI-2 | Cross-site cookie behavior unverified on real Render two-service deployment | No (gates production, not RC1) |
| KI-3 | No cloud `StorageProvider` implementation | No — **RESOLVED** (Phase 7C, `R2StorageProvider`); still requires `STORAGE_PROVIDER=r2` + credentials to be configured in production |
| KI-4 | 6 pre-existing cosmetic lint warnings | No |
| KI-5 | One timing-dependent test flake (confirmed non-deterministic) | No |
| KI-6 | Puppeteer/embedded-Postgres manual install step in script-restricted environments | No (now documented) |
| KI-7 | Concurrent first-contact CSRF race — intermittent login failure | No — **RESOLVED** 2026-07-23 (corrected design) |
| KI-8 | Custom role with `sites:manage` could not see the Project Sites list | No — **RESOLVED** 2026-07-23 |
| KI-9 | Roles & Permissions dialog excessive scrolling / frame desync | No — **RESOLVED** 2026-07-23 |
| KI-10 | `payslips.test.ts` intermittent full-suite-load failures | Partially — PDF/Jest-VM-teardown portion **RESOLVED** 2026-08-04 (Phase 7H), confirmed on real merge to `main` 2026-08-05 (see entry); query-count portion still open |
| KI-11 | `sites:manage` global authority missing from Unit read/create (KI-8 follow-up) | No — **RESOLVED** 2026-07-23 |
| KI-12 | Employee Registry empty-state/site-picker inconsistency for a dual-permission role | No — **RESOLVED** 2026-07-23 (partial scope remainder documented in the entry) |
| KI-13 | Tasks: `tasks:manage` holder could not see a task it created and assigned | No — **RESOLVED** 2026-07-23 |
| KI-14 | Roles & Permissions dialog footer still overlapped final content (KI-9 follow-up) | No — **RESOLVED** 2026-07-23 |
| KI-15 | `corrections-service.test.ts` concurrent-approval race frequently fails under real CI (3/4 observed) | No (test-only, unrelated domain to the PR that found it) — **OPEN, not investigated** |

**No release-blocking issues were found unresolved as of this register's writing.** Two genuine
release blockers were found *and fixed* during this checkpoint (missing production `session` table
migration; see `RC1_VALIDATION_REPORT.md` Steps 2/6) — they are not listed here because they were
resolved, not left open.
