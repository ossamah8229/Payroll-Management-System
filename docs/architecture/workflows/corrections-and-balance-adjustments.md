# Corrections & Balance Adjustments Workflow

**Owner module(s):** Corrections; Balance Adjustments

**Contains:** The post-release correction workflow in full — when it applies, the request/approval
split, the settlement rule, standardized Adjustment Types, baseline reconstruction for sequential
corrections, the automatic settlement pipeline, document representation, and interaction with Advances

**Sections:** no §-numbered content of its own (a prose workflow narrative, moved unchanged from the
former `post-release-corrections.md`) · Full database index: `database/README.md`

For the schema this workflow governs, see `database/corrections.md` (`AdjustmentType`, `Correction`,
`CorrectionRequest`) and `database/balance-adjustments.md` (`BalanceAdjustment`, `CorrectionPayment`,
`BalanceAdjustmentSettlement`) — this file is the workflow narrative only; it does not restate their
column lists. Per the Documentation Ownership Rule (`docs/architecture/folder-structure.md`), the
schema is authoritative in those files, not here.

This refines and supersedes the correction-workflow mechanics described in `PROJECT_SPEC.md` and the
prototype. The prototype's approach (silently bump next month's `allowance` or `advance` field by the
diff) is **not** carried into production — this document describes the replacement.

## Why this changes

Payroll Release represents that funds have already been physically disbursed — a bank transfer has
gone out, or cash has been handed over. Once that has happened, "correcting the salary" cannot mean
recalculating and re-displaying a new full salary figure for that historical cycle: the number that
was actually paid is a fact of record, not a draft.

## When this applies

Stated once, authoritatively, in `docs/architecture/workflows/payroll-lifecycle.md §4`, and never
rephrased differently anywhere in this document set:

> **A `PayrollEntry` requires the Correction workflow whenever `PayrollEntry.released = true`.**

**Simplified 2026-07-05 (Phase 3 architecture review)** from the original two-clause "individually
released, OR its parent `PayrollCycle` is no longer in Draft" — release now happens at Project Unit
granularity (`docs/architecture/workflows/payroll-lifecycle.md §4`), and `PayrollCycle.status` is
itself derived from every Unit having released or been held, so it can never diverge from entry-level
`released` any more. Everything below applies whenever `released = true` holds, regardless of whether
that happened via the ordinary per-Unit sweep or a Late Entry's own one-off release
(`database/release.md §12b`).

## Correction Requests — proposing vs. deciding a correction

**Added 2026-07-05.** A new business rule separates *who may propose* a correction from *who may
decide* one: "correction requests may be initiated by any authorized payroll user, but approval
belongs to the Master User." Two paths now exist, both producing an identical `Correction` row
(`database/corrections.md §13`):

1. **Direct correction** — unchanged from before this session. A Master User corrects a released
   entry personally. Because they *are* the approver, no separate request/approval step applies — this
   was always true of pre-release edits (any payroll manager may freely edit until release) and is now
   stated explicitly for the post-release case too: **"if the Master User makes the correction
   personally, no separate approval workflow is required."**
