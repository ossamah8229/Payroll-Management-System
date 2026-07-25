# Advances Schema — `Advance`, `AdvanceScheduleChange`

**Owner module(s):** Advances

**Contains:** `Advance`, `AdvanceScheduleChange`

**Sections:** §15–§15a · Full index: `database/README.md`

For the Advance Deduction Deferral *workflow* (BR-ADV-001–006, the carry-forward seam), see
`docs/architecture/workflows/outstanding-obligations.md` and
`docs/architecture/workflows/payroll-lifecycle.md §4` — this file is the schema only.

---

## 15. `Advance`

**Purpose:** A record of a loan or Eid advance given to an employee, and its remaining balance.
**Why it exists:** Visibility into outstanding balances (Advances tab, Statement of Account) without
those balances living only in someone's head.
**Business rule tie-in:** "No auto-calculation of installment size... but the system should track and
display remaining outstanding balance" (`PROJECT_SPEC.md`).
**Revised 2026-07-08, pre-Checkpoint-2 architecture amendment — Advance Deduction Deferral.** The
architecture previously assumed an advance's deduction is automatically applied in whatever cycle
happens to be Draft. This is now changed: before payroll is released, an authorized user may defer the
deduction to a chosen future Draft payroll cycle. The following business rules are now frozen:

> **BR-ADV-001.** Every Advance has an Original Scheduled Deduction Payroll Cycle.
>
> **BR-ADV-002.** Before payroll is released, Payroll Staff or a Master User may defer the deduction to
> another future Draft Payroll Cycle. Released payroll may never be modified.
>
> **BR-ADV-003.** The user may select any future Draft payroll cycle. The system is not limited to
> "next payroll" or "one after next."
>
> **BR-ADV-004.** Every deferral must permanently record: Original Scheduled Cycle, New Scheduled
> Cycle, Reason, Deferred By, Deferred At.
>
> **BR-ADV-005.** Only one scheduled deduction may exist for an Advance at any time. Deferral moves the
> deduction. It never duplicates it.
>
> **BR-ADV-006.** An Advance deduction may only be moved to a future Draft payroll cycle. Released
> cycles are immutable.

Both "Original Scheduled Cycle" and "New Scheduled Cycle" reference a `ScheduledPayrollPeriod`
(`database/payroll-cycle.md §10a`), never a raw `(year, month)` pair — see
`database/payroll-cycle.md §10a` for why. The full deferral mechanics live in
`docs/architecture/workflows/payroll-lifecycle.md §4` and
`docs/architecture/workflows/outstanding-obligations.md`; the permanent per-change history lives in
the new `AdvanceScheduleChange` table (§15a).

**The complete audited lifecycle (added 2026-07-08)** — an auditor can read this chain directly from
`AuditLog` without reconstructing it across multiple tables:

```
Advance created
        ↓
Advance deferred                         (advance.deferred — §15a, may repeat any number of times)
        ↓
Advance deferred again (optional)        (advance.deferred, same event, one row per change)
        ↓
Advance schedule materialized            (advance.schedule_materialized — written by the Advances
        ↓                                 Payroll Materialization Hook,
        |                                 `docs/architecture/workflows/payroll-lifecycle.md §4`, the
        |                                 moment a scheduled deduction actually lands in a real
        |                                 PayrollEntry — distinct from advance.deferred, which only
        |                                 records that the target moved, not that it arrived)
Advance fully reserved                   (outstandingBalance reaches 0, status → RESERVED — the
        ↓                                 deduction is fully staged on a still-Draft PayrollEntry,
        |                                 but nothing has actually been paid yet)
Advance actually paid off                (advance.paid_off — written by
                                           `settleAdvancesForReleasedEntries`, the exact moment the
                                           PayrollEntry carrying that reservation is Released,
                                           status RESERVED → PAID_OFF)
```

