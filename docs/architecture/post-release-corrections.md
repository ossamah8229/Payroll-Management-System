# Post-Release Correction Rule

This refines and supersedes the correction-workflow mechanics described in `PROJECT_SPEC.md` and the
prototype. The prototype's approach (silently bump next month's `allowance` or `advance` field by the
diff) is **not** carried into production — this document describes the replacement.

## Why this changes

Payroll Release represents that funds have already been physically disbursed — a bank transfer has
gone out, or cash has been handed over. Once that has happened, "correcting the salary" cannot mean
recalculating and re-displaying a new full salary figure for that historical cycle: the number that
was actually paid is a fact of record, not a draft.

## When this applies

Stated once, authoritatively, in `docs/architecture/data-and-storage.md` §4, and never rephrased
differently anywhere in this document set:

> **A `PayrollEntry` requires the Correction workflow whenever the `PayrollEntry` has been
> individually released, OR its parent `PayrollCycle` is no longer in Draft.**

Everything below applies whenever that condition holds — whether the entry's own release happened
while its cycle was still `Draft`, or the cycle has since become `Released` or `Archived`.

## The rule

1. **Never regenerate the employee's full salary once the trigger condition above applies.** The
   original `PayrollEntry` record — the figures as they stood at release — is never mutated. It
   remains the permanent record of what was actually paid (Principle 2: historical payroll must never
   be overwritten).
2. **Calculate only the difference** between the current effective net salary and the corrected net
   salary (using the same `calcNet` logic, applied to a reconstructed effective state of the entry —
   see "Baseline Reconstruction for Sequential Corrections" below for exactly what "current effective"
   means once more than one correction exists against the same entry).
3. **Only the balance is paid, and it is merged into one combined payment, never a second transfer.**
   See "Representation in Bank Sheets, Cash Sheets, and Payslips" below for the exact rule.
4. **Sign convention and terminology:**
   - Positive difference (corrected net > originally released net) → **Balance Salary Payable** —
     the company owes the employee more.
   - Negative difference (corrected net < originally released net) → **Salary Recovery /
     Overpayment Adjustment** — the employee was overpaid and the amount is recovered.
5. **Every correction is classified by a standardized Adjustment Type**, in addition to a free-text
   remark (see "Standardized Adjustment Types" below) — the type drives reporting and filtering
   (e.g. "show all Advance Recovery adjustments this quarter"), while the remark carries the
   human-readable specifics of this particular case.
6. **Every balance transaction carries a remark** explaining, in plain language, why the settling
   payment includes more (or less) than the current cycle's ordinary net salary — e.g. *"Balance
   payment: April 2026 salary was released at PKR 37,000. A correction on 12/05/2026 (type: Attendance
   Correction; reason: attendance miscounted) adjusted the calculated net to PKR 39,500. This PKR
   2,500 balance is included in this cycle's payment."* This remark appears on the Payslip and the
   Statement of Account, wherever the balance is shown as its own line (see "Representation in Bank
   Sheets, Cash Sheets, and Payslips" below — the Bank Sheet/Cash Sheet row itself is a single merged
   amount and does not carry a per-line remark).
7. **Full traceability.** Every balance transaction links back to the `Correction` record that
   produced it, and both are written to the Audit Log in the same transaction (Principle 3). The
   employee's Statement of Account shows the correction and its resulting balance transaction as
   linked entries, not as an edited historical line.

## Standardized Adjustment Types

