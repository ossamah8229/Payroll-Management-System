# Dashboard — Architecture and Workflow

**Owner module(s):** Dashboard

**Contains:** The Dashboard module's business purpose, permission model (outer route gate and
independent per-widget gates), current-cycle resolution, widget contract, source-of-truth mapping,
Site authorization, single-aggregation-endpoint architecture, snapshot consistency, caching (none in
V1), privacy boundary, empty/error-state behavior, and performance evidence.

**Sections:** no §-numbered content of its own (a prose workflow narrative, matching
`statements-ledger.md`'s/`reports.md`'s own convention) — this module introduces no new table, so it
has no entry in `database/README.md`'s §-numbered schema index. For the entities it *reads*, see
`database/payroll-entry.md §12`, `database/release.md §12b/§12c`, `database/corrections.md §13`, and
`database/advances.md §15`.

**Status:** **Checkpoint 1A (backend foundation) — IMPLEMENTED, awaiting review, NOT COMMITTED.**
**Checkpoint 1B (frontend, UI, and E2E) — IMPLEMENTED, 2026-08-14, awaiting review, NOT COMMITTED.**
See `docs/PROJECT_PROGRESS.md`'s "Dashboard Checkpoint 1A" and "Dashboard Checkpoint 1B" entries for
the full build record of each.

---

## 1. What this module is, and isn't

Dashboard is a **purely derived, read-only aggregation** over data other modules already own — it
introduces no new table, no schema change, and no accounting event of its own. It answers one
question: *"What does the active/current payroll cycle look like right now, and is there anything I
need to pay attention to?"* It is explicitly **not** Payroll Summary v2, Reports catalogue v2,
Variance v2, Payroll Entry v2, an employee detail screen, or a task/inbox system — it summarizes
existing authoritative services and links users to the existing detailed Reports (a frontend,
Checkpoint 1B, concern).

Dashboard introduces **no second net-salary formula and no second release formula**. Every financial
figure is read from an already-authoritative source — `reports.service.ts`'s `buildPayrollSummaryData`
(Payroll Summary's own query+aggregation) for every cycle-scoped financial widget, plus small, direct
DB-aggregate counts for the two widgets that don't already have a matching report aggregation (Total
Employees, and two of the three Attention Required items). `dashboard.service.ts` never imports
`calcNet` and contains no arithmetic recreation of any payroll total.

## 2. Route and permission model

Route: `GET /api/v1/dashboard`, mounted as a flat top-level resource (`app.ts`), mirroring Reports'
own mount pattern — a lens over existing data, not a sub-resource of any one payroll cycle route.
Frontend route: `/` (Checkpoint 1B).

