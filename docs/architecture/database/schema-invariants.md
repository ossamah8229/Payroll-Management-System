# Schema Invariants — Cross-Cutting Summary, Performance, Extensibility, Migration Strategy, Design Assumptions

**Owner module(s):** Cross-cutting — derived view spanning every module's schema

**Contains:** The six cross-entity invariant checklists (immutability, append-only, transactions,
optimistic locking, audit logging, single-source-of-truth values), performance considerations, future
extensibility, migration strategy, and open design assumptions

**Sections:** §22–§26 · Full index: `database/README.md`

This is a **derived index**, not an authoritative source: each checklist item summarizes a rule whose
authoritative definition lives on the owning entity in its own `database/*.md` file. A change to an
entity's actual immutability/transaction/audit-logging behavior belongs in the owning file first; this
summary is updated to keep it in sync, per the Documentation Ownership Rule
(`docs/architecture/folder-structure.md`). These five sections are kept together, undivided, because
they're read together in one sitting whenever a new table is added — checking all six §22 checklists
plus performance/migration/assumptions guidance is a single workflow, not five independent ones.

---

## 22. Cross-Cutting Summary

### Immutable tables (never updated after creation, other than the one exception noted)
`Correction`, `AuditLog`, `BackupPackage`, `BackupPackageFile`, `AdjustmentType` rows (retired via
`isActive`, never edited in meaning), `PayrollEntry` rows once `released = true` or once the parent
cycle leaves `DRAFT` (`hold` does **not** gate this — it's an ordinary field until the row locks, at
which point it freezes along with every other column; see `database/payroll-entry.md §12`), and every
`PayrollEntryWorkLine` under such a row, which locks in lockstep with its parent entry
(`database/payroll-entry.md §12a`). `BalanceAdjustment` is immutable except for
`remainingAmount`/`status`/`settledInCycleId`/`settledAt` (settlement, now potentially multi-step for
`RECOVERY`) and the staff-editable `recoveryInstallmentAmount` (a `NONE`-type row is created already in
its final state and never transitions at all). **Added 2026-07-05:** `PayrollUnitRelease`
(`database/release.md §12b`) is immutable from creation — a Unit's release for a cycle is never undone.
`CorrectionRequest` (`database/corrections.md §13a`) is immutable except for its single permitted
`PENDING → APPROVED` or `PENDING → REJECTED` transition. `CorrectionPayment`
(`database/balance-adjustments.md §14a`) is immutable from creation. `BalanceAdjustmentSettlement`
(`database/balance-adjustments.md §14b`) is immutable from creation. **Added 2026-07-08:**
`ScheduledPayrollPeriod` (`database/payroll-cycle.md §10a`) is immutable except for its single
permitted resolution transition (`payrollCycleId`/`resolvedAt`, `NULL → NOT NULL`, exactly once) —
`year`/`month` themselves never change after creation, full stop, and the row itself is never deleted
once any payroll obligation references it, even after its `PayrollCycle` completes and archives
(`database/payroll-cycle.md §10a`'s Deletion note).

### Append-only tables
`Correction`, `AuditLog`, `BackupPackage`, `BackupPackageFile`, `EmployeeTransferHistory` (added
2026-07-03, session 2 — `database/employee.md §8b`). **Added 2026-07-05:** `PayrollUnitRelease`
(`database/release.md §12b`), `BalanceAdjustmentSettlement` (`database/balance-adjustments.md §14b`),
`CorrectionPayment` (`database/balance-adjustments.md §14a`). **Added 2026-07-08:**
`AdvanceScheduleChange` (`database/advances.md §15a`) — no updates, no deletes, only inserts, same
convention as `EmployeeTransferHistory`/`BalanceAdjustmentSettlement`. **The one deliberate
exception:** `PayrollUnitReadiness` (`database/release.md §12b`) is **not** append-only — un-marking
Ready **deletes** the row, since it is a purely informational, current-state workflow signal with no
historical-preservation requirement, unlike every other table in this list.

### Tables requiring multi-statement transactions
- `PayrollEntry` insert + its first `PayrollEntryWorkLine` insert, always together, never a two-step
  process that could leave an entry with zero lines (`database/payroll-entry.md §12a`)
- **Added 2026-07-05:** `PayrollUnitRelease` insert + a sweep flipping `PayrollEntry.released = true`
  on every entry whose touched Units are now all released + settlement of any `PENDING`
  `BalanceAdjustment` for each such employee (merged into that release's Bank Sheet/Cash Sheet payment
  amount, `database/balance-adjustments.md §14`) + `AuditLog` insert(s) (`database/release.md §12b`) —
  the direct successor to the old single-entry "release" transaction below, now fanned out per
  Unit-release event
- **Added 2026-07-05:** a Late Entry's own one-off release: `lateReason` write + `PayrollEntry.released
  = true` + the same `BalanceAdjustment` settlement/`AuditLog` steps as above, for exactly one entry
  (`database/release.md §12b`)
- **Added 2026-07-05:** `CorrectionRequest` approval: `Correction` insert + `BalanceAdjustment` insert
  + `CorrectionRequest.status → APPROVED`/`resultingCorrectionId` update + `AuditLog` insert, all
  together (`database/corrections.md §13a`)
- `Correction` insert + `BalanceAdjustment` insert (always — including a `NONE`-type, zero-amount,
  already-`SETTLED` row for a zero-net-difference correction) + `Advance.outstandingBalance`
  reconciliation, when the corrected field is `ADVANCE_DEDUCTION`/`EID_ADVANCE_DEDUCTION` and a linked
  advance exists (`database/advances.md §15`) + `AuditLog` insert
- **Added 2026-07-05:** an `IMMEDIATE` `PAYABLE` `BalanceAdjustment`'s settlement, at approval time:
  either folding into the employee's already-open `PayrollEntry`, or a `CorrectionPayment` insert
  (`database/balance-adjustments.md §14a`) + `BalanceAdjustment.status → SETTLED` + `AuditLog` insert
- **Added 2026-07-05:** a `RECOVERY` `BalanceAdjustment` installment applied during a cycle's release:
  `BalanceAdjustmentSettlement` insert (`database/balance-adjustments.md §14b`) +
  `BalanceAdjustment.remainingAmount` decrement (+ `status → SETTLED` only if this brings it to zero) +
  `AuditLog` insert
- `PayrollCycle` finalization (`DRAFT → RELEASED`): the no-override precondition check
  (`database/payroll-cycle.md §10`, unchanged wording — see its 2026-07-05 revision note) + status
  update + `AuditLog` insert, in one transaction
- `PayrollCycle` archive transition (`RELEASED → ARCHIVED`) + `BackupPackage`/`BackupPackageFile`
  insert (DB rows only — the actual file write via `StorageProvider` is external I/O and cannot
  participate in a DB transaction; the recommended pattern is: write the file first, then commit the
  `BackupPackage` row referencing it, so a crash mid-process leaves an orphaned file rather than a DB
  row pointing at a file that doesn't exist)
- `Advance.outstandingBalance` decrement + the `PayrollEntry` save that recorded the linked deduction
- New cycle creation: previous cycle's archive transition (above) + `PayrollCycle` insert +
  `ScheduledPayrollPeriod` resolution if a pending period matches this cycle's `(year, month)`
  (`database/payroll-cycle.md §10a`) + bulk `PayrollEntry` insert (each with its own single,
  freshly-seeded `PayrollEntryWorkLine`, per `database/payroll-entry.md §12a`'s carry-forward rule —
  never inheriting a prior cycle's split structure) for every active employee plus any employee (active
  or departed) selected by **any registered Outstanding Payroll Obligation provider**
  (`docs/architecture/workflows/outstanding-obligations.md` — today, Balance Adjustments' `PENDING`-
  adjustment check and Advances' resolved-schedule check) + each provider's own **Payroll
  Materialization Hook**, where it has one, each invoked independent of the others with no assumed
  order (Advances populates `advanceDeduction`/`advanceId` on the entries its check matched and writes
  `advance.schedule_materialized`; Balance Adjustments has no creation-time materialization step,
  unchanged) + `AuditLog` insert — all one transaction
- **Added 2026-07-08:** an Advance schedule change (deferral): zeroing the source `PayrollEntry`'s
  `advanceDeduction`/`advanceId` (or eid- equivalent) fields + `Advance.currentScheduledPeriodId`
  update + find-or-create of the target `ScheduledPayrollPeriod` (via Payroll Processing's owned
  function, never a direct write from Advances — `database/payroll-cycle.md §10a`'s ownership
  boundary) + `AdvanceScheduleChange` insert (`database/advances.md §15a`) + `AuditLog` insert
  (`advance.deferred`), all together — distinct from the later, separate transaction (above) that
  eventually materializes this schedule and writes `advance.schedule_materialized`
- `Employee` create/update + `AuditLog` insert (generic diff, or a distinct `employee.left` entry when
  `dateOfLeaving` is set)

### Tables requiring optimistic locking
`PayrollEntry` (`version` column) — the only table with realistic concurrent-edit exposure (multiple
staff/tabs, autosave retries). No other table has a plausible concurrent-write conflict at this
system's scale and access pattern. `PayrollEntryWorkLine` rows don't carry their own `version` — they
mutate only as part of their parent `PayrollEntry`'s edit surface, so the parent's optimistic lock
already covers them.

### Tables requiring audit logging on every mutation
`PayrollEntry` (release/hold/field edits while Draft, including work-line attendance changes —
`database/payroll-entry.md §12a` — captured in the same field-level diff), `Correction` (every
creation, including a zero-net-difference/`NONE` correction), `BalanceAdjustment` (creation and every
settlement step, partial or final), `PayrollCycle` (every status transition, including a finalization
attempt blocked by the precondition), `Advance` (creation and both balance-changing events — original
deduction and correction-triggered reconciliation), `Employee` (every create/update — a site/unit-
changing edit writes a dedicated `employee.transferred` entry, not the generic `employee.updated`
entry, plus an `EmployeeTransferHistory` row (`database/employee.md §8b`); leaving/reactivating write
their own dedicated `employee.left`/`employee.reactivated` entries — see `database/employee.md §9`),
`User`/`Role`/`UserSiteAssignment` (creation, deactivation, role/site reassignment), `ProjectSite`
(creation, edit, deletion attempt), `ProjectUnit` (creation, edit, deletion attempt — same pattern as
`ProjectSite`, `database/sites-and-units.md §8a`), `CompanySettings` (every update). **Added
2026-07-05:** `PayrollUnitRelease` (creation — `payroll_unit.released`), `PayrollUnitReadiness`
(marking and un-marking — `payroll_unit.marked_ready` / `.unmarked_ready`), `CorrectionRequest`
(creation, approval, rejection), `CorrectionPayment` (creation — `correction_payment.paid`), a Late
Entry's one-off release (`payroll.late_released`, carrying `lateReason`). **Added 2026-07-08:**
`AdvanceScheduleChange` (creation — `advance.deferred`, `database/advances.md §15a`), the accompanying
`payroll_entry.advance_deferred` entry for the `PayrollEntry` field change it causes, and — written
separately, later, by the Advances Payroll Materialization Hook — `advance.schedule_materialized` the
moment a scheduled deduction actually lands in a `PayrollEntry` (§15's full lifecycle chain,
`database/advances.md §15`).

### Values that must never be duplicated (single source of truth)
- Net salary and every `calcNet` intermediate — always computed from `PayrollEntry` (and, for a
  corrected entry, from its replayed current effective state — `database/payroll-entry.md
  §12`/`database/corrections.md §13`), never stored redundantly anywhere (Payslip, Bank Sheet,
  Statement all compute live from the same inputs)
- `PayrollCycle` display label ("April 2026") — computed from `year`/`month`, never stored
- An employee's "has a bank account" status — derived from `bankId`/`accountNumber` presence, never
  stored as a separate boolean that could drift out of sync
- Balance Adjustment amounts — derived once at Correction approval and stored on `BalanceAdjustment`
  itself (this one *is* stored, deliberately, per Principle 6 — it must exactly match what was
  approved, not be recomputed later from possibly-changed inputs)
- Which specific `Advance` a cycle's deduction applies to — stored explicitly
  (`PayrollEntry.advanceId`/`.eidAdvanceId`) at entry time, never re-inferred later from "whichever
  advance is currently active," which could point at the wrong advance by the time a correction
  happens (`database/payroll-entry.md §12`, `database/advances.md §15`)
- **Added 2026-07-08:** an Advance's scheduled deduction target — `Advance.currentScheduledPeriodId`
  is the single live pointer (BR-ADV-005); a deferral moves it, it is never duplicated into a second
  pointer or a second row. A future payroll period itself is represented exactly once, in
  `ScheduledPayrollPeriod` (`database/payroll-cycle.md §10a`) — never as a second, ad hoc `(year,
  month)` representation on any consuming table
- A combined Bank Sheet/Cash Sheet payment amount is computed once, server-side, from
  `PayrollEntry.netSalary` plus settling `BalanceAdjustment`s — never independently re-entered or
  re-derived per document (Payslip and Statement of Account show the same figures broken out, not
  recomputed differently)

---

## 23. Performance Considerations

**Governing principle: Principle 10 (`docs/PROJECT_PRINCIPLES.md`) — design for at least 10,000
employees, not just today's ~1,500.** Every point below is sized against that floor, not against
current headcount.

- The Payroll Entry grid load is a single indexed query
  (`WHERE cycleId = ? ORDER BY sortOrder`, using the `(cycleId, hold, released)` and `(cycleId, siteId)`
  composite indexes for filtered views) joined to `Employee` for name/CNIC and to
  `PayrollEntryWorkLine` for the attendance breakdown — not one query per row, and not one query per
  work line either (a single `JOIN` naturally returns every entry's line(s) in one round trip
  regardless of whether a given entry has one line or several). This is the query the spec explicitly
  flags as the most likely real-world performance risk if done naively; the schema's indexing is
  designed around it directly, and remains a single query shape at 10,000 rows, not just 1,500.
- Dashboard aggregates (per-site totals, release progress) are `GROUP BY` queries over `PayrollEntry`
  keyed by `(cycleId, siteId)` — indexed, and a candidate for the short-TTL cache described in
  `docs/architecture/deployment.md`.
- `AuditLog` is write-heavy, read-light — indexes favor the few real read patterns (entity lookup,
  actor lookup, time-range paging) rather than being over-indexed for hypothetical queries.
- No table in this schema is expected to individually exceed a few million rows within a decade of
  operation even at the 10,000-employee floor (`database/payroll-entry.md §12`'s row-count note); at
  that scale, correct indexing (not partitioning, not read replicas) remains sufficient, consistent
  with Principle 4 (don't add complexity performance doesn't require yet) — but every future phase
  should still actively apply Principle 10's concrete techniques (virtualization, server-side
  pagination, background processing for long-running operations, bulk writes over row-by-row loops)
  rather than relying on indexing alone to carry a 10,000-employee dataset through, say, an
  unvirtualized full-table render.
- **Added 2026-07-05:** the `PayrollUnitRelease` sweep (`database/release.md §12b`) — flipping
  `released = true` across every `PayrollEntry` a Unit's release affects — must be a single bulk
  `UPDATE ... WHERE` statement keyed off `(cycleId, siteId/unitId)`, not a row-by-row loop over
  entries, consistent with Principle 10 even though a single Unit's entry count is typically small;
  the same applies to computing which entries now have *every* touched Unit released, which is a
  set-membership check expressible as one query (count of distinct touched units vs. count of
  matching `PayrollUnitRelease` rows) rather than N queries per entry.

## 24. Future Extensibility

Directly supports the four future modules named in `docs/architecture/overview.md`, without schema
changes to `PayrollEntry`'s calculation logic or `PayrollCycle`'s state machine:

- **Biometric Attendance** — adds its own new tables (e.g. raw punch records) entirely outside this
  schema, and writes into existing `PayrollEntry.days`/`otHours` through the same update path manual
  entry already uses.
- **Leave Management** — same pattern, feeding `PayrollEntry.leaveDays`.
- **Gratuity** — adds its own table, reading `Employee.dateOfJoining`/`dateOfLeaving` and historical
  `PayrollEntry` data read-only.
- **ESS Portal** — needs only a new `Role` row (e.g. `EMPLOYEE`) and corresponding `Permission` rows;
  no new payroll tables required, since it consumes existing read paths scoped to one employee.
- **Added 2026-07-08 — any future Outstanding Payroll Obligation** (e.g. a Loans, Recoveries, or Bonus
  Deferral module — `docs/architecture/workflows/outstanding-obligations.md`,
  `docs/architecture/overview.md` Extensibility): needs only its own table(s) plus, if it must
  reference a not-yet-existing future cycle, a foreign key into the existing `ScheduledPayrollPeriod`
  (`database/payroll-cycle.md §10a`) — never a new `(year, month)` representation of its own. It
  registers its own carry-forward predicate and (optionally) its own Payroll Materialization Hook with
  Payroll Processing's cycle bootstrap — independent of, and never ordered relative to, any other
  provider's predicate/hook — with no change to `PayrollCycle`'s schema or state machine, and no
  change to any other obligation provider's tables.

## 25. Migration Strategy

- Prisma migrations, additive-first (Principle 8): new tables/columns/lookup rows are the default
  path for any new requirement; destructive changes (dropping/renaming a column in use) require
  explicit sign-off given the historical-integrity stakes (Principle 2). **The 2026-07-03
  `ProjectSite.branchCode` removal (`database/sites-and-units.md §8`) is this project's first
  genuinely destructive migration** — low practical risk only because it has never been applied to a
  live database (it shipped in Phase 1's initial migration but no Postgres instance has run it yet),
  and it carries the explicit sign-off this bullet requires, recorded in `docs/PROJECT_PROGRESS.md`.
- Initial migration creates tables in dependency order: `Role`, `Permission`, `RolePermission`,
  `Bank`, `AdjustmentType` → `User`, `ProjectSite` → `ProjectUnit` → `UserSiteAssignment`, `Employee` →
  `EmployeeTransferHistory` → `PayrollCycle` → `PayrollEntry` → `PayrollEntryWorkLine` → `Correction` →
  `BalanceAdjustment`, `Advance` → `AuditLog` → `BackupPackage` → `BackupPackageFile` →
  `CompanySettings`. (In practice, Phase 1 and Phase 2 already split this into separate additive
  migrations rather than one initial migration — `ProjectUnit`, `Employee.unitId`, and
  `EmployeeTransferHistory` land in Phase 2.5's migrations, `PayrollEntryWorkLine` in Phase 3's, per
  `docs/IMPLEMENTATION_PLAN.md`'s Phase 2.5/3 sections, not edits to existing ones.)
- Seed data required at initial migration: the three roles (`MASTER_USER`, `PAYROLL_STAFF`, `FINANCE`
  — the third added 2026-07-05, Phase 3 architecture review) and their permissions, the three banks
  (ABL/HBL/MCB), the seven initial `AdjustmentType` rows, one Master User account, and the singleton
  `CompanySettings` row. `BalanceAdjustmentType.NONE` and `CorrectionRequestStatus` need no seed data —
  they're enum values, not lookup rows.
- **Superseded 2026-07-07 (Phase 3 Checkpoint 0, implementation):** this bullet originally read
  "`PayrollEntry.advanceId`/`.eidAdvanceId` and `BalanceAdjustment.adjustmentTypeId` are part of the
  initial migration (this is a pre-implementation design, not a later addition to an existing
  schema)." In practice, per the same additive-migration-per-phase pattern the bullet above already
  describes, `advanceId`/`eidAdvanceId` are deferred to a Phase 4 migration (they FK to `Advance`,
  which Phase 4 builds — see `database/payroll-entry.md §12`'s matching 2026-07-07 revision note);
  `BalanceAdjustment.adjustmentTypeId` is unaffected and remains part of whichever migration Phase 6
  adds `BalanceAdjustment` in.
- **Added 2026-07-08, pre-Checkpoint-2 architecture amendment:** `ScheduledPayrollPeriod`
  (`database/payroll-cycle.md §10a`), `Advance.originalScheduledPeriodId`/`.currentScheduledPeriodId`
  (`database/advances.md §15`), and `AdvanceScheduleChange` (`database/advances.md §15a`) are all
  designed *before* `Advance` has ever been migrated — since Phase 4 hasn't built it yet, these land
  together in Phase 4's initial `Advance` migration from day one. This is the clean case: no
  destructive change, no retrofit of an already-shipped table. `ScheduledPayrollPeriod` has no
  dependency on `Advance` (it only depends on the already-shipped `PayrollCycle`), so it could in
  principle migrate earlier than Phase 4 if a future obligation provider needs it sooner — but there is
  no such consumer today, so it is scheduled alongside its first real consumer, per Principle 8 (build
  additively, not ahead of an actual need).
- Any future migration touching `PayrollEntry`, `Correction`, `BalanceAdjustment`, or `AuditLog`
  should get an explicit review pass given their financial/audit criticality, per Principle 4.

## 26. Design Assumptions Requiring Confirmation

Items 1, 2, 4, and (as of session 2) 6 below are now **resolved** (final decisions, no longer open)
and are kept only as a record of what was decided and why. Item 5 remains genuinely open (Phase 3's
concern, not Phase 2's) and is unaffected by this round of changes. Item 3 is updated to reflect the
explicit-linkage schema addition, but the underlying business assumption it flags is still worth
confirming.

1. ~~`PayrollCycle` Draft → Released trigger~~ — **Resolved.** Draft → Released is an explicit
   Master User "Finalize Cycle" action, gated by a precondition (no non-held unreleased entries) with
   **no override**. See `database/payroll-cycle.md §10` and
   `docs/architecture/workflows/payroll-lifecycle.md §4`. **Reaffirmed 2026-07-05** (Phase 3
   architecture review): this stays an explicit action even though `PayrollEntry.released` is now
   itself derived from per-Unit release events (`database/release.md §12b`) — the precondition's
   wording is unchanged.
2. ~~`Employee.cnic` and `.employeeCode` are nullable.~~ — **Resolved 2026-07-02, confirmed as
   documented.** Real client sample data included employees with a blank CNIC. Given CNIC is
   described as "the primary key across the whole system," this is modeled as
   nullable-but-unique-when-present rather than strictly required, to accommodate an employee added
   before their CNIC is on file. Confirmed by the user before Phase 2 Employee Registry schema work.
3. **At most one `ACTIVE` `Advance` per employee per type.** Still assumed, and now reinforced rather
   than merely inferred: `PayrollEntry.advanceId`/`.eidAdvanceId` (`database/payroll-entry.md §12`)
   record the explicit link at entry time, but a new deduction is still auto-linked to "the" active
   advance of that type via this same partial-unique-index assumption. If the business does expect
   concurrent overlapping advances of the same type with independently-tracked balances, this still
   needs a different design (e.g. a manual advance picker at entry time rather than auto-linking to a
   single implied active advance). Not yet confirmed — revisit before Phase 4 (Advances module).
4. ~~`Employee.religion` and `.designation` are free text, not enums or lookup tables.~~ —
   **Resolved 2026-07-02, confirmed as documented.** Designation values vary a great deal across real
   client sites and don't drive any calculation logic, so constraining them didn't seem to add value.
   Confirmed by the user before Phase 2 Employee Registry schema work.
5. **A `PayrollCycle` is exactly one calendar month.** Nothing in the spec suggests non-monthly or
   custom-length pay periods; `year`+`month` is the whole cycle identity. If that ever changes, it's
   a schema change to this table specifically. Not yet confirmed — revisit before Phase 3.
6. ~~CNIC duplicate detection and the recommended approach~~ — **Resolved 2026-07-03 (session 2),
   final decision.** CNIC remains globally unique: `cnic` stays database-unique (partial,
   `WHERE cnic IS NOT NULL` — already true today, `database/employee.md §9`), with **no override
   mechanism of any kind**. Duplicate `Employee` records are never permitted. Reasoning: a CNIC is a
   real-world unique identifier (Pakistan's national ID); two distinct active people can never
   legitimately share one, so an apparent duplicate is always either a data-entry mistake or the same
   person already existing in the system. An override would reopen exactly the risk the user said they
   want closed and would fragment one person's history across two `Employee` rows, undermining the
   CNIC-based lookup requirement that a single search surface an employee's *full* history
   (`reference/PROJECT_SPEC.md` #13). The one legitimate scenario an override might otherwise tempt —
   a former employee (`dateOfLeaving` set) being **rehired** — is handled exclusively by a new
   **Reactivate Employee** action (`docs/IMPLEMENTATION_PLAN.MD`'s Phase 2.5, Checkpoint 4):
   reactivating clears `dateOfLeaving` and updates the employee's current employment details on their
   **existing** row, never creating a second row with the same CNIC — preserving Principle 2
   (historical `PayrollEntry` rows still reference the original, untouched `Employee.id`) while keeping
   one identity, one CNIC, one row. This is the direct successor to the Phase 2 "Mark as Left" action
   (`POST /:id/leave`), which had no symmetric counterpart until now. If a reactivation also changes
   the employee's site/unit relative to when they left, the transfer-audit path
   (`database/employee.md §8b/§9`) fires alongside a distinct `employee.reactivated` entry, since
   reactivation and transfer are independent, co-occurring facts. Two concrete, additive improvements
   ship alongside the Reactivate action: (a) **normalize before validating**, not just before storing —
   today's Zod pattern (`/^\d{13}$/`) requires digits-only input with no dashes, so a user typing a
   CNIC in the commonly-written `#####-#######-#` form currently fails validation outright rather than
   being normalized; the input strips non-digit characters before validation, both in the form and the
   CSV import path; (b) a debounced pre-submit **duplicate-check** lookup (e.g.
   `GET /employees/check-cnic?cnic=...`) so an operator learns about a collision — and which existing
   employee owns it — before hitting a raw 409 on submit, prompting them toward reactivation instead of
   a blocked create.

---

This is a specification, not an implementation. No Prisma schema or SQL has been generated. Waiting
for approval before either revising this design or proceeding to scaffold `backend/prisma/schema.prisma`.
