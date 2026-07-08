# Corrections Schema — `AdjustmentType`, `Correction`, `CorrectionRequest`

**Owner module(s):** Corrections

**Contains:** `AdjustmentType`, `Correction`, `CorrectionRequest`

**Sections:** §11, §13–§13a · Full index: `database/README.md`

For the Corrections *workflow* (baseline reconstruction, standardized Adjustment Types, request/
approval mechanics), see `docs/architecture/workflows/corrections-and-balance-adjustments.md` — this
file is the schema only.

---

## 11. `AdjustmentType`

**Purpose:** The standardized classification list for Corrections
(`docs/architecture/workflows/corrections-and-balance-adjustments.md`).
**Why it exists:** Extensible lookup table instead of a native enum, so new types don't require a
migration (Principle 8).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `code` | varchar(40) | no | — | e.g. `ATTENDANCE_CORRECTION` |
| `label` | varchar(120) | no | — | display label, e.g. "Attendance Correction" |
| `isActive` | boolean | no | `true` | retire a type without breaking historical Corrections that reference it |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `code`
- **Seed data:** the 7 initial types — Attendance Correction, Overtime Correction, Salary Revision,
  Leave Adjustment, Fine Adjustment, Advance Recovery, Manual Adjustment
- **Module owner:** Corrections
- **Row count:** single digits, grows slowly

## 13. `Correction`

