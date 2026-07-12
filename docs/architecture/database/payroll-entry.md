# Payroll Entry Schema — `PayrollEntry`, `PayrollEntryWorkLine`

**Owner module(s):** Payroll Entry

**Contains:** `PayrollEntry`, `PayrollEntryWorkLine`

**Sections:** §12–§12a · Full index: `database/README.md`

---

## 12. `PayrollEntry`

**Purpose:** The single editable record of one employee's monthly payroll figures for one cycle —
the system's single source of truth (Principle 1).
**Why it exists:** Everything downstream (Release, Bank Sheets, Cash Receiving, Statements, Payslips)
is a read-only derivation of this table; nothing else stores an independently-editable copy of a
payroll figure.
**Business rule tie-in:** Principles 1, 2, 5, 6, 9.
**Revised 2026-07-03 — attendance fields moved to `PayrollEntryWorkLine` (§12a):** `days`, `otHours`,
`otRate`, and `cycleDays` are **removed from this table** and now live exclusively on the new
`PayrollEntryWorkLine` child table — every `PayrollEntry` has **at least one** work line, always
(never zero, never optional), created transactionally in the same operation that creates the entry
itself. This is what lets an employee's attendance be attributed to more than one `ProjectUnit`
within a single cycle (an occasional but explicitly supported workflow — see §12a) without
special-casing "split" vs. "ordinary" entries anywhere: `calcNet` always sums across an entry's work
lines, and an ordinary single-unit entry is simply the case where that sum has one term. `grossPay`,
`allowance`, `leaveDays`, `leaveRate`, EOBI, advance/eid deduction, and `fine` all stay here, unchanged
— none of them are attendance-location data (gross pay in particular was verified 2026-07-03 to be
documented nowhere as unit-varying, see `database/employee.md §9`'s matching note).
**Revised 2026-07-05 (Phase 3 architecture review) — release moves to Project Unit granularity:**
`released`/`releasedAt`/`releasedBy` (below) keep their existing shape and query patterns unchanged,
but are no longer set by a direct per-employee release action. They are now **derived**: set
transactionally the moment every distinct `ProjectUnit` this entry's work lines touch has its own
`PayrollUnitRelease` row (`database/release.md §12b`) for this cycle — an entry with work lines at two
Units waits for *both* to release before it releases at all, preserving the one-entry/one-`netSalary`/
one-Bank-Sheet-row model (Principle 1, Principle 6) unchanged even for a genuinely split employee. See
`database/release.md §12b` for the full mechanism, and the new `lateReason` column below for the one
exception (an entry created after its Unit has already released this cycle).
**Revised 2026-07-07 (Phase 3 Checkpoint 0, implementation) — two approved deviations from this
section as it stood before today:** (1) **`advanceId`/`eidAdvanceId` are deferred to Phase 4.** Both
are FKs to `Advance` (`database/advances.md §15`), a table Phase 4 builds — Checkpoint 0 cannot create
a live FK to a table that doesn't exist yet, and building a premature `Advance` stub just to satisfy
the FK would contradict this project's own anti-premature-abstraction discipline. Both nullable
columns (and their indexes) are added later, additively, in a Phase 4 migration (Principle 8) —
nothing else about this table's design changes as a result; every other column below is implemented in
Checkpoint 0's `20260707120000_payroll_cycle_and_entry` migration. (2) **`remarks` is added**, a
free-text column with no prior mention in this section — an explicitly approved Checkpoint 0
addition (not merely filling a documentation gap), ordinarily Draft-editable like every other field
here, frozen into the permanent snapshot once released, and intended to render as the last column
of the Payroll Entry grid (a later, UI-focused checkpoint's concern).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT` — copied from `Employee` at entry creation, then ordinarily Draft-editable, see note below. Every work line under this entry (§12a) must belong to a `ProjectUnit` under this same site — database-guaranteed via a composite FK, same mechanism as `Employee.unitId` (`database/employee.md §9`) |
| `designation` | varchar(80) | no | — | copied from `Employee.designation` at entry creation, then ordinarily Draft-editable |
| `bankId` | uuid | yes | — | FK → `Bank.id`, `ON DELETE RESTRICT` — copied from `Employee` at entry creation, then ordinarily Draft-editable |
| `branchCode` | varchar(20) | yes | — | the employee's own bank branch code, copied from `Employee` at entry creation, then ordinarily Draft-editable — unrelated to `ProjectUnit.code` (`database/sites-and-units.md §8a`), same distinction noted in `database/employee.md §9` |
| `accountNumber` | varchar(40) | yes | — | copied from `Employee` at entry creation, then ordinarily Draft-editable |
| `iban` | varchar(34) | yes | — | **Added 2026-07-11, replacing `accountTitle` (removed the same pass — no longer stored anywhere on this table either).** Copied from `Employee` at entry creation, then ordinarily Draft-editable, same as every other banking field here. Bank Sheet's "Title of Account" column (the frozen client format still requires one) is derived from this entry's own `employee.name` at read time instead — see `database/relationships.md`'s Bank Sheets note and `bank-sheets.service.ts`'s `buildRow` |
| `grossPay` | numeric(12,2) | no | — | this cycle's gross pay — editable in Draft; a single scalar regardless of how many units this cycle's work lines cover, see the 2026-07-03 revision note above |
| `allowance` | numeric(12,2) | no | `0` | |
| `leaveDays` | numeric(5,2) | no | `0` | claimed leave — stays employee-level, not attributed to a specific unit: leave is absence from work entirely, not location-specific attendance |
| `leaveRate` | numeric(10,2) | yes | — | null ⇒ derive from `grossPay / cycleDays` using the entry's **primary work line's** `cycleDays` (its lowest `sortOrder`, §12a) as the basis when more than one line exists |
| `eobiAmount` | numeric(10,2) | no | `400.00` | |
| `eobiApplicable` | boolean | no | `true` | |
| `advanceDeduction` | numeric(12,2) | no | `0` | this cycle's loan installment |
| `advanceId` | uuid | yes | — | **Deferred to Phase 4 (2026-07-07) — not in Checkpoint 0's migration.** FK → `Advance.id`, `ON DELETE RESTRICT` — the specific `LOAN`-type advance this deduction reduces, recorded at the time the deduction is entered (auto-linked to the employee's current `ACTIVE` loan). Never re-inferred later — see `database/advances.md §15` and `docs/architecture/workflows/corrections-and-balance-adjustments.md` ("Interaction with Advances") for why a later correction must reconcile against this exact stored link. |
| `eidAdvanceDeduction` | numeric(12,2) | no | `0` | this cycle's Eid advance installment |
| `eidAdvanceId` | uuid | yes | — | **Deferred to Phase 4 (2026-07-07) — not in Checkpoint 0's migration.** FK → `Advance.id`, `ON DELETE RESTRICT` — same, for the `EID_ADVANCE`-type advance |
| `fine` | numeric(12,2) | no | `0` | |
| `hold` | boolean | no | `false` | |
| `released` | boolean | no | `false` | per-employee release flag — **derived** as of 2026-07-05, see the revision note above; set once every touched `ProjectUnit` has released, or by a Late Entry's own one-off release |
| `releasedAt` | timestamptz | yes | — | |
| `releasedBy` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT` — for an ordinary release this is whichever Finance user's `PayrollUnitRelease` action was the *last* of this entry's touched Units to clear; for a Late Entry, the Finance user who performed its one-off release |
| `lateReason` | text | yes | — | **added 2026-07-05.** Populated *only* when this entry undergoes its own one-off "Late Entry" release (`database/release.md §12b`) — i.e. it was created after every `ProjectUnit` it touches had already released for this cycle, so no future `PayrollUnitRelease` sweep will ever reach it. `NULL` for every ordinarily-released entry. Whether an unreleased entry currently *qualifies* as a Late Entry is not stored — it's derived on demand (`released = false AND every touched unit already has a PayrollUnitRelease row for this cycle`), since the ordinary sweep already correctly handles any entry with at least one still-pending Unit. Mandatory (enforced at the application layer) at the moment of that one-off release, mirroring `Correction.reason`'s "reason mandatory" convention. |
| `remarks` | text | yes | — | **added 2026-07-07 (Phase 3 Checkpoint 0), not in this section's original design.** Free-text, ordinarily Draft-editable like any other field, frozen into the permanent snapshot once released — renders as the last column of the Payroll Entry grid (a later checkpoint's concern). |
| `sortOrder` | integer | no | (sequence) | user-controlled drag-to-reorder position within the cycle |
| `version` | integer | no | `1` | **optimistic locking token** — incremented on every update |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

**On `siteId`/`designation`/bank fields — copied, not linked, and ordinarily Draft-editable:**
these are copied from `Employee` onto `PayrollEntry` at the moment the entry is created (or carried
forward at new-cycle creation — see `docs/architecture/workflows/payroll-lifecycle.md §4`), rather than
being read live from `Employee` at render time. This is not a special read-only "snapshot" — once
copied, these fields behave exactly like any other Draft-editable field (the same rule already
governing `grossPay`): freely editable while the entry is unlocked, frozen once locked. **An
`Employee` update never cascades into an existing `PayrollEntry`, in either direction, ever** — this is
a final, approved decision, not an implementation detail. If an employee transfers sites or changes
their bank account mid-cycle, the currently-open `PayrollEntry` keeps whatever it was
created/carried-forward with until the *next* cycle's carry-forward, unless someone explicitly edits
this entry directly (an ordinary, audited edit). Two consequences follow directly from this: (1)
historical cycles are automatically protected (Principle 2) since nothing ever reaches back into a
locked row regardless of later `Employee` changes; (2) **site-scoping for Payroll Entry, Release, Bank
Sheets, Cash Receiving, and reports is always enforced against `PayrollEntry.siteId`, never
`Employee.siteId`** — for both current and historical cycles, one consistent rule, with no time-based
special case and no risk of a row disappearing from a Payroll Staff or Finance user's view mid-session
because of an unrelated `Employee` edit.

**Banking rule (2026-07-11):** a cash entry (`bankId` null) always has `accountNumber`/`iban` both
null too. Unlike `Employee`'s own create/update, which hard-rejects setting a bank with no Account
Number (full-form submission, `employees.service.ts`'s `applyBankingInvariant`), `updatePayrollEntry`
only ever *normalizes* — clearing `bankId` in a request also clears `accountNumber`/`iban` in that
same write, even if the request didn't mention them, but setting `bankId` alone is never rejected for
a missing Account Number. This is a deliberate difference, not an inconsistency: this grid autosaves
one field at a time as the user tabs between cells, so a user who has just picked a bank and hasn't
yet typed the account number must not have that in-progress edit rejected.

- **Unique constraints:** (`cycleId`, `employeeId`) — exactly one entry per employee per cycle
- **Check constraints:** `grossPay >= 0`; `allowance >= 0`; `leaveDays >= 0`; `eobiAmount >= 0`;
  `advanceDeduction >= 0`; `eidAdvanceDeduction >= 0`; `fine >= 0`;
  `released = true ⇒ releasedAt IS NOT NULL AND releasedBy IS NOT NULL` (the `days`/`otHours`/
  `cycleDays` range checks moved to `PayrollEntryWorkLine`, §12a); `lateReason IS NOT NULL ⇒ released
  = true` (a `lateReason` only ever gets written at the moment of the one-off release itself — added
  2026-07-05)
- **Indexes:** unique(`cycleId`, `employeeId`); (`cycleId`); (`employeeId`); composite
  (`cycleId`, `hold`, `released`) — the exact filter combination used by Release Salary, Bank Sheets,
  and Cash Receiving, and by the Payroll Cycle finalization precondition check
  (`database/payroll-cycle.md §10`); (`cycleId`, `siteId`) for site-filtered grid/report queries;
  (`bankId`) for bank sheet generation; (`advanceId`), (`eidAdvanceId`) for the Advances-tab "which
  entries applied to this advance" drill-down
- **Cascade:** all FKs `RESTRICT` — a `PayrollEntry` is never orphaned by deleting its cycle,
  employee, site, bank, or linked advance
- **Module owner:** Payroll Entry (writes while Draft); read by nearly every other module
- **Immutability:** mutable only while `released = false` **and** the parent
  `PayrollCycle.status = 'DRAFT'`. `hold` has **no bearing on mutability** — it only affects
  downstream inclusion in Release/Bank Sheet/Cash Sheet, and remains an ordinarily-editable field
  like any other while the entry is unlocked. Once `released = true` **or** the parent cycle leaves
  Draft, every column on the row — including `hold` — is frozen; there is deliberately no correctable
  path for `hold`/`released` themselves (`CorrectionField`, `database/conventions-and-enums.md §1`,
  excludes them, since they are workflow state, not correctable payroll data — the only legitimate way
  to affect payment for a problem discovered later is via a hold/release decision in a *future* Draft
  cycle). Enforced at the application layer (no update route reaches a locked row) and recommended as
  a database-level `BEFORE UPDATE` trigger blocking any column change once locked, for the same
  defense-in-depth reasoning as the Audit Log (`database/audit-log.md §16`).
- **Optimistic locking required:** yes — this is the primary candidate. Multiple Payroll Staff (or
  multiple tabs, or an autosave retry after a network hiccup) may edit different rows concurrently;
  `version` prevents a lost update on the same row
- **Transactions required:** yes — creating a `PayrollEntry` always creates its first
  `PayrollEntryWorkLine` in the same transaction (§12a, never a two-step process that could leave an
  entry with zero lines); a `PayrollUnitRelease` insert (`database/release.md §12b`) must, in the same
  transaction, sweep and flip `released = true` on every entry whose touched Units are now all
  released, settle any `PENDING` `BalanceAdjustment` for each such employee, and write the
  corresponding `AuditLog` entries; a Late Entry's own one-off release (`database/release.md §12b`)
  follows the identical pattern for exactly one entry, plus writing `lateReason`; recording a non-zero
  `advanceDeduction`/`eidAdvanceDeduction` must, in the same transaction, decrement the linked
  `Advance.outstandingBalance` (`database/advances.md §15`)
- **Calculated, not stored** (computed identically wherever displayed or exported — Principle 5, 6):
  for each work line *i* under this entry (§12a), `dailyRate_i = grossPay / line_i.cycleDays`;
  `earnedAmount_i = dailyRate_i × line_i.days`;
  `effectiveOtRate_i = line_i.otRate ?? dailyRate_i / 8`; `otEarned_i = line_i.otHours × effectiveOtRate_i`.
  Then, summed across all of the entry's lines: `earnedAmount = Σ earnedAmount_i`;
  `otEarned = Σ otEarned_i`. `effectiveLeaveRate = leaveRate ?? (grossPay / primaryLine.cycleDays)`
  (the primary line is the one with the lowest `sortOrder`); `leaveEarned = leaveDays × effectiveLeaveRate`;
  `totalEarning = earnedAmount + otEarned + allowance + leaveEarned`;
  `eobiDeduction = eobiApplicable ? eobiAmount : 0`;
  `totalDeduction = eobiDeduction + advanceDeduction + eidAdvanceDeduction + fine`;
  `netSalary = totalEarning − totalDeduction`. **This is a single calculation path, not a
  split/non-split branch**: an ordinary entry with exactly one work line reduces to exactly the
  original flat formula (the sum over one term), so there is no separate "simple case" implementation
  to keep in sync with the general one. For an entry with one or more approved `Correction` rows, the
  *current effective* value of each corrected field (and therefore the current effective `netSalary`)
  is likewise always calculated on read — by replaying the latest approved correction per field over
  these stored values — never cached on this row; see
  `docs/architecture/workflows/corrections-and-balance-adjustments.md` ("Baseline Reconstruction for
  Sequential Corrections"). Corrections continue to target this entry's aggregate fields only
  (`CorrectionField`, `database/conventions-and-enums.md §1`) — there is no line-level correction path;
  a locked entry's work-line breakdown is preserved as a frozen historical attendance record, and any
  post-release adjustment is expressed as an aggregate delta exactly as already documented, never as a
  correction to one specific line.
- **Row count:** ~1,500/cycle × 12/year ⇒ ~18,000/year today; Principle 10's 10,000-employee design
  floor means this should be read as ~10,000+/cycle going forward — still small for Postgres after a
  decade even at that scale (~1.2M rows/decade at 10,000/cycle × 12/year), with correct indexing, not
  partitioning, remaining sufficient (`database/schema-invariants.md §23`)

## 12a. `PayrollEntryWorkLine`

**Purpose:** One employee's attendance at one specific `ProjectUnit`, for one `PayrollEntry`. The
attendance-data half of what used to be flat scalar columns directly on `PayrollEntry` (§12) — added
2026-07-03 specifically to support an employee working across more than one Branch/Department within
the same payroll cycle, without treating that as a special case.
**Why it exists:** Physical attendance registers exist per branch/department, not per employee — an
employee who genuinely worked two units in one month has two separate attendance records before this
system is ever touched. This table models that directly instead of forcing a single flattened
days/hours figure, while keeping the *payment* side (net salary, release, correction) entirely at the
employee-entry level, unaffected by how many places they physically worked (see §12's revision note).
**Business rule tie-in:** occasional but explicitly supported (2026-07-03 architecture decision) —
this is not a rare-edge-case bolt-on, it is the ordinary shape of attendance data; a single-unit
employee is simply the common case of exactly one line.

> **Business rule (2026-07-03, explicit — not merely a consequence of the schema): a
> `PayrollEntryWorkLine` may only reference a `ProjectUnit` belonging to the same `ProjectSite` as its
> parent `PayrollEntry`. An employee's Work Lines within a single Payroll Entry can never span more
> than one Project Site.** A Project Unit is the actual operational attendance location — relief
> staff, temporary deputations, and shared attendance across multiple branches/departments are all
> expected and supported, but always *within* the one client relationship/location that
> `PayrollEntry.siteId` represents, never across two different ones in the same cycle. This is
> enforced at **two** independent layers, deliberately redundant, matching this schema's existing
> defense-in-depth pattern (e.g. Audit Log immutability, `database/audit-log.md §16`): **(1) a
> database-level composite foreign key** — `(unitId, siteId) → ProjectUnit(id, siteId)`, below — so
> Postgres itself rejects the row, not just a service-layer check; **(2) application-layer
> validation** at the point a Work Line is created or edited, so the operator gets a clean validation
> error rather than a raw constraint violation. Neither layer is optional or a stand-in for the other.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `payrollEntryId` | uuid | no | — | FK → `PayrollEntry.id`, `ON DELETE CASCADE` — a work line has no meaning without its parent entry, and a `PayrollEntry` row is never deleted in practice (Principle 2), so this is one of the few relationships in this schema where cascade delete is appropriate, alongside `RolePermission` (`database/access-control.md §4`) |
| `siteId` | uuid | no | — | denormalized copy of the parent `PayrollEntry.siteId` at line-creation time, present specifically so `unitId` below can be composite-FK'd against it |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, paired with `siteId` above via a composite FK `(unitId, siteId) → ProjectUnit(id, siteId)` (`database/sites-and-units.md §8a`) — Postgres itself rejects a line whose unit doesn't belong to the parent entry's own site, which is what makes "multi-unit splitting is always intra-site" (the 2026-07-03 decision, see below) a database guarantee, not just a UI restriction |
| `days` | numeric(5,2) | no | `0` | working days attributable to this unit |
| `otHours` | numeric(6,2) | no | `0` | OT hours attributable to this unit |
| `otRate` | numeric(10,2) | yes | — | null ⇒ derive from `grossPay / this-line's cycleDays / 8` at read time (§12) |
| `cycleDays` | smallint | no | `30` | denominator for daily rate at this unit; site/unit-typical but per-line editable, same variability rule the original spec applied at the site level (`reference/PROJECT_SPEC.md`) |
| `sortOrder` | integer | no | (sequence) | display order within the entry; the line with the lowest `sortOrder` is the entry's "primary" line for leave-rate-basis purposes (§12) |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

**RBAC consequence of the same-site business rule above:** a Project Unit belongs to exactly one
Project Site (`database/sites-and-units.md §8a`), and Payroll Staff are assigned at the site level
(unchanged, `docs/architecture/authentication.md`). A Payroll Staff member with access to a site
therefore already has full access to every unit under it — so an employee working across multiple
units within one cycle never requires cross-site access, and the 2026-07-03 architecture review
confirmed there is **no cross-site editing exception** of any kind (Principle 7). `assertSiteAccess()`
against the parent `PayrollEntry.siteId` remains the entire RBAC check; nothing unit-level is needed.

**On every entry always having at least one line (no optional/split branch):** a `PayrollEntry` is
created together with its first `PayrollEntryWorkLine` in the same transaction — whether at new-cycle
bulk creation (seeded from the employee's *current default* `unitId`, `database/employee.md §9`) or
when an individual entry is created mid-cycle. Adding a second (or further) line — the "Split by
{unitLabel}" action — is an explicit operator action, not a different creation path; removing a line
back down to the last remaining one is allowed, but a line can never be deleted if it would leave its
parent entry with zero lines, enforced transactionally the same way the system already enforces "a
`Correction` always has exactly one `BalanceAdjustment`" (`database/corrections.md §13`,
`database/balance-adjustments.md §14`) rather than relying on application code discipline alone.

**On new-cycle carry-forward:** a continuing employee's new cycle always starts with exactly one
fresh work line, seeded from their **current** default `unitId` — it does not inherit whatever
split structure existed in the source cycle. Splitting is a fresh attendance decision made each
cycle by whoever enters that month's data, consistent with attendance itself resetting every cycle
(`reference/PROJECT_SPEC.md`: "carrying forward employee/bank data but resetting attendance").

- **Unique constraints:** (`payrollEntryId`, `unitId`) — an employee's attendance at one unit within
  one entry is a single line, never split across two rows for the same unit
- **Check constraints:** `days >= 0`; `otHours >= 0`; `cycleDays BETWEEN 1 AND 31` (the same range
  rules previously on `PayrollEntry` directly, §12)
- **Indexes:** unique(`payrollEntryId`, `unitId`); (`payrollEntryId`) — the primary "lines for this
  entry" lookup, always hit when rendering or computing an entry; (`unitId`) for unit-level reporting
  ("who worked at this unit this cycle," a new reporting dimension this table enables); composite
  unique(`unitId`, `siteId`) is not declared here — it's declared on the referenced side, `ProjectUnit`
  (`database/sites-and-units.md §8a`)
- **Cascade:** `payrollEntryId` is `CASCADE` (see column notes above); `unitId`/`siteId` (composite) is
  `RESTRICT` via the referenced `ProjectUnit`
- **Module owner:** Payroll Entry (same module that owns `PayrollEntry` itself — this is not a
  separate module, it's the attendance-detail half of the same editable surface)
- **Immutability:** mutable under exactly the same condition as its parent `PayrollEntry` — while
  `released = false` **and** the parent `PayrollCycle.status = 'DRAFT'`. Once the parent entry locks,
  every line under it freezes too, preserved as a historical attendance record; there is no
  line-level Correction path (§12's revision note)
- **Transactions required:** yes — entry creation + first line creation (always together); any line
  add/edit/remove while the entry's aggregate figures are recalculated for display (recalculation
  itself is computed on read, per §12, not written back to a cached column, so this is a read
  concern, not a write-transaction one, beyond the line mutation itself + its `AuditLog` entry as part
  of the parent entry's ordinary field-edit audit trail)
- **Row count:** the common case is exactly one line per `PayrollEntry` (so, roughly the same order of
  magnitude as `PayrollEntry` itself, §12); occasional multi-unit employees add a small number of
  additional lines on top — not expected to meaningfully change the table's overall scale even at
  Principle 10's 10,000-employee floor

---