Every Correction is tagged with one adjustment type from a fixed, extensible list — this keeps
corrections filterable and reportable (e.g. for the Fines & EOBI—style report, or a future "Advance
Recovery" report) without parsing free text. Users still enter an explanatory remark alongside the
type; the type is a classification, not a replacement for the specific explanation.

Initial types:

- **Attendance Correction** — working days/attendance were recorded incorrectly.
- **Overtime Correction** — OT hours or OT rate were recorded incorrectly.
- **Salary Revision** — a change to gross pay or another base figure after release.
- **Leave Adjustment** — claimed leave days or leave rate were recorded incorrectly.
- **Fine Adjustment** — a fine was added, removed, or corrected in amount.
- **Advance Recovery** — an advance/loan or Eid advance deduction was corrected.
- **Manual Adjustment** — anything not covered by the above; the remark carries the full explanation.

This list is additive (Principle 8) — new types are added as new business scenarios arise, existing
types are never repurposed to mean something else, so historical corrections stay correctly
classified.

## Baseline Reconstruction for Sequential Corrections

`PayrollEntry` is never mutated (Principle 9), which raises a real question for a *second* (or third,
etc.) correction against the same entry: what is its "old value" baseline, if the stored row still
holds the original, pre-correction figures?

**The entry's current effective state is always reconstructed by replay, never read from a cache:**
for each correctable field (`CorrectionField`), the current effective value is the `newValue` of the
most recently approved `Correction` for that `payrollEntryId` + `field`, or — if no correction has
touched that field — the value stored on `PayrollEntry` itself. The current effective net salary is
`calcNet` applied to the entry with every field replaced by its current effective value.

When a new correction is opened:
- The **old value**/**old net salary** shown in the comparison screen, and used as the baseline for
  the new `BalanceAdjustment`'s amount, is this reconstructed current effective state — not the raw
  stored `PayrollEntry` row. This means a second correction to a *different* field than the first
  still correctly accounts for the first correction's approved change when computing the new net
  salary, and a second correction to the *same* field shows the approver what the field is currently
  understood to be (reflecting the prior correction), not the stale original.
- The **new value**/**new net salary** applies the correction being approved on top of that same
  reconstructed state.
- The resulting `BalanceAdjustment` amount is therefore always the *incremental* effect of just this
  correction — cumulative balance adjustments across multiple corrections to the same entry sum to
  the correct total difference from the original released figures.

This reconstruction is deliberately stateless and recomputed from the full correction history every
time, rather than incrementally maintained or cached anywhere — it can always be independently
verified by replaying from scratch, which is what "deterministic and reproducible" (Principle 5)
requires for a mechanism this central to correctness. `Correction (payrollEntryId, field,
approvedAt DESC)` is indexed to make this replay cheap (see `docs/architecture/database-schema.md`
§13).

## Automatic Settlement Workflow

Settlement of a Balance Adjustment is **fully automatic** — there is no manual step where a payroll
administrator transfers, schedules, or moves a balance from one cycle to another. The pipeline is
fixed:

```
Correction Approved
        ↓
Balance Adjustment created — status: PENDING
        ↓
Automatically appears in the next active Draft payroll cycle
        ↓
Included automatically when that cycle's payroll is released
        ↓
Marked SETTLED automatically upon release
```

Concretely:

- The moment a Correction is approved (whenever the trigger condition in "When this applies" holds —
  regardless of whether that's because the specific entry was individually released or because its
  cycle has moved past Draft), a Balance Adjustment is **always** created.
- **If the correction results in zero net difference** (the corrected net salary equals the current
  effective net salary — see "Baseline Reconstruction," above), the Balance Adjustment is still
  created, for full traceability, but with type `NONE` and amount `0`, and is immediately created
  already `SETTLED` (there is nothing to pay or recover, so it never enters the `PENDING` queue or
  appears on any payment artifact). This keeps "every approved Correction always creates a Balance
  Adjustment" literally true without ever showing a meaningless "PKR 0 payable" line anywhere.
- **Otherwise** (`PAYABLE` or `RECOVERY`, amount `> 0`), the Balance Adjustment is created in
  `PENDING` status and is automatically surfaced as part of that employee's payroll the next time a
  Draft cycle is active — the admin sees it, but does not have to do anything to make it appear
  there. It is not optional to include and not something that can be deferred by inaction.
- When that Draft cycle's payroll is released, every `PENDING` Balance Adjustment that was included
  is atomically marked `SETTLED` as part of the same release transaction, and its `settledInCycleId`
  is recorded.
- If, for some reason, an employee with a `PENDING` Balance Adjustment is **held** rather than
  released in that cycle, the adjustment remains `PENDING` and automatically carries forward again to
  the *next* Draft cycle — the same automatic mechanism, not a manual re-queue.

**Payroll administrators never manually move a Balance Adjustment between cycles.** The only human
decisions in this pipeline are (a) approving the Correction in the first place, with its mandatory
reason and Adjustment Type, and (b) the ordinary release/hold decision for that employee in the
current Draft cycle — the balance's appearance and settlement follow from those automatically.

## Representation in Bank Sheets, Cash Sheets, and Payslips

**A settling Balance Adjustment is merged into the employee's ordinary payment for that cycle — it is
never a second bank transfer or a second row.** This is a final, approved decision, driven by how a
real bank bulk-transfer batch actually works: a Bank Sheet submitted to a bank is a batch of
(account number, amount) pairs, and sending two line items to the same account in one batch isn't a
reliable operation to depend on.

- **Bank Sheet** — exactly one row per employee. `Amount = PayrollEntry.netSalary ± the sum of all
  Balance Adjustments settling in this release` (`PAYABLE` adds, `RECOVERY` subtracts).
- **Cash Receiving Sheet** — same rule, one row per employee, same combined amount.
- **Payslip** — shows the Balance Adjustment as its own distinct line item (with its remark), in
  addition to the ordinary earning/deduction breakdown, since a payslip is not constrained by
  bank-batch formatting and this is where the breakdown belongs.
- **Statement of Account** — shows the Correction and its resulting Balance Adjustment as fully
  separate ledger entries, exactly as already described (§7, above) — unaffected by how the payment
  itself is transferred.

There must never be two bank transfers, two cheques, or two payment rows for the same employee in one
payroll run. The Bank Sheet/Cash Sheet total must still exactly equal what is actually paid
(Principle 6); the *traceability* requirement that a balance must never look like an ordinary
allowance is satisfied by the Payslip and Statement of Account carrying the breakdown, not by
splitting the payment itself.

## Interaction with Advances

A correction to the `ADVANCE_DEDUCTION` or `EID_ADVANCE_DEDUCTION` field changes what was actually
deducted toward a specific advance, and must reconcile that advance's `outstandingBalance` in the
same transaction as the correction's approval — otherwise the advance balance silently drifts from
what the corrected records say was actually recovered, which would violate Principle 6.

This is possible without ambiguity because `PayrollEntry.advanceId` / `.eidAdvanceId` (see
`docs/architecture/database-schema.md` §12) record, at the time the deduction was originally entered,
*exactly* which `Advance` row it applied to — not inferred again later from "whichever advance is
currently active" (which could by now be a different advance, if the original one was since paid off
and a new one taken out). When such a correction is approved:

