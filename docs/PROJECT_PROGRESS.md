# Project Progress — Payroll Management System

**Date:** 2026-07-03
**Latest git commit:** `0d9ea33` — "Phase 2.5 Checkpoint 0: shared date formatting and DateInput
component" (session lineage: `2e804d4` closed Phase 1 → `674ab04` landed Phase 2's substantive build
→ `89ac6ff` Phase 2 UI/UX polish pass + final visual consistency audit → `11cdc9d` Phase 2 checkpoint
documentation → `b7ba9cf` the pre-Phase-3 architecture review → `74c124e` further doc status update →
**`0d9ea33` Phase 2.5 Checkpoint 0, committed and closed out** — see §3 items 16–22 below for the full
decision record).
**Branch:** `main`
**Current implementation phase:** **Phase 2 — CLOSED (conditional) and committed. The pre-Phase-3
architecture review is complete and committed.** Phase 2.5 (`docs/IMPLEMENTATION_PLAN.md` — Project
Unit model, Payroll Work Lines prerequisite, Employee Registry refinements, §3 items 16–20, amended
with five refinements in §3 item 22) is now **in progress**: **Checkpoint 0 is committed (`0d9ea33`).
Checkpoint 1 (`ProjectUnit` schema, migration, dedicated backend module, Manage Units frontend panel)
is code-complete** — typecheck/lint/build clean, new/updated backend tests confirmed to compile and
run correctly (blocked only by the environment's standing no-Postgres constraint), Playwright-verified
(including a real, previously-latent `DropdownMenuContent`/`Modal` z-index bug found and fixed via
that verification) — **not yet committed** (awaiting explicit approval before Checkpoint 2).
Checkpoints 2–4 (`Employee.unitId`/transfer audit/`EmployeeTransferHistory`, import remap/three-layer
validation, CNIC/Reactivate) have not started. **Do not begin Checkpoint 2 without explicit
instruction.**

This file is the living progress tracker. Update it at the end of every session. For the full phase
roadmap and Definitions of Done, see `docs/IMPLEMENTATION_PLAN.md`; for what must not be changed
without approval, see `docs/SESSION_HANDOFF.md`.

---

## 1. Everything completed so far

### Phase 0 — Project Scaffolding & Foundations (complete)
- npm workspace root (`backend/`, `frontend/`, `shared/`), `tsconfig.base.json`.
- Express + TypeScript skeleton with a `/health` liveness route (no DB dependency).
- Vite + React + TypeScript skeleton with Tailwind configured from `docs/design-system.md` tokens
  (CSS-variable-backed colors so the future Theme picker can swap `--accent` at runtime).
- Prisma initialized against a local PostgreSQL instance (`docker-compose.yml`).
- `shared/` package: Zod schemas (`loginSchema`), `PERMISSIONS`/`ROLE_CODES`/`ROLE_PERMISSIONS`
  constants, `SessionUser` type.
- GitHub Actions CI (`.github/workflows/ci.yml`): install → build shared → typecheck → lint →
  prisma generate → prisma migrate deploy → backend tests → build backend → build frontend, against
  a Postgres service container. **Never yet run** (nothing has been pushed to a PR).

### Phase 1 — Auth, RBAC, and the Audit Log (code-complete, unverified)
- Prisma schema (`backend/prisma/schema.prisma`) — deliberately a *subset* of
  `docs/architecture/database-schema.md`: `Role`, `Permission`, `RolePermission`, `User`,
  `ProjectSite` (minimal), `UserSiteAssignment`, `AuditLog`.
- Two migrations: `20260701164444_init` and `20260701164509_audit_log_immutability` (a DB trigger
  rejecting UPDATE/DELETE on `AuditLog`).
- Seed script (`backend/prisma/seed.ts`): permissions, both roles (`MASTER_ADMIN`, `PAYROLL_STAFF`)
  with grants, one Master Admin account. Idempotent (upserts throughout).
- `express-session` + `connect-pg-simple` + Argon2 login/logout/`me` routes
  (`backend/src/modules/auth/`), with session regeneration on login (fixation protection) and
  immediate session invalidation on deactivation.
- CSRF double-submit-cookie middleware (`backend/src/common/middleware/csrf.ts`).
- `requirePermission` and `requireSiteAccess` middleware
  (`backend/src/common/middleware/{require-permission,require-site-access}.ts`) — independent
  layers per `docs/architecture/authentication.md`.
- Insert-only Audit Log service (`backend/src/modules/audit-log/audit-log.service.ts`) — no
  update/delete export exists at the application layer, on top of the DB-level trigger.
- Test suite: `auth.test.ts` (login/logout/session/CSRF/deactivation, DB-backed), `rbac.test.ts`
  (pure unit tests, no DB), `audit-log.test.ts` (DB-level immutability, DB-backed).
- Frontend: login page (`frontend/src/routes/login-page.tsx`), session hook
  (`frontend/src/hooks/use-session.ts`), app shell/sidebar/topbar
  (`frontend/src/components/layout/`), a Phase-1 placeholder dashboard (`home-page.tsx`).
- `npm run typecheck` and `npm run lint` both pass cleanly across all three workspaces (2 harmless
  `react-refresh/only-export-components` warnings in `badge.tsx`/`button.tsx`, 0 errors).
- All of the above was committed in `00517e3` this session — previously it sat uncommitted in the
  working tree since a prior session crash.

### Phase 2 — Project Sites, Employee Registry, Settings, User Management (code-complete, unverified)

- **Schema/migration** (`20260702084133_phase2_master_data`): `Bank`, `Employee` (full
  `docs/architecture/database-schema.md` §9 field set, `PayType` enum, partial-unique `cnic`/
  `employeeCode`, `dateOfLeaving`-based active filtering, CNIC numeric check constraint —
  partial-unique indexes and the check constraint are raw SQL since Prisma's schema DSL can't
  express them), `AdjustmentType`, `CompanySettings` (fixed-UUID singleton). Seed script extended:
  3 banks (ABL/HBL/MCB), 7 `AdjustmentType` rows, singleton `CompanySettings` with a placeholder
  company name. **`ProjectSite.defaultBankId` was added, then removed, within this same session**
  after an architectural review — see §3 item 6 below.
- **Project Sites module** (`backend/src/modules/project-sites/`): full CRUD, delete blocked while
  any `Employee.siteId` references the site (app-layer check + DB `RESTRICT` backstop), site list
  scoped to a Payroll Staff user's assignment. Frontend: `frontend/src/routes/project-sites-page.tsx`
  (list/create/edit/delete).
- **Employee Registry module** (`backend/src/modules/employees/`): full CRUD, CNIC/employeeCode
  partial-unique handling (409 on duplicate, multiple nulls allowed), DOL-based soft "leaving" as a
  dedicated `POST /:id/leave` action (distinct `employee.left` audit entry, rejects a second call),
  full site-scoped RBAC for Payroll Staff on view/edit/create per the **C11 decision** — enforced via
  `assertSiteAccess()` on every read and write path, including a site *change* on update (both the
  employee's current site and any new target site must be within the assignment). Generic
  `employee.created`/`employee.updated` audit logging with a field-level diff in `metadata`.
  Frontend: `frontend/src/routes/employees-page.tsx` (list with site/search/active filters,
  create/edit form modal, mark-as-left modal).
- **Employee Registry CSV/Excel import/export** (`backend/src/modules/employees/
  employees-import-export.service.ts`): exports/imports the exact official template header set from
  `reference/PROJECT_SPEC.md` ("Official Data Template"). Import matches an existing employee by
  CNIC first, then employee code, otherwise creates a new one — so re-importing an unmodified export
  updates in place rather than duplicating. Bad rows (unknown project site, unknown bank, an
  out-of-assignment site for a Payroll Staff importer, unparseable dates) are skipped and reported
  per-row, never a whole-file failure. One summary `employee.import` audit entry per operation
  (not one per row, to keep the log readable). **Documented assumption**: the source template has
  two redundant-looking column pairs (`Area`/`Area/Location`, and a bare `Branch Code` alongside
  `Bank Branch Code`) inherited from the client's real spreadsheets; these are exported using the
  project site's name/branch code and ignored on import — flagged in code comments as needing
  client confirmation, matching the spirit of `docs/architecture/database-schema.md` §26.
- **Settings module** (`backend/src/modules/settings/`, plus `PATCH /api/v1/auth/me` and
  `POST /api/v1/auth/change-password` added to the existing auth module for the self-service half):
  Company Details (Master-Admin-only edit via `settings:manage`, read-only for everyone else),
  My Profile (name + password self-service, current-password verification required), Theme (accent
  color, already-existing `ThemeProvider` CSS-variable mechanism from Phase 1 now has a real UI).
  Frontend: `frontend/src/routes/settings-page.tsx` (tabbed).
- **User Management module** (`backend/src/modules/users/`): Master Admin creates Payroll Staff (or
  Master Admin) accounts with per-site assignment via `UserSiteAssignment`, edits name/active-status/
  site assignments, resets another user's password. Self-deactivation blocked. Deactivating another
  user invalidates their session immediately (reuses the same `attachUser`/`isActive` check proven in
  Phase 1). Frontend: `frontend/src/routes/users-page.tsx`.
- **Site-scoping boundary tests** (the plan's explicitly named Phase 2 testing priority): covered in
  `project-sites.test.ts`, `employees.test.ts` (including the update-time site-change boundary), and
  `employees-import-export.test.ts` (import-time site boundary) — all via direct API calls with a
  manipulated `siteId`/`Project` column, not just the intended UI path, per the plan's own C11 test
  description.
- Full test suite added: `project-sites.test.ts`, `employees.test.ts`,
  `employees-import-export.test.ts`, `settings.test.ts`, `users.test.ts` — all integration tests
  against a real Postgres via supertest, same pattern as Phase 1's `auth.test.ts`. **Not executed
  this session** for the same reason as Phase 1 (§4).
- New shared UI primitives added since none existed yet: `frontend/src/components/ui/modal.tsx`
  (Radix Dialog wrapper matching `docs/design-system.md` §3's 3-part Modal spec) and
  `frontend/src/components/ui/table.tsx`. New dependencies: `@radix-ui/react-dialog` (frontend);
  `exceljs`, `csv-parse`, `csv-stringify`, `multer` (backend, for import/export).
- `npm run typecheck`, `npm run lint`, and `npm run build` (backend + frontend) all pass cleanly
  across all three workspaces at every step of this phase — verified repeatedly, not just once at
  the end.
- Three static HTML prototypes added under `docs/prototypes/`: `phase2-project-sites-preview.html`,
  `phase2-employee-registry-preview.html`, `phase2-settings-users-preview.html`.

### Phase 2 UI/UX polish pass (2026-07-02, no business logic/architecture change except §3 item 8)

A UI-only pass, explicitly *not* Phase 3, requested after Phase 2 landed. Scope was layout,
consistency, and documentation — one narrow, explicitly authorized schema exception (`ProjectSite.
address`, §3 item 8) aside, no business logic or database schema changed.

- **Global layout bug fixed:** `AppShell` previously let the whole document scroll, which on
  trackpad/rubber-band overscroll revealed blank space above the fixed sidebar. Restructured to a
  non-scrolling `h-screen overflow-hidden` shell where only `<main>` scrolls — the sidebar and topbar
  now never move, on every page, structurally rather than via a browser-specific CSS workaround.
- **Dynamic greeting:** new `frontend/src/components/greeting.tsx` (`Greeting` component,
  `getTimeOfDayGreeting()`) replaces the static "Welcome, {name}" on the dashboard with a
  Morning/Afternoon/Evening greeting derived from the browser's local clock only (no network call).
- **Table alignment fixed:** Employee Registry's "Gross pay" column header was left-aligned while
  its values were right-aligned/tabular-nums — header now matches. Reviewed every other table in the
  app (Project Sites, Users) for the same class of bug; none found (no other numeric columns).
- **Project Sites page:** added `address` (see §3 item 8) to the create/edit form and the list table.
  Confirmed Default Bank and a "Tax Rate" field are both already absent from this module (the former
  removed earlier this session, the latter never existed) — no action needed there.
- **Settings — Company Logo placeholder:** added a dedicated section (disabled "Upload Logo" button,
  `LogoPlaceholder` preview, a "Maximum file size" note, and the existing "available once Storage
  Provider is implemented" note) — UI only, no upload wiring, consistent with the `StorageProvider`
  deferral (§3 item 4, before Phase 5).
- **Login page:** added the same `LogoPlaceholder` component above the login card title, so the
  logo slot exists and is positioned correctly ahead of `StorageProvider` wiring it up for real.
- **Settings page layout:** added a heading+description (`TabIntro`) to each of the three tabs,
  widened the page to a centered `880px` container, and increased section/form spacing — addresses
  the "feels compressed" feedback without changing the tab structure.
- **Company name consistency:** the seed script's `CompanySettings.companyName` fallback (used only
  when `SEED_COMPANY_NAME` isn't set) changed from a generic placeholder to "Broom Services Private
  Limited" — the real, consistently-spelled client name. Confirmed no other hardcoded/inconsistent
  company-name strings exist in `frontend/src` or `backend/src` (only in `reference/*`, which is
  historical reference material, not app output).
- **Design-system consistency:** `Button`'s default/`sm` sizes previously had no fixed height
  (padding-only), while `Input` and the `<select>` elements used a fixed `h-9` — heights didn't quite
  match. Standardized `Button` to `h-9` (default) / `h-8` (`sm`) so buttons, inputs, and selects share
  a consistent height rhythm app-wide. No other systemic spacing/typography inconsistencies were
  found against `docs/design-system.md` in this pass.
- New shared component: `frontend/src/components/logo-placeholder.tsx` (`LogoPlaceholder`), reused by
  both Settings and the login page rather than duplicated.
- `npm run typecheck`, `npm run lint`, and `npm run build` re-verified after this pass.
- Not committed on its own — see the final audit below; the whole pass (this section plus the audit's
  fixes) landed together in one commit, `89ac6ff` ("feat(ui): Phase 2 UI polish and UX improvements"),
  after explicit user approval, on top of `674ab04` (Phase 2's substantive build).

#### Final visual consistency audit (same day, before the commit above)

The user requested one more pass — "a final visual consistency audit across every page for spacing,
alignment, typography, padding, margins, table headers, button heights, card widths, modal spacing,
and responsive behavior" — before Phase 3. This is the pass that established Playwright-driven visual
verification as a real practice (now a permanent, mandatory Definition-of-Done item — see
`docs/IMPLEMENTATION_PLAN.md`'s "Definition of Done — Generic Criteria" and §3 item 14 below).

Method: rendered every page and every modal in a real headless-Chromium browser (Playwright, with API
responses mocked since no live Postgres/backend is reachable in this environment) at three viewport
widths (1440/1280/1024), measured computed styles (button/input heights, card border-radius, table
header padding/alignment, modal widths), and pixel-sampled specific regions rather than trusting
screenshot thumbnails by eye.

- **Fixed — label-casing inconsistency (real, and contradicted the written spec).**
  `docs/design-system.md` §2.4 explicitly calls for uppercase filter-row micro-labels, and the shared
  `Label` component is uppercase by default, but 8 call sites overrode it to `normal-case` with no
  discernible rule (e.g. "Email"/"Role" labels were sentence-case while "Name" right next to them, same
  form, was uppercase). Fixed all 8: Settings → My Profile (Email, Role), Settings → Theme (Custom),
  Employee Registry filter row (Site, Search), Users create/edit modals (Assigned sites ×2). The
  EOBI-applicable checkbox label was restructured to match the plain-text checkbox-caption pattern
  already used everywhere else ("Active employees only", "Active"), rather than just removing its
  override.
- **Fixed — spacing-scale drift, self-introduced.** Two containers added earlier in this same pass
  used `gap-8`/`gap-9` (32px/36px), outside `docs/design-system.md` §1.3's documented spacing scale
  (max 28px). Changed both to `gap-7` (28px, the largest approved token).
- **Investigated, ruled out as a false alarm.** Suspected a z-index stacking bug — a dropdown menu
  (Edit/Delete/Mark as left/Reset password, used on every list page) appearing to render on top of a
  modal opened from it. Pixel-sampling proved the dropdown was already correctly dimmed beneath the
  modal overlay (RGB 149,149,148 vs. the modal card's true white 255,255,255) — a small-thumbnail
  misread, not a real defect. Kept a defensive fix anyway (`Modal` is now explicitly `z-[60]`, above
  `DropdownMenuContent`'s `z-50`, in `frontend/src/components/ui/modal.tsx`) since codifying
  dialog-above-menu as an explicit rule is more robust than relying on implicit DOM append order, even
  though it wasn't fixing a visible bug in this build.
- **Confirmed consistent, no changes needed:** button heights (36px/32px uniformly across every page),
  input/select heights (36px), card border-radius (12px everywhere), table header padding (10px 14px)
  and alignment, modal widths (420/520/620px matching `docs/design-system.md` §3's stated ranges),
  reflow at 1024px width (no overflow/breakage in any modal, form, or table), zero browser console
  errors on any page at any of the three tested viewports.
- Re-verified after the fixes: `typecheck`/`lint`/`build` clean, full audit re-run clean.

### Phase 2.5, Checkpoint 0 — Foundation: shared date formatting and reusable UI primitives (2026-07-03, COMMITTED as `0d9ea33`)

- `shared/src/lib/date.ts`: `formatDate()` (ISO → `DD-MM-YYYY`), `parseDateInput()` (`DD-MM-YYYY` →
  ISO, validating month range and days-in-month including leap years), `toIsoDateOnly()`
  (ISO-datetime/`Date` → pure `YYYY-MM-DD`) — exported from `@payroll/shared`.
- `frontend/src/components/ui/date-input.tsx`: a new `DateInput` component — masks digits into
  `DD-MM-YYYY` as the user types, emits ISO via `onChange` once a complete valid date is entered or
  cleared, reverts an incomplete typed value on blur, and syncs its display when the external `value`
  changes (e.g. loading a different employee's record).
- Applied in `frontend/src/routes/employees-page.tsx`: the three former native
  `<input type="date">` fields (DOB, DOJ in the create/edit form; Date of Leaving in the Mark-as-Left
  modal) now use `DateInput`; the ad-hoc `.slice(0, 10)`/`.toISOString().slice(0, 10)` calls that
  previously normalized these fields are replaced with `toIsoDateOnly()`.
- **Grepped the full codebase** (`backend/src`, `frontend/src`, `shared/src`, both test directories)
  for `toLocaleDateString`, `toISOString().slice`, bare `.slice(0, 10)`, `DateTimeFormat`, and native
  `type="date"` inputs. Found and fixed two pre-existing call sites in
  `backend/src/modules/employees/employees-import-export.service.ts` that predated this checkpoint:
  a locally-defined `formatDate()` helper that exported DOB/DOJ/DOL as ISO rather than `DD-MM-YYYY`
  (directly contradicting `docs/design-system.md` §4's "every table cell, form field, PDF/Excel
  export" clause), and a `.toISOString().slice(0, 10)` call converting an Excel `Date` cell during
  import parsing. Both replaced with the shared utilities; the local duplicate `formatDate()` was
  deleted rather than kept alongside the shared one, to avoid a same-name, different-behavior
  collision. The import parser already tolerated `DD-MM-YYYY` input, so the export format fix doesn't
  break re-import round-tripping, and no existing test asserted the old ISO export format.
  Re-grepped after the fix: zero remaining ad-hoc call sites anywhere outside the one intentional doc
  comment inside `shared/src/lib/date.ts` itself.
- New pure unit tests, `backend/tests/date-utils.test.ts` (no database required, same category as
  `rbac.test.ts`): `formatDate`, `toIsoDateOnly`, `parseDateInput`, including a leap-year-boundary
  case (29 Feb 2028 accepted, 29 Feb 2026 rejected) and a round-trip check. All 23 assertions pass.
- `npm run typecheck`, `npm run lint` (0 errors, same 3 pre-existing `react-refresh` warnings), and
  `npm run build` all clean across all three workspaces.
- **Playwright visual verification** (headless Chromium, API responses mocked via route
  interception — no live backend/DB in this environment, same method as the Phase 2 UI/UX polish
  pass): confirmed an existing employee's DOB/DOJ render correctly as `15-03-1990`/`01-06-2020` in the
  edit form; the placeholder text reads `DD-MM-YYYY`; typing `05032026` into a blank field
  progressively masks to `05-03-2026`; an incomplete typed value (`991`) reverts to empty on blur; the
  Mark-as-Left modal defaults to today's date correctly formatted. Zero browser console errors
  observed across all three scenarios.
- **Scope note**: the Site → Unit cascading select originally scoped into this checkpoint is deferred
  to Checkpoint 1 — `ProjectUnit` and its API don't exist yet, so the control couldn't be meaningfully
  built or tested here; building an unused, half-wired component now would contradict this project's
  own anti-premature-abstraction discipline. Flagged explicitly rather than silently dropped.

### Phase 2.5, Checkpoint 1 — `ProjectUnit` schema, migration, dedicated module (2026-07-03, code-complete, not yet committed)

- **Schema/migration**: `ProjectUnit` model added to `backend/prisma/schema.prisma`
  (`docs/architecture/database-schema.md` §8a — id, siteId, name, code, isActive, timestamps;
  unique `(siteId, name)`; unique `(id, siteId)` for the composite-FK support Checkpoint 2/Phase 3
  need); `ProjectSite.branchCode` removed, `ProjectSite.unitLabel` added (default `'Branch'`). New
  migration `20260703100000_project_units`, generated via `prisma migrate diff` against the schema
  files directly (no live database connection required for this — Prisma's schema-engine can diff
  two `.prisma` files purely statically) rather than hand-transcribed from scratch, then placed into
  a timestamped folder matching every prior migration's convention. Validated via `prisma
  validate`/`format`/`generate`; not yet applied to a live database (same constraint as every
  migration in this project so far — no Postgres reachable in this environment).
- **Dedicated Project Units module** (`backend/src/modules/project-units/`): `project-units.service.ts`
  (list/create/update/delete, `getProjectSite` reused to 404 a bad `siteId` cleanly) and
  `project-units.routes.ts`, mounted in `app.ts` at `/api/v1` (its `/sites/:siteId/units` and
  `/units/:id` paths don't overlap with `projectSitesRouter`'s own routes, verified by tracing Express's
  path-matching directly). List/create are gated by `requireSiteAccess` — **this middleware's first
  real consumer**: it was built in Phase 1 as foundational RBAC infrastructure ahead of any
  site-scoped resource needing it, and Employee Registry (Phase 2) ended up using a service-layer
  `assertSiteAccess()` check instead, so this middleware sat unused until now. Update/delete are gated
  by `sites:manage` alone (Master Admin only), matching `ProjectSite`'s own mutation gating — no
  additional site-scoping needed since Master Admin already bypasses it everywhere.
- **`ProjectSite` updates**: `unitLabel` replaces `branchCode` throughout the service, shared Zod
  schema, and frontend (create/edit form field + list column). `deleteProjectSite` now also blocks
  while any `ProjectUnit` still belongs to the site (§8's revision note: "a site must have both its
  units and its employees cleared before it can be deleted"), in addition to its existing
  employee-count check.
- **`deleteProjectUnit`'s own delete guard is a documented no-op for now**: it's written to match every
  other referenced-master-data delete in this schema (app-layer count check), but nothing references
  a `ProjectUnit` yet — `Employee.unitId` doesn't exist until Checkpoint 2, `PayrollEntryWorkLine`
  until Phase 3. The function's own code comment says so explicitly, so this isn't mistaken for
  finished protection later.
- **Frontend**: a "Manage {unitLabel}s" panel (`frontend/src/routes/project-sites-page.tsx`'s
  `ManageUnitsModal`) opened from each site's row action menu, listing/creating/editing/deleting that
  site's units — every visible label (modal title, button text, empty state, field labels, delete
  confirmation copy) is driven by `site.unitLabel`, with no hardcoded "Branch" text anywhere (verified
  by grep both before writing the UI and after, per the standing "grep for hardcoded terminology"
  discipline this project already applies to dates). New shared `pluralize()` utility
  (`shared/src/lib/text.ts`) — a small heuristic (not a grammar engine) tuned for the documented
  unitLabel examples (Branch→Branches, Department→Departments, Section→Sections,
  Division→Divisions), used to compose headings like "Manage Branches."
- **A real, unplanned bug found and fixed via this checkpoint's own Playwright verification** (not
  scope creep — this is exactly what the mandatory Playwright step exists to catch): the Manage Units
  panel is the first place in the app a `DropdownMenu` (for a unit row's Edit/Delete actions) opens
  from *inside* an already-open `Modal`. At the ordering set during the 2026-07-02 Phase 2 polish
  audit (`Modal` z-[60] above `DropdownMenuContent`'s z-50, deliberately, to guard against a
  *suspected* — and at the time unconfirmed — stacking bug in the opposite direction), the open
  Modal's own overlay permanently intercepted every click on the nested dropdown's menu items.
  Confirmed via Playwright polling the DOM every 300ms for 3 seconds after closing a nested form — the
  stuck, click-intercepting overlay never resolved on its own, ruling out a transition-timing
  coincidence. **Fix**: raised `DropdownMenuContent` to `z-[70]`, above `Modal`'s `z-[60]`
  (`frontend/src/components/ui/dropdown-menu.tsx`, with a matching explanatory comment added to
  `modal.tsx`). This reverses the 2026-07-02 ordering decision — flagged here explicitly, per the
  standing instruction to never silently change an architecture/design-system decision, rather than
  quietly overwritten. **Trade-off accepted knowingly**: this re-opens the original, still-unconfirmed
  cosmetic risk the 2026-07-02 audit was defending against (a closing dropdown briefly rendering above
  a *new* Modal it just opened, during the fade transition) — accepted because that risk was
  investigated at the time and found to be a false alarm, whereas the bug just fixed was reproduced and
  confirmed. A regression check (dropdown-on-base-page opening a modal, the original Employees-page
  scenario) was re-run via Playwright after the fix and still passes cleanly.
- Two initial attempts at the Manage Units panel's own architecture were tried and rejected before
  landing on the single-Dialog, internal-view-state design actually shipped: nesting a second,
  independent `Modal` (Radix `Dialog.Root`) for the create/edit/delete flows inside the list modal was
  tried first, and found to have its own, separate real bug — Radix's aria-hiding of background
  content leaves the *outer* dialog's overlay permanently `aria-hidden`/click-intercepting once the
  *inner* one closes (confirmed the same way, via DOM polling over several seconds with no recovery).
  Rebuilding the panel as one `Modal` with a `list | form | delete` view-state field sidesteps that
  entire class of bug rather than patching around it.
- New backend tests: `backend/tests/project-units.test.ts` (create, permission rejection, per-site
  duplicate-name 409, same name allowed across two different sites, nonexistent-site 404, update,
  delete, Payroll-Staff site-scoping via `requireSiteAccess`) and additions to
  `project-sites.test.ts` (the `branchCode` update assertion replaced with `unitLabel`; a new test
  confirming site deletion is blocked while a `ProjectUnit` still belongs to it).
  `backend/tests/helpers.ts`'s `cleanTestData()` extended to also clear `ProjectUnit` rows. All new/
  updated test files confirmed to compile and execute correctly through `ts-jest` — they fail only on
  the expected "no Postgres reachable" constraint (a Prisma connection error), not a code or type
  defect, the same evidence standard every other DB-backed test in this project has been held to.
- `npm run typecheck`, `npm run lint` (0 errors, same 3 pre-existing warnings), and `npm run build` all
  clean across all three workspaces. Playwright verification (headless Chromium, API responses mocked
  via route interception): sites list shows the "Unit label" column with correct per-site values;
  Edit Site form shows the renamed field; the row dropdown shows "Manage Branches"/"Manage
  Departments" correctly per site (not hardcoded); the Manage Units panel's create/edit/delete flow
  and empty state all render and function correctly; zero console errors throughout.

---

## 2. Remaining work (by phase, per `docs/IMPLEMENTATION_PLAN.md`)

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, RBAC, Audit Log | **Closed (conditional), 2026-07-02** — DB-backed test evidence still outstanding, tracked to close before Phase 9 |
| 2 | Project Sites, Employee Registry, Settings, User Management | **Closed (conditional), 2026-07-02** — same DB-backed-verification caveat as Phase 1, tracked to close before Phase 9 |
| 2.5 | Project Units (new module), Payroll Work Lines prerequisite, Employee Registry refinements | **In progress.** Checkpoint 0 (shared date formatting/`DateInput`) COMMITTED (`0d9ea33`). Checkpoint 1 (`ProjectUnit` schema/migration/module/UI) code-complete 2026-07-03, not yet committed. Checkpoints 2–4 (`Employee.unitId`/transfer audit/`EmployeeTransferHistory`, import remap/validation, CNIC/Reactivate) not started |
| 3 | Payroll Entry & Payroll Processing (`calcNet` over Work Lines, the Payroll Entry grid) | Not started — depends on Phase 2.5 |
| 4 | Release, Bank Sheets, Cash Receiving, Advances | Not started |
| 5 | Cycle Finalization, Archiving, Backups | Not started |
| 6 | Corrections & Balance Adjustments (highest-risk logic) | Not started |
| 7 | Statements, Reports, Dashboard | Not started |
| 8 | Team Collaboration panel, Audit Log viewer UI | Not started |
| 9 | Hardening, Security Review, Deployment | Not started |

---

## 3. Outstanding architectural/business decisions

1. **Bank / AdjustmentType / CompanySettings seed scope mismatch — RESOLVED 2026-07-02.** The
   `schema.prisma` narrowing (deferring `Bank`, `AdjustmentType`, `CompanySettings` to Phase 2) has
   been explicitly ratified by the user as the correct scope. `docs/IMPLEMENTATION_PLAN.md`'s Phase 1
   and Phase 2 "Builds" text has been updated to match: Phase 1's seed script text no longer mentions
   these three, and Phase 2's "Builds" now explicitly owns their migration + seed rows (three banks,
   seven `AdjustmentType` rows, singleton `CompanySettings`). No code change was needed — only the
   plan text was brought in line with the already-implemented schema.
2. **Phase 1 review checkpoint — CONDITIONALLY SIGNED OFF 2026-07-02.** The user reviewed this
   session's report (code-complete, statically clean, DB-backed tests unexecuted because no
   Postgres is reachable in this sandboxed environment) and explicitly approved closing Phase 1 on
   that basis, with DB-backed verification tracked as an open item rather than a blocker. See §4 for
   the exact outstanding evidence and where it must be closed out.
3. **Design assumptions from `docs/architecture/database-schema.md` §26 — items 2 and 4 RESOLVED
   2026-07-02.** CNIC/employeeCode nullability and free-text designation/religion both confirmed by
   the user as documented, ahead of Phase 2 Employee Registry schema work. Item 5 (calendar-month-only
   cycles) remains open, revisit before Phase 3; item 3 (at-most-one-`ACTIVE`-`Advance`-per-type)
   remains open, revisit before Phase 4.
4. **`StorageProvider` gap discovered during Phase 2 — deferral timing RESOLVED 2026-07-02.**
   `docs/IMPLEMENTATION_PLAN.md`'s
   Phase 0 "Builds" text calls for "the `StorageProvider` interface with a working
   `LocalFilesystemStorageProvider`," but no such abstraction exists anywhere in `backend/src/` —
   Phase 0's own completed-work list in this file never mentioned it either, so it appears to have
   been silently skipped in an earlier session rather than raised. This surfaced now because Company
   Details (logo) and My Profile (avatar) both have a `*StorageKey` column in the schema but no way
   to actually store a file; both forms were scoped to text fields only this session, with the logo/
   avatar upload UI explicitly omitted and flagged in-app ("Logo upload is not available yet — it
   depends on the file-storage abstraction, which is not built as of Phase 2") rather than building
   an ad-hoc upload mechanism that would contradict the frozen `StorageProvider` abstraction.
   **RESOLVED 2026-07-02, confirmed by the user: intentionally deferred until before Phase 5.**
   `StorageProvider` is not built in Phase 3 or Phase 4 — file uploads (logo/avatar) stay
   unavailable through both. Backup Package generation (Phase 5) is the first phase that hard-requires
   `StorageProvider`, so it must be built no later than the start of that phase.
5. **Employee Registry import template's redundant columns — NEW, needs client confirmation.** The
   official template (`reference/PROJECT_SPEC.md`) includes `Area`/`Area/Location` (both currently
   exported as the project site's name) and a bare `Branch Code` alongside `Bank Branch Code` (the
   former exported as the project site's own branch code, the latter as the employee's bank branch
   code) — nothing in the spec disambiguates whether these are genuinely redundant in the client's
   real files or represent distinct data this system doesn't currently capture. Not blocking (both
   are ignored on import either way), but worth confirming before this template is relied on for a
   real bulk import.
6. **`ProjectSite.defaultBankId` — added, then removed, same session — RESOLVED 2026-07-02.** The
   Phase 2 schema/migration originally added a `defaultBankId` FK from `ProjectSite` to `Bank` (a
   "site's typical bank" default). During architectural review, the user identified this as
   incorrect for Broom Services' actual business model: Project Sites are physical client work
   locations only, with no banking properties. Site names like "ABL City Region Lahore" identify
   the *client* (confirmed by `reference/PROJECT_SPEC.md`: "staff deputed to client project sites
   (e.g., banks like ABL/HBL/MCB...)"), not a bank Broom Services itself banks with. Employees own
   their own receiving bank account (`Employee.bankId`, unchanged); Broom Services' own disbursement
   source account(s) are a distinct concept this schema does not model at all — see the new item
   below. Removed completely: the Prisma field/relation/index, the migration SQL (hand-edited in
   place since it had never been applied to any live database), the shared Zod schema field, the
   Project Sites service/routes handling, the frontend form field and table column, and the
   `docs/architecture/database-schema.md` §7/§8/§21 text (with an explicit revision note, since that
   document is otherwise frozen architecture).
7. **Broom Services' own disbursement source bank account(s) — design proposed 2026-07-02, NOT YET
   IMPLEMENTED, pending approval.** Nothing in this schema models the company's own bank account(s)
   that fund salary/advance disbursements. Proposed: a `CompanyBankAccount` lookup table (`id`,
   `bankId` FK → `Bank`, `accountNumber`, `accountTitle`, `label`, `branchCode`, `isActive`,
   `isDefault`) — multiple accounts, always separate from `Employee.bankId` and never attached to
   `ProjectSite` (confirmed 2026-07-02, see item 6). Two open sub-questions before this is finalized:
   (a) same-bank-only disbursement (a Broom Services HBL account pays HBL-held employees) vs. manual
   account selection at Release time; (b) source account recorded per-`PayrollEntry`/per-release vs.
   per Bank Sheet generation event. See `docs/IMPLEMENTATION_PLAN.md`'s Phase 4 section for the full
   design note. **Needs an explicit decision before Phase 4 schema work begins** — not implemented in
   Phase 2.
8. **`ProjectSite` `address` field — RESOLVED 2026-07-02 (during the Phase 2 UI/UX polish pass).**
   The user confirmed `address` is operationally required (site visits, deployment, documentation)
   and explicitly authorized it as a scoped, single-column exception to that pass's own
   no-schema-changes rule. Added: `ProjectSite.address` (nullable `varchar(300)`, migration
   `20260702165738_project_site_address`), the shared Zod create/update schemas, the backend
   service, and the Project Sites page form/table — see
   `docs/architecture/database-schema.md` §8's matching revision note. **The `client`/`Client`-entity
   half of this item remains un-implemented, deliberately** — the user's authorization was scoped
   strictly to `address`; site names continue to encode the client as free text (e.g. "ABL City
   Region Lahore"), unchanged from the reasoning already recorded in the removed-`defaultBankId`
   note. Revisit only if a real "all sites for client X" reporting need surfaces later.
9. **Automatic Payroll Recovery — CLARIFIED AND RESOLVED 2026-07-02.** The user confirmed the exact
   meaning: the system automatically *applies* a previously staff-approved repayment schedule each
   cycle; it must never calculate or decide the installment amount itself — Payroll Staff always
   defines or edits the schedule. This is compatible with `reference/PROJECT_SPEC.md`'s "verified
   multiple times" rule against auto-deduction *logic* (no value is ever computed by the system), and
   adds real value over pure manual re-entry (staff sets the amount once, edits it when it needs to
   change, doesn't retype it every cycle). `docs/IMPLEMENTATION_PLAN.md`'s Phase 4 section now
   specifies this precisely, including a proposed `Advance.scheduledInstallmentAmount` field —
   **not yet implemented; this is Phase 4 schema work.**
10. **Scaling to 5,000 employees — reviewed 2026-07-02, no code changes needed for Phase 2's scope.**
    Searched the full codebase for hard-coded assumptions tied to "~1,500 employees" (the figure used
    throughout `docs/architecture/*.md` as descriptive context, never as an enforced limit). Found no
    hard-coded row caps, pagination limits, or array-size limits anywhere in `backend/src`,
    `shared/src`, or `frontend/src` — the Employee Registry's schema (partial-unique indexes on
    `cnic`/`employeeCode`, a `siteId` index, an active-employee partial index) and API (`findMany`
    with filters, no artificial `take`) both scale to 5,000+ rows without modification. **One real
    gap, not blocking**: the Employee Registry list page (`frontend/src/routes/employees-page.tsx`)
    renders every matching row into an unvirtualized HTML `<table>` — fine at ~1,500 rows, likely
    sluggish at 5,000 in a browser. `docs/architecture/tech-stack.md` already anticipates this exact
    problem for Phase 3's Payroll Entry grid (TanStack Table + TanStack Virtual) — the same
    virtualization approach should be applied to the Employee Registry list before it's relied on at
    5,000-employee scale, but this is a UI performance follow-up, not a schema or architecture
    change, and doesn't block Phase 2.
11. **Phase 2 review checkpoint — CLOSED (conditional), 2026-07-02.** The user explicitly confirmed
    "Phase 2 is now complete" and requested this formal checkpoint, on the same conditional basis as
    Phase 1 (§4's DB-backed-verification caveat carried forward as a tracked open item, not a blocker).
    This closes the item left open in §6/§7 of `docs/SESSION_HANDOFF.md` — the Phase 2 UI/UX polish
    pass and its final visual consistency audit (above) are included in this closure, not a separate
    unreviewed addendum.
12. **Company name — RESOLVED 2026-07-02: "Broom Services Private Limited."** Standardized everywhere
    the application displays or seeds the operating company's name (the seed script's
    `CompanySettings.companyName` fallback), matching the client's real name exactly and consistently
    — the reference prototype/spec material used several inconsistent variants ("Broom Services (Pvt)
    Ltd", "Broom Services (Private) Limited", "Broom Services (Pvt) Limited"); this is now the single
    canonical spelling for all application output. Distinct from the software's own product name
    ("Payroll Management System," the sidebar/login branding), which is unaffected.
13. **Deployment model — CONFIRMED 2026-07-02: single-company by design, but must remain portable to
    any customer's own server/hosting.** The application continues to have no multi-tenancy
    abstraction (`Tenant`/`Organization`/`Workspace`/`Company`) — one deployment serves exactly one
    company, with that company's identity configurable through Company Settings
    (`CompanySettings`, the fixed-UUID singleton), not hardcoded. **New this session**: the user
    confirmed the deployment target is not fixed to any specific host — the system must be deployable
    on whichever server/hosting a given customer provides, not assumed to run on one particular
    platform. No code change follows from this today (nothing in the current codebase hardcodes a
    specific hosting provider), but it is a real constraint on Phase 9's deployment work
    (`docs/IMPLEMENTATION_PLAN.md`'s "Deployment Milestones"/production-readiness sections currently
    describe Render specifically) and on `docs/architecture/data-and-storage.md`'s `StorageProvider`
    design (§3 item 4/below) — both should be revisited for portability before Phase 9, not assumed
    Render-specific by default.
14. **Advance-only Bank Sheets — remains Phase 4 scope, consolidated here per explicit request.** No
    new decision; cross-referencing `docs/IMPLEMENTATION_PLAN.md`'s Phase 4 section, which already
    names this as a new, not-yet-designed artifact type (a dedicated bank-sheet-style document for
    disbursing a *new* advance via bank transfer, separate from the salary Bank Sheet) — needs its own
    design pass during Phase 4, including which Company Bank Account funds it (see item 7 above).
15. **Playwright-driven visual verification — ADOPTED 2026-07-02 as a permanent, mandatory Definition
    of Done item for every future phase**, alongside typecheck, lint, build, documentation update, and
    git checkpoint. Established by the final visual consistency audit (above), which caught two real
    defects (§ above) that static review and `typecheck`/`lint`/`build` alone did not. Full statement
    now lives in `docs/IMPLEMENTATION_PLAN.md`'s "Definition of Done — Generic Criteria" section — that
    is the canonical copy; this entry exists so the decision is discoverable from this file too.
16. **Project Unit model — RESOLVED 2026-07-03, pre-Phase-3 architecture review.** A `ProjectSite` no
    longer owns a Branch Code or Department — it's a pure client/location record. A new, dedicated
    `ProjectUnit` module sits one level under it: the actual operational sub-division (a specific bank
    branch, mall department, retail section) an employee is deputed to, owning its own code and name.
    Internally one generic model regardless of what a client calls it; the UI always displays that
    site's own configured term (`ProjectSite.unitLabel`, e.g. "Branch"/"Department"/"Section") in its
    place. `Employee.unitId` and (Phase 3) `PayrollEntryWorkLine.unitId` both reference it, each paired
    with the corresponding `siteId` via a composite foreign key so a unit belonging to the *wrong* site
    is a database-level impossibility, not just an application check. Full spec:
    `docs/architecture/database-schema.md` §8/§8a/§9. This directly replaces the flat
    `ProjectSite.branchCode` shipped in Phase 1/2 — the project's first genuinely destructive schema
    change, low-risk only because it's never been applied to a live database, tracked as
    `docs/IMPLEMENTATION_PLAN.md`'s new Phase 2.5.
17. **Payroll Entry Work Lines model — RESOLVED 2026-07-03, arrived at through an explicit
    business-workflow-first design conversation (not schema-first).** An employee's attendance can be
    attributed to more than one Project Unit within a single payroll cycle — an occasional but
    natively-supported workflow, motivated by the real-world fact that physical attendance registers
    exist per branch/department, not per employee. The design, and why it landed here rather than at
    two other candidate shapes considered and rejected along the way:
    - **`PayrollEntry` keeps its exact existing identity and behavior** — one row per employee per
      cycle, the sole release/hold/Correction target, the sole thing Bank Sheets/Payslips/net-salary
      read. Nothing about release, Corrections, or payment changes because of this decision.
    - **Attendance (`days`, `otHours`, `otRate`, `cycleDays`) moves entirely onto a new child table,
      `PayrollEntryWorkLine`** — one row per unit worked, and **every `PayrollEntry` always has at
      least one**, created transactionally with the entry itself, never optional/zero. This was a
      deliberate simplification over an earlier "optional split, plain scalars otherwise" design: with
      lines always present, `calcNet` has exactly one calculation path (sum across lines; an ordinary
      single-unit entry is a sum of one term) instead of two branches to keep in sync.
    - **Explicit business rule (2026-07-03), not merely a schema implication: a
      `PayrollEntryWorkLine` may only reference a `ProjectUnit` belonging to the same `ProjectSite` as
      its parent `PayrollEntry` — an employee's Work Lines can never span more than one Project Site
      within a single cycle.** Enforced at two independent layers: a database-level composite foreign
      key (`(unitId, siteId) → ProjectUnit(id, siteId)`) and application-layer validation — neither
      is a substitute for the other. This is what makes multi-unit splitting always intra-site with
      no cross-site editing exception: since a `ProjectUnit` belongs to exactly one `ProjectSite` and
      Payroll Staff are assigned at the site level (unchanged), a Payroll Staff member with site
      access already has every unit under it, resolving what had looked like the hardest open
      question going in without any new RBAC concept.
    - **`Employee.unitId` is the *current default* unit only** — a payroll cycle's attendance
      breakdown never writes back to it; changing the default is a distinct, audited Employee edit
      (a "transfer"), same as `siteId` already works. A new cycle's carry-forward always resets a
      continuing employee to one fresh line seeded from their current default unit, never inheriting
      the source cycle's split structure.
    - **Gross pay was verified, not assumed, to be unit-invariant.** Checked against
      `reference/PROJECT_SPEC.md` and the schema doc before finalizing: gross pay is documented
      everywhere as a single per-employee scalar; only the day-rate *basis* (cycle days, OT rate,
      leave rate) is documented as location-varying — previously by site, now by unit. If real-world
      practice differs (a department legitimately paying a different rate for the same person), this
      finding needs revisiting before Phase 3 schema work — flagged, not yet contradicted by anything
      on record.
    - Leave days/leave rate stay at the employee level, not per-line — leave is absence from work
      entirely, not attributable to a specific unit. This is the one place a judgment call was made
      without an explicit business rule behind it; noted as such at decision time.
    - Full spec: `docs/architecture/database-schema.md` §12/§12a.
18. **Date display standard — RESOLVED 2026-07-03: every user-facing date renders as `DD-MM-YYYY`,
    everywhere, no exception.** Internal storage/API remain ISO, unchanged — this is a
    presentation-layer convention only, documented in `docs/design-system.md` §4 alongside the
    existing Numbers convention. A real, previously-unflagged gap was found while scoping this: no
    date-formatting convention or shared utility exists anywhere in the codebase today — Employee
    Registry's DOB/DOJ/DOL fields currently use raw ISO-string slicing and native `<input type="date">`
    elements, which render in the browser's OS locale and can't be forced to `DD-MM-YYYY` by a
    formatting function alone. A shared `formatDate()` utility and (likely) a custom masked date input
    component are needed — tracked into Phase 2.5 for the Employee Registry's existing date fields, so
    later phases inherit a working pattern instead of building one under their own time pressure.
19. **Performance target raised to a 10,000-employee design floor — RESOLVED 2026-07-03, now
    `docs/PROJECT_PRINCIPLES.md` Principle 10.** The client's explicit motivation for this project is
    eliminating the performance/stability collapse of their prior Excel-based process under real
    headcount and history — so "the system works fine at today's ~1,500 employees" was reframed as
    the wrong bar. The system must comfortably support at least 10,000 without noticeable slowdown or
    instability, applied as a standing design input for every phase (virtualized tables, server-side
    pagination, indexed queries/efficient joins, background processing for long operations, bulk DB
    operations, avoiding load-unbounded-data-into-memory patterns and non-scaling algorithms) rather
    than a Phase 9 hardening concern. `docs/PROJECT_PRINCIPLES.md` Principle 4 (never sacrifice
    correctness for performance) is explicitly not in tension with this — the listed techniques are
    correctness-neutral. Every "~1,500 employees" reference remaining in `docs/architecture/*.md`
    describes today's actual/test-fixture scale and should be read alongside this floor, not in place
    of it.
20. **CNIC duplicate detection — recommendation given 2026-07-03, final decision explicitly reserved
    by the user before any constraint change is implemented.** Requirement: validate format, normalize
    before comparison/storage, live duplicate-check while entering a record (surfacing which existing
    employee already holds that CNIC), never silently accept a duplicate. Recommendation: **keep
    `cnic` database-unique (already true today, partial index) and add no override** — a CNIC is a
    real-world unique identifier, so an apparent duplicate is always a data-entry mistake or the same
    person already existing; the legitimate case that might tempt an override (a rehire) should be
    handled by **reactivating the existing record**, not creating a second row with the same CNIC. This
    surfaced a real gap: Phase 2 built "Mark as Left" but no symmetric "Reactivate" action — needed to
    make the recommendation practically usable, tracked into Phase 2.5. Also tracked into Phase 2.5,
    independent of the constraint decision: normalizing CNIC input (stripping dashes/spaces) *before*
    validation, not just before storage — today's Zod pattern requires digits-only input and rejects
    the commonly-written dashed form outright, rather than normalizing it. Full write-up, including
    why the two rejected alternatives (silent accept, or a gated override) were rejected:
    `docs/architecture/database-schema.md` §26 item 6.
22. **Phase 2.5 amendments — RESOLVED 2026-07-03 (session 2), plan approved with five changes before
    any code was written.** The user approved the Phase 2.5 plan (§ above, items 16–21) on the
    condition of these amendments, now written into `docs/IMPLEMENTATION_PLAN.md`'s Phase 2.5 section
    and `docs/architecture/database-schema.md` (§8b, §9, §21, §22, §25, §26 item 6):
    - A new **Checkpoint 0 (Foundation)** precedes Project Units: the shared `formatDate()`/parse
      utilities, the `DD-MM-YYYY` display convention, a reusable `DateInput` component, and a reusable
      Site → Unit cascading select — built once, ahead of the checkpoints that all need it, rather than
      duplicated.
    - **Import-time Site/Unit validation is now a three-layer requirement**: import-layer per-row
      check, backend/service-layer assertion, and the database composite FK — the same defense-in-depth
      pattern already used for the Work Line same-site rule (§12a), now explicitly required for the
      Employee import path too.
    - **Employee transfers (site and/or unit change) now write a dedicated `employee.transferred`
      `AuditLog` entry** (old unit, new unit, old site, new site, actor, timestamp) **instead of** the
      generic `employee.updated` entry for that specific edit — not merely a diff buried in a generic
      update's metadata.
    - **CNIC duplicate handling is now a final decision, not a recommendation**: CNIC stays globally
      unique, no duplicate `Employee` rows are ever permitted, and rehires go exclusively through a new
      Reactivate Employee action that preserves the existing row (and its historical `PayrollEntry`
      links) while updating current details. See §26 item 6's rewritten resolution.
    - **A new `EmployeeTransferHistory` table** (§8b) — lightweight, append-only, one row per transfer
      (from/to site, from/to unit, `effectiveDate`, `transferredByUserId`, optional `reason`, optional
      `remarks`, `createdAt`) — is added alongside the `AuditLog` entry above, mirroring the existing
      `BalanceAdjustment`-vs-`AuditLog` pattern (a generic log plus a purpose-built typed table). No UI
      consumes it in Phase 2.5; it's designed so a Transfer History screen can be built later without a
      schema change.
    Per standing instruction, the CNIC/Reactivate checkpoint's concrete implementation (exact endpoint
    shapes, exact fields touched, exact audit contents) still gets presented for explicit approval
    before that checkpoint's code is written, even though the underlying policy is now final — this is
    a design-review gate, not a re-opening of the decision itself.
    **Refined further, same day, before any code was written:** (a) `EmployeeTransferHistory` gained
    `effectiveDate` (the date the transfer actually took effect in the business, distinct from
    `createdAt` — HR may enter a transfer after the fact) and `remarks` (distinct from `reason`), and
    its acting-user column is named `transferredByUserId`; it remains append-only with no
    update/delete path except direct database intervention (an application-layer convention, not a DB
    trigger — see §8b's note on how this differs from `AuditLog`'s stronger guarantee). (b) Checkpoint
    0's single-source-of-truth requirement was made explicit and enforced, not just built: no component
    may call `toLocaleDateString()` or format/parse a date independently — every displayed date goes
    through `formatDate()`, every editable date through `DateInput` — verified by grepping the codebase
    for ad-hoc date formatting before the checkpoint is considered complete. **Noted for the future
    roadmap, no action required now**: once `EmployeeTransferHistory` exists, it will support
    point-in-time and aggregate queries ("where did this employee work on 15 March," "how many
    transfers has this employee had," "which employees transferred into a given unit this year") —
    this is why its column design (typed `effectiveDate`, not a JSON blob) was worth getting right in
    Phase 2.5 even though no reporting UI is built until later.
23. **Deployment/portability model — REAFFIRMED 2026-07-03, no change.** Re-confirmed as part of this
    session's scope: single-company-per-installation (one database per company, the `CompanySettings`
    singleton, no `Tenant`/`Organization`/`Workspace` abstraction), deployable on whichever
    server/hosting a given customer provides — same conclusion already recorded 2026-07-02 (§3 item
    13), restated here because the user's instructions this session explicitly asked for it to be
    re-verified against the new Project Unit/Work Line changes. Nothing about either change touches
    the deployment/tenancy model.

---

## 4. Known limitations

- **Database verification is still outstanding for both Phase 1 and Phase 2 — tracked, not
  blocking.** No Docker, Docker Compose, Podman, Homebrew, native `psql`/`pg_ctl`, or Postgres.app
  has been available in any sandboxed session so far. None of the DB-backed integration tests
  (`auth.test.ts`, `audit-log.test.ts`, `project-sites.test.ts`, `employees.test.ts`,
  `employees-import-export.test.ts`, `settings.test.ts`, `users.test.ts`) have been confirmed
  passing anywhere — not in this session, and no CI run or completion report from any prior session
  shows evidence they were run before either. `rbac.test.ts` is a pure unit test (no DB) and its
  logic has been read-reviewed but not executed. The hand-written migration SQL
  (`20260702084133_phase2_master_data`) has likewise never been applied to a real database — it was
  built to mirror Prisma's generated-SQL conventions exactly (cross-checked against the Phase 1
  migration's actual output) and validated via `prisma validate`/`generate`/`format`, but that is
  static confidence, not a `migrate deploy` run. The same applies to the smaller, later
  `20260702165738_project_site_address` migration (the UI-polish-pass `address` column) — validated
  statically, never run against a live database. **This must be closed out — either by running the
  full suite in a Postgres-capable environment or via a real CI run — before Phase 9's production
  hardening pass at the latest, and ideally as soon as Docker/Postgres is available.**
- CI (`.github/workflows/ci.yml`) has never actually run — nothing has been pushed to a remote/PR
  yet. Pushing to get a real CI-backed Postgres run remains the fastest way to close the item above.
- `StorageProvider` does not exist despite being called for in Phase 0 — see §3 item 4. Logo/avatar
  upload UI was deliberately left out of Phase 2's Settings module for this reason.
- `README.md` previously stated "Phase 1 complete" without this verification caveat; corrected in a
  prior session's documentation pass, and now updated again for Phase 2.
- **New 2026-07-03**: Phase 2.5 (Project Units, Payroll Work Lines prerequisite, Employee Registry
  refinements — §3 items 16–20) is architecture/documentation only as of this session — no migration,
  module, or frontend code exists for it yet. Do not assume `ProjectUnit`/`Employee.unitId` are queryable
  anywhere in the current codebase.

---

## 5. Exact next action for the next development session

**Phase 1 and Phase 2 are both closed (conditional). Phase 2.5 is in progress: Checkpoint 0 is
committed (`0d9ea33`); Checkpoint 1 (`ProjectUnit` schema, migration, dedicated module, Manage Units
UI) is code-complete as of 2026-07-03 but not yet committed — awaiting explicit approval before
Checkpoint 2 begins.** Carry forward as background open items, not blockers, unless noted:

1. **Awaiting explicit approval to commit Checkpoint 1 and begin Checkpoint 2** —
   `Employee.unitId` + composite FK, the dedicated transfer-audit trail
   (`employee.transferred` `AuditLog` entries), and the new `EmployeeTransferHistory` table. Then
   Checkpoint 3 (import/export remap + three-layer Site/Unit validation), and Checkpoint 4 (CNIC
   normalization + duplicate-check + Reactivate, gated on a separate concrete-implementation approval
   per standing instruction) — all before Phase 3's Payroll Entry Work Lines build, which depends on
   `Employee.unitId` existing (Checkpoint 2).
2. Close out the DB-backed verification gap (§4) — via a Docker/Postgres-capable environment or a
   real CI push — before Phase 9 at the latest. This now covers Phase 1's and Phase 2's test suites,
   the hand-written Phase 2 migration, and the later `address`-column migration.
3. Build `StorageProvider` — confirmed deferred until **before Phase 5** (§3 item 4; Backup Package
   generation hard-requires it). Not scheduled into Phase 2.5, 3, or 4. File uploads (logo/avatar)
   stay unavailable until then. **New consideration (§3 item 13)**: design it for portability to
   whatever hosting a given customer provides, not assumed cloud-provider-specific.
4. Confirm the two still-open design assumptions from `docs/architecture/database-schema.md` §26:
   item 5 (calendar-month-only cycles) before Phase 3, item 3 (at-most-one-`ACTIVE`-`Advance`-per-type)
   before Phase 4.
5. **CNIC duplicate-handling final decision (§3 item 20 / §26 item 6)** — a recommendation has been
   given (keep the database-unique constraint, no override, add a Reactivate action) but the user has
   explicitly reserved final sign-off; get that decision before Phase 2.5 implements anything
   constraint-related.
6. Decide the two Company Bank Account sub-questions (§3 item 7) before Phase 4 schema work begins.
7. When Phase 3 is explicitly authorized to start (Payroll Entry & Payroll Processing per
   `docs/IMPLEMENTATION_PLAN.md` — the largest single phase in the plan: `calcNet` over Work Lines,
   the Payroll Entry grid at a 10,000-employee design floor (Principle 10), optimistic locking), its
   Definition of Done now includes Playwright-driven visual verification (§3 item 15) and a
   Principle-10 performance review, not just typecheck/lint/build.