**Purpose:** A single approved change to one field of a `PayrollEntry` that has released
(`database/payroll-entry.md §12`) — the trigger condition stated once in
`docs/architecture/workflows/payroll-lifecycle.md §4`.
**Why it exists:** The only permitted mechanism for changing a locked entry's outcome — never a
direct edit (Principle 9).
**Business rule tie-in:** `docs/architecture/workflows/corrections-and-balance-adjustments.md` in full.
**Revised 2026-07-05 (Phase 3 architecture review) — trigger condition simplified to one clause:**
previously stated as "individually released, **OR** its parent cycle is no longer Draft." Now that
`PayrollCycle.status` is itself derived from every Unit having released-or-been-held
(`database/payroll-cycle.md §10`), Cycle status can never diverge from entry-level `released` — so the
second clause is no longer an independent condition, it's implied by the first. The trigger is now
simply: **`PayrollEntry.released = true`.**
**Also revised 2026-07-05 — a `Correction` may now originate two ways:** (1) unchanged — a Master
User creates one directly, with no separate approval step, since they *are* the approver; (2) new —
approving a `CorrectionRequest` (§13a), submitted by any authorized payroll user, produces exactly one
`Correction` row in the same transaction as the request's own approval. Either path produces an
identical `Correction` row; nothing downstream (baseline reconstruction, `BalanceAdjustment` creation)
distinguishes which path produced it.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `payrollEntryId` | uuid | no | — | FK → `PayrollEntry.id`, `ON DELETE RESTRICT` |
| `field` | `CorrectionField` | no | — | which field was corrected |
| `oldValue` | varchar(80) | no | — | string representation of the field's *current effective* value immediately before this correction — i.e., reflecting any prior approved correction to this same field, not necessarily the original `PayrollEntry` value (see "Baseline Reconstruction," below) |
| `newValue` | varchar(80) | no | — | string representation of the corrected value |
| `oldNetSalary` | numeric(12,2) | no | — | `calcNet` result on the entry's current effective state (`database/payroll-entry.md §12`) before this change |
| `newNetSalary` | numeric(12,2) | no | — | `calcNet` result after this change (trial computation, never written back to `PayrollEntry`) |
| `adjustmentTypeId` | uuid | no | — | FK → `AdjustmentType.id`, `ON DELETE RESTRICT` |
| `reason` | text | no | — | mandatory, free-text explanation |
| `approvedById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — must hold the Corrections-approval permission (Master User), enforced at the application layer |
| `approvedAt` | timestamptz | no | `now()` | |

**Baseline reconstruction:** since `PayrollEntry` is never mutated, a *second* (or later) correction
against the same entry cannot use the stored row as its "old" baseline — doing so would ignore any
already-approved prior correction. Instead, `oldValue`/`oldNetSalary` are computed by reconstructing
the entry's current effective state: for every `CorrectionField`, take the `newValue` of the most
recent approved `Correction` for that `payrollEntryId` + `field`, or the stored `PayrollEntry` value
if none exists; run `calcNet` over that reconstructed state. This is recomputed fresh from the full
history every time (never cached), so it's always independently verifiable — see
`docs/architecture/workflows/corrections-and-balance-adjustments.md` ("Baseline Reconstruction for
Sequential Corrections") for the full algorithm and rationale.

- **Check constraints:** `length(trim(reason)) > 0` (a reason of only whitespace is not a reason)
- **Indexes:** (`payrollEntryId`); composite (`payrollEntryId`, `field`, `approvedAt` desc) — the
  "latest correction for this field" lookup the baseline-reconstruction algorithm depends on;
  (`adjustmentTypeId`); (`approvedAt`) for chronological/audit views; (`approvedById`)
- **Cascade:** all FKs `RESTRICT`
- **Module owner:** Corrections
- **Immutable, append-only:** yes — a `Correction`, once approved, is never edited or deleted; a
  mistaken correction is itself corrected via a new `Correction`, not by editing this row
- **Transactions required:** yes — creating a `Correction` must, in the same transaction, create its
  `BalanceAdjustment` (`database/balance-adjustments.md §14`) and an `AuditLog` entry
  (`database/audit-log.md §16`); when it originates from an approved `CorrectionRequest` (§13a), that
  request's own `status → APPROVED` update and `resultingCorrectionId` link are part of the same
  transaction too
- **Audit logging:** every `Correction` creation is itself an audited event
- **Row count:** sporadic — realistically tens per month at most across ~1,500 employees

## 13a. `CorrectionRequest`

**Added 2026-07-05, Phase 3 architecture review.** The pending half of the correction workflow that
didn't exist before this session — until now, a `Correction` row was only ever created *already
approved* (§13's `approvedById`/`approvedAt` are `NOT NULL` by design). The new business rule —
"correction requests may be initiated by any authorized payroll user, but approval belongs to the
Master User" — needs a genuine pending/rejected state, which this table provides, without changing
`Correction`'s own always-approved shape at all.

**Purpose:** A proposed correction to one field of a released `PayrollEntry`, awaiting Master User
review.
**Why it exists:** Separates *proposing* a correction (any authorized payroll user) from *deciding*
one (Master User only) — Principle 7's RBAC boundary applies to the decision, not the proposal.
**Business rule tie-in:** `docs/architecture/workflows/corrections-and-balance-adjustments.md`'s
"Correction Requests" section.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `payrollEntryId` | uuid | no | — | FK → `PayrollEntry.id`, `ON DELETE RESTRICT` |
| `field` | `CorrectionField` | no | — | which field the requester believes needs correcting |
| `proposedNewValue` | varchar(80) | no | — | the requester's proposed value — a starting point for the Master User's review, not binding; the eventual `Correction.newValue` may differ if the Master User adjusts it during approval |
| `adjustmentTypeId` | uuid | no | — | FK → `AdjustmentType.id`, `ON DELETE RESTRICT` — the requester's proposed classification, likewise revisable at approval |
| `reason` | text | no | — | mandatory, free-text explanation from the requester |
| `requestedById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` |
| `requestedAt` | timestamptz | no | `now()` | |
| `status` | `CorrectionRequestStatus` | no | `'PENDING'` | `PENDING` / `APPROVED` / `REJECTED` — new native enum (`database/conventions-and-enums.md §1`), closed set mechanically tied to this workflow |
| `reviewedById` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT` — the Master User who approved or rejected; null while `PENDING` |
| `reviewedAt` | timestamptz | yes | — | null while `PENDING` |
| `rejectionReason` | text | yes | — | mandatory when `status = REJECTED` (mirrors `Correction.reason`'s "reason mandatory" convention, applied symmetrically to rejection); always null otherwise |
| `resultingCorrectionId` | uuid | yes | — | FK → `Correction.id`, `ON DELETE RESTRICT`, **unique** (1:1) — set only on approval, never on rejection |

**When the Master User corrects personally instead of reviewing a request:** this table is bypassed
entirely — a `Correction` is created directly (§13), exactly as it already worked before this table
existed. A `CorrectionRequest` is only ever the path when someone *other* than the acting Master User
initiated it, or when the Master User chooses to formalize their own proposal as a request first (not
required, but not prevented either).

- **Check constraints:** `length(trim(reason)) > 0`; `status = 'REJECTED' ⇒ rejectionReason IS NOT
  NULL AND reviewedById IS NOT NULL AND reviewedAt IS NOT NULL`; `status = 'APPROVED' ⇒
  resultingCorrectionId IS NOT NULL AND reviewedById IS NOT NULL AND reviewedAt IS NOT NULL`;
  `status = 'PENDING' ⇒ reviewedById IS NULL AND reviewedAt IS NULL AND resultingCorrectionId IS NULL
  AND rejectionReason IS NULL`
- **Unique constraints:** `resultingCorrectionId` (enforces the 1:1 relationship, where present)
- **Indexes:** (`payrollEntryId`); (`status`) — the "pending requests awaiting review" queue, the hot
  read path for the Master User's own worklist; (`requestedById`); (`reviewedById`)
- **Cascade:** all FKs `RESTRICT`
- **Module owner:** Corrections
- **Immutability:** effectively immutable with **exactly one permitted transition** —
  `PENDING → APPROVED` or `PENDING → REJECTED`, never edited otherwise once decided; mirrors
  `BalanceAdjustment`'s (`database/balance-adjustments.md §14`) single-permitted-transition pattern
  rather than being fully append-only, since (unlike `Correction`) it does have one real state change
  to make
- **Transactions required:** yes — approval creates the `Correction` (+ its own downstream
  `BalanceAdjustment` + `AuditLog`, §13/`database/balance-adjustments.md §14`) and updates this row's
  `status`/`resultingCorrectionId` all together; rejection is a single-row update + `AuditLog` entry
  (`correction_request.rejected`)
- **Audit logging:** creation (`correction_request.created`), approval (folded into the resulting
  `correction.approved` entry, cross-referencing the request), and rejection
  (`correction_request.rejected`) are all audited events
- **Row count:** a subset of eventual `Correction` rows, plus whatever fraction are rejected — smaller
  than `Correction` is unlikely; comparable order of magnitude

---
