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

**Status:** **Phase 8B Checkpoint 1 is complete** — the Reports foundation (permission reuse, a
minimal server-side pagination utility) and the Payroll Summary Report (backend + frontend, CSV/XLSX
export, browser print) are built and verified. The remaining Phase 8A-investigated report catalogue
(Employee Payroll History, Project Site Payroll Report, Deduction Report, Overtime Report, Advance
Recovery Report, Salary Release Report, Variance/Month-on-Month Report) and Dashboard are all **Not
Started**, each requiring its own separate authorization. See `docs/PROJECT_PROGRESS.md`'s "Phase 8A
— Reports Module Investigation" and "Phase 8B Checkpoint 1" entries for the full build record.

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