2. **Correction Request** (new, `CorrectionRequest`, `database/corrections.md §13a`) — any other
   authorized payroll user proposes a field, a new value, an Adjustment Type, and a mandatory reason.
   It sits `PENDING` until a Master User reviews it:
   - **Approve** — the Master User may adjust the proposed field/value/Adjustment Type before
     confirming; approval creates the `Correction` (+ its `BalanceAdjustment`, below) in the same
     transaction as marking the request `APPROVED` and linking it to the resulting `Correction`.
   - **Reject** — the request is marked `REJECTED` with a mandatory rejection reason (mirroring the
     "reason mandatory" convention applied to the correction itself); no `Correction` or
     `BalanceAdjustment` is created, and the underlying `PayrollEntry` is untouched.
   Either outcome is a permanent, audited record — a `CorrectionRequest` is never edited or deleted
   once decided (`database/corrections.md §13a`).

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
approvedAt DESC)` is indexed to make this replay cheap (see `database/corrections.md §13`).

## Automatic Settlement Workflow

Settlement of a Balance Adjustment is **fully automatic** — there is no manual step where a payroll
administrator transfers or moves a balance from one cycle to another. **Revised 2026-07-05:** the
pipeline now branches by `type`, but every branch remains automatic once the one human timing/spread
decision is made at approval:

**Scope note, Phase 6 Checkpoint 4 (2026-07-18):** the *automatic* pipeline this section
describes — a cycle's own release process discovering and sweeping every `PENDING` `BalanceAdjustment`
it owes or can recover, without further human action — is **not yet built**; it requires touching
`payroll-processing`/`payroll-release` service code (Draft-cycle materialization), explicitly out of
Checkpoint 4's own scope. What Checkpoint 4 *does* implement is the underlying **recording**
capability this automatic pipeline will eventually call into: given a specific `BalanceAdjustment`
and (for the cycle-scoped path) a specific, already-existing `PayrollCycle`, record that a payment
or settlement amount was applied — creating the immutable `CorrectionPayment`/
`BalanceAdjustmentSettlement` row and updating `remainingAmount`/`status` accordingly, inside one
transaction-scoped advisory lock. A Master User can therefore record a settlement manually today
(`POST /balance-adjustments/:id/payments` or `.../settlements`); a future checkpoint's automatic
sweep will call the same underlying mechanism rather than reinventing it. **Departed-employee
`RECOVERY` handling is implemented exactly as this document's own edge-case guidance requires**
(Product Decision Resolution: "Recovery from departed employees remains permanently pending") — no
settlement path, automatic or manual, exists for it; no receivables/collections system exists
anywhere in this codebase, the same accepted gap already tolerated for an uncollectable `Advance`.

**Scope note, Phase 6 Checkpoint 5 (2026-07-18):** Checkpoint 5 builds a distinct, additional
mechanism this section's diagram does not yet show — **Draft-cycle materialization**
(`BalanceAdjustmentMaterialization`, a new table) — and it is important not to conflate it with the
"automatically surfaces... settled on that entry's release" pipeline narrated above, which **remains
not yet built**. What Checkpoint 5 actually does: for an eligible `PENDING` `PAYABLE` (`DEFERRED`
only) or `RECOVERY` `BalanceAdjustment`, it projects the amount that *would* settle into the current
Draft cycle's own `PayrollEntry` — via two new aggregate columns, `correctionBalancePayable`/
`correctionBalanceRecovery`, that feed `calcNet` — so the obligation is visible in that entry's own
calculated net salary while the cycle is still Draft. **It is a reservation, not a settlement**: a
materialization row never touches `BalanceAdjustment.remainingAmount`/`.status`, and never creates a
`CorrectionPayment`/`BalanceAdjustmentSettlement`. Actually marking the obligation settled (the
`remainingAmount` decrement, the `SETTLED` status flip, the `BalanceAdjustmentSettlement` row this
section describes) still requires Checkpoint 4's own manual recording action — release does not yet
automatically call it. Over-materialization across sequential Draft cycles is prevented by an
`availableToMaterialize = remainingAmount − Σ(ACTIVE reservations across every cycle)` formula,
re-derived on every attempt; one `BalanceAdjustment` may only ever have one `ACTIVE` reservation per
target cycle (a database unique constraint), making a repeated or concurrent materialization attempt
against the same adjustment+cycle a safe, idempotent no-op. Materialization is wired automatically
into `archiveAndCreateNextPayrollCycle` (the same "Materialization Hook" extensibility seam Advances'
`materializeScheduledAdvanceDeductions` already established) and is also available as a manual
per-adjustment or per-cycle-batch action, both reusing the existing `payroll:entry`/
`corrections:approve` permissions — no new permission key, no frontend surface, no Corrections
Ledger. Departed-employee `RECOVERY` is never materialized, the identical Product Decision
Resolution rule already enforced for settlement above.

**Scope note, Phase 6 Checkpoint 5A (2026-07-18) — reservation-aware settlement.** A post-Checkpoint-5
architectural review found a genuine gap at the seam between the two paragraphs above: Checkpoint 4's
settlement recording (`recordCorrectionPayment`/`recordBalanceAdjustmentSettlement`) validated a
proposed amount only against `remainingAmount`, never against Checkpoint 5's own reservation ledger.
Since a materialization never touches `remainingAmount`/`.status`, an amount already reserved into a
Draft cycle's own `PayrollEntry` (and therefore already counted in that entry's `calcNet`, headed for
payment/deduction at that cycle's eventual release) could *also* be settled independently — the same
obligation processed twice. Every settlement path (standalone, cycle-scoped, and the read-only
preview) now reads the same `getActiveReservedAmount` ledger `determineMaterialization` reads and
rejects (`RESERVED_AMOUNT_UNAVAILABLE`) a settlement that would exceed `remainingAmount −
Σ(ACTIVE reservations)`. This does not change who is allowed to settle or materialize, add a new
permission, or touch the schema — it only makes the settlement-side ceiling reservation-aware, mirroring
the ceiling materialization already enforced. The reverse direction (settle first, materialize second)
was already safe: materializing a `SETTLED` adjustment is rejected (`FULLY_SETTLED`), and a partial
settlement's `remainingAmount` decrement is read fresh by any later materialization attempt.

**Scope note, Phase 6 Checkpoint 6 (2026-07-19) — the frontend operational workflow.** Every
mechanism described above through Checkpoint 5A is now reachable from the UI, under a new
`/corrections` area: a Review Queue (`corrections:approve`) and a Corrections Ledger (`payroll:entry`
or `corrections:approve`), request creation from an eligible Released/Archived Payroll Entry with a
live preview, approve/reject dialogs, and BalanceAdjustment detail (materializations, settlement
history, and a reservation-aware "Record Settlement" action that mirrors the server's own
`RESERVED_AMOUNT_UNAVAILABLE` ceiling for display and disables the standalone-payment path outright
while any amount is actively reserved). No new financial lifecycle, no `CONSUMED`/`CANCELLED`
materialization transition, and no automatic settlement-on-release were added — the frontend is a
presentation/orchestration layer only, and every write still goes through the exact backend
transactions this document already describes. Two minimal, read-only backend additions were required
and are covered by this checkpoint's own explicit "backend read projection" allowance: `GET
/adjustment-types` (no route previously listed this lookup table, needed for the request-creation
form's required foreign key) and `GET /balance-adjustments` (a list route over the existing
`balanceAdjustmentDetailInclude` shape — the Corrections Ledger's own data source, explicitly
deferred by Checkpoint 4's own scope note above, "out of this checkpoint's scope"). Neither adds a
migration, a new permission key, or a new lifecycle state.

**Scope note, Phase 6 Checkpoint 7 (2026-07-19) — the `ACTIVE -> CONSUMED` transition, closing the
loop every prior checkpoint above deliberately deferred.** Validation for this checkpoint found a
genuine correctness gap: once a `DEFERRED PAYABLE` or `RECOVERY` obligation materialized into a
Draft cycle (Checkpoint 5), nothing ever settled it — Checkpoint 5A's own reservation-aware ceiling
(`RESERVED_AMOUNT_UNAVAILABLE`) correctly blocks a standalone/cycle-scoped settlement from
double-processing an actively-reserved amount, but no mechanism ever *resolved* that reservation
either, so a materialized obligation could never reach `SETTLED` through any supported workflow —
the exact "Materialize → Payroll Release → Outstanding cleared" flow this document's own diagrams
imply never actually completed. This is now fixed, using the `settlementId`/`consumedAt` columns
`BalanceAdjustmentMaterialization` has carried, unused, since Checkpoint 5's own schema (no
migration required): `payroll-release.service.ts`'s `releaseProjectUnit` — the exact moment a
`PayrollEntry` transitions `released: false -> true`, the schema's own definition of "the
triggering PayrollEntry release" a `DEFERRED PAYABLE`/`RECOVERY` settles through (§14, above) — now
also acquires `lockPayrollCycleForUpdate` (becoming a third participant in Checkpoint 5's documented
"cycle, then adjustment" lock order) and, immediately after sweeping those entries `released`,
consumes every `ACTIVE` `BalanceAdjustmentMaterialization` reserved against them: one
`BalanceAdjustmentSettlement` row per materialization (`amountApplied` = the materialization's own
reserved amount, reusing `calculateSettlement` unchanged), `BalanceAdjustment.remainingAmount`
decremented, `.status -> SETTLED` only when it reaches zero (a `RECOVERY` installment plan may take
several releases), and the materialization itself flipped `ACTIVE -> CONSUMED` with its
`settlementId`/`consumedAt` populated — all inside `releaseProjectUnit`'s own existing transaction,
so a failed release leaves no settlement, no consumption, and no audit residue. A companion
eligibility fix closes the race this makes load-bearing: `determineMaterialization` now also
rejects a target `PayrollEntry` that has already released (`TARGET_ENTRY_ALREADY_RELEASED`) — without
it, a manual materialization racing a concurrent release could still write into an immutable
released entry and create a reservation no future release event for that entry could ever consume.
**`CANCELLED` remains unbuilt** — an entry `hold`-marked after its obligation already materialized
into that cycle leaves that one reservation permanently `ACTIVE` (a pre-existing, narrow edge case,
not introduced by this fix); no rollback/lifecycle requirement has yet proven a `CANCELLED` path
necessary. No schema migration, no new permission key, no new financial lifecycle — this is the
existing, already-designed-for lifecycle's own final link.

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
  **Unchanged by this session's revisions.** **Amended, Phase 6 Checkpoint 3 (2026-07-18):** as of
  Checkpoint 2's calculation engine and Checkpoint 3's transactional approval, a zero-net-difference
  correction is rejected outright at approval time (`ZERO_DELTA`, a typed domain error) — no
  `Correction` and no `BalanceAdjustment` are created at all. This `NONE` path is therefore **not
  reachable through the ordinary single-field correction/approval workflow** described in this
  document; `BalanceAdjustmentType.NONE` remains in the schema (not removed — a schema change is
  out of scope for a documentation clarification) purely for forward compatibility with a future
  multi-field or batch-correction scenario where the *combined* effect might still legitimately net
  to zero while individual fields change. No checkpoint currently builds a path that reaches it.
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
  (`database/balance-adjustments.md §14a`) is created immediately, `BalanceAdjustment.status →
  SETTLED` right away (`settledInCycleId` stays null — settlement happened outside any cycle), with
  its own Bank/Cash document, full audit trail, and Statement of Account visibility. **Released
  `PayrollEntry` rows are never modified by this — an `IMMEDIATE` payment is always a new record,
  never a reopening.**
- **`RECOVERY`** (installment-capable as of 2026-07-05) — created `PENDING`, `remainingAmount` starts
  at the full `amount`. Each future Draft cycle's release checks for `PENDING` `RECOVERY` adjustments
  against that employee and applies `min(recoveryInstallmentAmount ?? remainingAmount, remainingAmount)`
  as a deduction merged into that release's payment amount (same "merged, never a second transfer"
  rule as `PAYABLE`), logging a `BalanceAdjustmentSettlement` row (`database/balance-adjustments.md
  §14b`) for that cycle's applied amount and decrementing `remainingAmount`. If `remainingAmount`
  reaches `0`, the adjustment becomes `SETTLED` (`settledInCycleId` = that cycle); otherwise it stays
  `PENDING` and the same automatic mechanism applies again next cycle, with no further human action
  required. `recoveryInstallmentAmount` defaults to `NULL` (recover the full remaining amount in one
  cycle — the original, unchanged behavior) and is Master-User-editable at any time before full
  settlement, exactly like `Advance.scheduledInstallmentAmount`'s already-established editable-schedule
  pattern (`docs/IMPLEMENTATION_PLAN.md` Phase 4) — editing the schedule is itself a distinct, audited
  action, never a silent recalculation.
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
(`database/balance-adjustments.md §14a`), which is not part of any ordinary cycle's Bank Sheet/Cash
Sheet at all — it's its own one-off document, precisely because there is no ordinary release happening
for that employee to merge into (every entry they currently have is already released, per Principle 9,
and is never reopened). The "never two rows in one release" rule is about not splitting *one release's*
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
  (`database/balance-adjustments.md §14b`) as its own dated line, so the employee's ledger reads as a
  clean per-cycle recovery history rather than one opaque total.

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
`database/payroll-entry.md §12`) record, at the time the deduction was originally entered,
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
approved correction — including the zero-difference `NONE` case, above), together with its companion
tables `CorrectionRequest` (the pending-approval predecessor to a `Correction`), `CorrectionPayment`
(the standalone artifact for an `IMMEDIATE` `PAYABLE` with no open entry to fold into), and
`BalanceAdjustmentSettlement` (the per-cycle installment history for a `RECOVERY`). **For the exact
column list, types, and constraints, see `database/balance-adjustments.md §14–§14b` and
`database/corrections.md §13a`** — that is the authoritative schema; it is intentionally not restated
here, per the Documentation Ownership Rule (`docs/architecture/folder-structure.md`).

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
