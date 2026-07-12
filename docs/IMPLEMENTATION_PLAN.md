# Implementation Plan — Payroll Management System

## Status

Architecture is **frozen and implementation-ready** as of this document's creation. This plan is the
master roadmap from an empty `backend/`/`frontend/` scaffold to a production deployment. It assumes
every decision in `docs/PROJECT_PRINCIPLES.md` and `docs/architecture/*.md` as given — this document
sequences and de-risks *building* that architecture; it does not revisit *what* to build.

If anything encountered during implementation appears to contradict the frozen architecture, **stop
and raise it before proceeding** — per the standing rule for this project, architecture is not
silently reinterpreted to fit an implementation convenience.

---

## Overall Implementation Strategy

Three principles govern the sequencing below, all inherited directly from the frozen architecture:

1. **Build the invariant-enforcing layers before anything that depends on them.** Authentication,
   RBAC/site-scoping, and the Audit Log are load-bearing for almost every later module — they're
   Phase 1, not a cross-cutting afterthought.
2. **Build along the load-bearing data path before its branches.** The path
   *Employee Registry → Payroll Entry → Payroll Processing → Release → Bank Sheets/Cash Receiving*
   (`docs/architecture/overview.md`) is built and proven correct before its highest-risk branch —
   *Corrections → Balance Adjustments* — is layered on top of it. Building the branch first would mean
   testing it against a moving trunk.
3. **The hardest correctness problem (the Correction baseline-replay algorithm,
   `docs/architecture/workflows/corrections-and-balance-adjustments.md`) is scheduled deliberately late, once everything it
   depends on is stable** — not deferred out of avoidance, but sequenced so it's tested against a
   trustworthy foundation rather than a still-changing one.

Within each phase: schema/migration work → backend service + route → tests → frontend → integration
test. No phase's frontend work starts before that phase's backend routes are tested, per Principle 4
(correctness before polish).

---

## Phase Breakdown

### Phase 0 — Project Scaffolding & Foundations

**Builds:** npm workspace root (`backend/`, `frontend/`, `shared/`); Express + TypeScript skeleton
with a health-check route; Vite + React + TypeScript skeleton with Tailwind configured from
`docs/design-system.md` tokens; Prisma initialized against a local PostgreSQL instance; the
`StorageProvider` interface with a working `LocalFilesystemStorageProvider`; GitHub Actions CI
skeleton (install, lint, typecheck); `shared/` package with an empty Zod schema/constants structure.

**Depends on:** nothing — this is the starting point.

**Effort estimate:** 2–3 days.

**Testing strategy:** CI pipeline itself is the test — a green build on a trivial change confirms
lint/typecheck/build all work end to end. No business-logic tests yet.

**Definition of Done:** `npm install && npm run build` succeeds from a clean clone; CI is green on a
pull request; a request to the health-check route returns 200 from both local dev and a first Render
staging deploy.

---

### Phase 1 — Auth, RBAC, and the Audit Log (foundational)

**Builds:** Prisma schema for the auth/RBAC subset of `database/access-control.md` and the audit
subset of `database/audit-log.md`
in one initial migration — `Role`, `Permission`, `RolePermission`, `User`, `ProjectSite` (minimal:
id/name/branchCode/isActive only), `UserSiteAssignment`, `AuditLog`; seed
script (two roles + permissions, one Master User account); `express-session` + `connect-pg-simple` +
Argon2 login/logout; CSRF token issuance/validation middleware; the permission-check middleware and
the site-scoping middleware (independent layers, per `docs/architecture/authentication.md`); the
Audit Log module's insert-only service function plus the database-level `UPDATE`/`DELETE` block
(revoked privileges or a rejecting trigger). `Bank`, `AdjustmentType`, and `CompanySettings` — along
with the rest of the 18-table schema — are deferred to the phase that builds the module owning them
(see Phase 2's `Builds` entry), added via new additive migrations, per Principle 8. *(Resolved
2026-07-02: this deferral was implemented ahead of the plan text in a prior session and is now
ratified as the correct scope — see `docs/PROJECT_PROGRESS.md` §3.1.)*

**Depends on:** Phase 0.

**Effort estimate:** 4–6 days. This is small in table count but disproportionately important — every
later phase's security posture depends on getting this right once, rather than retrofitting it.

**Testing strategy:**
- Migration applies cleanly to an empty database; seed script is idempotent (safe to re-run).
- Login/logout/session-expiry unit and integration tests, including deactivation invalidating an
  active session immediately (the specific reason server-side sessions were chosen).
- RBAC middleware unit tests: a request without the required permission is rejected before reaching
  any handler; a Payroll Staff request for a site outside their assignment is rejected server-side
  regardless of client-supplied parameters.
- **Audit Log immutability test is mandatory here, not optional**: attempt an `UPDATE` and a `DELETE`
  against `audit_log` directly (bypassing the service layer) and assert both are rejected by the
  database itself — this is the one test in the whole plan that verifies a defense-in-depth
  guarantee, not just application logic.

**Definition of Done:** a scripted login as the seeded Master User succeeds; a scripted attempt to
call any protected route without a session fails with 401; a scripted attempt to update or delete an
audit log row fails at the database level; CSRF-missing requests to state-changing routes are
rejected.

**🛑 Review checkpoint.** Stop here for explicit approval before building anything on top of this
foundation. A flaw discovered later in RBAC or audit immutability is expensive to retrofit across
every module built after it.

---

### Phase 2 — Master Data: Project Sites, Employee Registry, Settings, Users

**Builds:** an additive migration bringing in `Bank`, `AdjustmentType`, and `CompanySettings`, with
seed rows (three banks, seven `AdjustmentType` rows, singleton `CompanySettings`) — this is the
Phase 1 seed-scope item deferred here per the resolved scope note (`docs/PROJECT_PROGRESS.md`
§3.1). `Bank` has no relationship to `ProjectSite` — Project Sites are physical client work
locations only, with no banking properties (see `database/sites-and-units.md` §8's
2026-07-02 revision note; a `ProjectSite.defaultBankId` field was briefly added and then removed
before this phase's commit, having incorrectly conflated a site's client identity with banking
data). Project Sites CRUD (delete
blocked while employees remain assigned); Employee Registry CRUD (CNIC/employee-code partial-unique
handling, DOL-based soft "leaving," full site-scoped RBAC for Payroll Staff on view/edit/create per
the C11 decision, generic audit logging on every create/update); Company Details / My Profile / Theme
(Settings module); User Management (Master User creates Payroll Staff accounts with per-site
assignment via `UserSiteAssignment`); Employee Registry CSV/Excel import/export against the official
template headers.

**Depends on:** Phase 1 (auth, RBAC, audit).

**Effort estimate:** 4–6 days.

**Testing strategy:**
- Site deletion blocked while employees assigned; succeeds once reassigned.
- CNIC/employee-code uniqueness enforced only among non-null values.
- **Site-scoping boundary tests are the priority here**: a Payroll Staff user cannot view, edit, or
  create an employee at a site outside their assignment, tested both through the intended UI path and
  via a direct API call with a manipulated `siteId` — the server-side check must hold regardless of
  what the client sends (this is the concrete test for the C11 decision).
- Import/export round-trip: export then re-import the same file produces no unintended changes;
  malformed rows are rejected with per-row error messages, not a whole-file failure.

**Definition of Done:** Master User can create a Payroll Staff user, assign sites, and confirm that
user's session genuinely cannot see or touch employees/sites outside that assignment.

---

### Phase 2.5 — Project Unit Model, Payroll Work Lines Prerequisite, and Employee Registry Refinements

**Added 2026-07-03, after a full pre-Phase-3 architecture review. Checkpoint breakdown and three
amendments added 2026-07-03 (session 2) after explicit user approval of the phase plan** — Checkpoint
0 (shared date/UI foundation), three-layer Site/Unit import validation, dedicated transfer audit
entries, the finalized CNIC decision, and the new `EmployeeTransferHistory` table
(`database/employee.md` §8b). Phase 2 as actually built (`docs/PROJECT_PROGRESS.md`)
shipped `ProjectSite` with a flat `branchCode` and no Project Unit concept — a business-model gap
discovered only after Phase 2's conditional close, the same way `ProjectSite.defaultBankId` was
discovered and corrected within Phase 2 itself. Unlike that earlier correction, this one lands *after*
Phase 2 shipped, so it's sequenced here as its own explicit prerequisite phase rather than silently
rewriting Phase 2's own history. **Nothing below is Phase 3 work** — it's what Phase 3 needs already
in place before its own Payroll Entry/Work Line build starts.

This phase is executed as five explicit, individually-gated checkpoints (not a single build), per the
user's requirement — each ends with typecheck → lint → build → Playwright visual verification →
documentation update → **ask before committing**, exactly like every phase's Definition of Done, but
enforced at checkpoint granularity here rather than only at the end of the whole phase.

**Checkpoint 0 — Foundation: shared date formatting and reusable UI primitives — COMPLETE, 2026-07-03**
- Shared `formatDate()`/`parseDateInput()`/`toIsoDateOnly()` (`shared/src/lib/date.ts`) — ISO ↔
  `DD-MM-YYYY` for display, `DD-MM-YYYY` → ISO for parsing typed input, and ISO-datetime → pure
  ISO-date normalization (replacing every ad-hoc `.slice(0, 10)`/`.toISOString().slice(0, 10)` call),
  living in `shared/` per `docs/architecture/folder-structure.md` so both ends use one implementation.
- A reusable, masked `DateInput` component (`frontend/src/components/ui/date-input.tsx`) replacing the
  native `<input type="date">` previously used for DOB/DOJ/DOL — native date inputs render in the
  browser's OS locale and cannot be forced to `DD-MM-YYYY` by a formatting function alone (the gap
  identified during the pre-Phase-3 review, see `docs/PROJECT_PROGRESS.md` §3 item 18).
- Applied to the Employee Registry's DOB/DOJ/DOL fields (create/edit form) and the Mark-as-Left
  modal's date-of-leaving field — the first adopter, establishing a working pattern before Phase 3
  needs the same convention under its own time pressure.
