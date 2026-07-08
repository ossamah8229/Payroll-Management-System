# Relationships & Cardinality

**Owner module(s):** Cross-cutting — derived view spanning every module's schema

**Contains:** The full entity-relationship diagram and the load-bearing data-flow spine

**Sections:** §21 · Full index: `database/README.md`

This is a **derived index**, not an authoritative source: it summarizes relationships whose
authoritative definition (the FK, its cascade rule, its rationale) lives on the owning entity in its
own `database/*.md` file. A change to a relationship's behavior belongs in the owning file first; this
diagram is updated to keep it in sync, per the Documentation Ownership Rule
(`docs/architecture/folder-structure.md`).

---

## 21. Relationships & Cardinality

```
Role (1) ───< User (many)
Role (many) ──< RolePermission >── (many) Permission

User (many) ──< UserSiteAssignment >── (many) ProjectSite

Bank (1) ───< Employee (many)         [bankId, optional] — Bank has no relationship to ProjectSite,
                                        see database/sites-and-units.md §8's revision note

ProjectSite (1) ───< ProjectUnit (many)
ProjectSite (1) ───< Employee (many)                 [siteId, direct]
ProjectUnit (1) ───< Employee (many)                 [unitId, composite FK with siteId — database/employee.md §9]

Employee (1) ───< EmployeeTransferHistory (many)             [employeeId — database/employee.md §8b]
ProjectSite (1) ───< EmployeeTransferHistory (many)          [fromSiteId, toSiteId — database/employee.md §8b]
ProjectUnit (1) ───< EmployeeTransferHistory (many)          [fromUnitId, toUnitId — database/employee.md §8b]
User (1) ───< EmployeeTransferHistory (many)                 [transferredById — database/employee.md §8b]

Employee (1) ───< PayrollEntry (many)
PayrollCycle (1) ───< PayrollEntry (many)
PayrollCycle (1) ───< PayrollCycle (many)     [sourceCycleId, self-referencing]

PayrollEntry (1) ───< PayrollEntryWorkLine (many)    [always ≥1, enforced transactionally — database/payroll-entry.md §12a]
ProjectUnit (1) ───< PayrollEntryWorkLine (many)     [unitId, composite FK with siteId — database/payroll-entry.md §12a]

PayrollCycle (1) ───< PayrollUnitRelease (many)      [cycleId — database/release.md §12b, added 2026-07-05]
ProjectUnit (1) ───< PayrollUnitRelease (many)       [unitId — database/release.md §12b]
User (1) ───< PayrollUnitRelease (many)              [releasedById — database/release.md §12b]

PayrollCycle (1) ───< PayrollUnitReadiness (many)    [cycleId — database/release.md §12b, added 2026-07-05]
ProjectUnit (1) ───< PayrollUnitReadiness (many)     [unitId — database/release.md §12b]
User (1) ───< PayrollUnitReadiness (many)            [markedReadyById — database/release.md §12b]

PayrollEntry (1) ───< CorrectionRequest (many)       [payrollEntryId — database/corrections.md §13a, added 2026-07-05]
AdjustmentType (1) ───< CorrectionRequest (many)     [adjustmentTypeId — database/corrections.md §13a]
User (1) ───< CorrectionRequest (many)               [requestedById — database/corrections.md §13a]
User (1) ───< CorrectionRequest (many)               [reviewedById, optional — database/corrections.md §13a]
CorrectionRequest (0..1) ─── (1) Correction          [resultingCorrectionId, optional — database/corrections.md §13a]

PayrollEntry (1) ───< Correction (many)
AdjustmentType (1) ───< Correction (many)

Correction (1) ─── (1) BalanceAdjustment
Employee (1) ───< BalanceAdjustment (many)          [denormalized]
PayrollCycle (1) ───< BalanceAdjustment (many)      [sourceCycleId]
PayrollCycle (1) ───< BalanceAdjustment (many)      [settledInCycleId, optional]
AdjustmentType (1) ───< BalanceAdjustment (many)    [denormalized from Correction]

BalanceAdjustment (1) ─── (0..1) CorrectionPayment  [balanceAdjustmentId — database/balance-adjustments.md §14a, added 2026-07-05]
Employee (1) ───< CorrectionPayment (many)          [employeeId — database/balance-adjustments.md §14a]
User (1) ───< CorrectionPayment (many)               [paidById — database/balance-adjustments.md §14a]

BalanceAdjustment (1) ───< BalanceAdjustmentSettlement (many)  [balanceAdjustmentId — database/balance-adjustments.md §14b, added 2026-07-05]
PayrollCycle (1) ───< BalanceAdjustmentSettlement (many)       [cycleId — database/balance-adjustments.md §14b]

Employee (1) ───< Advance (many)
Advance (1) ───< PayrollEntry (many)                [advanceId, optional]
Advance (1) ───< PayrollEntry (many)                [eidAdvanceId, optional]

PayrollCycle (0..1) ─── (1) ScheduledPayrollPeriod   [payrollCycleId, optional — database/payroll-cycle.md §10a, added 2026-07-08]
ScheduledPayrollPeriod (1) ───< Advance (many)       [originalScheduledPeriodId, optional — database/payroll-cycle.md §10a / database/advances.md §15]
ScheduledPayrollPeriod (1) ───< Advance (many)       [currentScheduledPeriodId, optional — database/payroll-cycle.md §10a / database/advances.md §15]

Advance (1) ───< AdvanceScheduleChange (many)                [advanceId — database/advances.md §15a, added 2026-07-08]
PayrollEntry (1) ───< AdvanceScheduleChange (many)           [payrollEntryId — database/advances.md §15a]
ScheduledPayrollPeriod (1) ───< AdvanceScheduleChange (many) [fromPeriodId — database/advances.md §15a]
ScheduledPayrollPeriod (1) ───< AdvanceScheduleChange (many) [toPeriodId — database/advances.md §15a]
User (1) ───< AdvanceScheduleChange (many)                   [changedById — database/advances.md §15a]

User (1) ───< AuditLog (many)                        [actorUserId, optional]
(polymorphic, no FK) AuditLog ···> Employee | PayrollEntry | Correction | ... [via entityType/entityId]

PayrollCycle (1) ───< BackupPackage (many)
BackupPackage (1) ───< BackupPackageFile (many)

CompanySettings (singleton, standalone)
```

