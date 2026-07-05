# Database Schema Specification

This is a design specification, not code. No Prisma models or SQL are included here — this document
is the contract that schema implementation (Prisma `schema.prisma` + migrations) must satisfy. It
governs `backend/prisma/schema.prisma` once scaffolding begins.

It builds directly on the frozen architecture: `docs/PROJECT_PRINCIPLES.md`,
`docs/architecture/data-and-storage.md`, `docs/architecture/post-release-corrections.md`, and
`docs/architecture/overview.md`.

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
  `docs/architecture/post-release-corrections.md`) are modeled as small **lookup tables** instead,
  since adding a row is more additive-friendly (Principle 8) than altering an enum type.
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
| `BalanceAdjustmentType` | `PAYABLE`, `RECOVERY`, `NONE` (a correction with zero net difference — see `docs/architecture/post-release-corrections.md`) |
| `BalanceAdjustmentStatus` | `PENDING`, `SETTLED` |
| `BalanceAdjustmentPaymentTiming` | `IMMEDIATE`, `DEFERRED` — added 2026-07-05; meaningful only for `type = PAYABLE` (§14), null for `RECOVERY`/`NONE` |
| `CorrectionRequestStatus` | `PENDING`, `APPROVED`, `REJECTED` — added 2026-07-05 (§13a) |
| `AdvanceType` | `LOAN`, `EID_ADVANCE` |
| `AdvanceRepaymentType` | `FULL_DEDUCTION`, `INSTALLMENT` |
| `AdvanceStatus` | `ACTIVE`, `PAID_OFF` |
| `BackupFileType` | `PAYROLL_CSV`, `BANK_SHEETS_CSV`, `RECEIVINGS_CSV` (additional types appended as new backup artifacts are introduced) |

`CorrectionField` is a native enum rather than a lookup table because adding a correctable field
always requires a corresponding column on `PayrollEntry` and code to compute it — the enum and the
schema change together by necessity, so there's no extensibility benefit to a lookup table here.

### Lookup tables (extensible business vocabulary)

- **`AdjustmentType`** — see §11. Seeded with the 7 initial types from
  `docs/architecture/post-release-corrections.md`; new types are added as data rows, never by
  altering existing ones (Principle 8).
- **`Bank`** — see §7. Seeded with ABL, HBL, MCB; a new bank is a data row, not a schema change.

---

## 2. `Role`

**Purpose:** Defines a named bundle of permissions (Master User, Payroll Staff, Finance, and any
future role such as an ESS "Employee" role).
**Why it exists:** `docs/architecture/authentication.md` requires RBAC to be modeled as
Role → Permission, not hardcoded role checks, so a new role is a data change.
**Business rule tie-in:** Principle 7 (RBAC must never be bypassed).
**Revised 2026-07-05 (Phase 3 architecture review) — `FINANCE` added as a third role:** the new
per-Project-Unit release model (§12b) introduces a distinct capability — executing a Unit's release
once client funding is confirmed — that is neither Payroll Staff's data-entry role nor Master User's
governance/approval role. See `docs/architecture/authentication.md` for its full permission set and
site-scoping. **"Master Admin" is renamed "Master User" throughout this document set as of the same
review** — same role, no functional change, terminology only.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `code` | varchar(40) | no | — | e.g. `MASTER_USER`, `PAYROLL_STAFF`, `FINANCE` — stable programmatic key |
| `name` | varchar(80) | no | — | display name |
| `description` | text | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `code`
- **Indexes:** unique index on `code` (doubles as lookup index)
- **Module owner:** Authentication
- **Row count:** 2–5 (rarely grows) — now 3 at launch (`MASTER_USER`, `PAYROLL_STAFF`, `FINANCE`)

## 3. `Permission`

**Purpose:** An individual, checkable capability (e.g. `payroll:release`, `sites:manage`,
`corrections:approve`).
**Why it exists:** The atomic unit RBAC middleware checks per route — see
`docs/architecture/authentication.md`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `key` | varchar(80) | no | — | e.g. `payroll:release` |
| `description` | text | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `key`
- **Module owner:** Authentication
- **Row count:** a few dozen, one per protected capability — grows additively as features are added

## 4. `RolePermission`

**Purpose:** Join table — which permissions a role grants.
**Why it exists:** Many-to-many between `Role` and `Permission`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK (surrogate, simpler than composite PK for ORM tooling) |
| `roleId` | uuid | no | — | FK → `Role.id`, `ON DELETE CASCADE` |
| `permissionId` | uuid | no | — | FK → `Permission.id`, `ON DELETE CASCADE` |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`roleId`, `permissionId`)
- **Indexes:** (`roleId`), (`permissionId`)
- **Cascade:** `CASCADE` on both FKs — a pure join row has no meaning without both parents (the only
  tables in this schema where cascade delete is appropriate, since `Role`/`Permission` themselves are
  never expected to be deleted in practice, only deactivated/unused).
- **Module owner:** Authentication

## 5. `User`

**Purpose:** A login account — Master User, Payroll Staff, or (added 2026-07-05) Finance.
**Why it exists:** Core identity for everyone who accesses the system (not to be confused with
`Employee`, who is paid but does not log in, at least until an ESS module exists).
**Business rule tie-in:** Principle 7; `docs/architecture/authentication.md`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `roleId` | uuid | no | — | FK → `Role.id`, `ON DELETE RESTRICT` |
| `name` | varchar(120) | no | — | display name |
| `email` | varchar(255) | no | — | login identifier |
| `passwordHash` | varchar(255) | no | — | argon2 hash; never plaintext |
| `avatarStorageKey` | text | yes | — | `StorageProvider` key, see `data-and-storage.md` §2 |
| `themeAccentColor` | varchar(7) | yes | `'#1B4F72'` | per-user hex color, doesn't affect other users |
| `isActive` | boolean | no | `true` | deactivation flag — never hard-delete a `User` |
| `lastLoginAt` | timestamptz | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `email`
- **Check constraints:** `email` matches a basic email format (defense in depth; real validation is
  app-layer via Zod)
- **Indexes:** unique(`email`), (`roleId`), partial index on `isActive = true` for fast "active
  users" listings
- **Cascade:** `roleId` is `RESTRICT` — a role in active use cannot be deleted out from under a user
- **Module owner:** Settings (account management) jointly with Authentication (login mechanics) — see
  `docs/architecture/overview.md`
- **Row count:** single-digit to low double-digit (internal staff only)

## 6. `UserSiteAssignment`

**Purpose:** Which project sites a Payroll Staff **or Finance** user may access.
**Why it exists:** Site-based permission scoping, independent of role
(`docs/architecture/authentication.md`).
**Business rule tie-in:** "Payroll Staff can enter attendance/payroll data only for their assigned
project sites" (`PROJECT_SPEC.md`); the same site-scoping mechanism was reused, unchanged, for
Finance's own site assignment when that role was added 2026-07-05 (Phase 3 architecture review) —
no new assignment table was needed, since Finance's scoping model is identical in shape to Payroll
Staff's.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `userId` | uuid | no | — | FK → `User.id`, `ON DELETE CASCADE` |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE CASCADE` |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`userId`, `siteId`)
- **Indexes:** (`userId`), (`siteId`)
- **Note:** Master User has implicit access to all sites and has no rows here — absence of rows for
  Master User is not treated as "no access"; this table is only consulted for Payroll Staff and
  Finance.
- **Module owner:** Settings/Authentication

## 7. `Bank`

**Purpose:** Reference list of banks an employee's own receiving account can be at.
**Why it exists:** Extensible lookup rather than a hardcoded enum — a new bank is a data row
(Principle 8).
**Revised 2026-07-02:** this table has no relationship to `ProjectSite` — see §8's revision note.
Broom Services' own disbursement source account(s) are a distinct concept this table does not
model; see `docs/PROJECT_PROGRESS.md` for the open item tracking that gap.

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

## 8. `ProjectSite`