- **Single source of truth, enforced, not just documented**: every displayed date goes through
  `formatDate()`, every editable date goes through `DateInput`. The codebase-wide grep specified below
  also caught two ad-hoc call sites in the backend's CSV/Excel export
  (`employees-import-export.service.ts`) that predated this checkpoint — a local, differently-behaved
  `formatDate()` helper producing ISO instead of `DD-MM-YYYY` (contradicting `docs/design-system.md`
  §4's explicit "PDF/Excel export" clause), and an `.toISOString().slice(0, 10)` call converting an
  Excel `Date` cell during import parsing. Both replaced with the shared utilities (the local duplicate
  removed entirely); the import path's date-format tolerance already accepted `DD-MM-YYYY`, so this is
  a pure fix, not a breaking change to the import contract.
- **Grep verification performed** (`toLocaleDateString`, `toISOString().slice`, bare `.slice(0, 10)`,
  `DateTimeFormat`, native `type="date"`) across `backend/src`, `frontend/src`, `shared/src`, and both
  test directories — zero remaining ad-hoc date-formatting call sites outside `shared/src/lib/date.ts`
  itself (the one place the pattern is intentionally named in a doc comment).
- Pure unit tests added (`backend/tests/date-utils.test.ts`, no DB required) covering `formatDate`,
  `toIsoDateOnly`, and `parseDateInput`, including leap-year and out-of-range edge cases.
- **Scope note**: the Site → Unit cascading select originally planned for this checkpoint is deferred
  to Checkpoint 1 — it cannot be meaningfully built (or tested) before `ProjectUnit` and its API exist;
  building it now would be an unused, half-wired component. Flagged here rather than silently dropped.
- No schema or migration changes in this checkpoint — shared package and frontend component work only.

**Checkpoint 1 — `ProjectUnit` schema, migration, and dedicated module — COMPLETE, 2026-07-03**
- An additive migration introducing `ProjectUnit` (`database/sites-and-units.md` §8a) and
  removing `ProjectSite.branchCode` (§8's revision note — this project's first genuinely destructive
  migration, low-risk only because it's never been applied to a live database). Generated via
  `prisma migrate diff` against the schema files directly (no live database needed for this), then
  hand-placed into a timestamped migration folder following the exact convention of every prior
  hand-written migration in this project.
- `ProjectSite.unitLabel` (already speced in §8, added here alongside the `branchCode` removal since
  both land in the same migration) — the Project Sites create/edit form and list column now use it in
  place of the removed Branch Code field.
- The dedicated **Project Units** module (`backend/src/modules/project-units/`) — CRUD nested under a
  Project Site (`GET`/`POST /api/v1/sites/:siteId/units`, `PATCH`/`DELETE /api/v1/units/:id`), the
  list/create routes gated by `requireSiteAccess` (this middleware's first real consumer — it existed
  since Phase 1 but had no site-scoped route to guard until now), update/delete gated by
  `sites:manage` alone (Master User only, matching `ProjectSite`'s own mutation gating).
  `deleteProjectSite` now also blocks while any `ProjectUnit` still belongs to the site, per §8's
  revision note. `deleteProjectUnit`'s own guard against `Employee`/`PayrollEntryWorkLine` references
  is written but is a no-op until Checkpoint 2 adds `Employee.unitId` — explicitly flagged in its code
  comment, not silently left incomplete.
- Frontend: a "Manage {unitLabel}s" panel nested under each Project Site (opened from that site's row
  action menu), entirely driven by the site's own `unitLabel` — no hardcoded "Branch" text anywhere,
  verified by grep. New shared `pluralize()` utility (`shared/src/lib/text.ts`) for composing headings
  like "Manage Branches"/"Manage Departments" from the singular `unitLabel`.
- **Scope note**: the Site → Unit cascading select originally planned for Checkpoint 0 (then deferred)
  is deferred again, to **Checkpoint 2** — Checkpoint 1's own UI (managing units *within* one already-
  known site) never needed to *select* a unit from a list scoped by site; that need only arises once
  the Employee Registry form has to pick a unit (Checkpoint 2). Building it now would still have been
  premature.
- **Unplanned fix, discovered via this checkpoint's own Playwright verification, not scope creep**:
  `DropdownMenuContent`'s z-index raised above `Modal`'s (`z-[70]` vs. `z-[60]`) — the Manage Units
  panel is the first place in the app a `DropdownMenu` opens from *inside* an already-open `Modal`,
  and the previous ordering (set during the Phase 2 UI polish pass) caused the open Modal's own
  overlay to permanently intercept clicks on the nested dropdown. Confirmed via Playwright as a real,
  persistent bug (not a transition-timing artifact) before fixing. Full reasoning in
  `docs/PROJECT_PROGRESS.md`'s Checkpoint 1 entry and `docs/SESSION_HANDOFF.md` §3.

**Checkpoint 2 — `Employee.unitId`, composite FK, transfer audit trail, `EmployeeTransferHistory` — COMPLETE, 2026-07-04**
- `Employee.unitId`, composite-FK'd against `ProjectUnit(id, siteId)` (`database/employee.md §9`) — added NOT NULL with no
  default (same convention as `siteId`), safe only because no live database has ever applied a
  migration in this environment. A new reusable `SiteUnitSelect` component
  (`frontend/src/components/ui/site-unit-select.tsx`) gives the Employee Registry create/edit forms
  the Site → Unit cascading select deferred here from Checkpoint 0/1 — selecting a site filters the
  unit picker to that site's own units and resets any stale unit selection; the unit field's label
  and placeholder are driven entirely by the selected site's `unitLabel` (e.g. "Branch"/
  "Department"), built once for reuse by Phase 3's Payroll Entry work.
- **RBAC**: `assertUnitBelongsToSite()` validates the composite relationship at the application
  layer (a clean 400 rather than a raw Postgres FK violation) on both create and any transfer;
  existing `assertSiteAccess()` site-scoping is unchanged — no new unit-level RBAC concept was
  introduced, consistent with the 2026-07-03 architecture decision that a Project Unit belongs to
  exactly one Project Site, so site-level access already covers it.
- A new, lightweight, append-only **`EmployeeTransferHistory`** table
  (`database/employee.md` §8b — new): `id`, `employeeId` FK → `Employee`, `fromSiteId`/
  `toSiteId` FK → `ProjectSite`, `fromUnitId`/`toUnitId` FK → `ProjectUnit`, `effectiveDate` (the date
  the transfer actually took effect in the business — deliberately distinct from `createdAt`, since HR
  may enter a transfer days or weeks after it happened), `transferredByUserId` FK → `User`, `reason`
  (nullable text), `remarks` (nullable text), `createdAt` (when the record was entered into the
  system). One row per transfer event, never edited or deleted except by direct database intervention
  — same immutability convention as `AuditLog`/`Correction`, application-layer only (no DB trigger, per
  §8b's note). **No UI in this phase**, but the schema is deliberately structured (typed FK/date
  columns, not a JSON blob) so a future Transfer History screen — or point-in-time queries like "where
  did this employee work on 15 March," "how many transfers has this employee had," "which employees
  transferred into unit X this year" — can query it directly without parsing `AuditLog.metadata`. This
  mirrors the existing `BalanceAdjustment`-vs-`AuditLog` pattern in this schema: a generic append-only
  log for the audit trail, plus a purpose-built, typed table for the one entity that needs its own
  queryable history.
- **Dedicated transfer audit entries, replacing the generic update event for this case**: whenever an
  Employee edit changes `siteId` and/or `unitId`, the transaction writes (a) the `Employee` row update,
  (b) an `EmployeeTransferHistory` row, and (c) a distinct `AuditLog` action —
  `employee.transferred` — carrying old unit, new unit, old site, new site, the acting user, and the
  timestamp in its `metadata`, instead of (not in addition to) the generic `employee.updated` entry for
  this specific change. An edit that changes *only* other fields (designation, bank details, etc.)
  continues to produce the existing generic `employee.updated` entry, unchanged.
- All three writes happen in one database transaction, per this schema's established
  multi-statement-transaction convention (`database/schema-invariants.md §22`): `updateEmployee()` now takes a `RequestMeta`
  (ip/user-agent) parameter and performs its own audit logging inside `prisma.$transaction(...)`,
  rather than the route handler logging a separate, non-atomic `employee.updated` entry after the
  fact (the pre-Checkpoint-2 pattern) — this closes a real atomicity gap the explicit "atomic in a
  single transaction" requirement surfaced, not just for the new transfer case.
- `transferEffectiveDate`/`transferReason`/`transferRemarks` are accepted as optional fields on the
  ordinary Employee update payload (`shared/src/schemas/employee.ts`) rather than a separate
  endpoint — a transfer is detected implicitly by comparing the submitted `siteId`/`unitId` against
  the employee's current values, the same way any other field edit is. `effectiveDate` defaults to
  the server's current date if not supplied. **Scope note**: no dedicated "record a transfer" UI
  (with its own reason/effective-date fields) was built this checkpoint — only the cascading
  selector was explicitly requested; the backend fully supports richer transfer metadata whenever a
  future UI wants to surface it.
- **Interim import/export unit handling** (the explicit "respects the Site/Unit relationship where
  applicable" requirement): the official template has no dedicated Unit column yet — that full
  remap is Checkpoint 3. Until then, export populates the existing "Branch Code" column with the
  employee's real `ProjectUnit.code` (previously blank, added in Checkpoint 1); import resolves a
  row's unit from its site alone, using that site's unit if exactly one exists, and skipping the row
  with a clear, per-row reason if the site has zero or multiple units (an ambiguous case Checkpoint
  3's column mapping resolves properly).

**Checkpoint 3 — Employee Registry import/export template remap and three-layer Site/Unit validation — COMPLETE, 2026-07-04**
- The import/export template updated so `Area`/`Area/Location`/`Branch Code` columns map onto
  `ProjectUnit` fields instead of being ignored as redundant (`docs/PROJECT_PROGRESS.md` §3 item 5 —
  resolved as a side effect, subject to a client sanity-check of real files). **As built:** export
  writes the employee's `ProjectUnit.name` into `Area` and `Area/Location` (documented aliases) and
  `ProjectUnit.code` into `Branch Code`; import resolves a row's unit *within its named site* by
  `Branch Code` first, then `Area`/`Area/Location`, case-insensitively — every provided column must
  agree on one unit, and a row naming no unit at all is a per-row error (Checkpoint 2's interim
  single-unit auto-resolution is fully removed). An import update that changes an employee's
  site/unit is treated as a *transfer* and writes the `EmployeeTransferHistory` row + dedicated
  `employee.transferred` audit entry atomically with the row update, via the same shared
  `recordEmployeeTransfer()` the ordinary update path now uses (extracted in this checkpoint so
  there is exactly one implementation of that invariant).
- **Every imported row's Project Unit must belong to the row's selected Project Site, enforced at three
  independent layers** (defense in depth, matching this schema's established pattern for the Work Line
  same-site rule, `database/payroll-entry.md §12a`):
  1. **Import layer** — a row-level pre-check during CSV/Excel parsing resolves the named Site and
     Unit and rejects the row with a clear per-row error (not a whole-file failure) if the resolved
     Unit does not belong to the resolved Site.
  2. **Backend/service layer** — the same assertion is repeated at the service call the import path
     shares with the ordinary create/update path, so the check holds even if a future caller bypasses
     the import layer.
  3. **Database layer** — the `(unitId, siteId) → ProjectUnit(id, siteId)` composite foreign key
     (Checkpoint 2) rejects the row outright as the final backstop, exactly as it already does for the
     ordinary Employee create/edit path.

**Checkpoint 4 — CNIC: finalized policy, normalization, duplicate-check, Reactivate workflow — COMPLETE, 2026-07-05**
- **The duplicate-handling policy is now finalized** (this session): CNIC remains globally unique
  (`database/employee.md` §9's existing partial-unique constraint — no change to the
  constraint itself); duplicate `Employee` records are never permitted, with no override mechanism of
  any kind; a rehire is handled exclusively through a new **Reactivate Employee** action, symmetric to
  the existing "Mark as Left" (`POST /:id/leave`), that clears `dateOfLeaving` and updates the
  employee's current employment details (site, unit, designation, bank details, etc.) on their
  **existing** `Employee` row — never creating a second row for the same CNIC, so every historical
  `PayrollEntry` continues to reference the one, unchanged `employeeId` (Principle 2). This resolves
  `database/schema-invariants.md` §26 item 6 as a final decision, no longer a recommendation
  pending sign-off.
- If a reactivation also changes the employee's site and/or unit relative to what they had when they
  left, that edit **also** goes through Checkpoint 2's transfer path (`EmployeeTransferHistory` row +
  `employee.transferred` audit entry) in the same transaction as a distinct `employee.reactivated`
  audit entry — reactivation and transfer are independent facts that can co-occur, and both must be
  individually traceable.
- CNIC normalization (strip non-digit characters before *validating*, not just before storing), in
  both the form and the CSV import path.
  - A debounced pre-submit duplicate-check lookup (e.g. `GET /employees/check-cnic?cnic=...`) surfacing
  which existing employee already holds a CNIC before a raw 409 on submit, prompting the operator
  toward Reactivate instead of a blocked create.
- **Per standing instruction, the concrete implementation (exact endpoint shapes, exact fields touched
  by Reactivate, exact audit entry contents) is presented for explicit approval before this
  checkpoint's code is written** — the policy decision above is final, but the implementation still
  gets a design read before it's built, same as every other checkpoint's code does.

**As built:**
- `shared/src/lib/cnic.ts` — `normalizeCnic()`, the single normalization implementation used by
  `createEmployeeSchema`/`updateEmployeeSchema` (strips non-digits before validating, not just
  before storing), the duplicate-check endpoint, and the CSV/Excel importer's existing-employee
  match — one implementation, not three.
- `findEmployeeByCnic()` (`employees.service.ts`) — the single normalized-CNIC lookup, shared by
  `checkCnicAvailability()` (below) and the importer. Fixed a real bug in the process: the importer
  previously matched an existing employee against the *raw* CSV cell, so a dashed CNIC in a file
  never matched the digits-only value already stored — a rehire's row would silently fall through
  to "create" instead of finding the record already on file.
- `GET /api/v1/employees/check-cnic?cnic=&excludeId=` — wired to `checkCnicAvailability()`. RBAC-
  aware: a Payroll Staff caller learns *that* a duplicate exists but never the identity/site of an
  employee outside their assignment (C11); Master User and a same-site Payroll Staff caller see
  full detail (name, site, active/departed). `excludeId` lets an edit form skip flagging its own
  record.
- `POST /api/v1/employees/:id/reactivate` — wired to `reactivateEmployee()`, the single Reactivate
  implementation every path calls (UI action, CSV/Excel import rehire case). Body reuses
  `updateEmployeeSchema` (the same partial field set an ordinary edit accepts). Clears
  `dateOfLeaving`; 400s if the employee is already active; if the supplied `siteId`/`unitId` also
  differs from what's on file, reuses `recordEmployeeTransfer()` (the existing single transfer
  implementation) so the `EmployeeTransferHistory` row and `employee.transferred` entry fire
  alongside a distinct `employee.reactivated` entry, in one transaction — never a second `Employee`
  row for the same CNIC.
- **Import-based reactivation uses the identical workflow**: when an import row matches an existing
  employee (by CNIC, now correctly normalized) whose `dateOfLeaving` is set, and the row's own DOL
  column is blank, `importEmployees()` calls `reactivateEmployee()` instead of a bare field update —
  same audit trail, same transfer handling, regardless of entry point. Leave-via-import remains out
  of scope, unchanged (a row with a normal update path never sets `dateOfLeaving` through this
  action).
- Frontend: a debounced `check-cnic` call in the Employee create form (400ms, only once 13
  normalized digits are present) surfaces a warning with the existing employee's detail and, if
  they're departed, a "Reactivate instead" shortcut that opens a dedicated Reactivate modal
  (pre-filled from the real current record via a new `GET /employees/:id` hook); Create is disabled
  while a duplicate is flagged. A "Reactivate" action was added to the Employee Registry's row menu
  for any already-departed employee, symmetric to "Mark as left".
- **Tests**: 19 new/updated cases in `employees.test.ts` (CNIC normalization on create/update,
  `check-cnic` exists/masked/excluded, Reactivate clears DOL + updates fields + 400-if-active +
  co-occurring transfer) and `employees-import-export.test.ts` (dashed-CNIC import match regression,
  import-driven reactivation, import-driven reactivation-with-transfer) — **99/99 backend tests
  passing against live PostgreSQL**.
- Real-stack Playwright verification (live browser → Vite → Express → PostgreSQL): created an
  employee, marked them as left, attempted to create a second employee with the same CNIC (dashed
  vs. undashed) — duplicate warning shown, Create disabled, "Reactivate instead" opened the
  pre-filled Reactivate modal, submitting it restored the employee to Active; a direct API call
  reactivating the now-active employee again returned 400; zero console errors throughout.

**Depends on:** Phase 2 (extends its already-shipped Project Sites/Employee Registry modules).

**Effort estimate:** 3–4 days across the five checkpoints — small in scope per checkpoint, but touches
already-shipped Phase 2 code and its one destructive migration, so it gets a full
typecheck/lint/build/Playwright pass at every checkpoint, not one pass at the end.

**Testing strategy:**
- `ProjectUnit` CRUD and delete-blocked-while-referenced tests, mirroring `ProjectSite`'s existing
  pattern exactly.
- Composite-FK test: assigning an `Employee` a `unitId` belonging to a *different* site than the
  request's `siteId` is rejected at the database level, not merely the application layer.
- Transfer-audit test: an Employee edit changing `siteId`/`unitId` produces exactly one
  `EmployeeTransferHistory` row and one `employee.transferred` `AuditLog` entry (with old/new
  site/unit, actor, timestamp) and **not** a generic `employee.updated` entry for that same edit; an
  edit to unrelated fields still produces the generic entry, unchanged.
- Import three-layer validation test: a crafted import row whose Unit belongs to a different Site than
  the row's Site is rejected with a per-row error at the import layer; a direct service call bypassing
  the import layer is independently rejected by the service-layer assertion; a raw write bypassing both
  is rejected by the database composite FK — each layer tested as capable of catching it alone.
- CNIC normalization test: a CNIC entered with dashes/spaces is normalized identically on create,
  update, and CSV import before comparison.
- Reactivate-employee test: reactivating a departed employee clears `dateOfLeaving`, updates current
  employment fields, never creates a second row for the same CNIC, and — when site/unit also changed —
  produces both an `employee.reactivated` entry and an `employee.transferred` entry plus
  `EmployeeTransferHistory` row in the same transaction.

**Definition of Done:** a Project Site can have multiple Project Units, each employee has a default
unit belonging to the same site (database-enforced), deleting a unit or site with dependents is
blocked exactly like every other master-data delete in this schema, every employee transfer is
independently traceable via both `AuditLog` and `EmployeeTransferHistory`, imported rows can never
attach a mismatched Site/Unit pair at any of the three enforcement layers, the Reactivate workflow is
live, and Phase 3 can begin against a schema that already has `ProjectUnit` in place.

---

### Phase 3 — Payroll Entry & Payroll Processing (the core)

**Note (2026-07-05):** a full Phase 3 architecture review (this document's own process, not yet
implementation) froze the release/correction model this phase's schema work must be built against —
see `docs/architecture/workflows/payroll-lifecycle.md` §4, `docs/architecture/workflows/corrections-and-balance-adjustments.md`, and
`database/payroll-entry.md` §12 and `database/release.md` §12b and `database/corrections.md` §13a and `database/balance-adjustments.md` §14/§14a/§14b. The concrete consequence for this
phase specifically: `PayrollEntry` now includes a `lateReason` column (§12) as part of its own schema,
even though the mechanism that uses it — a Late Entry's one-off release — is Phase 4's Release Salary
work, not this phase's. This phase does not implement release, Correction Requests, or Balance
Adjustments; it only needs to shape `PayrollEntry`'s schema correctly so those later phases have
something correct to build on, consistent with this plan's own sequencing strategy (build the trunk
before its branches).

**Executed as seven explicit, individually-gated checkpoints (added 2026-07-07, after explicit user
approval), the same discipline Phase 2.5 used** — each ends with typecheck → lint → build → backend
tests → (Playwright where the checkpoint has UI surface) → documentation update → **ask before
committing**:

- **Checkpoint 0 — Schema foundation: `PayrollCycle`, `PayrollEntry`, `PayrollEntryWorkLine` +
  shared `calcNet` — COMPLETE, 2026-07-07.** See below.
- **Checkpoint 1 — Cycle bootstrap/creation + Payroll Entry/Work Line backend CRUD, RBAC/
  site-scoping, audit logging — COMPLETE, 2026-07-07.** See below.
- **Checkpoint 2 — Payroll Entry grid frontend (TanStack Table + Virtual, inline editing,
  autosave/conflict UX, Serial Number/Remarks/live-totals columns) — COMPLETE, 2026-07-09.**
  See below.
- **Checkpoint 3 — "Split by {unitLabel}" workflow (multi-work-line UI + transactional invariants)
  — COMPLETE, 2026-07-09, COMMITTED as `6be6e68`.** See below.
- **Checkpoint 4 — Multi-select site filter + "Copy to All" bulk toolbar — COMPLETE, 2026-07-09,
  COMMITTED as `70a52da`.** See below.
- **Checkpoint 5 — Payroll Entry CSV/Excel import/export — COMPLETE, 2026-07-09, COMMITTED as
  `b4c1d21`.** See below.
- **Checkpoint 6 — Performance/concurrency validation at the 10,000-employee floor + this phase's
  own 🛑 review checkpoint — COMPLETE, 2026-07-10, COMMITTED as `3298e34`.** See below.

**Checkpoint 0 — Schema foundation — COMPLETE, 2026-07-07**
- Prisma schema: `PayrollCycleStatus` enum; `PayrollCycle` (`database/payroll-cycle.md §10`); `PayrollEntry` (`database/payroll-entry.md §12`) and
  `PayrollEntryWorkLine` (§12a) — one migration, `20260707120000_payroll_cycle_and_entry`, applied
  cleanly to a fresh database. Every check constraint and the `PayrollCycle` `WHERE status = 'DRAFT'`
  partial index that Prisma's schema DSL can't express are hand-added raw SQL in the same migration,
  the same pattern as `Employee`'s CNIC check constraint (Phase 2).
- **Two approved deviations from `database/payroll-entry.md` §12 as it stood before this checkpoint** (both
  presented for explicit sign-off before implementation, per this project's standing practice — see
  `docs/PROJECT_PROGRESS.md` for the full decision record and §12's own dated revision notes):
  (1) `advanceId`/`eidAdvanceId` are deferred to a Phase 4 migration — both FK to `Advance`, which
  Phase 4 builds, and Checkpoint 0 does not create a live FK to a nonexistent table or a premature
  `Advance` stub. (2) `PayrollEntry.remarks` (nullable text) is added — not in §12's original column
  list — editable while the entry is editable, frozen into the permanent snapshot once released,
  intended as the grid's last column (Checkpoint 2).
- **`calcNet`** (`shared/src/lib/calc-net.ts`, exported from `@payroll/shared`) — the single
  implementation used by backend Payroll Processing, the frontend's live grid totals, import/export,
  reports, and (Phase 6) correction calculations, per explicit approval; not backend-only as
  `docs/architecture/overview.md`'s Major Modules table originally read (see its matching
  2026-07-07 revision note). Built on a new `decimal.js` dependency (added to `shared/package.json`)
  — native JS floats are never used. **Rounding policy, per explicit approval:** every intermediate
  value that feeds a further multiplication/division (the per-line daily rate, effective OT rate,
  effective leave rate) is carried at full decimal precision and never rounded before being used in
  the next step; only once a figure is done being multiplied/divided (`earnedAmount`, `otEarned`,
  `leaveEarned`) is it rounded to 2 decimal places (`ROUND_HALF_UP`). `totalEarning`/`totalDeduction`/
  `netSalary` are then pure addition/subtraction of already-2dp-safe values, so `netSalary` always
  exactly reconciles with `totalEarning - totalDeduction` as displayed — no double-rounding drift.
  Per-line breakdown figures returned for transparency are independently rounded for display; the
  authoritative entry-level totals are always summed from the unrounded per-line values, never
  re-derived from the rounded breakdown (avoiding "sum of rounded parts" drift). Designed so a later
  UI checkpoint can total every user-entered numeric column plus a Net Salary grand total across the
  grid, per explicit instruction.
- **Tests**: `backend/tests/calc-net.test.ts` — pure unit tests, no database, mirroring
  `date-utils.test.ts`'s pattern for a `shared/` function: golden-output cases taken directly from
  `reference/payroll_prototype.html`'s real `calcNet()`/sample employee fixtures, multi-line sums,
  the primary-line-by-`sortOrder` leave-rate basis, OT-rate derivation/override, boundary `cycleDays`
  (1 and 31), zero `days`/`grossPay`, a `ROUND_HALF_UP` tie-breaking case, and a classic
  repeating-decimal (10000/3) accumulation case proving no float drift across summed lines.
  `backend/tests/payroll-schema.test.ts` — schema/migration-level tests only (no service/route layer
  exists yet), writing directly via Prisma the same way Phase 2.5's "layer 3" composite-FK test does:
  the composite-FK boundary (`PayrollEntryWorkLine.unitId`/`.siteId` cross-site rejection), every
  check constraint (`PayrollCycle.month`, `PayrollEntryWorkLine.cycleDays`/`days`/`otHours`,
  `PayrollEntry`'s seven non-negative fields, the `released ⇒ releasedAt/releasedBy` and
  `lateReason ⇒ released` conditional constraints), both unique constraints
  (`PayrollCycle(year,month)`, `PayrollEntry(cycleId,employeeId)`,
  `PayrollEntryWorkLine(payrollEntryId,unitId)`), and cascade-delete (deleting a `PayrollEntry`
  removes its work lines, no orphans). **145/145 backend tests passing against live PostgreSQL**
  (99 prior + 46 new). `backend/tests/helpers.ts`'s `cleanTestData()` extended for the new tables,
  scoped by a fake `year: 2900` rather than a text-column prefix (neither new table has one).
