# Import Template Architecture

**Owner module(s):** Employee Registry and Project Sites — the two modules with a real spreadsheet
import capability (see "Import capability matrix" below).

**Contains:** The standard workbook structure every downloadable import template follows, the
shared infrastructure vs. module-specific contract split, the Required/Optional/Conditional
convention, the single-source-of-truth architecture that keeps the Excel template, the importer,
the shared Zod schema, and the database in agreement, RBAC scoping (including the creator-access
invariant for bulk-imported Project Sites), atomicity/error-reporting behavior, the
template-versioning decision, the full import capability matrix, the Project Unit scope decision,
and known limitations.

**Sections:** [Core principle](#core-principle) · [Standard workbook structure](#standard-workbook-structure)
· [Shared infrastructure vs. module-specific contracts](#shared-infrastructure-vs-module-specific-contracts)
· [Required / Optional / Conditional](#required--optional--conditional) · [Validation-source-of-truth
architecture](#validation-source-of-truth-architecture) · [Excel validation is advisory; the backend is
authoritative](#excel-validation-is-advisory-the-backend-is-authoritative) · [RBAC](#rbac)
· [The creator-access invariant for Project Site import](#the-creator-access-invariant-for-project-site-import)
· [Atomicity](#atomicity) · [Duplicate handling](#duplicate-handling) · [Error reporting](#error-reporting)
· [Template versioning](#template-versioning) · [Import capability matrix](#import-capability-matrix)
· [Project Units — scope decision](#project-units--scope-decision)
· [Intentionally export-only modules](#intentionally-export-only-modules)
· [Remaining limitations](#remaining-limitations)

Related: `docs/architecture/rbac-creator-access.md` (the creator-access invariant this document
extends to bulk import), `docs/architecture/database/employee.md` and
`docs/architecture/database/sites-and-units.md` (the two modules' own data models).

## Core principle

For every imported field, one contract governs all five layers:

```
Excel template validation  =  import parser expectations  =  shared/frontend validation
                            =  backend API/schema validation  =  database constraints
```

The template must never advertise or permit something the application cannot accept, and the
application must never secretly require or support something the template doesn't present. Every
constraint the template enforces (max length, numeric range, enum values) is read from the same
named constant the Zod schema validates against — never a re-typed number — so the two cannot
silently drift apart. See "Validation-source-of-truth architecture" below.

## Standard workbook structure

Every downloadable import template is a three-sheet workbook:

1. **Instructions** — template name/version, what the import creates (or updates), accepted file
   formats, structural rules (don't rename/add/remove/reorder headers), date/number/code-format
   rules, duplicate/create-vs-update behavior, how errors are reported, and a full **Column Guide**
   table (Column Name, Required?, Allowed Values/Format, Max Length, Example, Notes) generated from
   the same per-column spec the Import Data sheet's own validation reads.
2. **Import Data** — the exact importer-compatible header row, frozen, filtered, with
   Required/Conditional/Optional columns visually distinguished (fill color + header cell comment)
   and Excel data validation applied to every constrained column. **No sample data.** This is the
   only sheet the importer ever reads.
3. **Example** — the same header row, plus exactly one fully valid, neutral sample row.
   Structurally separate from Import Data specifically so an un-deleted example row can never be
   uploaded as a real record — the importer explicitly targets the sheet named `"Import Data"` (see
   `parseTableFromFile`'s `preferredSheetNames`/`excludeSheetNames` in
   `backend/src/common/import-export.ts`), so Instructions/Example content is never parsed even if a
   user reorders tabs, and falls back to "first non-Instructions/non-Example sheet" for backward
   compatibility with a plain ad-hoc workbook (e.g. re-uploading Employees' own plain XLSX export,
   which has one sheet named `"Employee Registry"`).

A workbook *may* also carry a hidden (`state: 'veryHidden'`) `Lists` sheet holding dropdown source
columns — functional for Excel data-validation formulas but never a visible tab. Employees' template
has one (Project Sites, Banks); Project Sites' template does not, because none of its three columns
reference another entity (see "Shared infrastructure" below — a Lists sheet is module-owned, not
part of the shared skeleton, and is only built where a module's own columns actually need one).

## Shared infrastructure vs. module-specific contracts

Introduced when Project Sites became the second module on this architecture — everything that is
genuinely mechanism, not business content, lives once in `backend/src/common/import-export.ts` and
is reused by both importers' own `*-import-export.service.ts`:

```
Shared import infrastructure (backend/src/common/import-export.ts)
    │
    ├─ parseTableFromFile / pickWorksheet     — CSV/XLSX → table, sheet-name targeting
    ├─ ImportColumnSpec                       — the generic per-column contract shape
    ├─ createInstructionsSheet                — title/subheading/paragraph/bullet writers
    ├─ addColumnGuideTable                    — the Column Guide table renderer
    ├─ styleImportDataSheet                   — frozen header, fills, comments, per-column validation
    ├─ buildGenericColumnValidation           — the default textLength/decimal/date validator
    ├─ buildExampleSheet                      — the Example sheet builder
    ├─ assertExactHeaderMatch / diffHeaderRow — structural header-diff + throw
    ├─ formatImportValidationError            — ZodError → readable "Column: message" text
    └─ stringifyCsvSafe                       — formula-injection-safe CSV export
            │
            ├──▶ Employee import contract (employees-import-export.service.ts)
            │       23 columns, a "Lists" sheet (Project/Bank dropdowns), 3 cross-field custom
            │       formulas (`buildValidation` overrides), CNIC/unit-resolution business rules
            │
            └──▶ Project Site import contract (project-sites-import-export.service.ts)
                    4 columns, no Lists sheet, no cross-field rules, reuses `createProjectSite`
                    (the same primitive manual creation uses) as its per-row write
```

What stays module-specific: the actual column array (names, requirement, examples, notes), any
`buildValidation` override (a dropdown needs a source list; a cross-field rule needs sibling-cell
references — both need context only the module has), the Instructions prose describing *that*
module's own create/update semantics, and all business-rule enforcement in the importer's row loop.
This is deliberately **not** one generic "run the whole import" function — each module still owns
its own `generateXImportTemplate`/`importX` orchestration, calling into the shared pieces rather
than the reverse, so a future third module doesn't have to fit through the same conditionals every
other module's business rules needed.

## Required / Optional / Conditional

Three states, not two — some columns are only required in combination with another column (e.g.
Employees' "Account Number" is required only when "Employee Bank" is a real bank, not "Cash" (see
[Final refinement](#final-refinement--employee-bank-made-explicitly-required-blank-no-longer-accepted)
— "Employee Bank" itself is now always required and a blank value is rejected outright);
at least one of "Area"/"Branch Code"/"Area/Location" is required per row). Presenting that as a flat
Required/Optional flag would misrepresent the real rule, so a third `Conditional` state exists, with
its own header fill color and an explanatory note on both the header cell comment and the
Instructions Column Guide row. Project Sites has no Conditional columns — none of its three fields
are cross-field-dependent — but the type/infrastructure supports it identically for any future
module that needs it.

## Validation-source-of-truth architecture

```
Employees:
EMPLOYEE_FIELD_LIMITS / EMPLOYEE_GROSS_PAY_MAX / EMPLOYEE_EOBI_AMOUNT_MAX / PAY_TYPE_VALUES
(shared/src/schemas/employee.ts)
        ├──▶ createEmployeeSchema (Zod)
        └──▶ EMPLOYEE_TEMPLATE_COLUMNS (employees-import-export.service.ts) ──▶ template + errors

Project Sites:
PROJECT_SITE_FIELD_LIMITS
(shared/src/schemas/project-site.ts)
        ├──▶ createProjectSiteSchema (Zod) — the same schema manual creation uses, unchanged
        └──▶ PROJECT_SITE_TEMPLATE_COLUMNS (project-sites-import-export.service.ts) ──▶ template + errors
```

Every field-limit constant mirrors its `@db.VarChar(n)`/`@db.Decimal(p,s)` column definition
exactly (documented inline on each constant); Zod is the only place that actually enforces them,
and each template reads the same constants for its own Excel validation, so the template and the
API cannot describe two different rules.

Two Employee constraints cannot share a literal constant with the database and are tested for
consistency instead of import-time-shared (unchanged from the Employee-only checkpoint): CNIC's
soft 15-character raw-length Excel bound vs. its real 13-digit-after-normalization server rule, and
cross-database uniqueness (CNIC/Employee Code), which is inherently dynamic-data-dependent.

Project Sites has one column of that same "dynamic-data-dependent" class: **Site Name**, the
table's only `@unique` column — its Excel-side rule is a plain max-length bound (`textLength`);
its uniqueness is necessarily server-only (see "Duplicate handling" below).

## Excel validation is advisory; the backend is authoritative

A user can paste over a validated cell, remove data validation entirely, open the file in
LibreOffice, or hand-build a CSV — Excel-side rules are a convenience that catches mistakes before
upload, never the source of correctness. Every rule either template expresses in Excel is
re-validated, unconditionally, by its importer.

Employees' cross-field rules (unchanged from the Employee-only checkpoint):

| Rule | Class | Where enforced |
| --- | --- | --- |
| Account Number required when Employee Bank is a real bank (not "Cash"/blank) | Excel-enforceable | Custom per-row formula (Cash-aware, see below), **and** `createEmployeeSchema`'s `superRefine` |
| Area / Area-Location must agree if both given | Excel-enforceable | Custom per-row formula, **and** `resolveRowUnit` |
| At least one of Area / Branch Code / Area-Location required | Excel-enforceable | Custom per-row formula, **and** `resolveRowUnit` |
| A row's unit must belong to the row's own site | Server-only (dynamic data) | `resolveRowUnit` (layer 1) → `assertUnitBelongsToSite` (layer 2) → composite FK (layer 3) |
| CNIC / Employee Code uniqueness | Server-only (dynamic data) | Database unique constraint |
| Site/Bank name must reference a real, accessible record | Server-only, Excel dropdown reduces typos | Site/bank lookup + `assertSiteAccess` |
| Date of Leaving ≥ Date of Joining | **Not currently validated anywhere** (see Limitations) | — |

Project Sites has no cross-field rules at all — its only non-trivial validation is uniqueness
(server-only, dynamic data; see "Duplicate handling").

## Post-deployment UAT correction — Employee Bank dropdown, Cash semantics, and the "Employee Bank" rename

Found and fixed after the checkpoint above shipped to production; recorded here as part of the same
architecture record, not a separate document.

**Root cause of the blank dropdown entries (confirmed by code inspection, not guessed):**
`generateEmployeeImportTemplate`'s "Lists" sheet writes the Project Site names and Bank names into
two columns of one sheet, padding whichever list is shorter with blank cells so both columns reach
the same row count (needed purely so the sheet-writing loop has one length to iterate). The original
bug: **both dropdowns' own Excel validation ranges were sized to that same shared, padded row
count** (`Math.max(siteNames.length, bankNames.length)`), instead of each dropdown's own real
entry count — so whichever list was shorter had its range extend into the other list's blank
padding rows, producing visible blank options. Fixed by threading each dropdown's own row count
through independently (`ImportColumnSpec.buildValidation` now receives an opaque, module-defined
`listContext` — `{ siteRowCount, bankRowCount }` for Employees — instead of one shared number); see
that field's own doc comment in `common/import-export.ts` for the full explanation, since a future
third dropdown on any module is exactly the shape of change that could reintroduce this class of
bug if not built with its own independent count from the start.

**Cash — confirmed already canonical, represented as `bankId: null`, never a second
representation.** Investigated before writing any fix: the reserved, protected `Bank` row
(`code = 'CASH'`, `name = 'Cash'`, seeded automatically) exists in the database, but is
*deliberately excluded* from `listBanks()`'s default result — the manual Employee create/edit
form's own Bank `<select>` never offers it as a selectable option either; instead it has its own
`<option value="">None (cash payment)</option>` sentinel, meaning **this system already represents
a cash-paid employee as `bankId: null`, not as a reference to the reserved Bank row.** The import
template's "Employee Bank" dropdown now includes a synthetic `"Cash"` entry (first in the list,
sourced as a literal string, never queried from `listBanks()`) as the explicit way to spell that
same blank/`null` meaning — the importer maps a `"Cash"` cell to `bankId: null` (`isCashSentinel`
check in `importEmployees`). At the time this dropdown was introduced, a genuinely blank cell was
*also* accepted and treated identically to `"Cash"`; that equivalence was removed in the final
refinement below — see that section for the current, authoritative rule.

**Employee Bank conditional rules, corrected to match the actual schema (not what the template
previously, incorrectly, claimed):** `createEmployeeSchema`'s `superRefine` requires Account Number
only when `bankId` is set — it has **no reverse rule** forcing Account Number/Branch Code/IBAN to
stay blank for a cash employee. The template's own Instructions/Column Guide previously claimed
Account Number "must stay blank for a cash employee," which the backend never actually enforced —
corrected to state the real rule: Account Number is required only for a real bank; Branch Code and
IBAN are always optional, Cash or not.

**"Project Bank" renamed to "Employee Bank"** (these columns describe the employee's own payment
details, not a property of the Project) — the canonical header on every newly generated template.
**`"Project Bank"` is still accepted as a legacy input header alias** (`LEGACY_HEADER_ALIASES` in
`employees-import-export.service.ts`): a workbook downloaded before this rename still imports
without modification — the alias is substituted before structural header validation runs, and every
column is still read positionally against the canonical header set, so no other parsing logic
needed to change. No database field was renamed — this is a display/import-contract change only.

### Final refinement — Employee Bank made explicitly required (blank no longer accepted)

Found and fixed in a second post-deployment pass, after the UAT correction above had already
shipped: treating a blank cell as silently equivalent to `"Cash"` let a genuinely omitted value pass
through unnoticed, with no signal to the importing user that a decision was actually being made on
their behalf. **Employee Bank is required in import files. Use "Cash" when the employee has no bank
account. The system stores Cash as `bankId = null` internally.**

Concretely:

- The template's Employee Bank column is now `requirement: 'required'` (amber header fill, `Required`
  Column Guide row, `allowBlank: false` on the Excel dropdown validation) — the same visual and
  structural treatment as every other required column (Project, Name, Designation, Basic/Gross Pay).
- `importEmployees` independently rejects a blank cell server-side (`row.cells['Employee Bank'].trim()`
  empty) with the readable, column-named error `Employee Bank: Select "Cash" or a valid bank` —
  Excel's own validation is a convenience for spreadsheet users, never the authority; the backend
  enforces the rule on its own regardless of how the file was produced or edited. A whitespace-only
  cell (e.g. `"   "`) is rejected the same way, since the value is trimmed before the emptiness check.
- The `"Cash"` → `bankId: null` and `<real bank name>` → matching `Bank.id` mappings are unchanged
  from the UAT correction above; only the *blank* input is newly rejected. Real-bank rows still
  require Account Number; Branch Code and IBAN remain optional either way — no additional
  restriction was introduced beyond making the column itself required.
- The `"Project Bank"` legacy header alias is still accepted — backward compatibility applies to the
  **header name only**. A workbook using the old `"Project Bank"` header still has its Employee Bank
  column read correctly, but a blank value under that legacy header is rejected exactly like a blank
  value under the canonical `"Employee Bank"` header; the alias never grants an exemption from the
  required-value rule.

## RBAC

**Employees:** the template is generated per-request: `GET /employees/import-template` passes
`req.currentUser` into `generateEmployeeImportTemplate`, which calls the same RBAC-scoped
`listProjectSites(currentUser)` every other Project Site listing in this codebase uses — a
site-scoped user never sees a site they can't access, even as a dropdown value. Import itself
re-asserts `assertSiteAccess` per row — the dropdown is a usability aid, not the access boundary.

**Project Sites:** both `GET /sites/import-template` and `POST /sites/import` are gated to
`sites:manage` (`PERMISSIONS.SITES_MANAGE`) — the exact same permission `POST /sites` (manual
creation) already requires, confirmed from the repository rather than assumed; no new
`sites:import`-style permission was introduced (per explicit instruction — the existing
`sites:manage` grant already means "may create/administer the Site entity list," and import is
just a bulk form of that same capability). The template itself needs no RBAC scoping of its
own content — `ProjectSite` has no reference/dropdown columns to leak (see "Validation-source-of-
truth architecture" above) — so `generateProjectSiteImportTemplate` takes no `currentUser` at all;
the route's `requirePermission(SITES_MANAGE)` gate is the entire enforcement surface, and it is
purely server-side (verified: a user without `sites:manage` gets 403 from both endpoints regardless
of what the frontend renders).

## The creator-access invariant for Project Site import

`docs/architecture/rbac-creator-access.md` established the invariant for **manual** Project Site
creation: a user authorized to create a site must not immediately need a second user (typically
Master Admin) to grant them operational access to the site they just made. This checkpoint extends
that invariant, unchanged in kind, to **bulk import**:

```
Project Site manual create  (POST /sites)        → creator automatically assigned
Project Site import create  (POST /sites/import) → importer automatically assigned, per row
```

This is implemented by literal reuse, not parallel re-implementation: every successfully imported
row calls `createProjectSiteInTransaction(tx, currentUser, input)` — the exact transaction body
`createProjectSite` (manual creation) itself wraps, factored out so bulk import can compose it with
one more operation in the same transaction (see "Site → initial Project Unit provisioning" below).
Site creation and the creator's own `UserSiteAssignment` row happen atomically; if either half
fails, neither persists (Prisma's `$transaction` rolls back the whole thing), so a row can never
leave behind a Site with no creator access. Master Admin follows the identical pre-existing
behavior `ensureCreatorSiteAssignment` already gives manual creation — no `UserSiteAssignment` row
is written, since Master Admin's access is unconditional everywhere already.

This is not permission escalation (Part 3): the importer must already hold `sites:manage` to reach
the endpoint at all (enforced server-side, above); the automatic assignment only gives that already-
authorized creator operational access to the specific resources *they themselves just created* —
identical in kind to what already happens, one row at a time, for manual creation. It never widens
access to a pre-existing, unrelated site, and it never assigns any user other than the one who
performed the import (verified by dedicated tests — see the Test Results section of the checkpoint
report).

## Site → initial Project Unit provisioning

**Investigated before implementing:** manual Project Site creation (`createProjectSite`) does
**not** and never did auto-create a Unit — confirmed from the repository, not assumed. So bulk
import gaining this behavior is a deliberate, new invariant for the import path specifically, not
an inherited one, and manual "New Site" creation is unchanged.

Without it, importing 600 branches would still leave every one of them unable to receive an
Employee (`resolveRowUnit`, the Employee importer's unit-resolution step, requires a row to name a
real, already-existing `ProjectUnit`) until a human manually created a first Unit under each of the
600 Sites — defeating a large part of the point of bulk import. The fix: every row of a Project
Site import provisions **one** initial Project Unit, atomically, as part of the same operation:

```
Project Site bulk import (one row)
    │
    └─ prisma.$transaction
          ├─ createProjectSiteInTransaction(tx, ...)   — the Site, + creator UserSiteAssignment
          └─ createProjectUnit(site.id, {...}, tx)     — the Site's own canonical Unit-creation
                                                           primitive (project-units.service.ts),
                                                           now accepting an optional tx client
```

**Fields/derivation** — inspected `createProjectUnitSchema` (`name` required, `code` optional/
nullable) before writing any template code, per instruction: `code` is left `null` (nothing in the
Project Site import contract can safely derive one, and none is required); `name` is derived
deterministically as `"Main <Unit Label>"`, using the Site's own *actual, persisted* `unitLabel`
(the parsed input, or the `"Branch"` database default if the row left it blank) — e.g. `"Main
Branch"`, `"Main Department"`. No new template columns (`Initial Unit Name`/`Initial Unit Code`)
were added — `Unit Label` alone is sufficient, and the Instructions sheet explicitly documents this
derivation so it's never a silent surprise.

**Transaction boundary:** Site + initial Unit + creator `UserSiteAssignment` are one indivisible
operation per row — if Unit creation fails, the Site (and its would-be assignment) never persists;
if the assignment fails, neither the Site nor the Unit persists. Verified directly (not just
inferred) by a dedicated test that deliberately throws mid-transaction at each point and confirms
nothing survives.

**RBAC:** creating the initial Unit needs no permission beyond the `sites:manage` already required
to reach the import endpoint at all — confirmed from `project-units.routes.ts`, which gates manual
Unit creation to that same permission (plus `requireSiteAccess`, itself bypassed by `sites:manage`
as a global authority). No new permission was introduced for this.

**Duplicates:** structurally impossible under normal operation — `ProjectUnit`'s
`@@unique([siteId, name])` constraint can only collide with a Unit under the *same* Site, and every
row's Site is either rejected outright (name already exists / duplicated in-workbook) or is a
genuinely brand-new `ProjectSite` row created moments earlier in the same transaction, which cannot
already own a `"Main <Unit Label>"` Unit. Verified explicitly anyway: re-importing an already-taken
Site name is rejected before any write, so it can never produce a second Unit under that Site.

**Audit:** the initial Unit gets its own `project-unit.created` entry — the same action name manual
Unit creation already uses — tagged `metadata.source: 'import'` and `siteId`, alongside
`project-site.created`/`project-site.creator_assigned` (unless Master Admin) and the one
`project-site.import` summary entry. No new audit action was introduced; no redundant entries.

**No retroactive backfill:** this provisioning only ever happens for a Site created *by* this
import operation, in the same transaction as its own creation — a pre-existing `ProjectSite` row is
never touched by any import, and no backfill migration was run or is needed (verified by a
dedicated test: an unrelated import leaves a pre-existing Site's zero Units at zero).

## Atomicity

Both importers are **row-atomic, not file-atomic** — deliberately kept consistent across modules
(this checkpoint's own default), not independently decided per module:

- A **structurally invalid file** (wrong/missing/reordered/extra header columns) is rejected before
  any row is read — zero records are ever touched, for either module.
- A **structurally valid file with some invalid rows** applies every valid row and reports every
  invalid row's reason — never an all-or-nothing failure for the whole file.
  - Employees: a row's Employee create/update happens inside a single `prisma.$transaction`.
  - Project Sites: a row's Site creation, its initial Project Unit, *and* its creator's
    `UserSiteAssignment` all happen inside one single `prisma.$transaction` (see "Site → initial
    Project Unit provisioning" above) — composed from each module's own canonical creation
    primitive, never a parallel re-implementation.

Neither importer wraps the *entire file* in one transaction: doing so would make a 600-row Project
Site import (or a large Employee Registry import) all-or-nothing, directly contradicting the
row-atomic requirement above, and would hold open one very long-lived transaction/lock for the
whole request.

## Duplicate handling

**Employees:** matched by CNIC first, then Employee Number/Code; a match updates the existing
employee (a real, pre-existing product rule — re-importing an exported registry is an explicit
supported workflow). No natural "within-workbook duplicate" concept beyond that same match logic
(a second row with the same CNIC in one file simply updates what the first row just created).

**Project Sites:** `ProjectSite.name` is the table's only `@unique` column and the system's actual
identifier for "is this the same site" — confirmed from the schema, not assumed. Per this
checkpoint's explicit default (**import creates new sites; it never updates existing ones** —
there is no existing product concept of "re-importing a site to update it," unlike Employees' CNIC-
based rehire workflow), duplicates are handled as rejections, not merges:

- **Against the database:** all existing site names are fetched once, up front (`Set<string>`,
  exact/case-sensitive match — the same semantics the database's own unique index enforces); a row
  naming an existing site is skipped with `Site Name: "X" already exists`.
- **Within the workbook:** a single in-memory pre-pass (before any row is written) finds every name
  that appears on more than one row; **every** row sharing that name is skipped — never "first one
  silently wins" — each citing the other row number(s): `Site Name: Duplicate value "X" appears
  more than once in this workbook (also row(s) N)`.

Both checks are O(1) DB round trips total (one `findMany`, no per-row query) plus one O(n) in-memory
pass — see "Scale" in the checkpoint report for the measured ~600-row cost.

## Error reporting

Every row failure is reported as `{ row: number, reason: string }`, and every reason is
human-readable for both modules — `formatImportValidationError` (`common/import-export.ts`)
translates a thrown `ZodError`'s issues into `"<Column Name>: <message>"` text (via each module's
own schema-field → template-column reverse map) instead of letting the error's own
JSON-stringified issue array reach the client. Structural header problems (missing/extra/reordered
columns) are diagnosed explicitly by name via the shared `assertExactHeaderMatch`, not reported as
a bare "header row does not match."

## Template versioning

`EMPLOYEE_TEMPLATE_VERSION` / `PROJECT_SITE_TEMPLATE_VERSION` are stamped into each module's
Instructions sheet purely as a **human-readable diagnostic aid** — support staff or a user
reporting a problem can see at a glance which template revision they downloaded. Neither is read or
enforced by its importer: the shared structural header-diff check (`assertExactHeaderMatch`)
already deterministically detects an outdated template (missing/extra/reordered columns) even if
the version stamp is missing, edited, or the workbook was hand-built without one. Making an
importer depend on a version cell would add a second, weaker source of truth alongside the header
check itself — decided against for both modules, for the same reason.

## Import capability matrix

| Module | Template exists? | Instructions? | Example? | Required/Optional documented? | Excel validation? | Backend validation? | RBAC validated? | Atomic import? | Row/column error reporting? | Changes made |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Employees** | Yes | Yes | Yes | Yes (Required/Optional/Conditional) | Yes (list/textLength/decimal/date/custom) | Yes | Yes (RBAC-scoped Project dropdown, per-row `assertSiteAccess`) | Row-atomic | Yes | Full rebuild (prior checkpoint) + refactored onto shared infra (this checkpoint) |
| **Project Sites** | Yes (new) | Yes (new) | Yes (new) | Yes (Required/Optional; no Conditional columns) | Yes (textLength only — no enum/reference columns) | Yes (new — reuses `createProjectSiteSchema`) | Yes (`sites:manage`, server-enforced) + creator-access invariant (auto-assignment) | Row-atomic, create-only, includes an atomic initial Unit | Yes (including combined duplicate-row messages) | New module — see file list below |
| **Payroll Entry** | No (export only) | — | — | — | — | — | — | — | — | None — import was intentionally removed in an earlier checkpoint; **not reintroduced** |
| **Bank Sheets** | No (export only) | — | — | — | — | — | — | — | — | None |
| **Cash Receiving** | No (export only) | — | — | — | — | — | — | — | — | None |
| **Backup Packages** | No (bundled export archive, no restore/import path) | — | — | — | — | — | — | — | — | None |
| **Project Units** | **No standalone bulk import** — see "Project Units — scope decision" below | — | — | — | — | — | — | — | — | An initial Project Unit is automatically provisioned when a Project Site is bulk imported (see "Site → initial Project Unit provisioning" above) |
| Users / Banks / Roles | No import capability of any kind exists | — | — | — | — | — | — | — | — | None |

## Project Units — scope decision

Investigated before writing any Project Unit import code, per explicit instruction not to silently
expand scope. Finding: **`ProjectUnit` is an architecturally independent, optional-cardinality
child resource of `ProjectSite`** — a Site is a complete, valid, manageable business object with
zero units (nothing in the schema or service layer requires at least one `ProjectUnit` per
`ProjectSite`), and manual Project Site creation (`createProjectSite`) has never auto-created a
default unit either.

**No standalone Project Unit bulk importer was built** — there is still no "upload a spreadsheet of
arbitrary Units" capability, and none was requested; Units remain an independent, optional-
cardinality resource with their own manual CRUD (`project-units.routes.ts`/"Manage Branches").
What *was* added, in response to the operational gap this scope decision originally flagged: **every
bulk-imported Project Site is automatically provisioned with one initial Project Unit**, atomically,
as part of the same import operation — see "Site → initial Project Unit provisioning" above for the
full design. This closes the "600 Sites, still can't onboard a single Employee into any of them"
gap without building a general Unit importer: a bulk-imported Site is immediately operational
(verified end to end by a dedicated test that creates a real Employee against the imported Site's
initial Unit), while a site still using more than one Unit continues to have any *additional* Units
added the ordinary way, through "Manage Branches."

## Intentionally export-only modules

Payroll Entry, Bank Sheets, Cash Receiving, and Backup Packages are all export-only by design.
Payroll Entry import specifically was **intentionally removed in an earlier checkpoint** and is
**not reintroduced** by this checkpoint, per explicit instruction. None of these modules were
modified.

## Remaining limitations

- **Date of Leaving ≥ Date of Joining is not validated anywhere in the application** (Employees) —
  flagged in the prior checkpoint, unchanged here; out of this checkpoint's scope (would also touch
  the manual create/edit and Mark-as-Left flows, not just import).
- **Project Unit ("Area"/"Branch Code") has no dropdown** (Employees) — flagged in the prior
  checkpoint, unchanged here.
- **CNIC's Excel-side check is a soft length bound**, not the real 13-digit rule (Employees) —
  flagged in the prior checkpoint, unchanged here.
- **No standalone Project Unit bulk import** — see "Project Units — scope decision" above. A Site
  that legitimately needs *more than one* Unit (most real branches likely only need the one
  auto-provisioned "Main <Unit Label>") still has every additional Unit added the ordinary way,
  through "Manage Branches" — not a gap for the common case, but a real one for a Site whose
  multi-Unit structure is known up front at import time.
- **A narrow race on Project Site import — now hardened, not eliminated.** The existing-name
  duplicate check is computed from one snapshot fetched at the start of the import; a second,
  concurrent request creating a same-named site *during* this import (not merely a different row in
  the same file, which the in-workbook pre-pass already catches) is now caught and rewritten to the
  same friendly `Site Name: "X" already exists` message (a `Prisma.PrismaClientKnownRequestError`
  P2002-on-`name` catch in `importProjectSites`), rather than surfacing a raw database error for
  that one row. The underlying race itself (two truly simultaneous imports of the identical new
  name) is not redesigned — one of the two rows is still correctly rejected, just now with a
  polished message either way.
