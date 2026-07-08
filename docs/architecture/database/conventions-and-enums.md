# Database Conventions & Enum Definitions

**Owner module(s):** Cross-cutting — conventions apply to every module's schema

**Contains:** Schema-wide conventions; native enum and lookup-table definitions

**Sections:** §0–§1 · Full index: `database/README.md`

This file is part of the database schema specification — a design specification, not code, that
governs `backend/prisma/schema.prisma` once scaffolding begins. It builds directly on the frozen
architecture: `docs/PROJECT_PRINCIPLES.md`, `docs/architecture/system-conventions.md`,
`docs/architecture/workflows/payroll-lifecycle.md`,
`docs/architecture/workflows/corrections-and-balance-adjustments.md`, and
`docs/architecture/overview.md`. See `database/README.md` for the full file index and §→file map.

---

## 0. Conventions

- **Primary keys**: UUID on every application-owned table, generated at the database layer
  (`gen_random_uuid()`), per the frozen architecture. The one exception is the `Session` table,
  whose schema is owned by `connect-pg-simple`, not this application.
- **Timestamps**: `timestamptz` for every point-in-time value (`createdAt`, `releasedAt`, etc.);
  `date` for calendar dates with no time component (`dateOfBirth`, `dateOfJoining`, `dateGiven`).
- **Dates are stored in ISO form internally, always** (native `date`/`timestamptz` columns, ISO
  strings across the API) — this is unchanged by the 2026-07-03 UI display standard requiring every
  user-facing date to render as `DD-MM-YYYY`. That's a presentation-layer convention only (see
  `docs/design-system.md` §4); no column type or wire format changes because of it.
- **Money**: `numeric(12,2)` for all currency amounts (PKR). Never `float`/`double` — financial
  values must not be subject to floating-point rounding error (Principle 5: deterministic and
  reproducible calculations).
- **Mutable tables** get `createdAt` + `updatedAt`. **Immutable/append-only tables** get `createdAt`
  only — there is deliberately no `updatedAt` column where a row should never change, so its absence
  is a schema-level signal, not just a convention.
- **Enums vs. lookup tables**: a native Postgres enum is used only for closed, structural sets that
  are mechanically tied to application code anyway (a new value would require a code change
  regardless — e.g. `PayrollCycleStatus`). Business-vocabulary lists that are explicitly meant to
  grow over time without a schema migration (e.g. `AdjustmentType`, per
  `docs/architecture/workflows/corrections-and-balance-adjustments.md`) are modeled as small
  **lookup tables** instead, since adding a row is more additive-friendly (Principle 8) than
  altering an enum type.
- **Soft-delete over hard-delete**: nothing that represents a person, a payroll figure, or a
  financial event is ever hard-deleted. Employees leave (`dateOfLeaving`), Users are deactivated
  (`isActive`), advances are paid off (`status`) — rows persist, states change.

---

## 1. Enum & Lookup Type Definitions

### Native enums (closed, code-coupled sets)

| Enum | Values |
|---|---|
| `PayType` | `DAILY_WAGE`, `MONTHLY` |
| `PayrollCycleStatus` | `DRAFT`, `RELEASED`, `ARCHIVED` |
| `CorrectionField` | `GROSS_PAY`, `DAYS`, `OT_HOURS`, `OT_RATE`, `ALLOWANCE`, `LEAVE_DAYS`, `LEAVE_RATE`, `CYCLE_DAYS`, `EOBI_AMOUNT`, `EOBI_APPLICABLE`, `ADVANCE_DEDUCTION`, `EID_ADVANCE_DEDUCTION`, `FINE` |
| `BalanceAdjustmentType` | `PAYABLE`, `RECOVERY`, `NONE` (a correction with zero net difference — see `docs/architecture/workflows/corrections-and-balance-adjustments.md`) |
| `BalanceAdjustmentStatus` | `PENDING`, `SETTLED` |
| `BalanceAdjustmentPaymentTiming` | `IMMEDIATE`, `DEFERRED` — added 2026-07-05; meaningful only for `type = PAYABLE` (`database/balance-adjustments.md §14`), null for `RECOVERY`/`NONE` |
| `CorrectionRequestStatus` | `PENDING`, `APPROVED`, `REJECTED` — added 2026-07-05 (`database/corrections.md §13a`) |
| `AdvanceType` | `LOAN`, `EID_ADVANCE` |
| `AdvanceRepaymentType` | `FULL_DEDUCTION`, `INSTALLMENT` |
| `AdvanceStatus` | `ACTIVE`, `PAID_OFF` |
| `BackupFileType` | `PAYROLL_CSV`, `BANK_SHEETS_CSV`, `RECEIVINGS_CSV` (additional types appended as new backup artifacts are introduced) |

`CorrectionField` is a native enum rather than a lookup table because adding a correctable field
always requires a corresponding column on `PayrollEntry` and code to compute it — the enum and the
schema change together by necessity, so there's no extensibility benefit to a lookup table here.

### Lookup tables (extensible business vocabulary)

- **`AdjustmentType`** — see `database/corrections.md §11`. Seeded with the 7 initial types from
  `docs/architecture/workflows/corrections-and-balance-adjustments.md`; new types are added as data
  rows, never by altering existing ones (Principle 8).
- **`Bank`** — see `database/employee.md §7`. Seeded with ABL, HBL, MCB; a new bank is a data row,
  not a schema change.

---