- typecheck/lint/build clean across all three workspaces (frontend `.tsbuildinfo` cleared first per
  the standing `@payroll/shared`-change lesson, then re-verified clean, not just assumed).
- **No Playwright this checkpoint** — zero frontend/UI surface was touched (no routes, no service
  layer, no components), an explicitly approved, narrow exception to the otherwise-mandatory
  per-checkpoint Playwright rule, not a silent skip.
- **Environment note**: a migration-diff command was initially run with `--shadow-database-url`
  pointed at the live `payroll_dev` scratch database instead of a dedicated shadow database, which
  reset it (Prisma uses that URL as scratch space) — no git-tracked file or durable data was
  affected, since this database is explicitly documented as ephemeral/re-provisioned every session,
  but it's recorded here as a process lesson: always point `--shadow-database-url` at a dedicated,
  disposable database, never the working dev database, even in a throwaway sandbox.
- **Scope discipline**: no routes, no service layer, no frontend component, no cycle-bootstrap
  action, and no `AuditLog`/RBAC changes were introduced this checkpoint, per its explicit scope —
  all of that is Checkpoint 1 onward.

**Checkpoint 1 — Cycle bootstrap/creation + Payroll Entry/Work Line backend CRUD — COMPLETE, 2026-07-07**
- **`payroll-processing` module** (`backend/src/modules/payroll-processing/`): `createPayrollCycle` —
  one implementation for both the very first cycle (no cycles exist) and every subsequent one,
  since the entry-seeding logic Phase 3 owns is identical either way. Enforces the one
  phase-independent invariant that's actually timeless (`database/payroll-cycle.md §10`): only one `PayrollCycle` may be
  `DRAFT` at a time; a duplicate `(year, month)` is also rejected with a clean 409 ahead of the
  raw unique-constraint violation. **Explicit, approved scope boundary — what this checkpoint's
  cycle creation deliberately does NOT do**: it does not require the outgoing cycle to be
  `RELEASED`, does not archive it, does not generate a `BackupPackage`, and does not include
  departed employees with a pending `BalanceAdjustment` — that full transaction is Phase 5's own
  job (`docs/IMPLEMENTATION_PLAN.md` Phase 5) and depends on Finalize Cycle/Release (Phase 4),
  `BackupPackage`/`StorageProvider` (Phase 5), and `BalanceAdjustment` (Phase 6), none of which
  exist yet — building any of it now would mean either a premature stub or silently skipping a
  load-bearing precondition, both rejected. The previous cycle's own `status` is left untouched.
- **The Payroll Bootstrap Rule — a frozen business rule, confirmed 2026-07-07** (presented as an
  interpretation for review in this checkpoint's implementation report; now ratified as a
  permanent decision, not an open question): for a continuing employee, `grossPay`/`eobiAmount`/
  `eobiApplicable`/`leaveRate` and the new line's `cycleDays`/`otRate` are always carried forward
  from that employee's most recent prior entry, never copied from `Employee`'s own record — payroll
  values represent payroll history and stay stable across cycles until intentionally changed in
  Payroll Entry itself (`Employee.grossPay` is documented, `database/employee.md §9`, as a "template value only").
  Conversely, `designation`/bank fields and the new line's `unitId` (Primary Project Unit) always
  refresh from `Employee`'s CURRENT record instead — Employee master data should always reflect the
  employee's latest assignment/banking information — which is also what keeps a genuine cross-site
  transfer's new entry consistent with its own work line's unit (the composite-FK invariant).
  Attendance always resets to zero. A genuinely new employee (no prior entry) seeds entirely fresh
  from `Employee`'s defaults.
- **`PayrollEntry.siteId` is permanently non-editable via the update API — confirmed 2026-07-07**
  (this checkpoint's own scope-narrowing choice, now ratified as a permanent decision rather than a
  deferred one). Future site changes flow exclusively through the Employee Transfer workflow,
  which the next cycle's bootstrap then automatically picks up via the Payroll Bootstrap Rule above
  — never a direct edit to an existing entry's site. See `shared/src/schemas/payroll-entry.ts`'s
  `updatePayrollEntrySchema` doc comment for the exact reasoning.
- **Performance (Principle 10)**: cycle-bootstrap seeding uses two chunked `createMany` calls
  (500-row batches) rather than one `create` per employee, with entry/work-line IDs generated
  client-side (`randomUUID()`) so the two bulk inserts can still reference each other. Smoke-tested
  at 3,000 employees: cycle + 3,000 entries + 3,000 work lines in ~1.3 seconds (not a full
  Checkpoint 6 performance validation, but confirms the design holds well toward the
  10,000-employee floor).
- **`payroll-entry` module** (`backend/src/modules/payroll-entry/`): `computeEntryCalc` — the one
  adapter from stored `Decimal` fields to shared `calcNet`'s string contract, called by every read
  path (list/get) so a returned entry's `netSalary` is always the same computation, never
  reimplemented per route. Full CRUD: `createPayrollEntry` (copies `Employee`'s current record,
  never caller-supplied overrides, always creates its first `PayrollEntryWorkLine` in the same
  transaction — `database/payroll-entry.md §12a`'s "never zero lines" invariant); `updatePayrollEntry` (optimistic locking via
  `updateMany({ where: { id, version } })`, a stale version rejected with a new 409 `conflict()`
  helper, not silently overwritten); `deletePayrollEntry` (only while unreleased and the cycle is
  still Draft — this is Draft data entry, not yet "historical payroll," so Principle 2 doesn't
  block it). Work Line CRUD (`addWorkLine`/`updateWorkLine`/`deleteWorkLine`) — the backend
  capability behind "Split by {unitLabel}" (its UI is Checkpoint 3's, not built here): work lines
  carry no `version` of their own, so every mutation bumps the parent `PayrollEntry.version` inside
  the same transaction, and every change is folded into a `payroll_entry.updated` audit entry
  (`database/schema-invariants.md §22`: "work-line attendance changes... captured in the same field-level diff"), never a separate
  `PayrollEntryWorkLine`-typed action. Deleting the last remaining work line is rejected.
- **RBAC**: reuses `PERMISSIONS.PAYROLL_ENTRY` (already seeded, already granted to Payroll Staff
  since Phase 1's front-loaded permission list) for all Payroll Entry/Work Line routes; a new
  `PERMISSIONS.PAYROLL_CYCLE_MANAGE` permission (Master-User-only, via the existing
  `Object.values(PERMISSIONS)` grant) gates cycle creation specifically, since creating a cycle is
  a system-lifecycle action, the same class as Finalize Cycle, not Payroll Staff's routine data
  entry. Finance is explicitly not touched — still a two-role system (`MASTER_ADMIN`,
  `PAYROLL_STAFF`) this checkpoint, per its own scope.
- **Site-scoping**: reuses `assertSiteAccess()`/`isMasterAdmin()` (imported directly from the
  Employees module's service layer — the modular-monolith's own established cross-module
  interaction pattern) against `PayrollEntry.siteId`, exactly as `docs/architecture/
  authentication.md` specifies — no new site-scoping concept, no unit-level RBAC.
- **Audit logging**: every mutation (`payroll_cycle.created`, `payroll_entry.created/updated/
  deleted`) writes its `AuditLog` entry inside the same database transaction as the change itself
  (Principle 3), using the existing generic, polymorphic `AuditLog` table — no schema change
  needed. `updatePayrollEntry`'s field-level diff reuses the shared `diffFields`/`omitKeys`
  utility, newly extracted to `backend/src/common/audit-diff.ts` (previously private,
  unexported helpers inside `employees.service.ts`) rather than redefined a second time — the same
  extraction happened for `RequestMeta` (`backend/src/common/request-meta.ts`), per the standing
  "grep for duplicates on new shared utility" rule.
- **Tests**: `backend/tests/payroll-cycle.test.ts` (bootstrap seeding correctness, RBAC rejection
  of non-Master-User cycle creation, the one-Draft-at-a-time and duplicate-(year,month) guards,
  the carry-forward-vs-fresh-seed field-source rule verified end to end, list/get) and
  `backend/tests/payroll-entry.test.ts` (create/duplicate-rejection, Payroll Staff site-scoping via
  a direct API call with a manipulated `employeeId` — the C11 boundary-test pattern — a
  bespoke-permission RBAC-missing-permission case, optimistic-locking stale-version rejection on
  update/delete, immutability once a cycle is no longer Draft, cascade-delete of work lines, and
  full work-line add/update/delete including the cross-site-unit rejection and the
  last-remaining-line-delete rejection). **160/160 backend tests passing against live PostgreSQL**
  (145 prior + 15 new). `backend/tests/helpers.ts` needed no further changes — Checkpoint 0's
  `year: 2900` cleanup scoping already covers every cycle/entry these tests create.
- **Two real bugs found and fixed while writing these tests, not shipped**: (1) `createPayrollCycleSchema`'s
  `year` upper bound (2100) collided with the project's own `year: 2900` test-fixture convention
  (Checkpoint 0), rejecting every test cycle with a validation error — widened to 2999, still a
  real bound against garbage input. (2) An initial test ordering created the test employee *before*
  the cycle, so the cycle's own bootstrap sweep auto-enrolled them — the subsequent manual "create
  an entry" call then correctly 409'd against an entry that already existed, which looked like a
  service bug until traced to test order; fixed by creating the cycle first in every
  `payroll-entry.test.ts` case (the manual-create endpoint's real use case — a late hire mid-cycle
  — inherently requires the employee not to exist yet at cycle-creation time).
- typecheck/lint/build clean across all three workspaces. **No Playwright this checkpoint** — no
  frontend/UI surface exists yet (Checkpoint 2's work), the same explicitly-approved exception
  Checkpoint 0 used.
- **Scope discipline maintained**: no Release, `PayrollUnitRelease`, `PayrollUnitReadiness`,
  Finance role, `CorrectionRequest`, Corrections, Balance Adjustments, `CorrectionPayment`,
  installment recovery, Advances, Ready-for-Release, Holds-as-a-workflow-concept beyond the plain
  editable field, Statements, Bank Sheets, Cash Receiving Sheets, imports/exports, Reports,
  Payslips, or any frontend/UI of any kind were introduced — all explicitly out of scope per this
  checkpoint's authorization and deferred to their own later checkpoints/phases.

**Checkpoint 2 — Payroll Entry grid frontend — COMPLETE, 2026-07-09 (reviewed, verified, and
committed as `e072da5`)**
- **`frontend/src/components/payroll-entry/`** (new): `PayrollEntryGrid` — `@tanstack/react-table`
  drives column/header structure and the row model; `@tanstack/react-virtual` virtualizes the body
  over that row model (tech-stack.md's stated reasoning for choosing both). A single scroll
  container holds a sticky group-label row ("Bank Details", "EOBI"), a sticky column-header row,
  the virtualized body, and a sticky totals row together — all three stay pixel- and scroll-aligned
  because they share one horizontally-scrolling ancestor; the header/totals are pinned only on the
  vertical axis via `position: sticky`, not scrolled in a separate element.
- **Every Phase 3 `PayrollEntry`/primary-`PayrollEntryWorkLine` column** (`columns.ts`, single
  source of column widths shared by header/body/totals): Serial Number, Employee Code, Employee
  Name, Designation, Site (read-only), Bank/Branch Code/Account No./Account Title, Gross Pay,
  Working Days, OT Hours, OT Rate, Cycle Days, Leave Days, Leave Rate, Allowance, EOBI
  Amount/Applicable, Advance Deduction, Eid Advance Deduction, Fine, Hold, Remarks, Net Salary.
  Cycle Days and Leave Days were added beyond the checkpoint's own illustrative column list, since
  both are real, editable, `calcNet`-feeding architecture fields (`database/payroll-entry.md §12/§12a`) — omitting them would
  have left no way to correct a value `calcNet` actually depends on.
- **One implementation per row, not per cell**: `usePayrollEntryEditor` (new hook) owns local draft
  overlays, live `calcNet` recomputation (shared `calcNet` exclusively — no reimplementation
  anywhere in the frontend), debounced autosave, and optimistic-locking conflict handling for one
  `PayrollEntry` (+ its primary Work Line). TanStack Table's per-cell functional renderer model
  doesn't fit a design where 20+ cells share one row-level save transaction, so column defs drive
  the header only; the body renders one custom `PayrollEntryRow` component per row.
- **Autosave**: 600ms debounce after the last keystroke in a row, then one PATCH per touched store
  (`PayrollEntry` fields, primary `PayrollEntryWorkLine` fields) chained so the work-line PATCH uses
  the entry PATCH's freshly-returned `version`, never the pre-request one. A save in flight when
  further edits arrive queues exactly one more save on completion, never drops or races two
  concurrent saves to the same row. Per-row status (dirty/saving/saved/error/conflict) shown as a
  compact icon beside the Serial Number, doubling as the retry/reload-row affordance.
- **Optimistic-locking conflict handling** (`database/schema-invariants.md` §22): a 409 marks
  the row `conflict`, disables further edits on it, and preserves the user's unsaved local draft
  (visible, not discarded) until they explicitly click the conflict icon, which discards the draft
  and re-fetches that one entry fresh. Any other failure (network/5xx) auto-retries up to 3 times
  with backoff, plus a manual retry via the same icon — an edit is never silently dropped.
- **Live totals**: a small external store (`live-totals-store.ts`, `useSyncExternalStore`) each row
  reports its current effective numeric values to on every change (not just on save), so the sticky
  totals row updates as-you-type without forcing a re-render of every other row in the grid. Sums
  every user-entered numeric column (nulls/"auto" excluded from that column's sum, not counted as
  zero) plus the Net Salary grand total, computed by summing each row's own `calcNet` result.
- **Keyboard navigation**: Up/Down/Enter move focus between the same column in adjacent rows,
  including across the virtualizer's mount/unmount boundary (scrolls the target into view first,
  then focuses once React renders it); Tab/Shift+Tab already work natively across columns.
- **`shared/src/lib/number.ts`** (new): `formatMoney`/`formatNumber` — the `en-US`-grouped,
  `PKR`-prefixed-for-currency-only formatting utility `docs/design-system.md` §4 and
  `docs/architecture/folder-structure.md` both anticipated but that no prior phase had actually
  built yet; used identically by the grid and its totals row, one implementation.
- **`frontend/src/components/ui/toggle-switch.tsx`** (new): the pill on/off toggle
  `docs/design-system.md` §3 calls for (Hold, EOBI Applicable) — didn't exist yet, built once,
  shared by both usages in this grid.
- **A small, explicitly-flagged addition beyond the literal grid**: a "Start New Payroll Cycle"
  action (year/month modal, Master-User-only via the existing `payroll-cycle:manage` permission)
  was added to the Payroll Entry page's header, backed entirely by Checkpoint 1's already-built
  `createPayrollCycle`. Without it, the grid has nothing to render in a fresh environment and this
  checkpoint's own deliverable couldn't be demonstrated end-to-end; it does not add any Finalize/
  Release/Archive affordance, which remain later phases' concern.
- **RBAC**: no new permission model — reuses the existing `payroll:entry` permission and the
  backend's own site-scoping verbatim; the frontend renders exactly what the already-scoped list
  endpoint returns and never re-implements a site check client-side.
- **Explicitly out of scope, none introduced**: Split by Project Unit / multi-work-line editor,
  bulk operations, import/export, Release workflow, the Finance role, Corrections, Balance
  Adjustments, Advances, Advance Deferral, `ScheduledPayrollPeriod`, Bank Sheet, Cheque Reference,
  Statement of Account, and performance optimization beyond normal frontend practice (page-to-
  completion fetch of a paginated endpoint, not a windowed/incremental one — Checkpoint 6's own
  10,000-employee-floor validation is unaffected and still to come).
- **Verification**: `npm run typecheck`/`lint`/`build` clean across all three workspaces. Backend
  suite re-run unchanged (160/160 passing) to confirm nothing broke. **No frontend unit-test
  framework exists in this project yet** (no prior phase added one; this checkpoint didn't either,
  consistent with the established practice of relying on typecheck/lint/build + Playwright for
  frontend verification) — "frontend tests (if applicable)" was therefore not applicable. Real-stack
  Playwright verification (live browser → Vite → Express → PostgreSQL, `embedded-postgres` in the
  session scratchpad): logged in, created a Draft cycle, added three test employees/entries via the
  API (a fresh environment starts with zero of either), then in the browser — edited Gross Pay,
  Working Days, and Remarks inline; confirmed Net Salary and the totals row recomputed live via
  `calcNet`; toggled Hold; reloaded the page and confirmed every edit had actually persisted
  server-side (proving autosave, not just local UI state); and separately simulated a genuine
  concurrent edit via a direct API call while the browser held a now-stale cached version, confirmed
  the conflict icon appeared with the row's inputs disabled and the user's own pending edit still
  visible (not silently discarded), and confirmed clicking it correctly reloaded the row to the
  other edit's real server value. Zero console/page errors throughout (one pre-existing, expected
  401 from the session-bootstrap check before login, already documented behavior unrelated to this
  checkpoint). One real inconsistency was found and fixed during this pass: the totals row initially
  gave "Leave Rate" a `PKR` prefix while "OT Rate" (the same kind of value) had none — corrected so
  only genuine payment amounts carry the currency prefix, rates and counts do not.
- **Scope discipline maintained**: no code path in this checkpoint mutates `ScheduledPayrollPeriod`,
  `Advance`, or any Balance-Adjustment/Correction table — the grid touches only `PayrollEntry` and
  its primary `PayrollEntryWorkLine`, exactly as Checkpoint 1's backend already scoped them.

**Checkpoint 3 — "Split by {unitLabel}" workflow — COMPLETE, 2026-07-09 (implemented, verified, and
COMMITTED as `6be6e68`)**
- **A dedicated design review preceded implementation** (2026-07-09, no code written until
  approved): four UI/UX alternatives were compared against the grid's fixed-height virtualization,
  the existing autosave/version-lock model, and Checkpoint 2's editing experience. The user approved
  a **Modal-based Split editor** (Option B) with eight required implementation decisions, all
  honored as described below — most importantly: **the modal must not introduce a separate Save/
  Cancel workflow; it is another editing surface for the same `PayrollEntry`, sharing the grid's
  existing debounced-autosave/optimistic-locking queue, not a second editing system.**
- **No backend or shared-schema changes were needed.** Checkpoint 1 had already built full Work
  Line CRUD (`addWorkLine`/`updateWorkLine`/`deleteWorkLine`, `payroll-entry.service.ts`) and its
  Zod schemas (`shared/src/schemas/payroll-entry.ts`) — this checkpoint is its first frontend
  caller. No new backend endpoint or schema was added, per the checkpoint's own "avoid new backend
  endpoints unless a genuine gap is discovered" scope — none was found.
- **`usePayrollEntryEditor` (`frontend/src/hooks/use-payroll-entry-editor.ts`) generalized from a
  single primary-work-line draft to an arbitrary-line-count model**: `workLineDraft` (one object)
  became `lineDrafts` (a map keyed by work-line id); `commit()` now sequentially flushes the entry's
  dirty fields, then every dirty line's fields, all through the *same* `savingRef`/`pendingRef`
  gate and one chained `version` — so a field edited inline in the grid and a field edited a moment
  later in the modal are queued through one commit loop, never two independent ones racing for the
  same entry's optimistic-locking token. New `setLineField(lineId, key, value)` (debounced, mirrors
  every existing field editor); `addLine`/`deleteLine` are immediate, non-debounced mutations —
  consistent with how every other structural action in this app persists instantly rather than
  staging behind a separate Save step, and still routed through the identical `savingRef` gate so
  they can never race a pending field-edit flush. `setWorkLineField`/`effectiveLine`/
  `cycleDaysInputValue` are kept as backward-compatible aliases onto the primary line, so the grid's
  own inline Days/OT Hours/OT Rate/Cycle Days cells are **unchanged and still directly editable even
  once an entry is split** — since both surfaces now read/write the identical shared draft state,
  there is no data-drift risk from having two live-editable surfaces for the same field, an
  improvement over what the pre-approval design review had flagged as a concern.
- **`buildCalcInput` (`calc-input.ts`) generalized** from a single `primaryLineOverrides` parameter
  to `lineOverrides: Record<lineId, WorkLineCalcOverrides>`, mapping over every one of an entry's
  work lines rather than just the first. This is what makes editing a *non-primary* line inside the
  modal live-update the grid row's own Net Salary cell and the sticky totals row in real time,
  through the exact same shared `calcNet` call the primary line's inline editing already used —
  verified in this session's Playwright pass (a non-primary line's Days edit changed the row's live
  Net Salary before any autosave round-trip completed).