The load-bearing spine, matching `docs/architecture/overview.md`'s data-flow diagram — **revised
2026-07-05** to show release now happening at Project Unit granularity, and the correction path's new
request/timing/installment branches:

```
Employee ─┐
          ├─> PayrollEntry ──> PayrollUnitRelease (per touched Unit, database/release.md §12b) ──>
ProjectSite ┘        │           once ALL touched Units have released, PayrollEntry.released flips
                      │           true (or a Late Entry gets its own one-off release, lateReason) ──>
                      │           Bank Sheets / Cash Receiving (derived, one row per employee, amount
                      │           = netSalary ± any settling BalanceAdjustments)
                      │
                      └─> CorrectionRequest (optional, database/corrections.md §13a) ──approved──>
                            Correction ──>
                            BalanceAdjustment ──┬─ PAYABLE, IMMEDIATE ──> fold into an already-open
                                                 │   PayrollEntry, else CorrectionPayment
                                                 │   (database/balance-adjustments.md §14a)
                                                 ├─ PAYABLE, DEFERRED ──> next Draft PayrollEntry
                                                 │   (unchanged from before this session)
                                                 └─ RECOVERY ──> one or more future cycles'
                                                     PayrollEntry releases, each installment logged
                                                     as a BalanceAdjustmentSettlement row
                                                     (database/balance-adjustments.md §14b)
```

Bank Sheets, Cash Receiving, Statements, Payslips, Reports, and Dashboard have **no tables of their
own** — they are query modules over the tables above, per Principle 1 and the module design in
`docs/architecture/overview.md`.

---