**Outer gate:** `reports:view OR payroll:view` — the project's established any-of permission
mechanism (`requirePermission([...])`), the same Salary Release Report precedent
(`reports.routes.ts`'s `SALARY_RELEASE_REPORT_PERMISSION`). No new `dashboard:view` permission was
created.

**Critical: the outer gate only decides route reachability, never widget content.** Every widget
below independently re-checks its own required permission inside `dashboard.service.ts`'s
`getDashboard` — a caller who passes the outer gate does not automatically receive every widget's
data. This is defense in depth: even though every widget's own permission happens to be at least as
strict as the outer gate today, the outer gate is never treated as an implicit grant for any widget.

| Widget | Permission |
|---|---|
| Cycle Status | either outer-gate permission is sufficient (no independent check needed — no sensitive data) |
| Total Employees | `employees:view` |
| Net Payroll | `reports:view` |
| Pending Release | `reports:view OR payroll:view` |
| Release Progress | `reports:view OR payroll:view` |
| Deductions This Cycle | `reports:view` |
| Site Payroll Summary | `reports:view` |
| Attention — Held Entries | never independently gated (every caller reaching this endpoint already holds `reports:view OR payroll:view`, the same class this item itself would use) |
| Attention — Pending Corrections | `corrections:approve` |
| Attention — Recovery Due | `advances:manage` (the existing Advances module's own read/manage permission — there is no separate `advances:view`) |

A widget the caller isn't authorized for is `null` in the response (an attention item is omitted from
its own object's meaning — see §7) — never a misleading zero.

## 3. Current-cycle resolution

Dashboard resolves "the current cycle" the same way `useSelectedPayrollCycle`'s frontend redirect
algorithm does: **Draft → newest Released → newest Archived → none.** The backend equivalent
(`dashboard.service.ts`'s `resolveCurrentCycle`) runs over `payroll-processing.service.ts`'s own
`listPayrollCycles()` (already sorted `year desc, month desc`), so the backend and frontend can never
resolve a different "current" cycle for the same underlying data — there is no independent
re-implementation of the algorithm against raw Prisma calls.

Since Dashboard is `/`, no cycle id is ever placed in the Dashboard URL or accepted as a query
parameter — the aggregation endpoint receives no request parameters at all and resolves cycle context
internally, once per request.

## 4. Widget contract and source-of-truth mapping

Full response shape: `shared/src/schemas/dashboard.ts`'s `DashboardResponse` (see that file's own
extensive doc comment for the complete nullable/unavailable semantics — summarized here).

| Widget | Authoritative source |
|---|---|
| `cycle` | `payroll-processing.service.ts`'s `listPayrollCycles()`, resolved per §3 |
| `totalEmployees` | `Employee` count (`dateOfLeaving: null`, current `Employee.siteId`) — a plain, direct aggregate; no existing report already exposes this exact figure |
| `netPayroll` | `reports.service.ts`'s `buildPayrollSummaryData` → `cycleTotals.netSalary` |
| `pendingRelease` | same call → `cycleTotals.pendingReleaseCount`/`.pendingReleaseAmount` |
| `releaseProgress` | same call → `cycleTotals`'s five release-state buckets (released/pending/held/noPayDue/recoveryDue) — see §5 for why this reuses Payroll Summary's own bucketing rather than a second call into Salary Release Report |
| `deductionBreakdown` | same call → `cycleTotals.eobi`/`.advanceDeductions`/`.eidAdvanceDeductions`/`.fines` — the exact four-line vocabulary the Deduction Report itself established |
| `siteSummary` / `siteSummaryTotalSites` | same call → `siteRows`, Top-5 by Net Payroll descending (display ordering only — see §6), plus the complete-scope count |
| `attention.heldEntries` | direct `PayrollEntry` count (`hold: true, released: false, payoutOutcome: null`, current cycle + Site scope) — the identical predicate `payroll-release.service.ts`'s own `releaseAllEligible` already uses for "currently-unresolved, held" |
| `attention.pendingCorrections` | direct `CorrectionRequest` count (`status: 'PENDING'`, joined through `payrollEntry.siteId`) — live, cross-cycle (a pending request can only exist against an already-`released` entry, which a Draft "current" cycle can never have — see §5) |
| `attention.recoveryDue` | direct `Advance` count + `outstandingBalance` sum (`status: 'ACTIVE'`, `outstandingBalance > 0`, joined through `employee.siteId`) — live, cross-cycle, the same "current, live figures, not as of any cycle" convention `advance-recovery-report.service.ts` already established |

**Every figure that Payroll Summary already computes is called exactly once per Dashboard request**
(`buildPayrollSummaryData`, exported from `reports.service.ts` for this reuse) — Net Payroll, Pending
Release, Release Progress, Deductions, and Site Summary all share that one fetch, never five
independent ones.

## 5. A deliberate architecture choice: Release Progress reuses Payroll Summary, not Salary Release Report

`Release Progress`/`Pending Release`/`Held Entries` read `buildPayrollSummaryData`'s own release-state
bucket counts rather than calling `salary-release-report.service.ts`'s `computeSalaryReleaseReportTotals`
a second time. Both functions are read-only aggregations over the exact same
`PayrollEntry.released`/`.hold`/`.payoutOutcome` columns — the single source of truth Release Salary's
own write path (`payroll-release.service.ts`'s `releaseProjectUnit`) sets. Neither report "owns" a
competing release formula; they are two independently-shaped views over the same stored facts (the
same relationship Payroll Summary's own `PayrollSummaryFigures` doc comment already documents).
Calling `computeSalaryReleaseReportTotals` a second time in the same Dashboard request would
re-fetch and re-aggregate the identical `PayrollEntry` rows `buildPayrollSummaryData` already fetched
once — a redundant second pass §8's single-request/no-N+1 requirement argues against, not a
correctness improvement.

**This is not merely asserted — `dashboard.test.ts`'s "source reconciliation" suite proves numeric
identity** between this Dashboard's `releaseProgress`/`pendingRelease`/`attention.heldEntries` and the
Salary Release Report's own live totals (`/api/v1/reports/salary-release`), and separately between
`deductionBreakdown` and the Deduction Report's own live totals (`/api/v1/reports/deduction-report`),
for the same cycle/Site scope, on every test run — never a manually copied expected number.

`attention.pendingCorrections` is deliberately **not** scoped to the resolved "current" cycle at all —
a `CorrectionRequest` can only be raised against an already-`released` `PayrollEntry`
(`assertEntryIsReleased`, `corrections.service.ts`), which the resolved current cycle (frequently a
still-`DRAFT` cycle, holding no released entries by definition) usually cannot have. It is a live,
cross-cycle queue, matching `corrections.repository.ts`'s own `listCorrectionRequests` filter shape.
`attention.recoveryDue` is likewise cross-cycle, matching Advance Recovery Report's own convention.

## 6. Site Payroll Summary — Top-N

V1 caps `siteSummary` at **5 rows** (`DASHBOARD_SITE_SUMMARY_TOP_N`, `shared/src/schemas/dashboard.ts`)
— a landing-page-appropriate size given `docs/design-system.md §2.3`'s Dashboard Grid pattern (a
primary table alongside a 4-column stat-card row), with no prior numeric Top-N convention elsewhere
in this codebase to inherit. Rows are sorted by Net Payroll descending (a display-ordering decision
only — every value is read verbatim off `buildPayrollSummaryData`'s own `siteRows`, never recomputed)
so the most financially significant Sites surface first. `siteSummaryTotalSites` reports how many
Sites exist in the complete accessible/filtered scope, so a future frontend can render "+N more — see
full Payroll Summary" without a second request. Only safe aggregate fields already present in the
authoritative source are exposed (`siteId`, `siteName`, `employeeCount`, `netPayroll`,
`releasedAmount`, `pendingReleaseAmount`) — never the full Payroll Summary row/figure set.

## 7. Attention Required — exactly three categories, mixed permission per item

Held Entries, Pending Corrections, Recovery Due — no fourth category, never a task queue. Each item
is independently permission-gated per §2's table; an unauthorized item is `null`, never a zero the
caller could mistake for "genuinely nothing needs attention." `recoveryDue` is the only item carrying
an optional `amount` (the authoritative `Advance.outstandingBalance` sum), since that figure is
already available from its own authoritative source and the caller is authorized. No employee names,
correction reasons, or actor identities are ever included — see §10.

## 8. Site authorization

Every widget reuses the project's existing `assertSiteAccess`/`getAccessibleSiteIds`
(`common/authz-policy.ts`) — Master Admin sees every accessible Site (`undefined` filter,
unrestricted); Payroll Staff/Finance/every other scoped role sees only their assigned Sites
(`currentUser.siteIds`). Historical payroll/financial widgets scope by `PayrollEntry.siteId`
(Held Entries, Release Progress/Pending Release/Net Payroll/Deductions/Site Summary, and Pending
Corrections via `payrollEntry.siteId`) — never `Employee.siteId`. `totalEmployees` and `recoveryDue`
are the two deliberate exceptions, scoping by **current** `Employee.siteId` instead — the current
roster and Advances' own established authorization model (`Advance` has no historical Site of its
own) respectively, matching each underlying domain's own existing convention rather than inventing a
new one.

The caller's accessible-Site scope is resolved exactly once per request (`getAccessibleSiteIds`,
called once and reused/re-derived identically by `buildPayrollSummaryData`'s own internal call with
the same input) and echoed back verbatim as `siteScope.siteIds`, so a client can see exactly what
scope every widget in the response reflects.

## 9. Single aggregation endpoint, snapshot consistency, and no N+1

One request (`GET /api/v1/dashboard`) resolves the current cycle and accessible Site scope exactly
once and reuses both for every widget — there is no per-widget request fan-out. `dashboard.service.ts`
issues exactly one call to `buildPayrollSummaryData` (Payroll Summary's own already
performance-proven single `findMany`) plus four small, fixed, independent count/aggregate queries
(Total Employees, Held Entries, Pending Corrections, Recovery Due) run together in one `Promise.all` —
there is no loop anywhere in the service that issues a further query per row of any result set. See
`dashboard-performance.test.ts` for measured evidence (10,000-employee scale, every new aggregate
query proven index-backed via `EXPLAIN (ANALYZE, BUFFERS)`, no `Seq Scan` on any unbounded table).

## 10. Privacy boundary

Dashboard never exposes raw Prisma objects, employee-level records, employee names, CNIC, banking
detail, actor identity, correction reasons, or audit metadata. `dashboard.test.ts`'s sensitive-field
sweep (`assertNoSensitiveKeys`, extended with `cnic`/`accountnumber`/`iban`/`bank`/`branchcode`/
`releasedby`/`reason`/`employeename`/`employeecode`/`actorid`/`requestedby`/`reviewedby`/
`correctionreason`/`grosspay`) walks the full response recursively on every run.

## 11. Caching (none in V1)

No Redis, no custom short-TTL cache, no in-process memoization. Every request re-resolves the cycle
and re-runs every widget query. `overview.md`'s pre-existing "(read-only, cached)... a candidate for
short-TTL caching" description was aspirational only, per the authorizing instruction — this
checkpoint deliberately does not build it. React Query caching on the frontend belongs to Checkpoint
1B. `Cache-Control: no-store` is set on the HTTP response, matching every other Reports route.

## 12. Empty and error states

- **No `PayrollCycle` exists at all** — `cycle: null`; every cycle-scoped widget (`netPayroll`,
  `pendingRelease`, `releaseProgress`, `deductionBreakdown`) is `null` too (there is no meaningful
  "this cycle's net payroll" to report — never a fabricated `"0.00"`); `siteSummary` is `[]` (a
  genuine empty list, not "unauthorized"); `totalEmployees`/`attention.pendingCorrections`/
  `attention.recoveryDue` are still computed normally (they are not cycle-scoped) and legitimately
  report `0` when nothing exists; `attention.heldEntries` legitimately reports `{ count: 0 }`.
- **Archived-only cycle** — used normally, not treated as an error; every widget populates exactly as
  it would for a Released or Draft cycle.
- **No accessible Sites** (a scoped user assigned to zero Sites) — every Site-scoped widget returns a
  safe empty aggregate (`siteSummary: []`, `totalCount: 0`, etc.), never a leaked global total.
- **Unexpected service/DB error** — propagates as a genuine `500` via the route's own `next(error)`;
  nothing in `dashboard.service.ts` catches and masks a failure as a zero or `null`. This is a
  deliberate, documented choice (whole-response failure for the shared aggregation call, since
  Net Payroll/Deductions/Release Progress/Site Summary all derive from it) rather than inventing a
  per-widget partial-failure/unavailable-state mechanism nothing else in this codebase uses.

## 13. Performance evidence

`dashboard-performance.test.ts` — 10 Sites × 1,000 employees (10,000 total), one Draft cycle with a
mixed release-state population, a scattered subset of `PENDING` `CorrectionRequest`s, and a scattered
subset of `ACTIVE` Advances. Measured: full global Dashboard request ≈1.25s, Site-scoped request
≈124–284ms (both well under the suite's 5s bound); every new aggregate query
(`Employee`/`CorrectionRequest`/`Advance`, each Site-filtered) is index-backed with sub-millisecond
`EXPLAIN ANALYZE` execution time and zero `Seq Scan` on any unbounded table. **No migration was
necessary** — every query this checkpoint adds is already covered by an existing index
(`Employee(siteId)`, `CorrectionRequest(status)` joined through `PayrollEntry`'s primary key,
`Advance(employeeId, type, ...)` joined through `Employee`'s primary key).

## 14. Files

- `shared/src/schemas/dashboard.ts` (new) — response contract, exported from `shared/src/index.ts`.
- `backend/src/modules/dashboard/dashboard.service.ts` (new) — orchestration.
- `backend/src/modules/dashboard/dashboard.routes.ts` (new) — route, permission gate, audit logging.
- `backend/src/modules/reports/reports.service.ts` — `buildPayrollSummaryData`/`PayrollSummaryData`
  exported (previously module-private); no behavior change.
- `backend/src/app.ts` — mounts `dashboardRouter` at `/api/v1/dashboard`.
- `backend/tests/dashboard.test.ts`, `backend/tests/dashboard-performance.test.ts` (new).

No unrelated report, frontend page, or module was touched.

## 15. Frontend (Checkpoint 1B)

Route: `/` (replacing the Phase-1 `HomePage` placeholder). Gate: `reports:view OR payroll:view` —
identical to §2's own outer backend gate, enforced via `RequirePermission` in `App.tsx` and mirrored
by the sidebar's "Dashboard" item (`nav-config.ts`), so neither can ever admit a session the other
would turn away. No `dashboard:view` permission was introduced on either side.

**Data layer** (`frontend/src/hooks/use-dashboard.ts`) is the simplest hook shape in the frontend:
since `GET /api/v1/dashboard` accepts no request parameters at all (§3), the query key is one fixed
constant (`['dashboard']`) rather than params-derived — there is structurally only ever one possible
cache entry for this page, which is what makes "one request, no per-widget fan-out" fall out of the
architecture rather than needing a runtime check.

**Widget rendering is verbatim, never recomputed.** No `calcNet` import and no arithmetic on any
money field exists in the frontend Dashboard code — every figure is `formatMoney`/`formatNumber`
(shared formatters) over the backend's own already-computed value. A cycle-scoped widget's `null` is
disambiguated using this file's own frozen contract (`cycle === null` → "no cycle exists," a
non-null `cycle` with a `null` widget → "unauthorized," per this file's top-of-file doc comment and
§2's independent per-widget gating) — the frontend renders these as two distinct messages ("No
active cycle" vs. "Unavailable"), never collapsed into one generic string. `totalEmployees` and
`attention.pendingCorrections`/`.recoveryDue` are independent of `cycle` (§2/§7) and always read as
"Unavailable" when `null`. `attention.heldEntries` (never `null`, §7) renders a real `0` distinct
from "Unavailable" whenever the cycle genuinely has no held entries.

**Layout** follows the Dashboard Grid pattern (`docs/design-system.md §2.3`): Current Cycle Status,
a 4-stat KPI row (Total Employees / Net Payroll / Pending Release / Release Progress — Release
Progress's own stat card doubles as its compact summary, so there is no second, redundant Release
Progress section), a `1.4fr/1fr` split (Site Payroll Summary / Deductions This Cycle), and a
secondary Attention Required section. No trend chart, no print/export (out of frozen V1 scope).

**Deep links** (§16) reuse only pre-existing routes — Employee Registry, Payroll Summary, Salary
Release Report, Deduction Report, Advance Recovery Report, Corrections — never a new Dashboard
detail page. Site Payroll Summary rows are informational only (Site name is plain text, never a
Link) — `ReportsPayrollSummaryPage` has no URL-driven site filter for a row to honor, so implying a
Site-specific drill-down would be dishonest; the card instead offers one single, honest, card-level
"View Payroll Summary" action (`data-testid="dashboard-site-summary-view-all"`) to the unfiltered
report for the resolved cycle. Adding a real per-Site filter to Payroll Summary is out of this
frontend-only checkpoint's scope.

**Tests**: `use-dashboard.test.ts` (11), `dashboard-labels.test.ts` (13), `home-page.test.tsx` (18),
6 new cases in the pre-existing `nav-config.test.ts`, `require-permission.test.tsx` (2, new) — 50
new frontend tests, full suite 1047/1047. E2E: `tests/e2e/specs/30-dashboard.spec.ts` (11 tests,
real backend, no data mocking) — load, `payroll:view`-only, `reports:view`-only,
denied-without-either, Site-scoped, Site Summary drill-down honesty, financial reconciliation
against the live Payroll Summary Report, Attention link destinations, responsive layout, privacy,
and request discipline (one Dashboard request, zero report-endpoint fan-out).

**Files**: `frontend/src/hooks/use-dashboard.ts` (new); `frontend/src/components/dashboard/
dashboard-labels.ts` (new); `frontend/src/routes/home-page.tsx` (rewritten); `frontend/src/App.tsx`
(the `/` route wrapped in `RequirePermission`, additive); `frontend/src/components/layout/
nav-config.ts` (the Dashboard item's `requiredPermission` added); `tests/e2e/specs/
30-dashboard.spec.ts` (new). No backend, `shared/src/schemas/`, or Prisma/migration file touched.

### 15.1 Targeted UAT remediation (2026-08-14)

Independent review of the Checkpoint 1B build above found two dishonest/dead-end UX affordances,
fixed without touching backend, shared schema, widget permissions, the route gate, cycle
resolution, Site authorization, or the one-request contract:

- **Denied-Dashboard dead end.** `AccessDeniedPage` (`frontend/src/components/layout/
  access-denied.tsx`) always rendered a "Back to Dashboard" action to `/` — for every other gated
  route this is a real destination, but for the Dashboard route itself (also `/`) it silently
  relinked to the same denied screen. Fixed with one new optional prop, `hideHomeAction` (default
  `false`, every existing caller unchanged), threaded through `RequirePermission`
  (`require-permission.tsx`) and set only at the Dashboard's own route wiring in `App.tsx`. No new
  destination was invented and the route's `reports:view OR payroll:view` gate is unchanged.
- **Dishonest Site Summary drill-down.** Every Site Payroll Summary row linked to the same
  unfiltered Payroll Summary report regardless of which Site was clicked, implying a Site-specific
  filter that doesn't exist. Fixed by making the Site name plain text (§15's "Deep links" paragraph
  above) and adding one honest, always-present card-level "View Payroll Summary" action instead. No
  new Payroll Summary URL contract or Dashboard-specific detail route was introduced.

Regression coverage: `require-permission.test.tsx` (new), plus additions to `home-page.test.tsx`
and `tests/e2e/specs/30-dashboard.spec.ts` (see counts above).