- **New `SplitWorkLinesModal`** (`frontend/src/components/payroll-entry/split-work-lines-modal.tsx`):
  follows this codebase's established list/delete-confirmation `Modal` pattern (the Manage Units
  panel, `project-sites-page.tsx`) rather than a new confirmation mechanism. Renders every work line
  with its own Unit/Days/OT Hours/OT Rate/Cycle Days inputs (the same `InlineNumberCell`/
  `InlineSelectCell` components the grid uses); the lowest-`sortOrder` line is always labeled
  **Primary**, with a visible note that it determines the Leave Rate fallback basis — the operator
  never has to infer this from `sortOrder`. The "add a {unitLabel}" picker and each line's own Unit
  select are both scoped to the entry's fixed `siteId` (`useProjectUnits(entry.siteId)`) and exclude
  units already used by another line on the same entry — cross-site selection and duplicate-unit
  selection are structurally impossible via the UI, not merely rejected after the fact. Deleting a
  line requires an explicit confirmation view first (Cancel/danger "Remove line", matching the
  Manage Units panel's own visual convention); deleting the last remaining line is disabled
  client-side (with the same reasoning the backend's own 400 gives), a defense-in-depth mirror of
  `deleteWorkLine`'s server-side guard.
- **New `useAddWorkLine`/`useDeleteWorkLine` hooks** (`frontend/src/hooks/use-payroll-entries.ts`),
  mirroring the existing `useUpdateWorkLine`'s cache-merge pattern exactly — both mutations return
  the full updated entry (fresh `version`, every line), merged into the React Query cache the same
  way every other work-line mutation already is.
- **Entry point — a textual badge, not an icon**, per explicit instruction: a new `units` grid
  column (between Gross Pay and Working Days, `columns.ts`) renders `"{n} {unitLabel or
  pluralize(unitLabel)}"` (e.g. "1 Branch" / "2 Branches"), reusing the existing `pluralize()`
  utility rather than the literal word "Unit" — consistent with this project's standing "no
  hardcoded unit terminology" discipline (the Manage Units panel, `SiteUnitSelect`). Not included in
  `NAVIGABLE_COLUMN_IDS`: it's a button, not a data-entry field, so Up/Down column-hopping doesn't
  apply to it; it still reaches focus via native Tab order and activates via Enter/Space, avoiding a
  conflict with the grid's own delegated Enter-moves-to-next-row handler.
- **Verification** (this session, real-stack — live Postgres via `embedded-postgres` in the session
  scratchpad, live backend + frontend dev servers, real Chromium via Playwright, no mocks):
  `typecheck`/`lint`/`build` clean across all three workspaces (same 4 pre-existing
  `react-refresh/only-export-components` warnings, none new). **Backend suite unchanged at
  160/160** (no backend files were touched). A dedicated Playwright script drove the real UI through
  every item this checkpoint's plan named: adding a second and then confirming no further line can
  be added once a two-unit site's units are exhausted; editing multiple lines; deleting a line via
  the confirm/cancel flow; deleting the last remaining line correctly disabled; duplicate-unit
  selection structurally prevented (per-line and add-line pickers both exclude already-used units);
  cross-site units never offered; the Primary line clearly labeled; Net Salary recalculating live
  from a non-primary line's edit; the change persisting server-side after autosave; the badge and
  line count surviving a full page reload; a genuine simulated concurrent edit correctly producing a
  409 the UI surfaces with a Reload affordance that recovers cleanly; Tab order moving correctly
  from a line's Unit select to its Days field. **23 of 24 explicit checks passed**; the one
  "failure" was the browser's own automatic console logging of two *deliberately provoked* non-2xx
  network responses (a pre-login 401, the same already-documented harmless pattern Checkpoint 2's
  own verification recorded, and the 409 this very test exists to trigger) — not an application
  error, the same class of expected/documented console noise as Checkpoint 2's verification, not a
  new defect.
- **One real bug found and fixed during this session's own verification, not shipped**: the
  "no more units to add" message initially read "Every branches at this site is already on this
  entry" (`pluralize(unitLabel)` applied where the sentence grammatically needs the singular —
  "Every branch," not "Every branches"). Fixed to use the singular `unitLabel` directly; the other
  nearby usage of the plural form ("attributed across one or more branches") was already correct and
  left unchanged.
- **A second real bug found and fixed during a dedicated final architectural verification pass**
  (2026-07-09, requested before commit): the new `units` column was inserted into `PAYROLL_COLUMNS`
  (`columns.ts`) but `payroll-entry-totals-row.tsx` — the sticky totals row — renders one
  hardcoded `<div role="cell">` per column, and was never updated with a matching empty cell. Every
  totals-row value from Working Days onward was therefore silently shifted one column left relative
  to its header, a genuine misalignment. Fixed by inserting the missing empty cell in the same
  position as `columns.ts`'s own insertion; re-verified visually via Playwright screenshot showing
  every summed value (Gross Pay, Working Days, OT Hours, Cycle Days, …) correctly under its own
  header again. **Lesson recorded for future column additions**: `columns.ts`'s own column array is
  the single declared source of widths/order, but the totals row's cell markup is not generated from
  it — any future column insertion must also touch `payroll-entry-totals-row.tsx` by hand until that
  row is refactored to render generically from `PAYROLL_COLUMNS` (not done here — out of scope for a
  one-line insertion fix).
- **Final architectural verification, requested and performed before commit (2026-07-09)** — a
  dedicated real-stack Playwright stress test (network-request-level capture, not just UI
  assertions) confirmed the autosave/version-locking architecture holds under concurrent and rapid
  editing: (1) **batching** — editing 4 fields across 2 different work lines within one 600ms
  debounce window produced exactly one autosave cycle: 0 entry PATCHes, exactly 2 work-line PATCHes
  (one per dirty line, each carrying every one of that line's changed fields in a single body, never
  one request per field), sent strictly sequentially, the second correctly using the `version` the
  first PATCH's response returned. (2) **queueing** — with `/api/v1/work-lines/**` PATCHes
  artificially delayed 1800ms to force a genuine in-flight window, further edits made to two
  different lines during that window were never sent as parallel requests; they queued and flushed
  as two further sequential PATCHes once the in-flight one completed (three total, each ≥1500ms
  apart, proving no overlap), and the final server state exactly matched the last-entered value for
  every field, including the queued line's edit — no edit was lost or overwritten by a stale
  in-flight request. (3) **rapid restructuring** — add line → edit two lines' fields → delete a line
  (via the confirm flow) → keep editing the remaining lines, all within under a second of real
  interaction time, produced zero 409s, zero 4xx/5xx of any kind, zero duplicate requests, and a
  final server state matching every one of the UI's last-entered values. (4) **regression** — a
  second, ordinary (non-split, single-line) entry on the same grid was edited exactly as in
  Checkpoint 2 (inline Gross Pay/Working Days): still exactly one entry PATCH + one work-line PATCH
  per autosave cycle, Up/Down keyboard navigation between rows still works, and the sticky totals row
  (screenshot-verified) still sums and aligns correctly under every header — no behavioral or visual
  regression from Checkpoint 2. Full network-level evidence (request bodies, timings, response
  versions) reviewed for every scenario, not just pass/fail assertions.
- **Explicitly out of scope, none introduced**: the multi-select site filter and "Copy to All" bulk
  toolbar (Checkpoint 4), Payroll Entry CSV/Excel import/export (Checkpoint 5), the 10,000-employee
  performance/concurrency validation (Checkpoint 6), and any Release/Finance/Corrections/Balance-
  Adjustment/Advance code path — this checkpoint's mutations touch only `PayrollEntry` and its
  `PayrollEntryWorkLine`s, exactly as Checkpoint 1 already scoped them. Line reordering (changing
  which line is Primary) was deliberately not built — the modal only *displays* which line is
  Primary; nothing in this checkpoint's authorization asked for a reorder affordance, and adding one
  was judged out of scope rather than a silent gap.
- **Committed as `6be6e68`** — "feat(payroll): implement Phase 3 Checkpoint 3 Split by Unit
  workflow", after a dedicated final architectural verification pass (autosave batching, queueing
  under an in-flight save, rapid restructuring, and Checkpoint 2 regression — see
  `docs/PROJECT_PROGRESS.md`'s "Pre-Commit Final Verification Pass" subsection) found and fixed one
  further real bug (the totals-row column-misalignment noted above) before commit.

**Checkpoint 4 — Multi-select site filter + "Copy to All" bulk toolbar — COMPLETE, 2026-07-09
(implemented, verified, and COMMITTED as `70a52da`)**
- **A dedicated architecture investigation preceded implementation** (2026-07-09, no code written
  until findings were presented and decisions frozen): resolved two open questions from the prior
  read-only Checkpoint 4 review. (1) **A new backend bulk-update endpoint is required** — direct
  evidence from `database/schema-invariants.md` §23's standing rule ("bulk writes over row-by-row
  loops... even though [the affected set] is typically small," illustrated by the `PayrollUnitRelease`
  sweep precedent), the `employee.import` audit entry's existing one-summary-row-per-bulk-action
  precedent (`employees.routes.ts`), and a concrete O(N²) React-Query-cache-merge cost that looping
  `useUpdatePayrollEntry`/`useUpdateWorkLine` from the frontend would introduce. (2) **Copy to All
  applies only to each entry's primary work line** — the frozen decision, chosen for strict
  consistency with the grid's own inline Cycle Days/OT Rate columns (which have only ever meant "the
  primary line" since Checkpoint 2) and to keep Split by {unitLabel}'s non-primary lines reachable
  only through their own modal, never as a side effect of a broad bulk action.
- **No shared-schema database changes** — Checkpoint 4 introduces no new Prisma model or migration,
  only a new Zod request schema. `bulkUpdatePayrollEntriesSchema` (`shared/src/schemas/payroll-entry.ts`)
  is a discriminated union on `field` (`leaveRate`/`otRate`: `decimalString`, reused verbatim from the
  single-entity schemas; `cycleDays`: the same `1–31` integer range), with a mandatory non-empty
  `siteIds` array — a bulk mutation's scope must always be an explicit, deliberate selection, never
  implicitly "every employee in the cycle," even though the grid itself may display every site when
  unfiltered.
