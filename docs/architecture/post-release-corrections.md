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

> **A `PayrollEntry` requires the Correction workflow whenever `PayrollEntry.released = true`.**

**Simplified 2026-07-05 (Phase 3 architecture review)** from the original two-clause "individually
released, OR its parent `PayrollCycle` is no longer in Draft" — release now happens at Project Unit
granularity (`data-and-storage.md` §4), and `PayrollCycle.status` is itself derived from every Unit
having released or been held, so it can never diverge from entry-level `released` any more. Everything
below applies whenever `released = true` holds, regardless of whether that happened via the ordinary
per-Unit sweep or a Late Entry's own one-off release (`database-schema.md` §12b).

## Correction Requests — proposing vs. deciding a correction

**Added 2026-07-05.** A new business rule separates *who may propose* a correction from *who may
decide* one: "correction requests may be initiated by any authorized payroll user, but approval
belongs to the Master User." Two paths now exist, both producing an identical `Correction` row
(`database-schema.md` §13):

1. **Direct correction** — unchanged from before this session. A Master User corrects a released
   entry personally. Because they *are* the approver, no separate request/approval step applies — this
   was always true of pre-release edits (any payroll manager may freely edit until release) and is now
   stated explicitly for the post-release case too: **"if the Master User makes the correction
   personally, no separate approval workflow is required."**
2. **Correction Request** (new, `CorrectionRequest`, `database-schema.md` §13a) — any other authorized
   payroll user proposes a field, a new value, an Adjustment Type, and a mandatory reason. It sits
   `PENDING` until a Master User reviews it:
   - **Approve** — the Master User may adjust the proposed field/value/Adjustment Type before
     confirming; approval creates the `Correction` (+ its `BalanceAdjustment`, below) in the same
     transaction as marking the request `APPROVED` and linking it to the resulting `Correction`.
   - **Reject** — the request is marked `REJECTED` with a mandatory rejection reason (mirroring the
     "reason mandatory" convention applied to the correction itself); no `Correction` or
     `BalanceAdjustment` is created, and the underlying `PayrollEntry` is untouched.
   Either outcome is a permanent, audited record — a `CorrectionRequest` is never edited or deleted
   once decided (`database-schema.md` §13a).

Everything below — the baseline-reconstruction algorithm, standardized Adjustment Types, the
Automatic Settlement Workflow, Bank Sheet/Payslip representation — applies identically to a
`Correction` regardless of which of the two paths produced it.

## The rule

1. **Never regenerate the employee's full salary once the trigger condition above applies.** The
   original `PayrollEntry` record — the figures as they stood at release — is never mutated. It
   remains the permanent record of what was actually paid (Principle 2: historical payroll must never
   be overwritten).
2. **Calculate only the difference** between the current effective net salary and the corrected net
   salary (using the same `calcNet` logic, applied to a reconstructed effective state of the entry —
   see "Baseline Reconstruction for Sequential Corrections" below for exactly what "current effective"
   means once more than one correction exists against the same entry).
3. **The balance is paid via exactly one of a small number of well-defined paths, never a second,
   untracked transfer.** Revised 2026-07-05: a settling positive balance is merged into the employee's
   ordinary cycle payment *when one exists to merge into* — otherwise it's its own standalone,
   equally-traceable payment (a `CorrectionPayment`). See "Representation in Bank Sheets, Cash Sheets,
   and Payslips" below for the exact rule per case.