- The linked `Advance.outstandingBalance` is adjusted by the delta between the old and new effective
  deduction amount (per the baseline reconstruction above) — if the deduction decreases, the balance
  goes back up (less was actually recovered than originally recorded); if it increases, the balance
  goes down further.
- If this pushes a `PAID_OFF` advance's balance back above zero, its status reverts to `ACTIVE`; if it
  brings an `ACTIVE` advance's balance to exactly zero, its status becomes `PAID_OFF`.
- If `advanceId`/`eidAdvanceId` is null on the entry being corrected (no advance was linked at entry
  time — an edge case), the reconciliation step is skipped and logged as such; the salary-level
  Balance Adjustment is still created regardless, since salary correctness is never blocked by an
  advance-tracking gap (advance balance tracking is an informational aid, per `PROJECT_SPEC.md`, not
  a figure that gates payroll correctness).

## Data model implication

The prototype's mechanism — silently adding the diff into next month's `allow` or `adv` field — is
replaced with an explicit, first-class balance record (`BalanceAdjustment`, always exactly one per
approved correction — including the zero-difference `NONE` case, above) carrying at minimum:

- Reference to the originating `Correction` (one-to-one)
- Reference to the source cycle (the cycle the correction was made against — this may be `Released`
  or `Archived`, or a still-`Draft` cycle in which the specific entry was individually released) and
  employee
- Amount and type (`PAYABLE` / `RECOVERY` / `NONE`)
- Its own `adjustmentTypeId`, a direct, denormalized copy of the originating `Correction`'s
  standardized Adjustment Type — stored directly on `BalanceAdjustment`, not looked up via a join,
  consistent with how `employeeId` and the source cycle are already denormalized on this same row —
  plus the free-text remark, carried from the originating `Correction`
- Status (`PENDING` → `SETTLED`), transitioned automatically per the Automatic Settlement Workflow
  above — never set manually (a `NONE`-type row is created already `SETTLED`)
- The cycle in which it was settled (`settledInCycleId`), populated automatically at release (null
  for a `NONE`-type row, which was never queued for settlement)
- The display remark (§6, above)

This keeps the balance a distinct, queryable, auditable object — rather than an invisible bump to an
ordinary earnings/deductions field that would be indistinguishable from a normal allowance or advance
in any downstream report. A "Balance Salary Payable" and a normal allowance must never be conflated
in the underlying data or in any place a breakdown is shown (Payslip, Statement of Account) — the
Bank Sheet/Cash Sheet total is allowed to merge them into one payment amount (per "Representation in
Bank Sheets, Cash Sheets, and Payslips," above, driven by real banking constraints), but that merged
total must always be traceable back to *why* it's larger or smaller than the ordinary net salary via
the linked `Correction`/`BalanceAdjustment` records — never by silently overwriting an ordinary
earnings/deductions field, which would destroy that traceability entirely (Principle 6).

## What does not change

- The Correction modal's old-value/new-value/old-net/new-net comparison UX (from the prototype) is
  still the right interaction for *previewing* a correction before approval.
- Master Admin approval and a mandatory reason are still required to confirm any correction wherever
  the trigger condition in "When this applies" holds.
- The correction is still logged permanently and shown in the employee's Statement of Account.

What changes is only what happens *after* approval: instead of quietly folding the diff into next
month's ordinary payroll fields, the system creates an explicit, clearly-labeled balance transaction
that is settled (paid or recovered) as its own traceable item.
