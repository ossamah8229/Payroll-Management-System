# Sites & Units Schema — `ProjectSite`, `ProjectUnit`

**Owner module(s):** Project Sites (`ProjectSite`); Project Units (`ProjectUnit`)

**Contains:** `ProjectSite`, `ProjectUnit`

**Sections:** §8–§8a · Full index: `database/README.md`

---

## 8. `ProjectSite`

**Purpose:** A client relationship/location an employee is deputed to (e.g. "ABL City Region
Lahore" — Broom Services is a payroll-outsourcing company deputing staff to *client* sites;
`reference/PROJECT_SPEC.md` names banks as example clients, e.g. "banks like ABL/HBL/MCB, malls,
retail outfitters"). **Project Sites are pure client/location records — no financial/banking
properties, and, as of 2026-07-03, no operational-unit properties either** (see the revision note
below and the new §8a `ProjectUnit`).
**Why it exists:** Owns site master data; referenced by Project Unit (operational sub-division),
Employee (deputed site — still a direct FK, see `database/employee.md §9`'s composite-FK note), and
User (staff assignment — still site-level, unchanged).
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
Services' own disbursement source account(s) are a separate, not-yet-modeled concept (see
`database/employee.md §7`).
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
payroll cycle (see the new `PayrollEntryWorkLine`, `database/payroll-entry.md §12a`).
**Business rule tie-in:** an `Employee`'s deputed site (`siteId`) and deputed unit (`unitId`) are both
stored directly on the `Employee` row, kept consistent by a composite foreign key rather than by
convention (`database/employee.md §9`); Payroll Work Lines reference Project Units the same way
(`database/payroll-entry.md §12a`); delete is blocked while employees or work lines still reference a
unit, same pattern as every other master-data delete in this schema.

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
  composite foreign key against it** (see `database/employee.md §9`, `database/payroll-entry.md §12a`)
  — this is what makes it a database-level guarantee, not just an application-layer check, that an
  `Employee` or `PayrollEntryWorkLine` can never reference a unit belonging to a *different* site than
  the one already recorded on that same row.
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

---
