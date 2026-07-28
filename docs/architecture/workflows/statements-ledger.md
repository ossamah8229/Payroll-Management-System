# Employee Statement of Account — Canonical Ledger Architecture

**Owner module(s):** Statements

**Contains:** The canonical Statement-of-Account ledger model — event kinds, the sign convention,
the informational-vs-financial-movement invariant, deterministic ordering, historical-site RBAC, and
how it incorporates Negative Payroll Recovery and Corrections/Balance Adjustments.

**Sections:** no §-numbered content of its own (a prose workflow narrative, matching
`corrections-and-balance-adjustments.md`'s own convention) — this module introduces no new table, so
it has no entry in `database/README.md`'s §-numbered schema index. For the entities it *reads*, see
`database/payroll-entry.md §12`, `database/release.md §12b/§12c`, `database/corrections.md §13/§13a`,
`database/balance-adjustments.md §14–§14b`, and `database/advances.md §15/§15a`.

**Status:** **PHASE 7A IS COMPLETE (2026-07-28)** — reviewed, approved, committed, pushed, and
deployed. The backend ledger (`backend/src/modules/statements/`, Checkpoint 1), including its
gap-closure pass (§7's own extension plus §12–§13 below: bounded-range opening-balance proof,
sensitive-document HTTP/audit behavior, and explicit Advance-history scope metadata); the
Statements frontend page (`frontend/src/routes/statements-page.tsx`, Checkpoint 2); and Checkpoint
2's own same-day correction — historical `PayrollEntry.siteId`/`PayrollEntryWorkLine.unitId`
employee discovery, Employee-first selection, and a naturally-reachable Advance-history
restriction workflow (§16) — are all closed. Print/export (Phase 7B), Reports (Phase 7C), and
Dashboard (Phase 7D) are all still Not Started, each requiring its own separate authorization —
see `docs/PROJECT_PROGRESS.md`'s "Phase 7A, Checkpoint 1", "Phase 7A Checkpoint 2 — architectural
investigation and correction", and "Phase 7A — closure and landing" entries for the full build
record.

---

## 1. What this module is, and isn't

Statements is a **purely derived, read-only aggregation** over data four other modules already own —
`PayrollEntry` (Payroll Entry/Payroll Processing/Release Salary), `Correction`/`CorrectionRequest`
(Corrections), `BalanceAdjustment`/`BalanceAdjustmentSettlement`/`CorrectionPayment` (Balance
Adjustments), and `Advance`/`AdvanceScheduleChange` (Advances). It introduces **no new table**, no
schema change, and no accounting event of its own — every financial mutation happens exclusively in
the module that already owns it (Principle 1, Principle 9). Reading a Statement can never write to
any of the tables it reads.

## 2. The three independent balances

A Statement exposes exactly three running balances, **never combined into one synthetic figure**:

| Balance | Meaning | Source of truth |
|---|---|---|
| `payableOutstanding` — **"Payable to Employee"** | The company currently owes the employee this much, not yet paid | `SUM(BalanceAdjustment.remainingAmount WHERE type = PAYABLE)` |
| `recoveryOutstanding` — **"Recoverable from Employee"** | The employee currently owes the company this much, not yet recovered | `SUM(BalanceAdjustment.remainingAmount WHERE type = RECOVERY)` (both Correction-originated and negative-payroll-originated rows) |
| `advanceOutstanding` | The employee's outstanding Loan/Eid-Advance principal | `SUM(Advance.outstandingBalance)`, across every advance the employee has ever held |

**Why not one net figure:** these are three different kinds of obligation (an ordinary correction
debt, a salary-recovery debt, and a separately-disbursed loan) with different origins, different
settlement mechanisms, and different business meaning. Netting them into one number would actively
mislead a payroll user about which specific obligation is outstanding and why (approved architecture
decision — see `docs/PROJECT_PROGRESS.md`'s Phase 7 architecture-report entry). Terminology is
**"Payable to Employee" / "Recoverable from Employee"**, never raw accounting Debit/Credit — Debit/
Credit sign flips depending on whose books you're reading, a real, repeated source of confusion for
non-accountant payroll staff; this codebase's own Corrections UI already avoids the jargon
(`balanceAdjustmentTypeLabel` → "Payable"/"Recovery"), and the Statement ledger reuses that exact
vocabulary rather than inventing new terms.

## 3. The hard invariant: informational vs. financial movement

Every ledger entry (`StatementLedgerEntry`, `backend/src/modules/statements/statements.types.ts`)
carries a structural `kind` and an `isInformational` flag. **An informational entry's `movement` is
always `null` — enforced by construction in `statements.service.ts`, never left to convention.**
Only a genuine financial-obligation event may move a balance:

| Event | Movement |
|---|---|
| Net Salary Paid (`released = true`) | **None** — historical payment fact; the money already left, nothing is "outstanding" as a result |
| `NO_PAY_DUE` | **None** — must never look like a payment; no amount is ever attached to this row |
| `RECOVERY_DUE` (negative payroll) | **None on the cycle row itself** — the movement is carried entirely by the paired `BalanceAdjustment(type: RECOVERY, originPayrollEntryId: ...)` creation row, never a second, independent representation |
| Correction approved | **None** — informational only (field/old/new/reason); its *resulting* `BalanceAdjustment` is the financial event, always a separate ledger row |
| `BalanceAdjustment` created (`PAYABLE`/`RECOVERY`) | Payable/Recoverable **increases** |
| `BalanceAdjustmentSettlement` applied | Payable/Recoverable **decreases**, by exactly the settled cycle's applied amount |
| `CorrectionPayment` (standalone) | Payable **decreases** |
| Advance given | Advance **increases** |
| Advance deduction (Draft-reserved or Released-final) | Advance **decreases** |
| Advance deferred / cancelled | **None on the marker itself** — the underlying deduction *reversal* (if a live Draft deduction existed) is what genuinely moves the balance, and it does so structurally (see §6) |
| Advance paid off | **None** — the balance already reached zero at reservation; this is a status confirmation only |

A salary payment being *displayed* never implies a Payable balance was created merely because the
Statement shows the amount — this is the concrete rule that closes the risk the checkpoint brief
specifically called out.

## 4. Advances — a genuinely separate sub-ledger

`advanceOutstanding` is never mixed into `payableOutstanding`/`recoveryOutstanding`. An Advance is
disbursed *outside* payroll (no `PayrollEntry` event occurs at `dateGiven`) and recovered *through*
payroll deductions that already reduce `netSalary` — conflating "what the company owes the employee
in salary" with "what the employee owes the company on a loan" would be actively misleading.

The `ACTIVE → RESERVED → PAID_OFF`/`CANCELLED` lifecycle is respected exactly:

- A **`RESERVED`** deduction (the balance hit zero on a still-Draft `PayrollEntry`) is **pending and
  reversible** — rendered as `ADVANCE_DEDUCTION_RESERVED`, explicitly labeled "reserved, pending
  release — reversible," never presented as a final recovered amount.
- Only the entry's actual **Release** flips it to `ADVANCE_DEDUCTION_FINAL` — the canonical
  release/finalization lifecycle (`settleAdvancesForReleasedEntries`) is the sole determinant of
  finality, never inferred by the Statement itself.
- Deduction events are derived structurally from **whichever `PayrollEntry` row currently links the
  Advance with a non-zero deduction** — not from a synthetic history table. A deduction later
  deferred/cancelled/edited away before ever releasing has already had its linking FK/amount reset to
  null/zero on that same row (the reversal paths in `advances.service.ts`), so it correctly produces
  **no** ledger event at all; a *released* deduction is immutable (Principle 9) and therefore always
  structurally present, however many cycles ago it happened. This is also what makes the
  reconciliation invariant provable: replaying every Given (+) and every currently-linked deduction
  (−) always converges exactly to the live `Advance.outstandingBalance` value (verified by test P).

**Documented discrepancy, deliberately not "fixed" here**: `Advance` has no `cancelledAt`/
`cancellationReason` column — the cancellation reason lives only in `AuditLog` metadata, which this
module deliberately does not query (accounting meaning must be structural, per the checkpoint's own
brief; `AuditLog` is a secondary/debug source, never the ledger's primary read path). A cancelled
Advance with nothing live to reverse also does **not** have its `outstandingBalance` zeroed by the
canonical Advances module itself — the Statement faithfully mirrors this (test J asserts the ledger's
`advanceOutstanding` matches the live, possibly-nonzero, canonical value exactly), rather than
inventing a write-off adjustment Phase 7 has no authority to make.

## 5. Corrections / Balance Adjustments

The Correction itself (`Correction.field`/`.oldValue`/`.newValue`/`.reason`) is always an
**informational** row — never merged with its resulting `BalanceAdjustment` into one accounting
movement, per the frozen `corrections-and-balance-adjustments.md` rule ("shows the Correction and its
resulting Balance Adjustment as fully separate ledger entries"). `Correction.oldValue` is the
*reconstructed current-effective* value (replaying every prior approved correction to that field),
not necessarily the original `PayrollEntry` value — the Statement displays exactly what's stored,
never re-derives it.

An installment `RECOVERY`'s settlement history is shown per-cycle, one `BalanceAdjustmentSettlement`
row per cycle it actually applied in — never one opaque total — with a "remaining after" figure
computed locally from that adjustment's own chronological settlement sequence.

**Known discrepancy, recorded per the approved instruction not to expand this checkpoint into fixing
it:** the frozen `corrections-and-balance-adjustments.md` workflow doc describes two behaviors as
already decided/implemented that the real code does **not** have:

1. An `IMMEDIATE PAYABLE` automatically folding into an employee's already-open `PayrollEntry`, or
   creating a standalone `CorrectionPayment` if none exists. **Not implemented.** The only real path
   to settle an `IMMEDIATE PAYABLE` is the *manual* `recordCorrectionPayment` (`POST /balance-
   adjustments/:id/payments`) or `recordBalanceAdjustmentSettlement` action — `determineMaterialization`
   (`corrections.materialization.ts`) explicitly rejects `PAYABLE` unless `paymentTiming = DEFERRED`.
2. A Master User "correcting directly," bypassing `CorrectionRequest` entirely. **Not implemented at
   all** — only `CorrectionRequest → approve` exists (`corrections.service.ts`'s own module comment
   confirms this was deliberately deferred, not silently dropped).

This checkpoint's ledger and its tests are built against the **real** behavior (manual settlement,
request-then-approve) — never the aspirational doc description. Closing this doc/code gap, if wanted,
is separate follow-up work, not part of Phase 7.

## 6. Negative Payroll Recovery

`PAID` / `NO_PAY_DUE` / `RECOVERY_DUE` (`database/release.md §12c`) are fully incorporated:

- A negative `netSalary` is **never** rendered as a negative payment — `NO_PAY_DUE` carries no amount
  at all; `RECOVERY_DUE` is represented exclusively through its canonical
  `BalanceAdjustment(type: RECOVERY, originPayrollEntryId: <entry>)` row.
- The three-case carried-forward recovery accounting (`computeReleaseRecoveryAdjustment`,
  `corrections.materialization.ts`) is read faithfully: a partial absorption settles only what a
  later cycle can actually afford (no new adjustment for the shortfall); an exact-zero boundary
  settles in full as `NO_PAY_DUE`, never a fresh `RECOVERY_DUE`; and a genuinely new, independent
  shortfall alongside an unaffordable old recovery creates a **second**, distinct `BalanceAdjustment`
  — never merged with the first. All three cases are covered end to end
  (`backend/tests/statements.test.ts`'s D1/D2/D3, reusing the exact fixture technique already proven
  in `payroll-release-recovery-accounting.test.ts`).

### Legacy negative-payroll anomaly

The three known historical `released = true` `PayrollEntry` rows with a negative net salary (found
during the 2026-07-27 production preflight, predating the Negative Payroll Recovery architecture)
render as a `CYCLE_LEGACY_NEGATIVE_ANOMALY` — an inert, informational-only row, **no movement, no new
`BalanceAdjustment`, no mutation**. This state can never be newly produced by current code
(`releaseProjectUnit` only ever sets `released = true` for `netSalary > 0`) — the Statement detects it
purely by re-checking `released && netSalary <= 0` at read time via the same canonical
`computeEntryCalc`/`calcNet` every other module uses, never a special-cased lookup by employee
identity. Verified by test N: zero new `BalanceAdjustment` rows, and the underlying `PayrollEntry`'s
`version`/`updatedAt` are provably unchanged by the read.

## 7. Historical-site RBAC

**Historical `PayrollEntry.siteId`, never live `Employee.siteId`.** Each `PayrollEntry`-derived
informational row, and every `Correction`/`BalanceAdjustment`/`BalanceAdjustmentSettlement`/
`CorrectionPayment` row (scoped by its own origin entry's `siteId`), is independently filtered by
whether *that entry's own* `siteId` is in the caller's accessible site set
(`getAccessibleSiteIds`/`assertSiteAccess`, `backend/src/common/authz-policy.ts`) — never gated by the
employee's current site. An employee transfer therefore behaves correctly in both directions:

- A site-scoped user who administered the employee's **old** site keeps seeing that slice of history
  even after the employee transfers to a site the user doesn't administer.
- A user who now administers the employee's **new** site never gains retroactive visibility into
  history from a site they were never assigned to.

Verified end to end (test K/L/M): an employee transferred from Site A to Site B mid-history; a
Site-A-only user sees Site A's cycle outcome plus the *entire* Balance Adjustment lifecycle (it
originated at Site A, even though it later settled during a Site-B cycle's release) but not Site B's
own cycle outcome; a Site-B-only user sees the reverse; a user with access to neither site gets a
`404` (revealing nothing, matching Payslips' own "don't confirm existence" precedent); Master Admin
sees everything.

**The Advances sub-ledger has no historical per-site attribution anywhere in this schema** — an
`Advance` references only an `Employee`, never a `PayrollEntry`/`ProjectSite` at creation — so it is
gated as one all-or-nothing unit by the employee's **current** site, deliberately matching the
existing Advances module's own established convention (`advances.service.ts`'s
`assertSiteAccess(currentUser, employee.siteId)`), not a new invention.

Creator-ownership (`docs/architecture/rbac-creator-access.md`) has no relevance here — a Statement is
Class-D financial/workflow data; any `createdBy`-style column on an underlying row is audit provenance
only, never an access filter.

### 7a. Advance-history scope metadata — the exclusion must never be silent (gap-closure, 2026-07-27)

The all-or-nothing Advance exclusion above is a real, deliberate, security-correct limitation — but a
caller (and, eventually, the frontend) must be able to tell "this employee genuinely has no Advance
history" apart from "Advance history exists or may exist, but this requester's current-site access
doesn't cover it." Silently returning an empty Advance sub-ledger in both cases would blur that
distinction. `EmployeeStatement.scope` (`StatementScope`, `statements.types.ts`) makes it explicit:

```
scope: {
  advanceHistoryIncluded: boolean;
  advanceHistoryRestriction?: 'CURRENT_SITE_OUT_OF_SCOPE';
}
```

- `{ advanceHistoryIncluded: true }` — the caller has the employee's current site in scope (or is
  Master Admin); `entries`/`closingBalances.advanceOutstanding` genuinely reflect this employee's
  complete Advance history, whatever it is (including zero).
- `{ advanceHistoryIncluded: false, advanceHistoryRestriction: 'CURRENT_SITE_OUT_OF_SCOPE' }` — the
  Advance sub-ledger was excluded for the reason above.

**Deliberately carries no count, amount, or any other detail about whatever is actually hidden** —
even *how many* Advances exist behind the restriction is information a site-scoped caller isn't
entitled to; the flag alone is enough for a future UI to render "Advance history: restricted to your
assigned sites" instead of a misleading "no advances." Master Admin (and any future caller with
unrestricted site authority) always receives `advanceHistoryIncluded: true`. Verified by three tests
(A/B/C): a user with only the employee's *old* site still sees the allowed historical salary rows but
gets the restriction flag and zero `ADVANCE_*` entries; a user with the employee's *current* site sees
`advanceHistoryIncluded: true` and the real Advance history; Master Admin always sees the latter
regardless of site assignment.

## 8. Deterministic ordering

Multiple events in the same calendar period are sorted by, in order: (1) `periodKey`
(`year * 12 + month`) — a cycle's own period for cycle-attributed events, or the event's own *natural
period anchor* for the few kinds with none (§9); (2) a fixed, documented `kindPriority` lookup (cycle
outcome → its Correction → the resulting Balance Adjustment → that period's Advance deduction → the
Advance payoff confirmation → a settlement applied that period → standalone/schedule-change/
cancellation events); (3) the row's own natural timestamp, for full stability within the same period
and kind; (4) the row's own id, lexicographically, as the final always-available tie-break. This does
not claim to be the *only* correct causal order — only a fixed, documented, testable one. It has no
bearing on closing-balance correctness either way (a sum is commutative); it only determines which
intermediate per-row running balance is shown. Verified by test O: repeated calls produce byte-
identical ordering, and `sequence` is strictly increasing across the whole assembled ledger.

## 9. Period anchoring for non-cycle-attributed events

Three event kinds have no `PayrollCycle` of their own but still need a `periodKey` for range-bounding
and ordering — each is anchored to its own most meaningful **period**, not the raw real-world action
timestamp (which could be arbitrarily later than the period the event is actually "about," and, in a
bounded-range query, could fall outside the requested window purely by clock coincidence):

- **`ADVANCE_SCHEDULE_CHANGED`** (a deferral) — anchored to `AdvanceScheduleChange.fromPeriod`, the
  period the deduction was actually removed *from*.
- **`ADVANCE_CANCELLED`** — anchored to `Advance.originalScheduledPeriodId`, the one period anchor an
  Advance always retains (`currentScheduledPeriodId` is cleared to null on both `PAID_OFF` and
  `CANCELLED`).
- **`CORRECTION_PAYMENT`** (standalone) — anchored to the settling `BalanceAdjustment`'s own
  `sourceCycle`, the same period its creation event uses. This is a deliberate choice, not an
  approximation: a `CorrectionPayment` only ever exists for an `IMMEDIATE PAYABLE` (paid out promptly
  by definition — see §5's discrepancy note on what "immediate" actually means in the real code), so
  its natural period identity is "when the obligation arose."

`Advance Given` is the one exception that needs no such anchor — `Advance.dateGiven` is already the
correct, staff-entered period for it.

## 10. Query architecture and performance

Every request is scoped to **one employee**. The service always fetches that employee's *full*
history across all four source tables (unbounded by the requested display range) via four
`Promise.all`-batched queries — never one query per event — and computes every running balance via a
single, deterministic, full-history replay; only the **output** is then sliced to the requested
cycle window. This is the only way to produce a correct Opening Balance for a bounded window without
a second, separate "balance as of date X" implementation that could drift from the replay (the same
reasoning a real bank statement's own opening-balance line requires). This is safe and cheap
specifically because it is per-employee, not company-wide: a few dozen cycles and a handful of
corrections/advances even over a long tenure, never proportional to the 10,000-employee design floor
Principle 10 is actually concerned with. If a genuinely long-tenured employee's full-history fetch
ever becomes a measured bottleneck, an incremental "opening balance from a precomputed checkpoint"
optimization is the natural next step — not built ahead of that need (Principle 4).

No index was added for this checkpoint — every source table's existing index already covers a
single-employee scan efficiently (`PayrollEntry.employeeId`, `Correction`'s
`(payrollEntryId, field, approvedAt)`, `BalanceAdjustment.employeeId`, `Advance.employeeId`), and the
one genuinely new query shape this module introduces (per-employee, across every cycle) was load-
tested via the real end-to-end test suite without needing one.

## 12. Proof: bounded-range opening balances are a full-history replay (gap-closure, 2026-07-27)

§10's claim — that a requested range's `openingBalances` correctly reflects obligations created
*before* the range, not merely whatever the range's own rows happen to contain — is now backed by a
dedicated regression test (`statements.test.ts`'s Q1/Q2), specifically to guard against a future
"optimize by only querying the visible range" regression:

- **Q1 (Payable/Recovery):** a `PAYABLE` of 1000 created in cycle 1, partially settled by 400 in
  cycle 2, and a *separate* `RECOVERY` of 250 created in cycle 3. Requesting the Statement scoped to
  cycle 3 alone returns `openingBalances = { payableOutstanding: '600.00', recoveryOutstanding:
  '0.00' }` (the state immediately before cycle 3, correctly netting cycles 1–2 even though neither
  cycle appears in `entries`) and `closingBalances = { payableOutstanding: '600.00',
  recoveryOutstanding: '250.00' }` after applying cycle 3's own event.
- **Q2 (Advance):** an Advance given during cycle 1, deliberately scheduled to deduct well beyond the
  fixture's own cycles (so it never materializes), still shows `openingBalances.advanceOutstanding =
  '500.00'` when the Statement is scoped to cycle 3 alone, with `ADVANCE_GIVEN` itself correctly
  absent from the displayed `entries` (it's out of range) but still counted toward the balance.

Both reconcile to the penny against independently-computed `prisma.balanceAdjustment.aggregate`/
`prisma.advance.aggregate` sums. No defect was found — the architecture already correctly replays full
history before slicing; this closes the gap of having no dedicated proof of it.

## 13. Sensitive-document HTTP/audit behavior, and the read-only guarantee (gap-closure, 2026-07-27)

Already implemented by the route handler since Checkpoint 1 (`statements.routes.ts`), now with
dedicated regression coverage:

- **`Cache-Control: no-store`** is set on every successful `200` response — never on an error
  response (an error short-circuits before that header is ever written).
- **`statement.viewed`** is written to `AuditLog` on every successful view, with `actorUserId` from
  the existing session-actor mechanism (never a client-supplied value) and metadata limited to
  `{ fromCycleId, toCycleId, entryCount }` — no CNIC, bank/IBAN detail, salary figures, or running
  balances are ever copied into audit metadata. Verified by asserting the metadata's own key set and
  that its serialized form never matches CNIC/IBAN/account/balance/salary-shaped content.
- **No audit event on denial.** The audit write sits strictly *after* `getEmployeeStatement()`
  succeeds — a `403` (missing `statements:view`, rejected by `requirePermission` before the handler
  even runs) or a `404` (zero site overlap, thrown from inside `getEmployeeStatement`) both short-
  circuit before that line, so neither ever produces a misleading successful-view audit entry.
  Verified directly: both denial paths leave the `statement.viewed` count for that employee at zero.
- **Viewing mutates nothing.** A dedicated test snapshots every financial-table row count for an
  employee (`PayrollEntry`, `Correction`, `BalanceAdjustment`, `BalanceAdjustmentSettlement`,
  `CorrectionPayment`, `Advance`) plus the specific `PayrollEntry`'s own `version`/`updatedAt` before
  and after a successful `GET` — all identical after. The only write a Statement view can ever cause
  is the one append-only `AuditLog` insert above.

## 14. What Phase 7A, Checkpoint 1 does not include

No frontend page, navigation item, print view, PDF, CSV, or Excel export. No Reports module. No
Dashboard change. Each is its own later Phase 7 checkpoint, requiring its own separate authorization
— see `docs/PROJECT_PROGRESS.md`'s Phase 7 architecture-report entry for the full proposed sequence
(7B: Statement UI + print/export; 7C: Reports; 7D: Dashboard; 7E: integration/UAT).

## 15. Phase 7A, Checkpoint 2 — the frontend page (2026-07-28)

`frontend/src/routes/statements-page.tsx` (plus `hooks/use-employee-statement.ts` and
`components/statements/statement-labels.ts`) is a purely presentational consumer of this module's
own `GET /api/v1/employees/:employeeId/statement` — it introduces no new financial calculation, no
backend/shared change, and no migration. Every balance (`openingBalances`/`closingBalances`/each
row's own `runningBalances`) is rendered exactly as this module returns it; the frontend never nets,
sums, or recomputes any of them. The three independent balances (§2) stay visually separate; the
informational-vs-financial-movement invariant (§3) is rendered as a plain "Informational" label with
no monetary figure for an informational row, and a signed amount + balance name for a real movement
— never invented Debit/Credit terminology. The Advance-history restriction notice (§7a) renders
exactly when `scope.advanceHistoryIncluded === false`, worded to communicate restricted visibility
without implying "no advances" or disclosing any hidden count/amount. Still not included: Print/
Excel export, Reports, Dashboard — each remains a separate, later checkpoint. Full build record:
`docs/PROJECT_PROGRESS.md`'s "Phase 7A, Checkpoint 2" entry, including one disclosed discrepancy (the
restriction notice's own real trigger scenario is unreachable through the reused Employee Lookup for
any non-Master-Admin session, since employee search matches only an employee's *current* site, not
historical site attribution) — not a defect in this module's own backend RBAC, which remains
correct and unchanged.

## 16. Phase 7A, Checkpoint 2 correction — historical employee discovery (2026-07-28)

A dedicated architectural investigation (recorded in full in `docs/PROJECT_PROGRESS.md`'s own
"Phase 7A Checkpoint 2 — architectural investigation" entry) confirmed §15's own disclosed
discrepancy was a genuine, fixable gap, not dead functionality to remove: the Advance-history
restriction is a real, precedented business rule (the same historical-attribution pattern
`payslips.service.ts`'s `listPayslips` and `payroll-entry.service.ts`'s `listPayrollEntries`
already use for their own site-scoped visibility), and `EmployeeTransferHistory`
(`database/employee.md §8b`) proves employee transfer between sites is a deliberately-designed,
first-class business event this system already tracks — not a hypothetical edge case. The fix
below closes the reachability gap without touching either the restriction itself or the general
Employee Lookup's own correctness.

**Statements employee discovery is historical, never current-site-scoped.** A new,
Statements-only endpoint — `GET /api/v1/statements/employees`
(`statements.routes.ts`'s `statementEmployeesRouter`, `statements.service.ts`'s
`searchStatementEmployees`) — discovers candidates via a nested Prisma relation filter on
historical `PayrollEntry.siteId` (optionally further narrowed to `PayrollEntryWorkLine.unitId`),
never `Employee.siteId`. Gated by `statements:view` (not `employees:view`), enforces the caller's
own accessible-site scope server-side (`assertSiteAccess`/`getAccessibleSiteIds`, the same shared
policy module every other site-scoped domain uses), supports Master Admin's unrestricted access,
and returns only minimum identity fields (`employeeId`/`employeeCode`/`cnic`/`name`/
`currentSiteId`/`currentSiteName`) — no salary, banking, correction/recovery, or Advance figures.
Fixed cost of three queries (one `COUNT`, one `SELECT`, one Prisma-batched relation fetch for the
joined site name) regardless of match count — proven directly by `statements.test.ts`'s own "No
N+1" test. No schema change, no new index — the existing `PayrollEntry.@@index([employeeId])`
already bounds this the same way this module's own per-employee ledger queries (§10) already rely
on it; no measured query-plan evidence justified adding one for this checkpoint's scale target.

**The general Employee Lookup (`employees.service.ts`'s `listEmployees`,
`frontend/src/components/ui/employee-lookup.tsx`) is completely untouched** — still scoped to
`Employee.siteId` (current), still backing Advances' Record Advance and Corrections' Request
Correction exactly as before. Statements uses a **separate, dedicated** frontend component
(`frontend/src/components/statements/statement-employee-lookup.tsx`) over the new endpoint, not a
conditional branch inside the shared one — a deliberate choice to keep the two real, forward-
looking callers' own correctness completely isolated from this retrospective one.

**The Statements page is now Employee-first**, not Site → Unit → Employee: the Employee field is
always enabled, with no Site/Unit prerequisite. Site and Unit remain on the page only as *optional
narrowing filters* on the Employee search — changing either after an employee is already selected
clears that selection outright (the same "any filter change clears selection" discipline Payslips
already established) rather than silently re-validating it. **Selecting an employee here is never
a claim that their full history is visible** — the Statement endpoint's own row-level filtering
(§7) remains the sole authority for what actually renders; the page states this explicitly next to
the selection controls.

**The Advance-history restriction still follows the employee's *current* site, unchanged** — this
was deliberately left alone, not widened: `Advance` has no historical site attribution anywhere in
this schema (§7's own long-standing documented limitation — an `Advance` references only an
`Employee`, never a `PayrollEntry`/`ProjectSite`, at creation), so there is no principled
*historical* mechanism to scope it by any site other than the employee's current one. This is
exactly what makes the restriction notice meaningful rather than redundant: a Statement's salary/
correction rows can now be discovered and viewed through old-site history, while its Advance
sub-ledger correctly still depends on whether the caller's scope covers where the employee
currently sits.

**The restriction notice is now naturally reachable** — a real, disclosed E2E scenario
(`tests/e2e/specs/15-statements.spec.ts`) drives an actual employee creation at Site A, a released
Site-A `PayrollEntry`, a real Advance, a real transfer to Site B, and a real Site-A-only user who
discovers the employee through the new historical endpoint, views their permitted Site-A history,
and sees the restriction notice render live — no `page.route` interception, replacing this
checkpoint's own earlier mocked compromise. Full test/build record:
`docs/PROJECT_PROGRESS.md`'s "Phase 7A Checkpoint 2 correction" entry.