- **New `bulkUpdatePayrollEntries`** (`backend/src/modules/payroll-entry/payroll-entry.service.ts`),
  routed as `PATCH /api/v1/payroll-cycles/:cycleId/entries/bulk` (nested under the same cycle-scoped
  router as list/create, gated by the existing `PERMISSIONS.PAYROLL_ENTRY` — no new permission).
  Rejects the whole request with 400 if the cycle is no longer Draft (checked once, reusing
  `getPayrollCycle` from `payroll-processing.service.ts`, rather than per-row); validates every
  requested `siteId` via the existing `assertSiteAccess`, once per site, not once per entry. Resolves
  the matching entry set with one query (also fetching each entry's primary line id via `take: 1`
  ordered by `sortOrder`), filters out already-released entries app-side (mirroring
  `assertEntryEditable`'s rule without erroring the whole batch over one locked row), then executes
  **exactly one `updateMany`** — either on `PayrollEntry` (`leaveRate`) or on `PayrollEntryWorkLine`
  scoped to the resolved primary-line ids (`cycleDays`/`otRate`) — plus a second `updateMany`
  incrementing every affected entry's `version`, both inside one transaction. **Deliberate, documented
  exception to this module's otherwise-universal per-row optimistic locking**: no caller-supplied
  `version` is taken or checked per row (this is a criteria-scoped administrative sweep, the same
  class of operation as the `PayrollUnitRelease` sweep — not a targeted edit of a row the caller just
  read); each row's `version` still increments, so a row concurrently open in a Split by {unitLabel}
  modal or another operator's in-flight autosave correctly 409s on its own *next* save against the
  now-stale version it holds. Writes exactly **one summary `AuditLog` entry** (`payroll_entry.bulk_updated`,
  `entityId: null`, `metadata: { cycleId, siteIds, field, value, matchedCount, appliedCount }`) —
  never one row per affected entry, matching `employee.import`'s existing precedent.
- **New, reusable `MultiSelectFilter`** (`frontend/src/components/ui/multi-select-filter.tsx`) —
  deliberately domain-agnostic (`options`/`selectedIds`/`onChange`/`label` props only, no
  Payroll-Entry-specific text or logic), per `reference/PROJECT_SPEC.md` item 10 naming Release
  Salary and the Fines/EOBI report as later callers of this exact same filter. Built on a new
  `DropdownMenuCheckboxItem` primitive added to the existing `dropdown-menu.tsx` (Radix
  `CheckboxItem`, `onSelect` calls `preventDefault()` so the panel stays open across repeated
  toggles — a real behavioral difference from the existing action-menu `DropdownMenuItem`, which
  closes on select by design). An empty selection means "no filter — show everything," matching the
  backend's own existing convention for an omitted `siteId` query param.
- **Frontend filtering is pure client-side, in-memory** (`payroll-entry-page.tsx`): `usePayrollEntries`
  already fetches every entry the current user can see for the cycle (Checkpoint 2's own design), so
  the site filter is a memoized `Array.filter()` over that already-loaded array — no new network
  request, no backend change needed for this half of the checkpoint, confirming the read-only
  investigation's conclusion. The filtered array is what's passed to `PayrollEntryGrid`, which also
  correctly scopes the sticky totals row to the filtered subset for free (`LiveTotalsStore.setBase`
  already took an explicit array argument, not an implicit global).
- **New `CopyToAllToolbar`** (`frontend/src/components/payroll-entry/copy-to-all-toolbar.tsx`) —
  three independent field/value pairs (Cycle Days, OT Rate, Leave Rate), matching
  `reference/payroll_prototype.html`'s original reference implementation. Disabled whenever no site
  is selected in the filter (client-side mirror of the schema's non-empty-`siteIds` requirement);
  each field's own "Copy to All" button additionally requires a currently-valid typed value, reusing
  `isValidDecimalDraft`/`parseValidCycleDays` — the exact same validation the grid's own inline cells
  already apply, not a second implementation. Feedback uses the existing `sonner` toast mechanism
  (`toast.success`/`toast.error`, matching `new-cycle-modal.tsx`'s established pattern), reporting
  "Applied to N of M employee(s)" from the endpoint's own summary response.
- **New `useBulkUpdatePayrollEntries`** (`frontend/src/hooks/use-payroll-entries.ts`) — on success,
  invalidates the cycle's entries query (a full refetch), deliberately not a manual per-row cache
  merge: a bulk action can touch far more entries than the virtualizer ever mounts at once, so there
  is no bounded row set to merge the way `useUpdatePayrollEntry`/`useUpdateWorkLine`'s `replaceEntry`
  does for a single row.
- **Verification** (this session, real-stack — live Postgres via `embedded-postgres`, live backend +
  frontend dev servers, real Chromium via Playwright): `typecheck`/`lint`/`build` clean across all
  three workspaces (same 4 pre-existing warnings, none new). **5 new backend tests, full suite
  165/165** against a freshly re-provisioned database (RBAC boundary on `siteIds`; primary-line-only
  targeting proven against a genuinely split entry, asserting the secondary line's `cycleDays` is
  byte-identical to its seeded value; entry-level `leaveRate` bulk write scoped correctly to the
  selected site only; a released entry correctly skipped — `matchedCount` including it,
  `appliedCount` excluding it — without failing the batch; a non-Draft cycle rejecting the whole
  request outright). A real-stack Playwright pass (**15/15 checks**) drove the actual UI: selecting a
  site narrows the grid and the totals row together (confirmed via the "N employees" total, not just
  visually); Copy to All correctly disabled with no site selected, and separately still disabled with
  a site selected but no value typed (both gates independently verified); a bulk apply on a
  genuinely split entry updated only its primary line's `cycleDays` server-side, leaving the
  secondary line's seeded value untouched; a second site's entry, deliberately outside the selected
  filter, was confirmed completely untouched by the same bulk request; clearing the filter restored
  every site's employees; and — the explicit regression requirement — Checkpoint 2's ordinary inline
  autosave and Checkpoint 3's Split by {unitLabel} badge/line-count both re-verified working
  unchanged after these changes.
- **Explicitly out of scope, none introduced**: search, drag-to-reorder, the Release workflow,
  CSV/Excel import/export (Checkpoint 5), and anything from Phase 4 onward.
- **Committed as `70a52da`** — "feat(payroll): implement Phase 3 Checkpoint 4 multi-site filtering
  and Copy to All", after a repository-wide final verification pass (diff-scope review, merge-marker/
  TODO/dead-code checks, a fresh typecheck/lint/build, backend tests re-confirmed at 165/165 and the
  Playwright pass re-confirmed at 15/15 against a freshly re-provisioned database) found no defects.

**Checkpoint 5 — Payroll Entry CSV/Excel import/export — COMPLETE, 2026-07-09, COMMITTED as
`b4c1d21`**
- **A dedicated read-only architecture review preceded implementation** (this session), covering
  what Checkpoints 0–4 had already built, the reusable Employee Registry import/export
  infrastructure, and the reference prototype/`reference/PROJECT_SPEC.md`'s own (pre-Project-Unit,
  pre-Work-Line) Payroll Entry template. The review surfaced one genuinely open design question —
  whether the flat, single-row-per-employee template (which predates `PayrollEntryWorkLine`
  entirely) should grow a Unit column and multi-row-per-employee semantics to represent a split
  entry's non-primary lines — and presented three options. **Approved decision ("Option C"): the
  format stays flat and represents only an entry's primary work line**, mirroring Checkpoint 4's own
  frozen "Copy to All touches the primary line only" precedent exactly, rather than reopening it. A
  split entry's non-primary lines remain reachable exclusively through the grid's Split by
  {unitLabel} modal; the limitation is surfaced as UI copy, not a file-format change. This
  supersedes this document's own stale "one row per work line" note further below (Phase 3's
  original `Builds:` paragraph, written before Phase 2.5 introduced `PayrollEntryWorkLine`) — that
  sentence is corrected in place, not left contradicting this decision.
- **Approved decisions frozen ahead of implementation, all now built exactly as specified**: (1)
  **match keys are Employee Code and/or CNIC**, not CNIC alone (the frozen spec's original, single
  key) — CNIC is optional since Phase 2.5 Checkpoint 4, so CNIC-only matching cannot address every
  employee; both provided keys must agree on the same employee, or the row is an error, mirroring
  `resolveRowUnit`'s own two-key defense-in-depth pattern. (2) **Import is update-only** — never
  creates a `PayrollEntry`/`PayrollEntryWorkLine`, never bootstraps an employee into the cycle, never
  touches `siteId` (permanently non-editable, unchanged) or `released`/`releasedAt`/`releasedBy` (the
  exported `Released` column is read-only/informational, never parsed back into a write); a row
  naming no known entry in the target cycle is skipped and reported, never silently created. (3)
  **Optimistic locking follows the Checkpoint 4 administrative-bulk-operation precedent** — no
  `version` column in the file, no per-row version check, but every successfully updated row still
  increments `PayrollEntry.version`, so a row concurrently open in the grid correctly 409s on its own
  next save. (4) **One summary `AuditLog` entry per operation** — `payroll_entry.import` and
  `payroll_entry.export` (export logging its own summary entry is a deliberate, approved deviation
  from Employee Registry's export, which logs nothing) — never one row per imported entry.
- **`backend/src/common/import-export.ts`** (new) — `parseTableFromFile()`, the CSV/XLSX-to-table
  half of every import parser in this codebase, extracted unchanged from
  `employees-import-export.service.ts` (which now calls it instead of inlining the same ~25 lines a
  second time) so Payroll Entry's own, differently-headered importer reuses it rather than
  duplicating it — per the standing "grep for duplicates on new shared utility" rule. Also hosts the
  shared `ImportRowError` shape both importers' `ImportResult` types now use.
- **`backend/src/modules/payroll-entry/payroll-entry-import-export.service.ts`** (new) —
  `PAYROLL_ENTRY_TEMPLATE_HEADERS` (`CNIC, Employee Code, Name, Site, Designation, Gross Pay, Days,
  OT Hrs, OT Rate, Allowance, Leave, Leave Rate, Cycle Days, EOBI Amount, EOBI On, Advance,
  Eid Advance, Fine, Hold, Released` — `reference/PROJECT_SPEC.md`'s own list, plus the approved
  `Employee Code` addition); `exportPayrollEntriesToCsv`/`Xlsx` (one row per entry, primary line
  only, `siteIds`-filterable exactly like Employee Registry's export); `parsePayrollEntryImportFile`;
  `importPayrollEntries` (update-only, per-row independent validate/authorize/assert-editable/
  update-or-skip, exactly mirroring Employee Registry's own per-row loop rather than a bulk SQL
  engine — these rows are heterogeneous per-employee edits, not a uniform criteria-scoped sweep, so
  the row-by-row model is the right fit here even though `bulkUpdatePayrollEntries` uses a single
  `updateMany`). Field validation reuses `updatePayrollEntrySchema`/`updateWorkLineSchema` (minus
  `version`) rather than redefining the same rules; the field→Prisma-payload mapping reuses two
  functions newly exported from `payroll-entry.service.ts` for this purpose —
  `mapUpdateInputToEntryData` (already existed, now exported) and `mapUpdateInputToWorkLineData`
  (extracted from `updateWorkLine`'s previously-inline mapping, which now calls it too) — the exact
  same mappings the ordinary single-row PATCH routes use, so there is exactly one implementation of
  "which fields does an entry/work-line edit touch," not two. `assertEntryEditable` (already existed)
  is also now exported and reused verbatim for the released-row/non-Draft-cycle rejection, rather
  than reimplemented.
- **Routes**: `GET /api/v1/payroll-cycles/:cycleId/entries/export` and
  `POST /api/v1/payroll-cycles/:cycleId/entries/import` (multer, 10MB limit, same convention as
  Employee Registry), both nested on the existing `payrollCycleEntriesRouter` alongside `/bulk`. Both
  gated on the single existing `PERMISSIONS.PAYROLL_ENTRY` — **no new permission introduced**, per the
  approved RBAC decision; this module never split view/create the way Employee Registry did.
- **Frontend**: `downloadPayrollEntryExport()`/`useImportPayrollEntries()` (`use-payroll-entries.ts`),
  mirroring `use-employees.ts`'s own export/import hooks; `api-client.ts`'s cookie reader is now
  exported (`readCookie`) so both hooks share one CSRF-cookie-reading implementation instead of each
  redefining it. Export CSV/Export Excel/Import buttons added to the Payroll Entry page's toolbar (a
  new `ImportResultModal`, symmetric to Employee Registry's own, with no "created" count since import
  is update-only); a UI note — "N employee(s) have attendance split across more than one location
  this cycle — CSV/Excel import and export only cover each employee's primary line..." — is shown
  above the grid whenever any currently-filtered entry has more than one work line, fulfilling the
  approved Option C's "communicate the limitation via UI copy" requirement without touching the file
  format itself.
- **Verification** (this session, real-stack — live Postgres via `embedded-postgres`, live backend +
  frontend dev servers, real Chromium via Playwright): `typecheck`/`lint`/`build` clean across all
  three workspaces (same 4 pre-existing warnings, none new). **10 new backend tests, full suite
  175/175** against a freshly re-provisioned database (CSV import, XLSX import, export header/
  round-trip, Employee-Code-only matching, CNIC-only matching including a dashed-CNIC normalization
  case, a released-row skip reusing `assertEntryEditable`, a whole-request 400 against a non-Draft
  cycle, a manipulated-site RBAC rejection via a direct API call — the C11 boundary-test pattern — an
  unknown-employee/no-entry-in-cycle skip, and one summary `AuditLog` entry per import and per
  export). A real-stack Playwright pass (**13/13 checks**) drove the actual UI: exported CSV's header
  row matches the template exactly; a split employee's row appears in the export (primary line only);
  Excel export downloads; a CSV import updates the matched row and reports a clear per-row reason for
  the unmatched one; the imported value is confirmed persisted server-side after a full page reload
  (not just local UI state); a genuine XLSX round-trip (re-importing the just-downloaded `.xlsx`
  export) succeeds through the real ExcelJS parsing path; the split-entry UI note renders correctly;
  and — the explicit regression requirement — Checkpoint 2's ordinary inline autosave was re-verified
  working unchanged (a plain entry's Gross Pay edited via the grid and confirmed persisted
  server-side) after all of the above. Zero unexpected browser console errors (the one pre-existing,
  documented pre-login 401 excepted, per every prior checkpoint's own convention).
- **Explicitly out of scope, none introduced**: any Unit/multi-row representation in the file format
  (Option C, above), Release, Corrections, Balance Adjustments, Advances FKs, and Checkpoint 6's own
  10,000-employee performance/concurrency floor validation.
- **Committed as `b4c1d21`** — implementation complete, independently verified end to end
  (typecheck/lint/build, 175/175 backend tests, 13/13 Playwright checks), reviewed, and approved
  before commit, per this project's standing per-checkpoint gate. **Checkpoint 5 is complete and
  closed.**

**Checkpoint 6 — Performance/concurrency validation at the 10,000-employee floor — COMPLETE,
2026-07-10, COMMITTED as `3298e34`**
- **A dedicated read-only architecture review preceded implementation** (this session), covering
  the rendering/virtualization/React Query/autosave architecture Checkpoints 0–5 already built, and
  producing five frozen decisions before any code was written: (1) keep the existing in-memory grid
  architecture (no server-side windowed fetching) since `LiveTotalsStore`, Copy to All, the
  multi-site filter, import/export, and the React Query cache all already assume the whole cycle is
  resident client-side — only optimize the fetch strategy within that model; (2) only replace
  `LiveTotalsStore`'s full-recomputation model with an incremental running total if measurement
  proves it is the bottleneck, never a server-aggregate/hybrid; (3) leave the `invalidateQueries`
  cache-invalidation strategy after Copy to All/import unchanged unless measurement proves
  otherwise; (4) concrete engineering targets (not hard SLAs) — initial load ≤2s target/≤3s
  acceptable, no visible typing lag, smooth scroll, Copy to All ≤2s, import/export correctness over
  speed, memory stabilizes after large operations, no lost updates under concurrency; (5) the
  Definition of Done's "review, release" phrase (`docs/IMPLEMENTATION_PLAN.md`'s own text above)
  predates the 2026-07-07 seven-checkpoint restructuring and is historical wording — Release does
  not exist yet (Phase 4) and Checkpoint 6 does not implement or validate it, noted here per that
  decision rather than silently reinterpreted. Concurrency methodology was deliberately kept
  consistent with the project's existing practice — the backend test suite (supertest) plus parallel
  `Promise.all` requests — no dedicated load-testing framework (k6/Locust/Artillery/JMeter).
- **New `backend/tests/payroll-entry-performance.test.ts`** — the first committed, repeatable
  performance/concurrency test at this scale (Checkpoint 1's own 3,000-employee bootstrap timing was
  an informal, uncommitted smoke test, never run at 10,000). Seeds a synthetic 10,000-employee,
  10-site cycle once (`beforeAll`, reused/progressively mutated across the file's own tests, never
  re-seeded per test) and measures: cycle bootstrap; a single page's `EXPLAIN ANALYZE` confirming
  Index Scan usage (not a sequential scan) both unfiltered and site-filtered; the original sequential
  page-to-completion fetch against the candidate parallelized alternative; a 50-way concurrent
  distinct-row edit burst (zero lost updates); a deliberately provoked same-row race (exactly one
  409, no lost update); Copy to All at 10,000-row scope; export; import. Assertions on the
  fetch-comparison test check **distinct entry IDs seen**, not the row count summed across pages — a
  weaker "count" assertion would not have caught the pagination bug below, since 50 pages of exactly
  200 rows always sums to 10,000 by construction even when pagination silently duplicates some rows
  and drops others.
- **A real, pre-existing correctness bug was found and fixed, not a performance one.** Every
  `PayrollEntry` created by `createPayrollCycle`'s bootstrap (Checkpoint 1, 2026-07-07) defaulted to
  `sortOrder = 0` — the function never assigned it, silently relying on the schema column default.
  Invisible at the small scale every prior checkpoint's manual/automated testing used; at the
  10,000-employee floor, `ORDER BY sortOrder ASC LIMIT/OFFSET` pagination over 10,000 rows tied on
  the same value is unstable (Postgres gives no tiebreaker guarantee) — confirmed at the raw SQL
  level to silently duplicate 23 rows across page boundaries while 23 different rows were never
  fetched at all, discovered via this checkpoint's own real-browser (Playwright) measurement pass,
  not by any existing test. **Fixed** in `payroll-processing.service.ts`: each bootstrapped entry now
  gets its own loop-index `sortOrder`, matching the convention `createPayrollEntry`'s single-entity
  path already used (`maxSortOrder + 1`). A dedicated regression test
  (`payroll-entry-performance.test.ts`) asserts the bootstrap produces exactly 10,000 distinct
  `sortOrder` values; re-verified via a real browser reload showing zero duplicate/missing rows.
- **Decision 1 applied, measurement-justified**: the measured sequential page-to-completion fetch
  (2.8s — roughly 94% of the 3s acceptable ceiling, before any client-side rendering cost is added)
  left too little headroom, justifying the approved fix. `usePayrollEntries`
  (`frontend/src/hooks/use-payroll-entries.ts`) now fetches page 1 alone to learn `total`, then the
  remaining pages in concurrency-capped (8-wide, the batch size measured in the backend suite)
  parallel batches, replacing the original one-page-at-a-time sequential loop. No change to the
  in-memory grid model, `LiveTotalsStore`, Copy to All, the site filter, or React Query's cache — per
  Decision 1's own scope boundary, this is a fetch-strategy change within the existing architecture,
  not a redesign of it.
- **Decision 2 — measured, deliberately NOT applied**: real-browser keystroke measurement showed
  47–52ms per real keystroke (well under any human typing cadence) and only one >50ms long task
  during an artificial rapid-fire stress test (15 keystrokes with zero delay, far faster than any
  human typist) — this did not meet the bar of "proves it is the bottleneck," so `LiveTotalsStore`'s
  full-recomputation model was left unchanged, exactly as Decision 2 specified. No server aggregate,
  no hybrid architecture.
- **Decision 3 — left unchanged**: `invalidateQueries` after Copy to All/import was not touched — no
  measurement showed it as an actual bottleneck worth a targeted-merge implementation.
- **Decision 4 targets — all measured and met**: initial load of a 10,000-row grid to a
  confirmed-complete state, 2.75s (real browser, post-fix); per-keystroke latency 47–52ms; zero long
  tasks across 20 scroll steps; Copy to All across 10,000 entries, 580ms; export 1.8–1.9s and import
  40–44s (10,000 rows, row-by-row per the already-approved architecture — correctness-first, no
  strict target, per Decision 4); memory 104MB → 95MB after scroll+editing (stabilized, no
  unbounded growth).
- **Verification**: `typecheck`/`lint`/`build` clean across all three workspaces (same 4
  pre-existing frontend warnings, none new). **9 new backend tests, full suite 184/184** (175 prior +
  9 new) against a freshly re-provisioned database. A real-stack Playwright regression pass against a
  freshly bootstrapped, correctly-`sortOrder`'d 10,000-row cycle: inline edit + autosave persistence
  verified for a row deep in the virtualized list (~row 5000, matched by employee identity, not
  position) surviving a full page reload; the multi-site filter narrowing the grid and totals to
  exactly one site's 1,000 employees; Copy to All confirmed (via direct database query, not just the
  UI toast) scoped to only the filtered site's 1,000 entries; the Split by Unit modal opening
  correctly; zero unexpected console errors throughout.
- **Explicitly out of scope, none introduced**: Release, Corrections, Balance Adjustments, Advances,
  and any Phase 4+ work — this checkpoint is validation and measurement-justified optimization of
  the existing Checkpoint 0–5 architecture only, per its own frozen scope.
- **Committed as `3298e34`** — implementation complete, independently verified end to end
  (typecheck/lint/build, 184/184 backend tests including the 9 new performance/concurrency tests, a
  real-browser regression pass), reviewed, and approved before commit, per this project's standing
  per-checkpoint gate. **Checkpoint 6 is complete and closed. Phase 3 is now fully complete and
  closed.**

**Builds:** `PayrollCycle` Draft creation (bootstrapping the very first cycle); `calcNet` as a pure,
well-tested function (Principle 5) that sums across an entry's `PayrollEntryWorkLine` rows — always
at least one, so there is one calculation path, not a split/non-split branch
(`database/payroll-entry.md` §12/§12a); the Payroll Entry grid backend (paginated/filterable
query keyed by `(cycleId, siteId)`, joined to each entry's work line(s)) and frontend (TanStack Table +
TanStack Virtual for the grid, inline-editable cells matching `docs/design-system.md`); the
**"Split by {unitLabel}"** action (labeled per the entry's site's own terminology) for the occasional
employee working across more than one Project Unit within a cycle, including the transactional
invariant that an entry can never be left with zero work lines; optimistic locking via `version` on
`PayrollEntry` (its work lines mutate under the same lock, they don't carry their own) with an
autosave pattern that surfaces a conflict rather than silently overwriting; the multi-select site
filter component; the "Copy to All" bulk-apply toolbar (applies to `PayrollEntry`-level fields; a
work line's `cycleDays`/`otRate` are copied per-line since they can legitimately differ by unit);
Payroll Entry CSV/Excel import/export (rejecting rows for already-released employees, per the original
spec, with a per-row skip report — built and shipped in Checkpoint 5; **superseded note**: the "one
row per work line" idea floated here was superseded by Checkpoint 5's approved "Option C" — the
format stays flat, one row per employee, representing only the primary work line, with the
occasional split employee's non-primary lines managed exclusively through the grid's Split by
{unitLabel} modal instead, per the frozen 2026-07-09 decision above).

**Depends on:** Phase 2 (Employee Registry, Sites) and **Phase 2.5** (Project Units, `Employee.unitId`
— `PayrollEntryWorkLine.unitId` cannot be built without it).

**Effort estimate:** 7–10 days — the largest single phase, and the one the original spec explicitly
flags as the most likely source of a real-world performance complaint if done naively.

**Testing strategy:**
- `calcNet` unit tests covering every edge case named in the spec and the schema doc: null
  `otRate`/`leaveRate` falling back to derived rates, `cycleDays` at its boundary values (1 and 31),
  zero `days`/`grossPay`, a fixed set of golden-output cases carried over from the prototype's sample
  data to catch any regression against the original formula, **and multi-line cases specifically**: an
  entry with 2–3 work lines across different units with different `cycleDays`/`otRate` values sums to
  the correct `netSalary`, and the single-line case is verified to produce byte-identical results to
  the pre-Phase-2.5 flat formula (no silent regression from the model change).
- Work-line invariant tests: a `PayrollEntry` is always created with exactly one line; a line can
  never be deleted if it would leave its parent with zero lines; a line's `unitId` must belong to the
  entry's own `siteId` (rejected at the database level if not); a new cycle's carry-forward always
  resets a continuing employee to one fresh line seeded from their *current* default unit, never
  inheriting the prior cycle's split structure.
- Concurrency test: two simulated concurrent edits to the same `PayrollEntry` — the second write must
  fail on stale `version`, not silently overwrite the first.
- Performance test with synthetic data at both today's realistic scale (~1,500 rows) **and Principle
  10's 10,000-employee design floor**: grid renders and scrolls without all rows mounting to the DOM
  at once at either scale; this is validated here, not deferred to Phase 9, because it's cheapest to
  fix while the grid is freshly built.
- Import/export tests mirroring Phase 2's, plus the "skip already-released rows, report the skip
  count" behavior specifically — built in Checkpoint 5. (A "multi-line-employee import/export round
  trip" was originally anticipated here; superseded by Checkpoint 5's approved Option C, which
  deliberately represents only a split entry's primary line in the file — see that checkpoint's
  as-built entry above.)

**Definition of Done:** a full synthetic Draft cycle at both ~1,500 and 10,000 employees can be
created, edited across multiple simulated concurrent sessions without data loss, filtered by site,
and bulk-edited via Copy to All — all within a response time that doesn't require the client to wait
more than a second or two per interaction on realistic hardware — and at least one employee in the
test dataset is split across multiple Project Units within one cycle, exercised end to end (entry,
review, release, net salary) without special-case handling anywhere in the flow. **Revision note,
2026-07-10 (Checkpoint 6 decision 5):** the "review, release" clause above predates the 2026-07-07
seven-checkpoint restructuring and describes the original, pre-split Phase 3 scope — Release does
not exist yet (Phase 4) and Checkpoint 6 does not implement or validate it. Every other clause
(10,000-employee floor, concurrent-session editing without data loss, site filtering, Copy to All,
response-time targets, multi-unit split handling) was validated by Checkpoint 6 as written.
Confirmed correct rather than silently reinterpreted.

**🛑 Review checkpoint — PASSED, 2026-07-10.** Phase 3 (Checkpoints 0–6) is now fully complete and
closed. This is the single source of truth for the entire system (Principle 1) — everything in
Phases 4–7 reads from what this phase produces. `calcNet` correctness (including the multi-line
case) and the locking/autosave behavior are verified, including at the 10,000-employee design floor
(Checkpoint 6) — Phase 3.5 (Tasks Workspace) followed and is itself now complete and closed (see its
own section below); Phase 4 (Release, Payment Artifacts, and Advances) follows it, unchanged from its
own already-frozen scope below.

---

### Phase 3.5 — Tasks Workspace

**COMPLETE, 2026-07-10 — COMMITTED as `1220dce`.** Inserted between Phase 3 and Phase 4 following the
exact precedent Phase 2.5 already set: a genuine, self-contained piece of work that needs its own
gated checkpoints between two numbered phases, without being smuggled into either one's own scope.
Phase 4 begins exactly as previously planned now that this phase has closed — nothing about Phase 4's
own frozen architecture changed.

Delivered across three gated checkpoints, each independently reviewed and approved before the next
began: **Checkpoint 0** (2026-07-10, documentation-only — the architecture revision itself: Chat
removal, this phase's insertion, the HTML-prototype Definition-of-Done rule, committed as `0fb296e`);
**Checkpoint 1** (Database Foundation + Shared Contracts — `TaskPriority`/`TaskStatus`/
`TaskNotificationType` enums, `Task`/`TaskNotification` models via migration `20260710150000_tasks`,
the `User` reverse relations, `shared/src/schemas/task.ts`, `PERMISSIONS.TASKS_MANAGE`); **Checkpoint
2** (Backend Services, Routes & Notifications — the full `backend/src/modules/tasks/` service/route
layer); **Checkpoint 3** (Frontend, HTML Prototype & Testing — `frontend/src/components/tasks/`, 24
new backend tests, an 18/18 real-stack Playwright pass, and
`docs/prototypes/phase3.5-tasks-workspace-preview.html`). Checkpoints 1–3's implementation is a single
commit, `1220dce` — see `docs/PROJECT_PROGRESS.md` §1's "Phase 3.5" entry for the full as-built record
of each checkpoint, including two real defects Checkpoint 3's own Playwright pass found and fixed
before anything shipped.

**Permanently supersedes** the "Team Collaboration panel (Chat/To-Do)" concept previously planned for
Phase 8 (`reference/PROJECT_SPEC.md`; `reference/payroll_prototype.html`'s Team Panel — both frozen,
unedited historical reference; this document is the current authority). Chat is not deferred, it is
**permanently removed** — there will never be chat, messaging, comments, discussion threads,
attachments, subtasks, a Kanban view, or recurring tasks anywhere in this feature. The right-side
slide-out panel (`docs/design-system.md`'s `.team-panel`) becomes a Tasks Workspace only, deliberately
kept this lightweight.

**Builds:** `Task` and `TaskNotification` (`database/tasks.md` §27–§27a); the `tasks:manage`
permission (Master-User-only — create, assign, reassign, edit title/description/priority/due date,
delete, cancel, reopen; an assignee needs no permission beyond authentication to view their own tasks
and mark them complete); ownership-based visibility — Master User sees every task, the assignee sees
only their own, no one else can see or query it (an explicit exception to this system's role/site RBAC
shape, `docs/architecture/authentication.md` — not a variant of site-scoping, and site-scoping must
never be added to this table); the three-status lifecycle (`TO_DO` → `COMPLETED`/`CANCELLED`,
deliberately no `IN_PROGRESS`); three priorities (Low/Medium/High); an optional due date, no
recurrence; persisted notifications for exactly three events (assigned, reassigned, completed) with
due-today/overdue computed live, never stored, delivered via ordinary polling (no WebSockets/SSE);
sorting by Due Date, Priority, or Recently Assigned; the repurposed right-side panel UI (task list,
notification badge, filters, a Create Task dialog, a reassignment action, one-click mark-complete).

**Depends on:** nothing structurally new — Authentication/RBAC (Phase 1) and the `User` table are the
only prerequisites, both already built. Genuinely orthogonal to Phase 4's Release/Bank Sheets/Advances
work — no schema or service-layer dependency in either direction.

**Effort estimate:** small — comparable to or smaller than any single Phase 2.5 checkpoint; one table
pair, a handful of routes, one panel.

**Testing strategy:** RBAC boundary tests are the priority here, mirroring the C11 pattern already
established for site-scoping (`docs/architecture/authentication.md`) but for ownership instead — a
user who is neither Master User nor the assignee must be unable to view, list, or mutate a task via
any route, including a direct API call with a manipulated task id; an assignee must be rejected
attempting any field edit beyond marking their own task complete; notification rows must be created
for exactly the three defined events and no others; due-today/overdue must be confirmed as live
computation (never a stored, staleness-prone value) by asserting the result changes correctly when the
system clock crosses the due date in a test, not just at creation time.

**Definition of Done — met:** Master User can create a task, assign it, see it appear (with a
notification) in the assignee's own panel, and the assignee can mark it complete (notifying Master
User back) — all while a third user, of any role, is independently proven (both by a backend
ownership-boundary test and by the real-stack Playwright pass) unable to see or query that task
exists. Verified: `typecheck`/`lint`/`build` clean across all three workspaces; **208/208 backend
tests** (184 prior + 24 new); **18/18 real-stack Playwright checks**, zero console errors; `prisma
validate`/migration-drift confirmed clean.

**🛑 Review checkpoint — PASSED, 2026-07-10.** Phase 3.5 is now fully complete and closed. Phase 4
(Release, Payment Artifacts, and Advances) may now begin, pending its own explicit authorization —
its architecture remains frozen and unchanged from the 2026-07-05 Phase 3 Architecture Review.

---

### Phase 4 — Release, Payment Artifacts, and Advances

**Confirmed 2026-07-11 (read-only architecture review, no code) — Employee Statements is not, and
was never, part of this phase's scope.** Checkpoints 1–3 (Bank Registry, Salary Release foundation,
Bank Sheets) are complete and committed. Employee Statements was raised as a candidate next
checkpoint and reviewed against the actual repository state: a complete Statement of Account depends
on `Correction`/`BalanceAdjustment`/`CorrectionPayment` (Phase 6, not started) and `Advance` (this
phase's own not-yet-built sub-scope), none of which exist yet — building it now would produce a
structurally incomplete ledger. It remains Phase 7 scope, exactly as this document already specified
below; this note only records that the question was explicitly settled, not a change to the plan.

**Checkpoint 4 — Cash Receiving Sheets — COMPLETE, 2026-07-11, COMMITTED as `477fbb1`.** A dedicated
module, separate from Bank Sheets, sourced from released/non-held `PayrollEntry` rows with `bankId
IS NULL` (Bank Sheets' own already-shipped rule, reused unchanged — `accountNumber` deliberately not
introduced into the classification). Reuses the existing `bank-sheets:view` permission rather than a
new one — Finance and Master User see both documents, Payroll Staff neither. CSV/XLSX export only
(no PDF library added); export-only audit logging (`cash_receiving_sheet.export`). Simplified
document layout (Serial No., Employee Code, Employee Name, CNIC, Designation, Site, Net Salary,
Signature / Thumb Impression, Remarks, with a Company/Cycle/Generated-By/Generated-On header and a
Total Employees/Total Cash Amount footer) — deliberately not the original historical prototype's
full attendance/OT/allowance/deduction breakdown. Full record: `docs/PROJECT_PROGRESS.md` §1's
"Phase 4, Checkpoint 4" entry.

**Checkpoint 5 — Advances — COMPLETE, 2026-07-11, COMMITTED as `75c5e64`.** Adds `Advance`,
`ScheduledPayrollPeriod` (owned by Payroll Processing, referenced only by Advances — never written
to directly), and the append-only `AdvanceScheduleChange` history, plus `PayrollEntry.advanceId`/
`.eidAdvanceId`, closing the deferral this document has carried since Phase 3 Checkpoint 0. At most
one `ACTIVE` Advance per employee per type (the assumption `database/schema-invariants.md` had
flagged "not yet confirmed — revisit before Phase 4" is now confirmed and enforced, application layer
plus a partial unique index). Automatic deduction materialization at new-cycle creation is a **direct
call** from `payroll-processing.service.ts` into `advances.service.ts` — **deliberately not** the
fuller generic Outstanding-Payroll-Obligation provider/hook registry `docs/architecture/workflows/
outstanding-obligations.md` describes as a future possibility; that generalization is deferred until
Phase 6 (Balance Adjustments) becomes a genuine second consumer, per this checkpoint's own approved
architecture decision. `Advance.scheduledInstallmentAmount` (additive beyond `database/advances.md`
§15's original column list, but already proposed by name earlier in this document — see the historical
note a few paragraphs below) is what lets an `INSTALLMENT` advance's per-cycle deduction repeat
forward automatically without the system ever computing the amount itself. No new permission —
`advances:manage` already existed (seeded since Phase 1) and was already granted to Payroll Staff;
Finance receives none, unchanged. Cash Advances, Advance-only Bank Sheets, and Company Bank Account
management remain explicitly out of scope. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 4,
Checkpoint 5" entry. **Phase 4's remaining scope is Payslip generation** — the last item before this
phase's own 🛑 review checkpoint.

**Post-Phase-4 refinement (2026-07-11) — explicitly NOT Checkpoint 6, not Payslips, not Company
Bank Account.** Employee/PayrollEntry `accountTitle` removed entirely (clean, destructive migration
— this project's second, `database/schema-invariants.md` §25); `iban` added to both (optional,
trimmed, stored uppercase); a new banking invariant (bank employee requires Account Number; cash
employee has neither); Bank Sheet's "Title of Account" column (still required by the frozen
`reference/PROJECT_SPEC.md` format) now derives from the entry's employee name instead of a stored
field; permanent Layout Integrity Rule for business-critical identifiers. Full record:
`docs/PROJECT_PROGRESS.md` §1's "Post-Phase-4 refinement" entry. Implemented, not yet committed.

**Rejected on review, 2026-07-12 — the Layout Integrity Rule was not actually satisfied.** Root
cause: Payroll Entry's Bank `<select>` showed only `bank.code`, never the full `bank.name`, and
`ReadOnlyCell` was silently ellipsis-clipping Employee Code — no column width could have fixed
either. Fixed, and this time verified with a real, in-session-provisioned headless browser (Live
DOM measurements: `scrollWidth`/`clientWidth` parity, zero overflow, for Bank/Account Number/IBAN
in Payroll Entry, Employee Registry, and Bank Sheet). Full record: `docs/PROJECT_PROGRESS.md` §1's
dated correction under the same entry. Still not committed.

**Revised 2026-07-05 (Phase 3 architecture review) — release moves to Project Unit granularity.**
The plan text below (originally "per-employee release, bulk Release All/Hold All scoped by site") is
superseded by the frozen design in `docs/architecture/workflows/payroll-lifecycle.md` §4 and
`database/release.md` §12b — release is no longer a Site-scoped bulk action, it's an
independent per-Project-Unit action executed by the new **Finance** role
(`docs/architecture/authentication.md`), not by Payroll Staff.

**Builds:** Release Salary — now: `PayrollUnitRelease` (Finance releases one Project Unit at a time,
per cycle, immediately or waiting for client funding; this sweeps every non-held `PayrollEntry` whose
*every* touched Unit has now released, preserving one entry/one net salary/one Bank Sheet row even
for a multi-unit split employee — Principle 1, 6); `PayrollUnitReadiness` (Payroll Staff's/Master
User's own non-gating "Ready for Release" signal to Finance — informational only, never required
before Finance can release); the Late Entry one-off release path (`PayrollEntry.lateReason`, for an
entry created after its Unit already released this cycle — mandatory reason, its own one-off Bank/
Cash document, never reopens the already-released Unit); the corrected C1/C2 behavior (`hold` never
gates editability, and freezes only once `released = true`, unchanged by the granularity change).
Bank Sheets and Cash Receiving Sheets (derived, read-only, filtered by bank/site, PDF via Puppeteer
and Excel via ExcelJS, matching the client's exact historical formats, disbursed from Broom Services'
own Company Bank Account(s) — see the design note added 2026-07-02 below) — **now generated per Unit-
release event, not only per whole-Cycle release**, since different Units can release on different
days; Payslip generation (PDF).

**Advances module, explicitly expanded 2026-07-02** (terms below map to the existing `Advance`
model in `database/advances.md` §15 except where flagged as new or open):

- **Advance Requests** — recording a new `LOAN` or `EID_ADVANCE` (matches the existing spec's
  "Record Advance" action, done directly by Payroll Staff per `reference/PROJECT_SPEC.md`'s role
  description; a formal request/approval workflow, if wanted, is new scope and not yet confirmed).
- **Outstanding Balances** — `Advance.outstandingBalance`, already fully spec'd (§15); no change.
- **Installments / Deferred Deductions + Automatic Payroll Recovery — clarified 2026-07-02
  (RESOLVED).** Payroll Staff defines — and can edit at any time — a repayment schedule for an
  `INSTALLMENT`-type advance: specifically, the per-cycle deduction amount. "Automatic Payroll
  Recovery" means the system automatically *applies* that already-approved schedule going forward —
  it does **not** mean the system calculates or decides the amount. Concretely: at each new-cycle
  `PayrollEntry` creation (the existing cycle-turnover transaction, Phase 5), the linked `ACTIVE`
  advance's scheduled amount auto-populates that cycle's `advanceDeduction`/`.eidAdvanceDeduction`
  field, and `outstandingBalance` decrements accordingly — the field remains staff-editable
  afterward in Draft, like any other Payroll Entry field, if a one-off change is needed without
  altering the standing schedule. Editing the schedule itself is a distinct, audit-logged action.
  This stays fully compatible with `reference/PROJECT_SPEC.md`'s "verified multiple times" rule
  ("do not build auto-deduction *logic*... just preserve the balance-tracking display") — no value
  is ever computed by the system, only repeated forward until staff changes it — while removing the
  need to retype the same amount every month by hand.
  **Proposed schema addition for Phase 4** (not yet implemented): `Advance.scheduledInstallmentAmount`
  (numeric, nullable — null means no standing schedule, e.g. a one-off full-deduction advance).
- **Advance Deduction Deferral — added 2026-07-08, pre-Phase-3-Checkpoint-2 architecture amendment
  (frozen, not yet implemented).** Before an entry is released, Payroll Staff (site-scoped) or Master
  User may defer that entry's scheduled deduction to any future Draft payroll cycle — not limited to
  "next" or "one after next" — frozen as BR-ADV-001 through BR-ADV-006
  (`database/advances.md` §15). This phase's schema work adds, alongside the `Advance`
  migration already planned above:
  - **`ScheduledPayrollPeriod`** (`database/payroll-cycle.md` §10a) — the canonical, single representation of
    a calendar payroll period that may not yet have a materialized `PayrollCycle`; resolved exactly
    once, by Payroll Processing's cycle-bootstrap, when the matching cycle is eventually created.
    **Owned exclusively by Payroll Processing, not Advances** (§10a's ownership boundary, added
    2026-07-09): Advances (and any future Outstanding Payroll Obligation provider) may only reference
    this table via foreign key — the deferral action's find-or-create call goes through Payroll
    Processing's own exposed function, never a direct write from Advances' own code.
  - **`Advance.originalScheduledPeriodId`** (immutable, set once — BR-ADV-001) and
    **`.currentScheduledPeriodId`** (the live, single pointer a deferral moves — BR-ADV-005), both FK
    → `ScheduledPayrollPeriod`.
  - **`AdvanceScheduleChange`** (`database/advances.md` §15a) — append-only (no updates, no deletes,
    only inserts, same convention as `EmployeeTransferHistory`/`BalanceAdjustmentSettlement`) history
    of every deferral: mandatory reason, deferred-by/deferred-at, and the from/to
    `ScheduledPayrollPeriod` (BR-ADV-004).
  - The deferral action itself: zero the entry's `advanceDeduction`/`advanceId` (or eid- equivalent),
    move `Advance.currentScheduledPeriodId`, insert the `AdvanceScheduleChange` row, all in one
    transaction with the `advance.deferred`/`payroll_entry.advance_deferred` `AuditLog` entries. Reuses
    Payroll Entry's existing edit permission and site-scoping — no new permission. Target must be
    strictly future (BR-ADV-006); enforced at the application layer, not a database check constraint,
    since expressing it as one would require denormalizing `(year, month)` back onto
    `AdvanceScheduleChange`, defeating the point of `ScheduledPayrollPeriod` — see §15a's note.
  - **A second, distinct audit event — `advance.schedule_materialized`** — is written later, separately,
    the moment this (possibly several-times-deferred) schedule finally lands in a real `PayrollEntry`
    (Phase 5's cycle bootstrap, below), completing the auditable chain: Advance created → deferred →
    deferred again (optional) → schedule materialized → fully recovered (`database/advances.md` §15).
  - **Advances becomes this phase's first registered Outstanding Payroll Obligation provider**
    (`docs/architecture/workflows/outstanding-obligations.md`, `docs/architecture/overview.md` Extensibility): its
    carry-forward predicate (an `ACTIVE` advance whose schedule resolves to the new cycle) and Payroll
    Materialization Hook (materializing that cycle's deduction and writing
    `advance.schedule_materialized`) plug into Payroll Processing's generic cycle-bootstrap seam —
    Phase 5 below is where that seam itself is built, since it's part of the new-cycle-creation
    transaction, not this phase's own work. Like every registered provider, it must be independent of
    and never assume any ordering relative to other providers (e.g. Balance Adjustments).
- **Cash Advances** — advance disbursement to an employee with no bank account on file, parallel to
  the existing Cash Receiving Sheet concept for salary. **New scope**: the current `Advance` model
  tracks a balance but not a disbursement *event* or its payment method (cash vs. bank), so this
  needs its own design pass during Phase 4, not assumed here.
- **Advance-only Bank Sheets** — a dedicated bank-sheet-style document for disbursing a *new*
  advance amount via bank transfer, separate from the existing salary Bank Sheet. **New artifact
  type**, not in the current spec; needs its own design pass during Phase 4 (including which Company
  Bank Account funds it — see the design note below).

**Company Bank Account design note (added 2026-07-02, pending user approval — not yet implemented):**
Broom Services owns multiple bank accounts used as the *source* of salary/advance disbursements,
separate from `Employee.bankId` (an employee's own receiving account) and never attached to
`ProjectSite` (confirmed 2026-07-02 — see `database/sites-and-units.md` §8's revision
note). A `CompanyBankAccount` lookup table is proposed for Phase 4 schema work: `id`, `bankId` (FK →
`Bank`), `accountNumber`, `accountTitle`, a human-readable `label`, `branchCode`, `isActive`,
`isDefault`. Two open sub-questions need an answer before this is finalized: (1) is disbursement
same-bank-only (a Broom Services HBL account pays HBL-held employees), or can any company account
fund any employee via manual selection at Release time; (2) is the source account recorded per
`PayrollEntry`/per-release (fine-grained, supports mixed sourcing within one cycle) or per Bank
Sheet generation event (coarser)? See `docs/PROJECT_PROGRESS.md` §3 item 7.

**Depends on:** Phase 3 (Payroll Entry must exist and be reliable before anything derives from it).

**Effort estimate:** 5–7 days.

**Testing strategy:**
- State-machine tests: an employee cannot be released while `hold = true`; toggling hold has no
  effect on field editability; once released, every field including `hold` is verified immutable
  (application layer, plus a direct-write test against the recommended DB trigger).
- **Added 2026-07-05 — per-Unit release tests:** a Unit's release sweeps and releases every non-held
  entry whose *every* touched Unit is now released, and leaves a multi-unit entry unreleased while
  even one of its touched Units is still pending; RBAC test that only Finance (or Master User) can
  execute a Unit's release, site-scoped identically to Payroll Staff's own scoping, including the
  manipulated-`unitId`/`siteId` direct-API-call boundary case (mirroring the C11 pattern already
  established for Employee Registry); `PayrollUnitReadiness` test that marking/un-marking Ready has
  **zero** effect on whether a release can proceed; Late Entry test — an entry created after its Unit
  already released requires its own one-off release with a mandatory `lateReason`, generates its own
  single-row Bank/Cash document, and never reopens the already-released Unit's other entries; a Late
  Entry left unreleased and non-held is confirmed to still block Cycle finalization exactly like any
  other straggler (Phase 5).
- Bank Sheet/Cash Receiving derivation tests: only released, non-held, correctly-bank/no-bank
  employees appear; totals match the sum of underlying `PayrollEntry.netSalary` values exactly
  (Principle 6) — a golden-file comparison against a hand-computed expected sheet for a fixed test
  dataset. **Added 2026-07-05:** a Bank Sheet generated at one Unit's release event contains only that
  Unit's newly-released entries, not the whole cycle's.
- PDF/Excel output tests: generated documents match the client's real formats (payslip, bank sheet,
  cash sheet) closely enough to be usable as-is — this one benefits from an actual client review pass,
  not just automated snapshot testing.
- Advance auto-linking test: a new deduction links to the correct `ACTIVE` advance; attempting to
  create a second `ACTIVE` advance of the same type for one employee is rejected by the partial unique
  index.
- **Added 2026-07-08 — Advance Deduction Deferral tests (BR-ADV-001–006):** `originalScheduledPeriodId`
  never changes across multiple deferrals of the same advance; `currentScheduledPeriodId` is always
  exactly one value, overwritten (not appended) by each deferral; deferring to a past or current-cycle
  target is rejected; deferring an already-released entry is rejected; a blank/whitespace-only reason
  is rejected; deferring zeroes the source entry's `advanceDeduction`/`advanceId` (or eid- equivalent)
  and bumps its `version`. **Concurrency:** two deferrals targeting the same future month, submitted at
  the same time (possibly for different advances), must resolve to exactly one shared
  `ScheduledPayrollPeriod` row, never two. **Resolution:** creating the `PayrollCycle` for a pending
  period's `(year, month)` sets `payrollCycleId`/`resolvedAt` exactly once and cannot be set a second
  time even by a direct write, and its `year`/`month` are confirmed immutable across that same write.
  **Append-only test:** a direct `UPDATE` or `DELETE` against `AdvanceScheduleChange` at the service
  layer has no code path to reach — verified the same way this project already verifies
  `EmployeeTransferHistory`'s append-only convention.

**Definition of Done:** a full release cycle — a Finance user releases one Project Unit, generates its
Bank Sheet and Cash Receiving Sheet as PDF and Excel, generates a payslip for a released employee —
can be performed end to end and the client (or someone standing in for them) confirms the documents
are usable as-is. **Added 2026-07-05:** also demonstrated end to end — a multi-unit split employee's
entry stays unreleased until every touched Unit has released; a Late Entry added to an already-
released Unit is released via its own one-off action with a mandatory reason and its own document.

---

### Phase 5 — Cycle Finalization, Archiving, and Backups

**Builds:** the explicit "Finalize Cycle" action with its no-override precondition
(`docs/architecture/workflows/payroll-lifecycle.md` §4); the new-cycle-creation transaction — archive the outgoing
cycle, generate its backup package, resolve any `ScheduledPayrollPeriod` matching the new cycle
(`database/payroll-cycle.md` §10a, **added 2026-07-08**), create the new Draft's
`PayrollEntry` rows for every active employee plus every employee selected by a registered
**Outstanding Payroll Obligation** provider's carry-forward predicate, then invoke every registered
provider's **Payroll Materialization Hook** — each invoked independent of the others, with no assumed
order between providers — (**generalized 2026-07-08** from this bullet's original,
Balance-Adjustment-specific wording — see `docs/architecture/workflows/outstanding-obligations.md` and
`docs/architecture/overview.md` Extensibility; today's two providers are Balance Adjustments and, once
Phase 4 exists, Advances, whose hook writes `advance.schedule_materialized`) — the Backup Package
generator (Payroll/Bank Sheets/Receivings CSV +
`metadata.json`, versioned, written through `StorageProvider`); the Payroll Cycle Selector (browse any
historical cycle, always reading PostgreSQL, never a backup file).

**Depends on:** Phase 4 (Release must exist for the finalization precondition to be meaningful).

**Effort estimate:** 4–6 days.

**Testing strategy:**
- Finalization precondition test: blocked while any non-held entry is unreleased; **explicitly test
  that no code path — including a direct API call as Master User — can override this**, since the
  decision was "no override," not "override requires extra permission."
- New-cycle-creation transaction test: verifies the all-or-nothing behavior (archive + backup +
  new-cycle creation succeed together or not at all); a deliberately-departed employee with a
  `PENDING` Balance Adjustment is confirmed to receive a new `PayrollEntry` in the next cycle, flagged
  as a Final Settlement. **Added 2026-07-08 — generalized Outstanding Payroll Obligation test:** a
  deliberately-departed employee is separately confirmed to receive a new `PayrollEntry` via the
  Advances provider alone (a scheduled deduction resolving to the new cycle, no `BalanceAdjustment`
  present), proving the two providers are evaluated independently, not a single hardcoded combined
  check; a pending, not-yet-resolved `ScheduledPayrollPeriod` is confirmed to resolve
  (`payrollCycleId`/`resolvedAt` set exactly once) the moment its target month's cycle is created, and
  its `year`/`month` are confirmed unchanged before and after resolution. **Order-independence test:**
  running the registered providers in a shuffled/reversed order produces an identical set of
  carried-forward employees and identical entry contents — bootstrap's result must not depend on
  registration order. **Materialization audit test:** the moment a deferred advance's target cycle is
  created, exactly one `advance.schedule_materialized` entry is written (distinct from any
  `advance.deferred` entries already on record for that advance), completing the auditable chain
  end to end. **Deletion-prevention test:** a direct attempt to delete a `ScheduledPayrollPeriod` still
  referenced by an `Advance` or `AdvanceScheduleChange` row is rejected at the database level, whether
  or not its `PayrollCycle` has since archived.
- Backup package test: generated CSVs match what the in-app Bank Sheet/Cash Sheet showed at the moment
  of archiving, byte-for-byte on the figures; regenerating a backup for an already-archived cycle
  (triggered by a later correction, tested together with Phase 6) increments `Backup Version` rather
  than overwriting.
- Cycle Selector test: viewing a historical cycle never touches the `StorageProvider` — verified by
  asserting no storage read occurs during a historical-view request.

**Definition of Done:** a full month-end cycle turnover — finalize, auto-archive, auto-backup, new
Draft created — can be run against a realistic dataset, and the resulting Archived cycle's data is
byte-identical to what the app showed immediately before archiving.

**🛑 Review checkpoint.** Stop here before Corrections. Once Phase 6 is built, Archived cycles will
start receiving live corrections against real historical data — the archiving/backup mechanics need
to be trusted first.

---

### Phase 6 — Corrections & Balance Adjustments (highest-risk logic)

**Revised 2026-07-05 (Phase 3 architecture review):** the request/approval split, immediate/deferred
`PAYABLE` timing, and installment `RECOVERY` settlement below all supersede the plan text's original,
simpler single-shot model — see `docs/architecture/workflows/corrections-and-balance-adjustments.md` and
`database/corrections.md` §13a and `database/balance-adjustments.md` §14/§14a/§14b for the frozen design this phase now
implements against.

**Builds:** the Correction workflow (before/after preview, mandatory reason + standardized Adjustment
Type); **`CorrectionRequest`** (new) — any authorized payroll user may propose a correction, which
sits `PENDING` until a Master User approves (producing a `Correction`) or rejects it (mandatory
rejection reason, no `Correction` created); a Master User may still correct directly, bypassing the
request entirely, with no separate approval step, exactly as before this revision. The
**baseline-reconstruction/replay algorithm** (`docs/architecture/workflows/corrections-and-balance-adjustments.md`) exactly
as specified — this is the most implementation-sensitive piece of logic in the entire system,
unaffected by the request/approval split (it always operates on the resulting `Correction`, regardless
of which path produced it); the Balance Adjustment automatic settlement pipeline, including the
`NONE`-type zero-difference case, now branching by `type`: a `PAYABLE` settles `IMMEDIATE`ly (folded
into an already-open `PayrollEntry`, else a standalone `CorrectionPayment` with its own one-off
document) or stays `DEFERRED` (unchanged single-shot next-Draft-cycle behavior); a `RECOVERY` may
settle across one or more future cycles as an installment (`recoveryInstallmentAmount`/
`remainingAmount`, staff-editable like `Advance.scheduledInstallmentAmount`), each cycle's partial
application logged as a `BalanceAdjustmentSettlement` row; the Advance-reconciliation transaction
triggered by a correction to a deduction field (unaffected by the timing/installment changes — it's a
one-time delta applied at approval, orthogonal to how the resulting salary-level balance settles); the
merged-payment representation in Bank Sheets/Cash Receiving Sheets (one row, combined amount, for
`DEFERRED`/`RECOVERY` settlements merging into an ordinary release) with the breakdown surfaced
separately on Payslips and the Statement of Account groundwork (full Statement itself is Phase 7).

**Depends on:** Phases 3–5 (Payroll Entry, Release, and Archiving must all be solid — this phase
operates entirely on data those phases produce and lock).

**Effort estimate:** 6–9 days — small in table count, large in correctness surface area.

**Testing strategy (the most important test suite in the project):**
- **Sequential-correction tests are mandatory and exhaustive**: two corrections to *different* fields
  on the same entry must produce a second `BalanceAdjustment` that correctly reflects the first
  correction's already-approved effect; two corrections to the *same* field must show the second
  approver the post-first-correction value as "old," not the stale original; cumulative balance
  adjustments across N corrections must sum to exactly the true total difference from the originally
  released figures. These should be property-style tests generating random correction sequences and
  asserting the invariant holds, not just a couple of hand-picked examples.
- Zero-diff correction test: creates a `NONE`-type, already-`SETTLED`, zero-amount row; never appears
  in any pending-balance query or payment artifact.
- Advance-reconciliation test: correcting a deduction field adjusts the *linked* advance's balance
  (via the stored FK, not "whichever is currently active"), including the scenario where the
  originally-linked advance has since been paid off and superseded by a new one of the same type —
  this is the specific bug the explicit FK linkage was added to prevent, and must be tested directly.
- Settlement-merge test: a settling `PENDING` adjustment plus an ordinary net salary in the same
  release produces exactly one Bank Sheet row with the correctly combined amount — never two rows.
- Archived-cycle correction test: a correction against a cycle archived months earlier succeeds,
  triggers a new `BackupPackage` version for that cycle (tying back to Phase 5), and never touches the
  archived `PayrollEntry` row itself.
- **Added 2026-07-05 — Correction Request tests:** a non-Master-User request sits `PENDING` and is
  invisible as a `Correction` until reviewed; approval creates exactly one `Correction` +
  `BalanceAdjustment`, linked back via `resultingCorrectionId`; rejection requires a mandatory reason
  and creates neither; a Master User correcting directly bypasses the request table entirely with
  identical downstream results.
- **Added 2026-07-05 — immediate/deferred `PAYABLE` tests:** `IMMEDIATE` with an existing open entry
  folds in and settles without waiting for any future release; `IMMEDIATE` with no open entry creates
  a `CorrectionPayment`, settles the `BalanceAdjustment` outside any cycle, and never touches a
  released `PayrollEntry`; `DEFERRED` reproduces the original single-shot next-Draft-cycle behavior
  byte-for-byte, including when the employee happens to have another entry open sooner (deferred must
  still wait for the *next* cycle, not the sooner one).
- **Added 2026-07-05 — installment `RECOVERY` tests:** a `NULL` `recoveryInstallmentAmount` recovers
  the full balance in one cycle (regression-tested against the pre-revision single-shot behavior); a
  set installment amount spreads recovery across exactly as many cycles as needed, each logging its
  own `BalanceAdjustmentSettlement` row, with `remainingAmount` decrementing correctly and `status`
  flipping to `SETTLED` only when it reaches zero; a held cycle skips that cycle's installment without
  writing a settlement row and correctly resumes the next Draft cycle; editing the installment amount
  mid-recovery is itself a distinct, audited action.

**Definition of Done:** the property-style sequential-correction test suite passes consistently
across many randomized runs (not just fixed examples); a full walkthrough — release a cycle, archive
it, submit two corrections against the same historical entry weeks apart, confirm the resulting
balance settles correctly and automatically in a future cycle's release — is demonstrable end to end.
**Added 2026-07-05:** also demonstrated end to end — a Correction Request submitted by Payroll Staff
and approved by a Master User; an `IMMEDIATE` `PAYABLE` settling via a standalone `CorrectionPayment`;
a `RECOVERY` spread across three future cycles via installments, each showing correctly on the
Statement of Account.

**🛑 Review checkpoint.** Stop here for explicit sign-off. This phase is where a subtle bug would be
both easiest to introduce and most expensive to discover late (a wrong balance amount is a real
financial error, not a cosmetic one).

---

### Phase 7 — Statements, Reports, Dashboard

**Confirmed 2026-07-11 (read-only architecture review, no code) — reaffirmed unchanged, plus one new
note.** A Phase 4 review considered building Employee Statements early and confirmed it must wait for
this phase (see Phase 4's own note, above) — no change to this phase's scope or dependency resulted.
**New architectural note recorded this review**: Reports should reuse Statements' ledger-computation/
aggregation code once both are built here, rather than each independently re-deriving the same
per-employee/per-cycle figures from `PayrollEntry`/`Correction`/`BalanceAdjustment`/`Advance` — see
also `docs/architecture/overview.md`'s Major Modules table.

**Builds:** Statement of Account (per-employee, cross-cycle ledger, showing the replayed/corrected
current state, running balance, corrections and balance adjustments as distinct highlighted entries);
Fines & EOBI Report (multi-select site filter, four panels) — **reusing Statements' own ledger-
computation/aggregation code rather than a second, independent implementation**; Dashboard (summary
stats, per-site payroll summary, release progress, deduction breakdown, short-TTL caching).

**Depends on:** Phase 6 (Statements must correctly reflect corrections/balance adjustments, which
don't exist until Phase 6 is built).

**Effort estimate:** 4–6 days — lower implementation risk than Phases 3/6, but real correctness
dependency on everything before it, since these are pure aggregations with no data of their own.

**Testing strategy:**
- Statement running-balance test against a fixture with multiple cycles, a correction, and a settled
  balance adjustment — the running balance must reconcile to the same total the underlying
  `PayrollEntry`/`BalanceAdjustment` records imply.
- Report/Dashboard aggregate tests exclude departed employees from "current" counts unless they have a
  Final Settlement in progress.
- Cache invalidation test: a Dashboard figure updates within the cache's TTL window after the
  underlying data changes — not indefinitely stale.

**Definition of Done:** an employee with at least one correction and one settled balance adjustment
across two cycles shows a Statement of Account that a non-technical reviewer can follow and that
reconciles to the penny against the underlying records.

---

### Phase 8 — Supporting Features

**Builds:** Audit Log viewer UI (chronological feed, filterable); remaining import/export polish and
edge-case handling identified during earlier phases' testing. **Revised 2026-07-10: the Team
Collaboration panel (Chat/To-Do) no longer belongs here** — it moved to the new Phase 3.5 as the
Tasks Workspace, with Chat permanently removed rather than deferred (see Phase 3.5, above). Phase 8's
name is left unchanged for now rather than renamed to something Audit-Log-specific; it may still gain
other genuinely low-priority odds and ends before Phase 9, and can be revisited if it ever becomes
misleading.

**Depends on:** nothing structurally new — everything it touches already exists by Phase 7. Scheduled
last because the spec explicitly deprioritizes it.

**Effort estimate:** 2–4 days.

**Testing strategy:** Standard component/integration tests; lower bar than earlier phases is
acceptable here given the spec's own prioritization, but audit log viewing must still be verified
against the real `AuditLog` data generated by earlier phases' tests, not fixture-only data.

**Definition of Done:** Master User can browse the audit trail generated by every prior phase's
testing and recognize a coherent, readable history of the test scenarios that were run.

---

### Phase 9 — Hardening, Security Review, and Deployment

**Builds:** the full Playwright end-to-end suite across the complete lifecycle (create cycle → enter
payroll → release → generate sheets → finalize → archive → correct → settle → new cycle); a dedicated
security pass (RBAC boundary re-verification across every route, CSRF re-verification, session
handling); performance validation under realistic data volume; production environment setup on Render
(managed Postgres with PITR, web service, static site, staging separation, Sentry wired into both
services); a documented rollback plan; client User Acceptance Testing.

**Depends on:** all prior phases functionally complete.

**Effort estimate:** 5–8 days.

**Testing strategy:** this phase *is* the testing strategy — see the production readiness checklist
below, which doubles as its Definition of Done.

**🛑 Review checkpoint.** Stop for explicit client/stakeholder UAT sign-off before the production
deployment step specifically (staging deployment does not require this gate).

---

## Module Implementation Order (summary)

| Order | Module(s) | Phase |
|---|---|---|
| 1 | Authentication, Audit Log | 1 |
| 2 | Project Sites, Employee Registry, Settings, User Management | 2 |
| 2.5 | Project Units (new), Employee Registry refinements | 2.5 |
| 3 | Payroll Entry (with Payroll Work Lines), Payroll Processing | 3 |
| 3.5 | Tasks (new — permanent replacement for the previously-planned Team Collaboration/Chat panel) | 3.5 |
| 4 | Release Salary, Bank Sheets, Cash Receiving, Advances | 4 |
| 5 | (Payroll Processing continued: Finalize/Archive/Backup) | 5 |
| 6 | Corrections, Balance Adjustments | 6 |
| 7 | Statements, Reports, Dashboard | 7 |
| 8 | (Audit Log UI) | 8 |
| 9 | — (hardening/deployment, no new modules) | 9 |

This order matches `docs/architecture/overview.md`'s load-bearing path exactly, with Corrections/
Balance Adjustments deliberately sequenced after the trunk they branch from is proven, not before.

## Dependency Graph

```
Phase 0 (scaffolding)
   └─▶ Phase 1 (auth, RBAC, audit)                         🛑 checkpoint
          └─▶ Phase 2 (sites, employees, settings, users)
                 └─▶ Phase 2.5 (project units, work-line prerequisite, Employee Registry refinements)
                        └─▶ Phase 3 (payroll entry + work lines, calcNet)        🛑 checkpoint
                               └─▶ Phase 3.5 (Tasks Workspace)                   🛑 checkpoint
                                      └─▶ Phase 4 (release, sheets, advances)
                                             └─▶ Phase 5 (finalize, archive, backup)  🛑 checkpoint
                                                    └─▶ Phase 6 (corrections, balance adjustments)  🛑 checkpoint
                                                           └─▶ Phase 7 (statements, reports, dashboard)
                                                                  └─▶ Phase 8 (supporting features)
                                                                         └─▶ Phase 9 (hardening, deployment)  🛑 checkpoint
```

Each arrow is a hard dependency (the later phase reads or builds on tables/logic the earlier phase
produces) — phases are not meaningfully parallelizable beyond splitting frontend/backend work *within*
a phase across two developers, since almost every phase's backend must be trustworthy before its
frontend is built against it (per the overall strategy above). **One deliberate exception: Phase
3.5 → Phase 4 is a sequencing choice, not a technical dependency** — Tasks Workspace shares no schema,
service, or UI surface with Release/Bank Sheets/Advances in either direction (`docs/architecture/
overview.md`'s Tasks module entry). It is placed here because this project executes phases strictly
one at a time regardless of technical necessity, not because Phase 4 reads anything Phase 3.5
produces.

---

## Definition of Done — Generic Criteria (applies to every phase in addition to its specific DoD)

- All new Prisma migrations applied cleanly to a fresh database via the seed + migration scripts.
- All new code passes lint and typecheck in CI.
- Unit and integration tests for the phase's specific testing strategy (above) are green.
- No principle from `docs/PROJECT_PRINCIPLES.md` is violated — reviewed explicitly, not assumed.
- Any deviation discovered from the frozen architecture during implementation has been raised and
  resolved (documented as an architecture update) before the phase is marked complete, not worked
  around silently.
- Audit Log entries are verified to appear for every mutation the phase introduces.
- **Performance reviewed against Principle 10 — added 2026-07-03, mandatory from this point
  forward.** Any new list/table view, report, or bulk operation the phase introduces is checked
  against the 10,000-employee design floor specifically, not just today's ~1,500: is it paginated or
  virtualized rather than loading a full result set, is the query indexed, does a long-running
  operation run in the background rather than blocking the request. This is a review question asked
  during the phase, not a retrofit — see `docs/PROJECT_PRINCIPLES.md` Principle 10.
- **Playwright-driven visual verification — added 2026-07-02, mandatory from this point forward.**
  For any phase with frontend work: the actual pages/flows are rendered in a real (headless)
  browser and screenshotted — not just typechecked/linted/built — before the phase is considered
  done. This means: driving the affected routes and modals end to end, checking for console errors,
  and, where a live backend/DB isn't available, mocking API responses so real rendering can still be
  exercised. This was established during the Phase 2 UI/UX polish pass (see
  `docs/PROJECT_PROGRESS.md`'s "Phase 2 checkpoint" section for the audit that motivated it — it
  caught real defects, e.g. a table header/value alignment mismatch and a design-system-contradicting
  label-casing inconsistency, that static review and `typecheck`/`lint`/`build` alone did not).
- **HTML prototype review — added 2026-07-10, mandatory from this point forward, alongside the
  Playwright rule above.** This formalizes a practice that had only ever been an informal, unwritten
  habit in prior sessions (`docs/prototypes/*.html` generated "at meaningful UI milestones" per
  narration in `docs/PROJECT_PROGRESS.md`, but never actually codified as a rule anywhere before this)
  — the Phase 3.5 architecture revision (2026-07-10) is what surfaced the gap: an obsolete Chat panel
  had sat in `reference/payroll_prototype.html` and `reference/PROJECT_SPEC.md` (both correctly frozen
  and unedited) with nothing in the *living* documentation ever having been required to check whether
  a `docs/prototypes/*.html` file echoed it. **The check must run in both directions, not just one**:
  (1) every implemented feature the closing phase shipped has a corresponding prototype, where a
  prototype is appropriate for that kind of feature; (2) no existing prototype under `docs/prototypes/`
  demonstrates behavior that no longer exists in the shipped architecture — this second direction is
  exactly what would have caught the obsolete Chat panel had one existed, and must not be skipped as
  "just the create-new-ones half." Every phase's close-out, in order: **review every living prototype
  under `docs/prototypes/` → remove or update any obsolete behavior found → create any missing
  prototype(s) the phase's shipped features warrant → verify the resulting set accurately represents
  the shipped application → only then perform documentation updates → repository close-out.**
  `reference/PROJECT_SPEC.md` and `reference/payroll_prototype.html` are never part of this check —
  they are frozen historical artifacts; living documentation supersedes them, it never conforms to
  them. **Naming convention**: a prototype's filename uses the literal phase number, including
  fractional ones — `phase3.5-tasks-workspace-preview.html`, not folded into `phase3-*` or `phase4-*`
  naming (decided 2026-07-10, prompted by Phase 3.5 being this convention's first fractional-phase
  prototype).
  Standing checklist for every phase's Definition of Done, in order: **typecheck → lint → build →
  Playwright visual verification → HTML prototype review/update → documentation update → git
  checkpoint.**

---

## Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Correction baseline-replay algorithm implemented incorrectly | Wrong financial balances, discovered late | Property-style randomized test suite (Phase 6), dedicated review checkpoint before proceeding to Phase 7 |
| RBAC/site-scoping bypass via a missed route or a raw query | A Payroll Staff user sees/edits data outside their sites — a real security incident | Boundary tests introduced in Phase 2 and re-run in full in Phase 9; middleware applied at the router level, not per-handler, to minimize the chance a route is missed |
| Payroll Entry grid performs poorly at scale (today's ~1,500 rows, or Principle 10's 10,000-employee design floor) | The client's explicitly named top concern ("cannot have any crashes or lapses") | Virtualization built in from the start of Phase 3, performance-tested at both scales within that same phase rather than deferred |
| Cycle archiving/backup failure blocks month-end close | A real business deadline (bank sheets/cheques go out on schedule) is missed | Phase 5 tests the all-or-nothing transaction explicitly; per `database/schema-invariants.md` §22, cycle archiving is not coupled to backup file success in a way that can stall the transition — this needs to be re-verified during Phase 5, not assumed |
| Open design assumptions (`database/schema-invariants.md` §26 items 2, 4, 5 — CNIC/employeeCode nullability, free-text designation/religion, calendar-month-only cycles) surface a real mismatch with client expectations | Rework of Employee Registry (Phase 2) or Payroll Processing (Phase 3) | Confirm these specific open items with the client before Phase 2 and Phase 3 begin, respectively — not discovered mid-build |
| Scope creep on Team Collaboration or cosmetic polish before the core payroll path is solid | Delays the client's actual priority | Enforced by phase ordering — Phase 8 cannot start before Phase 7 is done, and the spec's own prioritization is the justification if this is ever challenged |
| Client UAT surfaces a business-rule gap late (Phase 9) | Rework after "feature complete" | Where practical, informal client review is pulled earlier (explicitly suggested at the end of Phase 4, once real documents are being generated) rather than deferred entirely to Phase 9 |

---

## Deployment Milestones

- **End of Phase 0:** first deploy to Render staging — a trivial health-check app, proving the
  pipeline works before any real logic exists.
- **End of Phase 2:** staging redeployed with real auth + master data; usable for the client to start
  reviewing the Employee Registry UI against their real site/employee list.
- **End of Phase 4:** staging redeployed with a full release cycle usable end to end — this is the
  natural point for an informal client walkthrough of generated Bank Sheets/Cash Sheets/Payslips
  against their real historical documents.
- **End of Phase 6:** staging redeployed with Corrections/Balance Adjustments — the client should be
  walked through at least one real correction scenario before Phase 9's formal UAT.
- **End of Phase 8:** staging is feature-complete and matches the full approved scope.
- **Phase 9 completion, post-UAT sign-off:** production deployment on Render (managed PostgreSQL with
  PITR, web service, static site), Sentry live on both services, automated daily backups confirmed
  running, DNS cut over.
- **Post-launch:** a defined monitoring window (recommend at least one full monthly payroll cycle run
  in production before considering the system "settled") with Sentry alerting actively watched.

---

## Final Production Readiness Checklist

- [ ] All 25 tables migrated on production Postgres (18 in the original design + `ProjectUnit`/
      `PayrollEntryWorkLine`, added 2026-07-03 + `PayrollUnitRelease`/`PayrollUnitReadiness`/
      `CorrectionRequest`/`CorrectionPayment`/`BalanceAdjustmentSettlement`, added 2026-07-05); seed
      data (three roles including `FINANCE`, permissions, banks, adjustment types, Master User
      account, company settings) applied and verified.
- [ ] A load/performance test at Principle 10's 10,000-employee design floor — not just the client's
      current ~1,500 — run against the production build, covering at minimum the Payroll Entry grid
      and Employee Registry list.
- [ ] `BalanceAdjustmentType.NONE`, `PayrollEntry.advanceId`/`.eidAdvanceId`,
      `BalanceAdjustment.adjustmentTypeId` present and exercised by at least one passing test each.
- [ ] Audit Log immutability re-verified directly against the production database role's privileges
      (not just staging).
- [ ] RBAC/site-scoping boundary test suite passing against the production build.
- [ ] Full sequential-correction property test suite passing.
- [ ] Automated daily Postgres backups confirmed running, with point-in-time recovery enabled and a
      documented, tested restore procedure (a real restore drill, not just a configuration check).
- [ ] Backup package generation confirmed working against the production `StorageProvider`
      implementation (cloud, not local filesystem).
- [ ] Sentry receiving events from both the backend and frontend production services.
- [ ] SSL/TLS active on all public endpoints; session cookies confirmed `secure`/`httpOnly` in the
      production environment specifically (not just local dev).
- [ ] Staging and production environments confirmed separate (distinct databases, distinct storage
      buckets) — no shared state between them.
- [ ] CI gating deploys — no direct-to-production deploy path exists outside the pipeline.
- [ ] Client UAT sign-off obtained and recorded for at least: a full payroll cycle (entry → release →
      sheets → finalize → archive), one correction scenario, and the Employee Registry/RBAC boundary
      as experienced by an actual Payroll Staff account.
- [ ] Rollback plan documented (how to redeploy the previous release, and — separately — how a bad
      migration would be handled, given migrations are additive-first per Principle 8).
- [ ] Company Details (name, logo, address) populated with the client's real information, not seed
      placeholder data, before go-live.

---

## How to Resume This Project

Everything needed to resume — whether by this assistant in a future session or by a different
developer entirely — is in `docs/`. Read in this order: `docs/PROJECT_PRINCIPLES.md` →
`docs/architecture/overview.md` → the rest of `docs/architecture/*.md` → this file → whichever phase
is next per its checkpoint status. No context beyond these files should be required to continue
correctly.
