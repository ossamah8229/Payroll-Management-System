# Balance Adjustments Schema — `BalanceAdjustment`, `CorrectionPayment`, `BalanceAdjustmentSettlement`

**Owner module(s):** Balance Adjustments (jointly with Release Salary for `CorrectionPayment`'s payment-execution half)

**Contains:** `BalanceAdjustment`, `CorrectionPayment`, `BalanceAdjustmentSettlement`

**Sections:** §14–§14b · Full index: `database/README.md`

For the settlement *workflow* (immediate/deferred timing, installment recovery, Bank Sheet/Payslip
representation), see `docs/architecture/workflows/corrections-and-balance-adjustments.md` — this file
is the schema only.

---

## 14. `BalanceAdjustment`

**Purpose:** The standalone, traceable balance created by an approved Correction — never folded
silently into an ordinary payroll field.
**Why it exists:** `docs/architecture/workflows/corrections-and-balance-adjustments.md` — the entire
reason this table exists is to keep a post-release balance distinct and reportable, rather than
indistinguishable from a normal allowance/advance.
**Revised 2026-07-05 (Phase 3 architecture review) — `PAYABLE` immediate/deferred and `RECOVERY`
installment settlement:** two previously single-shot behaviors now branch by `type`:
- **`PAYABLE`** may settle `IMMEDIATE`ly (folded into the employee's already-open `PayrollEntry` if
  one exists, else a standalone `CorrectionPayment`, §14a) or stay `DEFERRED` (unchanged from before
  this session — automatically surfaces in the next Draft cycle's entry, settled on that entry's
  release). This choice is recorded once, at approval time, in the new `paymentTiming` column.
- **`RECOVERY`** may now settle across **multiple** future cycles as an installment, not only in full
  in the very next one — see the new `recoveryInstallmentAmount`/`remainingAmount` columns and the new
  `BalanceAdjustmentSettlement` child table (§14b), which records each cycle's partial application.
  `recoveryInstallmentAmount = NULL` reproduces the original one-shot-next-cycle behavior exactly (the
  degenerate case of an installment plan with one installment equal to the full amount) — this is a
  purely additive change, no existing `RECOVERY` behavior was removed.
- **`NONE`** is entirely unchanged — still created already `SETTLED`, zero amount, no timing/
  installment concept applies.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `correctionId` | uuid | no | — | FK → `Correction.id`, `ON DELETE RESTRICT`, **unique** (1:1) — created for **every** approved correction, with no exception (including a zero-net-difference correction, typed `NONE` below) |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` — denormalized from `correction → payrollEntry → employee` for fast "pending balances for employee X" lookups; always derived server-side from the approving `Correction`, never accepted as independent input |
| `sourceCycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` — the cycle the correction was made against (this may be `Released` or `Archived`, or a still-`Draft` cycle in which this specific entry was individually released — see the unified trigger condition in `docs/architecture/workflows/payroll-lifecycle.md §4`) |
| `adjustmentTypeId` | uuid | no | — | FK → `AdjustmentType.id`, `ON DELETE RESTRICT` — a direct, denormalized copy of the originating `Correction.adjustmentTypeId`, consistent with `employeeId`/`sourceCycleId` above already being denormalized onto this same row; enables direct filtering/reporting ("all pending Advance Recovery adjustments") without a join |
| `amount` | numeric(12,2) | no | — | absolute value, the *original total* — `0` only when `type = 'NONE'`. For `RECOVERY`, this stays the original total even as it's recovered in installments; see `remainingAmount` below for the live outstanding figure |
| `type` | `BalanceAdjustmentType` | no | — | `PAYABLE`, `RECOVERY`, or `NONE` (zero net difference — see `docs/architecture/workflows/corrections-and-balance-adjustments.md`) |
| `status` | `BalanceAdjustmentStatus` | no | `'PENDING'` | a `NONE`-type row is created already `SETTLED`. For `RECOVERY`, stays `PENDING` across as many cycles as it takes `remainingAmount` to reach zero — this is the one behavior change from before this session, where a single cycle always fully settled it |
| `paymentTiming` | `BalanceAdjustmentPaymentTiming` | yes | — | **added 2026-07-05.** `IMMEDIATE` or `DEFERRED`, set at approval time; meaningful only for `type = PAYABLE`, always `NULL` for `RECOVERY`/`NONE` (negative balances have no immediate option per the business rule; `NONE` needs no timing at all) |
| `recoveryInstallmentAmount` | numeric(12,2) | yes | — | **added 2026-07-05, `RECOVERY`-only.** The per-cycle amount to recover; `NULL` means "recover the full `remainingAmount` in the next cycle" (today's original behavior, unchanged as the default). Staff/Master-User-editable at any time before `remainingAmount` reaches zero, mirroring `Advance.scheduledInstallmentAmount`'s already-established editable-schedule pattern (`docs/IMPLEMENTATION_PLAN.md` Phase 4) — always `NULL` for `PAYABLE`/`NONE` |
| `remainingAmount` | numeric(12,2) | no | (= `amount` at creation) | **added 2026-07-05.** The live outstanding balance still to be recovered/paid. Decremented by each `BalanceAdjustmentSettlement` (§14b) application; reaches `0` exactly when `status` flips to `SETTLED`. For `PAYABLE`/`NONE`, this settles in one step (immediately or on the deferred cycle's release) so it simply jumps from `amount` to `0` — the multi-step decrement pattern is a `RECOVERY`-specific behavior |
| `remark` | text | no | — | auto-composed display remark shown on the Payslip and Statement of Account, per `docs/architecture/workflows/corrections-and-balance-adjustments.md` (the Bank Sheet/Cash Sheet row itself is a single merged amount and carries no per-line remark — see "Representation in Bank Sheets, Cash Sheets, and Payslips") |
| `settledInCycleId` | uuid | yes | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT`; set only at final settlement (when `remainingAmount` reaches zero); always null for a `NONE`-type row |
| `settledAt` | timestamptz | yes | — | set only at final settlement; set immediately (creation time) for a `NONE`-type row |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `correctionId` (enforces the 1:1 relationship to `Correction`)
- **Check constraints:**
  `(type = 'NONE' AND amount = 0 AND status = 'SETTLED') OR (type IN ('PAYABLE','RECOVERY') AND amount > 0)`;
  `status = 'SETTLED' AND type != 'NONE' ⇒ ((settledInCycleId IS NOT NULL AND settledAt IS NOT NULL) OR
  a linked CorrectionPayment exists, §14a — added 2026-07-05, since an IMMEDIATE PAYABLE with no open
  entry to fold into settles outside any cycle)`;
  `status = 'PENDING' ⇒ settledInCycleId IS NULL AND settledAt IS NULL AND type != 'NONE'`;
  `remainingAmount >= 0 AND remainingAmount <= amount` (added 2026-07-05);
  `status = 'SETTLED' ⇒ remainingAmount = 0` (added 2026-07-05);
  `paymentTiming IS NOT NULL ⇒ type = 'PAYABLE'` (added 2026-07-05);
  `recoveryInstallmentAmount IS NOT NULL ⇒ type = 'RECOVERY'` (added 2026-07-05)
- **Indexes:** unique(`correctionId`); composite (`employeeId`, `status`) — the hot lookup ("does this
  employee have a pending balance to include in this Draft cycle"); (`status`) for the "all pending"
  admin view; composite (`adjustmentTypeId`, `status`) for "pending by type" reporting;
  (`sourceCycleId`); (`settledInCycleId`)
- **Cascade:** all FKs `RESTRICT`
- **Module owner:** Balance Adjustments
- **Immutability:** effectively immutable except for `remainingAmount`/`status`/`settledInCycleId`/
  `settledAt` (final settlement) and the staff-editable `recoveryInstallmentAmount` (`RECOVERY` only,
  before full settlement) — performed only by the automatic settlement workflow or an explicit,
  audited installment-amount edit, never a general update route. A `NONE`-type row never transitions
  at all — it's created in its final, settled state.
- **Transactions required:** yes, at multiple points — creation is transactional with its `Correction`
  (`database/corrections.md §13`), and, when the correction is to `ADVANCE_DEDUCTION`/
  `EID_ADVANCE_DEDUCTION`, with the linked `Advance.outstandingBalance` reconciliation
  (`database/advances.md §15`); an `IMMEDIATE` `PAYABLE`'s settlement is transactional with either
  folding into the employee's open `PayrollEntry` or creating a `CorrectionPayment` (§14a), at
  approval time itself, not later; a `DEFERRED` `PAYABLE`'s or a `RECOVERY` installment's settlement is
  transactional with the triggering `PayrollEntry` release, merged into that release's Bank Sheet/Cash
  Sheet payment amount, never a second row (`database/schema-invariants.md §22`, and
  `docs/architecture/workflows/corrections-and-balance-adjustments.md`) — for a `RECOVERY` with more
  `remainingAmount` left after this cycle's installment, the same release transaction also inserts
  this cycle's `BalanceAdjustmentSettlement` row (§14b) and leaves `status = PENDING` for the next
  cycle to continue
- **Audit logging:** creation (including a `NONE`-type creation), each partial/final settlement, and
  any `recoveryInstallmentAmount` edit are all audited events
- **Row count:** a subset of `Correction` rows — smaller still

## 14a. `CorrectionPayment`

**Added 2026-07-05, Phase 3 architecture review.** The standalone artifact for an `IMMEDIATE`
`PAYABLE` `BalanceAdjustment` when the employee has **no** already-open `PayrollEntry` to fold it
into — i.e. every entry they currently have is already released. Generates its own one-off Bank
Sheet/Cash Sheet-style document rather than waiting for or modifying any `PayrollEntry`.
**Purpose:** A one-off, traceable payment settling a `BalanceAdjustment` outside the ordinary
per-Cycle/per-Unit release pipeline.
**Why it exists:** Principle 9 (released payroll is never modified) rules out folding this payment
into an already-released entry; Principle 6 (every exported value must match underlying data) still
requires this payment to be a real, auditable, exportable record, not an off-system side payment.
**Implementation note (2026-07-05):** this table's actual PDF/Excel generation should share
implementation with the Late Entry one-off release's own document (`database/release.md §12b`,
`database/payroll-entry.md §12`'s `lateReason`) where practical — both are structurally "a one-off,
single-row payment artifact outside the normal per-Unit/per-Cycle sheet" — while remaining **separate
business entities** (a `CorrectionPayment` settles a `BalanceAdjustment`; a Late Entry release settles
an ordinary `PayrollEntry`'s first-ever release). Not a schema-level decision — flagged here for
whoever builds Phase 4/6's PDF/Excel generation to reuse a shared single-row-sheet renderer rather
than duplicating it.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `balanceAdjustmentId` | uuid | no | — | FK → `BalanceAdjustment.id`, `ON DELETE RESTRICT`, **unique** (1:1) |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` — denormalized, same convention as `BalanceAdjustment.employeeId` |
| `amount` | numeric(12,2) | no | — | always equals the settling `BalanceAdjustment.remainingAmount` at the moment of payment (always the full `PAYABLE` amount, since `PAYABLE` never installments) |
| `bankId` | uuid | yes | — | FK → `Bank.id`, `ON DELETE RESTRICT` — snapshot copied from `Employee`/`PayrollEntry` at payment time, **copied not linked**, same convention as `PayrollEntry`'s own bank fields (`database/payroll-entry.md §12`), so a later `Employee` bank-detail change never retroactively alters a historical payment record |
| `branchCode` | varchar(20) | yes | — | snapshot, same convention |
| `accountNumber` | varchar(40) | yes | — | snapshot, same convention; null + null `bankId` ⇒ cash payment, same derived rule as everywhere else this is checked |
| `accountTitle` | varchar(160) | yes | — | snapshot, same convention |
| `paidAt` | timestamptz | no | `now()` | |
| `paidById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — the Finance user who executed the payment |

- **Unique constraints:** `balanceAdjustmentId` (enforces the 1:1 relationship)
- **Check constraints:** `amount > 0`
- **Indexes:** unique(`balanceAdjustmentId`); (`employeeId`)
- **Cascade:** all FKs `RESTRICT`
- **Module owner:** Balance Adjustments (jointly with Release Salary for the payment-execution half —
  same cross-module pattern already established between Payroll Processing and Release Salary)
- **Immutable, append-only:** yes — a payment record, once created, is never edited or deleted, same
  convention as `Correction`/`AuditLog`
- **Transactions required:** yes — creation is transactional with flipping the settling
  `BalanceAdjustment.status → SETTLED` (`remainingAmount → 0`, `settledAt` set; `settledInCycleId`
  stays null, per §14's loosened check constraint) and the corresponding `AuditLog` entry
- **Audit logging:** creation is itself an audited event (`correction_payment.paid`)
- **Row count:** a small subset of `PAYABLE` `BalanceAdjustment` rows — only the ones settled
  `IMMEDIATE`ly with no open entry available; expected to be the less common of the two `IMMEDIATE`
  outcomes in practice, most employees have another cycle entry open when a positive correction lands

## 14b. `BalanceAdjustmentSettlement`

**Added 2026-07-05, Phase 3 architecture review.** Append-only history of each cycle's partial
recovery application against an installment-based `RECOVERY` `BalanceAdjustment` — the business
history counterpart to `AuditLog`'s audit history, following the exact precedent already established
by `EmployeeTransferHistory` (`database/employee.md §8b`) for `Employee` transfers.
**Purpose:** One row per cycle in which a `RECOVERY` `BalanceAdjustment` had an installment applied
against it, so Statement of Account and reporting can show a clean per-cycle breakdown ("PKR 2,000
recovered this cycle, PKR 6,000 remaining") without parsing `AuditLog.metadata` JSON.
**Why it exists:** `BalanceAdjustment` (§14) holds only the current aggregate state
(`remainingAmount`, `recoveryInstallmentAmount`) — once an installment plan can span several cycles,
the *history* of which cycles paid down how much is itself a first-class fact worth its own typed,
directly queryable rows, exactly the reasoning that gave `EmployeeTransferHistory` its own table
instead of relying on `AuditLog` alone.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `balanceAdjustmentId` | uuid | no | — | FK → `BalanceAdjustment.id`, `ON DELETE RESTRICT` |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` — the cycle whose release applied this installment |
| `amountApplied` | numeric(12,2) | no | — | `min(recoveryInstallmentAmount ?? remainingAmount-at-the-time, remainingAmount-at-the-time)` — the actual amount this cycle recovered, which may be less than the standing installment amount if it's the final, smaller-than-usual installment |
| `appliedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`balanceAdjustmentId`, `cycleId`) — a given `BalanceAdjustment` is
  recovered at most once per cycle (an employee held in a cycle simply has no row for it that cycle,
  per the existing "held ⇒ carries forward unchanged" rule, unaffected by this addition)
- **Check constraints:** `amountApplied > 0`
- **Indexes:** (`balanceAdjustmentId`) — the "full recovery history for this balance" lookup, the
  primary Statement of Account read path; (`cycleId`)
- **Cascade:** both FKs `RESTRICT`
- **Module owner:** Balance Adjustments
- **Immutable, append-only:** yes — same convention as `EmployeeTransferHistory`/`Correction`/
  `AuditLog`; a mistaken installment application is never edited here, only reflected going forward
- **Transactions required:** yes — inserted in the same transaction as the triggering cycle's release
  sweep (`database/release.md §12b`) and the parent `BalanceAdjustment.remainingAmount` decrement (and,
  if this installment brings `remainingAmount` to zero, the parent's `status → SETTLED`/
  `settledInCycleId`/`settledAt`)
- **Row count:** one row per cycle an installment-based `RECOVERY` actually settles against — bounded
  by (number of installment `RECOVERY` adjustments) × (typical installment count), expected to stay
  small relative to `PayrollEntry`

---
