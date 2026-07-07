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
   `docs/architecture/post-release-corrections.md`) is scheduled deliberately late, once everything it
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

**Builds:** Prisma schema for the auth/RBAC/audit subset of `docs/architecture/database-schema.md`
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
locations only, with no banking properties (see `docs/architecture/database-schema.md` §8's
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
(`docs/architecture/database-schema.md` §8b). Phase 2 as actually built (`docs/PROJECT_PROGRESS.md`)
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
- An additive migration introducing `ProjectUnit` (`docs/architecture/database-schema.md` §8a) and
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
- `Employee.unitId`, composite-FK'd against `ProjectUnit(id, siteId)` (§9) — added NOT NULL with no
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
  (`docs/architecture/database-schema.md` §8b — new): `id`, `employeeId` FK → `Employee`, `fromSiteId`/
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
  multi-statement-transaction convention (§22): `updateEmployee()` now takes a `RequestMeta`
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
  same-site rule, §12a):
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
  (`docs/architecture/database-schema.md` §9's existing partial-unique constraint — no change to the
  constraint itself); duplicate `Employee` records are never permitted, with no override mechanism of
  any kind; a rehire is handled exclusively through a new **Reactivate Employee** action, symmetric to
  the existing "Mark as Left" (`POST /:id/leave`), that clears `dateOfLeaving` and updates the
  employee's current employment details (site, unit, designation, bank details, etc.) on their
  **existing** `Employee` row — never creating a second row for the same CNIC, so every historical
  `PayrollEntry` continues to reference the one, unchanged `employeeId` (Principle 2). This resolves
  `docs/architecture/database-schema.md` §26 item 6 as a final decision, no longer a recommendation
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
see `docs/architecture/data-and-storage.md` §4, `docs/architecture/post-release-corrections.md`, and
`docs/architecture/database-schema.md` §12/§12b/§13a/§14/§14a/§14b. The concrete consequence for this
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
- Checkpoint 1 — Cycle bootstrap ("Start First Payroll Cycle") + Payroll Entry backend CRUD/read
  routes, RBAC/site-scoping, optimistic locking.
- Checkpoint 2 — Payroll Entry grid frontend (TanStack Table + Virtual, inline editing,
  autosave/conflict UX, Serial Number/Remarks/live-totals columns).
- Checkpoint 3 — "Split by {unitLabel}" workflow (multi-work-line UI + transactional invariants).
- Checkpoint 4 — Multi-select site filter + "Copy to All" bulk toolbar.
- Checkpoint 5 — Payroll Entry CSV/Excel import/export.
- Checkpoint 6 — Performance/concurrency validation at the 10,000-employee floor + this phase's own
  🛑 review checkpoint (below).

**Checkpoint 0 — Schema foundation — COMPLETE, 2026-07-07**
- Prisma schema: `PayrollCycleStatus` enum; `PayrollCycle` (§10); `PayrollEntry` (§12) and
  `PayrollEntryWorkLine` (§12a) — one migration, `20260707120000_payroll_cycle_and_entry`, applied
  cleanly to a fresh database. Every check constraint and the `PayrollCycle` `WHERE status = 'DRAFT'`
  partial index that Prisma's schema DSL can't express are hand-added raw SQL in the same migration,
  the same pattern as `Employee`'s CNIC check constraint (Phase 2).
