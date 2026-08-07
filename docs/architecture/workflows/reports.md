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

**Status:** **Phase 8B Checkpoint 1 (Payroll Summary Report), Phase 7 Employee Payroll History
(Checkpoints 0, 1A backend, and 1B frontend), and Phase 7 Project Site Payroll Report (Checkpoints
0, 1A backend, and 1B frontend) are all complete and merged to `main`.** Phase 7 Deduction Report's
Checkpoint 0 (architecture review) is approved, and Checkpoint 1A (backend foundation) and
Checkpoint 1B (frontend, browser print, E2E) are both **IMPLEMENTED, awaiting review, NOT
COMMITTED** — Deduction Report is functionally complete pending review. Phase 7 Overtime Report's
Checkpoint 0 (architecture review) is approved, and Checkpoint 1A (backend foundation) is
**IMPLEMENTED, awaiting review, NOT COMMITTED** — no frontend yet (Checkpoint 1B). The remaining
Phase 8A-investigated report catalogue (Advance Recovery Report, Salary Release Report,
Variance/Month-on-Month Report) and Dashboard are all **Not Started**, each requiring its own
separate authorization. See `docs/PROJECT_PROGRESS.md`'s "Phase 8A — Reports Module Investigation",
"Phase 8B Checkpoint 1", "Phase 7 Reports — Employee Payroll History", "Phase 7 Reports — Project
Site Payroll Report", "Phase 7 Reports — Deduction Report", and "Phase 7 Reports — Overtime Report"
entries for the full build record. §15 below covers Employee Payroll History in full (backend
§15.1–§15.9, frontend §15.10); §16 covers Project Site Payroll Report in full (backend §16.1–§16.8,
frontend §16.9); §17 covers Deduction Report in full (backend §17.1–§17.11, frontend §17.12); §18
covers Overtime Report's backend foundation (§18.1–§18.10) — frontend not yet started.

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

## 16. Project Site Payroll Report — Checkpoint 1A (Backend Foundation, 2026-08-06)

Backend, shared contracts, and backend tests only — no frontend page, no detail endpoint, no
schema/migration change. Built against the approved Checkpoint 0 architecture review's own frozen
decisions (`docs/PROJECT_PROGRESS.md`'s "Project Site Payroll Report — Checkpoint 0" entry).

### 16.1 Frozen decisions this checkpoint is built against

1. **Report scope**: "Which employees were paid at the selected Project Site(s) during one
   payroll cycle?" One row = one `PayrollEntry`. Not a cross-cycle report — `cycleId` is required
   and singular, no `fromCycleId`/`toCycleId` range, no historical browser.
2. **Permission: `reports:view`, not `statements:view`.** This report is the row-level drill-down
   beneath Payroll Summary's own site-aggregate rows (both share the identical permission), never
   a cross-cycle, employee-searchable history — that stays Employee Payroll History's own, more
   sensitive, disclosure class. Site authorization reuses `assertSiteAccess`/
   `getAccessibleSiteIds` exactly as both existing reports already do; historical authorization is
   always `PayrollEntry.siteId`, never `Employee.siteId`.
3. **Cycle**: exactly one, required. No range.
4. **No detail page/endpoint in V1.** Every field the frontend will ever need lives on the list
   row itself.
5. **Unit**: filtering and "Primary Unit (+N more)" display only. No per-Unit financial total or
   allocation of any kind — an entry's aggregate deductions (EOBI, advances, fines, corrections)
   live on `PayrollEntry`, not `PayrollEntryWorkLine`, so there is no mathematically correct way
   to split them across a multi-unit employee's work lines with the existing schema. Not invented.
6. **Financial rules**: canonical `calcNet` only, never a second Net Salary formula. Totals reuse
   Payroll Summary's own field/bucket model (§4 above). Corrections are never replayed —
   `correctionBalancePayable`/`correctionBalanceRecovery` are shown as separate, already-
   materialized-settlement fields, exactly as Payroll Summary already does.
7. **No schema change.** Proven with `EXPLAIN ANALYZE` against realistic seeded data (§16.6).

### 16.2 Shared contracts

`shared/src/schemas/project-site-payroll-report.ts` — the second Reports-module report (after
Employee Payroll History) to validate its query parameters through a shared Zod schema. Defines:
the 5-state `ProjectSitePayrollReportRowStatus` union (same values as
`EmployeePayrollHistoryRowStatus` — `RELEASED`/`HELD`/`NO_PAY_DUE`/`RECOVERY_DUE`/`PENDING` — but
independently declared under this report's own name rather than imported, so neither report's
public DTO carries a confusing cross-report type reference); the 5 allowed sort fields
(`employeeCode`/`employeeName`/`site`/`netSalary`/`rowStatus` — deliberately no `cycle`, since
this report is always exactly one); list/export query schemas (deliberately excluding Employee
search, Designation, any date/month range, Current Roster Status, and an outstanding-balance
filter — the approved Checkpoint 0 filter set only); and the full response contract
(`ProjectSitePayrollReportRow`/`Totals`/`ListResponse`/`ExportLimitError`).

### 16.3 Backend service

`backend/src/modules/reports/project-site-payroll.service.ts` — structurally mirrors Employee
Payroll History's own `employee-payroll-history.service.ts` (`resolveSiteIdFilter`/
`resolveUnitFilter`, `ROW_SELECT`/`calcEntryRow`, `mapEntriesToRows`, `buildOrderBy`, the bounded
`netSalary`-sort/totals-computation resolution) but narrowed to this report's own approved filter
set and simplified where the frozen decisions removed complexity Employee Payroll History needed
(no cycle-range resolution, no per-row `cycle` in `ROW_SELECT` since the whole response shares one
`cycle` at the top level, no outstanding-origin-balance batched query since that filter/field is
out of scope here). Reuses Employee Payroll History's own
`deriveEmployeePayrollHistoryRowStatus`/`employeePayrollHistoryRowStatusWhereClause` directly by
import — this is the *second* consumer of that derivation logic, not yet extracted to a
`common/`-scoped module per this project's own "extract at the third consumer" convention.

**Totals** (`computeProjectSitePayrollReportTotals`) reuse Payroll Summary's own field/bucket
*model* (frozen decision 6) but inherit Employee Payroll History's own guarded-computation *safety
mechanism* (`PROJECT_SITE_PAYROLL_REPORT_EXPORT_MAX_ROWS = 20,000`, the same value and reasoning
as `EMPLOYEE_PAYROLL_HISTORY_EXPORT_MAX_ROWS`, independently named per the same "extract at the
third consumer" convention) rather than Payroll Summary's own unconditional computation — Payroll
Summary's aggregation grain (Project Sites) is always small/bounded (dozens), but this report's
grain (employees within one cycle) is the same order of magnitude as Employee Payroll History's,
so the same "not a stored column, cannot be summed in SQL, only safe to sum via `calcNet` in
application code up to a bound" conflict applies identically. In practice, since this report is
always scoped to one cycle, the ceiling is not expected to bind at this system's current scale —
see §16.6.

`sortBy=netSalary` is resolved by the identical bounded in-memory sort Employee Payroll History
already established (fetch, `calcNet`, sort with an `id`-ascending tie-break, paginate) — rejected
with a 400 above the same ceiling, never silently truncated or falling back to a different sort.

### 16.4 Routes

`GET /api/v1/reports/project-site-payroll` and `GET /api/v1/reports/project-site-payroll/export`,
mounted on the existing `reportsRouter`, both gated by `requirePermission(PERMISSIONS.REPORTS_VIEW)`
— the same permission Payroll Summary already uses. No `/:id` route exists (frozen decision 4).
Both routes are audited (`report.viewed`/`report.exported`, `metadata.reportType:
'project_site_payroll'`), following the same "audit the view, not just the export" convention
every other report already establishes. The export route preflight-`COUNT`s before generating any
CSV/XLSX buffer, returning a structured `{ code: 'EXPORT_ROW_LIMIT_EXCEEDED', matchingCount,
maxRows, message }` (HTTP 413) over the ceiling — never a silently truncated file, never
`page`/`pageSize` accepted at all.

### 16.5 Table columns and totals

Row: Employee Code, Employee Name, Project Site, Primary Unit (+N more), Designation, Gross Pay,
Allowance, EOBI (the `calcNet`-applied deduction, zero whenever `eobiApplicable` is false — never
the raw stored `eobiAmount` regardless of applicability), Advance Deduction, EID Advance
Deduction, Fine, Correction Balance Payable, Correction Balance Recovery, Total Earnings, Total
Deductions, Net Salary, Row Status, Correction Count, Released Date. No CNIC, no banking field, no
release-actor identity, no audit data (frozen decisions — Table Data section) — verified by a
full-response regex sweep in the backend test suite, not just spot-checked fields.

Totals: `matchingCount`, the five status-breakdown counts (`releasedCount`/`heldCount`/
`noPayDueCount`/`recoveryDueCount`/`pendingCount`, always summing to `matchingCount`),
`correctedEntryCount`, and Payroll Summary's own money-field set (`grossPay`/`allowance`/
`eobiDeduction`/`advanceDeduction`/`eidAdvanceDeduction`/`fine`/`correctionBalancePayable`/
`correctionBalanceRecovery`/`totalEarnings`/`totalDeductions`/`netSalaryTotal`), computed over the
**complete filtered dataset**, never the current page. No per-Unit total anywhere in the response
(frozen decision 5) — verified by an explicit regex sweep in the backend test suite.

### 16.6 Performance evidence (measured, not assumed)