If the Draft deduction that produced `RESERVED` is itself reversed before release — edited
(`updateAdvance`), deferred (`deferAdvanceSchedule`), or the Advance cancelled (`cancelAdvance`) —
`status` reverts to `ACTIVE` and `outstandingBalance` is restored, exactly like reversing a partial
(not-yet-zero) Draft deduction already worked before `RESERVED` existed. `RESERVED` is therefore not
a new terminal state, only a new *intermediate* one between "fully deducted in a Draft" and
"actually paid off," matching `PAID_OFF`'s own precondition everywhere else in this document except
that reaching zero balance alone is no longer sufficient to reach it.

**RESERVED status and Release-time settlement (Presentation & Workflow Stabilization Checkpoint,
2026-07-25, Issue 5).** Production observed that recording an Advance deduction against the current
Draft payroll made it read as `PAID_OFF` immediately — before that payroll had actually been paid to
anyone. Root cause: `materializeOneAdvanceDeduction` flipped `status` straight to `PAID_OFF` the
instant `outstandingBalance` reached zero, which happens the moment a deduction is *staged* into a
Draft `PayrollEntry`, not when it is actually *settled*. Fixed by splitting that single transition
into two: reaching zero balance in a still-Draft entry now sets `status` to the new `RESERVED` value
(the deduction is committed/held against this cycle, but reversible — see above); `status` only
advances to `PAID_OFF` (and `paidOffAt` is only ever written) when the specific `PayrollEntry`
carrying that reservation is actually Released, via the new `settleAdvancesForReleasedEntries`
(`advances.service.ts`), called from exactly one place — `payroll-release.service.ts`'s
`releaseProjectUnit`, in the same transaction as the entries themselves flipping `released: true` —
mirroring the identical "reservation becomes final only at the entry's own release" pattern
`consumeMaterializationsForReleasedEntries` already established for Correction `BalanceAdjustment`s
(Phase 6 Checkpoint 7, above this file's own §14 in `balance-adjustments.md`). `RESERVED` behaves
like `PAID_OFF` for editability (financial fields on `updateAdvance` are rejected) and like `ACTIVE`
for reversibility (`cancelAdvance`/`deferAdvanceSchedule` both still operate on it, and the "at most
one live Advance per employee per type" partial unique index now excludes `RESERVED` exactly like
`ACTIVE`, not just `PAID_OFF`/`CANCELLED`).

`advance.deferred` and `advance.schedule_materialized` are deliberately two different events: the
first records *intent to move* a not-yet-arrived deduction (BR-ADV-004), the second records *arrival* —
that this cycle's `PayrollEntry` was actually populated. A deferred advance produces exactly one
`advance.deferred` entry per deferral and exactly one `advance.schedule_materialized` entry the one
time its (possibly several-times-moved) target finally resolves — never the reverse, and never more
than one materialization for the same scheduled landing.

**BR-ADV-007 and immediate materialization (Operational Stabilization Checkpoint, 2026-07-24).**
Production observed an Advance recorded against the current Draft cycle not appearing as a deduction
in that cycle's Payroll Entry — root cause: `materializeScheduledAdvanceDeductions` only ever ran at
cycle *bootstrap* (`createPayrollCycle`/`archiveAndCreateNextPayrollCycle`), a moment that, for any
Advance recorded after the Draft cycle already exists (the ordinary case), has already passed. Fixed
two ways:

> **BR-ADV-007.** A new Advance's first scheduled deduction period may never be earlier than the
> current Draft payroll cycle (or, if no cycle is currently Draft, today's real calendar month — never
> an invented cycle). The UI defaults to the current Draft cycle and offers an explicit "Future Cycle"
> choice; it never defaults to next-cycle automatically.

`createAdvance` (`advances.service.ts`) now also checks, in the same transaction as the Advance's own
creation: if the resolved period *is* the current Draft cycle and this employee already has a
still-editable (not released) entry in it, materialize the deduction immediately — the exact same
single-advance calculation `materializeScheduledAdvanceDeductions` uses for its bulk sweep (both now
call one shared `materializeOneAdvanceDeduction` helper, never two independent copies). A future
period, no current Draft cycle, or an already individually-released entry (a per-Unit Late Entry
release inside a nominally Draft cycle) are all left unmaterialized exactly as before — a future
period resolves at that cycle's own bootstrap; a released entry is never retroactively modified
(Principle 9), and the Advance itself stays visible, unmaterialized, on the Advances list.

**Lifecycle-aware Edit (Section F).** `updateAdvance` now also accepts `totalAmount`. Every financial
field (`totalAmount`, `repaymentType`, `scheduledInstallmentAmount`) is rejected outright once
`status` is anything other than `ACTIVE` — `RESERVED` included, added 2026-07-25: a fully-reserved
Draft deduction has nothing left to schedule either, until it either releases or is cancelled;
`notes` remains editable at every lifecycle stage. The deduction
start cycle (`originalScheduledPeriodId`/`currentScheduledPeriodId`) is still never editable through
this endpoint, at any stage — `originalScheduledPeriodId` stays permanently immutable (BR-ADV-001);
correcting a wrong start cycle before materialization means cancelling the mistaken Advance and
recording a fresh one (below), and after materialization it is still `deferAdvanceSchedule`'s job.

**The `totalAmount` floor, and live-Draft recalculation (corrected on post-implementation review,
same day).** The floor for a `totalAmount` reduction is what has been repaid via **RELEASED** payroll
only — never a still-Draft (unreleased) figure, which remains fully reversible until release. If this
Advance currently has a live (unreleased) materialized deduction when a financial field actually
changes, `updateAdvance` reverses it first (the identical zero-the-entry-and-restore-the-balance step
`cancelAdvance`/`deferAdvanceSchedule` already use), computes the floor and the new
pre-this-cycle balance against that reversed state, then re-materializes the SAME cycle's deduction
under the NEW rules via the same shared `materializeOneAdvanceDeduction` helper every other
materialization path uses — exactly once, never a second independent calculation, and a RELEASED
entry (excluded by the `released: false` lookup) is never reversed or touched regardless of what the
edit changes. A same-value resubmission (no financial field actually different from what is already
stored) skips this reversal/recalculation entirely, so a notes-only save never bumps the live entry's
`version` or writes reversal/re-materialization audit noise.

**Cancel/Void (Section G).** `AdvanceStatus` gains a `CANCELLED` value — a non-destructive correction
for a mistakenly-recorded Advance, applying uniformly whether or not any deduction has yet
materialized. Cancellable from `ACTIVE` or `RESERVED` (2026-07-25 — a `RESERVED` advance's deduction
is still sitting on a live, unreleased Draft entry, so voiding it and reversing that deduction is
still meaningful right up until the entry actually releases); rejected once `PAID_OFF` (truly final)
or already `CANCELLED`. This schema already has **no delete path for `Advance` at all** (see the model's own
doc comment below) — matching that existing "no hard delete of a permanent financial/master record"
convention was the deciding factor over adding a narrow hard-delete-if-untouched carve-out. Cancelling
reverses a still-Draft (unreleased) materialized deduction first, if one currently carries this
Advance's linkage — the identical zero-the-entry-fields-and-restore-the-balance step
`deferAdvanceSchedule` already performs — but never touches a RELEASED deduction. `advance.cancelled`
and (when a Draft deduction was reversed) `payroll_entry.advance_cancelled` audit events are recorded.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` |
| `type` | `AdvanceType` | no | — | `LOAN` or `EID_ADVANCE` |
| `totalAmount` | numeric(12,2) | no | — | original amount given |
| `outstandingBalance` | numeric(12,2) | no | (= `totalAmount` at creation) | decremented as matching `PayrollEntry` deductions are recorded — see note below |
| `dateGiven` | date | no | — | |
| `repaymentType` | `AdvanceRepaymentType` | no | — | informational only, per spec — does not drive auto-calculation |
| `notes` | text | yes | — | |
| `status` | `AdvanceStatus` | no | `'ACTIVE'` | flips to `RESERVED` when `outstandingBalance` reaches 0 in a still-Draft `PayrollEntry`, then to `PAID_OFF` only once that entry actually Releases (**added 2026-07-25**, Issue 5 — see "RESERVED status and Release-time settlement" above; reverts to `ACTIVE` if the reservation is reversed before release); **added 2026-07-24:** may also transition to `CANCELLED` — see "Cancel/Void" below |
| `originalScheduledPeriodId` | uuid | yes | — | **Added 2026-07-08.** FK → `ScheduledPayrollPeriod.id` (`database/payroll-cycle.md §10a`), `ON DELETE RESTRICT` — **BR-ADV-001.** Set once, the first time this advance's deduction is ever scheduled; immutable forever after, regardless of any later deferral |
| `currentScheduledPeriodId` | uuid | yes | — | **Added 2026-07-08.** FK → `ScheduledPayrollPeriod.id` (`database/payroll-cycle.md §10a`), `ON DELETE RESTRICT` — the live "where does the next deduction land" pointer. Exactly one value at a time (**BR-ADV-005** — a deferral overwrites this, never adds a second pointer). Null once `status` is `RESERVED` or `PAID_OFF` |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

**On the employee/type/active linkage:** `PayrollEntry.advanceDeduction`/`.eidAdvanceDeduction` are
single lump figures per cycle (matching the source spec's model), auto-linked at entry time to the
employee's `ACTIVE` advance of the matching type via the explicit `PayrollEntry.advanceId`/
`.eidAdvanceId` FKs (`database/payroll-entry.md §12`). To keep that auto-linking unambiguous, this
schema assumes **at most one `ACTIVE` advance per employee per type at a time** — enforced by a
partial unique index. Recording the link explicitly at entry time (rather than re-inferring "whichever
advance is currently active" later) is what makes a later Correction to these fields reconcilable
against the *correct* advance even if the employee has since paid it off and taken out a new one of
the same type — see `docs/architecture/workflows/corrections-and-balance-adjustments.md` ("Interaction
with Advances").

- **Unique constraints:** partial unique (`employeeId`, `type`) `WHERE status IN ('ACTIVE',
  'RESERVED')` (widened 2026-07-25 for `RESERVED` — a two-migration change, `ADD VALUE` then the
  index/constraint update in a later migration, for the same same-transaction-unsafe reason noted
  below) — a `CANCELLED` advance (2026-07-24) is excluded exactly like `PAID_OFF`, so a fresh Advance
  of the same type may be recorded immediately after cancelling a mistaken one, but not while the
  prior one is still `RESERVED` (reserved-but-unreleased is not yet final)
- **Check constraints:** `totalAmount > 0`; `outstandingBalance >= 0`; `outstandingBalance <=
  totalAmount`; **added 2026-07-08, widened 2026-07-25:** `status IN ('PAID_OFF', 'RESERVED') ⇒
  currentScheduledPeriodId IS NULL` (application code applies the identical rule to `CANCELLED`,
  2026-07-24, but this specific constraint was not widened to also require it — a deliberate, narrow
  simplification to avoid enlarging an already-two-migration change further, for a case where
  `materializeScheduledAdvanceDeductions`'s own `status: 'ACTIVE'` filter already excludes
  `CANCELLED` regardless of this column's value, so no functional correctness depends on it). Adding
  a brand-new enum value and referencing it in an index/constraint predicate cannot happen in the
  same migration transaction (Postgres restriction) — hence the two separate migration files for
  `RESERVED` (`20260725090000_advance_reserved_status`, `20260725091000_advance_reserved_constraints`),
  matching how `CANCELLED` itself was added enum-only with no same-migration constraint change.
- **Indexes:** the partial unique index above (also the primary lookup); (`employeeId`); **added
  2026-07-08:** (`currentScheduledPeriodId`) — the lookup the cycle-bootstrap sweep uses to find every
  `ACTIVE` advance whose schedule resolves to the cycle being created
- **Cascade:** `employeeId`, `originalScheduledPeriodId`, and `currentScheduledPeriodId` are all
  `RESTRICT`
- **Module owner:** Advances — its own row in the Major Modules table, added 2026-07-08 alongside this
  amendment (see `docs/architecture/overview.md`)
- **What can change `outstandingBalance`:** exactly two paths, both transactional — (1) the original
  `PayrollEntry` save that records a non-zero linked deduction (decrements by that amount, flips to
  `PAID_OFF` at zero); (2) a later approved `Correction` to the linked `advanceDeduction`/
  `eidAdvanceDeduction` field (adjusts by the delta between old and new effective deduction amount,
  flipping `status` between `ACTIVE`/`PAID_OFF` as the balance crosses zero in either direction). If a
  correction's `PayrollEntry` has a null `advanceId`/`eidAdvanceId` (no advance was linked at entry
  time), path (2) is skipped and logged — the salary-level `BalanceAdjustment` is still created
  regardless, since advance-balance tracking is an informational aid (`PROJECT_SPEC.md`), not a gate
  on payroll correctness.
- **What can change `currentScheduledPeriodId` (added 2026-07-08):** a schedule change (deferral,
  BR-ADV-002/006) updates the pointer and is the only path that moves it early — **it never touches
  `outstandingBalance`**, since deferral changes only *when* a deduction lands, never *how much*. The
  pointer also advances automatically, without a deferral, the ordinary way: each time a scheduled
  deduction materializes onto a new cycle's `PayrollEntry` (`database/payroll-cycle.md §10a`'s resolution step,
  `docs/architecture/workflows/payroll-lifecycle.md §4`), it is set forward to the immediately-following
  month as the new default target, unless the advance became `PAID_OFF` this cycle (in which case it is
  cleared to null).
- **Audit logging:** creation, both `outstandingBalance`-changing events, and (added 2026-07-08) every
  schedule change (`advance.deferred`, §15a) and every schedule arrival
  (`advance.schedule_materialized`, written by the Advances Payroll Materialization Hook the moment a
  scheduled deduction actually lands in a `PayrollEntry` — see the full lifecycle chain, above)
- **Row count:** tens to low hundreds created per month; total accumulates but stays small

## 15a. `AdvanceScheduleChange`

**Added 2026-07-08, pre-Checkpoint-2 architecture amendment.** The append-only history of every change
made to an Advance's scheduled deduction period. Named for what it records — **changes to the
schedule** — not the schedule itself, which always lives on `Advance.currentScheduledPeriodId` (§15).
Today every recorded change is a deferral (a move strictly later in time, BR-ADV-006); the table's name
and column names are deliberately general so a future business rule permitting a schedule to move
*earlier* would never require another rename — only, if that rule ever arrives, a new check-constraint
variant on top of the same table. The audit event this produces stays specifically named
(`advance.deferred`) regardless of the table's general name, since today's only real-world behavior is
a deferral.
**Why it exists:** Mirrors this schema's established pattern of pairing a mutable "current state"
pointer on a parent row with a typed, directly queryable history table for how it got there —
`EmployeeTransferHistory` (`database/employee.md §8b`) alongside `Employee.siteId`/`.unitId`, and
`BalanceAdjustmentSettlement` (`database/balance-adjustments.md §14b`) alongside
`BalanceAdjustment.remainingAmount`, are the direct precedents.
**Business rule tie-in:** BR-ADV-002 through BR-ADV-006 (§15).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `advanceId` | uuid | no | — | FK → `Advance.id`, `ON DELETE RESTRICT` |
| `payrollEntryId` | uuid | no | — | FK → `PayrollEntry.id`, `ON DELETE RESTRICT` — the entry this change removed the materialized deduction from |
| `fromPeriodId` | uuid | no | — | FK → `ScheduledPayrollPeriod.id` (`database/payroll-cycle.md §10a`), `ON DELETE RESTRICT` — the schedule immediately before this change |
| `toPeriodId` | uuid | no | — | FK → `ScheduledPayrollPeriod.id` (`database/payroll-cycle.md §10a`), `ON DELETE RESTRICT` — the new schedule |
| `reason` | text | no | — | mandatory (BR-ADV-004) |
| `changedById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` |
| `changedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** none — an Advance may be rescheduled any number of times
- **Check constraints:** `length(trim(reason)) > 0`
- **A note on what is *not* database-enforced here:** BR-ADV-006 ("only ever moved to a future Draft
  payroll cycle") would ordinarily also get a same-row check constraint, matching this schema's usual
  defense-in-depth convention (e.g. the Audit Log's immutability trigger, `database/audit-log.md §16`;
  the Work Line same-site rule, `database/payroll-entry.md §12a`). That isn't possible here without
  denormalizing `fromPeriodId`/`toPeriodId`'s own `(year, month)` back onto this row — which would
  recreate exactly the dual-representation problem `database/payroll-cycle.md §10a` exists to
  eliminate. **This is therefore a deliberate, narrower exception to the schema's normal
  database-plus-application enforcement pattern:** the strictly-future ordering rule is enforced at the
  application/service layer only — verified by joining `fromPeriodId`/`toPeriodId` to their
  `ScheduledPayrollPeriod` rows and comparing `(year, month)` at the moment a change is recorded — and
  must be covered by a dedicated, thorough test (`docs/IMPLEMENTATION_PLAN.md` Phase 4) precisely
  because it has no database-level backstop.
- **Indexes:** (`advanceId`, `changedAt` desc) — the full schedule-change history for one Advance, in
  chronological order; (`payrollEntryId`) for entry-level drill-down (Statement of Account)
- **Cascade:** all FKs `RESTRICT`
- **Module owner:** Advances
- **Immutable, append-only — explicit invariant (strengthened 2026-07-08):** behaves exactly like
  `EmployeeTransferHistory` (`database/employee.md §8b`) and `BalanceAdjustmentSettlement`
  (`database/balance-adjustments.md §14b`): **no updates, no deletes, only inserts.** A row, once
  written, is never edited or removed by any application code path — a mistaken schedule change is
  corrected by recording a further change, never by altering or deleting the row that recorded the
  mistake, exactly as those two precedent tables already work.
- **Transactions required:** yes — recording a change is transactional with: zeroing the source
  `PayrollEntry`'s `advanceDeduction`/`advanceId` (or `eidAdvanceDeduction`/`eidAdvanceId`) fields (an
  ordinary Draft field edit, bumping that entry's existing `version`), updating
  `Advance.currentScheduledPeriodId` to `toPeriodId`, the find-or-create of `toPeriodId`'s
  `ScheduledPayrollPeriod` row if it didn't already exist (via Payroll Processing's owned find-or-create
  function, `database/payroll-cycle.md §10a` — Advances never writes to this table directly), this
  row's own insert, and the corresponding `AuditLog` entry (`advance.deferred`) — all in one transaction
- **Audit logging:** every creation is itself an audited event (`advance.deferred`) — distinct from,
  and always followed later by, the one-time `advance.schedule_materialized` entry written when this
  change's target finally arrives (§15's lifecycle chain, above; the materialization event itself is
  not a row on this table, since it isn't a *change* to the schedule — it's confirmation that a
  previously-recorded schedule was reached)
- **Row count:** small — bounded by (number of Advances) × (typical reschedule count per advance,
  expected to be low)

---
