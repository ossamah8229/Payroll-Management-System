# Reports — Architecture and Workflow

**Owner module(s):** Reports

**Contains:** The Reports module's foundation (permission, pagination, aggregation strategy) and the
Payroll Summary Report — its authoritative data sources, financial semantics, grouping, site-scoping,
export, and print treatment.

**Sections:** no §-numbered content of its own (a prose workflow narrative, matching
`statements-ledger.md`'s own convention) — this module introduces no new table, so it has no entry in
`database/README.md`'s §-numbered schema index. For the entities it *reads*, see
`database/payroll-entry.md §12`, `database/release.md §12b/§12c`, and
`database/balance-adjustments.md §14–§14b`.

**Status:** **Phase 8B Checkpoint 1 (Payroll Summary Report) and Phase 7 Employee Payroll History
(Checkpoints 0, 1A backend, and 1B frontend) are all complete.** The remaining Phase
8A-investigated report catalogue (Project Site Payroll Report, Deduction Report, Overtime Report,
Advance Recovery Report, Salary Release Report, Variance/Month-on-Month Report) and Dashboard are
all **Not Started**, each requiring its own separate authorization. See `docs/PROJECT_PROGRESS.md`'s
"Phase 8A — Reports Module Investigation", "Phase 8B Checkpoint 1", and "Phase 7 Reports — Employee
Payroll History" entries for the full build record. §15 below covers Employee Payroll History in
full (backend §15.1–§15.9, frontend §15.10).

---

## 1. What this module is, and isn't

Reports is a **purely derived, read-only lens** over data other modules already own — `PayrollEntry`
(Payroll Entry/Payroll Processing/Release Salary) and, indirectly through it, `PayrollEntryWorkLine`.
It introduces **no new table**, no schema change, and no accounting event of its own — every financial
mutation happens exclusively in the module that already owns it (Principle 1, Principle 9). No route
in this module ever writes to `PayrollEntry`, `PayrollCycle`, `Employee`, `Correction`,
`BalanceAdjustment`, `Advance`, or any other payroll/financial record.

Reports also introduces **no second net-salary formula**. Every net-salary-derived figure (overtime
amount, EOBI deduction, total earning/deduction, net salary) is computed by calling the shared
canonical `calcNet` function (`shared/src/lib/calc-net.ts`) — the exact function
`payroll-entry.service.ts`'s `computeEntryCalc` wraps for every other screen. `reports.service.ts`'s
own `calcEntry` is a second *adapter* around the same `calcNet` (it exists only because Reports
`select`s a narrower row shape than `computeEntryCalc`'s Prisma type requires — see §3), never a second
formula.

## 2. Authoritative data sources

| Report need | Authoritative source |
|---|---|
| Gross pay, allowance, EOBI amount/applicability, per-entry deductions | `PayrollEntry` columns directly |
| Net salary and every derived monetary figure | `calcNet()` (`@payroll/shared`), applied to a `PayrollEntry` + its `PayrollEntryWorkLine` rows |
| Release status | `PayrollEntry.released`/`.hold`/`.payoutOutcome` — never inferred from `PayrollCycle.status` alone (a Unit can release while the cycle is still `DRAFT`) |
| Site attribution | `PayrollEntry.siteId` — the entry's own column, never `Employee.siteId` (current/live) |
| Post-release correction settlement already reconciled into this cycle | `PayrollEntry.correctionBalancePayable`/`.correctionBalanceRecovery` |

**Deliberately not read by this checkpoint:** `BalanceAdjustment.remainingAmount` (the live,
cross-cycle "how much is still owed" figure) and `Employee`'s current record (name, banking, current
site) are both out of scope for Payroll Summary — see §5 and §7 for why.

## 3. Query shape and aggregation strategy

Payroll Summary always scopes to exactly **one** `PayrollCycle` at a time (the same "one cycle at a
time" shape Bank Sheet/Cash Receiving/Payslips already use) — there is no cross-cycle comparison here
(that is the explicitly out-of-scope Variance/Month-on-Month report).

`reports.service.ts`'s `buildPayrollSummaryData` fetches every `PayrollEntry` for the selected cycle
(scoped by site access), `select`ing only the columns `calcNet` and release-state bucketing actually
need — **never** the full `Employee`/banking relation, so no employee identity or banking detail is
ever read or returned by this report. This is the same bounded, single-cycle fetch shape Payroll
Entry's own grid, Bank Sheet, and Cash Receiving already prove safe at the ~1,500-employee scale this
system targets.

Net salary and its components cannot be reproduced as a Prisma `groupBy` aggregate (net salary is
never a stored column anywhere in the schema), so this module aggregates in application code from the
one full pass over the cycle's entries it already has to make for correctness — every other field
that *could* be pushed into a database-level aggregate (`grossPay`, `allowance`, etc.) is deliberately
computed the identical way here, so there is exactly one aggregation strategy for this report, never
two independently-implemented ones that could drift from each other. This was an explicit, approved
trade-off for Checkpoint 1: "correctness is more important than clever query reduction."

## 4. Grouping and figures

Payroll Cycle → Project Site → totals. Each site row (`PayrollSummarySiteRow`) and the cycle-wide
`cycleTotals` share the same `PayrollSummaryFigures` shape — see `reports.types.ts` for the exact
field list and each field's own doc comment. `cycleTotals` is always computed over the **complete**
filtered/accessible site scope, never just the current pagination page — a paginated site list must
never imply a partial grand total.

Every `PayrollEntry` in scope falls into exactly one of five release-state buckets (their counts
always sum to `employeeCount`):

1. **Released** (`released = true`) — paid. `releasedAmount` sums only these entries' net salary,
   defensively filtered to `netSalary > 0` (mirrors `bank-sheets.service.ts`'s own guard against a
   pre-existing legacy anomaly row).
2. **Held** (`hold = true`) — excluded from release entirely. Always counted, never silently dropped.
3. **No Pay Due** (`payoutOutcome = 'NO_PAY_DUE'`) — resolved by a Unit release sweep to zero net.
4. **Recovery Due** (`payoutOutcome = 'RECOVERY_DUE'`) — resolved to a negative net, which
   automatically spawned a `BalanceAdjustment(type: RECOVERY)` elsewhere (Corrections' own domain,
   not re-derived here).
5. **Pending Release** (`released = false`, `hold = false`, `payoutOutcome = null`) — Draft-editable,
   awaiting release. `pendingReleaseAmount` sums only these entries' net salary.

## 5. "Outstanding / balance amount" — the deliberate scope decision

The Checkpoint 1 brief named "Outstanding / balance amount" as an expected field. This report answers
it as **`pendingReleaseAmount`** — this cycle's computed net salary not yet released — rather than by
joining the live, cross-cycle `BalanceAdjustment.remainingAmount` table. `remainingAmount`'s own
origin cycle and settlement history can span cycles other than the one a Payroll Summary report is
scoped to; surfacing it inside a single-cycle summary risks conflating "as of today" with "as of this
cycle" — exactly the kind of misleading combination Phase 8A's financial-correctness investigation
warned against. `balancePayableIncluded`/`recoveryDeducted` (this cycle's own
`correctionBalancePayable`/`correctionBalanceRecovery` sums) are shown as clearly separate fields
instead, so a reviewer can see exactly how much of this cycle's payout/deduction is a settlement of a
prior correction versus ordinary salary.

**A dedicated, cross-cycle Balance Adjustment/Advance Recovery report (Phase 8A §4F) remains the
correct home for `BalanceAdjustment.remainingAmount` — not built in this checkpoint.**

## 6. Draft / Released / Archived semantics

This report is always scoped to one cycle, so there is never a mixed-state total to worry about — the
UI's `CycleStateNotice` exists only to tell the reader what the single selected cycle's state *means*:

- **Draft** — figures reflect the current, editable Payroll Entry state and can change until the
  cycle is released.
- **Released** — figures reflect the payroll as released, including any post-release corrections
  already applied.
- **Archived** — figures reflect the permanently locked, historical payroll for that period.

No special-case query branching is needed for Archived vs. Released — `PayrollEntry`'s own columns are
already frozen at release time (Payroll Entry's Principle 9), so reading current entry state naturally
returns the historically frozen data for both statuses.

## 7. Site scoping

Uses the exact same `assertSiteAccess`/`getAccessibleSiteIds` policy every other site-scoped module
uses (`common/authz-policy.ts`). An explicit `siteIds` filter naming a site the caller cannot access
throws 403 — **never** silently narrowed to the accessible subset. An omitted filter resolves to the
caller's full accessible scope (unrestricted for Master Admin).

## 8. Historical-data limitation (inherited, not introduced)

Phase 8A's investigation found that `PayrollEntry` is only partially snapshotted — banking/designation/
gross-pay/site fields freeze at entry creation, but `Employee.name` has no full historical guarantee
for every row (a nullable `employeeNameSnapshot` column, populated only from a specific point in the
codebase's history onward). **Payroll Summary never reads employee name or any employee identity
field at all** (§3), so this limitation does not affect it directly — but it is documented here because
any *future* report that does show employee names (Employee Payroll History, Project Site Payroll
Report) must account for it explicitly rather than joining live `Employee.name`, the same known,
already-shipped gap Bank Sheet's own "Account Title" column carries. Phase 8B Checkpoint 1 does not
fix that gap — it is out of this checkpoint's scope.

## 9. Pagination

**This section describes Payroll Summary's own pagination architecture — not a generic, reusable
"Reports pagination foundation." Read this before reusing any part of it for a future report.**

`backend/src/modules/reports/reports-pagination.ts` is a minimal, `reports/`-scoped (not
`common/`-promoted) pagination *utility*, not a framework: `resolveReportPage(page, pageSize)` clamps
to `[1, REPORTS_MAX_PAGE_SIZE=100]`/`REPORTS_DEFAULT_PAGE_SIZE=25` and is generically reusable by any
future report as-is. `paginateInMemory`, by contrast, is safe only for Payroll Summary's specific
shape and is not a general answer to "how does a Reports endpoint paginate":

**A. Payroll Summary (this checkpoint) — may continue as built.** The architecture is: one bounded,
single-cycle `PayrollEntry` fetch (§3) → canonical `calcNet` financial calculation → in-memory
aggregation into Project Site rows → `paginateInMemory` over the resulting *already-small* site-row
array (dozens, not thousands, even at the ~1,500-employee cycle scale this system targets — see §3's
"Query shape" note on why net salary cannot be pushed into a Prisma `groupBy`). This is acceptable
specifically because the displayed result cardinality is bounded by Project Sites, not by employees —
not because "fetch then slice in memory" is generally an acceptable Reports pattern. It is not being
refactored for theoretical purity; the current performance evidence (§ this file's own verification
record, `docs/PROJECT_PROGRESS.md`'s Phase 8B Checkpoint 1 entry) supports it as-is.

**B. Future row-level reports MUST use database/query-level pagination.** Employee Payroll History,
Deduction Report, Overtime Report, Advance Recovery Report, Salary Release Report, and any other
report whose pagination unit is a row that scales with employee/cycle history — not a small, bounded
grouping key like Project Site — must push `skip`/`take` into their own Prisma query. They must NOT
fetch all historical rows and then slice the result in application memory; `paginateInMemory` is the
wrong tool for that shape. That DB-pagination abstraction does not exist yet and is deliberately not
being speculatively built in this checkpoint — build it when the first report that actually needs it
is implemented.

**C. This module's naming/API is intentionally narrow.** `reports-pagination.ts` is Payroll Summary's
own pagination utility, kept in the `reports/` module because a second report *might* reuse
`resolveReportPage`, not because it is meant to be read as this module's generic pagination contract.
A future row-level report should treat it as, at most, a source of the `page`/`pageSize` clamping
convention (`resolveReportPage`) — not as precedent for `paginateInMemory`.

The frontend's own `components/reports/report-pagination.tsx` is the matching minimal pagination
control for Payroll Summary specifically — Previous/Next, a "Showing X–Y of Z sites" label,
print-hidden.

## 10. Export

CSV (`stringifyCsvSafe`, this codebase's one mandatory formula-injection-safe serializer) and XLSX
(`exceljs`, this codebase's one XLSX library) — no new library introduced. Both formats call the exact
same `buildPayrollSummaryData` the JSON route uses, and always export the **complete** filtered
report (every site row plus a Total row), never just the client's current pagination page — the
export endpoint accepts no `page`/`pageSize` parameter at all.

## 11. Print

Client-side browser print only (`useTriggerPrint`/`PrintContextHeader`) — Reports gets its own print
layout; no existing document's (Payslip/Statement/Bank Sheet/Cash Receiving) print geometry was
touched. No server-side PDF export for Reports in this checkpoint (Phase 8A found no strong case for
one beyond CSV/XLSX for an aggregate summary table; a future report closer to a per-employee
document may revisit this).

**Post-deployment Print Usability Refinement** — Payroll Summary's own site-level table has 19
columns, too many to print legibly at once (a real production UAT finding, not a hypothetical).
Rather than reuse the generic `PrintButton`, Payroll Summary's own Print action opens a
`PayrollSummaryPrintOptionsDialog` first (presets — Compact Summary/Deductions/Release Status/Custom
— plus individual summary-card and table-column checkboxes, Project Site always locked selected),
then confirms into the exact same shared `useTriggerPrint` engine, fixed to landscape/fit-to-page.
The full `docs/architecture/print-architecture.md` §"Payroll Summary — field-selectable print" is
the canonical write-up; the short version: on-screen and CSV/XLSX are completely unaffected and
always complete; only the printed layout is field-selectable; no calculation is duplicated for
print — every selected field renders directly from the same already-loaded report DTO; the last-used
selection is remembered in browser `localStorage` only, never persisted to PostgreSQL.

**Final Print UX Refinement** — the dialog's own default (and what "Reset to Default" restores) is
now the *complete* report: every summary card, every table column. The application must never
silently hide report data, so a smaller printout is something a user now explicitly opts into — a
preset (Compact Summary/Deductions/Release Status remain exactly as before, as opt-in shortcuts) or
a hand-picked selection — never the unexplained starting point. A saved browser-local preference
still wins over this default on the dialog's next open; only a fresh, never-configured dialog or an
explicit Reset lands on Full Report. The prior pass's plain "N columns selected" text is now a Print
Readability indicator (Excellent/Good/Wide/Very Wide, purely informational, never a selection
change), with a prominent — but still non-blocking — warning once a selection reaches Very Wide
(16+ columns). No report calculation changed; this remains presentation-only.

## 12. Permissions

Reuses the existing, previously-unused `reports:view` permission (already seeded, already
default-granted to Payroll Staff) — no new permission created. Gates both viewing and exporting
uniformly, matching `payslips:view`/`bank-sheets:view`'s own single-permission precedent; there is no
`reports:export`. See `docs/architecture/authentication.md`'s permission/scope matrix for the
classification entry. Master Admin retains implicit full access via the existing
`isMasterAdmin`/`hasGlobalAuthority` bypass.

## 13. Audit

Both viewing and exporting are audited (`report.viewed`/`report.exported`), following the "audit the
view, not just the export" convention `statements.routes.ts` already established — one summary entry
per operation, never per row. `metadata.reportType` distinguishes which report within this module
(`'payroll_summary'` today), so future reports reuse the same two action names rather than minting a
new one each.

## 14. What Phase 8B Checkpoint 1 did NOT build

Per the checkpoint's own explicit scope boundary: Employee Payroll History, Project Site Payroll
Report, Deduction Report, Overtime Report, Advance Recovery Report, Salary Release Report,
Variance/Month-on-Month Report, and Dashboard are all Not Started. No existing module's behavior
(Payroll Entry, Salary Release, Employee Registry, Advances, Corrections, Statements, Payslips, Bank
Sheets, Cash Receiving, company logo, theme system) was modified to build this checkpoint.

**Superseded, 2026-08-05, for Employee Payroll History specifically — see §15 below.** The backend
half of Employee Payroll History (Checkpoint 1A) is now built; the remaining six reports and
Dashboard are still exactly as this section originally described.

## 15. Employee Payroll History — Checkpoint 1A (Backend Foundation, 2026-08-05)

Backend, shared contracts, database index, and backend tests only — no frontend page, no
drill-down UI, no browser Print, no backend PDF, no saved-filter presets. All per the approved
architecture review (a prior read-only checkpoint) and the product/architecture decisions approved
immediately before this checkpoint began implementation.

### 15.1 Approved decisions this checkpoint is built against

1. **Permission: `statements:view`, not `reports:view`.** This report exposes one employee's
   cross-cycle payroll history — the same sensitivity class Statements/Payslips already
   established a dedicated permission for (`shared/src/constants/permissions.ts`'s own doc
   comment on `STATEMENTS_VIEW`), not Payroll Summary's company-wide-aggregate shape. All four
   routes below are gated by it; no new permission was created.
2. **Report grain: one row = one `PayrollEntry`.** Equivalent to one employee per payroll cycle,
   because of `PayrollEntry`'s own `@@unique([cycleId, employeeId])` constraint. No second
   reporting table.
3. **Financial meaning: the main row is always the original, as-released figure.** Every row's
   `netSalary`/`totalEarnings`/`totalDeductions` come from canonical `calcNet` applied to the
   entry's own *stored* columns. A `Correction` never mutates those stored columns — it is a
   separate, append-only record layered on top (§6, `docs/architecture/workflows/
   corrections-and-balance-adjustments.md`) — so this is always exactly what was released, never a
   correction-replayed figure. Verified directly: `Corrections › the original released Net Salary
   on the main row is never replaced by a correction-replayed figure`
   (`backend/tests/employee-payroll-history.test.ts`).
4. **Historical scoping: `PayrollEntry.siteId`, never `Employee.siteId`.** Every row and the
   detail endpoint are both authorized against the row's own historical site. A transferred
   employee's Site-A-era rows stay visible only to a Site-A-scoped caller, and Site-B-era rows
   only to a Site-B-scoped caller, regardless of the employee's *current* site assignment.
5. **Database-level pagination**, with one narrow, disclosed exception — see §15.6.
6. **20,000-row export ceiling** — see §15.5.
7. **Shared Excel column-width helper extraction** — see §15.7.

### 15.2 Shared contracts

`shared/src/schemas/employee-payroll-history.ts` — the first Reports-module report to validate its
query parameters through a shared Zod schema rather than hand-parsing `req.query`
(`reports.routes.ts`'s pre-existing `requireCycleIdQuery`/`parseSiteIdsQuery`/`parsePageQuery`
helpers, used by Payroll Summary, are deliberately left untouched — this checkpoint does not
retrofit them). Defines: the 5-state `EmployeePayrollHistoryRowStatus` union
(`RELEASED`/`HELD`/`NO_PAY_DUE`/`RECOVERY_DUE`/`PENDING`, derived server-side only, never by the
client); the 6 allowed sort fields (`cycle`/`employeeCode`/`employeeName`/`site`/`netSalary`/
`rowStatus`); list/export/employee-lookup query schemas (deliberately excluding a standalone
year/month filter, a generic calendar date range, and a vague `releaseStatus` — see the approved
architecture review); and the full response contract (`EmployeePayrollHistoryRow`/`Totals`/
`ListResponse`/`EmployeeOption`/`EmployeeSearchResponse`/`Detail`/`ExportLimitError`).

### 15.3 Row status derivation

`backend/src/modules/reports/employee-payroll-history-status.ts` — one canonical function,
`deriveEmployeePayrollHistoryRowStatus`, precedence-ordered `RELEASED > HELD > NO_PAY_DUE >
RECOVERY_DUE > PENDING`. Inspecting the actual schema/service invariants
(`payroll-release.service.ts`'s `releaseProjectUnit`/the release-sweep candidate query, the
migration's own `payoutOutcome IS NULL OR released = false` CHECK) shows these four "resolved"
states are already mutually exclusive in valid data — a held entry is never swept, so it can never
also acquire `released`/`payoutOutcome`; `released` is only ever set for the `PAID` bucket. The
precedence therefore only matters for a hypothetical row that violated that invariant (a bug or a
manual DB edit), and is tested explicitly for exactly those "impossible" combinations
(`backend/tests/employee-payroll-history-status.test.ts`, 18 tests) — including a consistency test
proving the derivation function and the `rowStatus` list filter's `WHERE`-clause equivalent
(`employeePayrollHistoryRowStatusWhereClause`) never disagree.

### 15.4 Historical employee discovery — extracted, not duplicated

`backend/src/common/historical-payroll-employee-lookup.ts`'s `searchEmployeesByHistoricalPayroll`
was extracted from `statements.service.ts`'s own `searchStatementEmployees` (per this project's
standing "grep for duplicates on new shared utility" rule) once this report needed the *identical*
historical `PayrollEntry.siteId`/`PayrollEntryWorkLine.unitId`-based discovery query, not a similar
one. `searchStatementEmployees` is now a thin, behavior-preserving wrapper around the shared
function — same exported name/signature, same fixed three-query cost, same "no Advance-only
employee" limitation. `statements.test.ts`'s own 67 tests (including its "No N+1" test) pass
unweakened against the extracted implementation.

### 15.5 Export — 20,000-row ceiling

`EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS = 20_000` (`shared/src/schemas/
employee-payroll-history.ts`), enforced by a `COUNT` preflight
(`buildEmployeePayrollHistoryExportData`) *before* any row is fetched or any CSV/XLSX buffer is
generated — an over-limit request never attempts partial work, and the route returns a structured
`{ code: 'EXPORT_ROW_LIMIT_EXCEEDED', matchingCount, maxRows, message }` body (HTTP 413), never a
silently truncated file. The boundary is `>`, not `>=` — exactly 20,000 matching rows exports
successfully; 20,001 is rejected. Verified in
`backend/tests/employee-payroll-history.test.ts`; the ceiling's own cost at real volume is measured
in §15.9 below.

The flat export column set (Payroll Month, Employee Code, Employee Name, Project Site, Primary
Unit, Additional Unit Count, Designation, Total Earnings, Total Deductions, Net Salary, Row Status,
Correction Count, Outstanding Origin Balance, Released Date) deliberately excludes CNIC, every
banking field, release-actor identity, audit-actor identity, correction reasons, before/after
correction detail, and nested settlement detail — all of that stays drill-down-only, via the
detail endpoint. Export rows are read verbatim off the same `EmployeePayrollHistoryRow` objects the
list endpoint returns, never resummed, so export values are guaranteed to match on-screen values
exactly (Principle 6).

### 15.6 Pagination, sorting, and the one disclosed netSalary exception

Five of the six sort fields (`cycle`/`employeeCode`/`employeeName`/`site`/`rowStatus`) use true
database-level `skip`/`take` pagination with a deterministic ordering that always ends in
`PayrollEntry.id ASC` — offset pagination is stable because no filter/sort key here changes
concurrently at meaningful volume (new rows only appear via a monthly cycle bootstrap).
`rowStatus`'s own sort orders by the three real columns that determine it (`released`/`hold`/
`payoutOutcome`) — every row of the same status sorts contiguously (tested), but the order
*between* statuses follows Postgres's own boolean/enum ordering, not the derivation's precedence
rank; expressing the exact precedence would need a raw SQL `CASE` outside Prisma's typed
`orderBy`, not introduced for a sort-only, non-financial concern.

**`netSalary` is not a stored column** — it only exists as a `calcNet()` result, which cannot be
reproduced as a SQL `ORDER BY`/`SUM` expression without an independent, drift-prone second
implementation of the same formula (explicitly out of scope: "do not create a second SQL
approximation of calcNet"). Loading the complete matching set into memory before paginating is
equally forbidden for a row-level report (`§9` above). **Resolution, reusing already-approved
infrastructure rather than inventing new infrastructure**: `sortBy=netSalary` is served by
fetching every matching row's calc inputs, computing `netSalary` via canonical `calcNet`, sorting
in memory with an explicit `id`-ascending tie-break, and paginating the sorted array — but *only*
when the matching count is within the same `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS` ceiling
already approved for exports. Beyond that bound, `sortBy=netSalary` is rejected with a clear 400
(narrow your filters, or sort by a different column) — never silently truncated, never falling
back to a different sort. This is the identical reasoning and the identical ceiling
`computeEmployeePayrollHistoryTotals` (§15.8) already uses, applied to one more query shape rather
than a second one. Recorded here as a resolved architecture conflict, not a silent shortcut.

### 15.7 Shared Excel column-width utility

`backend/src/common/excel-utils.ts`'s `excelColumnWidth` — extracted from three independent,
byte-identical copies (`bank-sheets.service.ts`, `reports.service.ts`, `statements.service.ts`)
once a fourth consumer (this report's own XLSX export) made "duplicate again" the wrong call.
Behavior-preserving (identical `longest + 3` formula) — `reports.service.ts`'s and
`statements.service.ts`'s own XLSX exports now import the shared helper instead of their own local
copy; `bank-sheets.service.ts`'s copy is deliberately left untouched (not in this checkpoint's
approved migration list). `backend/tests/excel-utils.test.ts` adds focused unit tests; every
pre-existing export test (`bank-sheets.test.ts`, `reports.test.ts`, `statements.test.ts`) still
passes unweakened, proving the extraction changed no output.

### 15.8 Totals

`computeEmployeePayrollHistoryTotals` returns the five status-breakdown counts (plain, always-exact
DB aggregates, combined with the caller's own filter via `AND`, never a shallow spread-merge that
could silently overwrite an existing `rowStatus` filter) unconditionally. The three monetary sums
(`totalEarnings`/`totalDeductions`/`netSalaryTotal`) are computed the same bounded way as §15.6's
`netSalary` sort — fetched and summed via canonical `calcNet`/`sumMoney` only when the matching
count is within the 20,000-row ceiling; beyond it, they are `null` with `totalsComputed: false`,
visible and honest rather than a silently wrong or partial number.

### 15.9 Performance evidence (measured, not assumed)

Seeded 10 sites × 1,000 employees × 3 cycles = 30,000 real `PayrollEntry` rows (plus work lines)
against the local dev database, then ran `EXPLAIN (ANALYZE, BUFFERS)` against the report's actual
query shapes:

| Query | Plan | Execution time |
|---|---|---|
| List, one site (3,000 of 30,000 rows matching), `ORDER BY cycle DESC ... LIMIT 25` | Uses `PayrollEntry_siteId_cycleId_idx` (Index/Bitmap Scan) | ~3–10ms |
| Count, three sites (9,000 rows matching) | Uses `PayrollEntry_siteId_cycleId_idx` or `PayrollEntry_cycleId_siteId_idx` (Index Only Scan) — Postgres chose between the two composite indexes across repeated runs, both equally valid | ~2–4ms |
| One employee across all cycles | Uses the pre-existing `PayrollEntry_employeeId_idx` | <0.1ms |
| Full list-endpoint shape (count + paginated `findMany` with work lines), one site, page of 25 | — | 22–37ms |
| Totals-shaped fetch: calc inputs for 9,000 matching rows, then real `calcNet`+`sumMoney` over all of them | — | ~500ms fetch + ~180ms compute ≈ **680ms total** |

**The new `[siteId, cycleId]` index is confirmed used by the query planner** for the site-scoped,
no-employee-filter query shape it was added for — the architectural claim in the Checkpoint 0
review is now measured, not assumed.

**Known limitation, disclosed rather than silently accepted**: §15.8's totals block is computed on
**every** list request, not only exports — a list call whose filters still match a large row count
(tens of thousands, up to the ceiling) pays the same `calcNet`-over-every-matching-row cost
(extrapolating §15.9's measurement, roughly 1–1.5 seconds at the full 20,000-row ceiling) on every
single page navigation, not only the first. This is a genuine, measured cost characteristic of the
current design, not a bug — narrowing filters (by employee, site, or cycle range, all of which
this report already supports) keeps it fast; an unfiltered "all employees, all history" browse at
real 10,000-employee scale will feel this. Recorded as a candidate for a future checkpoint (e.g.
making totals a separate, independently-cacheable call the frontend requests once per filter
change rather than once per page) rather than fixed silently now, since it is an API-shape change
beyond this checkpoint's own scope.

This sandbox's single-node local Postgres (via `embedded-postgres`) is not a production-scale cloud
database — these numbers are evidence of correct query-plan behavior and rough order of magnitude,
not a production SLA guarantee.

### 15.10 Checkpoint 1B — Frontend, Print, and E2E (2026-08-05)

Frontend-only, over the frozen Checkpoint 1A backend above — no backend, shared-contract, or
database change in this checkpoint. Gated on `statements:view` throughout (routes, catalogue card),
never `reports:view` — the same approved decision §15.1 already established.

**Routes** (`/reports/employee-payroll-history`, `/reports/employee-payroll-history/:entryId`),
lazy-loaded and `RequirePermission`-gated on `PERMISSIONS.STATEMENTS_VIEW`, following the exact
`RequireSession` → `RequirePermission` → page pattern every other gated route already uses
(`App.tsx`). The Reports catalogue card (`reports-page.tsx`) gained a `requiredPermission` field —
additive, optional, absent from every other entry — so Employee Payroll History is hidden entirely
for a user who lacks `statements:view` even though the surrounding catalogue page itself only
requires `reports:view`, never rendered as a broken/unauthorized link.

**Data layer** (`hooks/use-employee-payroll-history.ts`) — imports the DTOs directly from
`@payroll/shared` rather than hand-copying them (they are already the single shared source of truth,
unlike Payroll Summary's/Statements' own backend-internal types) — one query hook for the list, one
for the historical employee lookup, one for the detail endpoint, and a blob-download export function
covering both CSV and XLSX. The export function is the first in this codebase to handle the
structured `413 EXPORT_ROW_LIMIT_EXCEEDED` response shape: a dedicated `ExportRowLimitExceededError`
(extends `ApiError`) carries the backend's own `matchingCount`/`maxRows`/`message`, surfaced verbatim
via `toast.error` — never a generic "export failed," and never a silent fallback to the current page.

**Historical employee lookup** (`components/reports/employee-payroll-history-employee-lookup.tsx`) —
a dedicated fork of `StatementEmployeeLookup`'s own interaction shape (debounced search, listbox
combobox, keyboard navigation, a collapsed "selected" chip), pointed at
`GET /employee-payroll-history/employees` instead — never the current-site-scoped `EmployeeLookup`
(Advances/Corrections' own component). Selecting a candidate is never a claim their complete history
is visible; the list endpoint's own row-level site authorization is the sole authority for that.

**Filters** (Step 5's approved set only): Employee (the lookup above), Site (multi-select), Unit
(disabled unless exactly one Site is selected — Unit only ever means something relative to one site,
and Site is multi-select here), Cycle From/Cycle To (payroll-cycle selects, invalid ordering shown
inline and the query held back rather than sent), Row Status, Has Correction, Has Outstanding Origin
Balance (both the new tri-state All/Yes/No select, §2.4 of `docs/design-system.md`), Current Roster
Status. No standalone Date Range/Year/Month, no vague Release Status, no duplicate Held checkbox —
matching the backend's own deliberate exclusions. A filter or sort change resets pagination to page 1;
Clear Filters restores every filter to its default while leaving the current sort untouched (Step 5:
"preserve the default latest-first sort").

**Totals** — every summary card (Matching Entries, Total Earnings, Total Deductions, Net Salary,
Released, Held, No Pay Due, Recovery Due, Pending, Corrected Entries) renders the backend's own
`EmployeePayrollHistoryTotals` verbatim; when `totalsComputed` is `false` (the matching set exceeds
the 20,000-row ceiling, §15.8), the three monetary cards are replaced by one explanatory notice
("Totals are unavailable for this result size. Narrow the filters to calculate totals.") rather than
a misleading zero — the table itself remains available. No client-side summation anywhere.

**Table** — server-paginated (`ReportPagination`), server-sorted only (the six approved fields;
clicking a header toggles `sortBy`/`sortDir` and always resets to page 1; `aria-sort` reflects the
active column). Every row status (`RELEASED`/`HELD`/`NO_PAY_DUE`/`RECOVERY_DUE`/`PENDING`) gets its
own badge tone (green/hold/gray/red/amber respectively) via a new, colocated
`employee-payroll-history-labels.ts` — never derived client-side. Corrections render as a count
badge, Outstanding Origin Balance as a plain "Outstanding" badge (never a financial amount), the
primary unit as `"{name} (+N more)"`. "View Details" navigates to the detail route, carrying the
current filter/sort/page selection via React Router's own `location.state` (not a new global store,
not URL query serialization — no other page in this codebase does either, so `location.state` is the
lightest-weight existing mechanism) so returning via "Back to Report" restores exactly what was being
viewed.

**Detail page** (`reports-employee-payroll-history-detail-page.tsx`) — a dedicated route, never a
modal, modeled on `balance-adjustment-detail-page.tsx`'s own multi-card/multi-query shape. 9
top-level sections, with Settlements and Correction Payments presented inline within the relevant
correction/balance-adjustment sections rather than as independent top-level cards, in order:
Identity & Historical Assignment (employee, CNIC, historical site, current roster status
explicitly labeled "(current)"), Original Payroll Result (the canonical `calcNet` breakdown verbatim,
labeled with the required "Corrections and later settlements do not overwrite this original payroll
result" text), Work Line / Unit Breakdown, Release Information (release actor's safe `{id, name}`
only — never email/password), Linked Advances, Corrections Originating From This Entry (each with
its own before→after value/net-salary change and, inline, its own Resulting Balance Adjustment
summary and settlement history — the correction-domain's own `balanceAdjustmentTypeTone`/
`balanceAdjustmentTypeLabel`/`balanceAdjustmentStatusTone`/`cyclePeriodLabel` are reused directly from
`corrections/correction-labels.ts` rather than re-implemented), Automatic Recovery Balance Adjustment
(this entry's own direct release outcome, kept visually and textually distinct from a
correction-originated one), Materializations Consumed By This Entry (explicit "Origin cycle: {X}"
wording, never implying the consuming entry's own cycle is the origin), and Audit References
(read-only identifiers, no link — no Audit Log viewer route exists yet in this codebase). CNIC
renders; no banking field is ever present on this page, matching the approved Sensitive Detail
Policy the backend already enforces. A 404 (nonexistent or inaccessible entry) renders one plain
"could not be found" message, deliberately never distinguishing the two cases — mirroring the
backend's own concealment posture.

**Export UI** — Export CSV/Export Excel buttons, one page-level `activeExport` state (mutually
exclusive with Print, matching Payroll Summary's own convention), current filters and sort always
applied, never just the current page. A 413 is shown via the backend's own structured message
through `toast.error`.

**Browser Print (Version 1 scope, Step 11)** — a dedicated
`EmployeePayrollHistoryPrintOptionsDialog`/`employee-payroll-history-print-fields.ts`, a fresh field
vocabulary (never a reuse of Payroll Summary's own `SummaryCardFieldId`/`TableColumnFieldId` — this
report's own summary totals and table columns are a different shape). Prints the current paginated
page only — never an unbounded fetch of the full 20,000-row ceiling, and never routed through backend
Puppeteer. Defaults to every safe card/column selected (10 cards, 13 columns; Employee Name locked as
the one always-included column); a Print Readability indicator (Excellent/Good/Wide/Very Wide, scaled
down from Payroll Summary's own thresholds to this report's smaller 13-column maximum) warns, never
blocks, once a selection gets wide; the one hard block remains "select at least one column besides
Employee Name." The selection persists in browser `localStorage` only, under its own versioned key
(`employee-payroll-history-print-fields:v1`), never PostgreSQL. No CNIC, no banking, no release actor,
no drill-down section is ever offered as a print field — this vocabulary only ever covers the list's
own safe row/summary fields. No backend PDF button.

**Tests**: 5 new colocated Vitest files — `use-employee-payroll-history.test.ts` (URL builders, the
413/`ExportRowLimitExceededError` path, filename-from-`Content-Disposition` fallback),
`employee-payroll-history-labels.test.ts`, `employee-payroll-history-print-fields.test.ts`
(readability levels, `localStorage` round-trip and defensive-parse behavior),
`reports-employee-payroll-history-page.test.tsx` (RBAC, loading/empty/error states, totals including
the `totalsComputed: false` notice, table rendering/badges/`+N more`, sorting resetting page to 1,
pagination using server metadata only, every filter including the tri-state booleans and the
Site-count-gated Unit disable, export request shape, Print Options defaults/persistence/no
CNIC-or-banking-ever), `reports-employee-payroll-history-detail-page.test.tsx` (every section, CNIC
present, no banking field anywhere on the page via a full-body regex sweep, safe release-actor name,
a Correction with its resulting Balance Adjustment, empty-subsection wording, materialization
origin-cycle labeling, 404 concealment, back navigation) — plus a new `reports-page.test.tsx` (3
tests) for the catalogue card's own permission gating. **62 new frontend tests, all
passing; full frontend suite 389/389.** `typecheck`/`lint`/`build` clean across `shared`/`backend`/
`frontend`, `typecheck:e2e` clean.

**Playwright**: `tests/e2e/specs/19-employee-payroll-history-frontend.spec.ts` — real backend, real
Chromium, no `page.route` interception for any RBAC or financial assertion. Covers: Master User
navigation (Reports catalogue → Employee Payroll History), employee-filtered discovery across two
real payroll cycles (a real month-end rollover — Finalize + Archive-and-create-next — fixture, not a
mock), a real approved Correction with its resulting Balance Adjustment and later materialization
visible on the detail page with origin/consuming cycles correctly labeled, sorting (`aria-sort`
toggling a real backend request), pagination, CSV/XLSX export (safe headers present, CNIC/IBAN/
"account number" absent from the downloaded file content itself, not just the on-screen table), Print
Options (default safe-column count, no CNIC/bank fields offered, browser print invoked), a genuine
Site-A→Site-B employee-transfer scenario (a Site-A-only user discovers and sees only the Site-A
historical row, and a direct URL to the Site-B entry renders the same plain not-found state a
nonexistent entry would), and permission enforcement (`reports:view` alone: card hidden, direct
navigation shows "You do not have permission to access this page."; `statements:view`: full access).
**5/5 passing**, both run in isolation (bootstrapping its own first payroll cycle when none exists
yet) and as part of the full suite alongside `17-reports.spec.ts` (9/9 passing, unweakened).

**Performance observations** (measured, not a production SLA): during manual verification, the list
fetch always requested exactly one page (`pageSize=25`), the employee lookup fired one debounced
request per distinct search term (never per keystroke), opening the detail route issued exactly one
detail request (never a prefetch per row), sorting/pagination/filter changes each produced exactly
one new list request with no duplicate/storm, and export/print each used the already-loaded page data
with zero additional fetches.

**Known limitations, disclosed**: (1) `hasOutstandingOriginBalance`'s exact settlement timing after a
`DEFERRED PAYABLE` correction's obligation is consumed by a later cycle's release is a
Corrections-domain behavior this report only ever displays, never controls — the Playwright suite
verifies the resulting Balance Adjustment is shown correctly in either `PENDING` or `SETTLED` state
rather than asserting one specific timing, to avoid this report's own test suite becoming an implicit
second spec for Corrections' settlement mechanics; (2) the totals-latency characteristic already
disclosed in §15.9 is unchanged and now also drives this page's own totals card, so the same
narrow-your-filters guidance applies on first paint too; (3) saved filter presets remain deferred
(unchanged from the architecture review); (4) backend PDF remains intentionally excluded from this
report (unchanged from the architecture review, §10 above).

**Employee Payroll History is now fully complete** (Checkpoints 0, 1A, 1B). The next roadmap report
(Project Site Payroll Report, Deduction Report, Overtime Report, Advance Recovery Report, Salary
Release Report, Variance/Month-on-Month Report) and Dashboard each remain **Not Started** and require
their own separate, explicit authorization — this checkpoint did not begin any of them.
