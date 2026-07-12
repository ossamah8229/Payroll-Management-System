# Employee Registry Schema — `Bank`, `EmployeeTransferHistory`, `Employee`

**Owner module(s):** Employee Registry

**Contains:** `Bank`, `EmployeeTransferHistory`, `Employee`

**Sections:** §7, §8b, §9 · Full index: `database/README.md`

---

## 7. `Bank`

**Purpose:** Reference list of banks an employee's own receiving account can be at.
**Why it exists:** Extensible lookup rather than a hardcoded enum — a new bank is a data row
(Principle 8).
**Revised 2026-07-02:** this table has no relationship to `ProjectSite` — see
`database/sites-and-units.md §8`'s revision note. Broom Services' own disbursement source account(s)
are a distinct concept this table does not model; see `docs/PROJECT_PROGRESS.md` for the open item
tracking that gap.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `code` | varchar(10) | no | — | e.g. `ABL`, `HBL`, `MCB` |
| `name` | varchar(120) | no | — | full name |
| `isActive` | boolean | no | `true` | retire a bank without deleting history that references it |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `code`
- **Module owner:** Employee Registry
- **Row count:** single digits

## 8b. `EmployeeTransferHistory`

**Purpose:** A dedicated, append-only record of every Employee site/unit transfer — added 2026-07-03
(session 2), alongside the finalized CNIC/Reactivate decision (§26 item 6, now in
`database/schema-invariants.md §26`).
**Why it exists:** Mirrors this schema's existing `BalanceAdjustment`-vs-`AuditLog` pattern
(`database/balance-adjustments.md §14`): the generic `AuditLog` already captures a
`employee.transferred` action (§9, below) for the cross-entity audit trail, but a future Transfer
History screen needs typed, directly queryable columns rather than parsing `AuditLog.metadata` JSON —
the same reasoning that gave `BalanceAdjustment` its own table instead of relying on `AuditLog` alone.
**No UI consumes this table in Phase 2.5** — it is designed so a Transfer History screen can be added
later without a schema change.
**Business rule tie-in:** every Employee transfer (a change to `siteId` and/or `unitId` on an existing
Employee) must be independently traceable, per the 2026-07-03 (session 2) requirement — this table is
one of the two places that traceability lives, the other being the `AuditLog` entry described in §9.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` |
| `fromSiteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT` — the site before this transfer |
| `toSiteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT` — the site after this transfer |
| `fromUnitId` | uuid | no | — | FK → `ProjectUnit.id`, `ON DELETE RESTRICT` — the unit before this transfer |
| `toUnitId` | uuid | no | — | FK → `ProjectUnit.id`, `ON DELETE RESTRICT` — the unit after this transfer |
| `effectiveDate` | date | no | — | the calendar date the transfer actually took effect in the business, **deliberately distinct from `createdAt`** — HR may enter a transfer into the system days or weeks after it actually happened; this is the date every reporting/query use case (§ below) reasons about |
| `transferredByUserId` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — the user who entered this transfer record |
| `reason` | text | yes | — | optional free-text explanation of *why* the transfer happened |
| `remarks` | text | yes | — | optional free-text notes, distinct from `reason` (e.g. handover details, temporary-vs-permanent context) |
| `createdAt` | timestamptz | no | `now()` | when this record was entered into the system — not necessarily the same moment as `effectiveDate` |

- **Unique constraints:** none — an employee may transfer any number of times
- **Indexes:** (`employeeId`, `effectiveDate` desc) — the primary "this employee's transfer history, in
  business-effective order" lookup, which is what "where did this employee work on 15 March"-style
  point-in-time queries need (querying `createdAt` order would give the wrong answer whenever a
  transfer is entered late); (`toUnitId`, `effectiveDate`) for "which employees transferred into unit X
  in period Y" reporting; (`fromSiteId`), (`toSiteId`), (`fromUnitId`) for the remaining unit/site-level
  reporting directions. This table's column shape (typed `effectiveDate`, not just a timestamp) is
  deliberately designed now for the future/no-UI-yet reporting this enables — "how many transfers has
  this employee had," "where did this employee work on a given date," "who transferred into Warehouse
  this year" — even though no screen consumes it in Phase 2.5.
- **Cascade:** all FKs `RESTRICT` — a transfer record is never orphaned by deleting the employee, a
  site, a unit, or the acting user; this also means a `ProjectSite`/`ProjectUnit` cannot be deleted
  while any historical transfer still references it, on top of the existing active-reference checks
  (`database/sites-and-units.md §8/§8a`) — consistent with Principle 2 (historical data is never
  silently orphaned)
- **Module owner:** Employee Registry (same module that owns `Employee` and its transfer logic)
- **Immutable, append-only:** yes — a transfer record, once written, is never edited or deleted except
  by direct database intervention; no application code path exists to update or remove a row, matching
  this schema's existing append-only convention (`database/schema-invariants.md §22`) for
  `Correction`/`AuditLog`/`BackupPackage`. Unlike `AuditLog` (`database/audit-log.md §16`), this is an
  application-layer-only guarantee — no database trigger is proposed here, consistent with how
  `Correction`/`BackupPackage` are also append-only by convention without a DB-level trigger; only the
  Audit Log itself carries that extra enforcement layer, per Principle 3.
- **Transactions required:** yes — written in the same transaction as the `Employee` row update and
  the corresponding `AuditLog` `employee.transferred` entry (§9) whenever a transfer occurs
- **Row count:** small — one row per actual site/unit transfer event, a rare action relative to
  ordinary Employee edits

## 9. `Employee`

**Purpose:** Identity, employment, and bank details for a person on payroll — the Employee Registry.
**Why it exists:** Master record of *who* someone is, independent of any single month's payroll
figures (Principle 1: Payroll Entry owns the monthly figures; Employee owns identity).
**Business rule tie-in:** CNIC as the cross-system identifier; historical preservation via
`dateOfLeaving` instead of deletion (`PROJECT_SPEC.md`).
**Revised 2026-07-03 — `unitId` added:** an employee is deputed to a specific Project Unit (Branch/
Department/Section — terminology per `ProjectSite.unitLabel`, `database/sites-and-units.md §8`), not
just "the site" as an undifferentiated whole. `unitId` records that employee's **current default unit**
— the one they're ordinarily rostered to — and is changed only by an explicit, audited Employee edit (a
"transfer"), exactly like a `siteId` change already works. It is never changed automatically by a
payroll cycle's attendance breakdown: an employee occasionally working a different unit for part of a
cycle (`PayrollEntryWorkLine`, `database/payroll-entry.md §12a`) leaves this default untouched.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `employeeCode` | varchar(30) | yes | — | e.g. `V001`; real client data is inconsistently formatted across sites — see `database/schema-invariants.md §26` assumptions |
| `cnic` | varchar(15) | yes | — | 13-digit Pakistani CNIC, **stored digits-only** (any dashes/spaces the user enters are normalized away before validation/storage — see `database/schema-invariants.md §26` item 6); nullable to accommodate an employee added before their CNIC is on file — see `database/schema-invariants.md §26` |
| `name` | varchar(160) | no | — | |
| `fatherName` | varchar(160) | yes | — | |
| `religion` | varchar(40) | yes | — | free text — see `database/schema-invariants.md §26` (not an enum) |
| `dateOfBirth` | date | yes | — | real client data frequently omits this |
| `mobileNumber` | varchar(20) | yes | — | |
| `designation` | varchar(80) | no | — | free text — sites use varied, evolving designation names |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT`. Kept as a direct column (not just derivable via `unitId → ProjectUnit.siteId`) specifically so it can participate in the composite FK below — this is what turns "the unit must belong to this employee's own site" into a database guarantee instead of an application-layer check |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, paired with `siteId` above via a **composite foreign key** `(unitId, siteId) → ProjectUnit(id, siteId)` against `ProjectUnit`'s own `(id, siteId)` unique index (`database/sites-and-units.md §8a`) — Postgres itself rejects any row where the referenced unit doesn't belong to the referenced site; added 2026-07-03 |
| `dateOfJoining` | date | yes | — | |
| `dateOfLeaving` | date | yes | — | presence = employee has left; drives "active employee" filtering |
| `payType` | `PayType` | no | `'DAILY_WAGE'` | |
| `grossPay` | numeric(12,2) | no | — | current/base gross pay — **template value only**; each cycle's actual `PayrollEntry.grossPay` is what's authoritative for that month, see `database/payroll-entry.md §12`. **Verified 2026-07-03**: nothing in `reference/PROJECT_SPEC.md` or this schema suggests gross pay varies by which unit an employee works — only the day-rate *basis* (cycle days, OT rate, leave rate) is documented as location-varying, previously by site and now by unit (`database/payroll-entry.md §12a`). `grossPay` stays a single scalar here and on `PayrollEntry`. |
| `bankId` | uuid | yes | — | FK → `Bank.id`, `ON DELETE RESTRICT`; null = no bank on file |
| `branchCode` | varchar(20) | yes | — | **the employee's own bank branch code** — unrelated to `ProjectUnit.code` (`database/sites-and-units.md §8a`) or the removed `ProjectSite.branchCode` (`database/sites-and-units.md §8`); three different "branch code" concepts have existed across this schema's history, and this is the one that survives unchanged: an employee's bank account's branch code, nothing to do with where they're deputed |
| `accountNumber` | varchar(40) | yes | — | null + null `bankId` ⇒ cash payment (derived rule, applied wherever bank-account presence is checked — e.g. Bank Sheet vs. Cash Receiving eligibility). **Banking rule (2026-07-11):** required whenever `bankId` is set — enforced server-side against the merged post-update state (`employees.service.ts`'s `applyBankingInvariant`), never entered-but-ignored |
| `iban` | varchar(34) | yes | — | **Added 2026-07-11, replacing `accountTitle` (removed the same pass — no longer stored anywhere).** Optional even for a bank employee (many employees operationally don't know or provide one); stored trimmed and uppercase, displayed exactly as stored, never truncated (the permanent Layout Integrity Rule). 34 chars is the ISO 13616 international maximum; a Pakistani IBAN is 24. A cash employee (`bankId` null) always has `accountNumber`/`iban` both null too — enforced the same way |
| `defaultEobiAmount` | numeric(10,2) | no | `400.00` | seeds a new `PayrollEntry.eobiAmount` when this employee is first added to a cycle |
| `defaultEobiApplicable` | boolean | no | `true` | seeds `PayrollEntry.eobiApplicable`; some employees are exempt |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `employeeCode` (partial, `WHERE employeeCode IS NOT NULL`); `cnic` (partial,
  `WHERE cnic IS NOT NULL`) — both nullable-but-unique-when-present, per `database/schema-invariants.md
  §26`; `(unitId, siteId)` composite FK target consumed from `ProjectUnit`, not a uniqueness rule on
  this table itself
- **Check constraints:** `grossPay >= 0`; `defaultEobiAmount >= 0`; `cnic` matches a 13-digit numeric
  pattern when present. **`iban` deliberately has no format/checksum constraint** (2026-07-11) — unlike
  `cnic`, it follows `accountNumber`/`branchCode`'s existing precedent of a free-form, length-capped
  string; a wrong-format IBAN is a data-entry problem for whoever submits the Bank Sheet to the bank,
  not a condition this schema rejects
- **Indexes:** partial unique(`cnic`) — this is also the primary lookup index for CNIC-based search;
  partial unique(`employeeCode`); (`siteId`); (`unitId`) for the "employees at this unit" query;
  partial index `WHERE dateOfLeaving IS NULL` (active employees, the common-case filter); optional
  trigram index on `name` if free-text employee search proves slow at scale — worth reassessing
  concretely now that Principle 10 sets a 10,000-employee design floor, rather than assuming it's
  unlikely as previously noted here for the ~1,500-employee case
- **Cascade:** `siteId`, `unitId`, and `bankId` are all `RESTRICT` — an employee record must never
  silently lose its site/unit/bank reference
- **Module owner:** Employee Registry (identity/employment/bank fields, including `unitId`); the
  `ProjectUnit` master-data lookup itself is owned by the dedicated Project Units module
  (`database/sites-and-units.md §8a`)
- **Immutability:** mutable while the employee is active; **never hard-deleted**
- **RBAC:** Payroll Staff view/edit/create access is restricted to their assigned **sites**, with no
  global access of any kind, unchanged — enforced server-side on every route
  (`docs/architecture/authentication.md`). A create request's `siteId` must be one of the requesting
  user's assigned sites; `unitId` must belong to that same `siteId` (database-guaranteed, above). RBAC
  is deliberately **not** unit-granular — since a `ProjectUnit` belongs to exactly one `ProjectSite`,
  a Payroll Staff member with site access already has full access to every unit under it; there is no
  separate unit-level assignment concept, and 2026-07-03's architecture review confirmed there should
  never be a cross-site editing exception for a multi-unit employee (see `database/payroll-entry.md
  §12a`). Master User is unrestricted.
- **Audit logging:** every create/update writes a generic `employee.updated` (or `.created`) entry
  with a field-level diff in `metadata`. **Revised 2026-07-03 (session 2):** an edit that changes
  `siteId` and/or `unitId` writes a distinct **`employee.transferred`** entry instead of the generic
  `employee.updated` entry for that edit — carrying old site/unit, new site/unit, the acting user, and
  the timestamp — and, in the same transaction, a row in the new `EmployeeTransferHistory` table
  (§8b); an edit to any other field continues to produce the ordinary `employee.updated` entry,
  unchanged. Setting `dateOfLeaving` writes a distinct `employee.left` entry; clearing it via the new
  **Reactivate** action (`database/schema-invariants.md §26` item 6, now finalized) writes a distinct
  `employee.reactivated` entry — and if that same reactivation also changes site/unit, the
  `employee.transferred` entry and `EmployeeTransferHistory` row fire alongside it, since reactivation
  and transfer are independent facts that can co-occur. A change to `siteId`/`unitId` here **never**
  cascades into any existing `PayrollEntry` — see `database/payroll-entry.md §12`.
- **Row count:** ~1,500 active today; the system's design floor is 10,000+ (Principle 10), growing to
  several thousand over years given high turnover with history retained

---