4. **Sign convention, terminology, and (added 2026-07-05) timing/spread options:**
   - Positive difference (corrected net > originally released net) → **Balance Salary Payable** —
     the company owes the employee more. At approval time, the Master User chooses **Immediate**
     (pay as soon as possible — folded into the employee's already-open `PayrollEntry` if one exists
     this cycle, else a standalone `CorrectionPayment` right away) or **Deferred** (unchanged from
     before this session — automatically surfaces in the *next* Draft cycle's entry regardless of
     whether the employee happens to have another still-open entry sooner; see "Automatic Settlement
     Workflow" below).
   - Negative difference (corrected net < originally released net) → **Salary Recovery /
     Overpayment Adjustment** — the employee was overpaid and the amount is recovered. **Never
     immediate** — always recovered via one or more future cycles. By default the full amount is
     recovered in the very next cycle (unchanged, the original behavior); the Master User may instead
     set a smaller per-cycle recovery amount, spreading it as an installment across as many future
     cycles as it takes — see "Automatic Settlement Workflow" below.
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
administrator transfers or moves a balance from one cycle to another. **Revised 2026-07-05:** the
pipeline now branches by `type`, but every branch remains automatic once the one human timing/spread
decision is made at approval:

```
Correction Approved
        ↓
Balance Adjustment created
        ↓
   ┌────┴─────────────────────────┬─────────────────────────────┐
   │ type = NONE                  │ type = PAYABLE               │ type = RECOVERY
   ↓                              ↓                               ↓
already SETTLED,           paymentTiming chosen at approval:   never immediate — always a future
amount 0, no                                                    cycle (or several, if spread as an
payment artifact            IMMEDIATE          DEFERRED         installment)
                                ↓                  ↓                     ↓
                         fold into an       automatically         each future cycle's release
                         already-open       surfaces in the       applies min(installment amount,
                         PayrollEntry if    next Draft cycle's    remainingAmount), logs a
                         one exists, else   entry, settled on     BalanceAdjustmentSettlement row,
                         a standalone       that entry's          decrements remainingAmount —
                         CorrectionPayment  release (unchanged    repeats until remainingAmount = 0,
                         — settled right    from before this      then SETTLED
                         away              session)
```

Concretely:

- The moment a Correction is approved (whenever `PayrollEntry.released = true` holds), a Balance
  Adjustment is **always** created.
- **If the correction results in zero net difference** (the corrected net salary equals the current
  effective net salary — see "Baseline Reconstruction," above), the Balance Adjustment is still
  created, for full traceability, but with type `NONE` and amount `0`, and is immediately created
  already `SETTLED` (there is nothing to pay or recover, so it never enters the `PENDING` queue or
  appears on any payment artifact). This keeps "every approved Correction always creates a Balance
  Adjustment" literally true without ever showing a meaningless "PKR 0 payable" line anywhere.
  **Unchanged by this session's revisions.**
- **`PAYABLE`, `DEFERRED`** — unchanged from before this session: created `PENDING`, automatically
  surfaces as part of that employee's payroll the next time a Draft cycle is active (whether or not
  the employee happens to have another entry open sooner in the *same* cycle — deferred deliberately
  waits for the next one), and is atomically marked `SETTLED` as part of that cycle's release
  transaction, with `settledInCycleId` recorded.
- **`PAYABLE`, `IMMEDIATE`** (new, 2026-07-05) — settles at approval time itself, not on any future
  release: if the employee already has an unreleased `PayrollEntry` (because, say, another Project
  Unit contributing to their payroll hasn't released yet this cycle), the balance folds into that
  entry's eventual payment, same mechanism as `DEFERRED` just resolved against the current cycle
  instead of waiting for the next one. Otherwise, a standalone `CorrectionPayment`
  (`database-schema.md` §14a) is created immediately, `BalanceAdjustment.status → SETTLED` right away
  (`settledInCycleId` stays null — settlement happened outside any cycle), with its own Bank/Cash
  document, full audit trail, and Statement of Account visibility. **Released `PayrollEntry` rows are
  never modified by this — an `IMMEDIATE` payment is always a new record, never a reopening.**
- **`RECOVERY`** (installment-capable as of 2026-07-05) — created `PENDING`, `remainingAmount` starts
  at the full `amount`. Each future Draft cycle's release checks for `PENDING` `RECOVERY` adjustments
  against that employee and applies `min(recoveryInstallmentAmount ?? remainingAmount, remainingAmount)`
  as a deduction merged into that release's payment amount (same "merged, never a second transfer"
  rule as `PAYABLE`), logging a `BalanceAdjustmentSettlement` row (`database-schema.md` §14b) for that
  cycle's applied amount and decrementing `remainingAmount`. If `remainingAmount` reaches `0`, the
  adjustment becomes `SETTLED` (`settledInCycleId` = that cycle); otherwise it stays `PENDING` and the
  same automatic mechanism applies again next cycle, with no further human action required.
  `recoveryInstallmentAmount` defaults to `NULL` (recover the full remaining amount in one cycle — the
  original, unchanged behavior) and is Master-User-editable at any time before full settlement, exactly
  like `Advance.scheduledInstallmentAmount`'s already-established editable-schedule pattern
  (`docs/IMPLEMENTATION_PLAN.md` Phase 4) — editing the schedule is itself a distinct, audited action,
  never a silent recalculation.
- If, for some reason, an employee with a `PENDING` Balance Adjustment (`DEFERRED` `PAYABLE` or any
  stage of a `RECOVERY` installment) is **held** rather than released in a given cycle, that
  adjustment's settlement for this cycle is simply skipped — no `BalanceAdjustmentSettlement` row is
  written for a held cycle — and it automatically carries forward again to the *next* Draft cycle,
  same automatic mechanism, not a manual re-queue.

**Payroll administrators never manually move a Balance Adjustment between cycles, and never manually
mark one settled.** The only human decisions in this pipeline are (a) approving the Correction in the
first place, with its mandatory reason and Adjustment Type, (b) for a `PAYABLE`, choosing Immediate or
Deferred at that same approval moment, (c) for a `RECOVERY`, optionally setting or later adjusting a
per-cycle installment amount (defaulting to full recovery next cycle if never touched), and (d) the
ordinary release/hold decision for that employee in each Draft cycle — the balance's appearance and
settlement follow from those automatically.

