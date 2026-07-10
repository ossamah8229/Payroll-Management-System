# Database Schema Specification — Index

This folder is the formal database schema specification, split by bounded context. It is a design
specification, not code — the contract that `backend/prisma/schema.prisma` and its migrations must
satisfy. It builds directly on the frozen architecture: `docs/PROJECT_PRINCIPLES.md`,
`docs/architecture/system-conventions.md`, `docs/architecture/workflows/payroll-lifecycle.md`,
`docs/architecture/workflows/outstanding-obligations.md`,
`docs/architecture/workflows/corrections-and-balance-adjustments.md`, and
`docs/architecture/overview.md`.

**For *why* a module exists** — its rationale, its place in the system's data flow, why it's shaped
the way it is — see `docs/architecture/overview.md`'s Major Modules table. **This index tells you
*where* each entity's schema now lives.** Per the Documentation Ownership Rule
(`docs/architecture/folder-structure.md`), this file is a derived navigation aid, not a competing
authority — module rationale is not repeated here.

Section numbers (§0–§26, with lettered insertions) are global and stable: a section keeps its number
permanently regardless of which file contains it. New sections continue the sequence (§27, §27a, …)
rather than restarting per file.

---

## Navigation

| File | Entities covered | §-range | Owning module(s) (see `overview.md`) |
|---|---|---|---|
| `conventions-and-enums.md` | Schema-wide conventions; native enums; lookup-table conventions | §0–§1 | Cross-cutting |
| `access-control.md` | `Role`, `Permission`, `RolePermission`, `User`, `UserSiteAssignment`, `CompanySettings`, `Session` | §2–§6, §19–§20 | Authentication; Settings |
| `sites-and-units.md` | `ProjectSite`, `ProjectUnit` | §8–§8a | Project Sites; Project Units |
| `employee.md` | `Bank`, `EmployeeTransferHistory`, `Employee` | §7, §8b, §9 | Employee Registry |
| `payroll-cycle.md` | `PayrollCycle`, `ScheduledPayrollPeriod`, `BackupPackage`, `BackupPackageFile` | §10, §10a, §17–§18 | Payroll Processing |
| `payroll-entry.md` | `PayrollEntry`, `PayrollEntryWorkLine` | §12–§12a | Payroll Entry |
| `release.md` | `PayrollUnitRelease`, `PayrollUnitReadiness` | §12b | Payroll Processing; Release Salary |
| `corrections.md` | `AdjustmentType`, `Correction`, `CorrectionRequest` | §11, §13–§13a | Corrections |
| `balance-adjustments.md` | `BalanceAdjustment`, `CorrectionPayment`, `BalanceAdjustmentSettlement` | §14–§14b | Balance Adjustments |
| `advances.md` | `Advance`, `AdvanceScheduleChange` | §15–§15a | Advances |
| `audit-log.md` | `AuditLog` | §16 | Audit Log |
| `tasks.md` | `Task`, `TaskNotification` | §27–§27a | Tasks |
| `relationships.md` | Full entity-relationship diagram and data-flow spine | §21 | Cross-cutting (derived view) |
| `schema-invariants.md` | Cross-entity checklists (immutability, append-only, transactions, optimistic locking, audit logging, single-source-of-truth), performance, future extensibility, migration strategy, open design assumptions | §22–§26 | Cross-cutting (derived view) |

Related, non-schema documentation:

| File | Contents |
|---|---|
| `docs/architecture/overview.md` | Why each module exists; the 18-module ownership table; system data flow |
| `docs/architecture/authentication.md` | RBAC rationale, session strategy, CSRF, site-scoping |
| `docs/architecture/system-conventions.md` | UUID primary-key rationale, `StorageProvider` abstraction, Audit Log immutability policy |
| `docs/architecture/workflows/payroll-lifecycle.md` | Draft/Released/Archived state machine, new-cycle creation, Payroll Cycle Selector, backup-package generation |
| `docs/architecture/workflows/outstanding-obligations.md` | The carry-forward predicate / Payroll Materialization Hook extensibility seam |
| `docs/architecture/workflows/corrections-and-balance-adjustments.md` | The full Corrections + Balance Adjustments workflow narrative |

---

## §→file lookup

| § | File |
|---|---|
| §0 | `conventions-and-enums.md` |
| §1 | `conventions-and-enums.md` |
| §2 | `access-control.md` |
| §3 | `access-control.md` |
| §4 | `access-control.md` |
| §5 | `access-control.md` |
| §6 | `access-control.md` |
| §7 | `employee.md` |
| §8 | `sites-and-units.md` |
| §8a | `sites-and-units.md` |
| §8b | `employee.md` |
| §9 | `employee.md` |
| §10 | `payroll-cycle.md` |
| §10a | `payroll-cycle.md` |
| §11 | `corrections.md` |
| §12 | `payroll-entry.md` |
| §12a | `payroll-entry.md` |
| §12b | `release.md` |
| §13 | `corrections.md` |
| §13a | `corrections.md` |
| §14 | `balance-adjustments.md` |
| §14a | `balance-adjustments.md` |
| §14b | `balance-adjustments.md` |
| §15 | `advances.md` |
| §15a | `advances.md` |
| §16 | `audit-log.md` |
| §17 | `payroll-cycle.md` |
| §18 | `payroll-cycle.md` |
| §19 | `access-control.md` |
| §20 | `access-control.md` |
| §21 | `relationships.md` |
| §22 | `schema-invariants.md` |
| §23 | `schema-invariants.md` |
| §24 | `schema-invariants.md` |
| §25 | `schema-invariants.md` |
| §26 | `schema-invariants.md` |
| §27 | `tasks.md` |
| §27a | `tasks.md` |

Note: `docs/architecture/system-conventions.md` (§1–§3) and
`docs/architecture/workflows/payroll-lifecycle.md` (§4–§5) carry their **own**, separate §-numbering,
inherited from the former `data-and-storage.md` — these numbers are a different sequence from the
§0–§26 range above (both documents historically used small integers independently). Always cite the
filename together with the section number for either range; a bare `§4` is ambiguous between the two
source documents and must not be used.
