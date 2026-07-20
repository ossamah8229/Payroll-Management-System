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

## Summary

| ID | Issue | Blocking? |
|---|---|---|
| KI-1 | `CANCELLED` materialization lifecycle not implemented — held+materialized entries stay reserved | No |
| KI-2 | Cross-site cookie behavior unverified on real Render two-service deployment | No (gates production, not RC1) |
| KI-3 | No cloud `StorageProvider` implementation | No (gates production if filesystem is ephemeral) |
| KI-4 | 6 pre-existing cosmetic lint warnings | No |
| KI-5 | One timing-dependent test flake (confirmed non-deterministic) | No |
| KI-6 | Puppeteer/embedded-Postgres manual install step in script-restricted environments | No (now documented) |

**No release-blocking issues were found unresolved as of this register's writing.** Two genuine
release blockers were found *and fixed* during this checkpoint (missing production `session` table
migration; see `RC1_VALIDATION_REPORT.md` Steps 2/6) — they are not listed here because they were
resolved, not left open.