- **Two approved deviations from `database-schema.md` §12 as it stood before this checkpoint** (both
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

**Builds:** `PayrollCycle` Draft creation (bootstrapping the very first cycle); `calcNet` as a pure,
well-tested function (Principle 5) that sums across an entry's `PayrollEntryWorkLine` rows — always
at least one, so there is one calculation path, not a split/non-split branch
(`docs/architecture/database-schema.md` §12/§12a); the Payroll Entry grid backend (paginated/filterable
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
spec, with a per-row skip report; the export format needs a column scheme for the occasional
multi-line employee — e.g. one row per work line — not just one row per employee).

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
  count" behavior specifically, and a multi-line-employee import/export round trip.

**Definition of Done:** a full synthetic Draft cycle at both ~1,500 and 10,000 employees can be
created, edited across multiple simulated concurrent sessions without data loss, filtered by site,
and bulk-edited via Copy to All — all within a response time that doesn't require the client to wait
more than a second or two per interaction on realistic hardware — and at least one employee in the
test dataset is split across multiple Project Units within one cycle, exercised end to end (entry,
review, release, net salary) without special-case handling anywhere in the flow.

**🛑 Review checkpoint.** Stop here. This is the single source of truth for the entire system
(Principle 1) — everything in Phases 4–7 reads from what this phase produces. Verify `calcNet`
correctness (including the multi-line case) and the locking/autosave behavior before building
Release, Bank Sheets, or Corrections on top of it.

---

### Phase 4 — Release, Payment Artifacts, and Advances

**Revised 2026-07-05 (Phase 3 architecture review) — release moves to Project Unit granularity.**
The plan text below (originally "per-employee release, bulk Release All/Hold All scoped by site") is
superseded by the frozen design in `docs/architecture/data-and-storage.md` §4 and
`docs/architecture/database-schema.md` §12b — release is no longer a Site-scoped bulk action, it's an
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
model in `docs/architecture/database-schema.md` §15 except where flagged as new or open):

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
`ProjectSite` (confirmed 2026-07-02 — see `docs/architecture/database-schema.md` §8's revision
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

**Definition of Done:** a full release cycle — a Finance user releases one Project Unit, generates its
Bank Sheet and Cash Receiving Sheet as PDF and Excel, generates a payslip for a released employee —
can be performed end to end and the client (or someone standing in for them) confirms the documents
are usable as-is. **Added 2026-07-05:** also demonstrated end to end — a multi-unit split employee's
entry stays unreleased until every touched Unit has released; a Late Entry added to an already-
released Unit is released via its own one-off action with a mandatory reason and its own document.

---

### Phase 5 — Cycle Finalization, Archiving, and Backups

**Builds:** the explicit "Finalize Cycle" action with its no-override precondition
(`docs/architecture/data-and-storage.md` §4); the new-cycle-creation transaction (archive the outgoing
cycle, generate its backup package, create the new Draft's `PayrollEntry` rows for active employees
plus any employee with a `PENDING` Balance Adjustment); the Backup Package generator (Payroll/Bank
Sheets/Receivings CSV + `metadata.json`, versioned, written through `StorageProvider`); the Payroll
Cycle Selector (browse any historical cycle, always reading PostgreSQL, never a backup file).

**Depends on:** Phase 4 (Release must exist for the finalization precondition to be meaningful).

**Effort estimate:** 4–6 days.

**Testing strategy:**
- Finalization precondition test: blocked while any non-held entry is unreleased; **explicitly test
  that no code path — including a direct API call as Master User — can override this**, since the
  decision was "no override," not "override requires extra permission."
- New-cycle-creation transaction test: verifies the all-or-nothing behavior (archive + backup +
  new-cycle creation succeed together or not at all); a deliberately-departed employee with a
  `PENDING` Balance Adjustment is confirmed to receive a new `PayrollEntry` in the next cycle, flagged
  as a Final Settlement.
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
simpler single-shot model — see `docs/architecture/post-release-corrections.md` and
`docs/architecture/database-schema.md` §13a/§14/§14a/§14b for the frozen design this phase now
implements against.

**Builds:** the Correction workflow (before/after preview, mandatory reason + standardized Adjustment
Type); **`CorrectionRequest`** (new) — any authorized payroll user may propose a correction, which
sits `PENDING` until a Master User approves (producing a `Correction`) or rejects it (mandatory
rejection reason, no `Correction` created); a Master User may still correct directly, bypassing the
request entirely, with no separate approval step, exactly as before this revision. The
**baseline-reconstruction/replay algorithm** (`docs/architecture/post-release-corrections.md`) exactly
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

**Builds:** Statement of Account (per-employee, cross-cycle ledger, showing the replayed/corrected
current state, running balance, corrections and balance adjustments as distinct highlighted entries);
Fines & EOBI Report (multi-select site filter, four panels); Dashboard (summary stats, per-site
payroll summary, release progress, deduction breakdown, short-TTL caching).

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

**Builds:** Team Collaboration panel (Chat/To-Do — explicitly lowest priority per
`reference/PROJECT_SPEC.md`); Audit Log viewer UI (chronological feed, filterable); remaining
import/export polish and edge-case handling identified during earlier phases' testing.

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
| 4 | Release Salary, Bank Sheets, Cash Receiving, Advances | 4 |
| 5 | (Payroll Processing continued: Finalize/Archive/Backup) | 5 |
| 6 | Corrections, Balance Adjustments | 6 |
| 7 | Statements, Reports, Dashboard | 7 |
| 8 | (Team panel, Audit Log UI) | 8 |
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
frontend is built against it (per the overall strategy above).

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
  Standing checklist for every phase's Definition of Done, in order: **typecheck → lint → build →
  Playwright visual verification → documentation update → git checkpoint.**

---

## Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Correction baseline-replay algorithm implemented incorrectly | Wrong financial balances, discovered late | Property-style randomized test suite (Phase 6), dedicated review checkpoint before proceeding to Phase 7 |
| RBAC/site-scoping bypass via a missed route or a raw query | A Payroll Staff user sees/edits data outside their sites — a real security incident | Boundary tests introduced in Phase 2 and re-run in full in Phase 9; middleware applied at the router level, not per-handler, to minimize the chance a route is missed |
| Payroll Entry grid performs poorly at scale (today's ~1,500 rows, or Principle 10's 10,000-employee design floor) | The client's explicitly named top concern ("cannot have any crashes or lapses") | Virtualization built in from the start of Phase 3, performance-tested at both scales within that same phase rather than deferred |
| Cycle archiving/backup failure blocks month-end close | A real business deadline (bank sheets/cheques go out on schedule) is missed | Phase 5 tests the all-or-nothing transaction explicitly; per `docs/architecture/database-schema.md` §22, cycle archiving is not coupled to backup file success in a way that can stall the transition — this needs to be re-verified during Phase 5, not assumed |
| Open design assumptions (`docs/architecture/database-schema.md` §26 items 2, 4, 5 — CNIC/employeeCode nullability, free-text designation/religion, calendar-month-only cycles) surface a real mismatch with client expectations | Rework of Employee Registry (Phase 2) or Payroll Processing (Phase 3) | Confirm these specific open items with the client before Phase 2 and Phase 3 begin, respectively — not discovered mid-build |
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