## Representation in Bank Sheets, Cash Sheets, and Payslips

**A Balance Adjustment settling *through* an ordinary cycle release is merged into the employee's
ordinary payment for that cycle — it is never a second bank transfer or a second row within that
release.** This is a final, approved decision, driven by how a real bank bulk-transfer batch actually
works: a Bank Sheet submitted to a bank is a batch of (account number, amount) pairs, and sending two
line items to the same account in one batch isn't a reliable operation to depend on. This applies to
`DEFERRED` `PAYABLE` settlements and every `RECOVERY` installment, unchanged.

**Revised 2026-07-05 — an `IMMEDIATE` `PAYABLE` with no open entry to fold into is the one exception,
by design, not a violation of the rule above:** it settles via a standalone `CorrectionPayment`
(`database-schema.md` §14a), which is not part of any ordinary cycle's Bank Sheet/Cash Sheet at all —
it's its own one-off document, precisely because there is no ordinary release happening for that
employee to merge into (every entry they currently have is already released, per Principle 9, and is
never reopened). The "never two rows in one release" rule is about not splitting *one release's*
payment into two transfers; a `CorrectionPayment` isn't part of any release, so there's nothing it
could split.

- **Bank Sheet** — exactly one row per employee, per cycle release. `Amount = PayrollEntry.netSalary ±
  the sum of all Balance Adjustments settling *in this release*` (`PAYABLE` adds, `RECOVERY`
  subtracts — for an installment `RECOVERY`, only *this cycle's* applied installment amount, not the
  full remaining balance).
- **Cash Receiving Sheet** — same rule, one row per employee, same combined amount.
- **`CorrectionPayment` document** (new, 2026-07-05) — its own single-row Bank/Cash-style document,
  generated on demand at the moment an `IMMEDIATE` `PAYABLE` settles with no open entry to fold into.
  Not part of any `PayrollCycle`'s ordinary sheets, but held to the same traceability and export-
  matches-underlying-data standard (Principle 6) as every other generated document.
- **Payslip** — shows the Balance Adjustment as its own distinct line item (with its remark), in
  addition to the ordinary earning/deduction breakdown, since a payslip is not constrained by
  bank-batch formatting and this is where the breakdown belongs. For an installment `RECOVERY`, shows
  *this cycle's* applied installment amount and the remaining balance after it, not the original total.
- **Statement of Account** — shows the Correction and its resulting Balance Adjustment as fully
  separate ledger entries, exactly as already described (§7, above) — unaffected by how the payment
  itself is transferred. For an installment `RECOVERY`, shows each `BalanceAdjustmentSettlement` row
  (`database-schema.md` §14b) as its own dated line, so the employee's ledger reads as a clean
  per-cycle recovery history rather than one opaque total.

There must never be two bank transfers, two cheques, or two payment rows for the same employee within
one ordinary cycle release. The Bank Sheet/Cash Sheet total must still exactly equal what is actually
paid *in that release* (Principle 6); the *traceability* requirement that a balance must never look
like an ordinary allowance is satisfied by the Payslip and Statement of Account carrying the
breakdown, not by splitting the payment itself.

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
  for a `NONE`-type row, or for an `IMMEDIATE` `PAYABLE` settled via a standalone `CorrectionPayment`
  outside any cycle — added 2026-07-05)
- The display remark (§6, above)
- **Added 2026-07-05:** `paymentTiming` (`IMMEDIATE`/`DEFERRED`, `PAYABLE`-only, chosen at approval);
  `recoveryInstallmentAmount`/`remainingAmount` (`RECOVERY`-only, enabling multi-cycle installment
  recovery instead of only a single-cycle full deduction) — see `database-schema.md` §14. Two new
  companion tables round out the model: `CorrectionRequest` (§13a, the pending-approval predecessor to
  a `Correction`) and `CorrectionPayment` (§14a, the standalone artifact for an `IMMEDIATE` `PAYABLE`
  with no open entry) and `BalanceAdjustmentSettlement` (§14b, the per-cycle installment history for a
  `RECOVERY`).

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
- **Master User** (renamed from "Master Admin" 2026-07-05, same role, no functional change) approval
  and a mandatory reason are still required to confirm any correction wherever the trigger condition
  in "When this applies" holds — whether reached directly or by approving a `CorrectionRequest` (added
  2026-07-05, above).
- The correction is still logged permanently and shown in the employee's Statement of Account.

What changes is only what happens *after* approval: instead of quietly folding the diff into next
month's ordinary payroll fields, the system creates an explicit, clearly-labeled balance transaction
that is settled (paid or recovered, immediately or across one or more future cycles as of 2026-07-05)
as its own traceable item.