**Purpose:** A client relationship/location an employee is deputed to (e.g. "ABL City Region
Lahore" — Broom Services is a payroll-outsourcing company deputing staff to *client* sites;
`reference/PROJECT_SPEC.md` names banks as example clients, e.g. "banks like ABL/HBL/MCB, malls,
retail outfitters"). **Project Sites are pure client/location records — no financial/banking
properties, and, as of 2026-07-03, no operational-unit properties either** (see the revision note
below and the new §8a `ProjectUnit`).
**Why it exists:** Owns site master data; referenced by Project Unit (operational sub-division),
Employee (deputed site — still a direct FK, see §9's composite-FK note), and User (staff assignment —
still site-level, unchanged).
**Business rule tie-in:** "Delete is blocked if employees are still assigned" (`PROJECT_SPEC.md`) —
now enforced at *two* levels: directly (any `Employee.siteId` reference, unchanged from before) and
transitively (any `ProjectUnit.siteId` reference — so a site can't be deleted while it still has unit
rows, even ones with no employees currently assigned).
**Revised 2026-07-02 — `defaultBankId` removed (final decision, no longer open):** an earlier
revision of this table added `defaultBankId` (a "site's typical bank" FK to `Bank`), reasoning that
a new employee's bank could default from their site. This was incorrect: it conflated a site's
*client identity* (site names like "ABL City Region Lahore" identify the client, not a bank Broom
Services itself banks with) with actual banking data. Project Sites have no banking properties in
this system — employees own their own receiving bank account (`Employee.bankId`), and Broom
Services' own disbursement source account(s) are a separate, not-yet-modeled concept (see §7).
Removed from the schema, the one Phase 2 migration that had added it (never applied to any live
database), and every dependent layer, before the Phase 2 commit.
**Revised 2026-07-02 — `address` added (Phase 2 UI/UX polish pass):** the open question in
`docs/PROJECT_PROGRESS.md` §3 item 8 ("does `ProjectSite` need `address`?") was resolved by explicit
user authorization during a UI-only polish pass, as a scoped exception to that pass's own
no-schema-changes rule — physical work-location addresses are operationally required (site visits,
deployment, documentation) and this is an additive, single-nullable-column change consistent with
Principle 8. Deliberately narrow: no `client`/`Client` entity was introduced alongside it (site names
already encode the client as free text, unchanged from the reasoning in the removed-`defaultBankId`
note above).
**Revised 2026-07-03 — `branchCode` removed; `unitLabel` added (final decision, pre-Phase-3
architecture review):** a Project Site was never meant to own a single Branch Code — real client
sites are internally subdivided into multiple Branches/Departments/Sections (terminology varies per
client), each with its own code and name, and an employee is deputed to one specific subdivision, not
"the site" as an undifferentiated whole. `branchCode` is removed from this table entirely and its
concept moves down to the new child entity, `ProjectUnit` (§8a) — generic in the data model, but
displayed using whichever term this specific site's business actually uses, via the new `unitLabel`
field below. This also resolves the ambiguity in `reference/PROJECT_SPEC.md`'s "Official Data
Template," whose `Branch Code`/`Area`/`Area/Location` columns conflated site- and unit-level concepts
under one flat header row — those columns now map onto `ProjectUnit` fields, not `ProjectSite` ones,
in the Employee Registry import/export (Phase 2's import/export code needs a corresponding update
before this is usable operationally — see `docs/IMPLEMENTATION_PLAN.md`'s Phase 2.5 section).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `name` | varchar(160) | no | — | |
| `address` | varchar(300) | yes | — | physical work-location address; added 2026-07-02 |
| `unitLabel` | varchar(40) | no | `'Branch'` | the term this site's own business uses for its operational sub-divisions (e.g. "Branch", "Department", "Section", "Division") — drives every place the UI names a `ProjectUnit` for this site; free text, not an enum, so a client's own vocabulary is never blocked by a missing picklist value (Principle 8) — added 2026-07-03 |
| `isActive` | boolean | no | `true` | |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `name`
- **Indexes:** unique(`name`)
- **Cascade / business rule enforcement:** deletion is blocked at the application layer while any
  `Employee.siteId` or `ProjectUnit.siteId` references this row (checked before delete); both FKs
  (`Employee.siteId → ProjectSite.id`, `ProjectUnit.siteId → ProjectSite.id`) are `ON DELETE RESTRICT`
  as a database-level backstop so this can never be bypassed by a bug or a raw query. A site must have
  both its units and its employees cleared before it can be deleted.
- **Module owner:** Project Sites
- **Row count:** ~10–30

## 8a. `ProjectUnit`

**Purpose:** The operational sub-division of a `ProjectSite` that an employee is actually deputed
to — a specific bank branch, mall department, retail section, etc. Internally a single generic model
regardless of what a given client calls it; the UI always displays the owning site's `unitLabel`
(§8) in place of the literal word "Unit".
**Why it exists:** Added 2026-07-03, replacing the site-level `branchCode` this table's revision note
(§8) describes. A real client site (e.g. one bank client) has several distinct branches, each staffed
independently, each with its own code — modeling this as a single flat field on `ProjectSite` couldn't
express "many branches under one client," and blocked the core Phase 3 requirement that an employee's
attendance be attributable to a specific branch/department, potentially more than one within the same
payroll cycle (see the new `PayrollEntryWorkLine`, §12a).
**Business rule tie-in:** an `Employee`'s deputed site (`siteId`) and deputed unit (`unitId`) are both
stored directly on the `Employee` row, kept consistent by a composite foreign key rather than by
convention (§9); Payroll Work Lines reference Project Units the same way (§12a); delete is blocked
while employees or work lines still reference a unit, same pattern as every other master-data delete
in this schema.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT` |
| `name` | varchar(160) | no | — | e.g. "Model Town Branch", "Finance Department" |
| `code` | varchar(20) | yes | — | the unit's own operational code — this is the direct successor to the removed `ProjectSite.branchCode`, now correctly scoped to the specific branch/department it identifies rather than an entire client site |
| `isActive` | boolean | no | `true` | retire a unit without breaking historical `Employee`/`PayrollEntryWorkLine` references to it |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`siteId`, `name`) — a unit name is unique *within* its site, not globally
  (two different client sites may each have their own "Finance" unit); **also `(`id`, `siteId`)`,
  which is not a business uniqueness rule but exists purely so downstream tables can declare a
  composite foreign key against it** (see §9, §12a) — this is what makes it a database-level
  guarantee, not just an application-layer check, that an `Employee` or `PayrollEntryWorkLine` can
  never reference a unit belonging to a *different* site than the one already recorded on that same
  row.
- **Indexes:** unique(`siteId`, `name`); unique(`id`, `siteId`) (composite-FK-support index, above);
  (`siteId`) for the "units under this site" listing query
- **Cascade:** `siteId` is `RESTRICT` — a site with units cannot be deleted (§8)
- **Module owner:** **Project Units — a dedicated master-data module**, owned/administered per Project
  Site (not folded into the Project Sites module's own CRUD, per the 2026-07-03 architecture
  decision), analogous to how `Bank`/`AdjustmentType` are their own lookup concepts even though they
  feed other modules
- **Business rule enforcement:** deletion blocked at the application layer while any
  `Employee.unitId` or `PayrollEntryWorkLine.unitId` references this row, with the FK itself as a
  database-level `RESTRICT` backstop — same pattern as every other referenced-master-data delete in
  this schema
- **Row count:** a handful to a few dozen per site (~50–300 total across all sites, comparable order
  of magnitude to `ProjectSite` itself today, scaling with client count rather than employee count)

## 8b. `EmployeeTransferHistory`

**Purpose:** A dedicated, append-only record of every Employee site/unit transfer — added 2026-07-03
(session 2), alongside the finalized CNIC/Reactivate decision (§26 item 6).
**Why it exists:** Mirrors this schema's existing `BalanceAdjustment`-vs-`AuditLog` pattern (§14): the
generic `AuditLog` already captures a `employee.transferred` action (§9, below) for the cross-entity
audit trail, but a future Transfer History screen needs typed, directly queryable columns rather than
parsing `AuditLog.metadata` JSON — the same reasoning that gave `BalanceAdjustment` its own table
instead of relying on `AuditLog` alone. **No UI consumes this table in Phase 2.5** — it is designed so
a Transfer History screen can be added later without a schema change.
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
  (§8/§8a) — consistent with Principle 2 (historical data is never silently orphaned)
- **Module owner:** Employee Registry (same module that owns `Employee` and its transfer logic)
- **Immutable, append-only:** yes — a transfer record, once written, is never edited or deleted except
  by direct database intervention; no application code path exists to update or remove a row, matching
  this schema's existing append-only convention (§22) for `Correction`/`AuditLog`/`BackupPackage`. Unlike
  `AuditLog` (§3, §16), this is an application-layer-only guarantee — no database trigger is proposed
  here, consistent with how `Correction`/`BackupPackage` are also append-only by convention without a
  DB-level trigger; only the Audit Log itself carries that extra enforcement layer, per Principle 3.
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
Department/Section — terminology per `ProjectSite.unitLabel`, §8), not just "the site" as an
undifferentiated whole. `unitId` records that employee's **current default unit** — the one they're
ordinarily rostered to — and is changed only by an explicit, audited Employee edit (a "transfer"),
exactly like a `siteId` change already works. It is never changed automatically by a payroll cycle's
attendance breakdown: an employee occasionally working a different unit for part of a cycle
(`PayrollEntryWorkLine`, §12a) leaves this default untouched.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `employeeCode` | varchar(30) | yes | — | e.g. `V001`; real client data is inconsistently formatted across sites — see §26 assumptions |
| `cnic` | varchar(15) | yes | — | 13-digit Pakistani CNIC, **stored digits-only** (any dashes/spaces the user enters are normalized away before validation/storage — see the new §26 item 6); nullable to accommodate an employee added before their CNIC is on file — see §26 |
| `name` | varchar(160) | no | — | |
| `fatherName` | varchar(160) | yes | — | |
| `religion` | varchar(40) | yes | — | free text — see §26 (not an enum) |
| `dateOfBirth` | date | yes | — | real client data frequently omits this |
| `mobileNumber` | varchar(20) | yes | — | |
| `designation` | varchar(80) | no | — | free text — sites use varied, evolving designation names |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT`. Kept as a direct column (not just derivable via `unitId → ProjectUnit.siteId`) specifically so it can participate in the composite FK below — this is what turns "the unit must belong to this employee's own site" into a database guarantee instead of an application-layer check |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, paired with `siteId` above via a **composite foreign key** `(unitId, siteId) → ProjectUnit(id, siteId)` against `ProjectUnit`'s own `(id, siteId)` unique index (§8a) — Postgres itself rejects any row where the referenced unit doesn't belong to the referenced site; added 2026-07-03 |
| `dateOfJoining` | date | yes | — | |
| `dateOfLeaving` | date | yes | — | presence = employee has left; drives "active employee" filtering |
| `payType` | `PayType` | no | `'DAILY_WAGE'` | |
| `grossPay` | numeric(12,2) | no | — | current/base gross pay — **template value only**; each cycle's actual `PayrollEntry.grossPay` is what's authoritative for that month, see §12. **Verified 2026-07-03**: nothing in `reference/PROJECT_SPEC.md` or this schema suggests gross pay varies by which unit an employee works — only the day-rate *basis* (cycle days, OT rate, leave rate) is documented as location-varying, previously by site and now by unit (§12a). `grossPay` stays a single scalar here and on `PayrollEntry`. |
| `bankId` | uuid | yes | — | FK → `Bank.id`, `ON DELETE RESTRICT`; null = no bank on file |
| `branchCode` | varchar(20) | yes | — | **the employee's own bank branch code** — unrelated to `ProjectUnit.code` (§8a) or the removed `ProjectSite.branchCode` (§8); three different "branch code" concepts have existed across this schema's history, and this is the one that survives unchanged: an employee's bank account's branch code, nothing to do with where they're deputed |
| `accountNumber` | varchar(40) | yes | — | null + null `bankId` ⇒ cash payment (derived rule, applied wherever bank-account presence is checked — e.g. Bank Sheet vs. Cash Receiving eligibility) |
| `accountTitle` | varchar(160) | yes | — | |
| `defaultEobiAmount` | numeric(10,2) | no | `400.00` | seeds a new `PayrollEntry.eobiAmount` when this employee is first added to a cycle |
| `defaultEobiApplicable` | boolean | no | `true` | seeds `PayrollEntry.eobiApplicable`; some employees are exempt |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `employeeCode` (partial, `WHERE employeeCode IS NOT NULL`); `cnic` (partial,
  `WHERE cnic IS NOT NULL`) — both nullable-but-unique-when-present, per §26; `(unitId, siteId)`
  composite FK target consumed from `ProjectUnit`, not a uniqueness rule on this table itself
- **Check constraints:** `grossPay >= 0`; `defaultEobiAmount >= 0`; `cnic` matches a 13-digit numeric
  pattern when present
- **Indexes:** partial unique(`cnic`) — this is also the primary lookup index for CNIC-based search;
  partial unique(`employeeCode`); (`siteId`); (`unitId`) for the "employees at this unit" query;
  partial index `WHERE dateOfLeaving IS NULL` (active employees, the common-case filter); optional
  trigram index on `name` if free-text employee search proves slow at scale — worth reassessing
  concretely now that Principle 10 sets a 10,000-employee design floor, rather than assuming it's
  unlikely as previously noted here for the ~1,500-employee case
- **Cascade:** `siteId`, `unitId`, and `bankId` are all `RESTRICT` — an employee record must never
  silently lose its site/unit/bank reference
- **Module owner:** Employee Registry (identity/employment/bank fields, including `unitId`); the
  `ProjectUnit` master-data lookup itself is owned by the dedicated Project Units module (§8a)
- **Immutability:** mutable while the employee is active; **never hard-deleted**
- **RBAC:** Payroll Staff view/edit/create access is restricted to their assigned **sites**, with no
  global access of any kind, unchanged — enforced server-side on every route
  (`docs/architecture/authentication.md`). A create request's `siteId` must be one of the requesting
  user's assigned sites; `unitId` must belong to that same `siteId` (database-guaranteed, above). RBAC
  is deliberately **not** unit-granular — since a `ProjectUnit` belongs to exactly one `ProjectSite`,
  a Payroll Staff member with site access already has full access to every unit under it; there is no
  separate unit-level assignment concept, and 2026-07-03's architecture review confirmed there should
  never be a cross-site editing exception for a multi-unit employee (see §12a). Master User is
  unrestricted.
- **Audit logging:** every create/update writes a generic `employee.updated` (or `.created`) entry
  with a field-level diff in `metadata`. **Revised 2026-07-03 (session 2):** an edit that changes
  `siteId` and/or `unitId` writes a distinct **`employee.transferred`** entry instead of the generic
  `employee.updated` entry for that edit — carrying old site/unit, new site/unit, the acting user, and
  the timestamp — and, in the same transaction, a row in the new `EmployeeTransferHistory` table
  (§8b); an edit to any other field continues to produce the ordinary `employee.updated` entry,
  unchanged. Setting `dateOfLeaving` writes a distinct `employee.left` entry; clearing it via the new
  **Reactivate** action (§26 item 6, now finalized) writes a distinct `employee.reactivated` entry —
  and if that same reactivation also changes site/unit, the `employee.transferred` entry and
  `EmployeeTransferHistory` row fire alongside it, since reactivation and transfer are independent
  facts that can co-occur. A change to `siteId`/`unitId` here **never** cascades into any existing
  `PayrollEntry` — see §12.
- **Row count:** ~1,500 active today; the system's design floor is 10,000+ (Principle 10), growing to
  several thousand over years given high turnover with history retained

## 10. `PayrollCycle`

**Purpose:** One calendar month's payroll processing run, and its lifecycle state.
**Why it exists:** Owns the Draft → Released → Archived state machine
(`docs/architecture/data-and-storage.md` §4) that everything else in the system keys off.
**Business rule tie-in:** Principles 2 and 9; historical viewing (Payroll Cycle Selector) is always
scoped by a `PayrollCycle`.
**Revised 2026-07-05 (Phase 3 architecture review) — release now happens per Project Unit, not
per Cycle directly:** `PayrollEntry.released` (below, §12) is no longer set by a direct per-employee
action — it's now derived, set transactionally the moment every `ProjectUnit` an entry's work lines
touch has its own `PayrollUnitRelease` row (§12b) for this cycle. **This section's finalization
precondition wording is unchanged** — "no `PayrollEntry` with `released = false AND hold = false`" —
because that flag's *meaning* didn't change, only what sets it. Finalize Cycle also **stays an
explicit, separate Master User action** on top of per-Unit release completing (confirmed 2026-07-05,
not automatic) — a cycle whose every Unit has released-or-been-held is merely *eligible* to finalize,
still shown as `DRAFT` until a Master User explicitly finalizes it, exactly as today.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `year` | smallint | no | — | |
| `month` | smallint | no | — | 1–12; **display label (e.g. "April 2026") is computed, never stored** — see §22 |
| `status` | `PayrollCycleStatus` | no | `'DRAFT'` | |
| `sourceCycleId` | uuid | yes | — | FK → `PayrollCycle.id` (self), `ON DELETE RESTRICT` — the cycle this one was carried forward from, for traceability |
| `createdAt` | timestamptz | no | `now()` | |
| `createdBy` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` |
| `releasedAt` | timestamptz | yes | — | set when status → `RELEASED` |
| `releasedBy` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT` |
| `archivedAt` | timestamptz | yes | — | set when status → `ARCHIVED` |
| `archivedBy` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT`; null if the archive was a fully automatic system action |

- **Unique constraints:** (`year`, `month`) — one cycle per calendar month, ever
- **Check constraints:** `month BETWEEN 1 AND 12`
- **Indexes:** unique(`year`, `month`); (`status`) — the "which cycle is currently Draft" lookup is
  hot and should be a fast partial index `WHERE status = 'DRAFT'` (also enforces, together with
  application logic, that only one cycle is ever Draft)
- **Cascade:** all FKs `RESTRICT` — a cycle and the users who acted on it are never deleted out from
  under this record
- **Module owner:** Payroll Processing
- **Finalization precondition (`DRAFT` → `RELEASED`):** enforced at the application/service layer as
  a cross-row check inside the same transaction as the status update — the transition is refused
  unless zero `PayrollEntry` rows in this cycle have `released = false AND hold = false`. This cannot
  be expressed as a single-row `CHECK` constraint since it spans every entry in the cycle. **There is
  no Master User override**: a cycle with unreleased, non-held stragglers cannot be finalized until
  they are released or held. Employees left on `hold` do not block finalization and may remain
  outstanding indefinitely. **A Late Entry (§12b) does not block finalization either** if it's still
  awaiting its own one-off release — it behaves like an unreleased-and-non-held entry for this
  precondition's purposes, same as any other straggler, with no special exception.
- **Immutability:** the row itself (status/timestamps) is updated exactly three times over its
  lifetime (created → released → archived); **once `ARCHIVED`, no column on this row changes again**
- **Transactions required:** yes — every status transition is a multi-table transaction (see §22)
- **Row count:** one per month — trivially small (~12/year)

## 11. `AdjustmentType`

**Purpose:** The standardized classification list for Corrections (`docs/architecture/post-release-corrections.md`).
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
documented nowhere as unit-varying, see §9's matching note).
**Revised 2026-07-05 (Phase 3 architecture review) — release moves to Project Unit granularity:**
`released`/`releasedAt`/`releasedBy` (below) keep their existing shape and query patterns unchanged,
but are no longer set by a direct per-employee release action. They are now **derived**: set
transactionally the moment every distinct `ProjectUnit` this entry's work lines touch has its own
`PayrollUnitRelease` row (§12b) for this cycle — an entry with work lines at two Units waits for
*both* to release before it releases at all, preserving the one-entry/one-`netSalary`/one-Bank-Sheet-
row model (Principle 1, Principle 6) unchanged even for a genuinely split employee. See §12b for the
full mechanism, and the new `lateReason` column below for the one exception (an entry created after
its Unit has already released this cycle).
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` |
| `siteId` | uuid | no | — | FK → `ProjectSite.id`, `ON DELETE RESTRICT` — copied from `Employee` at entry creation, then ordinarily Draft-editable, see note below. Every work line under this entry (§12a) must belong to a `ProjectUnit` under this same site — database-guaranteed via a composite FK, same mechanism as `Employee.unitId` (§9) |
| `designation` | varchar(80) | no | — | copied from `Employee.designation` at entry creation, then ordinarily Draft-editable |
| `bankId` | uuid | yes | — | FK → `Bank.id`, `ON DELETE RESTRICT` — copied from `Employee` at entry creation, then ordinarily Draft-editable |
| `branchCode` | varchar(20) | yes | — | the employee's own bank branch code, copied from `Employee` at entry creation, then ordinarily Draft-editable — unrelated to `ProjectUnit.code` (§8a), same distinction noted in §9 |
| `accountNumber` | varchar(40) | yes | — | copied from `Employee` at entry creation, then ordinarily Draft-editable |
| `accountTitle` | varchar(160) | yes | — | copied from `Employee` at entry creation, then ordinarily Draft-editable |
| `grossPay` | numeric(12,2) | no | — | this cycle's gross pay — editable in Draft; a single scalar regardless of how many units this cycle's work lines cover, see the 2026-07-03 revision note above |
| `allowance` | numeric(12,2) | no | `0` | |
| `leaveDays` | numeric(5,2) | no | `0` | claimed leave — stays employee-level, not attributed to a specific unit: leave is absence from work entirely, not location-specific attendance |
| `leaveRate` | numeric(10,2) | yes | — | null ⇒ derive from `grossPay / cycleDays` using the entry's **primary work line's** `cycleDays` (its lowest `sortOrder`, §12a) as the basis when more than one line exists |
| `eobiAmount` | numeric(10,2) | no | `400.00` | |
| `eobiApplicable` | boolean | no | `true` | |
| `advanceDeduction` | numeric(12,2) | no | `0` | this cycle's loan installment |
| `advanceId` | uuid | yes | — | FK → `Advance.id`, `ON DELETE RESTRICT` — the specific `LOAN`-type advance this deduction reduces, recorded at the time the deduction is entered (auto-linked to the employee's current `ACTIVE` loan). Never re-inferred later — see §15 and `docs/architecture/post-release-corrections.md` ("Interaction with Advances") for why a later correction must reconcile against this exact stored link. |
| `eidAdvanceDeduction` | numeric(12,2) | no | `0` | this cycle's Eid advance installment |
| `eidAdvanceId` | uuid | yes | — | FK → `Advance.id`, `ON DELETE RESTRICT` — same, for the `EID_ADVANCE`-type advance |
| `fine` | numeric(12,2) | no | `0` | |
| `hold` | boolean | no | `false` | |
| `released` | boolean | no | `false` | per-employee release flag — **derived** as of 2026-07-05, see the revision note above; set once every touched `ProjectUnit` has released, or by a Late Entry's own one-off release |
| `releasedAt` | timestamptz | yes | — | |
| `releasedBy` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT` — for an ordinary release this is whichever Finance user's `PayrollUnitRelease` action was the *last* of this entry's touched Units to clear; for a Late Entry, the Finance user who performed its one-off release |
| `lateReason` | text | yes | — | **added 2026-07-05.** Populated *only* when this entry undergoes its own one-off "Late Entry" release (§12b) — i.e. it was created after every `ProjectUnit` it touches had already released for this cycle, so no future `PayrollUnitRelease` sweep will ever reach it. `NULL` for every ordinarily-released entry. Whether an unreleased entry currently *qualifies* as a Late Entry is not stored — it's derived on demand (`released = false AND every touched unit already has a PayrollUnitRelease row for this cycle`), since the ordinary sweep already correctly handles any entry with at least one still-pending Unit. Mandatory (enforced at the application layer) at the moment of that one-off release, mirroring `Correction.reason`'s "reason mandatory" convention. |
| `sortOrder` | integer | no | (sequence) | user-controlled drag-to-reorder position within the cycle |
| `version` | integer | no | `1` | **optimistic locking token** — incremented on every update |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

**On `siteId`/`designation`/bank fields — copied, not linked, and ordinarily Draft-editable:**
these are copied from `Employee` onto `PayrollEntry` at the moment the entry is created (or carried
forward at new-cycle creation — see `docs/architecture/data-and-storage.md` §4), rather than being
read live from `Employee` at render time. This is not a special read-only "snapshot" — once copied,
these fields behave exactly like any other Draft-editable field (the same rule already governing
`grossPay`): freely editable while the entry is unlocked, frozen once locked. **An `Employee` update
never cascades into an existing `PayrollEntry`, in either direction, ever** — this is a final,
approved decision, not an implementation detail. If an employee transfers sites or changes their bank
account mid-cycle, the currently-open `PayrollEntry` keeps whatever it was created/carried-forward
with until the *next* cycle's carry-forward, unless someone explicitly edits this entry directly (an
ordinary, audited edit). Two consequences follow directly from this: (1) historical cycles are
automatically protected (Principle 2) since nothing ever reaches back into a locked row regardless of
later `Employee` changes; (2) **site-scoping for Payroll Entry, Release, Bank Sheets, Cash Receiving,
and reports is always enforced against `PayrollEntry.siteId`, never `Employee.siteId`** — for both
current and historical cycles, one consistent rule, with no time-based special case and no risk of a
row disappearing from a Payroll Staff user's view mid-session because of an unrelated `Employee` edit.

- **Unique constraints:** (`cycleId`, `employeeId`) — exactly one entry per employee per cycle
- **Check constraints:** `grossPay >= 0`; `allowance >= 0`; `leaveDays >= 0`; `eobiAmount >= 0`;
  `advanceDeduction >= 0`; `eidAdvanceDeduction >= 0`; `fine >= 0`;
  `released = true ⇒ releasedAt IS NOT NULL AND releasedBy IS NOT NULL` (the `days`/`otHours`/
  `cycleDays` range checks moved to `PayrollEntryWorkLine`, §12a); `lateReason IS NOT NULL ⇒ released
  = true` (a `lateReason` only ever gets written at the moment of the one-off release itself — added
  2026-07-05)
- **Indexes:** unique(`cycleId`, `employeeId`); (`cycleId`); (`employeeId`); composite
  (`cycleId`, `hold`, `released`) — the exact filter combination used by Release Salary, Bank Sheets,
  and Cash Receiving, and by the Payroll Cycle finalization precondition check (§10); (`cycleId`, `siteId`)
  for site-filtered grid/report queries; (`bankId`) for bank sheet generation; (`advanceId`),
  (`eidAdvanceId`) for the Advances-tab "which entries applied to this advance" drill-down
- **Cascade:** all FKs `RESTRICT` — a `PayrollEntry` is never orphaned by deleting its cycle,
  employee, site, bank, or linked advance
- **Module owner:** Payroll Entry (writes while Draft); read by nearly every other module
- **Immutability:** mutable only while `released = false` **and** the parent
  `PayrollCycle.status = 'DRAFT'`. `hold` has **no bearing on mutability** — it only affects
  downstream inclusion in Release/Bank Sheet/Cash Sheet, and remains an ordinarily-editable field
  like any other while the entry is unlocked. Once `released = true` **or** the parent cycle leaves
  Draft, every column on the row — including `hold` — is frozen; there is deliberately no correctable
  path for `hold`/`released` themselves (`CorrectionField`, §1, excludes them, since they are
  workflow state, not correctable payroll data — the only legitimate way to affect payment for a
  problem discovered later is via a hold/release decision in a *future* Draft cycle). Enforced at the
  application layer (no update route reaches a locked row) and recommended as a database-level
  `BEFORE UPDATE` trigger blocking any column change once locked, for the same defense-in-depth
  reasoning as the Audit Log (§16).
- **Optimistic locking required:** yes — this is the primary candidate. Multiple Payroll Staff (or
  multiple tabs, or an autosave retry after a network hiccup) may edit different rows concurrently;
  `version` prevents a lost update on the same row
- **Transactions required:** yes — creating a `PayrollEntry` always creates its first
  `PayrollEntryWorkLine` in the same transaction (§12a, never a two-step process that could leave an
  entry with zero lines); a `PayrollUnitRelease` insert (§12b) must, in the same transaction, sweep
  and flip `released = true` on every entry whose touched Units are now all released, settle any
  `PENDING` `BalanceAdjustment` for each such employee, and write the corresponding `AuditLog`
  entries; a Late Entry's own one-off release (§12b) follows the identical pattern for exactly one
  entry, plus writing `lateReason`; recording a non-zero `advanceDeduction`/`eidAdvanceDeduction` must,
  in the same transaction, decrement the linked `Advance.outstandingBalance` (§15)
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
  these stored values — never cached on this row; see `docs/architecture/post-release-corrections.md`
  ("Baseline Reconstruction for Sequential Corrections"). Corrections continue to target this entry's
  aggregate fields only (`CorrectionField`, §1) — there is no line-level correction path; a locked
  entry's work-line breakdown is preserved as a frozen historical attendance record, and any
  post-release adjustment is expressed as an aggregate delta exactly as already documented, never as a
  correction to one specific line.
- **Row count:** ~1,500/cycle × 12/year ⇒ ~18,000/year today; Principle 10's 10,000-employee design
  floor means this should be read as ~10,000+/cycle going forward — still small for Postgres after a
  decade even at that scale (~1.2M rows/decade at 10,000/cycle × 12/year), with correct indexing, not
  partitioning, remaining sufficient (§23)

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
> defense-in-depth pattern (e.g. Audit Log immutability, §16): **(1) a database-level composite
> foreign key** — `(unitId, siteId) → ProjectUnit(id, siteId)`, below — so Postgres itself rejects the
> row, not just a service-layer check; **(2) application-layer validation** at the point a Work Line
> is created or edited, so the operator gets a clean validation error rather than a raw constraint
> violation. Neither layer is optional or a stand-in for the other.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `payrollEntryId` | uuid | no | — | FK → `PayrollEntry.id`, `ON DELETE CASCADE` — a work line has no meaning without its parent entry, and a `PayrollEntry` row is never deleted in practice (Principle 2), so this is one of the few relationships in this schema where cascade delete is appropriate, alongside `RolePermission` (§4) |
| `siteId` | uuid | no | — | denormalized copy of the parent `PayrollEntry.siteId` at line-creation time, present specifically so `unitId` below can be composite-FK'd against it |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, paired with `siteId` above via a composite FK `(unitId, siteId) → ProjectUnit(id, siteId)` (§8a) — Postgres itself rejects a line whose unit doesn't belong to the parent entry's own site, which is what makes "multi-unit splitting is always intra-site" (the 2026-07-03 decision, see below) a database guarantee, not just a UI restriction |
| `days` | numeric(5,2) | no | `0` | working days attributable to this unit |
| `otHours` | numeric(6,2) | no | `0` | OT hours attributable to this unit |
| `otRate` | numeric(10,2) | yes | — | null ⇒ derive from `grossPay / this-line's cycleDays / 8` at read time (§12) |
| `cycleDays` | smallint | no | `30` | denominator for daily rate at this unit; site/unit-typical but per-line editable, same variability rule the original spec applied at the site level (`reference/PROJECT_SPEC.md`) |
| `sortOrder` | integer | no | (sequence) | display order within the entry; the line with the lowest `sortOrder` is the entry's "primary" line for leave-rate-basis purposes (§12) |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

**RBAC consequence of the same-site business rule above:** a Project Unit belongs to exactly one
Project Site (§8a), and Payroll Staff are assigned at the site level (unchanged,
`docs/architecture/authentication.md`). A Payroll Staff member with access to a site therefore already
has full access to every unit under it — so an employee working across multiple units within one
cycle never requires cross-site access, and the 2026-07-03 architecture review confirmed there is
**no cross-site editing exception** of any kind (Principle 7). `assertSiteAccess()` against the
parent `PayrollEntry.siteId` remains the entire RBAC check; nothing unit-level is needed.

**On every entry always having at least one line (no optional/split branch):** a `PayrollEntry` is
created together with its first `PayrollEntryWorkLine` in the same transaction — whether at new-cycle
bulk creation (seeded from the employee's *current default* `unitId`, §9) or when an individual entry
is created mid-cycle. Adding a second (or further) line — the "Split by {unitLabel}" action — is an
explicit operator action, not a different creation path; removing a line back down to the last
remaining one is allowed, but a line can never be deleted if it would leave its parent entry with
zero lines, enforced transactionally the same way the system already enforces "a `Correction` always
has exactly one `BalanceAdjustment`" (§13/§14) rather than relying on application code discipline
alone.

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
  (§8a)
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

## 12b. `PayrollUnitRelease` and `PayrollUnitReadiness`

**Added 2026-07-05, Phase 3 architecture review.** Two small tables that together implement release
at Project Unit granularity — the new business rule that payroll may be released independently per
Project Unit, with Finance choosing to release immediately or wait for client funding, rather than
only as a whole-Cycle action.

### `PayrollUnitRelease`

**Purpose:** The actual release event for one Project Unit, for one cycle. This is the new source of
truth that `PayrollEntry.released` (§12) is derived from.
**Why it exists:** Release needed a grain finer than `PayrollCycle` (too coarse — a whole month) and
finer than `ProjectSite` (too coarse — a site can have several Units funded on different schedules by
different client disbursements) without abandoning the one-entry/one-payment model Principle 1 and
Principle 6 already established. A dedicated event-log table, rather than a flag directly on
`PayrollEntry`, is what lets one release action correctly fan out across every entry that Unit
touches — including a multi-unit entry that needs *this* to be the last of several such events before
it can release.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, `ON DELETE RESTRICT` |
| `releasedAt` | timestamptz | no | `now()` | |
| `releasedById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — must hold the `FINANCE` (or Master User) `payroll:release` permission for this Unit's Site, enforced at the application layer |

- **Unique constraints:** (`cycleId`, `unitId`) — a Unit releases at most once per cycle; there is no
  "un-release" action (matches Principle 9 — once released, it stays released)
- **Indexes:** unique(`cycleId`, `unitId`); (`cycleId`) for "which Units have released this cycle";
  (`unitId`) for historical/reporting queries
- **Cascade:** both FKs `RESTRICT`
- **Module owner:** Payroll Processing / Release Salary (the same module boundary as before — this is
  Release Salary's own event log, not a new module)
- **Immutable, append-only:** yes — inserted once per `(cycleId, unitId)`, never updated or deleted,
  same convention as `Correction`/`AuditLog`/`EmployeeTransferHistory`
- **Transactions required:** yes, always — inserting this row must, in the same transaction, sweep
  every `PayrollEntry` with a work line touching `unitId` in `cycleId` and, for each one whose *every*
  distinct touched Unit now has a `PayrollUnitRelease` row, flip `released = true` /
  `releasedAt` / `releasedBy`, settle any `PENDING` `BalanceAdjustment` for that employee (merged into
  the Bank Sheet/Cash Sheet payment amount, unchanged from the existing rule, §14), and write the
  corresponding `AuditLog` entries (a `payroll_unit.released` entry for this event itself, plus the
  ordinary `payroll.released` entry for each entry it swept in)
- **Row count:** roughly (Units per Site × Sites) per cycle — comparable in order of magnitude to
  `ProjectUnit` itself (§8a: ~50–300 total), not to `PayrollEntry`

### `PayrollUnitReadiness`

**Purpose:** The informational "payroll preparation for this Unit is complete" signal — the new
"Ready for Release" status. **Deliberately non-gating**: Finance can release a Unit whether or not it
has been marked Ready; this table has no bearing on whether `PayrollUnitRelease` can be inserted.
**Why it exists:** Payroll Staff need a way to signal "done entering this Unit's data" to Finance
without that signal becoming a lock (the business rule is explicit: "'Ready for Release' is NOT
locked; it simply indicates payroll preparation is complete").

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, `ON DELETE RESTRICT` |
| `markedReadyById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — Payroll Staff (site-scoped) or Master User; **not** Finance, which has no permission to mark this |
| `markedReadyAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`cycleId`, `unitId`) — a Unit is either marked Ready for this cycle or it
  isn't; there's no meaning to marking it twice
- **Row existence, not a boolean column, models readiness** (refined 2026-07-05): the row's presence
  *is* "Ready"; un-marking Ready **deletes** the row rather than flipping a flag. This is the one
  deliberate exception to this schema's general preference against deleting rows — there is no
  historical-preservation requirement here (unlike `PayrollUnitRelease` or any append-only table),
  since this status is purely a live, current-state workflow signal with no business-history value
  once superseded. Deletion and (re)creation are still each their own audited event
  (`payroll_unit.marked_ready` / `payroll_unit.unmarked_ready`) even though the row itself doesn't
  persist — the audit trail is what preserves the historical fact that it happened, not this table.
- **Indexes:** unique(`cycleId`, `unitId`); (`cycleId`) for "which Units are Ready this cycle"
- **Cascade:** both FKs `RESTRICT`
- **Module owner:** Payroll Entry / Release Salary jointly (Payroll Staff set it from the Payroll
  Entry side, Finance reads it from the Release side)
- **"Modified after Ready" indicator:** computed on read, not stored — comparing `markedReadyAt`
  against `MAX(PayrollEntry.updatedAt)` across every entry touching this Unit in this cycle. If any
  entry was edited after the Unit was marked Ready, Finance sees a "modified since marked ready"
  notice (with the last-modified timestamp, and the acting user resolved via the most recent relevant
  `AuditLog` entry for that entry — no new "last edited by" column is added to `PayrollEntry` for
  this, keeping that table's write surface unchanged). This is informational only and never clears
  the readiness row automatically — matches the "not locked" rule exactly.
- **Row count:** at most one row per `(cycleId, unitId)` pair currently marked Ready — small,
  comparable to `PayrollUnitRelease`'s scale, and shrinks further once released (Ready is typically
  cleared or simply superseded by the actual release; nothing requires clearing it, it's just moot
  once released)

## 13. `Correction`

**Purpose:** A single approved change to one field of a `PayrollEntry` that has released (§12) — the
trigger condition stated once in `docs/architecture/data-and-storage.md` §4.
**Why it exists:** The only permitted mechanism for changing a locked entry's outcome — never a
direct edit (Principle 9).
**Business rule tie-in:** `docs/architecture/post-release-corrections.md` in full.
**Revised 2026-07-05 (Phase 3 architecture review) — trigger condition simplified to one clause:**
previously stated as "individually released, **OR** its parent cycle is no longer Draft." Now that
`PayrollCycle.status` is itself derived from every Unit having released-or-been-held (§10), Cycle
status can never diverge from entry-level `released` — so the second clause is no longer an
independent condition, it's implied by the first. The trigger is now simply: **`PayrollEntry.released
= true`.**
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
| `oldNetSalary` | numeric(12,2) | no | — | `calcNet` result on the entry's current effective state (§12) before this change |
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
`docs/architecture/post-release-corrections.md` ("Baseline Reconstruction for Sequential
Corrections") for the full algorithm and rationale.

- **Check constraints:** `length(trim(reason)) > 0` (a reason of only whitespace is not a reason)
- **Indexes:** (`payrollEntryId`); composite (`payrollEntryId`, `field`, `approvedAt` desc) — the
  "latest correction for this field" lookup the baseline-reconstruction algorithm depends on;
  (`adjustmentTypeId`); (`approvedAt`) for chronological/audit views; (`approvedById`)
- **Cascade:** all FKs `RESTRICT`
- **Module owner:** Corrections
- **Immutable, append-only:** yes — a `Correction`, once approved, is never edited or deleted; a
  mistaken correction is itself corrected via a new `Correction`, not by editing this row
- **Transactions required:** yes — creating a `Correction` must, in the same transaction, create its
  `BalanceAdjustment` (§14) and an `AuditLog` entry (§16); when it originates from an approved
  `CorrectionRequest` (§13a), that request's own `status → APPROVED` update and `resultingCorrectionId`
  link are part of the same transaction too
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
**Business rule tie-in:** `docs/architecture/post-release-corrections.md`'s "Correction Requests"
section.

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
| `status` | `CorrectionRequestStatus` | no | `'PENDING'` | `PENDING` / `APPROVED` / `REJECTED` — new native enum (§1), closed set mechanically tied to this workflow |
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
  `BalanceAdjustment`'s (§14) single-permitted-transition pattern rather than being fully append-only,
  since (unlike `Correction`) it does have one real state change to make
- **Transactions required:** yes — approval creates the `Correction` (+ its own downstream
  `BalanceAdjustment` + `AuditLog`, §13/§14) and updates this row's `status`/`resultingCorrectionId`
  all together; rejection is a single-row update + `AuditLog` entry (`correction_request.rejected`)
- **Audit logging:** creation (`correction_request.created`), approval (folded into the resulting
  `correction.approved` entry, cross-referencing the request), and rejection
  (`correction_request.rejected`) are all audited events
- **Row count:** a subset of eventual `Correction` rows, plus whatever fraction are rejected — smaller
  than `Correction` is unlikely; comparable order of magnitude

## 14. `BalanceAdjustment`

**Purpose:** The standalone, traceable balance created by an approved Correction — never folded
silently into an ordinary payroll field.
**Why it exists:** `docs/architecture/post-release-corrections.md` — the entire reason this table
exists is to keep a post-release balance distinct and reportable, rather than indistinguishable from
a normal allowance/advance.
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
| `sourceCycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` — the cycle the correction was made against (this may be `Released` or `Archived`, or a still-`Draft` cycle in which this specific entry was individually released — see the unified trigger condition in `docs/architecture/data-and-storage.md` §4) |
| `adjustmentTypeId` | uuid | no | — | FK → `AdjustmentType.id`, `ON DELETE RESTRICT` — a direct, denormalized copy of the originating `Correction.adjustmentTypeId`, consistent with `employeeId`/`sourceCycleId` above already being denormalized onto this same row; enables direct filtering/reporting ("all pending Advance Recovery adjustments") without a join |
| `amount` | numeric(12,2) | no | — | absolute value, the *original total* — `0` only when `type = 'NONE'`. For `RECOVERY`, this stays the original total even as it's recovered in installments; see `remainingAmount` below for the live outstanding figure |
| `type` | `BalanceAdjustmentType` | no | — | `PAYABLE`, `RECOVERY`, or `NONE` (zero net difference — see `docs/architecture/post-release-corrections.md`) |
| `status` | `BalanceAdjustmentStatus` | no | `'PENDING'` | a `NONE`-type row is created already `SETTLED`. For `RECOVERY`, stays `PENDING` across as many cycles as it takes `remainingAmount` to reach zero — this is the one behavior change from before this session, where a single cycle always fully settled it |
| `paymentTiming` | `BalanceAdjustmentPaymentTiming` | yes | — | **added 2026-07-05.** `IMMEDIATE` or `DEFERRED`, set at approval time; meaningful only for `type = PAYABLE`, always `NULL` for `RECOVERY`/`NONE` (negative balances have no immediate option per the business rule; `NONE` needs no timing at all) |
| `recoveryInstallmentAmount` | numeric(12,2) | yes | — | **added 2026-07-05, `RECOVERY`-only.** The per-cycle amount to recover; `NULL` means "recover the full `remainingAmount` in the next cycle" (today's original behavior, unchanged as the default). Staff/Master-User-editable at any time before `remainingAmount` reaches zero, mirroring `Advance.scheduledInstallmentAmount`'s already-established editable-schedule pattern (`docs/IMPLEMENTATION_PLAN.md` Phase 4) — always `NULL` for `PAYABLE`/`NONE` |
| `remainingAmount` | numeric(12,2) | no | (= `amount` at creation) | **added 2026-07-05.** The live outstanding balance still to be recovered/paid. Decremented by each `BalanceAdjustmentSettlement` (§14b) application; reaches `0` exactly when `status` flips to `SETTLED`. For `PAYABLE`/`NONE`, this settles in one step (immediately or on the deferred cycle's release) so it simply jumps from `amount` to `0` — the multi-step decrement pattern is a `RECOVERY`-specific behavior |
| `remark` | text | no | — | auto-composed display remark shown on the Payslip and Statement of Account, per post-release-corrections.md §5 (the Bank Sheet/Cash Sheet row itself is a single merged amount and carries no per-line remark — see "Representation in Bank Sheets, Cash Sheets, and Payslips") |
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
  (§13), and, when the correction is to `ADVANCE_DEDUCTION`/`EID_ADVANCE_DEDUCTION`, with the linked
  `Advance.outstandingBalance` reconciliation (§15); an `IMMEDIATE` `PAYABLE`'s settlement is
  transactional with either folding into the employee's open `PayrollEntry` or creating a
  `CorrectionPayment` (§14a), at approval time itself, not later; a `DEFERRED` `PAYABLE`'s or a
  `RECOVERY` installment's settlement is transactional with the triggering `PayrollEntry` release,
  merged into that release's Bank Sheet/Cash Sheet payment amount, never a second row (§16, and
  `docs/architecture/post-release-corrections.md`) — for a `RECOVERY` with more `remainingAmount`
  left after this cycle's installment, the same release transaction also inserts this cycle's
  `BalanceAdjustmentSettlement` row (§14b) and leaves `status = PENDING` for the next cycle to
  continue
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
implementation with the Late Entry one-off release's own document (§12b/§12, `lateReason`) where
practical — both are structurally "a one-off, single-row payment artifact outside the normal
per-Unit/per-Cycle sheet" — while remaining **separate business entities** (a `CorrectionPayment`
settles a `BalanceAdjustment`; a Late Entry release settles an ordinary `PayrollEntry`'s first-ever
release). Not a schema-level decision — flagged here for whoever builds Phase 4/6's PDF/Excel
generation to reuse a shared single-row-sheet renderer rather than duplicating it.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `balanceAdjustmentId` | uuid | no | — | FK → `BalanceAdjustment.id`, `ON DELETE RESTRICT`, **unique** (1:1) |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` — denormalized, same convention as `BalanceAdjustment.employeeId` |
| `amount` | numeric(12,2) | no | — | always equals the settling `BalanceAdjustment.remainingAmount` at the moment of payment (always the full `PAYABLE` amount, since `PAYABLE` never installments) |
| `bankId` | uuid | yes | — | FK → `Bank.id`, `ON DELETE RESTRICT` — snapshot copied from `Employee`/`PayrollEntry` at payment time, **copied not linked**, same convention as `PayrollEntry`'s own bank fields (§12), so a later `Employee` bank-detail change never retroactively alters a historical payment record |
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
by `EmployeeTransferHistory` (§8b) for `Employee` transfers.
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
  sweep (§12b) and the parent `BalanceAdjustment.remainingAmount` decrement (and, if this installment
  brings `remainingAmount` to zero, the parent's `status → SETTLED`/`settledInCycleId`/`settledAt`)
- **Row count:** one row per cycle an installment-based `RECOVERY` actually settles against — bounded
  by (number of installment `RECOVERY` adjustments) × (typical installment count), expected to stay
  small relative to `PayrollEntry`

## 15. `Advance`

**Purpose:** A record of a loan or Eid advance given to an employee, and its remaining balance.
**Why it exists:** Visibility into outstanding balances (Advances tab, Statement of Account) without
those balances living only in someone's head.
**Business rule tie-in:** "No auto-calculation of installment size... but the system should track and
display remaining outstanding balance" (`PROJECT_SPEC.md`).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `employeeId` | uuid | no | — | FK → `Employee.id`, `ON DELETE RESTRICT` |
| `type` | `AdvanceType` | no | — | `LOAN` or `EID_ADVANCE` |
| `totalAmount` | numeric(12,2) | no | — | original amount given |
| `outstandingBalance` | numeric(12,2) | no | (= `totalAmount` at creation) | decremented as matching `PayrollEntry` deductions are recorded — see note below |
| `dateGiven` | date | no | — | |
| `repaymentType` | `AdvanceRepaymentType` | no | — | informational only, per spec — does not drive auto-calculation |
| `notes` | text | yes | — | |
| `status` | `AdvanceStatus` | no | `'ACTIVE'` | flips to `PAID_OFF` when `outstandingBalance` reaches 0 |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | `now()` | |

**On the employee/type/active linkage:** `PayrollEntry.advanceDeduction`/`.eidAdvanceDeduction` are
single lump figures per cycle (matching the source spec's model), auto-linked at entry time to the
employee's `ACTIVE` advance of the matching type via the explicit `PayrollEntry.advanceId`/
`.eidAdvanceId` FKs (§12). To keep that auto-linking unambiguous, this schema assumes **at most one
`ACTIVE` advance per employee per type at a time** — enforced by a partial unique index. Recording the
link explicitly at entry time (rather than re-inferring "whichever advance is currently active" later)
is what makes a later Correction to these fields reconcilable against the *correct* advance even if
the employee has since paid it off and taken out a new one of the same type — see
`docs/architecture/post-release-corrections.md` ("Interaction with Advances").

- **Unique constraints:** partial unique (`employeeId`, `type`) `WHERE status = 'ACTIVE'`
- **Check constraints:** `totalAmount > 0`; `outstandingBalance >= 0`; `outstandingBalance <= totalAmount`
- **Indexes:** the partial unique index above (also the primary lookup); (`employeeId`)
- **Cascade:** `employeeId` is `RESTRICT`
- **Module owner:** Advances (a supporting module feeding Payroll Entry, alongside the 15 core
  modules — see `docs/architecture/overview.md`)
- **What can change `outstandingBalance`:** exactly two paths, both transactional — (1) the original
  `PayrollEntry` save that records a non-zero linked deduction (decrements by that amount, flips to
  `PAID_OFF` at zero); (2) a later approved `Correction` to the linked `advanceDeduction`/
  `eidAdvanceDeduction` field (adjusts by the delta between old and new effective deduction amount,
  flipping `status` between `ACTIVE`/`PAID_OFF` as the balance crosses zero in either direction). If a
  correction's `PayrollEntry` has a null `advanceId`/`eidAdvanceId` (no advance was linked at entry
  time), path (2) is skipped and logged — the salary-level `BalanceAdjustment` is still created
  regardless, since advance-balance tracking is an informational aid (`PROJECT_SPEC.md`), not a gate
  on payroll correctness.
- **Audit logging:** creation, and both of the above balance-changing events
- **Row count:** tens to low hundreds created per month; total accumulates but stays small

## 16. `AuditLog`

**Purpose:** The permanent, append-only record of every financial and administrative action in the
system.
**Why it exists:** Principle 3; `docs/architecture/data-and-storage.md` §3.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `occurredAt` | timestamptz | no | `now()` | |
| `actorUserId` | uuid | yes | — | FK → `User.id`, `ON DELETE SET NULL` — null for fully automatic/system actions (e.g. automatic cycle archiving); `SET NULL` (not `RESTRICT`) so a historical audit entry is never itself a reason a user record becomes undeletable, though in practice `User` rows are never hard-deleted either |
| `action` | varchar(100) | no | — | app-level constant, e.g. `payroll.released`, `correction.approved` — free text validated against an application registry, not a DB enum, since this list grows with nearly every feature (see §0) |
| `entityType` | varchar(60) | no | — | e.g. `PayrollEntry`, `Employee`, `Correction` |
| `entityId` | uuid | yes | — | polymorphic reference — **not a real foreign key**, since it points to different tables depending on `entityType`; integrity here is an application-layer responsibility |
| `metadata` | jsonb | yes | — | flexible payload: old/new values, reason text, amounts — whatever context that specific action needs |
| `ipAddress` | inet | yes | — | |
| `userAgent` | text | yes | — | |

- **Indexes:** (`entityType`, `entityId`); (`actorUserId`); (`occurredAt` desc) for chronological
  paging; optional GIN index on `metadata` if audit search-by-content is needed later
- **Cascade:** `actorUserId` is `SET NULL`
- **Module owner:** Audit Log
- **Immutable, append-only:** enforced at two layers — no application code path updates or deletes a
  row, **and** the database role's `UPDATE`/`DELETE` privileges on this table are revoked (or a
  `BEFORE UPDATE OR DELETE` trigger raises an exception), per `data-and-storage.md` §3.
  **Revised 2026-07-04 (first live-database verification):** the trigger permits exactly one narrow
  UPDATE — `actorUserId` transitioning NOT NULL → NULL with every other column byte-identical, i.e.
  precisely what this table's own `ON DELETE SET NULL` FK action (above) produces when a `User` row
  is deleted. The original trigger rejected *every* UPDATE, which made any user with audit history
  undeletable — contradicting this very section's stated reason for choosing `SET NULL` over
  `RESTRICT`. The two requirements were reconciled in favor of the documented FK semantics
  (migration `20260704180000_audit_log_allow_fk_actor_set_null`); every other UPDATE and every
  DELETE is still rejected at the database level, verified by live test.
- **Transactions required:** yes, always — every audited action writes its `AuditLog` row in the same
  transaction as the change itself; there is no code path where the change commits without its audit
  entry
- **Row count:** the fastest-growing table in the system by row count, but still trivial for
  Postgres — plausibly several thousand rows per month; unbounded retention is intended (this is the
  audit trail, it is not pruned)

## 17. `BackupPackage`

**Purpose:** The disaster-recovery/external-access artifact generated automatically when a cycle is
archived.
**Why it exists:** `docs/architecture/data-and-storage.md` §5. **Never a data source for in-app
historical viewing** — that always comes from Postgres directly.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `version` | integer | no | `1` | increments if regenerated after a later correction against this archived cycle |
| `generatedAt` | timestamptz | no | `now()` | |
| `applicationVersion` | varchar(40) | no | — | deployed app build/release identifier |
| `databaseSchemaVersion` | varchar(60) | no | — | applied Prisma migration identifier |
| `releaseStatusSummary` | jsonb | no | — | released/held/pending counts at generation time |

- **Unique constraints:** (`cycleId`, `version`)
- **Indexes:** unique(`cycleId`, `version`); (`cycleId`)
- **Cascade:** `cycleId` is `RESTRICT`
- **Module owner:** Payroll Processing (triggered by the archive transition) via the storage
  abstraction (`data-and-storage.md` §2)
- **Immutable, append-only:** a new version row is created for regeneration; existing rows are never
  edited
- **Row count:** ~1/month, occasionally more when a correction against an archived cycle triggers a
  new version

## 18. `BackupPackageFile`

**Purpose:** One physical file within a `BackupPackage` (Payroll CSV, Bank Sheets CSV, Receivings
CSV, and any future artifact type).
**Why it exists:** Modeled as its own table rather than three hardcoded columns on `BackupPackage`,
so a future artifact type (e.g. a Payslips bundle) is a new row type, not a new column
(Principle 8).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `backupPackageId` | uuid | no | — | FK → `BackupPackage.id`, `ON DELETE RESTRICT` |
| `fileType` | `BackupFileType` | no | — | |
| `storageKey` | text | no | — | key/path resolved via the `StorageProvider` abstraction |
| `sizeBytes` | bigint | yes | — | |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`backupPackageId`, `fileType`)
- **Indexes:** (`backupPackageId`)
- **Cascade:** `RESTRICT`
- **Module owner:** Payroll Processing
- **Immutable, append-only**

## 19. `CompanySettings`

**Purpose:** Company name, address, and logo shown on payslips, bank sheets, and the app shell.
**Why it exists:** Settings module, Master-Admin-only editable.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | fixed constant (see below) | PK |
| `companyName` | varchar(200) | no | — | |
| `registeredAddress` | varchar(300) | yes | — | |
| `phone` | varchar(30) | yes | — | |
| `email` | varchar(255) | yes | — | |
| `logoStorageKey` | text | yes | — | `StorageProvider` key |
| `updatedAt` | timestamptz | no | `now()` | |
| `updatedById` | uuid | yes | — | FK → `User.id`, `ON DELETE SET NULL` |

- **Singleton enforcement:** `id` is fixed to a single well-known constant UUID
  (e.g. `00000000-0000-0000-0000-000000000001`), so the primary key itself guarantees at most one
  row can ever exist — simpler than a separate partial-unique-index trick.
- **Module owner:** Settings
- **Row count:** exactly 1

## 20. `Session` (external, library-owned)

**Purpose:** Server-side session storage for `express-session` via `connect-pg-simple`.
**Why it's different:** Its schema (`sid` varchar PK, `sess` json, `expire` timestamp) is dictated by
the library, not this application — it is the one deliberate exception to the UUID-primary-key rule
(§0) and is not otherwise part of this specification's design surface.

---

## 21. Relationships & Cardinality

```
Role (1) ───< User (many)
Role (many) ──< RolePermission >── (many) Permission

User (many) ──< UserSiteAssignment >── (many) ProjectSite

Bank (1) ───< Employee (many)         [bankId, optional] — Bank has no relationship to ProjectSite,
                                        see §8's revision note

ProjectSite (1) ───< ProjectUnit (many)
ProjectSite (1) ───< Employee (many)                 [siteId, direct]
ProjectUnit (1) ───< Employee (many)                 [unitId, composite FK with siteId — §9]

Employee (1) ───< EmployeeTransferHistory (many)             [employeeId — §8b]
ProjectSite (1) ───< EmployeeTransferHistory (many)          [fromSiteId, toSiteId — §8b]
ProjectUnit (1) ───< EmployeeTransferHistory (many)          [fromUnitId, toUnitId — §8b]
User (1) ───< EmployeeTransferHistory (many)                 [transferredById — §8b]

Employee (1) ───< PayrollEntry (many)
PayrollCycle (1) ───< PayrollEntry (many)
PayrollCycle (1) ───< PayrollCycle (many)     [sourceCycleId, self-referencing]

PayrollEntry (1) ───< PayrollEntryWorkLine (many)    [always ≥1, enforced transactionally — §12a]
ProjectUnit (1) ───< PayrollEntryWorkLine (many)     [unitId, composite FK with siteId — §12a]

PayrollCycle (1) ───< PayrollUnitRelease (many)      [cycleId — §12b, added 2026-07-05]
ProjectUnit (1) ───< PayrollUnitRelease (many)       [unitId — §12b]
User (1) ───< PayrollUnitRelease (many)              [releasedById — §12b]

PayrollCycle (1) ───< PayrollUnitReadiness (many)    [cycleId — §12b, added 2026-07-05]
ProjectUnit (1) ───< PayrollUnitReadiness (many)     [unitId — §12b]
User (1) ───< PayrollUnitReadiness (many)            [markedReadyById — §12b]

PayrollEntry (1) ───< CorrectionRequest (many)       [payrollEntryId — §13a, added 2026-07-05]
AdjustmentType (1) ───< CorrectionRequest (many)     [adjustmentTypeId — §13a]
User (1) ───< CorrectionRequest (many)               [requestedById — §13a]
User (1) ───< CorrectionRequest (many)               [reviewedById, optional — §13a]
CorrectionRequest (0..1) ─── (1) Correction          [resultingCorrectionId, optional — §13a]

PayrollEntry (1) ───< Correction (many)
AdjustmentType (1) ───< Correction (many)

Correction (1) ─── (1) BalanceAdjustment
Employee (1) ───< BalanceAdjustment (many)          [denormalized]
PayrollCycle (1) ───< BalanceAdjustment (many)      [sourceCycleId]
PayrollCycle (1) ───< BalanceAdjustment (many)      [settledInCycleId, optional]
AdjustmentType (1) ───< BalanceAdjustment (many)    [denormalized from Correction]

BalanceAdjustment (1) ─── (0..1) CorrectionPayment  [balanceAdjustmentId — §14a, added 2026-07-05]
Employee (1) ───< CorrectionPayment (many)          [employeeId — §14a]
User (1) ───< CorrectionPayment (many)               [paidById — §14a]

BalanceAdjustment (1) ───< BalanceAdjustmentSettlement (many)  [balanceAdjustmentId — §14b, added 2026-07-05]
PayrollCycle (1) ───< BalanceAdjustmentSettlement (many)       [cycleId — §14b]

Employee (1) ───< Advance (many)
Advance (1) ───< PayrollEntry (many)                [advanceId, optional]
Advance (1) ───< PayrollEntry (many)                [eidAdvanceId, optional]

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
          ├─> PayrollEntry ──> PayrollUnitRelease (per touched Unit, §12b) ──> once ALL touched
ProjectSite ┘        │           Units have released, PayrollEntry.released flips true (or a Late
                      │           Entry gets its own one-off release, lateReason) ──> Bank Sheets /
                      │           Cash Receiving (derived, one row per employee, amount = netSalary
                      │           ± any settling BalanceAdjustments)
                      │
                      └─> CorrectionRequest (optional, §13a) ──approved──> Correction ──>
                            BalanceAdjustment ──┬─ PAYABLE, IMMEDIATE ──> fold into an already-open
                                                 │   PayrollEntry, else CorrectionPayment (§14a)
                                                 ├─ PAYABLE, DEFERRED ──> next Draft PayrollEntry
                                                 │   (unchanged from before this session)
                                                 └─ RECOVERY ──> one or more future cycles'
                                                     PayrollEntry releases, each installment logged
                                                     as a BalanceAdjustmentSettlement row (§14b)
```

Bank Sheets, Cash Receiving, Statements, Payslips, Reports, and Dashboard have **no tables of their
own** — they are query modules over the tables above, per Principle 1 and the module design in
`docs/architecture/overview.md`.

---

## 22. Cross-Cutting Summary

### Immutable tables (never updated after creation, other than the one exception noted)
`Correction`, `AuditLog`, `BackupPackage`, `BackupPackageFile`, `AdjustmentType` rows (retired via
`isActive`, never edited in meaning), `PayrollEntry` rows once `released = true` or once the parent
cycle leaves `DRAFT` (`hold` does **not** gate this — it's an ordinary field until the row locks, at
which point it freezes along with every other column; see §12), and every `PayrollEntryWorkLine`
under such a row, which locks in lockstep with its parent entry (§12a). `BalanceAdjustment` is
immutable except for `remainingAmount`/`status`/`settledInCycleId`/`settledAt` (settlement, now
potentially multi-step for `RECOVERY`) and the staff-editable `recoveryInstallmentAmount` (a `NONE`-
type row is created already in its final state and never transitions at all). **Added 2026-07-05:**
`PayrollUnitRelease` (§12b) is immutable from creation — a Unit's release for a cycle is never undone.
`CorrectionRequest` (§13a) is immutable except for its single permitted `PENDING → APPROVED` or
`PENDING → REJECTED` transition. `CorrectionPayment` (§14a) is immutable from creation.
`BalanceAdjustmentSettlement` (§14b) is immutable from creation.

### Append-only tables
`Correction`, `AuditLog`, `BackupPackage`, `BackupPackageFile`, `EmployeeTransferHistory` (added
2026-07-03, session 2 — §8b). **Added 2026-07-05:** `PayrollUnitRelease` (§12b),
`BalanceAdjustmentSettlement` (§14b), `CorrectionPayment` (§14a). **The one deliberate exception:**
`PayrollUnitReadiness` (§12b) is **not** append-only — un-marking Ready **deletes** the row, since it
is a purely informational, current-state workflow signal with no historical-preservation requirement,
unlike every other table in this list.

### Tables requiring multi-statement transactions
- `PayrollEntry` insert + its first `PayrollEntryWorkLine` insert, always together, never a two-step
  process that could leave an entry with zero lines (§12a)
- **Added 2026-07-05:** `PayrollUnitRelease` insert + a sweep flipping `PayrollEntry.released = true`
  on every entry whose touched Units are now all released + settlement of any `PENDING`
  `BalanceAdjustment` for each such employee (merged into that release's Bank Sheet/Cash Sheet payment
  amount, §14) + `AuditLog` insert(s) (§12b) — the direct successor to the old single-entry "release"
  transaction below, now fanned out per Unit-release event
- **Added 2026-07-05:** a Late Entry's own one-off release: `lateReason` write + `PayrollEntry.released
  = true` + the same `BalanceAdjustment` settlement/`AuditLog` steps as above, for exactly one entry
  (§12b)
- **Added 2026-07-05:** `CorrectionRequest` approval: `Correction` insert + `BalanceAdjustment` insert
  + `CorrectionRequest.status → APPROVED`/`resultingCorrectionId` update + `AuditLog` insert, all
  together (§13a)
- `Correction` insert + `BalanceAdjustment` insert (always — including a `NONE`-type, zero-amount,
  already-`SETTLED` row for a zero-net-difference correction) + `Advance.outstandingBalance`
  reconciliation, when the corrected field is `ADVANCE_DEDUCTION`/`EID_ADVANCE_DEDUCTION` and a linked
  advance exists (§15) + `AuditLog` insert
- **Added 2026-07-05:** an `IMMEDIATE` `PAYABLE` `BalanceAdjustment`'s settlement, at approval time:
  either folding into the employee's already-open `PayrollEntry`, or a `CorrectionPayment` insert
  (§14a) + `BalanceAdjustment.status → SETTLED` + `AuditLog` insert
- **Added 2026-07-05:** a `RECOVERY` `BalanceAdjustment` installment applied during a cycle's release:
  `BalanceAdjustmentSettlement` insert (§14b) + `BalanceAdjustment.remainingAmount` decrement (+
  `status → SETTLED` only if this brings it to zero) + `AuditLog` insert
- `PayrollCycle` finalization (`DRAFT → RELEASED`): the no-override precondition check (§10,
  unchanged wording — see its 2026-07-05 revision note) + status update + `AuditLog` insert, in one
  transaction
- `PayrollCycle` archive transition (`RELEASED → ARCHIVED`) + `BackupPackage`/`BackupPackageFile`
  insert (DB rows only — the actual file write via `StorageProvider` is external I/O and cannot
  participate in a DB transaction; the recommended pattern is: write the file first, then commit the
  `BackupPackage` row referencing it, so a crash mid-process leaves an orphaned file rather than a DB
  row pointing at a file that doesn't exist)
- `Advance.outstandingBalance` decrement + the `PayrollEntry` save that recorded the linked deduction
- New cycle creation: previous cycle's archive transition (above) + `PayrollCycle` insert + bulk
  `PayrollEntry` insert (each with its own single, freshly-seeded `PayrollEntryWorkLine`, per §12a's
  carry-forward rule — never inheriting a prior cycle's split structure) for every active employee
  plus any employee (active or departed) with a `PENDING` `BalanceAdjustment`
  (`docs/architecture/data-and-storage.md` §4) + `AuditLog` insert — all one transaction
- `Employee` create/update + `AuditLog` insert (generic diff, or a distinct `employee.left` entry when
  `dateOfLeaving` is set)

### Tables requiring optimistic locking
`PayrollEntry` (`version` column) — the only table with realistic concurrent-edit exposure (multiple
staff/tabs, autosave retries). No other table has a plausible concurrent-write conflict at this
system's scale and access pattern. `PayrollEntryWorkLine` rows don't carry their own `version` — they
mutate only as part of their parent `PayrollEntry`'s edit surface, so the parent's optimistic lock
already covers them.

### Tables requiring audit logging on every mutation
`PayrollEntry` (release/hold/field edits while Draft, including work-line attendance changes — §12a —
captured in the same field-level diff), `Correction` (every creation, including a
zero-net-difference/`NONE` correction), `BalanceAdjustment` (creation and every settlement step,
partial or final), `PayrollCycle` (every status transition, including a finalization attempt blocked
by the precondition), `Advance` (creation and both balance-changing events — original deduction and
correction-triggered reconciliation), `Employee` (every create/update — a site/unit-changing edit
writes a dedicated `employee.transferred` entry, not the generic `employee.updated` entry, plus an
`EmployeeTransferHistory` row (§8b); leaving/reactivating write their own dedicated `employee.left`/
`employee.reactivated` entries — see §9), `User`/`Role`/`UserSiteAssignment` (creation, deactivation,
role/site reassignment), `ProjectSite` (creation, edit, deletion attempt), `ProjectUnit` (creation,
edit, deletion attempt — same pattern as `ProjectSite`, §8a), `CompanySettings` (every update).
**Added 2026-07-05:** `PayrollUnitRelease` (creation — `payroll_unit.released`), `PayrollUnitReadiness`
(marking and un-marking — `payroll_unit.marked_ready` / `.unmarked_ready`), `CorrectionRequest`
(creation, approval, rejection), `CorrectionPayment` (creation — `correction_payment.paid`), a Late
Entry's one-off release (`payroll.late_released`, carrying `lateReason`).

### Values that must never be duplicated (single source of truth)
- Net salary and every `calcNet` intermediate — always computed from `PayrollEntry` (and, for a
  corrected entry, from its replayed current effective state — §12/§13), never stored redundantly
  anywhere (Payslip, Bank Sheet, Statement all compute live from the same inputs)
- `PayrollCycle` display label ("April 2026") — computed from `year`/`month`, never stored
- An employee's "has a bank account" status — derived from `bankId`/`accountNumber` presence, never
  stored as a separate boolean that could drift out of sync
- Balance Adjustment amounts — derived once at Correction approval and stored on `BalanceAdjustment`
  itself (this one *is* stored, deliberately, per Principle 6 — it must exactly match what was
  approved, not be recomputed later from possibly-changed inputs)
- Which specific `Advance` a cycle's deduction applies to — stored explicitly
  (`PayrollEntry.advanceId`/`.eidAdvanceId`) at entry time, never re-inferred later from "whichever
  advance is currently active," which could point at the wrong advance by the time a correction
  happens (§12, §15)
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
  operation even at the 10,000-employee floor (§12's row-count note); at that scale, correct indexing
  (not partitioning, not read replicas) remains sufficient, consistent with Principle 4 (don't add
  complexity performance doesn't require yet) — but every future phase should still actively apply
  Principle 10's concrete techniques (virtualization, server-side pagination, background processing
  for long-running operations, bulk writes over row-by-row loops) rather than relying on indexing
  alone to carry a 10,000-employee dataset through, say, an unvirtualized full-table render.
- **Added 2026-07-05:** the `PayrollUnitRelease` sweep (§12b) — flipping `released = true` across
  every `PayrollEntry` a Unit's release affects — must be a single bulk `UPDATE ... WHERE` statement
  keyed off `(cycleId, siteId/unitId)`, not a row-by-row loop over entries, consistent with Principle
  10 even though a single Unit's entry count is typically small; the same applies to computing which
  entries now have *every* touched Unit released, which is a set-membership check expressible as one
  query (count of distinct touched units vs. count of matching `PayrollUnitRelease` rows) rather than
  N queries per entry.

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

## 25. Migration Strategy

- Prisma migrations, additive-first (Principle 8): new tables/columns/lookup rows are the default
  path for any new requirement; destructive changes (dropping/renaming a column in use) require
  explicit sign-off given the historical-integrity stakes (Principle 2). **The 2026-07-03
  `ProjectSite.branchCode` removal (§8) is this project's first genuinely destructive migration** —
  low practical risk only because it has never been applied to a live database (it shipped in Phase
  1's initial migration but no Postgres instance has run it yet), and it carries the explicit sign-off
  this bullet requires, recorded in `docs/PROJECT_PROGRESS.md`.
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
- `PayrollEntry.advanceId`/`.eidAdvanceId` and `BalanceAdjustment.adjustmentTypeId` are part of the
  initial migration (this is a pre-implementation design, not a later addition to an existing schema).
- Any future migration touching `PayrollEntry`, `Correction`, `BalanceAdjustment`, or `AuditLog`
  should get an explicit review pass given their financial/audit criticality, per Principle 4.

---

## 26. Design Assumptions Requiring Confirmation

Items 1, 2, 4, and (as of session 2) 6 below are now **resolved** (final decisions, no longer open)
and are kept only as a record of what was decided and why. Item 5 remains genuinely open (Phase 3's
concern, not Phase 2's) and is unaffected by this round of changes. Item 3 is updated to reflect the
explicit-linkage schema addition, but the underlying business assumption it flags is still worth
confirming.

1. ~~`PayrollCycle` Draft → Released trigger~~ — **Resolved.** Draft → Released is an explicit
   Master User "Finalize Cycle" action, gated by a precondition (no non-held unreleased entries) with
   **no override**. See §10 and `docs/architecture/data-and-storage.md` §4. **Reaffirmed 2026-07-05**
   (Phase 3 architecture review): this stays an explicit action even though `PayrollEntry.released` is
   now itself derived from per-Unit release events (§12b) — the precondition's wording is unchanged.
2. ~~`Employee.cnic` and `.employeeCode` are nullable.~~ — **Resolved 2026-07-02, confirmed as
   documented.** Real client sample data included employees with a blank CNIC. Given CNIC is
   described as "the primary key across the whole system," this is modeled as
   nullable-but-unique-when-present rather than strictly required, to accommodate an employee added
   before their CNIC is on file. Confirmed by the user before Phase 2 Employee Registry schema work.
3. **At most one `ACTIVE` `Advance` per employee per type.** Still assumed, and now reinforced rather
   than merely inferred: `PayrollEntry.advanceId`/`.eidAdvanceId` (§12) record the explicit link at
   entry time, but a new deduction is still auto-linked to "the" active advance of that type via this
   same partial-unique-index assumption. If the business does expect concurrent overlapping advances
   of the same type with independently-tracked balances, this still needs a different design (e.g. a
   manual advance picker at entry time rather than auto-linking to a single implied active advance).
   Not yet confirmed — revisit before Phase 4 (Advances module).
4. ~~`Employee.religion` and `.designation` are free text, not enums or lookup tables.~~ —
   **Resolved 2026-07-02, confirmed as documented.** Designation values vary a great deal across real
   client sites and don't drive any calculation logic, so constraining them didn't seem to add value.
   Confirmed by the user before Phase 2 Employee Registry schema work.
5. **A `PayrollCycle` is exactly one calendar month.** Nothing in the spec suggests non-monthly or
   custom-length pay periods; `year`+`month` is the whole cycle identity. If that ever changes, it's
   a schema change to this table specifically. Not yet confirmed — revisit before Phase 3.
6. ~~CNIC duplicate detection and the recommended approach~~ — **Resolved 2026-07-03 (session 2),
   final decision.** CNIC remains globally unique: `cnic` stays database-unique (partial,
   `WHERE cnic IS NOT NULL` — already true today, §9), with **no override mechanism of any kind**.
   Duplicate `Employee` records are never permitted. Reasoning: a CNIC is a real-world unique
   identifier (Pakistan's national ID); two distinct active people can never legitimately share one,
   so an apparent duplicate is always either a data-entry mistake or the same person already existing
   in the system. An override would reopen exactly the risk the user said they want closed and would
   fragment one person's history across two `Employee` rows, undermining the CNIC-based lookup
   requirement that a single search surface an employee's *full* history (`reference/PROJECT_SPEC.md`
   #13). The one legitimate scenario an override might otherwise tempt — a former employee
   (`dateOfLeaving` set) being **rehired** — is handled exclusively by a new **Reactivate Employee**
   action (`docs/IMPLEMENTATION_PLAN.MD`'s Phase 2.5, Checkpoint 4): reactivating clears
   `dateOfLeaving` and updates the employee's current employment details on their **existing** row,
   never creating a second row with the same CNIC — preserving Principle 2 (historical `PayrollEntry`
   rows still reference the original, untouched `Employee.id`) while keeping one identity, one CNIC,
   one row. This is the direct successor to the Phase 2 "Mark as Left" action (`POST /:id/leave`),
   which had no symmetric counterpart until now. If a reactivation also changes the employee's site/
   unit relative to when they left, the transfer-audit path (§8b/§9) fires alongside a distinct
   `employee.reactivated` entry, since reactivation and transfer are independent, co-occurring facts.
   Two concrete, additive improvements ship alongside the Reactivate action: (a) **normalize before
   validating**, not just before storing — today's Zod pattern (`/^\d{13}$/`) requires digits-only
   input with no dashes, so a user typing a CNIC in the commonly-written `#####-#######-#` form
   currently fails validation outright rather than being normalized; the input strips non-digit
   characters before validation, both in the form and the CSV import path; (b) a debounced pre-submit
   **duplicate-check** lookup (e.g. `GET /employees/check-cnic?cnic=...`) so an operator learns about a
   collision — and which existing employee owns it — before hitting a raw 409 on submit, prompting them
   toward reactivation instead of a blocked create.

---

This is a specification, not an implementation. No Prisma schema or SQL has been generated. Waiting
for approval before either revising this design or proceeding to scaffold `backend/prisma/schema.prisma`
from it.