Seeded 10 sites × 1,000 employees × 3 cycles = 30,000 real `PayrollEntry` rows (plus work lines)
against a local Postgres instance, then ran `EXPLAIN (ANALYZE, BUFFERS)` against the report's
actual query shapes (a committed, repeatable Jest suite —
`backend/tests/project-site-payroll-report-performance.test.ts` — not an ad hoc script, mirroring
`payroll-entry-performance.test.ts`'s own established methodology):

| Query | Plan | Execution time |
|---|---|---|
| List, one cycle + one site (1,000 of 30,000 rows matching), real `ORDER BY employee.name` + `LIMIT 25` | `Index Scan` on `PayrollEntry_cycleId_idx`, `siteId` applied as a post-scan `Filter` (see note below) | ~12ms |
| List, one cycle only, all sites (10,000 of 30,000 rows matching), same `ORDER BY`/`LIMIT` | `Index Scan` on `PayrollEntry_cycleId_idx` | ~47ms |
| Full HTTP request: list page + totals over 10,000 matching rows (one cycle, unfiltered by site) | — | ~1.2–1.4s |
| Export: 1,000 matching rows (one cycle + one site) to CSV | — | ~230–250ms |

**No `Seq Scan` on `PayrollEntry` occurs in any measured query shape** — confirming frozen
decision 7 ("no schema change... prove this with `EXPLAIN ANALYZE`") directly, not by assumption.

**Honest finding, not the assumption going in**: for the one-cycle-plus-one-site shape, Postgres's
planner chose the single-column `PayrollEntry_cycleId_idx` over either `[cycleId,siteId]`
composite index, applying `siteId` as a post-scan `Filter` rather than as part of the index
condition (`Rows Removed by Filter: 9000` out of ~10,000 cycleId-matching rows scanned). This is a
valid, cost-based planner decision at this data volume/selectivity — not a bug, and not evidence
the composite indexes (added for Payroll Summary and Employee Payroll History respectively) are
unused in general — but it means this specific query shape does not exercise them the way it was
initially expected to. Execution time remains fast (~12ms) regardless. Recorded here as measured
evidence rather than silently asserting the composite index was used, which the actual query plan
does not show.

The Unit-filtered query shape (join through `PayrollEntryWorkLine`, which has only single-column
indexes on `payrollEntryId`/`unitId` — no composite index involving `unitId`) stays fast (~170–
200ms) because it only ever runs against an already-tightly-bounded candidate set (one cycle × the
selected site(s)' own entries, already narrowed by the entry-level index first) — never against an
unbounded multi-cycle set. This assumption is contingent on the report staying single-cycle-scoped
per frozen decision 1; it is not re-validated for any hypothetical future cross-cycle expansion.

This sandbox's single-node local Postgres (via `embedded-postgres`) is not a production-scale
cloud database — these numbers are evidence of correct query-plan behavior and rough order of
magnitude, not a production SLA guarantee (the same caveat §15.9 already states for Employee
Payroll History).

### 16.7 Tests

`backend/tests/project-site-payroll-report.test.ts` (37 tests, post-independent-review
remediation) — authorization (401/403, Master Admin global access, site-scoped restriction, an
explicit inaccessible-`siteIds` filter rejected with 403 never silently narrowed, a genuine
historical-transfer scenario proving authorization uses `PayrollEntry.siteId` and not the
employee's *current* `Employee.siteId`), the cycle requirement (missing/malformed/nonexistent
`cycleId`, confirming no range parameters are accepted), row grain and financial reconciliation
(every required column present and correct, multi-unit "+N more" display with no per-unit
financial field anywhere in the response, no CNIC/banking/audit field anywhere in the response via
both a full-body sweep and a recursive `assertNoSensitiveKeys` check, EOBI deduction respecting
`eobiApplicable`), row-status derivation (Held/Pending/No Pay Due/Recovery Due/a real Released
transition via an actual Unit release), filtering (Site multi-select, Unit scoped to the site
filter, an unrelated `unitId`/`siteIds` mismatch rejected with 400, the Has Correction tri-state,
and a test proving the excluded filters — employee search, designation, date range, roster status,
outstanding balance — have no narrowing effect at all, using values chosen so each one *would*
have excluded the fixture row had it actually been wired, compared byte-for-byte against a
baseline request omitting them), sorting (every approved field including the bounded `netSalary`
path, and an explicit rejection of `sortBy=cycle`), pagination (database-level, page 2 never
re-showing page 1 rows, an out-of-range `pageSize` correctly *rejected* with 400 — never clamped,
matching Employee Payroll History's own identical precedent), totals (complete-filtered-dataset
scope independent of the current page, status counts summing to `matchingCount`, an independent
row-level `netSalary` sum cross-check against `totals.netSalaryTotal`, and an explicit assertion
that no per-unit total exists anywhere in the response), and export (CSV field-by-field parity
against the list endpoint via a real `csv-parse` parse — not just row/header counts — for a
fixture entry exercising every declared export column at once; XLSX parsed with `ExcelJS`: exact
safe header order, sensitive-header absence, complete filtered row count that is never a
pagination-only subset, and representative-row values matching the list endpoint; permission
enforcement before any export work happens). All 37 passing.

`backend/tests/project-site-payroll-report-performance.test.ts` (5 tests, §16.6's own evidence) —
committed and repeatable, not an uncommitted smoke test.

Backend full suite: unaffected outside this checkpoint's own two new files plus the additive
shared-schema/route/service changes — `typecheck`/`lint` clean. **Full-suite investigation
(independent Checkpoint 1A review)**: an initial verification pass saw the full 1,412-test suite
fail widely (~900 tests, all login-related) partway through a run, even with this checkpoint's own
test files excluded. Rather than accept that as "pre-existing and unrelated" on a single
re-provisioned-Postgres data point, the review isolated the variable properly via `git worktree`:
the pure pre-checkpoint baseline (commit `d1116aa`, zero changes) ran clean (1,345/1,371, only
pre-existing Puppeteer-unavailable-in-that-worktree gaps); this checkpoint's *production* changes
alone, with no test files present, produced the statistically indistinguishable clean result
(1,344/1,371); and a subsequent full run in the original working directory, with everything
present, passed **1,412/1,412**. The earlier failures were transient session-level resource
contention (most likely several concurrent `embedded-postgres`/worktree/Jest processes across a
long session), not a deterministic property of this code — confirmed, not merely reasserted.

### 16.8 What Checkpoint 1A did NOT build

Per its own explicit scope boundary: no frontend route, page, filter UI, print, or CSV/XLSX
download button — the backend/export endpoints exist and are fully functional over HTTP, but
nothing in the frontend calls them yet. No detail endpoint (frozen decision 4). No per-Unit
financial total of any kind (frozen decision 5). No schema or migration change (frozen decision
7, proven in §16.6). Dashboard and every other Phase 8A-catalogued report remain untouched and
**Not Started**.

**Known limitations, disclosed**: (1) the totals-latency characteristic already disclosed for
Employee Payroll History (§15.9) applies identically here — an unfiltered, all-sites, one-cycle
request pays the full `calcNet`-over-every-matching-row cost on every request, not only exports;
narrowing by site or unit keeps it fast; (2) the composite `[cycleId,siteId]`/`[siteId,cycleId]`
indexes are not always the plan Postgres chooses for this report's own query shape (§16.6) — this
is disclosed as measured fact, not silently assumed; (3) sorting/totals by `netSalary` share
Employee Payroll History's own disclosed architecture conflict (not a stored column, bounded
in-memory resolution, 400 above the ceiling) rather than a novel one.

**Checkpoint 1A was backend-only; Checkpoint 1B (frontend, below) is now built over it.** No other
report or Dashboard work was started by either checkpoint.

### 16.9 Checkpoint 1B — Frontend, Browser Print, and E2E (2026-08-06)

Frontend-only, over the frozen Checkpoint 1A backend above — no backend, shared-contract, or
database change in this checkpoint. Gated on `reports:view` throughout (route, catalogue card),
never `statements:view` — the same approved frozen decision 2 above.

**Route** (`/reports/project-site-payroll`, plus the canonical `/payroll-cycles/:cycleId/reports/
project-site-payroll`), lazy-loaded and `RequirePermission`-gated on `PERMISSIONS.REPORTS_VIEW`,
following the exact `RequireSession` → `RequirePermission` → page pattern every other gated route
already uses (`App.tsx`). Mirrors Payroll Summary's own dual flat/canonical route pair and
`useSelectedPayrollCycle` hook — the natural precedent for "exactly one required Cycle, no From/To
range" (frozen decisions 1/3), rather than Employee Payroll History's own local-state Cycle
range-selection shape, which doesn't apply here. No detail route exists (frozen decision 4). The
Reports catalogue card (`reports-page.tsx`) needs no `requiredPermission` override — it reuses the
catalogue page's own `reports:view` gate directly, unlike Employee Payroll History's `statements:view`
card.

**Data layer** (`hooks/use-project-site-payroll-report.ts`) — imports the DTOs directly from
`@payroll/shared` (`shared/src/schemas/project-site-payroll-report.ts`), mirroring
`use-employee-payroll-history.ts`'s own convention. One query hook for the list (`enabled:
Boolean(cycleId)` — no request is ever made without a valid Cycle; proven directly by a hook-level
test exercising the real `useQuery` configuration, not just a code comment — see the Tests
paragraph's own "no request without a Cycle" entry below, added during independent review), and a
blob-download export function covering both CSV and XLSX. Site ids are sorted before being joined into both the query key
and the URL, so an equivalent Site selection in a different pick order never produces a different
request or a redundant React Query cache entry. The export function handles the structured 413
`EXPORT_ROW_LIMIT_EXCEEDED` response the same way Employee Payroll History's own
`ExportRowLimitExceededError` does — a dedicated `ProjectSitePayrollReportExportRowLimitExceededError`
(independently declared, not imported, matching this project's "extract at the third consumer"
convention already applied to the backend's own ceiling constant) carries the backend's
`matchingCount`/`maxRows`/`message` verbatim via `toast.error`.

**Filters** (frozen decisions/Step 4's approved set only): Payroll Cycle (`PayrollCycleSelectField`,
required, single, navigates the URL — a navigation control, not a filter, per §2.6 of
`docs/design-system.md`), Site (multi-select), Unit (disabled unless exactly one Site is selected —
the same established convention Employee Payroll History's own Unit field uses, and cleared whenever
the Site selection becomes incompatible), Row Status, Has Correction (the tri-state All/Yes/No
select, §2.4 of `docs/design-system.md`). No Employee search, Designation, date/month range, Current
Roster Status, or outstanding-balance filter — matching the backend's own deliberate exclusions
(frozen decision from Checkpoint 0). A filter or sort change resets pagination to page 1; Clear
Filters restores every filter to its default while never touching the currently selected Cycle (the
Cycle selector is a navigation control, not one of the filters Clear Filters governs).

**Totals** — every one of the 18 backend-provided `ProjectSitePayrollReportTotals` fields renders
verbatim, grouped into three labeled clusters for readability at this field count (Payroll Totals,
Deductions and Adjustments, Status Counts — Step 5's own suggested grouping). When `totalsComputed`
is `false` (the matching set exceeds the 20,000-row ceiling), the eleven monetary cards collapse into
one explanatory notice ("Totals are unavailable for this result size. Narrow the filters to calculate
totals.") — the five status counts and `correctedEntryCount` remain visible regardless, since the
backend always computes those as plain DB aggregates independent of the ceiling. No client-side
summation, and no `calcNet` import, anywhere in this page.

**Table** — server-paginated (`ReportPagination`), server-sorted only on the five backend-approved
fields (`employeeCode`/`employeeName`/`site`/`netSalary`/`rowStatus` — deliberately no `cycle`, since
this report is always exactly one); clicking a sortable header toggles `sortBy`/`sortDir`, always
resets to page 1, and reflects `aria-sort` on the active column. Every row status
(`RELEASED`/`HELD`/`NO_PAY_DUE`/`RECOVERY_DUE`/`PENDING`) gets its own badge tone (green/hold/gray/
red/amber respectively) via a new, colocated `project-site-payroll-labels.ts` — never derived
client-side, mirroring Employee Payroll History's identical tone mapping so the same status reads the
same color across both reports. Corrections render as a plain count badge (never a reason, never a
replay of the correction itself); the primary unit as `"{name} (+N more)"`. No edit action, no "View
Details" action, no row click, and no per-Unit financial column of any kind (frozen decision 5) — the
row shows the entry's own aggregate deductions only. **Page-clamp safeguard (added during
independent review)**: a `useEffect` keyed on the resolved `report.data` (never on
`isLoading`/`isFetching` — this hook has no `placeholderData`/`keepPreviousData`, so `report.data` is
only ever defined once a response for the exact currently-requested page has actually resolved)
clamps `page` down to the new last valid page (`Math.max(1, Math.ceil(total / pageSize))`) whenever
the currently-viewed page is no longer valid for the backend's current total under an otherwise
unchanged filter set — e.g. another user releases/holds rows while this page sits on page 3. Never
fires below page 1, never fires before a real response exists, and self-terminates after one
corrective `setPage` (recomputing against the same total no longer finds the new page out of range),
so it cannot loop with, or fight, the separate filter/sort/Cycle page-reset effect above.

**Export UI** — Export CSV/Export Excel buttons, page-level `activeExport` state (mutually exclusive
across both formats — clicking one disables both until it resolves, preventing a duplicate request),
current Cycle/filters/sort always applied, never just the current page; the export endpoint accepts
no `page`/`pageSize` at all. A 413 is shown via the backend's own structured message through
`toast.error`, and the current filter selection is left completely untouched by an export failure.

**Browser Print (current-page-only scope, Step 10)** — a dedicated
`ProjectSitePayrollPrintOptionsDialog`/`project-site-payroll-print-fields.ts`, a fresh field
vocabulary (never a reuse of Payroll Summary's or Employee Payroll History's own field-id types —
this report's own totals/table are a different shape from both). Explicitly states "Print scope:
current page only" inside the dialog itself. Prints the current paginated page only — never an
unbounded fetch of the full filtered result, and never routed through backend Puppeteer (no backend
PDF for this report, matching both sibling reports). Defaults to every safe card/column selected (18
cards, 19 columns; Employee Name locked as the one always-included column); reuses Payroll Summary's
own 19-column-scaled Print Readability threshold tiers (Excellent ≤8 / Good 9–11 / Wide 12–15 / Very
Wide 16+, since this report's table tops out at the identical 19-column maximum) rather than Employee
Payroll History's smaller 13-column-scaled thresholds — informational only, never blocking; the one
hard block remains "select at least one column besides Employee Name." The selection persists in
browser `localStorage` only, under its own versioned key
(`project-site-payroll-print-fields:v1`), never PostgreSQL; Reset to Default restores the same
complete safe-field selection Select All produces (this dialog defines no narrower preset of its
own). No CNIC, no banking, no release actor, no audit data is ever offered as a print field — this
vocabulary only ever covers the list's own safe row/summary fields. When totals are unavailable, the
print-only cards render the same explanatory notice the on-screen cards show, never zeros.

**Tests**: 4 new colocated Vitest files —
`use-project-site-payroll-report.test.ts` (URL builders including deterministic Site-id ordering, the
413/`ProjectSitePayrollReportExportRowLimitExceededError` path, object-URL revocation, filename
fallback, and — added during independent review — a direct hook-level "no request without a Cycle"
suite that renders the real `useProjectSitePayrollReportList` hook through `renderHook`/
`QueryClientProvider` with `global.fetch` stubbed, proving the query stays `fetchStatus: 'idle'` and
issues zero fetches while `cycleId` is empty, across re-renders, and flips to exactly one request the
moment a real `cycleId` is supplied — not merely the pure URL-builder functions),
`project-site-payroll-labels.test.ts`, `project-site-payroll-print-fields.test.ts`
(readability levels scaled to 19 columns, `localStorage` round-trip under this report's own key,
defensive-parse behavior), `reports-project-site-payroll-page.test.tsx` (RBAC including "no View
Details action ever renders," the missing-Cycle state, loading/empty/error states distinguishing "no
entries for this cycle" from "no match for filters," totals including the grouped layout and the
`totalsComputed: false` notice, every approved table column with a full-body sensitive-field sweep,
`+N more`, a corrections test proving both halves of its own claim — a count badge (a `<span>`) when
`correctionCount > 0` *and* a plain, un-badged "0" when it is 0, with the rest of that row still
correct — every row-status badge, sorting resetting page to 1 with `aria-sort` reflected, pagination
using server metadata only, every filter including the tri-state boolean and the Site-count-gated
Unit disable/clear behavior, Clear Filters preserving the selected Cycle, export request shape and
duplicate-click prevention, the 413 path, Print defaults/persistence/readability/no-CNIC-or-banking-
ever, and — added during independent review — a dedicated "page clamp when the backend total
shrinks" suite covering an already-valid page staying unchanged, a shrunk total clamping down to the
new last valid page with an exact, non-looping request-count delta, a total of 0 clamping to page 1,
and a loading/no-data render never clamping or throwing) — plus 2 new tests in the existing
`reports-page.test.tsx` for the catalogue card's own permission-free (reuses `reports:view` alone)
gating. **78 new frontend tests, all passing (76 in the 4 new files — 14 hook, 5 labels, 14
print-fields, 43 page — 2 added to the existing catalogue test); full frontend suite 468/468.**
`typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend`, `typecheck:e2e` clean.

**Independent review remediation (2026-08-06, same day, before commit)**: an independent read-only
review (Checkpoint 1B review) found zero Blocker/High-severity issues and approved with three
non-blocking notes, all addressed in this same uncommitted checkpoint before any commit: (1) the
correction-count test above now proves both the badge and the plain-"0" case, not only the former;
(2) the "no request without a Cycle" guarantee is now proven by a direct hook-level test, not only by
code inspection; (3) the page-clamp safeguard described in the Table paragraph above was added and
tested. No production behavior changed except the addition of the page-clamp safeguard itself, which
the review characterized as a narrow, previously-undefended edge case, not a defect in what already
shipped.

**Playwright**: `tests/e2e/specs/20-project-site-payroll-report.spec.ts` — real backend, real
Chromium, no `page.route` interception for any RBAC or financial assertion. Covers: Master User
navigation (Reports catalogue → Project Site Payroll Report → Cycle/Site filter → totals → sorting →
pagination), Site scoping (a Site-A-scoped user sees only their accessible historical row, a live
employee transfer to Site B leaves the already-created entry visible under its frozen historical Site
A, Site B is never offered as a filter option, a direct API call naming the inaccessible Site 403s,
and no cross-site leak from an unrelated Site-B-only employee), Unit filtering (a genuine two-Unit
work-line split within one Site remains exactly one row with a "+1 more" badge, the Unit filter
matches on work-line membership for either Unit, no per-Unit financial total anywhere in the page
text), Row statuses (Held via the Hold toggle, No Pay Due via a zero-gross/EOBI-inapplicable/
zero-day entry that resolves to exactly `netSalary = 0` on release, Recovery Due via the
zero-worked-days/positive-gross entry that resolves negative on release, Released via a full month of
worked days, and Pending via a genuine "Late Entry" — an employee added after its Unit already
released, which the ordinary sweep can never reach), Corrections (a real approved correction leaves
the row's own Net Salary provably unchanged from its pre-correction value, shows a correction-count
badge of 1, and never surfaces the correction's own reason text anywhere on the page), Export (CSV/
XLSX download with safe headers present and CNIC/IBAN/account-number/bank absent from the downloaded
file content itself), Print (current-page-only wording, Print Options defaults, Very Wide readability
warning at the full 19-column default, browser print invoked), and Permission enforcement
(`statements:view` alone: catalogue card and nav link absent, direct navigation shows "You do not
have permission to access this page."; `reports:view`: full access). **8/8 passing**, both in
isolation and combined with `17-reports.spec.ts` (9/9 passing, unweakened).

**Request-count/performance observations** (measured during this checkpoint's own manual and
Playwright verification, not a production SLA): the list fetch always requested exactly one page
(`pageSize=25`), a filter/sort/pagination change each produced exactly one new list request with no
duplicate/storm, multi-select Site state produced no request per checkbox toggle (only on menu
close/selection settle, matching `MultiSelectFilter`'s own established debounce-free-but-controlled
pattern), export produced exactly one request with no page/pageSize parameter, and print used the
already-loaded page data with zero additional fetches. No detail request of any kind — no detail
endpoint exists for this report to call.

**Known limitations, disclosed**: (1) every Checkpoint 1A backend limitation (§16.8 above) is
inherited unchanged — this checkpoint touches no backend code; (2) saved filter presets remain
deferred (unchanged from the architecture review); (3) backend PDF remains intentionally excluded
from this report (unchanged from the architecture review).

**Project Site Payroll Report is now fully complete** (Checkpoints 0, 1A, 1B). The next remaining
report (Deduction Report, Overtime Report, Advance Recovery Report, Salary Release Report,
Variance/Month-on-Month Report) and Dashboard each remain **Not Started** and require their own
separate, explicit authorization — this checkpoint did not begin any of them.

## 17. Deduction Report — Checkpoint 1A (Backend Foundation, 2026-08-07)

Backend, shared contracts, and backend tests only — no frontend page, no detail endpoint, no
schema/migration change. Built against the approved Checkpoint 0 architecture review's own frozen
decisions (`docs/PROJECT_PROGRESS.md`'s "Phase 7 Reports — Deduction Report" entries).

### 17.1 Frozen decisions this checkpoint is built against

1. **Business purpose**: a single-cycle, deduction-type-centric operational report — "which
   employees had which deduction(s) applied this cycle, how much, and what does each type total to
   company-wide?" — filterable and sortable by deduction type. Not a cross-cycle history, not an
   Advance Recovery report, not a Variance report, not a second Project Site Payroll Report.
2. **Report grain**: one row = one `PayrollEntry`. No per-deduction row, no per-deduction-type row,
   no synthetic deduction-event row, no new reporting table.
3. **Permission**: `reports:view`, not `statements:view` — the same one-cycle, site-scoped
   operational disclosure class as Payroll Summary/Project Site Payroll Report.
4. **Cycle**: exactly one, required. No range, no generic date range, no cross-cycle browsing.
5. **Site authorization**: always `PayrollEntry.siteId`, never `Employee.siteId` — reusing
   `assertSiteAccess`/`getAccessibleSiteIds` exactly as every other report in this module.
6. **Unit**: filtering and display ("Primary Unit (+N more)") only — never a per-Unit deduction
   total/allocation, the same schema-forced limitation Project Site Payroll Report's own frozen
   decision already established (deductions live on `PayrollEntry`, not `PayrollEntryWorkLine`).
7. **Deduction types — exactly five**: effective EOBI (`eobiApplicable ? eobiAmount : 0`, via
   canonical `calcNet`, never a raw sum/filter of `eobiAmount` alone), Advance Deduction, EID
   Advance Deduction, Fine, Correction Balance Recovery (this cycle's own already-materialized
   settlement — never the live, cross-cycle `BalanceAdjustment.remainingAmount`). Correction Balance
   Payable (an earning) is explicitly out of scope.
8. **Deduction filter model**: five independent tri-state (`All`/`Yes`/`No`) filters — `hasEobi`,
   `hasAdvanceDeduction`, `hasEidAdvanceDeduction`, `hasFine`, `hasCorrectionRecovery` — never a
   single "Deduction Type" multi-select. All provided filters, including the five above and the
   reused `hasCorrection`, compose with `AND` semantics.
9. **Columns**: no Gross Pay, no Net Salary, no Correction Balance Payable, no CNIC, no banking, no
   release/audit-actor identity, no correction reasons, no live `BalanceAdjustment.remainingAmount`
   — a deliberately tighter vocabulary than Project Site Payroll Report's own 19-column table, kept
   this way so the two reports stay genuinely distinct rather than near-duplicates.
10. **Totals**: the approved *unified* bounded computation strategy — every monetary total and
    `employeesWithAnyDeduction` computed via one fetch-and-`calcNet`/`sumMoney` pass, including the
    plain-stored-column totals (`advanceDeductionTotal` etc.), deliberately *not* split into a
    separate always-available SQL-aggregate path for those — reuses the identical
    `DEDUCTION_REPORT_EXPORT_MAX_ROWS = 20,000` ceiling/reasoning Employee Payroll History/Project
    Site Payroll Report already established, rather than inventing a second, independently-verified
    financial-aggregation strategy for this report alone.
11. **Sorting**: eight approved fields (`employeeCode`/`employeeName`/`site`/`advanceDeduction`/
    `eidAdvanceDeduction`/`fine`/`correctionBalanceRecovery`/`rowStatus`) — all true database-level
    `ORDER BY`, no bounded in-memory sort exception anywhere. `eobiDeduction`/`totalDeductions`/
    `netSalary`/`grossPay`/`cycle` are explicitly **not** sortable in V1 (effective EOBI needs the
    applicability conditional, Total Deductions is derived — neither is a plain stored column, and
    this checkpoint does not introduce a bounded-sort exception for either absent real usage proving
    the need).
12. **No detail page/endpoint in V1.** No `GET /api/v1/reports/deduction-report/:id`, no frontend
    detail page in a future Checkpoint 1B, no conditional Employee Payroll History cross-link.
13. **Export**: CSV/XLSX, complete filtered dataset, the same 20,000-row preflight-`COUNT`/
    structured-413 pattern every sibling report already uses. No backend PDF.
14. **Print**: deferred entirely to a future Checkpoint 1B (browser print only, current-page-only,
    a fresh field vocabulary/`localStorage` key) — no backend work for print in this checkpoint.
15. **Row-status extraction**: Deduction Report is the *third* consumer of the generic 5-state
    `PayrollEntry` status derivation (after Employee Payroll History and Project Site Payroll
    Report) — this project's own documented "extract at the third consumer" threshold. Performed
    *before* writing this report's own service, not deferred a third time (§17.2).
16. **No schema/migration change expected** — proven with `EXPLAIN ANALYZE` in this checkpoint
    rather than assumed (§17.6).

### 17.2 Row-status extraction — the third-consumer threshold reached

What was `backend/src/modules/reports/employee-payroll-history-status.ts`'s
`deriveEmployeePayrollHistoryRowStatus`/`employeePayrollHistoryRowStatusWhereClause` is now
`backend/src/modules/reports/payroll-entry-row-status.ts`'s `derivePayrollEntryRowStatus`/
`payrollEntryRowStatusWhereClause` — a behavior-preserving rename/move only (same five states, same
precedence, same WHERE semantics, same impossible-state handling), performed once Deduction Report
became the third consumer (Project Site Payroll Report was already the second, by direct import —
`reports.md` §16.3's own prior "not yet the third-consumer threshold" note is now superseded).
`employee-payroll-history.service.ts` and `project-site-payroll.service.ts` both now import from the
new neutral location instead. The return type is deliberately a local, neutral `PayrollEntryRowStatus`
union — not imported from any single report's own shared schema — since each report's own public DTO
still independently declares its own identically-shaped row-status type (`EmployeePayrollHistoryRowStatus`/
`ProjectSitePayrollReportRowStatus`/`DeductionReportRowStatus`), per this project's own unchanged "no
confusing cross-report type reference in a public DTO" convention; every one of those is structurally
assignable to/from `PayrollEntryRowStatus` with no cast required.

Verified behavior-preserving three ways: (1) `backend/tests/payroll-entry-row-status.test.ts` (the
renamed, otherwise-untouched former `employee-payroll-history-status.test.ts`, 18 tests) passes
unchanged; (2) `employee-payroll-history.test.ts`'s full suite passes unweakened; (3)
`project-site-payroll-report.test.ts`'s full suite passes unweakened. No test was loosened to make
the extraction pass.

### 17.3 Shared contract

`shared/src/schemas/deduction-report.ts` — the third Reports-module report to validate its query
parameters through a shared Zod schema. Defines: the 5-state `DeductionReportRowStatus` union
(independently declared, same reasoning as §17.2's own note); the 8 allowed sort fields (no `eobi`,
no `totalDeductions`, no `netSalary`, no `cycle` — frozen decision 11); list/export query schemas
covering the base filter set (`cycleId` required, `siteIds`, `unitId`, `rowStatus`, `hasCorrection`)
plus the five new deduction tri-states (`hasEobi`/`hasAdvanceDeduction`/`hasEidAdvanceDeduction`/
`hasFine`/`hasCorrectionRecovery`), reusing the established tri-state boolean query-parsing
convention (design-system.md §2.4) and the same UUID list/single-value parsing helpers Project Site
Payroll Report's own shared schema already established; and the full response contract
(`DeductionReportRow`/`Totals`/`ListResponse`/`ExportLimitError`). `DEDUCTION_REPORT_EXPORT_MAX_ROWS
= 20,000`, independently named per the "extract at the third consumer" convention already applied to
the ceiling constant twice before.

### 17.4 Backend service

`backend/src/modules/reports/deduction-report.service.ts` — structurally mirrors Project Site
Payroll Report's own `project-site-payroll.service.ts` (`resolveSiteIdFilter`/`resolveUnitFilter`,
`ROW_SELECT`/`calcEntryRow`, `mapEntriesToRows`, `buildOrderBy`) but narrowed to this report's own
approved filter/column/sort set. `buildDeductionPredicates` is the one canonical deduction-presence
predicate builder shared by list, totals, and export (Step 4 of the authorizing instruction) — each
tri-state, when provided, becomes its own `Prisma.PayrollEntryWhereInput` fragment, combined via a
top-level `AND: [...]` array alongside every other filter. `hasEobi` alone needs a two-column,
applicability-aware predicate (`eobiApplicable: true, eobiAmount: { gt: 0 }` for `Yes`); this is a
plain boolean/comparison filter over already-authoritative stored columns, not an independent
computation of the deduction's monetary *value*, so it does not duplicate `calcNet`'s own
effective-EOBI formula. `hasAnyEffectiveDeduction` (used only for the `employeesWithAnyDeduction`
total, §17.5) mirrors that same semantic for an in-memory presence check, using `Prisma.Decimal`
comparisons (`.greaterThan(0)`), never a JS float accumulation.

No `getDeductionReportListSortedByX` bounded-in-memory-sort function exists anywhere in this module
— unlike Employee Payroll History's/Project Site Payroll Report's own `netSalary` sort, every one of
this report's eight approved sort fields is either a plain stored column or the shared
`released`/`hold`/`payoutOutcome` ordering approximation every sibling report's own `rowStatus` sort
already uses, so `buildOrderBy` is a single, unconditional switch with no `netSalary`-style carve-out
and no query-shape branch in `getDeductionReportList`/`buildDeductionReportExportData` at all.

### 17.5 Totals

`computeDeductionReportTotals` reuses Project Site Payroll Report's own *unified* bounded-computation
shape exactly (frozen decision 10) — the five status-breakdown counts and `correctedEntryCount` are
always-exact DB aggregates, combined with the caller's filter via `AND`; every monetary total and
`employeesWithAnyDeduction` are computed together, in one pass, only when `matchingCount` is within
`DEDUCTION_REPORT_EXPORT_MAX_ROWS` — beyond it, `null`/`null` with `totalsComputed: false`. This
checkpoint's own architecture review (Checkpoint 0) had flagged a genuine open question here — since
four of the five deduction fields are real stored columns, a split strategy (always-available SQL
`SUM`/`CASE WHEN` for those, bounded `calcNet` only for effective EOBI/Total Deductions) was a
possible alternative that would avoid the "totals unavailable above 20,000 rows" state for this
report's own headline figures. The authorizing Checkpoint 1A instruction resolved this explicitly in
favor of the unified strategy ("reuse canonical financial calculation semantics... do not create a
second SQL financial formula... use the same 20,000-row computation ceiling convention already
established") — recorded here as a resolved architecture conflict, not a silent choice.

### 17.6 Routes

`GET /api/v1/reports/deduction-report` and `GET /api/v1/reports/deduction-report/export`, mounted on
the existing `reportsRouter`, both gated by `requirePermission(PERMISSIONS.REPORTS_VIEW)`. No `/:id`
route (frozen decision 12). Both routes are audited (`report.viewed`/`report.exported`,
`metadata.reportType: 'deduction_report'`), following the same "audit the view, not just the export"
convention every other report already establishes. The export route preflight-`COUNT`s before
generating any CSV/XLSX buffer, returning a structured `{ code: 'EXPORT_ROW_LIMIT_EXCEEDED',
matchingCount, maxRows, message }` (HTTP 413) over the ceiling — never a silently truncated file,
never `page`/`pageSize` accepted at all.

### 17.7 Table columns and totals

Row: Employee Code, Employee Name, Project Site, Primary Unit (+N more), Designation, EOBI, Advance
Deduction, EID Advance Deduction, Fine, Correction Balance Recovery, Total Deductions, Row Status,
Correction Count, Released Date. No Gross Pay, no Net Salary, no Correction Balance Payable, no
CNIC, no banking field, no release-actor identity, no audit data — verified by a full-response
recursive sensitive-key sweep in the backend test suite, not just spot-checked fields.

Totals: `matchingCount`, `employeesWithAnyDeduction`, the five per-type sums
(`eobiTotal`/`advanceDeductionTotal`/`eidAdvanceDeductionTotal`/`fineTotal`/
`correctionRecoveryTotal`), `totalDeductions`, the five status-breakdown counts, and
`correctedEntryCount`, computed over the **complete filtered dataset**, never the current page. No
per-Unit total anywhere in the response (frozen decision 6).

### 17.8 Performance evidence (measured, not assumed)

Seeded 10 sites × 1,000 employees × 3 cycles = 30,000 real `PayrollEntry` rows (plus work lines)
against a local Postgres instance, with deliberately *varied* deduction values/EOBI applicability per
employee (not a flat fixture) so the five tri-state filters exercise real, non-degenerate
selectivity — a committed, repeatable Jest suite
(`backend/tests/deduction-report-performance.test.ts`, 12 tests), mirroring
`project-site-payroll-report-performance.test.ts`'s own established methodology.

| Query | Plan | Execution time |
|---|---|---|
| List, one cycle only, all sites (10,000 of 30,000 rows matching), `ORDER BY employee.name` | `Index Scan` on `PayrollEntry_cycleId_idx` | ~1.2s (cold), sub-ms on `EXPLAIN ANALYZE` re-run |
| List, one cycle + one site (1,000 of 10,000 rows matching) | `Bitmap Index Scan` using `PayrollEntry_siteId_cycleId_idx` (see honest finding below) | ~7ms |
| `hasFine=true` (~10% selectivity) | `Index Scan` on `PayrollEntry_pkey`, `Filter` applied post-scan | ~1.2ms |
| `hasEobi=true` (~67% selectivity, the two-column applicability+amount predicate) | `Index Scan` on `PayrollEntry_pkey`, `Filter` applied post-scan | ~0.2ms |
| Sort by `advanceDeduction` desc (a plain stored column, no bounded fallback) | `Bitmap Heap Scan` via `PayrollEntry_cycleId_hold_released_payoutOutcome_idx`, in-DB `Sort` | ~9ms |
| Unit-filtered (join through `PayrollEntryWorkLine`, bounded by cycle+site first) | — | ~116ms |
| Full HTTP request: list page + totals over 10,000 matching rows, one cycle, unfiltered | — | ~890ms |
| Export: 10,000 matching rows (one cycle, unfiltered) to CSV | — | ~1.8s |

**No `Seq Scan` on `PayrollEntry` occurs in any measured query shape** — confirming frozen decision
16 ("no schema change... prove this with `EXPLAIN ANALYZE`") directly.

**Honest finding, not the assumption going in**: for the one-cycle-plus-one-site shape, Postgres's
planner chose a `Bitmap Index Scan` via the composite `PayrollEntry_siteId_cycleId_idx`, not a plain
`Index Scan` — a different access-method choice than Project Site Payroll Report's own §16.6
evidence saw for a structurally similar query (which used a plain `Index Scan` on the single-column
`PayrollEntry_cycleId_idx` instead). Both are valid, cost-based, non-sequential-scan plans; the
difference is attributed to this suite's own varied-deduction-column data distribution affecting the
planner's row-count estimates, not a regression or a missing index. Recorded as measured evidence,
not asserted as one specific scan sub-type the data doesn't consistently show.

**Disclosed scope boundary**: this report's single-cycle scope means genuinely exceeding the
20,000-row export/totals ceiling within one cycle would require seeding more employees than this
suite's own 10,000-per-cycle scale — the literal boundary (20,000 accepted, 20,001 rejected with a
structured 413) is proven cheaply at the contract level in `deduction-report.test.ts` instead; this
performance suite's own job is proving real query-plan behavior and a complete, correctly-filtered
export at realistic volume, not the literal row-count boundary.

This sandbox's single-node local Postgres (via `embedded-postgres`) is not a production-scale cloud
database — these numbers are evidence of correct query-plan behavior and rough order of magnitude,
not a production SLA guarantee, the same caveat every prior report's own performance evidence states.

### 17.9 Tests

**Note**: the counts below are as of Checkpoint 1A's initial IMPLEMENTED state (this section's own
original text, preserved unchanged). §17.11 records the additional tests and updated total from the
same-day review-hardening pass — `deduction-report.test.ts` grew from 60 to 63 tests, plus two new
files (`deduction-report-boundary.test.ts`, 6 tests; `payroll-entry-row-status-regression.test.ts`,
2 tests) neither of which existed yet when this section was first written.

`backend/tests/deduction-report.test.ts` (60 tests) — authorization (401/403, `statements:view`-only
denied, Master Admin global access, site-scoped restriction, an explicit inaccessible-`siteIds`
filter rejected with 403, a genuine historical-transfer scenario proving `PayrollEntry.siteId`-based
authorization, a Unit belonging to an inaccessible Site rejected with 403), contracts (missing/
malformed/nonexistent `cycleId`, malformed `siteIds`, out-of-range `pageSize` rejected not clamped,
an invalid/unapproved `sortBy` including explicit rejection of `eobi`/`totalDeductions`, export
ignoring `page`/`pageSize` entirely, an unrecognized query parameter proven inert via a
byte-for-byte baseline comparison), deduction correctness (effective EOBI on/off including the
"positive amount but not applicable" case, each raw-column deduction field read verbatim, mixed
deductions summing to a canonical-parity Total Deductions, an all-zero entry, a correction proven
never to replay into the original row's own deduction figures, a full-body sweep proving no live
`BalanceAdjustment.remainingAmount` or correction-reason text ever appears), filters (all five
deduction tri-states individually at `Yes`/`No`/`All`, two independent AND-composition cases — one
matching, one yielding zero — plus the reused `hasCorrection`/Site/Row Status filters), row status
(all five states via the extracted generic implementation, plus one genuine release through the real
HTTP release endpoint), sorting/pagination (every approved field including a default-sort check,
database-level pagination across 3 pages with zero overlap and a stable `id` tie-break), totals
(complete-filtered-dataset scope independent of pagination, every deduction total's arithmetic,
`employeesWithAnyDeduction` correctness, status-count-sums-to-matchingCount, no per-Unit total
anywhere), export (CSV field-by-field parity against the list endpoint via a real `csv-parse` parse,
a dedicated sensitive-field sweep, XLSX parsed with `ExcelJS` for exact safe header order and
representative-row parity, filter/sort parity with the list endpoint, permission enforced before any
export work), and query discipline (a `jest.spyOn` proof that correction counts are one batched
query regardless of row count, a multi-unit entry never multiplying row count). All 60 passing.

`backend/tests/deduction-report-performance.test.ts` (12 tests, §17.8's own evidence) — committed
and repeatable, not an uncommitted smoke test.

`backend/tests/payroll-entry-row-status.test.ts` (18 tests, renamed from
`employee-payroll-history-status.test.ts`, §17.2) — unchanged behavior-preservation coverage.

Backend full suite: `typecheck`/`lint`/`build` clean across `shared`/`backend`. Targeted re-run of
every test file this checkpoint touched or depends on (`payroll-entry-row-status.test.ts`,
`employee-payroll-history.test.ts`, `project-site-payroll-report.test.ts`,
`project-site-payroll-report-performance.test.ts`, `deduction-report.test.ts`,
`deduction-report-performance.test.ts` — 195 tests) passes unweakened when run with `--runInBand`
(this codebase's own established convention for DB-backed suites sharing one Postgres instance —
running multiple such files in parallel Jest workers produces cross-suite `cleanTestData()` races
that are environment artifacts of parallel execution, not defects, exactly the class of finding
Project Site Payroll Report's own Checkpoint 1A review already documented and resolved the same way).

### 17.10 What Checkpoint 1A did NOT build

Per its own explicit scope boundary: no frontend route, page, filter UI, print, or CSV/XLSX download
button — the backend/export endpoints exist and are fully functional over HTTP, but nothing in the
frontend calls them yet. No detail endpoint (frozen decision 12). No per-Unit deduction total of any
kind (frozen decision 6). No schema or migration change (frozen decision 16, proven in §17.8).
Dashboard and every other Phase 8A-catalogued report remain untouched and **Not Started**.

**Known limitations, disclosed**: (1) the totals-latency characteristic already disclosed for
Employee Payroll History/Project Site Payroll Report applies identically here — an unfiltered,
one-cycle request pays the full `calcNet`-over-every-matching-row cost on every request, not only
exports; narrowing by site, unit, or a deduction-type filter keeps it fast; (2) ~~the literal
20,000/20,001-row export/totals boundary is proven at the contract level, not at full seeded scale,
for the reasons disclosed in §17.8~~ — **superseded, §17.11**: this is no longer accurate as of the
2026-08-07 review-hardening pass, which added `deduction-report-boundary.test.ts`, proving the
19,999/20,000/20,001 boundary directly at real, seeded volume; (3) `eobiDeduction`/`totalDeductions`
remain unsortable in V1 (frozen decision 11) — revisit only if real usage demonstrates the need, per
the authorizing instruction's own "avoid adding another bounded exception unless user value clearly
justifies it"; (4) saved filter presets and backend PDF remain out of scope, unchanged from every
sibling report.

**Checkpoint 1A is backend-only and awaiting independent review before Checkpoint 1B (frontend)
begins.** No other report or Dashboard work was started. See §17.11 for the same-day
review-hardening pass performed prior to that review.

### 17.11 Review-hardening pass (2026-08-07, same day, targeted — tests/documentation only)

A targeted review/hardening pass, scoped to closing verification gaps left open by Checkpoint 1A
above — no new feature, no frontend work, no Checkpoint 1B, no other report, no production-code
change except where a genuine defect would have required one (none was found).

**M1/M2 — export parity and sensitive-field hardening** (`deduction-report.test.ts`, now 63 tests):
CSV/XLSX parity tests rewritten to reconstruct a header-keyed record (real `csv-parse` with
`columns: true`; the `ExcelJS`-worksheet equivalent for XLSX) and compare it against the list
endpoint's own row via a single `toEqual`, rather than positional/spot-checked cells. Added: an
explicit row-count-ignoring-pagination proof for both formats, an explicit sort-order-parity proof
for both formats, and a dedicated recursive sensitive-key sweep (`assertNoSensitiveKeys`) over
XLSX-reconstructed rows — previously only the list response and CSV records were swept.

**M3 — 19,999/20,000/20,001 ceiling boundary proof** (new `deduction-report-boundary.test.ts`, 6
tests): rather than seed three full ~20,000-row cycles, this file seeds **one** cycle with exactly
20,001 real `PayrollEntry` rows split across three sites (19,999 / 1 / 1) and reaches each exact
boundary count via the report's own real `siteIds` filter. Confirms, at real volume, over the real
HTTP endpoint: `totalsComputed` is `true` at 19,999 and exactly at 20,000, `false` at 20,001;
export succeeds (200, full row count) at 19,999 and exactly at 20,000, and is rejected with a
structured 413 at 20,001, before any row is fetched (measured under 3 seconds).

**M4 — row-status extraction cross-consumer regression proof** (new
`payroll-entry-row-status-regression.test.ts`, 2 tests): proves Employee Payroll History, Project
Site Payroll Report, and Deduction Report all derive the *identical* `rowStatus` for the same
underlying `PayrollEntry` rows, across all five statuses and through a genuine Unit release via the
real release endpoint. This is the one property no report's own individual test suite can catch on
its own (each independently matches its own expected literal, which would still pass even if one
consumer had drifted from the shared module) — only a same-fixture, cross-report comparison does.

**M5 — documentation precision**: the §1/"Deduction Report" entry in `docs/PROJECT_PROGRESS.md` had
left "Full backend suite run once, in the background... result recorded once available" as an open
placeholder. This pass ran that full suite to completion and recorded the actual result there
(1,495/1,496; the one failure identified by exact test name, expected/observed counts, and confirmed
passing in isolation immediately after) rather than leaving the placeholder unresolved or describing
it in vague terms.

**Verification**: full backend suite run once — **1,495/1,496 passing** (78 suites, 555.9s). The one
failure, `employee-payroll-history.test.ts` › "the historical employee lookup issues a fixed query
count regardless of match count (no N+1)" (expected 8 queries, observed 10), sits entirely outside
every file this checkpoint or this hardening pass touched; run alone immediately afterward, the same
file passed clean (63/63, including that exact test) — the project's own already-documented pattern
of query-count assertions sensitive to first-query connection overhead under full-suite ordering
(`docs/SESSION_HANDOFF.md`'s own prior entry on this pattern), not a regression this work introduced.
Also re-run individually and passing: `employee-payroll-history.test.ts` (63/63),
`project-site-payroll-report.test.ts` (37/37), and together in one `--runInBand` pass:
`project-site-payroll-report-performance.test.ts` + `deduction-report-performance.test.ts` +
`deduction-report-boundary.test.ts` + `payroll-entry-row-status-regression.test.ts` +
`payroll-entry-row-status.test.ts` + `deduction-report.test.ts` (106/106). `typecheck`/`lint`/`build`
clean across `shared`/`backend`; `git diff --check` clean. **No production code changed** — every
change in this pass is a new or rewritten test, or a documentation correction.

## 17.12 Checkpoint 1B — Frontend, Browser Print, and E2E (2026-08-07)

Frontend-only, over the frozen Checkpoint 1A backend above — no backend, shared-contract, or
database change in this checkpoint. Gated on `reports:view` throughout (route, catalogue card),
never `statements:view` — the same approved frozen decision 3 above.

**Route** (`/reports/deduction-report`, plus the canonical `/payroll-cycles/:cycleId/reports/
deduction-report`), lazy-loaded and `RequirePermission`-gated on `PERMISSIONS.REPORTS_VIEW`,
following the exact `RequireSession` → `RequirePermission` → page pattern every other gated route
already uses (`App.tsx`). Mirrors Project Site Payroll Report's own dual flat/canonical route pair
and `useSelectedPayrollCycle` hook — the established precedent for "exactly one required Cycle, no
From/To range" (frozen decisions 1/4). No detail route exists (frozen decision 12). The Reports
catalogue card (`reports-page.tsx`) needs no `requiredPermission` override — it reuses the catalogue
page's own `reports:view` gate directly, matching Project Site Payroll Report's own identical
treatment rather than Employee Payroll History's `statements:view` override.

**Data layer** (`hooks/use-deduction-report.ts`) — imports the DTOs directly from `@payroll/shared`
(`shared/src/schemas/deduction-report.ts`), mirroring `use-project-site-payroll-report.ts`'s own
convention. One query hook for the list (`enabled: Boolean(cycleId)`, proven by a direct hook-level
"no request without a Cycle" test suite exercising the real `useQuery` configuration through
`renderHook`/`QueryClientProvider` with `global.fetch` stubbed, not merely a code comment), and a
blob-download export function covering both CSV and XLSX. Site ids are sorted before being joined
into both the query key and the URL. The export function handles the structured 413
`EXPORT_ROW_LIMIT_EXCEEDED` response the same way every sibling report does — a dedicated
`DeductionReportExportRowLimitExceededError` (independently declared, matching this project's
"extract at the third consumer" convention already applied to the backend's own ceiling constant)
carries the backend's `matchingCount`/`maxRows`/`message` verbatim via `toast.error`.

**Filters** (frozen decisions/Step 5's approved set only): Payroll Cycle (`PayrollCycleSelectField`,
required, single, navigates the URL — a navigation control, not a filter, per §2.6 of
`docs/design-system.md`), Site (multi-select), Unit (disabled unless exactly one Site is selected —
the same established convention every sibling report's own Unit field uses, cleared whenever the
Site selection becomes incompatible), Row Status, Has Correction (the tri-state All/Yes/No select,
§2.4 of `docs/design-system.md`), and the five approved deduction-presence tri-states — Has EOBI,
Has Advance Deduction, Has EID Advance Deduction, Has Fine, Has Correction Recovery — each an
independent All/Yes/No select composing with every other filter via `AND` (frozen decision 8, §17.4's
own `buildDeductionPredicates`). No Employee search, Designation, date/cycle range, amount range,
roster status, or outstanding-balance filter — matching the backend's own deliberate exclusions. A
filter or sort change resets pagination to page 1; Clear Filters restores every filter to its default
while never touching the currently selected Cycle.

**Totals** — the backend's `DeductionReportTotals` fields render verbatim, grouped into two labeled
clusters: **Payroll Deductions** (EOBI, Advance Deduction, EID Advance Deduction, Fine, Correction
Recovery, Total Deductions — all six collapse into one explanatory notice, "Totals are unavailable
for this result size. Narrow the filters to calculate totals.", when `totalsComputed` is `false`) and
**Status** (Matching Entries, Employees With Any Deduction, Released, Held, Pending, No Pay Due,
Recovery Due, Corrected Entries). The five status counts, `correctedEntryCount`, and Matching Entries
are plain DB aggregates the backend always computes regardless of `totalsComputed` (§17.5), so they
remain visible even when the monetary group collapses; **Employees With Any Deduction is individually
gated to a dash** (`—`) in that same case, since the backend computes it via the identical bounded
`calcNet`-adjacent pass as the monetary totals (§17.5's own doc comment) — never a misleading zero.
No client-side summation, and no `calcNet` import, anywhere in this page.

**Table** — server-paginated (`ReportPagination`), server-sorted only on the eight backend-approved
fields (`employeeCode`/`employeeName`/`site`/`advanceDeduction`/`eidAdvanceDeduction`/`fine`/
`correctionBalanceRecovery`/`rowStatus` — frozen decision 11; EOBI, Total Deductions, and Correction
Count render as plain, non-interactive header cells with no sort button at all, proven by a dedicated
test); clicking a sortable header toggles `sortBy`/`sortDir`, always resets to page 1, and reflects
`aria-sort` on the active column. Every row status (`RELEASED`/`HELD`/`NO_PAY_DUE`/`RECOVERY_DUE`/
`PENDING`) gets its own badge tone (green/hold/gray/red/amber respectively) via a new, colocated
`deduction-report-labels.ts` — never derived client-side, mirroring every sibling report's identical
tone mapping. Columns, in the exact order the authorizing instruction specified: Employee Code,
Employee Name, Project Site, Primary Unit (+N more), Designation, EOBI, Advance Deduction, EID
Advance Deduction, Fine, Correction Balance Recovery, Total Deductions, Correction Count, Row Status,
Released Date — deliberately not the same column ordering Project Site Payroll Report uses (Row
Status before Corrections there; Correction Count before Row Status here), since this checkpoint's
own authorizing instruction specified this exact order. Correction Count renders as an amber count
badge when `correctionCount > 0`, and a plain, un-badged "0" otherwise — never a badge for zero,
matching every sibling report's identical distinction. No edit action, no "View Details" action, no
row click, and no per-Unit deduction total of any kind (frozen decision 6) — the row shows the
entry's own aggregate deduction figures only. The same page-clamp safeguard Project Site Payroll
Report's own Checkpoint 1B review added (§16.9) is included here from the start: a `useEffect` keyed
on the resolved `report.data` clamps `page` down to the new last valid page whenever the currently-
viewed page is no longer valid for the backend's current total under an otherwise unchanged filter
set, never fires below page 1, never fires before a real response exists, and self-terminates after
one corrective `setPage`.

**Export UI** — Export CSV/Export Excel buttons, page-level `activeExport` state (mutually exclusive
across both formats), current Cycle/filters/sort always applied, never just the current page; the
export endpoint accepts no `page`/`pageSize` at all. A 413 is shown via the backend's own structured
message through `toast.error`, and the current filter selection is left completely untouched by an
export failure.

**Browser Print (current-page-only scope, frozen decision 14)** — a dedicated
`DeductionReportPrintOptionsDialog`/`deduction-report-print-fields.ts`, a fresh field vocabulary
(never a reuse of any sibling report's own field-id types — this report's own totals/table are a
different shape from all of them). States "Print scope: current page only" inside the dialog itself.
Prints the current paginated page only — never an unbounded fetch of the full filtered result, and
never routed through backend Puppeteer (no backend PDF for this report, matching every sibling).
Defaults to every safe card/column selected (14 cards, 14 columns; Employee Name locked as the one
always-included column); readability thresholds (Excellent 0–4 / Good 5–7 / Wide 8–11 / Very Wide
12+) are scaled proportionally from Employee Payroll History's own 13-column-scaled thresholds for
this report's own 14-column maximum, nudging the Very Wide floor up by one column to account for the
one extra column — informational only, never blocking; the one hard block remains "select at least
one column besides Employee Name." The selection persists in browser `localStorage` only, under its
own versioned key (`deduction-report-print-fields:v1`), never PostgreSQL; Reset to Default restores
the same complete safe-field selection Select All produces. No CNIC, no banking, no release actor, no
audit data is ever offered as a print field. When totals are unavailable, the print-only cards render
the same explanatory notice the on-screen cards show, never zeros.

**Tests**: 4 new colocated Vitest files — `use-deduction-report.test.ts` (19 tests: URL builders
including deterministic Site-id ordering and all five deduction tri-state query params, the 413/
`DeductionReportExportRowLimitExceededError` path, object-URL revocation, filename fallback, and a
direct hook-level "no request without a Cycle" suite), `deduction-report-labels.test.ts` (6 tests),
`deduction-report-print-fields.test.ts` (13 tests: readability levels scaled to 14 columns,
`localStorage` round-trip under this report's own key, defensive-parse behavior),
`reports-deduction-report-page.test.tsx` (41 tests: RBAC including "no View Details action ever
renders," the missing-Cycle state, loading/empty/error states distinguishing "no entries for this
cycle" from "no match for filters," totals including the two-group layout, the `totalsComputed: false`
notice, and the individually-dashed Employees With Any Deduction card, every approved table column
with a full-body sensitive-field sweep and an explicit assertion that Gross Pay/Net Salary/Correction
Balance Payable never appear, `+N more`, the correction-count badge-vs-plain-zero distinction, every
row-status badge, sorting resetting page to 1 with `aria-sort` reflected and an explicit proof that
EOBI/Total Deductions/Correction Count expose no sort button, pagination using server metadata only
including the page-clamp-on-shrunk-total safeguard, every filter including all six tri-states
(`hasCorrection` plus the five deduction ones, each independently exercised) and the Site-count-gated
Unit disable/clear behavior, Clear Filters preserving the selected Cycle, export request shape and
duplicate-click prevention, the 413 path, and Print defaults/persistence/readability/no-CNIC-or-
banking-ever) — plus 2 new tests in the existing `reports-page.test.tsx` for the catalogue card's own
permission-free (reuses `reports:view` alone) gating. ~~81 new frontend tests, all passing (79 in the
4 new files — 19 hook, 6 labels, 13 print-fields, 41 page — 2 added to the existing catalogue test);
full frontend suite 549/549.~~ — **superseded, §17.13**: the same-day M1–M5 targeted review pass grew
these counts further (106 across the 4 files, 108 including the catalogue additions; full suite
576/576) and also corrected the labels-file count itself (5, not 6 — a pre-existing miscount in this
paragraph, not a regression). `typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend`,
`typecheck:e2e` clean, `git diff --check` clean.

**Playwright**: `tests/e2e/specs/21-deduction-report.spec.ts` — real backend, real Chromium, no
`page.route` interception for any RBAC or financial assertion. Covers: Master User navigation
(Reports catalogue → Deduction Report → Cycle/Site filter → totals → sorting → pagination), Site
scoping (a Site-A-scoped user sees only their accessible historical row, a live employee transfer to
Site B leaves the already-created entry visible under its frozen historical Site A, Site B is never
offered as a filter option, a direct API call naming the inaccessible Site 403s, and no cross-site
leak from an unrelated Site-B-only employee), a dedicated Deduction filters test proving each of the
five tri-states narrows correctly both individually (one employee fixture per deduction type, direct
`PATCH /api/v1/payroll-entries/:id` for `fine`/`advanceDeduction`/`eidAdvanceDeduction`,
`defaultEobiApplicable` at employee creation for EOBI) and in AND-composition
(`hasFine=Yes AND hasEobi=No` isolates exactly the fine-only fixture), Row statuses (Held via the Hold
toggle, No Pay Due via a zero-gross/EOBI-inapplicable/zero-day entry, Recovery Due via the
zero-worked-days/positive-gross entry, Released via a full month of worked days, Pending via a
genuine "Late Entry," plus the Row Status filter itself narrowing to the same value), Corrections (a
real approved correction leaves the row's own Total Deductions provably unchanged from its
pre-correction value, shows a correction-count column of 1, and never surfaces the correction's own
reason text anywhere on the page), Export (CSV/XLSX download with safe headers present and CNIC/IBAN/
account-number/bank/Gross Pay/Net Salary absent from the downloaded file content itself), Print
(current-page-only wording, Print Options defaults, Very Wide readability warning at the full
14-column default, browser print invoked), a Responsive layout check (1024×800 viewport: no
document-level horizontal scroll per the same invariant `06-ui-regression.spec.ts` already
establishes for the app shell, every filter field remains individually visible), and Permission
enforcement (`statements:view` alone: catalogue card and nav link absent, direct navigation shows
"You do not have permission to access this page."; `reports:view`: full access). ~~9/9 passing, both
in isolation and combined with `17-reports.spec.ts` (18/18 passing, unweakened)~~ — **superseded,
§17.13**: the same-day M1–M5 pass added one more scenario (a full filter/navigation-state round trip)
and strengthened the existing Print test with a real print-media-emulated content check, growing this
to 10/10 standalone, 19/19 combined.

**Request-count/performance observations** (measured during this checkpoint's own manual and
Playwright verification, not a production SLA): the list fetch always requested exactly one page
(`pageSize=25`), a filter/sort/pagination change each produced exactly one new list request with no
duplicate/storm, multi-select Site state produced no request per checkbox toggle, export produced
exactly one request with no page/pageSize parameter, and print used the already-loaded page data with
zero additional fetches. No detail request of any kind — no detail endpoint exists for this report to
call.

**Known limitations, disclosed**: (1) every Checkpoint 1A backend limitation (§17.10 above) is
inherited unchanged — this checkpoint touches no backend code; (2) saved filter presets remain
deferred (unchanged from the architecture review); (3) backend PDF remains intentionally excluded
from this report (unchanged from the architecture review).

**Deduction Report is now fully complete pending review** (Checkpoints 0, 1A, 1B). The remaining
reports (Overtime Report, Advance Recovery Report, Salary Release Report, Variance/Month-on-Month
Report) and Dashboard each remain **Not Started** and require their own separate, explicit
authorization — this checkpoint did not begin any of them.

## 17.13 Checkpoint 1B — Final Targeted Review / Remediation pass (2026-08-07, same day)

A targeted review/hardening pass over the still-uncommitted Checkpoint 1B frontend above, mirroring
§17.11's own precedent for Checkpoint 1A — mostly tests and documentation; **one genuine production
defect found and fixed** (M2, below); everything else is added regression coverage or a chronology
correction. No backend/shared/schema/migration file touched. No other report or Dashboard work
begun.

**M1 — filter/navigation-state architecture, verified against precedent, not invented.** Investigated
whether this report's filter/sort/page state survives navigation. Confirmed by direct inspection
(both this page and `reports-project-site-payroll-page.tsx` grepped for `location.state`/
`sessionStorage`: neither exists in either file) that Project Site Payroll Report — the correct
precedent, sharing `reports:view` and the identical single-required-Cycle shape — has no restoration
mechanism at all: only the Payroll Cycle survives, because it alone is encoded in the URL
(`useSelectedPayrollCycle`'s `/payroll-cycles/:cycleId/...` param); every other filter, the sort, and
the page live in plain `useState` and reset on remount. Deduction Report already matched this
precedent exactly — **no new global filter store was introduced**, per the authorizing instruction's
own explicit constraint. Added regression coverage rather than production changes: four new
`reports-deduction-report-page.test.tsx` tests proving (a) a fresh mount always starts from filter/
sort/page defaults, (b) switching Cycle via the dropdown — a same-`RouteObject`, param-only
navigation that React Router never remounts for — preserves the already-selected Site/Unit, (c)
switching directly between two different single Sites clears an incompatible Unit (not merely "a
second Site added," the only case previously covered), and (d) an unrelated re-render (a background
refetch resolving) never spuriously clears an already-selected Unit. One new Playwright scenario
(`21-deduction-report.spec.ts`, "Filter and navigation state") proves the real browser Back/Forward
round trip end to end: Site/Unit/Row Status/deduction filters/sort all reset after navigating to the
Reports catalogue and back, while the Cycle (URL-encoded) is restored automatically. A second,
originally-planned Playwright test for the Cycle-switch-preserves-Site/Unit scenario was dropped
after discovering `POST /api/v1/payroll-cycles` only ever bootstraps the application's first cycle
ever (every cycle after that requires a real rollover) — by the time this suite runs, a cycle already
exists, so that endpoint would 400/403 on every real run; the identical mechanic is already proven
deterministically at the Vitest level (item (b) above) instead of shipping a self-skipping,
unreliable E2E test.

**M2 — print content verification; one genuine defect found and fixed.** Reviewing the print context
header (`PrintContextHeader`, `hidden print:block`, invisible on screen) against the authorizing
instruction's own required-content list found that the on-page `context` string
(`reports-deduction-report-page.tsx`) omitted **Has Correction and all five deduction tri-state
filter summaries** — Project Site Payroll Report's own identical header includes its one tri-state
(Has Correction); this report simply never carried that pattern forward to its five additional
tri-states. **Fixed**: the context string now lists Cycle, Site, Unit, Row Status, Has Correction,
and all five deduction filters (via a new `triStateSummaryLabel` helper reusing the filter select's
own "All"/"Yes"/"No" words), before "Current page only." Generated timestamp, title, and Cycle were
already correct (`PrintContextHeader`'s own unconditional `Generated {timestamp}` line). Added, at
the config/data-model level per the authorizing instruction's own preference over button-click-only
tests: two new `deduction-report-print-fields.test.ts` describe blocks proving no summary-card or
table-column id/label can ever name a sensitive field (Gross Pay, Net Salary, Correction Balance
Payable, CNIC, banking, release/audit actor, reason) and that the Very Wide readability status never
affects `hasNoMeaningfulColumns` (the warning and the hard block are fully independent checks); six
new `reports-deduction-report-page.test.tsx` tests proving the context header's full content
(including all six tri-state summaries and the generated timestamp), that the print-only totals cards
render real backend values by default (not only after confirming Print, since `printSelection`
initializes to the full selection), that the print-only table renders exactly the confirmed column
set, that opening/confirming Print never calls the export/download function (no backend request), and
a full-body sensitive-field sweep of the actual printed output. One Playwright scenario extended with
a real `page.emulateMedia({ media: 'print' })` assertion — the printed DOM (not just the Print Options
dialog) is checked directly for the Row Status/Has EOBI filter summary, the generated timestamp, the
print-only table's columns, and the absence of every sensitive term.

**M3 — export request parity.** Four new `use-deduction-report.test.ts` tests prove, at the URL-
construction level: CSV and XLSX built from the identical current filters/sort produce byte-identical
query strings except `format`; both formats carry every filter field (cycleId, sorted siteIds,
unitId, rowStatus, all six tri-states, sortBy, sortDir); neither ever includes `page`/`pageSize` or
an unsupported filter; a tri-state left at "All" is omitted identically from both, never sent as a
false-equivalent value. Four new `reports-deduction-report-page.test.tsx` tests prove: the 413
structured message is shown via `toast.error` exactly once (a real `vi.spyOn(toast, 'error')`, this
codebase's own established pattern from `statements-page.test.tsx`); two *separate, sequential* real
export clicks (CSV then XLSX, waiting for the shared `activeExport` guard to release between them,
exactly as a real user would) produce calls whose cycle/filters/sort arguments are deep-equal, proven
by comparing the actual captured call arguments rather than inferring parity from the UI; filters/
sort remain visibly unchanged on screen after both; export never touches `window.location`. The
already-existing "disables both export buttons while one export is already in flight" test already
covered the mutual-exclusion guard and object-URL revocation; not duplicated here.

**M4 — accessibility review; no genuine regression found, coverage added.** Reviewed every control
against the authorizing instruction's checklist. Every tri-state/Row Status/Unit/Cycle control already
used the shared `FilterField`/native-`<select>` pattern (label `id`/`htmlFor` association by
construction — the same mechanism this file's own tests already exercised via `getByLabelText`
throughout); Site's `MultiSelectFilter` trigger already carries its own associated label. The Print
dialog is the shared `Modal`/`ModalContent` (Radix `Dialog`) primitive verbatim — accessible name via
`DialogPrimitive.Title`, focus trap, and Escape-to-close are Radix's own built-in guarantees, not
reimplemented per report. Nine new tests added (`reports-deduction-report-page.test.tsx`): every
filter control reachable by its own label; every tri-state's three `<option>`s are the literal words
"All"/"Yes"/"No" (never color-coded); every sortable header defaults to `aria-sort="none"` and every
non-sortable header (EOBI, Total Deductions, Correction Count, Released Date, Primary Unit,
Designation) carries no `aria-sort` attribute at all; the Print dialog exposes the accessible name
"Print Options"; Escape closes it; closing it never leaves focus stranded inside the removed dialog
subtree (the exact target element Radix's `onCloseAutoFocus` restores focus to was not asserted — no
other dialog in this codebase's test suite independently re-verifies that specific behavior either,
and jsdom's `requestAnimationFrame`/focus-timing support for it is not reliable enough here to assert
without risking a flaky, environment-dependent test); Export CSV/Export Excel's disabled state is
exposed via the native `disabled` attribute, not color alone. **No production code changed for M4.**

**M5 — documentation chronology correction.** The initial Checkpoint 1B pass's own `SESSION_HANDOFF.md`
edit had rewritten the immediately-preceding Checkpoint 1A-only entry's own header text (from
"(latest)" to "(superseded by the entry above for status purposes)") — technically consistent with a
pattern this file already uses pervasively across its own history (Project Site Payroll Report,
Employee Payroll History, and others all show the identical phrasing), but the authorizing instruction
for this pass explicitly named this exact pattern as unwanted for this checkpoint's own record and
asked for it to be reverted: **that entry's own text has been restored verbatim** ("(latest)"), and an
explicit superseding note was added to the *newer* entry instead (which supersedes it for
current-status purposes without touching its own words) — matching the instruction's own stated
convention ("old historical entry remains untouched, then new dated/addendum entry explicitly
supersedes it"). The other, already-committed instances of the same pattern elsewhere in
`SESSION_HANDOFF.md` (from prior sessions' own checkpoints) were deliberately left untouched — out of
this pass's scope, and not part of this still-uncommitted checkpoint's own diff. Test/Playwright
counts throughout `docs/architecture/workflows/reports.md` §17.12, `docs/PROJECT_PROGRESS.md`, and
`docs/SESSION_HANDOFF.md` were verified against a fresh, real run (not assumed) and corrected where
stale, using the same strikethrough-plus-"superseded, §X"-pointer convention §17.11 already
established, rather than silently overwriting a previously-stated number.

**Verification** (this pass only — backend suites were not re-run, per the authorizing instruction's
own "do not run backend suites"): focused runs of every touched/added test file, the full frontend
suite (**576/576 passing**, up from 549 — every net-new test from this pass plus every pre-existing
test, none weakened or skipped), `typecheck`/`lint`/`build` clean across `shared`/`backend`/
`frontend`, `typecheck:e2e` clean, `21-deduction-report.spec.ts` run standalone twice (**10/10
passing** both times) and once combined with `17-reports.spec.ts` (**19/19 passing**, unweakened),
`git diff --check` clean. No backend/shared/schema/migration file appears in this pass's diff. No
other report or Dashboard file appears in this pass's diff.

**Still not committed, pushed, or deployed** — stopping again for final authorization, per the
authorizing instruction.

## 18. Overtime Report — Checkpoint 1A (Backend Foundation, 2026-08-07)

Backend, shared contracts, and backend tests only — no frontend page, no detail endpoint, no
schema/migration change. Built against the approved Checkpoint 0 architecture review's own frozen
decisions.

### 18.1 Frozen decisions this checkpoint is built against

1. **Business purpose**: a single-cycle operational overtime report — "which employees worked
   overtime this cycle, at which Unit, how many hours, at what rate, and how much did it cost."
   Deliberately not a cross-cycle trend (that overlaps the not-yet-built Variance/Month-on-Month
   Report) and not a second Project Site Payroll Report.
2. **Report grain — an intentional, frozen architectural exception**: one row = one
   `PayrollEntryWorkLine`, not one `PayrollEntry` — the first row-level report in this module built
   at this grain. OT hours/rate are genuinely work-line-scoped (`docs/architecture/database/
   payroll-entry.md` §12a): a multi-unit employee's OT rate has no single correct value at
   entry-grain, since each Unit can carry its own `otRate` or derive its own effective rate
   independently. Work-line grain is the only grain where OT Hours, Effective OT Rate, and OT
   Earnings are all unambiguous and correctly attributed per Unit. An employee with 2 work lines
   this cycle appears as 2 rows — Employee Code + Unit together identify a row, not Employee Code
   alone.
3. **Permission**: `reports:view`, not `statements:view` — the same one-cycle, site-scoped
   operational disclosure class as Project Site Payroll Report/Deduction Report.
4. **Cycle**: exactly one, required. No range, no cross-cycle browsing.
5. **Site authorization**: always `PayrollEntry.siteId` (denormalized onto each work line's own
   `siteId` column, DB-guaranteed equal to its parent's) — never `Employee.siteId` — reusing
   `assertSiteAccess`/`getAccessibleSiteIds` exactly as every other report in this module.
6. **Unit**: filterable and displayed as its own row-level field (not a "primary + N more" summary
   like Deduction Report's own Unit column) — a direct consequence of the work-line grain, since
   each row already *is* one specific Unit's attendance record.
7. **Canonical overtime fields — never a second formula**: OT Hours is the stored
   `PayrollEntryWorkLine.otHours` column, read verbatim. Effective OT Rate and OT Earnings both come
   from canonical `calcNet` (`shared/src/lib/calc-net.ts`), never independently recomputed (§18.3).
8. **Filters**: Cycle (required), Site (multi-select), Unit, Row Status, Has Correction, and one
   `hasOvertime` tri-state (`otHours > 0` on the row's own work line) — no separate OT-hours/
   OT-earnings filters, no amount/rate range, no employee search, no designation filter in V1.
9. **Columns**: Employee Code, Employee Name, Project Site, Unit, Designation, OT Hours, Effective
   OT Rate, OT Earnings, Gross Pay, Row Status, Has Correction. No Net Salary, no Total Earnings —
   kept deliberately focused rather than becoming a second Project Site Payroll Report.
10. **Totals**: `matchingCount`, `employeesWithOvertimeCount`, `totalOtHours`, `totalOtEarnings`,
    `sitesWithOvertimeCount`, `unitsWithOvertimeCount` (all six gated by the same 20,000-row bounded
    strategy, including the stored-column `totalOtHours` — deliberately *not* split into an
    always-available SQL-aggregate path, per Deduction Report's own §17.5 "one unified bounded
    strategy, not a second SQL financial formula" precedent), plus three always-exact DB-aggregate
    entry-level counts — `releasedCount`/`heldCount`/`pendingCount` — and `correctedEntryCount`. **No
    "Average OT Rate"** — a naive average of the row-level rate would not be hours-weighted and could
    misrepresent true blended OT cost; deferred, not implemented.
11. **Status-total scope, a deliberate narrowing**: totals expose exactly 3 of the 5 canonical
    `rowStatus` states (Released/Held/Pending), not the full 5-state breakdown Deduction Report/
    Employee Payroll History/Project Site Payroll Report use for their own totals. `NO_PAY_DUE`/
    `RECOVERY_DUE` entries remain in `matchingCount` and fully reachable via the row-level
    `rowStatus` filter (all 5 values) — they are simply not broken out as their own totals bucket in
    V1, so the three counts do not necessarily sum to `matchingCount`. This is the approved scope,
    not an oversight (§18.7).
12. **Entry-level totals must count distinct entries, never raw matching work-line rows** — an
    entry with 2 OT-matching work lines must not double-count as 2 released entries or 2 employees.
    `PayrollEntry`'s own `@@unique([cycleId, employeeId])` makes "distinct employees" and "distinct
    entries" the same count within this report's always-single-cycle scope, so
    `employeesWithOvertimeCount` needs no separate `employeeId` grouping.
13. **Sorting**: `employeeCode`/`employeeName`/`site`/`unit`/`otHours`/`rowStatus` — all true
    database-level `ORDER BY`, no bounded in-memory sort exception. `effectiveOtRate`/`otEarned` are
    explicitly **not** sortable in V1 (neither is a stored column — `otRate` is nullable/derived and
    `otEarned` is never stored at all — and this checkpoint does not introduce a bounded-sort
    exception for either, mirroring Deduction Report's own restraint absent real usage proving the
    need).
14. **No detail page/endpoint in V1.** Every field the frontend needs lives on the list row itself.
    No cross-link to Employee Payroll History's own detail page (a different, more sensitive
    `statements:view` permission a `reports:view`-only user may not hold).
15. **Export**: CSV/XLSX, complete filtered dataset, the same 20,000-row preflight-`COUNT`/
    structured-413 pattern every sibling report already uses. One export row per matching work
    line — a multi-unit entry contributes multiple export rows, exactly matching the list endpoint's
    own grain. No backend PDF.
16. **Print**: deferred entirely to a future Checkpoint 1B (browser print only, current-page-only, a
    fresh field vocabulary/`localStorage` key `overtime-report-print-fields:v1`) — no backend work
    for print in this checkpoint.
17. **No schema/migration change expected** — proven with `EXPLAIN ANALYZE` in this checkpoint
    rather than assumed (§18.6).

### 18.2 Why a single-line `calcNet` call is the canonical per-line figure, not an approximation

Every sibling report's own `calcEntryRow` calls `calcNet` with an entry's *complete* `workLines`
array. This report's own `calcWorkLineRow` (`overtime-report.service.ts`) instead calls `calcNet`
with a `workLines` array containing only the row's own single work line. This is not a second,
approximate formula: inside `calcNet` (`shared/src/lib/calc-net.ts`), each work line's
`dailyRate`/`effectiveOtRate`/`otEarned` is computed purely from that line's own
`otHours`/`otRate`/`cycleDays` and the parent entry's own `grossPay` — the per-line loop body never
reads any sibling line. Calling `calcNet` with `[thisLine]` therefore yields the identical
`workLines[0].effectiveOtRate`/`.otEarned` a full-entry call would have produced for that same line —
proven by construction, not by a special-cased equivalence test — while letting this report avoid
ever selecting/fetching an entry's other work lines, which it never displays. Every other `calcNet`
input this report doesn't display (`allowance`, `leaveDays`, `eobiAmount`, etc.) is still passed as
the entry's own real, selected value, never a placeholder, so the call remains a genuine, complete
invocation of the canonical formula.

### 18.3 Shared contract

`shared/src/schemas/overtime-report.ts` — the fourth Reports-module report to validate its query
parameters through a shared Zod schema. Defines: the 5-state `OvertimeReportRowStatus` union
(independently declared, same "no confusing cross-report type reference in a public DTO" convention
every sibling report already follows); the 6 allowed sort fields (frozen decision 13); list/export
query schemas covering `cycleId` (required), `siteIds`, `unitId`, `rowStatus`, `hasCorrection`, and
the new `hasOvertime` tri-state, reusing the established tri-state boolean/UUID-list query-parsing
convention every sibling report's own shared schema already duplicates (this project's own
established choice not to extract these small Zod helpers into a shared module, even at a 4th
consumer); and the full response contract (`OvertimeReportRow`/`Totals`/`ListResponse`/
`ExportLimitError`). `OVERTIME_REPORT_EXPORT_MAX_ROWS = 20,000`, independently named per the
"extract at the third consumer" convention already applied to the ceiling constant three times
before.

### 18.4 Backend service

`backend/src/modules/reports/overtime-report.service.ts` — the query root is
`prisma.payrollEntryWorkLine`, not `prisma.payrollEntry` (the one structural difference from every
sibling report's own service). `resolveOvertimeReportFilters` builds both a `PayrollEntryWorkLine`-
level `where` (used by the list query, `matchingCount`, and the bounded totals/export fetch) and the
same filter set expressed as a `PayrollEntry`-level `where` plus a `workLines: { some: ... }`
fragment, for the entry-level distinct-count totals (§18.1 frozen decision 12) — kept in lockstep by
being built from the same resolved filter values in one function, not two independently-maintained
copies. `resolveSiteIdFilter`/`resolveUnitFilter` mirror Deduction Report's own functions exactly.
`buildOrderBy` sorts through the `payrollEntry` relation for identity/status fields and directly on
the work line's own columns for `unit`/`otHours` — every branch ends with `{ id: 'asc' }` (the work
line's own `id`, the correct tie-break at this grain).

### 18.5 Totals

`computeOvertimeReportTotals` splits into two groups (frozen decisions 10–12): `matchingCount` and
the four entry-level distinct counts are plain, always-exact `PayrollEntry`/`PayrollEntryWorkLine`
`count()` calls; every other total (`employeesWithOvertimeCount`, `totalOtHours`, `totalOtEarnings`,
`sitesWithOvertimeCount`, `unitsWithOvertimeCount`) is computed in one bounded fetch of every
matching work line's calc inputs, only when `matchingCount` is within
`OVERTIME_REPORT_EXPORT_MAX_ROWS` — beyond it, `null` with `totalsComputed: false`. The "with
overtime" counts are computed from the `otHours > 0` subset of that same bounded fetch (via `Set`
deduplication on `employeeId`/`siteId`/`unitId`), not a second query.

### 18.6 Routes

`GET /api/v1/reports/overtime-report` and `GET /api/v1/reports/overtime-report/export`, mounted on
the existing `reportsRouter`, both gated by `requirePermission(PERMISSIONS.REPORTS_VIEW)`. No `/:id`
route (frozen decision 14). Both routes are audited (`report.viewed`/`report.exported`,
`metadata.reportType: 'overtime_report'`). The export route preflight-`COUNT`s before generating any
CSV/XLSX buffer, returning a structured `{ code: 'EXPORT_ROW_LIMIT_EXCEEDED', matchingCount,
maxRows, message }` (HTTP 413) over the ceiling.

### 18.7 Table columns and totals

Row: Employee Code, Employee Name, Project Site, Unit, Designation, OT Hours, Effective OT Rate, OT
Earnings, Gross Pay, Row Status, Has Correction. No Net Salary, no Total Earnings, no CNIC, no
banking field, no release-actor identity, no audit data — verified by a full-response recursive
sensitive-key sweep in the backend test suite.

Totals: `matchingCount`, `employeesWithOvertimeCount`, `totalOtHours`, `totalOtEarnings`,
`sitesWithOvertimeCount`, `unitsWithOvertimeCount` (all six bounded/nullable together),
`releasedCount`/`heldCount`/`pendingCount` (always-exact, distinct-entry, 3-bucket — frozen decision
11), and `correctedEntryCount` (always-exact, distinct-entry), computed over the **complete filtered
work-line scope**, never the current page. No "Average OT Rate" anywhere in the response (frozen
decision 10).

### 18.8 Performance evidence (measured, not assumed)

Seeded 10 sites × 1,000 employees × 3 cycles = 30,000 real `PayrollEntry` rows (each with exactly
one `PayrollEntryWorkLine` — the documented common case), OT hours varied ~1-in-4 so `hasOvertime`
exercises real, non-degenerate selectivity — a committed, repeatable Jest suite
(`backend/tests/overtime-report-performance.test.ts`, 9 tests).

| Query | Plan | Execution time (`EXPLAIN ANALYZE`) |
|---|---|---|
| List, one cycle only, all sites (10,000 of 10,000 rows matching), `ORDER BY employee.name` | Alternates run to run between an `Index`/`Bitmap Heap Scan` on `PayrollEntry` and a `Parallel Seq Scan` on `PayrollEntry` (see the independent-review addendum below — a genuine, cost-based coin-flip at this fixture's own 33% single-cycle selectivity, not a pathology), hash/nested-loop-joined to `PayrollEntryWorkLine` (see honest finding below) | ~10–190ms |
| List, one cycle + one site (1,000 of 10,000 rows matching) | `Index Scan` on `PayrollEntry` via `PayrollEntry_siteId_cycleId_idx`, nested-loop into a `Bitmap Index Scan` on `PayrollEntryWorkLine_payrollEntryId_idx` | ~8ms |
| `hasOvertime=true` (~25% selectivity, the work line's own stored column) | `Bitmap Heap Scan` on `PayrollEntry` via the same cycle index, hash-joined to a `Seq Scan` on `PayrollEntryWorkLine` with `Filter: "otHours" > 0` | ~10ms |
| Unit-filtered (cycle + site + unit) | `Hash Join`: a `Bitmap Heap Scan` on `PayrollEntryWorkLine` via `PayrollEntryWorkLine_unitId_idx` hashed against a `Bitmap Heap Scan` on `PayrollEntry` via `PayrollEntry_siteId_cycleId_idx` — see the independent-review addendum below for the pre-`ANALYZE` bad-plan finding this replaced | ~5–130ms |
| Sort by `otHours` desc (a plain stored `PayrollEntryWorkLine` column, no bounded fallback) | Same shape as the unfiltered list query, `Sort Key: pewl."otHours" DESC` | ~16ms |
| Full HTTP request: list page + totals over 10,000 matching work lines, one cycle, unfiltered | — | ~1.0s |
| Export: 10,000 matching rows (one cycle, unfiltered) to CSV | — | ~1.8s |

**No `Seq Scan` on `PayrollEntry` occurs in the site-filtered, `hasOvertime`-filtered, unit-filtered,
or `otHours`-sorted query shapes** — confirming frozen decision 17 ("no schema change... prove this
with `EXPLAIN ANALYZE`") directly for every filtered/sorted access path this report actually
exposes. The one exception (the single-cycle, *no*-filter shape) is addressed by its own
independent-review addendum immediately below, not silently folded into this blanket claim.

**Honest finding, not the assumption going in**: `PayrollEntryWorkLine` has no `cycleId` column of
its own (only `payrollEntryId`/`siteId`/`unitId`) — every cycle-filtered query in this report
necessarily joins it to `PayrollEntry`, and for the two shapes that first select a large fraction of
one cycle's work lines (the unfiltered list and the `otHours`-sort query), the planner chose a `Seq
Scan on "PayrollEntryWorkLine"` rather than an index-driven access path. This is not a missing-index
finding: the table itself is small (30,000 rows total across all 3 seeded cycles, ~492 shared
buffers), the scan itself takes ~3ms of the total ~10–16ms query time, and it is hash-joined against
an already cycle-filtered ~10,000-row `PayrollEntry` set rather than driving the query — a
legitimate, fast, non-pathological plan for a table at this size, not a finding this report's own
assertions needed to rule out (mirroring every sibling report's own precedent of scoping its `Seq
Scan` assertion to `PayrollEntry`, the table actually carrying the filter predicate, not every joined
table). At 10,000-employee production scale (Principle 10), this table would still be a small
multiple of the `PayrollEntry` row count (the documented common case is one line per entry), so this
finding is not expected to change qualitatively — but no claim is made here beyond what this seed's
own evidence shows.

**Independent review addendum (2026-08-07, same day, before commit)**: an independent hostile review
found this checkpoint's original performance seeding never ran a plain `ANALYZE` after its bulk
`createMany` load, unlike a real production `PayrollEntry` table, whose statistics autovacuum keeps
continuously current. Confirmed by direct, repeated reproduction (not assumed): without real
statistics, Postgres's planner drove the site+unit-filtered list query from `PayrollEntryWorkLine`'s
own `unitId` index first, nested-looping back into `PayrollEntry` once per candidate work line
(3,000 iterations at this fixture's volume) rather than the far cheaper hash join real statistics
correctly favor — a genuine, deterministic (5/5 reproductions) 30–100× slowdown (measured 3.2s–11.1s
against a 3s bound, vs. ~5–130ms with real statistics), the one finding in this section that *is* a
defect, not an artifact of the test. **Fixed, test-only**: `overtime-report-performance.test.ts`'s
own seed now runs `ANALYZE "PayrollEntryWorkLine", "PayrollEntry", "Employee"` immediately after
seeding, before any assertion — matching the statistics a real production table already has by the
time anyone queries it, not an artificially favorable or unfavorable condition either way. No
application code changed; the existing indexes were already sufficient, the planner simply lacked
the statistics to choose correctly among them.

That same fix, by supplying the planner with real (rather than absent) statistics, also surfaced a
second, pre-existing fragility: the single-cycle, *no*-filter query's own `not Seq Scan on
"PayrollEntry"` assertion is not a reliable invariant at this fixture's own selectivity — `cycleId`
alone selects exactly 1-in-3 of this 3-cycle fixture (a real production table accumulates many more
cycles over its lifetime, so a single cycle's true selectivity is far lower there), and at 33%
selectivity Postgres's cost-based planner legitimately alternates between an `Index Scan` and a
`Parallel Seq Scan` run to run — both confirmed, by repeated measurement, to execute well within the
`ms < 3,000` bound (~1.0–1.3s on an `Index Scan`, ~180ms on a `Parallel Seq Scan` — the sequential
plan is not slower here). This was never a hidden defect in the *report*; it was an over-precise test
assertion asserting plan *shape* as a proxy for speed, when wall-clock time is the assertion that
actually matters and was already present alongside it. **Fixed, test-only**: that one test's `not
Seq Scan` assertion was removed (renamed to drop its now-inaccurate "not a sequential scan" claim),
replaced with a doc comment recording why, while its `EXPLAIN ANALYZE` output is still logged for
every run and its `ms < 3,000` timing assertion — the one that actually matters — is untouched.

Neither finding changes any of this section's other rows, which were re-verified unaffected (five
consecutive clean full-suite runs, 9/9 passing, after both fixes).

**19,999/20,000/20,001-row boundary, proven at real volume** (`backend/tests/
overtime-report-boundary.test.ts`, 6 tests, mirroring `deduction-report-boundary.test.ts`'s own
methodology — one cycle, 20,001 real `PayrollEntryWorkLine` rows split 19,999/1/1 across three
sites): `totalsComputed` is `true` at 19,999 (~2.8s) and exactly at 20,000 (~2.8s), `false` at
20,001 (~0.3s, the bounded pass skipped entirely); export succeeds (200, full row count) at 19,999
(~4.3s) and exactly at 20,000 (~5.3s), and is rejected with a structured 413 at 20,001 in ~0.1s,
before any row is fetched.

This sandbox's single-node local Postgres (via `embedded-postgres`) is not a production-scale cloud
database — these numbers are evidence of correct query-plan behavior and rough order of magnitude,
not a production SLA guarantee, the same caveat every prior report's own performance evidence states.

### 18.9 Tests

`backend/tests/overtime-report.test.ts` (54 tests) — authorization (401/403, `statements:view`-only
denied, Master Admin global access, site-scoped restriction, an explicit inaccessible-`siteIds`
filter rejected with 403, a genuine historical-transfer scenario proving `PayrollEntry.siteId`-based
authorization, a Unit belonging to an inaccessible Site rejected with 403), contracts (missing/
malformed/nonexistent `cycleId`, malformed `siteIds`, out-of-range `pageSize` rejected not clamped,
explicit rejection of `sortBy=effectiveOtRate`/`otEarned`, export ignoring `page`/`pageSize`
entirely, an unrecognized query parameter proven inert via a byte-for-byte baseline comparison),
**grain correctness** (a single-work-line entry produces exactly 1 row; a 2-work-line entry produces
exactly 2 rows, never collapsed; each row carries its own Unit-specific OT hours/rate, never
averaged or shared across lines; entry-level fields repeat identically across a multi-line entry's
own rows), overtime correctness (effective rate equals the stored `otRate` when set; derives as
`grossPay / cycleDays / 8` when null; a different `cycleDays` per line changes the derived rate
independently; zero OT hours produces zero OT earnings, not an absent field; a correction proven
never to replay into the original row's own OT figures; a full-body sweep proving no CNIC/banking/
Net Salary/Total Earnings ever appears), filters (`hasOvertime` at `Yes`/`No`/`All`, a Unit filter
narrowing within a multi-unit entry, Unit+`hasOvertime` AND-composition, the reused `hasCorrection`/
Site/Row Status filters), row status (all five states including on multi-line entries, one genuine
release through the real HTTP release endpoint transitioning every one of an entry's rows), sorting/
pagination (every approved field, database-level pagination across a mix of single- and multi-line
entries with zero cross-page overlap and a stable `id` tie-break), totals (complete-filtered-scope
independent of pagination, a multi-unit entry proven never to double-count in the entry-level totals,
the "with overtime" counts proven to only count the `otHours > 0` subset, status-breakdown counts
reflecting distinct entries, `NO_PAY_DUE`/`RECOVERY_DUE` entries counted in `matchingCount` but not
broken into their own bucket while remaining filterable, no "Average OT Rate" field anywhere), and
export (CSV/XLSX header vocabulary, one export row per matching work line — a multi-unit entry
contributing multiple export rows, a preflight-`COUNT`-before-work 413 smoke check, a dedicated
sensitive-field sweep across both formats). All 54 passing.

`backend/tests/overtime-report-performance.test.ts` (9 tests, §18.8's own evidence) — committed and
repeatable, not an uncommitted smoke test.

`backend/tests/overtime-report-boundary.test.ts` (6 tests, §18.8's own evidence) — the exact
19,999/20,000/20,001 boundary proven at real seeded volume, mirroring
`deduction-report-boundary.test.ts`'s own established pattern from day one (not added in a later
hardening pass, unlike Deduction Report's own M3).

Backend full suite: `typecheck`/`lint`/`build` clean across `shared`/`backend`. Targeted combined
`--runInBand` run of this report's own 3 files plus every sibling report and the shared row-status
module, on a freshly re-provisioned local Postgres (`overtime-report{,-performance,-boundary}.test.ts`,
`deduction-report.test.ts`, `employee-payroll-history.test.ts`, `project-site-payroll-report.test.ts`,
`payroll-entry-row-status.test.ts` — 250 tests) — **249/250 passing.** The one failure,
`employee-payroll-history.test.ts` › "Balances and settlement › automatic RECOVERY_DUE at release
creates a distinct origin path — not a Correction" (expects `201` from the real Unit-release
endpoint, receives `500`), sits entirely outside every file this checkpoint touches — **confirmed
pre-existing and unrelated to this checkpoint** by stashing every file this checkpoint added/changed
and reproducing the identical failure against clean, unmodified `main` on the same freshly-migrated
database. Along the way, repeated `npx jest` invocations run directly while diagnosing this also
independently reproduced `docs/SESSION_HANDOFF.md`'s own already-documented `roles.test.ts`
"second qualifying administrator" hazard (that test deactivates the real `MASTER_ADMIN` system role
mid-test and restores it in a later statement that never runs if an earlier partial invocation is
interrupted first, corrupting the shared role row for every later login in that same long-lived
database) — a pre-existing, previously-diagnosed test-isolation gap, not a new finding, resolved the
same documented way (drop/recreate the database, then run via a single uninterrupted invocation).
Neither finding touches any file this checkpoint added or changed.

**Independent review re-verification (2026-08-07, same day, before commit)**: re-ran this section's
own evidence independently, on a freshly re-provisioned local Postgres — `typecheck`/`lint`/`build`
clean across `shared`/`backend` (re-confirmed), the combined 4-file run above re-confirmed (217/217
passing across this report's own 3 files plus `deduction-report.test.ts`/
`project-site-payroll-report.test.ts`, `employee-payroll-history.test.ts`'s own pre-existing
"RECOVERY_DUE" failure independently reproduced in total isolation with none of this checkpoint's
files even loaded, confirming it is unrelated by construction, not merely by the earlier stash-based
check). Found and fixed the two test-only performance-evidence issues recorded in §18.8's own
addendum (a genuine stale-statistics bad-plan defect in the unit-filtered query, and an
over-precise plan-shape assertion on the single-cycle no-filter query); both `overtime-report.test.ts`
(54 tests) and `overtime-report-boundary.test.ts` (6 tests) were unaffected and re-passed unchanged.
`overtime-report-performance.test.ts` re-passed 9/9 across five consecutive full-suite runs after the
fix, up from a deterministic 8/9 before it (§18.8). No production code changed by this review — every
change is test-only, confined to `overtime-report-performance.test.ts`'s own seeding and one
assertion.

### 18.10 What Checkpoint 1A did NOT build

Per its own explicit scope boundary: no frontend route, page, filter UI, print, or CSV/XLSX download
button — the backend/export endpoints exist and are fully functional over HTTP, but nothing in the
frontend calls them yet (the Reports catalogue's existing placeholder entry, `available: false`, is
untouched). No detail endpoint (frozen decision 14). No schema or migration change (frozen decision
17, proven in §18.8). Dashboard and every other Phase 8A-catalogued report remain untouched and
**Not Started**.

**Known limitations, disclosed**: (1) the totals-latency characteristic already disclosed for every
sibling report applies identically here — an unfiltered, one-cycle request pays the full
`calcNet`-per-work-line cost on every request, not only exports; narrowing by site, unit, or
`hasOvertime` keeps it fast; (2) `effectiveOtRate`/`otEarned` remain unsortable in V1 (frozen
decision 13) — revisit only if real usage demonstrates the need; (3) "Average OT Rate" is not
implemented (frozen decision 10) — revisit only as an explicitly hours-weighted figure
(`totalOtEarnings ÷ totalOtHours`), never a naive per-row average, if a future checkpoint decides
it's needed; (4) saved filter presets and backend PDF remain out of scope, unchanged from every
sibling report.

**Checkpoint 1A is backend-only and awaiting independent review before Checkpoint 1B (frontend)
begins.** No other report or Dashboard work was started.

## 18.11 Checkpoint 1B — Frontend, Browser Print, and E2E (2026-08-07)

Frontend-only, over the frozen Checkpoint 1A backend above — no backend, shared-contract, or
database change in this checkpoint. Gated on `reports:view` throughout (route, catalogue card),
never `statements:view` — the same approved frozen decision above. No detail page was added (frozen
decision 14) and no other report or Dashboard work was started.

**Report grain, restated for the frontend layer** — one table row = one `PayrollEntryWorkLine`,
never one `PayrollEntry` (the one behavior genuinely unique to this report among its Checkpoint-1B
siblings, all of which are `PayrollEntry`-grain). An employee with 2 work lines this cycle
legitimately renders as 2 table rows, keyed on `row.workLineId` (never `payrollEntryId`, which two
rows can share) — the page never merges, groups, or deduplicates those rows by employee, and Unit is
a direct, single field on every row rather than a "primary unit + N more" collapse the way Deduction
Report/Project Site Payroll Report's own multi-line entries summarize. Because the same employee
name/code can legitimately repeat across adjacent rows, the Unit column renders as a solid blue
`Badge` rather than plain text — the one intentional visual departure from every sibling report's
identical column styling, specifically so a duplicate employee name is never mistaken for duplicate
data at a glance.

**Route** (`/reports/overtime-report`, plus the canonical `/payroll-cycles/:cycleId/reports/
overtime-report`), lazy-loaded and `RequirePermission`-gated on `PERMISSIONS.REPORTS_VIEW`, following
the exact `RequireSession` → `RequirePermission` → page pattern every other gated route already uses
(`App.tsx`). Mirrors Deduction Report's own dual flat/canonical route pair and
`useSelectedPayrollCycle` hook — the established precedent for "exactly one required Cycle, no
From/To range." No detail route exists. The Reports catalogue card (`reports-page.tsx`) needs no
`requiredPermission` override — it reuses the catalogue page's own `reports:view` gate directly,
matching Project Site Payroll Report/Deduction Report's own identical treatment rather than Employee
Payroll History's `statements:view` override. AppShell title "Overtime Report", subtitle "Operational
overtime analysis by employee, site, and unit for one payroll cycle." — deliberately worded to avoid
implying any cross-cycle trend.

**Data layer** (`hooks/use-overtime-report.ts`) — imports the DTOs directly from `@payroll/shared`
(`shared/src/schemas/overtime-report.ts`), mirroring `use-deduction-report.ts`'s own convention. One
query hook for the list (`enabled: Boolean(cycleId)`, proven by a direct hook-level "no request
without a Cycle" suite exercising the real `useQuery` configuration through
`renderHook`/`QueryClientProvider` with `global.fetch` stubbed, not merely a code comment, plus an
additional test proving a sort/filter change issues exactly one new request and a same-params
re-render issues no redundant one), and a blob-download export function covering both CSV and XLSX.
Site ids are sorted before being joined into both the query key and the URL. The export function
handles the structured 413 `EXPORT_ROW_LIMIT_EXCEEDED` response the same way every sibling report
does — a dedicated `OvertimeReportExportRowLimitExceededError` (independently declared, matching this
project's "extract at the third consumer" convention already applied to the backend's own ceiling
constant) carries the backend's `matchingCount`/`maxRows`/`message` verbatim via `toast.error`.

**Filters** (frozen decisions/Step 5's approved set only): Payroll Cycle (`PayrollCycleSelectField`,
required, single, navigates the URL — a navigation control, not a filter, per §2.6 of
`docs/design-system.md`), Site (multi-select), Unit (disabled unless exactly one Site is selected —
the same established convention every sibling report's own Unit field uses, cleared whenever the Site
selection becomes incompatible, and never cleared on an unrelated rerender), Row Status, Has
Correction (the tri-state All/Yes/No select, §2.4 of `docs/design-system.md`), and Has Overtime (the
one report-specific tri-state — `otHours > 0` on the row's own work line). No Employee search,
Designation, OT Hours/Rate/Earnings range, date/cycle range, or roster status filter — matching the
backend's own deliberate exclusions. A filter or sort change resets pagination to page 1; Clear
Filters restores every filter to its default and resets the page while never touching the currently
selected Cycle.

**Totals** — the backend's `OvertimeReportTotals` fields render verbatim in three labeled groups:
**Overtime** (Total OT Hours, Total OT Earnings — both collapse into one explanatory notice, "Totals
are unavailable for this result size. Narrow the filters to calculate totals.", when `totalsComputed`
is `false`, since the backend deliberately gates them together — §18's own "one unified bounded
strategy, not a second SQL financial formula" precedent), **Coverage** (Matching Work Lines — a plain
DB aggregate, always exact regardless of `totalsComputed` — plus Employees/Sites/Units With Overtime,
each individually gated to a dash, `—`, never a misleading zero, when `totalsComputed` is `false`,
since these three are also bounded), and **Status** (Released, Held, Pending, Corrected Entries — all
four plain DB aggregates over distinct entries, always exact and always visible, never recomputed
from the currently-visible work-line rows — an entry with 2 OT-matching work lines still counts as 1
released/held/pending entry, proven directly in both the Vitest and Playwright suites). No "Average OT
Rate" anywhere (frozen decision — deliberately not implemented). No client-side summation, and no
`calcNet` import, anywhere in this page.

**Table** — server-paginated (`ReportPagination`), server-sorted only on the six backend-approved
fields (`employeeCode`/`employeeName`/`site`/`unit`/`otHours`/`rowStatus`; Designation, Effective OT
Rate, OT Earnings, Gross Pay, and Has Correction render as plain, non-interactive header cells with no
sort button at all, proven by a dedicated test); clicking a sortable header toggles `sortBy`/`sortDir`,
always resets to page 1, and reflects `aria-sort` on the active column. Every row status
(`RELEASED`/`HELD`/`NO_PAY_DUE`/`RECOVERY_DUE`/`PENDING`) gets its own badge tone (green/hold/gray/
red/amber respectively) via a new, colocated `overtime-report-labels.ts` — never derived
client-side, mirroring every sibling report's identical tone mapping. Columns, in the exact order the
authorizing instruction specified: Employee Code, Employee Name, Project Site, Unit, Designation, OT
Hours, Effective OT Rate, OT Earnings, Gross Pay, Row Status, Has Correction (11 total — the smallest
column count of any report in this module so far). OT Hours renders via the shared `formatNumber`
utility (never `formatMoney`); Effective OT Rate/OT Earnings/Gross Pay render via `formatMoney`; Has
Correction renders as a plain "Yes"/"No" text cell (a boolean presence flag, not a count — unlike
Deduction Report's `correctionCount` badge). No edit action, no "View Details" action, and no row
click. The same page-clamp safeguard Project Site Payroll Report's/Deduction Report's own Checkpoint
1B work already established is included here from the start: a `useEffect` keyed on the resolved
`report.data` clamps `page` down to the new last valid page whenever the currently-viewed page is no
longer valid for the backend's current total under an otherwise unchanged filter set, never fires
below page 1, never fires before a real response exists, and self-terminates after one corrective
`setPage`.

**Export UI** — Export CSV/Export Excel buttons, page-level `activeExport` state (mutually exclusive
across both formats), current Cycle/filters/sort always applied, never just the current page; the
export endpoint accepts no `page`/`pageSize` at all, proven by a request-parity test comparing two
sequential CSV/XLSX calls' actual arguments. A 413 is shown via the backend's own structured message
through `toast.error`, and the current filter selection is left completely untouched by an export
failure. A real Playwright download proves the CSV contains two separate rows for a genuine two-work-
line employee (the export mirrors the on-screen grain, never collapsing to one row per employee).

**Browser Print (current-page-only scope)** — a dedicated `OvertimeReportPrintOptionsDialog`/
`overtime-report-print-fields.ts`, a fresh field vocabulary (never a reuse of any sibling report's own
field-id types — this report's own totals/table are a different shape from all of them). States
"Print scope: current page only" inside the dialog itself. Prints the current paginated page only —
never an unbounded fetch of the full filtered result, and never routed through backend Puppeteer (no
backend PDF for this report, matching every sibling). Defaults to every safe card/column selected (10
cards, 11 columns; Employee Name locked as the one always-included column); readability thresholds
(Excellent 0–4 / Good 5–7 / Wide 8–9 / Very Wide 10+) are scaled down from Employee Payroll History's
own 13-column-scaled thresholds to fit this report's own smaller 11-column maximum — informational
only, never blocking; the one hard block remains "select at least one column besides Employee Name."
The selection persists in browser `localStorage` only, under its own versioned key
(`overtime-report-print-fields:v1`), never PostgreSQL; Reset to Default restores the same complete
safe-field selection Select All produces. No CNIC, no banking, no release actor, no correction reason,
no Net Salary, no Total Earnings is ever offered as a print field. When totals are unavailable, the
print-only cards render the same explanatory notice the on-screen cards show, never zeros. A real
Playwright print-media-emulated check confirms the printed body text states the report title, every
applied filter summary (including Has Overtime), a generated timestamp, and "Current page only," and
confirms no export/download request is ever fired merely by opening or confirming Print.

**Tests**: 4 new colocated Vitest files plus 2 new tests in the existing catalogue test —
`use-overtime-report.test.ts` (21 tests: URL builders including deterministic Site-id ordering and
both tri-state query params, the 413/`OvertimeReportExportRowLimitExceededError` path, object-URL
revocation, filename fallback, a direct hook-level "no request without a Cycle" suite, and a
stable-query-key test proving one request per genuine change and zero redundant ones on an
unchanged re-render), `overtime-report-labels.test.ts` (2 tests), `overtime-report-print-fields.test.ts`
(19 tests: sensitive-field-exclusion sweep, an explicit "Average OT Rate never offered" check,
readability levels scaled to this report's own 11-column maximum, `localStorage` round-trip under this
report's own versioned key, defensive-parse behavior), `reports-overtime-report-page.test.tsx` (69
tests: RBAC including "no View Details action ever renders" and "no row click ever navigates," the
missing-Cycle state, loading/empty/error states distinguishing "no entries for this cycle" from "no
match for filters," totals including the three-group layout, the `totalsComputed: false` notice with
Total OT Earnings/Hours and the three individually-dashed Coverage cards, an explicit proof that
entry-level Status counts are never recomputed from visible work-line rows, every approved table
column with a full-body sensitive-field sweep and an explicit assertion that Net Salary/Total Earnings
never appear, the Yes/No Has Correction text cell, every row-status badge, a dedicated **WorkLine
grain** suite (one employee/two work lines renders exactly two rows never merged, each row's own
correct Unit, independently-preserved OT Hours/Effective OT Rate/OT Earnings across both rows,
entry-level fields repeating identically across both rows, and a table-body-row-count proof against
accidental client-side deduplication), sorting resetting page to 1 with `aria-sort` reflected and an
explicit proof that Designation/Effective OT Rate/OT Earnings/Gross Pay/Has Correction expose no sort
button, pagination using server metadata only including the page-clamp-on-shrunk-total safeguard,
every filter including both tri-states and the Site-count-gated Unit disable/clear behavior, Clear
Filters preserving the selected Cycle, export request shape and duplicate-click prevention, the 413
path, and Print defaults/persistence/readability/no-CNIC-or-banking-or-correction-reason-ever) — plus
2 new tests in the existing `reports-page.test.tsx` for the catalogue card's own permission-free
(reuses `reports:view` alone) gating. **111 new frontend tests, all passing (109 in the 4 new files —
21 hook, 2 labels, 19 print-fields, 69 page — 2 added to the existing catalogue test); full frontend
suite 689/689.** `typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend`,
`typecheck:e2e` clean, `git diff --check` clean.

**Playwright**: `tests/e2e/specs/22-overtime-report.spec.ts` (10 tests) — real backend, real Chromium,
no `page.route` interception for any RBAC or financial assertion. Covers: Master User navigation
(Reports catalogue → Overtime Report → Cycle/Site filter → totals → sorting → pagination), Site
scoping and historical transfer (a Site-A-scoped user sees only their accessible historical row, a
live employee transfer to Site B leaves the already-created entry visible under its frozen historical
Site A, Site B is never offered as a filter option, a direct API call naming the inaccessible Site
403s, and no cross-site leak from an unrelated Site-B-only employee), Unit filter and Has Overtime (a
Unit filter narrows to exactly one Unit's row within a shared Site, and Has Overtime distinguishes a
worked-OT row from a genuine zero-OT row), a dedicated **Multi-unit work-line grain** test — the
spec's own most important coverage — proving a real employee with two real work lines (two different
Units, two different explicit OT rates, against the real backend) renders as two real table rows, each
with its own correct Unit and its own independently-correct OT Hours/Effective OT Rate/OT Earnings
(4h@120=480 vs. 9h@200=1,800), while the Matching Work Lines/Total OT Hours totals reflect both work
lines and the Pending status count still reflects the one underlying entry, Row statuses (Held via the
Hold toggle, No Pay Due via a zero-gross/EOBI-inapplicable/zero-day entry, Recovery Due via the
zero-worked-days/positive-gross entry, Released via a full month of worked days plus OT, Pending via a
genuine "Late Entry," plus the Row Status filter itself narrowing to the same value), Corrections (a
real approved correction leaves the row's own OT Hours/OT Earnings provably unchanged from their
pre-correction values, shows Has Correction: Yes, and never surfaces the correction's own reason text
anywhere on the page), Export (CSV downloaded and its contents verified — safe headers present, both
work-line rows of a multi-unit employee retained as two separate CSV rows, CNIC/IBAN/account-number/Net
Salary/Total Earnings absent from the CSV content itself; XLSX download/action/filename verified by
this spec — XLSX content/header/security parity is already covered by the backend's own Overtime
Report export tests, Checkpoint 1A §18.9 above), Print (current-page-only wording, Print
Options defaults, Very Wide readability warning at the full 11-column default, browser print invoked,
zero export requests fired), a Responsive layout check (1024×800 viewport: no document-level
horizontal scroll per the same invariant `06-ui-regression.spec.ts` already establishes for the app
shell, every filter field remains individually visible, and the Unit column header remains visible),
and Permission enforcement (`statements:view` alone: catalogue card and nav link absent, direct
navigation shows "You do not have permission to access this page."; `reports:view`: full access).
**10/10 passing standalone, 9/9 for `17-reports.spec.ts` standalone (unaffected), 19/19 combined.**

**Request-count/performance observations** (measured during this checkpoint's own manual and
Playwright verification, not a production SLA): the list fetch always requested exactly one page
(`pageSize=25`), a filter/sort/pagination change each produced exactly one new list request with no
duplicate/storm, multi-select Site state produced no request per checkbox toggle, export produced
exactly one request with no page/pageSize parameter, and print used the already-loaded page data with
zero additional fetches (directly proven via a request-listener assertion in the Playwright Print
test, not just inferred from absence of a spinner). No detail request of any kind — no detail endpoint
exists for this report to call.

**Known limitations, disclosed**: (1) every Checkpoint 1A backend limitation (§18.10 above) is
inherited unchanged — this checkpoint touches no backend code; (2) saved filter presets remain
deferred (unchanged from every sibling report); (3) backend PDF remains intentionally excluded from
this report (unchanged from every sibling report); (4) the Unit badge (blue tone) is this report's own
one deliberate visual departure from the shared plain-text column convention every sibling report
uses for a non-status field — a documented, intentional choice (see the grain note above), not an
inconsistency to reconcile later.

**Architecture deviations from the authorizing instruction**: none identified. Every frozen backend/
product decision, filter, column, total, sort field, export/print rule, and test requirement in the
authorizing instruction was implemented as specified.

**Overtime Report is now fully complete pending review** (Checkpoints 0, 1A, 1B). The remaining
reports (Advance Recovery Report, Salary Release Report, Variance/Month-on-Month Report) and Dashboard
each remain **Not Started** and require their own separate, explicit authorization — this checkpoint
did not begin any of them. This checkpoint was not committed or pushed — it awaits independent review
before any commit.
