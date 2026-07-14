# Project Progress — Payroll Management System

**Date:** 2026-07-10 (a new session, following the five sessions on 2026-07-09 that closed Phase 3
Checkpoints 2–5 — see those dated entries in §1, preserved unchanged below this point). This
session ran a read-only Checkpoint 6 architecture review, froze five decisions (measurement-first;
keep the in-memory grid architecture; parallelize the page fetch only if measurement justified it;
leave `LiveTotalsStore` and the cache-invalidation strategy unchanged unless measurement proved
otherwise; concrete engineering targets), then implemented, measured, and verified Checkpoint 6
against those frozen decisions — including finding and fixing one genuine pre-existing correctness
bug the measurement work surfaced (see §1's "Phase 3, Checkpoint 6" entry) — and, following review
and approval, **committed as `3298e34`. Phase 3 (Checkpoints 0–6) is now fully complete and closed.**
**The same day, a second, later revision** ran a two-round, read-only architecture review of the
previously-planned Team Collaboration/Chat panel, culminating in an approved decision to permanently
remove Chat and insert a new **Phase 3.5 — Tasks Workspace** between Phase 3 and Phase 4, plus a
permanent HTML-prototype Definition-of-Done rule — committed as `0fb296e` (Checkpoint 0). **Three
further gated checkpoints then implemented the Tasks Workspace itself** — database foundation and
shared contracts (Checkpoint 1), the backend service/route/notification layer (Checkpoint 2), and the
complete frontend plus the required prototype and testing (Checkpoint 3, which found and fixed two
real defects via its own real-stack Playwright pass) — landing together in one implementation commit,
`1220dce`, after each checkpoint's own review and approval. **Phase 3.5 (Checkpoints 0–3) is now
fully complete and closed** — see §1's "Phase 3.5" entries for the full record. **Phase 4 has NOT
started** and requires its own separate, explicit authorization.
**Latest committed commit:** `1220dce` — "feat(tasks): complete Phase 3.5 Tasks Workspace" (session
lineage: `2e804d4` closed Phase 1 → `674ab04` landed Phase 2's
substantive build → `89ac6ff` Phase 2 UI/UX polish pass + final visual consistency audit → `11cdc9d`
Phase 2 checkpoint documentation → `b7ba9cf` the pre-Phase-3 architecture review → `74c124e` further
doc status update → `0d9ea33` Phase 2.5 Checkpoint 0 → `c60094c` Phase 2.5 Checkpoint 1 → `70a45ad`
Phase 2.5 Checkpoint 2 → `b27f559` Checkpoint 2 doc close → `ed4ed1f` database-verification debt
closed (2026-07-04) → `33f2b18` Phase 2.5 Checkpoint 3 → `28d4192` doc-only commit hash record →
`e26fe8c` Phase 2.5 Checkpoint 4 → `0ca9a8f` doc-only commit hash record, closing Phase 2.5 →
`1c4d61f` Phase 3 architecture freeze, doc-only → `aefa64f` Phase 3 Checkpoint 0 implementation →
`d9c3184` doc-only commit hash record → `55eda58` Phase 3 Checkpoint 1 implementation → `0d54a97`
Advance Deduction Deferral architecture amendment, doc-only, frozen → `e072da5` Phase 3 Checkpoint 2
(Payroll Entry grid frontend) implementation, reviewed and committed → `3479bff` doc-only commit hash
record, closing Checkpoint 2 → `6be6e68` Phase 3 Checkpoint 3 (Split by Unit workflow) implementation,
reviewed, verified, and committed → `70a52da` Phase 3 Checkpoint 4 (multi-site filtering and Copy to
All) implementation, reviewed, verified, and committed → `b4c1d21` Phase 3 Checkpoint 5 (Payroll
Entry CSV/Excel import/export) implementation, reviewed, verified, and committed → `4da8a01` doc-only
commit hash record, closing Checkpoint 5 → `3298e34` Phase 3 Checkpoint 6 (10,000-employee
performance/concurrency validation) implementation, reviewed, verified, and committed → `fbf8ffc`
doc-only commit hash record, closing Checkpoint 6 and Phase 3 → `0fb296e` Phase 3.5 Checkpoint 0
(Chat removal, Tasks Workspace, and Phase Close-Out Rule architecture revision) implementation,
reviewed, verified, and committed → `1220dce` Phase 3.5 Checkpoints 1–3 (Tasks Workspace database
foundation, backend, and frontend/prototype/testing) implementation, reviewed, verified, and
committed).
**Branch:** `main`
**Current implementation phase:** **Phase 3 is now fully complete and closed — all seven checkpoints
(0–6) are committed, and the phase's own 🛑 review checkpoint has passed.** Checkpoint 6's read-only
architecture review covered the rendering/virtualization/React Query/autosave architecture
Checkpoints 0–5 already built, and froze five decisions before any code was written: keep the
existing in-memory grid architecture rather than moving to server-side windowed fetching; only
replace `LiveTotalsStore`'s full-recomputation model if measurement proved it was the bottleneck;
leave the `invalidateQueries` cache strategy unchanged unless measurement proved otherwise; concrete
engineering targets (not hard SLAs) for load time, typing latency, scroll smoothness, bulk-update
speed, and memory stability; and that the Definition of Done's "review, release" clause is
historical wording predating the checkpoint restructuring, not part of this checkpoint's scope.
Measurement (a new, committed 10,000-employee backend performance/concurrency test suite, plus a
real-browser Playwright pass) then justified exactly one architectural change — parallelizing the
frontend's page-to-completion fetch — and surfaced one genuine pre-existing correctness bug (every
bootstrapped `PayrollEntry` defaulted to `sortOrder = 0`, making pagination unstable at 10,000 tied
rows), which was fixed with its own regression test. `LiveTotalsStore` and the cache-invalidation
strategy were both measured and deliberately left unchanged, per their respective frozen decisions.
All Decision 4 targets were met and verified against a real browser. Full detail: §1's "Phase 3,
Checkpoint 6" entry, below.

**A separate, later architecture revision the same day** inserted **Phase 3.5 — Tasks Workspace**
between Phase 3 and Phase 4: the previously-planned Team Collaboration/Chat panel is permanently
removed (not deferred) and replaced with a lightweight, ownership-based internal task-delegation tool,
plus a new permanent HTML-prototype Definition-of-Done rule (Checkpoint 0, committed as `0fb296e`).
**Three further gated checkpoints then implemented it in full** — database foundation and shared
contracts (Checkpoint 1), the backend service/route/notification layer (Checkpoint 2), and the
complete frontend, required prototype, and testing (Checkpoint 3) — committed together as `1220dce`
after 208/208 backend tests and an 18/18 real-stack Playwright pass. **Phase 3.5 (Checkpoints 0–3) is
now fully complete and closed.** Full detail: §1's "Phase 3.5" entries, below. **Phase 4 has not
started** and requires its own separate, explicit authorization.

**Update, 2026-07-11 — Phase 4 has now begun.** Checkpoint 1 (Bank Registry) was implemented and
committed as `7c2cdb5`, though its own commit did not update this file at the time — reconciled
retroactively in a later session (below). Checkpoint 2 (Finance Role and Salary Release foundation)
followed, reviewed, approved, verified, and committed as `cedf386`. Checkpoint 3 (Bank Sheets)
followed in a later session, reviewed, approved, verified, and committed as a single commit.
Full detail: §1's "Phase 4, Checkpoint 1," "Checkpoint 2," and "Checkpoint 3" entries.
**Update, same day — a read-only architecture review (no code, no schema, no migrations) evaluated
building Employee Statements next and confirmed it is NOT Phase 4 Checkpoint 4 (or any other Phase 4
work): a complete Statement of Account depends on Corrections, Balance Adjustments, and Advances,
none of which exist yet (Phase 6 and Phase 4's own not-yet-built Advances sub-scope respectively).
Employee Statements remains Phase 7 scope, exactly as `docs/IMPLEMENTATION_PLAN.md` already specified
before this review — this is a confirmation of the existing frozen plan, not a redesign. Full
detail: §1's "Phase 4 — Employee Statements Architecture Review and Scope Decision" entry, below.
**Checkpoint 4 (Cash Receiving Sheets) was then reviewed (architecture-only), approved, implemented,
reviewed, verified, and COMMITTED as `477fbb1`** — a dedicated module separate from Bank Sheets,
reusing the existing `bank-sheets:view` permission and Bank Sheets' own shipped `bankId IS NULL` Cash
rule unchanged, CSV/XLSX export only. Full detail: §1's "Phase 4, Checkpoint 4" entry, below.
**Checkpoint 5 (Advances) was then reviewed (architecture-only), approved, implemented, reviewed,
verified, and COMMITTED as `75c5e64`** — `Advance`/`ScheduledPayrollPeriod`/`AdvanceScheduleChange`,
at-most-one-`ACTIVE`-per-type now confirmed and enforced, automatic deduction materialization via a
direct call (not a generic provider/hook registry) from `payroll-processing.service.ts`, schedule
deferral with a complete append-only history, no new permission (`advances:manage` already existed).
Full detail: §1's "Phase 4, Checkpoint 5" entry, below.
**Phase 4's remaining scope (Payslip generation, or any other later Phase 4 work) has not started**
and requires its own separate, explicit authorization — do not begin it without that.

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
  `docs/architecture/database/`: `Role`, `Permission`, `RolePermission`, `User`,
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
  `database/employee.md` §9 field set, `PayType` enum, partial-unique `cnic`/
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
  client confirmation, matching the spirit of `database/schema-invariants.md` §26.
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

### Phase 2.5, Checkpoint 1 — `ProjectUnit` schema, migration, dedicated module (2026-07-03, COMMITTED as `c60094c`)

- **Schema/migration**: `ProjectUnit` model added to `backend/prisma/schema.prisma`
  (`database/sites-and-units.md` §8a — id, siteId, name, code, isActive, timestamps;
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
  while any `ProjectUnit` still belongs to the site (`database/sites-and-units.md §8`'s revision note: "a site must have both its
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

### Phase 2.5, Checkpoint 2 — Employee → Project Unit relationship (2026-07-04, COMMITTED as `70a45ad`)

- **Schema/migration**: `Employee.unitId` added, composite-FK'd against `ProjectUnit(id, siteId)`
  (`database/employee.md` §9) — NOT NULL, no default, matching how `siteId` has
  always been required; safe only because no live database has ever applied a migration in this
  environment (same precedent as Checkpoint 1's `branchCode` drop). New, append-only
  `EmployeeTransferHistory` table (§8b) exactly as speced in the amended Phase 2.5 plan:
  `fromSiteId`/`toSiteId`/`fromUnitId`/`toUnitId`, `effectiveDate` (date the transfer actually took
  effect, distinct from `createdAt`), `transferredByUserId`, optional `reason`/`remarks`. Migration
  `20260703140000_employee_unit_and_transfer_history`, generated via `prisma migrate diff` against
  the schema files (no live DB needed), following the same convention as every prior hand-placed
  migration this session.
- **Backend (`employees.service.ts`)**: `assertUnitBelongsToSite()` — the composite-FK's
  application-layer companion, giving a clean 400 instead of a raw Postgres constraint violation,
  called on create and whenever a transfer occurs. `createEmployee` now validates and stores
  `unitId`. `updateEmployee` was substantially rewritten: it detects a transfer by comparing the
  submitted `siteId`/`unitId` against the employee's current values, and — **the explicit
  atomicity requirement** — performs the `Employee` update, the `EmployeeTransferHistory` insert,
  and the `employee.transferred` `AuditLog` entry all inside one `prisma.$transaction(...)`. Any
  *other* fields changed in the same request still produce the ordinary `employee.updated` entry
  (excluding `siteId`/`unitId`, which own the dedicated transfer entry instead) — also written
  inside the same transaction. **This closes a real, pre-existing atomicity gap**: before this
  checkpoint, the generic `employee.updated` audit entry was written by the route handler *after*
  the service call returned, not in the same database transaction as the Employee row update — a
  Principle 3 violation that predated Checkpoint 2 but was only surfaced by implementing the
  transfer case's explicit "atomic in a single transaction" requirement properly. Fixed for both
  paths, not just the new one. `updateEmployee`'s signature now takes a `RequestMeta`
  (ip/user-agent) parameter so audit entries written inside the transaction still carry that
  information, matching every other audited action in this codebase.
- **Frontend**: a new reusable `SiteUnitSelect` component
  (`frontend/src/components/ui/site-unit-select.tsx`) — the Site → Unit cascading selector deferred
  from Checkpoint 0 (then Checkpoint 1) to here, the first place one is actually needed. Selecting a
  site filters the unit picker to that site's own units and resets any unit selection that belonged
  to a different site; the unit field's label and empty-state placeholder are driven by the
  selected site's `unitLabel`, not hardcoded. Wired into the Employee Registry's create/edit form in
  place of the old plain Site-only select.
- **Interim import/export unit handling** (Checkpoint 2's "respects the Site/Unit relationship where
  applicable" objective — the full column remap is Checkpoint 3): export's "Branch Code" column
  (blank since Checkpoint 1, when `ProjectSite.branchCode` was removed) now populates with the
  employee's real `ProjectUnit.code`. Import resolves a row's unit from its site alone: if the site
  has exactly one `ProjectUnit`, it's used automatically; if the site has zero or more than one, the
  row is skipped with a clear, specific reason (distinct messages for each case) rather than
  guessing — an explicit, honest interim limitation until Checkpoint 3's real column mapping lands.
- **`deleteProjectUnit`'s delete guard, a documented no-op since Checkpoint 1, is now wired up**:
  Checkpoint 1's `project-units.service.ts` left an explicit forward-reference comment saying an
  `Employee.count({ where: { unitId } })` guard belonged there "the moment Checkpoint 2 lands" — done
  now, honoring that comment rather than leaving it stale. Mirrors `deleteProjectSite`'s existing
  employee-count check exactly. The `PayrollEntryWorkLine` half of this guard still belongs here once
  Phase 3 adds that table.
- **RBAC unchanged, as required**: no new unit-level permission or scoping concept was introduced.
  `assertSiteAccess()` continues to be the entire site-scoping check; a Payroll Staff user's access
  to a unit is still entirely governed by their access to that unit's site, per the 2026-07-03
  architecture decision that this needs no separate unit-granular RBAC.
- **New/updated backend tests**: `employees.test.ts` gained a transfer test (asserts exactly one
  `EmployeeTransferHistory` row, an `employee.transferred` entry, and *no* `employee.updated` entry
  for that same edit) and a composite-FK-boundary test (assigning a unit from a different site is
  rejected with 400). Every existing test fixture that directly created an `Employee` via Prisma or
  the API was updated to also create/reference a `ProjectUnit` (`unitId` is now required) —
  `employees.test.ts`, `employees-import-export.test.ts` (plus two new tests for the zero-units and
  multiple-units import-skip cases), `project-sites.test.ts`. All confirmed to compile and execute
  correctly through `ts-jest`, failing only on the expected "no Postgres reachable" constraint.
- **A grep-caught bug, fixed during this checkpoint, not after**: the initial "site has no {unit
  label}s" import-skip message was built with naive string concatenation (`unitLabel + 's'`),
  producing "branchs" instead of "branches" for the default label — inconsistent with the
  `pluralize()` utility Checkpoint 1 already built for exactly this. Fixed to reuse `pluralize()`,
  per the standing "no duplicated utilities" rule.
- `npm run typecheck`, `npm run lint` (0 errors, same 3 pre-existing warnings), and `npm run build`
  all clean across all three workspaces. **A stale `tsc -b` incremental cache masked a real type
  error the first time typecheck ran this checkpoint** (frontend's `dist-types-app/*.tsbuildinfo`
  didn't pick up `@payroll/shared`'s rebuilt `unitId`-required type) — caught by suspicion that a
  clean pass looked too easy given `employees-page.tsx` hadn't been touched yet; clearing the cache
  surfaced the real, expected missing-`unitId` error, which was then fixed by building the
  `SiteUnitSelect` integration. Worth remembering: **whenever `@payroll/shared` changes, clear
  frontend's `.tsbuildinfo` before trusting a clean typecheck.**
- Playwright verification (headless Chromium, API responses mocked via route interception): the New
  Employee form's Unit field is disabled with no site selected, then filters to the selected site's
  units and relabels itself (Branch/Department) correctly on site change, resetting any stale unit
  selection; the submitted create payload includes both `siteId`/`unitId`; the Edit form correctly
  pre-populates from an existing employee's site/unit; changing only the unit (a same-site transfer)
  submits the new `unitId` in the update payload. Zero console errors throughout.

### Phase 2.5, Checkpoint 3 — Import/export remap to Project Units, three-layer validation (2026-07-04)

Built immediately after the database verification below closed, against the live database
throughout — the first checkpoint in this project developed with its DB-backed tests actually
running.

- **Export remap** (`employees-import-export.service.ts`): `Area` and `Area/Location` now export
  the employee's `ProjectUnit.name` (they previously both aliased the site name); `Branch Code`
  exports `ProjectUnit.code` (as since Checkpoint 2). The header-mapping doc comment rewritten as a
  finalized mapping rather than a flagged assumption — `database/sites-and-units.md` §8's "those columns now
  map onto ProjectUnit fields" is now literally true in code.
- **Import unit resolution** (`resolveRowUnit()`): a row's unit resolves within its named site by
  `Branch Code` (matches `ProjectUnit.code`) first, then `Area`/`Area/Location` (match
  `ProjectUnit.name`; the two are aliases and must agree when both present), case-insensitively.
  Every provided column must identify the same unit; a row naming no unit is a per-row error.
  Checkpoint 2's interim single-unit auto-resolution is fully removed. Error messages are phrased
  in the site's own `unitLabel` terminology (reusing `pluralize()`), e.g. *"No branch named X under
  site Y"*.
- **Three-layer Site/Unit validation, as planned** (`docs/IMPLEMENTATION_PLAN.md`): **(1)** import
  layer — `resolveRowUnit()` explicitly distinguishes "no such unit anywhere" from "unit exists but
  belongs to a different project site" and rejects the row with the mismatch named; **(2)** service
  layer — `assertUnitBelongsToSite()` (now exported from `employees.service.ts`, the same assertion
  the ordinary create/update path uses) is re-asserted before every import write; **(3)** database —
  the `(unitId, siteId) → ProjectUnit(id, siteId)` composite FK, now covered by its own raw-write
  test proving it catches a mismatched pair alone.
- **Import-driven transfers are real transfers**: an import update that changes an employee's
  site/unit writes the `EmployeeTransferHistory` row and dedicated `employee.transferred` audit
  entry (reason: `"Employee Registry import"`) in the same transaction as the row update — required
  by the 2026-07-03 "never fold a transfer into a generic update path" decision, which became
  reachable the moment import could target specific units. Implemented by extracting
  `updateEmployee()`'s transfer block into a shared `recordEmployeeTransfer()` helper so both paths
  use one implementation (no duplication). The one-summary-`employee.import`-entry design is
  unchanged for everything else. Unchanged-site/unit re-imports write no transfer record (tested).
- **Route change**: `importEmployees()` now receives `RequestMeta` (ip/user-agent) so
  transfer audit entries written inside the import carry the same request context as every other
  audited action.
- **Tests**: `employees-import-export.test.ts` reworked — fixtures now name their units; the two
  interim-behavior tests (zero-units / multiple-units skip) replaced by: multi-unit import resolving
  by name and by code (case-insensitive), the export column remap, no-unit-specified rejection,
  layer-1 cross-site rejection, layer-1 code/name-conflict rejection, layer-3 raw-write FK
  rejection, transfer-on-import (history + audit entry), and no-transfer-on-unchanged-reimport.
  **Full suite: 88/88 against live PostgreSQL.**
- typecheck/lint/build clean. **Real-stack Playwright verification** (live browser → Vite → Express
  → PostgreSQL): uploaded a real CSV through the Employee Registry's Import button covering a
  by-name row, a by-code row, and a deliberate cross-site row — Import Results modal showed
  "2 created / 1 skipped" with the exact per-row cross-site reason (worded in the site's `unitLabel`
  terminology); both created employees appeared in the list with the correct units (verified via the
  edit form's cascading selector) and the imported `DD-MM-YYYY` DOB round-tripped correctly; zero
  console errors. `docs/prototypes/*.html` reviewed — no prototype depicts import file contents or
  the Import Results modal, so none required changes.

### Phase 2.5, Checkpoint 4 — CNIC normalization, duplicate-check, Reactivate workflow (2026-07-05, COMMITTED as `e26fe8c`)

Resumed after a session interruption; the working tree already held partial progress from before
the crash (`shared/src/lib/cnic.ts`, its export, Zod normalization, and an unwired
`checkCnicAvailability()` service function) — verified against the docs, confirmed genuine, and
built on rather than redone. The concrete design (endpoint shapes, exact fields Reactivate touches,
audit contents) was presented and approved this session, with one added requirement: reactivation
and CNIC lookup must each have exactly one implementation, reused by every caller.

- **`normalizeCnic()`** (`shared/src/lib/cnic.ts`) — strips non-digit characters before validating,
  not just before storing; used by `createEmployeeSchema`/`updateEmployeeSchema`'s CNIC preprocessor
  (already in place pre-crash) and by every backend CNIC lookup below.
- **`findEmployeeByCnic()`** (`employees.service.ts`, new) — the single normalized-CNIC lookup.
  Refactored `checkCnicAvailability()` to use it, and **fixed a real bug** in
  `employees-import-export.service.ts`: the importer's existing-employee match previously compared
  against the *raw* CSV cell (`row.cells['CNIC']`), not the normalized value — a dashed CNIC in an
  import file would never match the digits-only value already stored, so a rehire's row would
  silently fall through to "create new" instead of finding the record on file. Now both the
  duplicate-check endpoint and the importer call the same function.
- **`GET /api/v1/employees/check-cnic?cnic=&excludeId=`** — wired to the already-written
  `checkCnicAvailability()`. RBAC-masked: a Payroll Staff caller outside the holder's site sees only
  `exists: true, employee: null`; Master Admin and a same-site Payroll Staff caller see full detail
  (id, name, code, site, active/departed). Registered ahead of `GET /:id` in the route table so
  Express doesn't match "check-cnic" as an `:id` param.
- **`reactivateEmployee()`** (`employees.service.ts`, new) — the single Reactivate implementation.
  Guards: 404 if the employee doesn't exist or is outside the caller's site access; 400 if
  `dateOfLeaving` is already null ("Employee is already active"). Accepts the same partial field set
  an ordinary edit does (extracted into a shared `mapUpdateInputToData()` helper, now used by both
  `updateEmployee` and `reactivateEmployee` — one mapping, not two). Clears `dateOfLeaving`; if the
  supplied `siteId`/`unitId` differs from what's on file, reuses the existing
  `recordEmployeeTransfer()` so the `EmployeeTransferHistory` row and `employee.transferred` entry
  fire in the same transaction as a distinct `employee.reactivated` entry (never a generic
  `employee.updated` for this action) — mirroring how `updateEmployee` already separates transfer
  and generic-update audit entries. Never a second `Employee` row for the same CNIC (Principle 2 —
  historical `PayrollEntry` links keep referencing the one `employeeId`).
- **`POST /api/v1/employees/:id/reactivate`** — parses the body with the existing
  `updateEmployeeSchema` (no new schema needed, since Reactivate accepts the identical field set an
  edit does), calls `reactivateEmployee()`, which owns all audit logging inside its own transaction
  (route never double-logs).
- **Import-based reactivation, single source of truth**: `importEmployees()` now detects a rehire —
  an existing employee (matched by the now-fixed normalized-CNIC lookup, or by employee code) whose
  `dateOfLeaving` is set, reappearing in a row whose own DOL column is blank — and calls
  `reactivateEmployee()` instead of a bare `tx.employee.update()`. Same audit trail, same transfer
  handling, regardless of whether the reactivation came from the UI or a bulk import. Leave-via-import
  stays explicitly out of scope, unchanged: this branch only ever moves departed → active, never the
  reverse.
- **Frontend**: a debounced (400ms) `check-cnic` call in the Employee create form, firing only once
  the field holds a complete, normalized 13-digit CNIC and skipped entirely when editing an
  unchanged CNIC. Shows a warning with the existing employee's detail and, if they're departed, a
  "Reactivate instead" link; Create is disabled while a duplicate is flagged on create (not on
  edit). A new `ReactivateEmployeeModal` (symmetric to the existing `MarkLeftModal`) fetches the full
  current record via a new `GET /employees/:id` hook and lets the operator review/update
  site/unit/designation/pay/bank fields in the same call that clears `dateOfLeaving`. A "Reactivate"
  row action was added to the Employee Registry list for any already-departed employee.
- **Tests**: 19 new cases in `employees.test.ts` (CNIC normalization on create/update; `check-cnic`
  exists-false / full-detail / masked / excludeId; Reactivate clears DOL + updates fields + never a
  second row + distinct audit entry; 400 on an already-active employee; Reactivate-with-transfer
  writes both `employee.reactivated` and `employee.transferred` + `EmployeeTransferHistory`) and 3 new
  cases in `employees-import-export.test.ts` (dashed-CNIC import match — the bug-fix regression test;
  import-driven reactivation; import-driven reactivation combined with a transfer). **Full suite:
  99/99 against live PostgreSQL** (88 prior + 19 new, minus none removed — the reactivate-with-transfer
  employees.test.ts case and the two import ones account for the arithmetic).
- typecheck/lint/build clean across all three workspaces. **Real-stack Playwright verification**
  (live browser → Vite → Express → PostgreSQL, no mocks): logged in as the seeded Master Admin,
  created a site/unit via the real API, created an employee with a dashed CNIC through the real
  form, marked them as left, then attempted to create a second employee with the same CNIC
  (undashed) — the duplicate warning appeared with "Reactivate instead", Create was disabled,
  clicking through opened the Reactivate modal pre-filled from the real record, submitting it
  restored the employee to "Active" in the list, and a direct API call reactivating the now-active
  employee again returned 400 — zero console errors throughout. (One environment issue surfaced and
  fixed along the way: Vite's dev-server dependency pre-bundle cache had a stale copy of
  `@payroll/shared` predating `normalizeCnic`, throwing `normalizeCnic is not a function` in the
  browser — resolved by clearing `frontend/node_modules/.vite` and restarting the dev server, the
  same class of stale-cache issue as the previously-documented `.tsbuildinfo` lesson, just for Vite's
  own dep cache instead of `tsc`'s.)

### Database verification — CLOSED 2026-07-04 (the long-standing debt, resolved in full)

The first-ever verification of this project against a real PostgreSQL instance. Environment: no
Docker/Homebrew/psql exists in this sandbox, so real PostgreSQL 18.4 binaries were provisioned via
the `@embedded-postgres/darwin-x64` npm package into the session scratchpad (TCP-only on
`localhost:5432`; role `payroll`, database `payroll_dev`, matching `backend/.env.example`). The
database lives in the scratchpad and is re-provisioned per session — cheap, since migrate + seed
take seconds.

**What passed, in order:**
- All six pre-existing migrations (`20260701164444_init` →
  `20260703140000_employee_unit_and_transfer_history`) applied to a completely fresh database via
  `prisma migrate deploy`, first try, **without modification**.
- Seed ran clean and was re-run to confirm idempotency (second run reports "already exists" and
  changes nothing).
- **The full backend suite: 78/78 tests, 10/10 files** — auth (login/logout/session/CSRF/
  deactivation), DB-level Audit Log immutability, RBAC boundaries (C11 manipulated-`siteId` cases
  included), Project Sites/Units CRUD + delete guards, Employee Registry CRUD + transfer +
  composite-FK boundary, import/export, Settings, Users.
- The `(unitId, siteId) → ProjectUnit(id, siteId)` composite FK verified **at the database level**
  with raw SQL bypassing the app: a cross-site insert is rejected by Postgres itself
  (`Employee_unitId_siteId_fkey`); the matching-site insert succeeds.
- `EmployeeTransferHistory` writes verified live (exactly one row per transfer, with the
  `employee.transferred` audit entry and no generic `employee.updated` entry for that edit).
- A **second** completely fresh database replayed the full 7-migration chain + seed + 78/78 tests,
  proving reproducibility from zero; `prisma migrate diff` (real shadow database) confirms the
  migration history and `schema.prisma` are in sync — no drift, no inconsistent state.
- **Real-stack Playwright E2E** (first time ever — live browser → Vite dev server → Express →
  PostgreSQL, no mocked APIs): seeded-admin login, Project Site creation, two Units via the Manage
  Units panel, Employee creation **with a date of birth**, DOB round-trip re-opening as
  `15-03-1990`, and a same-site unit transfer — zero console errors, screenshots captured.

**Four real defects surfaced and fixed — exactly the class of bug this debt existed to catch:**
1. **Audit-trigger vs. `ON DELETE SET NULL` contradiction (schema defect, new migration).** The
   immutability trigger rejected *every* UPDATE — including the one Postgres itself performs when a
   `User` is deleted and `AuditLog.actorUserId`'s documented `SET NULL` action fires. Any user with
   audit history was undeletable, contradicting `database/audit-log.md` §16's explicit design. Fixed by
   `20260704180000_audit_log_allow_fk_actor_set_null`: the trigger now permits exactly that one
   transition (`actorUserId` NOT NULL → NULL, all other columns byte-identical) and still rejects
   everything else — re-verified by the still-passing DB-level immutability test. Dated revision
   notes added to `database/audit-log.md` §16 and `docs/architecture/system-conventions.md` §3.
2. **Every `Employee` date write was broken (production bug, Checkpoint 2 and earlier).** Prisma's
   `@db.Date` columns reject the bare `YYYY-MM-DD` strings the Zod schemas validate — so creating an
   employee with a DOB/DOJ, marking one as left, recording a transfer (`effectiveDate`), and the
   import path's DOB/DOJ/DOL all 500'd against a real database. Never caught before because no live
   DB existed and Playwright ran on mocked APIs. Fixed with a new shared `isoDateToUtcDate()`
   (`shared/src/lib/date.ts`, exported from `@payroll/shared`) applied at every Prisma date-write
   boundary (`employees.service.ts` create/update/transfer/leave, `employees-import-export.service.ts`);
   grep confirmed no unconverted write remains. This also fixed a latent phantom-audit-diff bug (a
   `Date` column compared against a string always looked "changed" in the update diff).
3. **Test cleanup violated the system's own append-only invariant.** `cleanTestData()` tried
   `auditLog.deleteMany()` — correctly rejected by the trigger. Audit rows are now never deleted by
   tests (user deletion nulls `actorUserId` via the FK, per `database/audit-log.md §16`); all audit assertions were already
   entity-scoped, so no assertion changes were needed. `EmployeeTransferHistory` cleanup (permitted —
   `database/employee.md §8b`'s append-only rule is application-layer convention; test cleanup is direct DB intervention)
   was added first in FK-safe order, since its `RESTRICT` FKs otherwise block employee/user cleanup.
4. **Login rate limiter tripped the suite.** 10 attempts/IP/15 min is correct for production but the
   integration suite performs one real login per test from a single supertest IP. Relaxed to 1000
   **only** under `NODE_ENV=test` (`auth.routes.ts`); the production limit is unchanged.

Post-fix: typecheck/lint/build clean across all three workspaces (frontend `.tsbuildinfo` cleared
first, per the standing `@payroll/shared` lesson). **Phase 1's five outstanding DB-backed checklist
items and Phase 2's one are all now genuinely verified — the "conditional" closures are discharged.**

### Phase 3 Architecture Review — COMPLETE, 2026-07-05 (architecture only, no application code)

A dedicated architecture-freeze session, run immediately after Phase 2.5 closed and explicitly scoped
to design only — "do not begin implementation yet" was the session's opening instruction, honored
throughout. The objective: freeze the complete Payroll Entry, Payroll Processing, Release, and
Corrections/Balance Adjustments architecture before any Phase 3 code is written, incorporating six new
business rules the user brought to the session (the system is not an attendance management system;
payroll managers may freely edit until release; "Ready for Release" is a non-locking status; payroll
releases independently per Project Unit; Finance may release immediately or wait for client funding;
corrections after release require Master User approval, with positive/negative balances settling
differently).

**Method:** a structured review comparing each new rule against the already-frozen architecture,
surfacing every direct conflict, ambiguity, and schema-shaping fork rather than silently resolving
them — followed by several rounds of targeted decisions with the user (via explicit multiple-choice
questions on the highest-impact forks), each round's answers folded into a running consolidated
design before the next was written into the actual docs. Nothing was written into `docs/architecture/
*.md` or `docs/IMPLEMENTATION_PLAN.md` until the full design was confirmed back to the user as
matching their intent.

**Decisions frozen, in full:**

1. **Per-Project-Unit release, replacing per-Site/per-Cycle release.** A new `PayrollUnitRelease`
   table (`database/release.md` §12b) is the actual release event, one row per `(cycleId, unitId)`,
   executed by the new Finance role. `PayrollEntry.released`/`releasedAt`/`releasedBy` keep their
   existing shape (and indexes) but are now **derived** — set the moment *every* Project Unit an
   entry's work lines touch has released, so a multi-unit split employee (a capability Phase 2.5
   already built) still resolves to exactly one net salary and one Bank Sheet row, never a partial
   payment (Principle 1, Principle 6 both held intact — this was the central design fork of the whole
   session, see the three candidate options weighed in-session before this one was chosen).
2. **`PayrollUnitReadiness`** (`database/release.md` §12b) — the new, non-gating "Ready for Release"
   status. Payroll Staff (site-scoped) or Master User mark a Unit ready; Finance can release whether or
   not it's marked; modeled by **row existence, not a boolean** (marking deletes/inserts the row) since
   it's purely an informational, current-state signal with no historical-preservation requirement — the
   one deliberate exception to this schema's usual anti-deletion convention. A "modified after Ready"
   notice is computed on read (comparing the readiness timestamp against entry `updatedAt`, resolving
   the acting user via `AuditLog`), never auto-clearing the flag.
3. **The correction trigger condition simplifies from two clauses to one.** Previously "individually
   released, OR its parent cycle is no longer Draft" (`docs/architecture/workflows/payroll-lifecycle.md` §4); now simply
   `PayrollEntry.released = true`, since `PayrollCycle.status` is itself derived from every Unit having
   released-or-been-held and can no longer diverge from entry-level `released`. Finalize Cycle stays an
   explicit, separate Master User action on top (confirmed, not automated) — its precondition wording is
   completely unchanged, only the mechanism that sets `released = true` changed.
4. **`CorrectionRequest`** (`database/corrections.md` §13a) — the new pending-approval workflow. Any
   authorized payroll user may propose a correction (field, proposed value, Adjustment Type, mandatory
   reason); it sits `PENDING` until a Master User approves (producing a `Correction`, possibly with an
   adjusted value) or rejects (mandatory rejection reason, no `Correction` created). A Master User
   correcting personally still bypasses this table entirely, exactly as before this session — no
   separate approval step when the approver is the one making the change.
5. **Immediate vs. deferred settlement for a positive (`PAYABLE`) balance.** A new
   `paymentTiming` column on `BalanceAdjustment`. `DEFERRED` is the original, unchanged behavior
   (auto-surfaces in the next Draft cycle). `IMMEDIATE` folds into the employee's already-open
   `PayrollEntry` if one exists this cycle; otherwise it settles via the new standalone
   **`CorrectionPayment`** table (`database/balance-adjustments.md §14a`) — its own one-off Bank/Cash-style document, full audit trail,
   Statement of Account visibility, and never a reopening of any released `PayrollEntry` (Principle 9).
6. **Installment-based recovery for a negative (`RECOVERY`) balance.** `BalanceAdjustment` gains
   `recoveryInstallmentAmount` (nullable — `NULL` reproduces the original single-cycle-full-deduction
   behavior exactly, a purely additive change) and `remainingAmount`, mirroring the already-established
   `Advance.scheduledInstallmentAmount` editable-schedule pattern. Each cycle's partial application is
   recorded in the new, append-only **`BalanceAdjustmentSettlement`** table (`database/balance-adjustments.md §14b`) — one row per cycle a
   recovery actually deducts against — following the exact precedent `EmployeeTransferHistory` already
   set (a typed business-history table alongside `AuditLog`, not a substitute for it).
7. **Late Entry exception.** An entry created for a Project Unit that has already released this cycle
   (e.g. a new hire) will never be reached by the ordinary per-Unit sweep, so it needs its own one-off
   release action — mandatory reason (`PayrollEntry.lateReason`, a single field; whether an entry
   currently qualifies as "late" is derived on demand, not stored), its own one-off Bank/Cash document.
   Only applies while the Cycle itself is still Draft; once the whole Cycle finalizes, a new hire simply
   waits for the next cycle. **Explicitly documented (not yet built):** this one-off document's
   generation should share implementation with `CorrectionPayment`'s where practical, since both are
   structurally "a one-off, single-row payment artifact outside the normal per-Unit/per-Cycle sheet" —
   while remaining separate business entities.
8. **`FINANCE` — a new, third, site-scoped role**, distinct from Master User and Payroll Staff, added
   because "release" is now a distinct capability (executing a Unit's release once client funding is
   confirmed) that belongs to neither Payroll Staff's data-entry role nor Master User's governance role.
   Site-scoped identically to Payroll Staff (reusing `UserSiteAssignment`, no new assignment mechanism).
   Permission set: read-only `payroll:view` (site-scoped), `payroll:release` (Unit release, Late Entry
   release, executing `CorrectionPayment`s), `bank-sheets:view`/`cash-receiving:view` — explicitly
   **without** payroll-edit, mark-ready, or corrections-approve/reject permissions.
9. **Terminology: "Master Admin" renamed to "Master User"** — same role, no functional change — across
   `docs/architecture/*.md` and `docs/IMPLEMENTATION_PLAN.md` **only**. Deliberately **not** applied to
   `reference/PROJECT_SPEC.md` (frozen client material, never edited), the HTML prototypes under
   `docs/prototypes/` (reviewed this session — see below — left as accurate historical snapshots of
   already-shipped Phase 1/2 UI), or this file's/`SESSION_HANDOFF.md`'s own historical entries describing
   what was literally built and named at the time.

**Net schema growth:** 5 new tables (`PayrollUnitRelease`, `PayrollUnitReadiness`, `CorrectionRequest`,
`CorrectionPayment`, `BalanceAdjustmentSettlement`), 2 new enums (`BalanceAdjustmentPaymentTiming`,
`CorrectionRequestStatus`), 1 new column on `PayrollEntry` (`lateReason`), 3 new columns on
`BalanceAdjustment` (`paymentTiming`, `recoveryInstallmentAmount`, `remainingAmount`) — bringing the
total table count from 20 to 25. **None of this exists in `backend/prisma/schema.prisma` yet** — this
is a design specification, exactly like the rest of `docs/architecture/database/`, waiting for Phase 3
implementation to translate it into real migrations.

**Files updated (architecture only):** `docs/architecture/database-schema.md`,
`docs/architecture/data-and-storage.md`, `docs/architecture/post-release-corrections.md`,
`docs/architecture/authentication.md`, `docs/architecture/overview.md`, `docs/IMPLEMENTATION_PLAN.md`
(Phase 3/4/6 sections, plus the Master User rename applied file-wide). `docs/PROJECT_PRINCIPLES.md` was
reviewed and needed no changes — every new decision is additive/consistent with the existing ten
principles, not in tension with any of them.

**HTML prototypes reviewed, none refreshed** — see the dedicated note in §4 below. None of the four
existing prototypes (Phase 1 login/shell, Project Sites, Employee Registry, Settings/Users) depict
Payroll Entry, Release, or Corrections screens, so nothing in them is now factually contradicted by
tonight's decisions; the full UI/UX prototype pass for these new screens is intentionally deferred
until the corresponding functional phases are built, per standing project practice.

**No architectural questions remain open from this session.** Every fork identified during the review
was resolved with the user before any doc was written, including the three follow-up refinements
requested after the first consolidated design pass (row-existence modeling for `PayrollUnitReadiness`,
a single `lateReason` field instead of two, and the explicit shared-implementation note for
`CorrectionPayment`/Late Entry). Pre-existing open items **unrelated to tonight's session** remain
tracked in §3 below (Company Bank Account modeling, at-most-one-`ACTIVE`-`Advance`-per-type, calendar-
month-only cycles) — untouched by this review, still to be resolved on their own original timelines
(before Phase 4, before Phase 4, before Phase 3, respectively).

### Phase 3, Checkpoint 0 — Schema foundation: PayrollCycle, PayrollEntry, PayrollEntryWorkLine, shared calcNet (2026-07-07)

Phase 3 implementation was explicitly authorized this session, with instruction to proceed with
Checkpoint 0 only (schema/migration + `calcNet`) and stop before any routes, services, or frontend
work. A detailed implementation design was presented first (scope, schema, migration, RBAC, audit,
performance, test strategy, documentation, risks, and open ambiguities) and approved with nine
explicit implementation decisions, all applied as designed — see `docs/IMPLEMENTATION_PLAN.md`'s
Phase 3 section for the full checkpoint breakdown this session established (Checkpoints 0–6).

- **Schema/migration**: `PayrollCycleStatus` enum; `PayrollCycle` (`database/payroll-cycle.md §10`); `PayrollEntry` (`database/payroll-entry.md §12`);
  `PayrollEntryWorkLine` (§12a) — one migration, `20260707120000_payroll_cycle_and_entry`, generated
  via `prisma migrate diff` against the schema files (a dedicated `payroll_shadow` database, not the
  working `payroll_dev` one — see the environment note below) and hand-edited to append every check
  constraint and the `PayrollCycle` `WHERE status = 'DRAFT'` partial index Prisma's DSL can't
  express, the same pattern as `Employee`'s CNIC check constraint (Phase 2). Applied cleanly to a
  completely fresh database, first try, alongside the seven pre-existing migrations (unmodified).
- **Two schema deviations from `database/payroll-entry.md` §12, both explicitly approved before being
  written**: (1) `PayrollEntry.advanceId`/`.eidAdvanceId` deferred to a Phase 4 migration (both FK to
  `Advance`, which Phase 4 builds — building a premature stub or an FK to a nonexistent table was
  rejected as an option). (2) `PayrollEntry.remarks` (nullable text) added — not in §12's original
  design — editable while the entry is editable, frozen into the permanent snapshot once released,
  intended as the grid's last column (a later checkpoint). Both recorded with dated revision notes in
  `database/payroll-entry.md` §12 and `database/schema-invariants.md` §25, and in `docs/architecture/overview.md` (the
  matching `calcNet`-ownership note, below).
- **`calcNet`** (`shared/src/lib/calc-net.ts`) — the single implementation for backend, frontend live
  totals, import/export, reports, and future corrections, per explicit approval (a deviation from
  `overview.md`'s original backend-only attribution, now revision-noted there). New `decimal.js`
  dependency added to `shared/package.json` — no native JS float arithmetic anywhere in the function.
  **Rounding policy** (explicitly approved): every intermediate value feeding a further
  multiplication/division (daily rate, effective OT rate, effective leave rate) stays at full decimal
  precision and is never rounded before use in the next step; only `earnedAmount`/`otEarned`/
  `leaveEarned` — each "done" being multiplied/divided — are rounded to 2dp (`ROUND_HALF_UP`).
  `totalEarning`/`totalDeduction`/`netSalary` are then pure addition/subtraction of already-2dp
  values, so `netSalary` always exactly reconciles with `totalEarning - totalDeduction` as displayed.
  Golden-output test cases were taken directly from `reference/payroll_prototype.html`'s real
  `calcNet()` implementation and sample employee fixtures (id 15/16), per the Implementation Plan's
  own instruction to reuse them.
- **Tests**: `backend/tests/calc-net.test.ts` (pure, no DB — golden cases, multi-line sums, OT/leave
  rate derivation vs. override, the primary-line-by-`sortOrder` rule, boundary `cycleDays`, zero
  inputs, a `ROUND_HALF_UP` tie-break case, and a repeating-decimal accumulation case proving no float
  drift) and `backend/tests/payroll-schema.test.ts` (schema/migration-level, direct-Prisma, no service
  layer yet — the composite-FK cross-site boundary, every check constraint, both new unique
  constraints, and cascade-delete of work lines). `backend/tests/helpers.ts`'s `cleanTestData()`
  extended for the two new tables, scoped by a fake `year: 2900` since neither has a text column to
  prefix. **Full suite: 145/145 against live PostgreSQL** (99 prior + 46 new), typecheck/lint/build
  clean across all three workspaces (frontend `.tsbuildinfo` cleared first, then re-verified, per the
  standing `@payroll/shared`-change lesson).
- **No Playwright this checkpoint** — an explicitly approved, narrow exception: zero frontend/UI
  surface was touched (no routes, no service layer, no components), so there was nothing to render.
  Not a silent skip of the otherwise-mandatory per-checkpoint Playwright rule.
- **Environment note (process lesson, not a data-loss incident)**: the first `prisma migrate diff`
  invocation was run with `--shadow-database-url` pointed at the live `payroll_dev` scratch database
  instead of a dedicated one — Prisma uses that URL as scratch space and reset it. No git-tracked file
  or durable data was affected; `payroll_dev` is explicitly documented as ephemeral and
  re-provisioned every session, and it was already being re-provisioned this session regardless. Fixed
  by creating a dedicated `payroll_shadow` database and re-running the diff (identical output,
  confirming the diff itself was correct all along — only the scratch-space target was wrong), then
  dropping and recreating `payroll_dev` fresh and re-running the full migrate-deploy/seed/test
  sequence. Recorded here so a future session never repeats it: **`--shadow-database-url` must always
  point at a dedicated, disposable database, never the working dev database.**
- **Scope discipline maintained**: no routes, no service layer, no frontend component, no
  cycle-bootstrap action, and no `AuditLog`/RBAC changes were introduced — all explicitly deferred to
  Checkpoint 1 onward, per the approved checkpoint scope.

### Phase 3, Checkpoint 2 — Pre-Commit Final Verification Pass — 2026-07-09 (committed as `e072da5`)

A dedicated verification-only pass requested before authorizing the commit, explicitly scoped to
"verify and report, do not modify architecture or expand scope unless you discover a genuine
defect." Three genuine defects were found via targeted real-stack Playwright testing (not
speculative — each is demonstrated below) and fixed within that same scope; everything else was
confirmed already correct and is documented as-is, with no code change.

**1. Numeric editing UX — defect found and fixed (severity: crash).** Typing any unparseable value
(`""`, `"-"`, `"."`, `"abc"`) into any numeric cell crashed the entire app to a blank white screen —
confirmed via Playwright (`pageerror: [DecimalError] Invalid argument: abc`, empty document body,
no error boundary anywhere in the app to contain it). Root cause: the live `calcNet` preview
recomputed on every keystroke via a bare `useMemo`, and `calcNet`'s underlying `decimal.js` throws
synchronously on an unparseable string.
- **Fix:** wrapped the live calc in try/catch, falling back to the entry's last-saved (always-valid,
  per the database's own numeric constraints) figures whenever the current draft doesn't parse
  (`use-payroll-entry-editor.ts`).
- **Fix:** added `frontend/src/components/payroll-entry/numeric-validation.ts` (`isValidDecimalDraft`,
  `parseValidCycleDays`, reusing the shared `decimalString` Zod schema — newly exported from
  `@payroll/shared` — so the frontend's notion of "valid" never drifts from the backend's) and used
  it to filter invalid/incomplete values out of what `commit()` ever sends, so an incomplete value is
  never autosaved and never produces a wasted request.
- **Fix (related sub-bug, same root cause):** Cycle Days validated inside its `onChange` handler and
  silently dropped invalid keystrokes, which made the field appear to randomly revert while
  retyping. Changed to the same "type freely, validate at commit time" pattern as every other
  numeric field (`cycleDaysInputValue`, `use-payroll-entry-editor.ts`).
- Added a visual `invalid` (red-bordered, `aria-invalid`) state to `InlineNumberCell` so an
  unparseable value is visibly flagged while never blocking further typing.
- Re-verified live: empty/`-`/`.`/`0.`/`abc`/delete-and-retype all correctly flagged invalid, zero
  crashes, zero invalid autosaves; typing a valid value afterward saves and persists normally;
  nullable fields (OT Rate, Leave Rate) correctly treat empty as valid, not invalid.

**2. Keyboard workflow — documented, no defect.** ArrowUp/ArrowDown/Enter move focus within the same
column to the adjacent row, clamped at the first/last row (no wraparound, confirmed via Playwright:
ArrowUp at row 0 and ArrowDown at the last row both correctly no-op). ArrowLeft/ArrowRight are not
intercepted — native text-caret movement only. Tab/Shift+Tab use native browser focus order, which
correctly skips every read-only cell (Employee Code, Name, Site, Net Salary), moving from the last
editable column of one row (Remarks) to the first editable column of the next (Designation), and
back — confirmed via Playwright's `document.activeElement` inspection at every boundary. **Known,
accepted limitation, not fixed:** Tab relies on native DOM order, and the virtualizer only mounts a
window of rows at a time — tabbing toward a row far outside that window (unlike Up/Down/Enter, which
explicitly scroll the target into view first) may exit the grid or land unpredictably. This is the
same tradeoff every DOM-virtualized grid has unless it implements a custom roving-tabindex system,
which was judged out of this pass's scope (a genuine UX enhancement, not a defect fix).

**3. Row ordering — confirmed deterministic, no defect.** Every entry list is ordered by
`sortOrder` ascending, both server-side (`listPayrollEntries`'s `orderBy`) and client-side (no
sorting/reordering is applied on top — `PayrollEntryGrid` renders `entries` in the order received).
Every mutation path (`replaceEntry`, `reloadPayrollEntry`) updates the array via `.map()`, which
preserves position; nothing in this checkpoint's surface can change `sortOrder` (no drag-reorder UI
exists — that's a later checkpoint). Confirmed live: the same three employees appeared in the same
position before editing, immediately after an autosave, and across two independent full-page
reloads.

**4. Pending autosave on tab-close/refresh/navigation — confirmed and documented as an accepted
limitation, not fixed.** No `beforeunload` guard exists anywhere in the app. Verified live: typing a
value and navigating away immediately (well inside the 600ms debounce window, no wait at all) loses
the edit silently — reloading the page showed the field back at its last-saved value, with no
browser warning ever shown. An edit is safe exactly once its debounce fires and the PATCH completes
(≈600ms+round-trip after the last keystroke); before that, closing the tab, refreshing, or
navigating away can lose it. This is reported here rather than fixed, since a `beforeunload` guard
would be a genuine, reasonable enhancement but is additive scope beyond "verify and report" — left
for explicit authorization rather than added unprompted.

**5. Bulk/rapid editing — confirmed correct, no defect.** Five different fields on one row (Gross
Pay, Working Days, Remarks, Hold, Allowance) edited back-to-back with zero waiting between them.
Network log showed exactly two PATCH requests (entry-level fields coalesced into one, the work-line
field into a second, chained using the *first* request's returned `version`, never the stale
pre-request one) — no overlapping in-flight requests, no 409s, no non-2xx responses. Final persisted
values (confirmed via full page reload) matched the last-typed value for every field, and the
totals row reflected the changes correctly throughout.

**6. Performance baseline — documentation only, no optimization performed.** Bulk-seeded 500
additional employees/entries directly via Prisma (503 entries total) into the existing Draft cycle.
At this scale: grid interactive ~550-580ms after navigating to the page; exactly ~28-30 row elements
ever present in the DOM regardless of scroll position (virtualization confirmed working); scroll-to-
bottom-and-settle ~300ms; a click+edit on a cell ~60-70ms. **Comfortably usable well past 500 rows on
this observation** — no slowdown, jank, or unresponsiveness observed at 503 rows on ordinary
developer hardware. This is a single-scale spot-check, not the rigorous 10,000-employee-floor
validation Checkpoint 6 owns, and no code was changed as a result.

**Defect found *during* this baseline check (not part of the original 8 items, but surfaced by
testing at scale): the sticky totals row only summed currently-*mounted* (virtualized-visible) rows,
undercounting everything scrolled out of view** — at 503 rows the totals row showed "Σ28 employees"
instead of 503, because the live-totals store's only population mechanism was each row's own mount
effect. **Fixed:** `LiveTotalsStore` now distinguishes actively-mounted rows (whose live, not-yet-
saved edits should win) from everything else (seeded/refreshed from the `entries` array's own
server-cache figures via a new `setBase`, called whenever that array changes); a row unmounting now
hands back a fresh server-truth snapshot (`unmount`, using the new `computeServerSnapshot` helper in
`calc-input.ts`) instead of being dropped from the total entirely. Re-verified at 503 rows: totals
row correctly reads "Σ503 employees" with an internally-consistent grand total, and all five earlier
scenarios (numeric edge cases, conflict recovery) were re-run afterward with no regression.

**Process note, not a product defect:** this pass's own Playwright verification created real,
persistent data (a Project Site/Unit, several employees, a Draft cycle) in the shared scratchpad
PostgreSQL instance that `backend/tests` also runs against. Running the backend suite without
resetting the database afterward produced 16 unrelated-looking failures (a stray Draft cycle
blocking the fixture suite's own cycle-creation test, a foreign-key mismatch from a leftover
site/unit). The database was reset (drop/recreate/migrate/seed) and the suite re-confirmed
**160/160 passing** — recorded here so a future session understands this was test-data hygiene
during manual verification, not a Checkpoint 2 regression. Backend code was not touched this
session.

**Verification results after all fixes above:** `typecheck`/`lint`/`build` clean across all three
workspaces; **160/160 backend tests passing** against a freshly reset database; all six items
re-confirmed live via Playwright with the fixes in place, plus a final clean-database smoke test
(fresh site/employee/cycle created via API, edited in the grid, persisted after reload, zero
console/page errors).

**Re-confirmed in a second, fresh verification pass immediately before commit** (full typecheck/
lint/build, a clean database reset, 160/160 backend tests, and Playwright re-run against the exact
working tree being committed — the numeric-crash fix, the Cycle Days fix, the totals-at-scale fix,
and optimistic-locking conflict recovery were each independently re-exercised and all passed with
zero regressions). A repository hygiene sweep confirmed no debug `console.log`s, no TODO/FIXME
markers, no scratch/temporary files, and no unintended working-tree changes beyond this checkpoint's
own 15 files.

**Checkpoint 2 is APPROVED and this implementation is now committed** — see the commit hash recorded
at the top of this file and in `docs/SESSION_HANDOFF.md`.

### Phase 3, Checkpoint 2 — Payroll Entry Grid Frontend — COMPLETE AND CLOSED, 2026-07-09

Executed after the Advance Deduction Deferral architecture amendment (below) was frozen and
committed (`0d54a97`), against that frozen documentation plus Checkpoint 1's already-built backend.
Explicitly authorized as **frontend only** — "do not perform any architecture review or redesign
unless you encounter a genuine implementation blocker" was honored throughout; no blocker was hit.
Reviewed, the three defect fixes above were explicitly accepted as in-scope implementation
corrections, a final pre-commit hygiene/verification pass was run clean, and this checkpoint is now
**approved, committed, and closed** — see the commit hash recorded at the top of this file.

**Baseline re-established before any change:** confirmed `main` at `0d54a97`, clean working tree;
re-provisioned embedded PostgreSQL in the session scratchpad (same recipe as prior sessions —
`@embedded-postgres/darwin-x64`, since this machine reported x64 this session, not arm64); all 8
existing migrations applied cleanly to a fresh database; seed script run twice back-to-back and
confirmed idempotent (second run: "Master Admin account already exists," no duplicate-row errors);
**160/160 backend tests passing** before any Checkpoint 2 code was written.

**Implementation note (clarification only, no architecture change):** Checkpoint 2 intentionally
loads the backend's paginated Payroll Entry API to completion on the client (paging through
200-row responses into one flat array for the virtualizer to render). Incremental/windowed-fetch
loading — where the client only ever requests the rows near the current scroll position, rather
than the whole cycle — is intentionally deferred to Phase 3 Checkpoint 6 (Performance & Scale),
which owns validating and, if needed, optimizing behavior at the 10,000-employee design floor.

**Built:**
- `frontend/src/hooks/use-payroll-cycles.ts`, `use-payroll-entries.ts`, `use-payroll-entry-editor.ts`
  (new) — data layer: cycle listing/creation, paginated-entry-fetch-to-completion (the backend caps
  a single request at 200 rows; the hook pages through to a flat, sortOrder-ordered array, which is
  what a client-side-virtualized grid needs — ordinary client paging-to-completion, not the
  windowed/incremental fetch Checkpoint 6 owns), and the per-row autosave/conflict state machine.
- `frontend/src/components/payroll-entry/` (new directory) — `PayrollEntryGrid` (TanStack Table for
  column/header structure + the row model, TanStack Virtual virtualizing the body over it),
  `PayrollEntryRow` (one component per row, one `usePayrollEntryEditor` instance per row — TanStack
  Table's per-cell renderer model doesn't fit a row where 20+ cells share one save transaction),
  `PayrollEntryTotalsRow` (subscribes to a small external store so it updates live without
  re-rendering every other row per keystroke), `columns.ts` (single source of column widths shared
  by header/body/totals), `calc-input.ts` (builds shared `calcNet`'s input from stored figures
  overlaid with local pending edits — `calcNet` itself is never reimplemented), `inline-cells.tsx`,
  `save-status-indicator.tsx`, `use-grid-keyboard-nav.ts`, `new-cycle-modal.tsx`.
- `frontend/src/components/ui/toggle-switch.tsx` (new) and `shared/src/lib/number.ts` (new,
  `formatMoney`/`formatNumber`) — both already called for by `docs/design-system.md`/
  `docs/architecture/folder-structure.md` but never actually built by any prior phase.
- `frontend/src/routes/payroll-entry-page.tsx` (new route, `/payroll-entry`) — loading/empty/error
  states, wired into `App.tsx` and a new "Payroll" nav section (`nav-config.ts`).
- Every Phase 3 `PayrollEntry`/primary-work-line column is present (see the parallel
  `docs/IMPLEMENTATION_PLAN.md` Checkpoint 2 entry for the full list) — including Cycle Days and
  Leave Days, which weren't in the checkpoint instruction's own illustrative list but are real,
  editable, `calcNet`-feeding architecture fields (`database/payroll-entry.md §12/§12a`) that would otherwise have had no
  correction path in the grid.
- A small, explicitly-flagged addition: a "Start New Payroll Cycle" modal (Master-User-only, reusing
  Checkpoint 1's `createPayrollCycle` verbatim) — without it the grid has nothing to render in a
  fresh environment, and no later checkpoint's scope covers it either.

**Verification:**
- `npm run typecheck`/`lint`/`build` clean across `shared`/`backend`/`frontend`. Backend suite
  re-run unchanged, **160/160 passing**. No frontend unit-test framework exists in this project (no
  prior phase added one) — "frontend tests (if applicable)" was not applicable, consistent with this
  project's established reliance on typecheck/lint/build + Playwright for frontend verification.
- **Real-stack Playwright verification**, live browser → Vite dev server → Express → the
  session's real PostgreSQL (no `chromium-cli` available in this environment — drove Playwright's
  `chromium` launcher directly instead, per the `run` skill's documented fallback). Logged in as the
  seeded Master Admin; a fresh database has zero employees and zero cycles, so a Project
  Site/Unit/three Employees were created via the API and a Draft cycle via the UI's own new action;
  confirmed the grid renders with sticky grouped/column headers and a sticky totals row; edited
  Gross Pay, Working Days, and Remarks inline and watched Net Salary and the totals row recompute
  live; toggled Hold; reloaded the page and confirmed every edit had actually persisted server-side
  (proving the autosave round-trip, not just optimistic local state); and separately simulated a
  genuine concurrent edit via a direct API PATCH while the browser held a now-stale cached version —
  confirmed the conflict indicator appeared, the row's inputs disabled themselves, the user's own
  unsaved edit stayed visible (not discarded), and clicking the conflict icon correctly reloaded the
  row to the other edit's real value. Zero console/page errors other than one pre-existing, expected
  401 from the session-bootstrap check that fires before login (documented behavior, unrelated to
  this checkpoint).
- **One real inconsistency found and fixed during verification**: the totals row initially rendered
  "Leave Rate" with a `PKR` prefix while "OT Rate" — the same kind of value — had none; corrected so
  only genuine payment-amount columns carry the currency prefix, consistent with
  `docs/design-system.md` §4.

**Scope discipline maintained**: no code path touches `ScheduledPayrollPeriod`, `Advance`, or any
Balance-Adjustment/Correction table; no Split-by-Unit, bulk operations, import/export, Release,
Finance role, Bank Sheet, Cheque Reference, Statement of Account, or beyond-normal-practice
performance work was introduced — all explicitly out of scope per this checkpoint's authorization.

**Committed as `e072da5`** — reviewed and approved, per this checkpoint's own instruction.

### Advance Deduction Deferral — Pre-Checkpoint-2 Architecture Amendment — FROZEN, 2026-07-09 (architecture only, no application code)

A dedicated, documentation-only architecture session, run between Phase 3 Checkpoint 1 (committed
`55eda58`) and the not-yet-started Checkpoint 2, triggered by a new business requirement: payroll no
longer assumes an Advance is automatically deducted in its scheduled cycle — authorized users must be
able to defer that deduction to a future payroll cycle before release, for genuine employee
circumstances, with a complete audit trail. "Do not begin implementation yet" was the session's
opening instruction and was honored throughout — no Prisma schema, no migrations, no application code.

**Method:** the same discipline as the 2026-07-05 Phase 3 Architecture Review — every proposal was
presented back to the user for explicit approval before being written into `docs/architecture/*.md` or
`docs/IMPLEMENTATION_PLAN.md`, across four review rounds as the user progressively refined the design
(each round's refinements folded in before the next was drafted), ending with a clean, independently
re-run, read-only consistency verification pass across all five touched files before this freeze.

**Business rules frozen (`database/advances.md` §15):**

- **BR-ADV-001.** Every Advance has an Original Scheduled Deduction Payroll Cycle.
- **BR-ADV-002.** Before payroll is released, Payroll Staff or a Master User may defer the deduction to
  another future Draft Payroll Cycle. Released payroll may never be modified.
- **BR-ADV-003.** The user may select any future Draft payroll cycle — not limited to "next" or "one
  after next."
- **BR-ADV-004.** Every deferral must permanently record: Original Scheduled Cycle, New Scheduled
  Cycle, Reason, Deferred By, Deferred At.
- **BR-ADV-005.** Only one scheduled deduction may exist for an Advance at any time. Deferral moves the
  deduction; it never duplicates it.
- **BR-ADV-006.** An Advance deduction may only be moved to a future Draft payroll cycle. Released
  cycles are immutable.

**Key design decisions, in full:**

1. **`ScheduledPayrollPeriod`** (`database/payroll-cycle.md` §10a, new) — the single canonical representation
   of a calendar payroll period that does not yet have a materialized `PayrollCycle`. Resolved this over
   an initial, rejected design using raw `(year, month)` scalar columns directly on `Advance`, which the
   user correctly flagged as introducing a second, competing representation of "a payroll cycle" (only
   `PayrollCycle` itself may own real cycle identity/lifecycle). Immutable `year`/`month`; the only
   permitted transition is `payrollCycleId`/`resolvedAt` moving `NULL → NOT NULL`, exactly once; never
   deleted once referenced, even after its cycle archives — a permanent part of payroll history.
   **Ownership boundary, added as a final clarifying refinement:** owned exclusively by Payroll
   Processing; domain modules (Advances today) may only reference it by foreign key and must go through
   Payroll Processing's own exposed find-or-create function — never a direct write to the table itself.
2. **`Advance.originalScheduledPeriodId`** (immutable, set once — BR-ADV-001) and
   **`.currentScheduledPeriodId`** (the single live pointer a deferral moves — BR-ADV-005), both FK →
   `ScheduledPayrollPeriod`.
3. **`AdvanceScheduleChange`** (`database/advances.md` §15a) — append-only (no updates, no deletes, only
   inserts, same convention as `EmployeeTransferHistory`/`BalanceAdjustmentSettlement`) history of every
   deferral. Named for recording *changes to* the schedule, not *being* the schedule — renamed during
   the session from an earlier `AdvanceScheduleHistory`/`AdvanceDeferral` working name specifically so a
   hypothetical future "bring forward" rule would never require another rename.
4. **Outstanding Payroll Obligations** (`docs/architecture/workflows/outstanding-obligations.md`, `overview.md` Extensibility) — a named,
   documented extension seam generalizing what was originally a Balance-Adjustment-specific carry-forward
   rule. Each owning module registers a carry-forward predicate and, optionally, a **Payroll
   Materialization Hook** (renamed from an earlier "population hook" working name — the responsibility is
   materializing a payroll obligation into a `PayrollEntry`, not merely populating data). Payroll
   Processing's cycle bootstrap orchestrates only — it never contains obligation-specific knowledge.
   **Providers must be independent and order-independent** — Payroll Processing never relies on
   registration order, and any future genuine ordering dependency must be an explicit architecture
   decision, not an implicit one. Today's two providers: Balance Adjustments (predicate only, unchanged)
   and Advances (predicate + hook, new).
5. **Complete audited lifecycle** (`database/advances.md` §15) — `advance.deferred` (repeatable) and the
   new `advance.schedule_materialized` (written once, by the Advances Payroll Materialization Hook, the
   moment a scheduled deduction actually lands in a real `PayrollEntry`) together give an auditor the
   full chain — Advance created → deferred → deferred again (optional) → schedule materialized → fully
   recovered — without reconstructing it across multiple tables.
6. **Generalized new-cycle carry-forward rule** (`docs/architecture/workflows/outstanding-obligations.md`) — "carry any employee with at
   least one PENDING Balance Adjustment" widened to "carry any employee with at least one outstanding
   payroll obligation," so a departed employee with a deferred, not-yet-arrived Advance deduction is
   never stranded, and so a future obligation type never requires editing this rule again.

**Net schema growth:** 2 new tables (`ScheduledPayrollPeriod`, `AdvanceScheduleChange`), 2 new columns
on `Advance` (`originalScheduledPeriodId`, `currentScheduledPeriodId`), plus a new **Advances** row in
`overview.md`'s Major Modules table (previously undocumented as its own module row, since `Advance`
hasn't been migrated yet). **None of this exists in `backend/prisma/schema.prisma` yet** — it lands in
Phase 4's not-yet-built `Advance` migration, additively, alongside `Advance` itself; no destructive
change and no retrofit of any already-shipped table (`PayrollCycle`/`PayrollEntry` are untouched).

**Files updated (architecture only):** `docs/architecture/database-schema.md`,
`docs/architecture/data-and-storage.md`, `docs/architecture/overview.md`,
`docs/architecture/authentication.md`, `docs/IMPLEMENTATION_PLAN.md` (Phase 4/5 sections).
`docs/PROJECT_PRINCIPLES.md` and `docs/architecture/post-release-corrections.md` needed no changes —
nothing here is in tension with any existing principle or the Correction/Balance Adjustment mechanics.

**Verification performed before freezing:** a full, independent, read-only consistency pass across all
five touched files confirmed (a) zero remaining references to superseded working names (`Population
Hook`, `AdvanceScheduleHistory`, `AdvanceDeferral`, raw year/month scalar fields), (b) consistent use of
the final terminology everywhere, (c) all six BR-ADV rules defined exactly once and correctly
cross-referenced, (d) section numbering (§10a, §15, §15a) resolves correctly with no dangling
references, and (e) the final ownership-boundary clarification introduced no contradiction with the
already-frozen deferral mechanics.

**This architecture is now FROZEN.** Per explicit instruction, it must not be reopened or redesigned
unless implementation reveals a genuine blocker or a new business requirement is introduced. Phase 4
implementation should build directly against this frozen documentation. **Phase 3 Checkpoint 2 remains
unaffected and still requires its own separate explicit authorization to begin** — this session did not
touch Payroll Entry grid frontend work in any way.

### Phase 3, Checkpoint 1 — Cycle bootstrap/creation + Payroll Entry/Work Line backend CRUD (2026-07-07)

Authorized immediately after Checkpoint 0's review/commit, scoped explicitly to backend-only:
cycle creation, Payroll Entry/Work Line CRUD, RBAC/site-scoping, audit logging — no frontend,
Release, Corrections, Balance Adjustments, Finance, or Advances. Full as-built detail:
`docs/IMPLEMENTATION_PLAN.md`'s Phase 3 section (Checkpoint 1 entry). Highlights:

- **`payroll-processing` module** — `createPayrollCycle` unifies "bootstrap the first cycle" and
  "create a subsequent one" into one implementation (the entry-seeding logic is identical either
  way), enforcing the one timeless invariant that doesn't depend on Phase 4/5/6 existing: only one
  `PayrollCycle` may be `DRAFT` at a time. **Explicitly, deliberately does not** require the
  outgoing cycle to be `RELEASED`, archive it, generate a `BackupPackage`, or account for
  `BalanceAdjustment`-pending departed employees — that full transaction is Phase 5's own job and
  depends on tables/mechanisms that don't exist yet (Finalize/Release, `BackupPackage`/
  `StorageProvider`, `BalanceAdjustment`). The previous cycle's status is left untouched.
- **The Payroll Bootstrap Rule — frozen business rule, confirmed 2026-07-07** (presented for review
  as an interpretation in this checkpoint's implementation report; now ratified, permanent, not
  open): continuing employees inherit `grossPay`/`eobiAmount`/`eobiApplicable`/`leaveRate` and the
  new line's `cycleDays`/`otRate` from their most recent prior entry — payroll values represent
  payroll history and stay stable across cycles until intentionally changed in Payroll Entry itself
  (`database/employee.md §9` calls `Employee.grossPay` a "template value only", so reverting to it would silently discard
  a deliberate adjustment). `designation`/bank fields (`bankId`, `branchCode`, `accountNumber`,
  `accountTitle`) and the new line's `unitId` (Primary Project Unit) always refresh from
  `Employee`'s current record instead — Employee master data should always reflect the employee's
  latest assignment/banking information — which also keeps a cross-site transfer's new entry and
  its work line's unit consistent with each other (the composite-FK invariant). New employees seed
  entirely fresh from `Employee`'s defaults.
- **`PayrollEntry.siteId` confirmed permanently non-editable via the update API, 2026-07-07** (this
  checkpoint's own scope-narrowing choice, now ratified as permanent rather than deferred). Future
  site changes flow exclusively through the Employee Transfer workflow, picked up automatically by
  the next cycle's bootstrap via the Payroll Bootstrap Rule above — never a direct edit to an
  existing entry's site.
- **Performance**: cycle-bootstrap seeding uses two chunked `createMany` calls (not one `create`
  per employee), client-generated UUIDs linking entries to their first work line. Smoke-tested at
  3,000 employees — cycle + 3,000 entries + 3,000 work lines in ~1.3 seconds.
- **`payroll-entry` module** — full CRUD for both `PayrollEntry` and `PayrollEntryWorkLine`:
  optimistic locking (`updateMany({ where: { id, version } })`, a new `conflict()` 409 helper for a
  stale version), immutability (unreleased + Draft-cycle-only), the "never zero work lines"
  invariant on delete, and every work-line mutation folded into a `payroll_entry.updated` audit
  entry rather than a separate action type (`database/schema-invariants.md §22`'s explicit instruction). Delete is permitted only
  while unreleased/Draft — not yet "historical payroll," so Principle 2 doesn't block it.
- **RBAC**: a new `PERMISSIONS.PAYROLL_CYCLE_MANAGE` (Master-User-only) gates cycle creation
  specifically — a system-lifecycle action, not Payroll Staff's routine data entry — added to the
  shared permission registry alongside the already-seeded `payroll:entry` Payroll Entry/Work Line
  routes reuse unchanged. Finance is untouched; still a two-role system this checkpoint.
- **Code health**: extracted `diffFields`/`toJsonPrimitive`/`omitKeys` (previously private to
  `employees.service.ts`) into `backend/src/common/audit-diff.ts`, and `RequestMeta` into
  `backend/src/common/request-meta.ts`, so Payroll Entry's audit logging reuses the same
  implementation rather than a second copy — per the standing "grep for duplicates on new shared
  utility" rule, applied proactively this time rather than caught after the fact.
- **Tests**: `payroll-cycle.test.ts` and `payroll-entry.test.ts` — bootstrap/carry-forward
  correctness, RBAC (including a bespoke-permission-set missing-permission case and the C11
  manipulated-`employeeId` site-scoping pattern), optimistic locking, immutability, cascade-delete,
  and full work-line CRUD including the cross-site and last-line-delete rejections. **160/160
  backend tests passing** (145 prior + 15 new).
- **Two real bugs caught while writing these tests**: the new `createPayrollCycleSchema`'s `year`
  upper bound (2100) collided with Checkpoint 0's own `year: 2900` test-fixture convention —
  widened to 2999; and an initial test ordering created the test employee *before* the cycle,
  so the cycle's bootstrap sweep auto-enrolled them, making the test's own "create an entry" call
  correctly 409 against an already-existing entry — fixed by creating the cycle first in every
  test (which is also the manual-create endpoint's actual real-world use case: a late hire mid-cycle).
- No Playwright (no frontend/UI exists yet — Checkpoint 2's work), same approved exception as
  Checkpoint 0. No Release/Corrections/Balance Adjustments/Finance/Advances/frontend of any kind
  — all explicitly out of scope and untouched, per this checkpoint's authorization.

### Documentation architecture restructuring — COMPLETE, 2026-07-08

**Commit:** `cfc4ef4` — `docs(architecture): split architecture into modular bounded-context
documentation`.

**Purpose:** `docs/architecture/database-schema.md` (1,961 lines), `data-and-storage.md`
(359 lines), and `post-release-corrections.md` (356 lines) were split into focused,
bounded-context files — 13 schema files plus a navigation index under the new
`docs/architecture/database/`, 3 workflow narratives under the new
`docs/architecture/workflows/`, and a new `docs/architecture/system-conventions.md` — following a
restructuring plan frozen across multiple architecture-review rounds (global, stable §-numbering
preserved unchanged; the Documentation Ownership Rule and a documentation size guideline adopted;
see `docs/architecture/folder-structure.md`).

**Documentation-only — confirmed.** No application behavior, database schema, Prisma migrations,
or API surface changed as part of this restructuring. Every code comment and migration comment
citing an old file path was mechanically rewritten to its new location; every migration `.sql`
file had only `--` comment lines touched, never DDL (verified via diff before commit). All three
workspaces (`backend`, `frontend`, `shared`) typecheck cleanly against the edited comments. A
dedicated documentation-integrity audit pass (bare `§N` cross-reference review across
`IMPLEMENTATION_PLAN.md`, `PROJECT_PROGRESS.md`, `SESSION_HANDOFF.md`) preceded this commit.

### Phase 3, Checkpoint 3 — "Split by {unitLabel}" workflow — COMPLETE, 2026-07-09 (COMMITTED as `6be6e68`)

A dedicated, explicitly design-only review ran first ("do not write any code yet" was the session's
opening instruction), producing four compared UI/UX alternatives (inline expandable sub-rows, a
Modal-based editor, a slide-over drawer, an inline popover) weighed against the grid's fixed-height
virtualization, the existing autosave/optimistic-locking model, and consistency with Checkpoint 2's
editing experience. **The user approved a Modal-based Split editor**, with eight required
implementation decisions — most consequentially, that the modal must share the grid's existing
debounced-autosave/version-locked commit queue rather than introduce a separate Save/Cancel
workflow, since it is "another editing surface for the same Payroll Entry, not a different editing
system." Implementation began only after this approval.

- **No backend or shared-schema changes** — Checkpoint 1 had already built full Work Line CRUD
  (`addWorkLine`/`updateWorkLine`/`deleteWorkLine`) and its Zod schemas; this checkpoint is their
  first frontend caller. No gap was found, so no new endpoint was added.
- **`usePayrollEntryEditor` generalized** from a single primary-work-line draft to a `lineDrafts` map
  keyed by work-line id, with one shared `commit()` sequentially flushing entry fields then every
  dirty line, all under the same `savingRef` gate and one chained `version` — so an edit made inline
  in the grid and an edit made a moment later in the modal are never two independent commit loops
  racing for the same lock. `addLine`/`deleteLine` are immediate, non-debounced mutations (matching
  how every other structural action in this app persists instantly), still serialized through the
  identical gate. The grid's existing primary-line cells are unchanged and remain directly editable
  even once an entry is split, since both surfaces now share the identical draft state — no data-
  drift risk, an improvement over a concern the pre-approval design review had flagged.
- **`buildCalcInput` generalized** to accept overrides for every work line, not just the primary one
  — a non-primary line edited in the modal live-updates the row's Net Salary and the sticky totals
  row through the same shared `calcNet` call, verified in this session's Playwright pass.
- **New `SplitWorkLinesModal`** follows the existing Manage Units panel's list/delete-confirmation
  pattern. The lowest-`sortOrder` line is always visibly labeled **Primary**, with a note that it
  drives the Leave Rate fallback basis (`database/payroll-entry.md §12`) — never left for the
  operator to infer from `sortOrder`. Every unit picker (per-line, and "add a {unitLabel}") is
  scoped to the entry's fixed `siteId` and excludes units already used by another line on the same
  entry — cross-site selection and duplicate units are structurally impossible via the UI. Deleting
  a line requires an explicit Cancel/danger-"Remove line" confirmation first; deleting the last
  remaining line is disabled client-side, mirroring the backend's own guard.
- **Entry point is a textual badge** ("1 Branch" / "2 Branches"), not an icon, reusing the existing
  `pluralize()` utility rather than the literal word "Unit" — a new `units` grid column, deliberately
  excluded from the grid's Up/Down keyboard-navigation column list since it is a button, not a
  data-entry field.
- **Verification (real-stack, this session)**: `typecheck`/`lint`/`build` clean across all three
  workspaces; backend suite unchanged at **160/160** (no backend files touched); a real-stack
  Playwright script (live Postgres, live backend + frontend dev servers, real Chromium) drove every
  item the checkpoint's plan named — adding/deleting lines, the last-line-delete guard, duplicate-
  and cross-site-unit prevention, the Primary line label, live Net Salary recalculation from a
  non-primary line, autosave persistence surviving a full page reload, a genuine simulated
  concurrent-edit conflict correctly surfaced and recovered from, and Tab order inside the modal.
  **23 of 24 explicit checks passed**; the one "failure" was the browser's own automatic console
  logging of two deliberately-provoked non-2xx responses (a pre-login 401 — the same already-
  documented pattern from Checkpoint 2's own verification — and the 409 this test exists to
  trigger), not an application defect.
- **One real bug found and fixed during this session's own verification**: the "no units left to
  add" message read "Every branches at this site is already on this entry" — `pluralize()` applied
  where the sentence grammatically needs the singular. Fixed to "Every branch…"; re-verified.
- **Explicitly out of scope**: the multi-select site filter/"Copy to All" toolbar (Checkpoint 4),
  import/export (Checkpoint 5), the 10,000-employee performance validation (Checkpoint 6), and any
  Release/Finance/Corrections/Balance-Adjustment/Advance code path. Line reordering (changing which
  line is Primary) was deliberately not built — the modal only displays which line is Primary.
- **Full decision record**: `docs/IMPLEMENTATION_PLAN.md`'s Phase 3 Checkpoint 3 subsection has the
  complete architectural detail. **Committed as `6be6e68`** — "feat(payroll): implement Phase 3
  Checkpoint 3 Split by Unit workflow" — after the final architectural verification pass below.

### Phase 3, Checkpoint 3 — Pre-Commit Final Verification Pass — 2026-07-09

Before staging or committing anything, a dedicated final architectural verification was requested
and performed — network-request-level, not just UI-assertion-level — specifically targeting the
autosave-batching/queueing design this checkpoint's `usePayrollEntryEditor` generalization relies on.

**One further real bug found and fixed**: `payroll-entry-totals-row.tsx` renders one hardcoded
`<div role="cell">` per column and was never updated when the new `units` column was inserted into
`PAYROLL_COLUMNS` — every totals-row value from Working Days onward was silently shifted one column
left of its header. Fixed by inserting the matching empty cell in the same position; re-verified
visually (Playwright screenshot: every summed value correctly under its own header again). Recorded
as a standing lesson: the totals row's cells are not generated from `PAYROLL_COLUMNS`, so any future
column insertion must touch both files by hand.

**Batching/queueing/concurrency, verified with real network captures (not inferred from reading the
code):**
- **Batching**: editing 4 fields across 2 different work lines within one 600ms debounce window
  produced exactly one autosave cycle — 0 entry PATCHes, exactly 2 work-line PATCHes (one per dirty
  line, each request carrying every one of that line's changed fields together, never one request
  per field), sent strictly sequentially, the second correctly carrying the `version` the first
  PATCH's response returned.
- **Queueing during an in-flight save**: with work-line PATCHes artificially delayed 1800ms to force
  a genuine in-flight window, further edits to two different lines made during that window were
  never sent as parallel requests — they queued and flushed as two further sequential PATCHes once
  the in-flight one completed (three total, each ≥1500ms apart, proving no overlap). Final server
  state exactly matched the last value entered for every field, including the queued line's edit —
  nothing lost, nothing overwritten by a stale in-flight response.
- **Rapid restructuring stress test**: add a line → edit two lines' fields → delete a line (via the
  confirm flow) → keep editing the remaining lines, all within under a second of real interaction
  time — zero 409s, zero 4xx/5xx of any kind, zero duplicate requests, final server state matching
  every one of the UI's last-entered values.
- **Regression check**: a second, ordinary (non-split, single-line) entry on the same grid, edited
  exactly as Checkpoint 2 originally verified (inline Gross Pay/Working Days) — still exactly one
  entry PATCH + one work-line PATCH per autosave cycle, Up/Down keyboard navigation between rows
  still works, and the sticky totals row (screenshot-verified) still sums and aligns correctly. No
  behavioral or visual regression from Checkpoint 2.

Optimistic locking was confirmed to still operate exclusively at the `PayrollEntry` level throughout
— every PATCH in every scenario carried the parent entry's `version`, work lines never carried one of
their own, exactly per `database/schema-invariants.md` §22, unchanged from Checkpoint 1's backend.

**Backend suite re-run once more after the totals-row fix: 160/160, unchanged.**
`typecheck`/`lint`/`build` re-verified clean across all three workspaces.

**Committed as `6be6e68`** — "feat(payroll): implement Phase 3 Checkpoint 3 Split by Unit workflow" —
after this final architectural verification pass and explicit approval. **Phase 3 Checkpoint 3 is
now complete and closed.**

### Phase 3, Checkpoint 4 — Multi-select site filter + "Copy to All" — COMPLETE, 2026-07-09 (COMMITTED as `70a52da`)

A read-only architecture review ran first (no code), producing a plan for the site filter and Copy
to All plus two explicitly open architectural questions. A **second, dedicated investigation session**
then answered both — "do not guess, base the conclusion only on the current codebase" was the
explicit instruction — before any implementation began:

1. **Is a new backend bulk-update endpoint actually required?** Yes — confirmed by direct evidence,
   not inference: `database/schema-invariants.md` §23's standing rule ("bulk writes over row-by-row
   loops... even though [the affected set] is typically small," illustrated by the mandatory
   `PayrollUnitRelease` sweep precedent — a single `UPDATE ... WHERE`, never a loop, even for a
   typically-small affected set); the `employee.import` audit entry's already-shipped
   one-summary-row-per-bulk-action precedent (`employees.routes.ts:81-92` — `entityId: null`,
   counts in `metadata`); and a concrete O(N²) React-Query cache-merge cost that looping the
   existing single-entity mutations from the frontend would introduce (`replaceEntry` scans the full
   cached array per call).
2. **Does Copy to All apply to a split entry's primary line only, or every line?** Genuinely
   ambiguous in the documentation — `IMPLEMENTATION_PLAN.md`'s own "copied per-line since they can
   legitimately differ by unit" phrasing is defensibly readable either way, and `database/payroll-entry.md`
   §12a's "site/unit-typical" framing of `cycleDays` doesn't resolve it either. Stated as ambiguous,
   not silently resolved, with a recommendation: **primary line only**, frozen as the decision —
   strict consistency with the grid's own inline Cycle Days/OT Rate columns (primary-line-only since
   Checkpoint 2) outweighs the alternative, and non-primary lines stay reachable exclusively through
   the Split by {unitLabel} modal, never touched as a side effect of a broad action.

**Implementation**, exactly following the frozen decisions:
- **No backend endpoint reuse-by-looping anywhere** — one new `PATCH
  /api/v1/payroll-cycles/:cycleId/entries/bulk`, one new `bulkUpdatePayrollEntries` service function,
  one transaction, one `updateMany` (two when a work-line write also needs its parent entries'
  `version` bumped), one summary audit entry. RBAC reuses the existing `assertSiteAccess` per
  requested site (not per entry) and the existing `PERMISSIONS.PAYROLL_ENTRY` — no new permission.
  **Deliberate, documented exception to per-row optimistic locking**: this endpoint does not take or
  check a caller-supplied `version` per row (a criteria-scoped administrative sweep, not a targeted
  edit of a row the caller just read) — each row's `version` still increments, so a genuinely
  concurrent edit elsewhere still correctly 409s on its own next save.
- **The site filter needed no backend change at all**, confirming the read-only review's conclusion:
  `usePayrollEntries` already fetches every entry the user can see for the cycle, so filtering is a
  memoized in-memory `Array.filter()`, and the sticky totals row is scoped to the filtered set for
  free (`LiveTotalsStore.setBase` already took an explicit array, not a global).
- **New, genuinely reusable `MultiSelectFilter`** (`frontend/src/components/ui/multi-select-filter.tsx`)
  — no Payroll-Entry-specific text or logic, per `reference/PROJECT_SPEC.md` item 10's naming of
  Release Salary and the Fines/EOBI report as future callers of this same component. Built on a new
  `DropdownMenuCheckboxItem` primitive (existing `dropdown-menu.tsx`, extended rather than
  duplicated) whose `onSelect` stays open across repeated toggles, unlike the existing action-menu
  `DropdownMenuItem`.
- **New `CopyToAllToolbar`** — three field/value pairs (Cycle Days, OT Rate, Leave Rate) matching
  `reference/payroll_prototype.html`'s original reference design, reusing the grid's own
  `isValidDecimalDraft`/`parseValidCycleDays` validation and the existing `sonner` toast mechanism
  for feedback (`new-cycle-modal.tsx`'s established pattern) — no new feedback/validation mechanism
  invented.
- **Cache strategy is a full refetch on bulk success** (`useBulkUpdatePayrollEntries` invalidates the
  cycle's entries query), deliberately not a manual per-row merge — a bulk action can touch far more
  rows than the virtualizer ever mounts, so there's no bounded set to merge the way the single-row
  mutations' `replaceEntry` already does.
- **Verification (real-stack, this session)**: `typecheck`/`lint`/`build` clean across all three
  workspaces. **5 new backend tests, full suite 165/165** against a freshly re-provisioned database
  (RBAC boundary on `siteIds`; primary-line-only targeting proven against a genuinely split entry —
  the secondary line's `cycleDays` asserted byte-identical to its seeded value, never touched;
  entry-level `leaveRate` scoped correctly to the selected site only; a released entry correctly
  skipped — counted in `matchedCount`, excluded from `appliedCount` — without failing the whole
  batch; a non-Draft cycle rejecting the entire request). A real-stack Playwright pass, **15/15
  checks**, drove the real UI: site selection narrowing the grid and the totals row together
  (confirmed via the literal "N employees" total); Copy to All correctly gated by two independent
  conditions (a site selected, and a valid value typed — both verified separately); a bulk apply on
  a genuinely split entry updating only its primary line, server-side-confirmed; a second site's
  entry, deliberately outside the filter, confirmed completely untouched by the same request;
  clearing the filter restoring every site; and explicit regression checks — Checkpoint 2's ordinary
  inline autosave and Checkpoint 3's Split by {unitLabel} badge/line-count both re-verified working
  unchanged.
- **Two benign test-harness bugs found and fixed during verification, not product defects**: (1) an
  early Playwright assertion checked a "Copy to All" button's disabled state before a value had been
  typed into its input, incorrectly reading the button's *correct* value-empty disabled state as a
  site-filter failure — fixed by checking both gates (site selected; site selected + valid value)
  separately, both now passing. (2) the same shared-dev-database test/Playwright-fixture contamination
  pattern already documented in Checkpoint 3's own verification recurred (this session's own manual
  API-driven fixtures colliding with the automated suite's own fixtures) — resolved the same way, by
  re-provisioning a pristine database for the final confirmation run.
- **Explicitly out of scope, none introduced**: search, drag-to-reorder, the Release workflow,
  CSV/Excel import/export (Checkpoint 5), and anything from Phase 4 onward.
- **A final repository-wide verification pass preceded commit** (2026-07-09, explicitly requested):
  diff-scope review confirming only the intended files changed; merge-marker, TODO/FIXME, and
  debug-logging sweeps (none found); a fresh `typecheck`/`lint`/`build`; the backend suite and the
  real-stack Playwright pass both re-confirmed clean against a freshly re-provisioned database; and a
  spot-check of the documentation diff against the actual shipped code for accuracy. No defects found.
- **Committed as `70a52da`** — "feat(payroll): implement Phase 3 Checkpoint 4 multi-site filtering and
  Copy to All". **Phase 3 Checkpoint 4 is now complete and closed.**

### Phase 3, Checkpoint 5 — Payroll Entry CSV/Excel import/export — COMPLETE, 2026-07-09 (COMMITTED as `b4c1d21`)

A dedicated read-only architecture review preceded implementation (per the user's own explicit
process for this project), covering what Checkpoints 0–4 already built, the reusable Employee
Registry import/export infrastructure, the frozen `PayrollEntry`/`PayrollEntryWorkLine` schema, and
`reference/PROJECT_SPEC.md`'s own Payroll Entry template — which the review flagged as predating
Phase 2.5 entirely (written before `ProjectUnit`, `PayrollEntryWorkLine`, optimistic locking, or
derived `released` existed). The review presented the resulting design gap as three concrete
options rather than silently resolving it, and surfaced four further open implementation questions
(match keys, import semantics, optimistic-locking treatment, audit-logging scope). All were
answered and frozen by the user before any code was written:

- **Wire format — "Option C" (frozen, do not re-litigate)**: the format stays flat, one row per
  employee, representing only an entry's **primary** work line — the same "primary line only" rule
  Checkpoint 4's "Copy to All" already froze for bulk mutations, extended here rather than reopened.
  A split employee's non-primary lines are never represented in the file and are never touched by
  import; they remain reachable exclusively through the grid's Split by {unitLabel} modal. The
  limitation is communicated via UI copy (a note shown above the grid whenever any currently-visible
  entry has more than one work line), not by growing the file format with a Unit column and
  multi-row-per-employee semantics (the rejected "Option B").
- **Match keys — Employee Code and CNIC, both supported**, not CNIC alone (the frozen spec's
  original single key, which cannot address an employee with no CNIC on file — optional since Phase
  2.5 Checkpoint 4). Both keys, if both provided, must resolve to the same employee or the row is a
  per-row error — the same two-key defense-in-depth pattern `resolveRowUnit` already uses for
  Employee Registry import's own Branch-Code/Area resolution.
- **Import semantics — update-only.** Never creates a `PayrollEntry` or `PayrollEntryWorkLine`,
  never bootstraps an employee into the cycle, never modifies `siteId` (permanently non-editable,
  unchanged since Checkpoint 1) or `released`/`releasedAt`/`releasedBy` (the exported `Released`
  column is read-only/informational, never parsed back into a write). A row identifying no matching
  entry in the target cycle is skipped and reported, exactly like every other per-row failure.
- **Optimistic locking — the Checkpoint 4 administrative-bulk-operation precedent, extended, not a
  new exception.** No `version` column in the spreadsheet, no per-row version pre-check; every
  successfully updated row still increments `PayrollEntry.version`, so a row concurrently open in
  the grid (an in-flight autosave, an open Split modal) correctly 409s on its own next save.
- **Audit logging — one summary entry per operation, for *both* import and export** (`payroll_entry.import`,
  `payroll_entry.export`) — never one row per imported entry. Export logging its own summary entry is
  a deliberate, explicitly-requested deviation from Employee Registry's own export (which logs
  nothing) — noted here as an intentional inconsistency with that precedent, not an oversight.

**As built:**
- **`backend/src/common/import-export.ts`** (new) — `parseTableFromFile()`, extracted unchanged from
  `employees-import-export.service.ts`'s own CSV/XLSX-to-`string[][]`-table logic (the same ExcelJS/
  csv-parse handling, including the `Date`-cell-to-ISO conversion), so Payroll Entry's own,
  differently-headered importer reuses it instead of duplicating it — the standing "grep for
  duplicates on new shared utility" rule applied proactively. `employees-import-export.service.ts`
  was refactored to call this shared helper too (behavior unchanged, confirmed by the full Employee
  Registry test suite still passing). Also hosts the shared `ImportRowError` type both importers'
  `ImportResult` shapes now use.
- **`backend/src/modules/payroll-entry/payroll-entry-import-export.service.ts`** (new) —
  `PAYROLL_ENTRY_TEMPLATE_HEADERS` (`CNIC, Employee Code, Name, Site, Designation, Gross Pay, Days,
  OT Hrs, OT Rate, Allowance, Leave, Leave Rate, Cycle Days, EOBI Amount, EOBI On, Advance, Eid
  Advance, Fine, Hold, Released`); `exportPayrollEntriesToCsv`/`Xlsx` (`siteIds`-filterable, one row
  per entry, primary line only); `parsePayrollEntryImportFile`; `importPayrollEntries` — a per-row
  loop (parse → resolve entry by Employee Code/CNIC → `assertSiteAccess` → `assertEntryEditable` →
  validate via `updatePayrollEntrySchema`/`updateWorkLineSchema` minus `version` → write via
  `mapUpdateInputToEntryData`/`mapUpdateInputToWorkLineData` → increment `version` → next row),
  deliberately mirroring Employee Registry's own per-row-independent-try/catch import loop rather
  than `bulkUpdatePayrollEntries`'s single `updateMany` — these rows are heterogeneous per-employee
  edits, not a uniform criteria-scoped sweep, so the row-by-row model is architecturally the right
  fit here even though it's a different shape than Checkpoint 4's own bulk endpoint.
- **Two small, safe extractions from `payroll-entry.service.ts`, reused rather than duplicated**:
  `mapUpdateInputToEntryData` (already existed, just exported) and `mapUpdateInputToWorkLineData`
  (newly extracted from `updateWorkLine`'s previously-inline field-mapping object, which now calls
  it too — behavior byte-identical, confirmed by the full existing `payroll-entry.test.ts` suite
  still passing unchanged). `assertEntryEditable` (already existed) is also now exported and reused
  verbatim for the released-row/non-Draft-cycle rejection — no reimplementation of that rule.
- **Routes**: `GET /api/v1/payroll-cycles/:cycleId/entries/export` and
  `POST /api/v1/payroll-cycles/:cycleId/entries/import`, nested on the existing
  `payrollCycleEntriesRouter` alongside `/bulk` (multer, 10MB limit, matching Employee Registry's own
  convention). Both gated on the single pre-existing `PERMISSIONS.PAYROLL_ENTRY` — **no new
  permission was introduced**, per the approved RBAC decision.
- **Frontend**: `downloadPayrollEntryExport()`/`useImportPayrollEntries()`
  (`frontend/src/hooks/use-payroll-entries.ts`), mirroring `use-employees.ts`'s own export/import
  hooks exactly. `frontend/src/lib/api-client.ts`'s private cookie-reader was exported (`readCookie`)
  so both employee and payroll-entry import hooks share one CSRF-cookie-reading implementation
  instead of each redefining the same three-line regex a second/third time.
  `frontend/src/routes/payroll-entry-page.tsx` gained Export CSV/Export Excel/Import buttons in its
  toolbar, a new `ImportResultModal` (symmetric to Employee Registry's own, minus the "created" count
  since this import is update-only), and the split-entry UI note described above (computed
  client-side from the already-loaded `entries` array's own `workLines.length`, no new backend
  endpoint needed for that count).
- **Tests**: `backend/tests/payroll-entry-import-export.test.ts` (new) — CSV import, XLSX import,
  export header-row/round-trip, Employee-Code-only matching, CNIC-only matching (including a
  dashed-CNIC normalization case via the shared `normalizeCnic`), a released-row skip (reusing
  `assertEntryEditable`, asserted to leave the entry's real value untouched), a whole-request 400
  against a non-Draft cycle, a manipulated-site RBAC rejection via a direct API call (the C11
  boundary-test pattern, reused for this new surface), an unknown-employee/no-entry-in-cycle skip,
  and one summary `AuditLog` entry per import and per export (each independently asserted). **One
  real test-authoring bug found and fixed while writing these** (not a product defect): an initial
  dashed-CNIC fixture string decomposed to 14 digits instead of the fixture employee's real 13-digit
  CNIC once the dashes were stripped — a test-data arithmetic error, caught immediately by the test
  itself failing with "0 updated" instead of "1 updated," fixed by correcting the dashed grouping to
  decompose to the exact same 13 digits. **Full suite: 175/175 against live PostgreSQL** (165 prior +
  10 new).
- **Verification**: `typecheck`/`lint`/`build` clean across all three workspaces (frontend
  `.tsbuildinfo` cleared first, per the standing `@payroll/shared`-change lesson; same 4 pre-existing
  `react-refresh` warnings, none new — none of Checkpoint 5's own new/edited files appear in the lint
  output). A real-stack Playwright pass (live browser → Vite → Express → PostgreSQL via
  `embedded-postgres`, **13/13 checks**) drove the actual UI end to end: exported CSV's header row
  matches the template exactly; a split employee's row appears in the export showing only its
  primary line; Excel export downloads and is non-empty; a CSV import updates the matched row (a
  Gross Pay/Days/OT Hrs/Allowance change) and reports "1 updated / 1 skipped" with the exact per-row
  skip reason for the unmatched CNIC; the imported value was confirmed **persisted server-side** via
  a direct API call after a full page reload, not just asserted from rendered grid text; a genuine
  XLSX round-trip (re-importing the just-downloaded `.xlsx` export unmodified) succeeded through the
  real ExcelJS parsing path and reported updates, not an error; the split-entry UI note rendered
  correctly for a deliberately-split fixture employee; and — the explicit regression requirement —
  Checkpoint 2's ordinary inline-autosave path was re-exercised (a plain, unrelated entry's Gross Pay
  edited directly in the grid) and confirmed to still persist correctly after all of the above. Zero
  unexpected browser console errors throughout (the one pre-existing, documented pre-login 401
  excepted, per every prior checkpoint's own established convention for this).
- **Explicitly out of scope, none introduced**: any Unit/multi-row representation in the file format
  (the rejected Option B), Release, Corrections, Balance Adjustments, Advance FKs, and Checkpoint 6's
  own 10,000-employee performance/concurrency floor validation.
- **Committed as `b4c1d21`** — "feat(payroll): implement Phase 3 Checkpoint 5 payroll entry
  import/export", after review and explicit approval, following independent end-to-end verification
  (typecheck/lint/build clean, 175/175 backend tests, 13/13 real-stack Playwright checks) — the same
  per-checkpoint discipline every prior checkpoint in this phase has followed. **Phase 3 Checkpoint 5
  is now complete and closed.**

### Phase 3, Checkpoint 6 — Performance/concurrency validation at the 10,000-employee floor — COMPLETE, 2026-07-10 (COMMITTED as `3298e34`)

**A dedicated read-only architecture review preceded implementation** (this session), covering the
rendering/virtualization/React Query/autosave architecture Checkpoints 0–5 already built. Five
decisions were frozen before any code was written:

1. **Keep the existing in-memory grid architecture** — no server-side windowed fetching.
   `LiveTotalsStore`, Copy to All, the multi-site filter, import/export, and the React Query cache
   all already assume the whole cycle is resident client-side; only the fetch strategy *within* that
   model was open for optimization.
2. **Only replace `LiveTotalsStore`'s full-recomputation model with an incremental running total if
   measurement proves it is the bottleneck** — never a server aggregate, never a hybrid.
3. **Leave `invalidateQueries` (the cache strategy after Copy to All/import) unchanged** unless
   measurement proved otherwise.
4. **Concrete engineering targets, not hard SLAs**: initial load ≤2s target/≤3s acceptable upper
   bound; no visible typing lag at normal human speed; smooth scroll (no obvious frame drops); Copy
   to All ≤2s; import/export correctness prioritized over speed with no strict UI target; memory may
   grow during large operations but must stabilize afterward; zero lost updates under concurrency.
5. **The Definition of Done's "review, release" clause is historical wording**, predating the
   2026-07-07 seven-checkpoint restructuring — Release does not exist yet (Phase 4); Checkpoint 6
   does not implement or validate it. Noted in `docs/IMPLEMENTATION_PLAN.md` with a dated revision
   note rather than silently reinterpreted.

**Concurrency methodology deliberately kept consistent with the project's existing practice**: the
backend test suite (supertest) plus parallel `Promise.all` requests — no dedicated load-testing
framework (k6/Locust/Artillery/JMeter), per explicit instruction.

**New `backend/tests/payroll-entry-performance.test.ts`** — the first *committed, repeatable*
performance/concurrency test at this scale. Checkpoint 1's own 3,000-employee bootstrap timing
(`docs/IMPLEMENTATION_PLAN.md`'s Checkpoint 1 entry) was an informal, uncommitted smoke test, never
run at 10,000 and never made part of the automated suite — this file closes that gap. Seeds a
synthetic 10,000-employee, 10-site cycle once (`beforeAll`, reused/progressively mutated across the
file's own tests rather than re-seeded per test) and measures: cycle bootstrap; a single page's
`EXPLAIN ANALYZE` confirming Index Scan usage (not a sequential scan) both unfiltered and
site-filtered; the original sequential page-to-completion fetch measured against the candidate
parallelized alternative; a 50-way concurrent distinct-row edit burst; a deliberately provoked
same-row race; Copy to All at 10,000-row scope; export; import. **9 new tests.**

The fetch-comparison test asserts on **distinct entry IDs seen across all pages**, not the row count
summed across pages — a weaker "count" assertion would not have caught the pagination bug below,
since 50 pages of exactly 200 rows always sums to 10,000 by construction even when pagination
silently duplicates some rows and drops others entirely.

**A real, pre-existing correctness bug was found and fixed — not a performance one.** Every
`PayrollEntry` created by `createPayrollCycle`'s bootstrap (Checkpoint 1, 2026-07-07) defaulted to
`sortOrder = 0`: the function never assigned it, silently relying on the schema column default.
Invisible at the small scale every prior checkpoint's testing used. At the 10,000-employee floor,
`ORDER BY sortOrder ASC LIMIT/OFFSET` pagination over 10,000 rows all tied on the same value is
unstable in Postgres (no tiebreaker guarantee) — confirmed at the raw SQL level to silently
duplicate 23 rows across page boundaries while 23 different rows were never fetched at all.
**Discovered via this checkpoint's own real-browser (Playwright) measurement pass** (the grid's own
totals-row employee count plateaued at 9,977, never reaching 10,000) — no existing automated test
caught it, because every prior test creates a handful of entries through the single-entity
create-entry endpoint (which correctly assigns `sortOrder`), not through the bootstrap path. Fixed
in `backend/src/modules/payroll-processing/payroll-processing.service.ts`: each bootstrapped entry
now gets its own loop-index `sortOrder`, matching the convention `createPayrollEntry`'s single-entity
path already used (`maxSortOrder + 1`). A dedicated regression test asserts the bootstrap produces
exactly 10,000 distinct `sortOrder` values; re-verified via a real browser reload showing zero
duplicate/missing rows.

**Decision 1 applied, measurement-justified.** The measured sequential page-to-completion fetch —
2.8s, roughly 94% of the 3s acceptable ceiling *before any client-side rendering cost is added* —
left too little headroom, justifying the approved fix. `usePayrollEntries`
(`frontend/src/hooks/use-payroll-entries.ts`) now fetches page 1 alone to learn `total`, then the
remaining pages in concurrency-capped (8-wide, the batch size measured in the backend suite)
parallel batches, replacing the original one-page-at-a-time sequential loop. No change to the
in-memory grid model, `LiveTotalsStore`, Copy to All, the site filter, or React Query's cache — this
is a fetch-strategy change within the existing architecture, exactly as Decision 1 scoped it, not a
redesign of it.

**Decision 2 — measured, deliberately NOT applied.** Real-browser keystroke measurement showed
47–52ms per real keystroke (well under any human typing cadence) and only one >50ms long task during
an artificial rapid-fire stress test (15 keystrokes fired with zero delay between them, far faster
than any human typist could actually type). This did not meet the bar of "proves it is the
bottleneck," so `LiveTotalsStore`'s full-recomputation model was left exactly as it was, per Decision
2's explicit instruction. No server aggregate, no hybrid architecture, no change of any kind.

**Decision 3 — left unchanged.** `invalidateQueries` after Copy to All/import was not touched — no
measurement showed it as an actual bottleneck worth a targeted-merge implementation.

**Decision 4 targets — all measured and met** (real browser, post-fix, against a freshly bootstrapped
10,000-row cycle):
- Initial load to a confirmed-complete state (grid's own totals-row count reaching 10,000): **2.75s**
  (within the ≤3s acceptable bound, close to the ≤2s target).
- Per-keystroke latency: **47–52ms** (no visible lag at any realistic human typing speed).
- Scroll: **zero long tasks** across 20 scroll steps.
- Copy to All across 10,000 entries: **580ms** (target ≤2s).
- Export (10,000 rows): **1.8–1.9s**. Import (10,000 rows, row-by-row per the already-approved
  Checkpoint 5 architecture — correctness over speed, no strict target per Decision 4): **40–44s**,
  100% of matched rows updated correctly, 0 skipped.
- Memory: **104MB → 95MB** after a sequence of scroll + editing operations — stabilized (and
  reclaimed, consistent with normal GC behavior), no unbounded growth.

**Verification**: `typecheck`/`lint`/`build` clean across all three workspaces (same 4 pre-existing
frontend warnings, none new). **9 new backend tests, full suite 184/184** (175 prior + 9 new) against
a freshly re-provisioned database. A real-stack Playwright regression pass against the freshly
bootstrapped, correctly-`sortOrder`'d 10,000-row cycle: inline edit + autosave persistence verified
for a row deep in the virtualized list (~row 5000 of 10,000, matched by employee identity via its
exact `aria-label`, not by DOM position, after an initial position-based check produced a false
negative from virtualizer mounted-window non-determinism across two separate page loads) surviving a
full page reload; the multi-site filter narrowing the grid and totals-row count to exactly one
site's 1,000 employees; Copy to All confirmed — via a direct database query, not just the UI toast —
scoped to only the filtered site's 1,000 entries, leaving the other 9,000 untouched; the Split by
Unit modal opening correctly and showing the Primary line label; zero unexpected browser console
errors throughout (the one pre-existing, documented pre-login 401 excepted, per every prior
checkpoint's own convention).

**Explicitly out of scope, none introduced**: Release, Corrections, Balance Adjustments, Advances,
and any Phase 4+ work — this checkpoint is validation and measurement-justified optimization of the
existing Checkpoint 0–5 architecture only, per its own frozen scope.

**Committed as `3298e34`** — "feat(payroll): complete Phase 3 Checkpoint 6 performance validation",
after review and explicit approval, following independent end-to-end verification (typecheck/lint/
build clean, 184/184 backend tests including the 9 new performance/concurrency tests, a real-browser
regression pass) — the same per-checkpoint discipline every prior checkpoint in this phase has
followed. **Phase 3 Checkpoint 6 is now complete and closed. Phase 3 (Checkpoints 0–6) is now fully
complete and closed.**

### Phase 3.5, Checkpoint 0 — architecture revision: Chat removed, Tasks Workspace, Phase Close-Out Rule — COMPLETE, 2026-07-10, COMMITTED as `0fb296e`

A separate, later session-within-the-day, run before any Phase 4 work, in two rounds: a read-only
impact analysis first (repository search for every Chat reference, a proposed Tasks Workspace design,
proposed Phase Close-Out Rule locations, a Phase 3.5-vs.-Phase-4-Checkpoint-0 recommendation), then a
second, sharper read-only investigation once the design was approved in principle (13 explicit
questions: which documentation/architecture files change, whether phase numbering or navigation
tables need renumbering, whether folder-structure/database-planning/permissions/RBAC docs change,
prototype-naming implications, SESSION_HANDOFF/PROJECT_PROGRESS structural edits, and Phase 8's
fate) — both rounds produced no code/schema/doc changes themselves, only proposals, per their own
explicit read-only scope.

**Frozen decisions, approved after the second round:**
1. **Phase 3.5 — Tasks Workspace** now exists between Phase 3 and Phase 4 in
   `docs/IMPLEMENTATION_PLAN.md`, following the exact precedent Phase 2.5 already set (a
   self-contained, gated insert between two numbered phases) — not "Phase 4 Checkpoint 0," since
   Tasks shares no schema/service/UI dependency with Release/Bank Sheets/Advances in either direction
   (confirmed via `docs/architecture/overview.md`'s module table before this decision was finalized).
2. **Chat is permanently removed, not deferred.** There will never be chat, messaging, comments,
   discussion threads, attachments, subtasks, a Kanban view, or recurring tasks in this feature — a
   deliberately lightweight, permanent boundary.
3. **Task visibility is ownership-based** — Master User sees every task; the assigned user sees only
   their own; no one else can see or query it. Explicitly not site-based, not role-based — a genuine,
   named exception to this system's RBAC shape (`docs/architecture/authentication.md`'s new "Tasks:
   ownership-based visibility" section).
4. **One new permission, `tasks:manage`, Master-User-only.** Assignees need no permission beyond
   authentication for their own tasks. No new role.
5. **Status lifecycle: `TO_DO` → `COMPLETED`/`CANCELLED`, deliberately no `IN_PROGRESS`.** Master
   User may reopen a completed task. Only Master User edits title/description/priority/due
   date/assignment; an assignee's only write is marking their own task complete.
6. **Priority: Low/Medium/High. Due date optional. No recurring tasks.**
7. **Notifications persist only three event types** — assigned, reassigned, completed. Due-today/
   overdue are computed live, never stored. No WebSockets/SSE — ordinary polling.
8. **Sorting: Due Date, Priority, Recently Assigned only** (`Task.assignedAt`, a dedicated column
   distinct from `createdAt`, added specifically to support the third option accurately across
   reassignment).
9. **The HTML prototype review rule is now a permanent Definition-of-Done requirement**, alongside
   the existing Playwright rule (`docs/IMPLEMENTATION_PLAN.md`'s Definition of Done section) —
   **strengthened during this round to check both directions**, not just "create what's missing": (a)
   every shipped feature has a prototype where appropriate, and (b) no existing prototype under
   `docs/prototypes/` demonstrates behavior no longer present in the shipped architecture — the
   second direction is exactly what would have caught the obsolete Chat panel, had a prototype for it
   ever existed. Standing checklist: review existing prototypes → remove/update obsolete behavior →
   create missing prototypes → verify the set matches shipped behavior → only then documentation
   updates → repository close-out.
10. **Prototype filenames use the literal phase number, including fractional ones** — decided this
    round specifically because Phase 3.5 is this convention's first fractional-phase case:
    `phase3.5-tasks-workspace-preview.html`, never folded into `phase3-*`/`phase4-*` naming.
11. **Phase 8 keeps its current title unchanged for now**, even though it loses the Team
    Collaboration line entirely (moved to Phase 3.5) — revisit only if it becomes genuinely
    misleading after further low-priority work accumulates there; not renamed preemptively.
12. **`reference/PROJECT_SPEC.md` and `reference/payroll_prototype.html` were confirmed untouched and
    must remain so** — both still describe the retired Chat concept as client-provided historical
    reference; living documentation supersedes them, per this project's established precedent (the
    "Master Admin"→"Master User" rename was handled the identical way, 2026-07-05).

**Documentation actually revised this round** (all documentation-only, verified against a clean
working tree before starting): new `docs/architecture/database/tasks.md` (§27–§27a); `docs/
architecture/database/README.md` (navigation row, §→file lookup, 17→18-module cross-reference);
`docs/architecture/overview.md` (new Tasks module row, both self-referential "17-module" mentions
corrected to 18, a new cross-cutting diagram note); `docs/architecture/authentication.md` (new
"Tasks: ownership-based visibility" section); `docs/architecture/folder-structure.md` (new `tasks/`
module-list line, and its own stale "15 modules" cross-reference corrected to 18 while already being
edited); `docs/design-system.md` (the `.team-panel` row reworded); `docs/IMPLEMENTATION_PLAN.md` (new
Phase 3.5 section, Phase 8's `Builds:` line trimmed, the Module Implementation Order table and
Dependency Graph both updated with an explicit note that the Phase 3.5→4 arrow is a sequencing choice
rather than a technical dependency, and the new HTML-prototype Definition-of-Done bullet); this file;
`docs/SESSION_HANDOFF.md` (§1 status, §3 permanent-rules block, §7 next-steps renumbered so Phase 3.5
precedes Phase 4). **Not touched, per the frozen "never edited" rule**: `reference/PROJECT_SPEC.md`,
`reference/payroll_prototype.html`.

**Explicitly out of scope this round, none introduced**: no `Task`/`TaskNotification` Prisma model,
no migration, no backend route, no frontend component, no `docs/prototypes/phase3.5-*.html` file (that
comes only once Phase 3.5 is actually implemented, not during its own architecture revision) — per
this round's own explicit documentation-only authorization.

**Committed as `0fb296e`** — "docs: add Phase 3.5 planning and Tasks Workspace architecture", after
review and explicit approval. **Checkpoint 0 is complete and closed.**

### Phase 3.5, Checkpoints 1–3 — Tasks Workspace implementation — COMPLETE, 2026-07-10, COMMITTED as `1220dce`

Three further gated checkpoints, each implemented and independently reviewed/approved before the next
began, landing together in one implementation commit once Checkpoint 3's own verification closed:

**Checkpoint 1 — Database Foundation + Shared Contracts (architecture review, then implementation).**
A dedicated backend architecture review preceded any code — comparing the approved Phase 3.5 design
against this codebase's own actual conventions (not just the frozen docs), confirming `Task`/
`TaskNotification`'s exact schema shape, that `requireTaskAccess` could not be genuine Express
middleware the way `requireSiteAccess` is (ownership can only be known after the row is fetched; no
existing middleware touches Prisma), and every one of the ten frozen decisions against real code
evidence rather than re-litigating them. Implementation: `TaskPriority`/`TaskStatus`/
`TaskNotificationType` enums, `Task`/`TaskNotification` models and the three new `User` reverse
relations in `backend/prisma/schema.prisma`, migration `20260710150000_tasks` (generated via a clean
file-to-file `prisma migrate diff`, old schema vs. new, avoiding the spurious `DROP TABLE "session"`
a live-database diff would have produced against the runtime-only `connect-pg-simple` session table),
`shared/src/schemas/task.ts`, and `PERMISSIONS.TASKS_MANAGE` (Master-User-only via the existing
`Object.values(PERMISSIONS)` wildcard grant — `PAYROLL_STAFF`'s array untouched). Verified: `prisma
validate`/`migrate deploy`/`generate` clean, zero drift against the live database, `typecheck` clean
across all three workspaces. No routes/services/frontend/tests — schema and shared contracts only, by
design.

**Checkpoint 2 — Backend Services, Routes & Notifications.** The full `backend/src/modules/tasks/`
layer: `tasks.service.ts` (CRUD, `requireTaskAccess` as a service-layer assertion — not middleware,
per Checkpoint 1's own finding — reassignment detected implicitly within the ordinary `PATCH` by
diffing the full field set and `omitKeys`-ing `assignedToUserId` out of the generic changes, exactly
mirroring `updateEmployee`'s own site/unit transfer-detection shape; a deliberate no-op guard that
skips `.update()` entirely — not just skips the audit entry — when a PATCH's fields all already match
current values, so `updatedAt` is never bumped for a request that changed nothing; dedicated
`completeTask`/`cancelTask`/`reopenTask`/`deleteTask` actions mirroring `POST /employees/:id/leave`'s
own dedicated-lifecycle-endpoint shape), `task-notifications.service.ts` (creation inside the same
transaction as its triggering mutation, unread count, mark-one-task-read as a `GET /tasks/:id` side
effect, mark-all-read), and `tasks.routes.ts` (12 endpoints, every handler thin — parse, delegate,
respond, zero direct Prisma calls). Every `assignedTo`/`assignedBy` relation is returned via an
explicit `select: { id, name, email }`, never `include: true` on `User` — a deliberate choice after
noticing (not fixing, out of scope) that `users.service.ts`'s own existing `listUsers()`/`getUser()`
return the full row, `passwordHash` included. Mounted in `backend/src/app.ts` at `/api/v1/tasks` and
`/api/v1/task-notifications`. Verified: `typecheck`/`lint`/`build` clean; a boot-sanity check (dev
server reload + unauthenticated requests correctly 401ing) since no tests were in this checkpoint's own
scope by design.

**Checkpoint 3 — Frontend, HTML Prototype & Testing.** `frontend/src/hooks/use-tasks.ts` and
`frontend/src/components/tasks/{tasks-workspace,tasks-panel,task-list-item,task-form-dialog}.tsx` —
the repurposed right-side slide-out panel (built on the same Radix Dialog primitive `Modal` already
uses, styled as a right-edge sheet), a polling notification badge (30s, no WebSockets/SSE),
filters/sorting/"Load more" pagination, and one shared create/edit dialog. **One architectural bug
caught and corrected before it ever ran**: an initial draft nested the create/edit dialog's own Radix
`Dialog.Root` inside the panel's — the exact shape of a bug already confirmed once in this codebase
(Phase 2.5 Checkpoint 1's Manage Units panel: a nested `Dialog.Root` leaves the outer one permanently
`aria-hidden`/click-intercepting once the inner one closes) — restructured so `TasksPanel` and
`TaskFormDialog` render as siblings sharing state through a new `TasksWorkspace` container instead.
Backend: 24 new tests in `tasks.test.ts` (CRUD, the C11-pattern ownership boundary via a manipulated
`assignedToUserId` query param, permission boundaries, notification creation/unread-count/mark-read,
the no-op guard proven via an unchanged `updatedAt` timestamp, reassignment producing `task.reassigned`
not `task.edited` — and both together when a request changes both — complete/cancel/reopen/delete
lifecycle and status guards, filtering, all three sort dimensions, pagination); `cleanTestData()`
extended for `Task`'s `RESTRICT` FKs, ordered before `user.deleteMany`. **Full backend suite: 208/208**
(184 prior + 24 new). A new `docs/prototypes/phase3.5-tasks-workspace-preview.html` (literal phase
number in the filename, per the frozen naming decision), reviewed against the shipped implementation
before being written.
**Two real defects found and fixed via the real-stack Playwright pass, not shipped**: (1) editing a
task with an untouched due date silently 400'd, because the API returns `dueDate` as a full ISO
datetime (how a Prisma `@db.Date` column serializes to JSON) and the edit form resubmitted it
verbatim against a `z.string().date()` schema — fixed by running it through the shared
`toIsoDateOnly()` utility when seeding the form, the read-side counterpart to the existing
`isoDateToUtcDate()` write-side lesson. (2) `TasksPanel` and `TaskFormDialog` both called `useUsers()`
unconditionally, firing a needless `GET /api/v1/users` (403, `users:manage`-gated) for every
non-Master-User session — fixed by adding a backward-compatible `enabled` option to `useUsers()` and
gating both call sites. **Final Playwright pass: 18/18 checks, real-stack (live Postgres, live
backend, live frontend, two real browser contexts — Master User and assignee), zero console errors in
either session.**
**Verification**: `typecheck`/`lint`/`build` clean across all three workspaces (0 errors, same 4
pre-existing frontend warnings, none new); **208/208 backend tests**; `prisma validate`: valid;
`prisma migrate status`: up to date; live-database drift check: zero (only the expected, Prisma-
unmanaged `session` table); **18/18 real-stack Playwright checks**, zero console errors.
**Committed as `1220dce`** — "feat(tasks): complete Phase 3.5 Tasks Workspace", after review and
explicit approval. **Phase 3.5 (Checkpoints 0–3) is now fully complete and closed. Its own 🛑 review
checkpoint has passed. Phase 4 (Release, Payment Artifacts, and Advances) may now begin, pending its
own separate, explicit authorization — its architecture is unchanged from the 2026-07-05 Phase 3
Architecture Review.**

### Phase 4, Checkpoint 1 — Bank Registry (2026-07-11, COMMITTED as `7c2cdb5`)

**Documentation note (added retroactively, 2026-07-11, the following session):** this checkpoint's
own commit did not update `PROJECT_PROGRESS.md`, `SESSION_HANDOFF.md`, or `IMPLEMENTATION_PLAN.md` —
a real gap in the project's documentation-before-done convention, discovered and reconciled during
Phase 4 Checkpoint 2's own review, rather than left silent. The entry below is reconstructed from
`7c2cdb5`'s commit message and full diff (the authoritative record of what actually shipped), not
from memory of the original session.

Master User management of the Bank Registry — the first Phase 4 checkpoint, explicitly scoped to
exclude Finance Role, Salary Release, Bank Sheets, Statements, and Reports (all later Phase 4 work).

- **Schema**: no migration — `Bank`/`Bank.isActive` already existed since Phase 2; this checkpoint
  is application code only.
- **Reserved `CASH_BANK_CODE`** (`shared/src/constants/bank.ts`, new) — a permanent, protected
  `Bank` row (`code = "CASH"`) seeded once by `backend/prisma/seed.ts` and exempt from every
  ordinary Bank Registry edit/deactivate/delete rule, enforced in `banks.service.ts` regardless of
  reference state. Not a separate model — Cash is a `Bank` row like any other, just a protected
  one. Deliberately excluded from the plain `GET /banks` list Employee Registry and Payroll Entry
  already consumed before this checkpoint (so it never appears twice alongside their own existing
  "Cash"/"None (cash payment)" option) and surfaced only via the admin listing's
  `?includeInactive=true` query.
- **`BANKS_MANAGE` permission** (`banks:manage`, `shared/src/constants/permissions.ts`) —
  Master-User-only, gating create/edit/activate/deactivate/delete. `GET /banks`'s default
  (active-only) results need no permission, unchanged from before this checkpoint.
- **Backend** (`backend/src/modules/banks/{banks.service,banks.routes}.ts`, extended): full
  CRUD, delete blocked while any `Employee`/`PayrollEntry` still references the bank, an
  `isReferenced` flag surfaced per bank so the Edit dialog can lock the Code field proactively
  rather than only reject on submit, and the reserved Cash record's protection enforced
  independent of reference state. `shared/src/schemas/bank.ts` (new) — `createBankSchema`/
  `updateBankSchema`, field lengths mirroring `Bank.code`/`Bank.name`'s existing column limits.
- **Frontend** (`frontend/src/hooks/use-banks.ts` extended, `frontend/src/routes/settings-page.tsx`
  extended with a new Banks tab): list/search, create/edit/activate-deactivate/delete flows, the
  Code field's proactive lock once referenced, and the Cash row's protected-record row-menu
  treatment — visible only to a Master User session (`banks:manage`), omitted entirely (not merely
  disabled) for everyone else.
- **Tests**: `backend/tests/banks.test.ts`, 18 new cases (permission boundaries, CRUD, the
  referenced-code lock, delete-blocked-while-referenced, and the reserved Cash record's protection
  against every mutation regardless of reference state). **Full backend suite at the time: 226/226**
  (208 prior, Phase 3.5's close, + 18 new).
- **Verification** (per the commit's own diff — `typecheck`/`lint`/`build` are inferred standard
  practice for this project, not independently re-confirmed by this retroactive note):
  `docs/prototypes/phase4-bank-registry-preview.html` (5 screens: Banks list, New Bank modal, Edit
  Bank modal with the code field locked, Delete Bank modal, and the Cash row's protected-record
  menu).

### Phase 4, Checkpoint 2 — Finance Role and Salary Release foundation (2026-07-11)

Scope explicitly narrowed by the user ahead of implementation to exactly: the Finance role, the
`PayrollUnitRelease` data model, the per-Unit release workflow and its permissions, audit logging,
and the required frontend UI — **not** Bank Sheets, Statements, Reports, or any other later Phase 4
work. Two further scope questions were asked and answered before writing any schema: both
`PayrollUnitReadiness` ("Ready for Release," Payroll Staff's own non-gating signal to Finance) and
the Late Entry one-off release path are **deliberately deferred to a later checkpoint** — neither is
named in the approved scope list, and the required frontend UI list ("Finance-only controls, Release
confirmation dialog, Released status indicators") names nothing that needs either.

**Finance role** (`docs/architecture/authentication.md`, `database/access-control.md §2`): a third
seeded `Role` (`ROLE_CODES.FINANCE`, `shared/src/constants/permissions.ts`), site-scoped via the
existing `UserSiteAssignment` table — no new scoping mechanism needed, identical in shape to Payroll
Staff's. Two new permissions: `PAYROLL_VIEW` (`payroll:view`, read-only — the only way a role that
never holds the Payroll Staff/Master User edit permission `payroll:entry` can still see Payroll
Cycles/Entries and release status) and `PAYROLL_RELEASE` (`payroll:release`, already reserved as a
permission key since Phase 3 Checkpoint 0 but never granted to any role until now). Finance's grant
is exactly `[PAYROLL_VIEW, PAYROLL_RELEASE]` — no payroll-edit permission, no `payroll:mark-ready`
(doesn't exist yet), no corrections-approval permission, matching
`docs/architecture/authentication.md`'s explicit "Finance's permission set" withholding list.
`backend/prisma/seed.ts`'s role-name mapping (previously a two-way `MASTER_ADMIN`/else ternary) was
generalized to a lookup table so a third role gets its correct display name rather than silently
inheriting "Payroll Staff." `shared/src/schemas/user.ts`'s `createUserSchema.roleCode` enum extended
to accept `FINANCE`, so User Management's already-role-agnostic `createUser`/`updateUser` (which
resolve the `Role` row and site-assignment handling generically from `input.roleCode`, unchanged
since Phase 2) supports creating/editing Finance accounts with no other backend change.

**`PayrollUnitRelease`** (`database/release.md §12b`): new model exactly as frozen — `id`, `cycleId`
(→ `PayrollCycle`, RESTRICT), `unitId` (→ `ProjectUnit`, RESTRICT), `releasedAt`, `releasedById` (→
`User`, RESTRICT), unique on `(cycleId, unitId)`, immutable/append-only, no un-release action.
Migration `20260711140000_payroll_unit_release`, generated via `prisma migrate diff` against a real,
live-in-session database (the same embedded-Postgres-in-scratchpad instance from a prior session,
still running and reachable — re-verified rather than re-provisioned) and applied via `prisma migrate
deploy`; the diff tool's spurious `DROP TABLE "session"` (that table is `connect-pg-simple`-owned,
never part of this Prisma schema, `database/access-control.md §20`) was removed by hand before the
migration file was written, matching the standing rule that no migration in this project ever touches
it. `PayrollEntry.released`/`.releasedAt`/`.releasedBy`/`.lateReason` already existed since Phase 3
Checkpoint 0 and needed no schema change — only application code that actually writes to them for the
first time.

**Release workflow** (`backend/src/modules/payroll-release/`): `releaseProjectUnit()` inserts the
`PayrollUnitRelease` row and, in the same transaction, sweeps every non-held `PayrollEntry` at that
Unit's own Site whose work lines touch it — an entry flips to `released = true` only once *every*
distinct Unit its work lines touch has its own release row, preserving one entry/one net salary/one
downstream document even for a multi-unit split employee (Principle 1, 6; verified directly by a
dedicated test releasing a two-Unit split entry's Units one at a time). Scoped to one Site rather than
the whole cycle for both correctness (a `PayrollEntryWorkLine` can never reference a Unit outside its
parent entry's own Site, Principle 7) and scale (bounded by that Site's headcount, not the whole
company, Principle 10). `getUnitReleaseStatus()` — the read side driving the Release UI's unit list
and confirmation dialog — reports, per Unit: released state, `releasedAt`/`releasedBy`, how many
entries touch it (`entryCount`), and how many would flip to released *right now* if it released
(`willReleaseCount`, `0` once already released), computed fresh on every read, never stored
(Principle 5). No new mechanism was needed to keep a released entry's snapshot correct after a later
`Employee` change (bank, account, designation, transfer): every field release freezes was already
copied onto `PayrollEntry` at entry-creation/edit time and already never cascades from `Employee`
(Phase 3 Checkpoint 0/2.5 design) — release only ever flips the `released`/`releasedAt`/`releasedBy`
flags, so the "regenerates identical downstream outputs even after later Employee changes" requirement
was already true before this checkpoint; verified directly rather than assumed (a dedicated test
changes an employee's bank/account/designation after release and confirms the released
`PayrollEntry` row is untouched).

**Permissions**: `requirePermission` (`backend/src/common/middleware/require-permission.ts`) now
accepts either a single permission or a list, checked as **any-of** — its first use is letting
`GET /payroll-cycles`, `GET /payroll-cycles/:cycleId/entries`, and `GET /payroll-entries/:id` accept
either `payroll:entry` (Payroll Staff's existing edit permission, which has always implied view) or
`payroll:view` (Finance's own, narrower, read-only grant), without duplicating any route. The release
action itself (`POST /payroll-cycles/:cycleId/units/:unitId/release`) is gated by `payroll:release`
alone — Payroll Staff never holds it, matching "Finance authorizes payment, Payroll Staff prepares
payroll" exactly. Site-scoping reuses the existing generic `assertSiteAccess()`
(`employees.service.ts`) against the target Unit's own Site — the same C11-pattern boundary this
project already applies everywhere else, including a manipulated-`unitId`-outside-assignment direct
API call test.

**Audit logging**: reuses the existing `recordAuditLog()` insert-only service exclusively — no second
audit mechanism. One `payroll_unit.released` entry per release event, plus one `payroll_entry.released`
entry per entry the sweep actually finalizes (release.md §12b's explicit requirement), all inside the
same transaction as the data change (Principle 3).

**Frontend**: `frontend/src/hooks/use-payroll-release.ts` and
`frontend/src/routes/salary-release-page.tsx` — a new "Salary Release" page (nav item gated on
`payroll:view`, so Payroll Staff never sees it in the sidebar) showing a Site-scoped table of Units
with a status badge (Released/Pending), employee count, released-by/at, and a Release action visible
only when the caller holds `payroll:release` and the cycle is still Draft. Clicking Release opens a
confirmation dialog (the required "Release confirmation dialog") showing exactly how many employees
are at that Unit, how many will release now, and how many remain pending due to another still-open
Unit — sourced from the same `getUnitReleaseStatus()` read the list itself uses, no extra round trip.
`frontend/src/routes/users-page.tsx` updated for the third role: a Finance option in the role select,
the "assigned sites" section generalized from `roleCode === PAYROLL_STAFF` to `roleCode !==
MASTER_ADMIN` (Finance is site-scoped exactly like Payroll Staff), and the page subtitle updated.

**A real, environment-level bug found and fixed via this checkpoint's own Playwright pass, not
shipped**: the frontend dev server (already running from a background `run`-skill agent invocation
in this same checkout) had pre-bundled `@payroll/shared` into its Vite `optimizeDeps` cache *before*
this session's `ROLE_CODES.FINANCE` addition landed — the Users page's role `<select>` silently had no
Finance option, `selectOption('#user-role', 'FINANCE')` timed out with "did not find some options."
This is the exact, previously-documented "Vite dev cache staleness" class of issue (Phase 2.5
Checkpoint 4's session, `.vite`/dep-cache going stale after a `@payroll/shared` change) — fixed by
killing that one dev-server process, clearing `frontend/node_modules/.vite`, and restarting; verified
the freshly re-bundled `@payroll_shared.js` dep chunk now contains `FINANCE` before re-running the
Playwright pass.

**Tests**: `backend/tests/payroll-release.test.ts`, 15 cases — permission tests (Payroll Staff
rejected, Finance and Master User allowed to release; both Finance's `payroll:view` and Payroll
Staff's `payroll:entry` allowed to view, a permission-less user rejected); site-scoping boundary tests
(a manipulated `unitId`/`siteId` outside a Finance user's assignment, the C11 pattern); the release
workflow (single-unit release sets `released`/`releasedAt`/`releasedBy` and writes both audit
entries; a multi-unit split entry stays unreleased until every touched Unit has released, then
releases on the last one; a held entry never releases even after its Unit does; releasing a
non-Draft cycle's Unit is rejected); snapshot integrity (a released entry rejects an ordinary edit;
a released entry's frozen fields are provably unchanged after the employee's bank/account/designation
change later); and the release-status summary's `entryCount`/`willReleaseCount` arithmetic before and
after a partial release. **Double-release rejection verified explicitly (added during this
checkpoint's pre-commit review), as two separate cases**: (1) a sequential second release attempt
against an already-released Unit gets `releaseProjectUnit()`'s own pre-check — a clean, typed 409
`CONFLICT` (`common/http-error.ts`'s `conflict()`) with the exact business-error message, asserted
against the response body's `error.code`/`error.message`, not just its status code — and a direct
`PayrollUnitRelease` row-count check confirms no second row was ever inserted; (2) two concurrent
release requests racing the same pre-check-then-insert window resolve to exactly one `201` and one
clean `409` (the loser via the global error handler's existing P2002 → 409 `DUPLICATE` translation,
`common/middleware/error-handler.ts`, since the DB's own `(cycleId, unitId)` unique constraint is the
correctness backstop for a genuine race) — never a raw 500, never a silent duplicate; a row-count
check confirms exactly one `PayrollUnitRelease` row exists afterward either way. Together these
confirm the business rule holds on both the ordinary path (the service-level guard) and the race path
(the DB constraint, translated to the same standard error shape) — neither path can silently succeed
or crash uncleanly. `backend/tests/helpers.ts`'s `cleanTestData()` extended for `PayrollUnitRelease`'s
two `RESTRICT` FKs, ordered before the `PayrollCycle`/`User` deletes it depends on. **Full backend
suite: 241/241** (226 prior + 15 new).

**Verification**: `typecheck`/`lint`/`build` clean across all three workspaces (0 errors, same 4
pre-existing frontend `react-refresh` warnings, none new); **241/241 backend tests** against a live
PostgreSQL instance (re-verified three times across this checkpoint — once mid-implementation, once
after the E2E Playwright pass mutated the same database, and once more in a dedicated pre-commit pass
after strengthening the double-release test); `prisma validate`: valid; `prisma generate`: clean;
`prisma migrate status`: up to date, zero drift. **Real-stack
Playwright pass** (live browser → Vite dev server → Express → PostgreSQL, no mocks): Master User
creates a Project Site/Unit/Employee/Draft cycle and a Finance user (site-assigned, "Finance" role
badge rendered correctly in User Management); the Finance user logs in, sees "Salary Release" but not
"Payroll Entry" in the sidebar, opens the confirmation dialog, releases the Unit, and the row
immediately shows "Released" with the correct timestamp/name and the Release button gone; zero
`console.error`/`pageerror` events across every screen visited (the app's own documented, expected
401 on the pre-login `GET /api/v1/auth/me` session probe is the only network-level "Failed to load
resource" entry observed, matching `use-session.ts`'s own doc comment that this is a normal, handled
outcome, not an error state). E2E fixtures were cleaned from the dev database afterward (same
convention as the 2026-07-04 database-verification session), audit rows left in place by design.
`docs/prototypes/phase4-salary-release-preview.html` created (four screens: Finance's unit list,
the release confirmation dialog, the after-release state showing a still-pending split-entry Unit,
and Payroll Staff's read-only omission of the page entirely) and reviewed directly against the
implemented UI's own screenshots before being finalized. `docs/prototypes/phase1-preview.html`,
`phase2-employee-registry-preview.html`, and `phase3-payroll-entry-preview.html` were left exactly as
they already stood in the working tree at the start of this session (pre-existing, unrelated
in-progress edits from before this checkpoint began) — not reviewed or touched here, since none of
them depict Release/Finance screens this checkpoint would factually contradict.

**Reviewed, approved, and COMMITTED as `cedf386`** ("feat(payroll): implement Phase 4 Checkpoint 2
salary release foundation") per explicit instruction — exactly one commit, Checkpoint 2 files only
(the two pre-existing, unrelated, already-modified prototype files noted above were deliberately
left out of this commit). Hash recorded here in the following session's own Checkpoint 3 entry,
below, per this project's established doc-only-commit-hash convention.

### Phase 4, Checkpoint 3 — Bank Sheets (2026-07-11)

Preceded by a read-only architecture review (no files touched) re-confirming the plan against the
codebase as it stood after Checkpoints 1–2: `docs/architecture/database/relationships.md`'s "Bank
Sheets... have no tables of their own — they are query modules" (Principle 1); `Amount =
PayrollEntry.netSalary ± settling BalanceAdjustments` with `BalanceAdjustment` not yet built (Phase
6), so `Amount = netSalary` exactly, the same documented gap Checkpoint 2 already left for the
release sweep; the release boundary staying Project Unit exactly as Checkpoint 2 built it, queried
via `PayrollEntry.released` (never `PayrollCycle.status`, since a Unit's Bank Sheet must be
generatable while the cycle is still Draft overall — `docs/IMPLEMENTATION_PLAN.md` Phase 4: "generated
per Unit-release event, not only per whole-Cycle release"); and the exact reserved permission name
(`bank-sheets:view`) `docs/architecture/authentication.md` had already named for this checkpoint since
the Phase 3 architecture review, deliberately left ungranted until now.

**Scope decision, explicit and user-directed, not a silent reinterpretation:** rather than the frozen
architecture's separate, future "Cash Receiving" module, this checkpoint implements one unified Bank
Sheet feature whose bank filter accepts either a real, active `Bank` or a `cash` sentinel (employees
with no bank account on file) — matching this checkpoint's own scope text ("filtering by every active
supported Bank and Cash... this is generation filtering, not release filtering"). A dedicated Cash
Receiving module remains future work.

**Backend** (`backend/src/modules/bank-sheets/{bank-sheets.service,bank-sheets.routes}.ts`, new):
`getBankSheet()` — the single query every other function in this module builds on — filters
`PayrollEntry` by `released = true, hold = false` (never Draft), a resolved bank/cash filter, and an
optional site filter (`assertSiteAccess`-checked per site, the same C11-pattern shape as every other
module's export). One row per employee, matching `PayrollEntry`'s own `(cycleId, employeeId)`
uniqueness. Every displayed value — bank, branch code, account number, account title, designation,
net salary — is read exclusively from `PayrollEntry`'s own frozen columns (copied at entry-creation/
edit time, immutable once released since Phase 3), never from `Employee`'s live record; Employee
name/CNIC are the one exception, read live, matching every existing export in this codebase since
`PayrollEntry` never copied those fields either. `exportBankSheetToCsv`/`exportBankSheetToXlsx`
reuse this exact query — no second implementation of "which rows belong on this sheet" — and reuse
this project's existing `ExcelJS`/`csv-stringify` export convention (`payroll-entry-import-export.
service.ts`'s precedent), no new export framework. New shared `sumMoney()`
(`shared/src/lib/calc-net.ts`, exported from `@payroll/shared`) sums monetary decimal strings via
`decimal.js`, matching `calcNet`'s own Principle-5 rounding-policy requirement rather than a native
floating-point `Array.reduce`. New `PERMISSIONS.BANK_SHEETS_VIEW` (`bank-sheets:view`) — granted to
Finance (alongside `payroll:view`/`payroll:release`) and Master User (wildcard); Payroll Staff holds
neither this nor any payroll-view permission, so it is excluded automatically, without a separate
denial rule. Two new routes nested under a cycle, mounted ahead of `payrollCyclesRouter`'s own `/:id`
route (same reasoning as `:cycleId/entries` and `:cycleId/units` before it): `GET .../bank-sheet` (the
on-screen view) and `GET .../bank-sheet/export` (download, writing its own summary
`bank_sheet.export` `AuditLog` entry, mirroring Payroll Entry export's `payroll_entry.export`
precedent — one entry per operation, not one per row).

**A real, pre-existing Employee Registry bug found and fixed via this checkpoint's own mandatory
Playwright pass, not shipped:** `employees-page.tsx`'s `EmployeeFormModal`, in its "New Employee"
role, stays mounted between opens (controlled only via its `open` prop, unlike its "Edit" sibling
instance, which is conditionally mounted and so remounts fresh each time) — its `useState` form
initializer therefore only ever ran once, at first mount, not on every reopen. Creating Employee A
with a bank selected, closing the modal, then clicking "New Employee" again for Employee B silently
carried over every one of Employee A's field values (bank, account number, designation, gross pay,
etc.) into Employee B's form unless each field was manually cleared by hand — confirmed directly via
the database, not just the UI, once this checkpoint's own two-employees-with-different-banks
Playwright scenario surfaced it. Fixed with a `buildEmployeeForm()` helper (the one place a fresh vs.
edit-prefilled form shape is built, now shared by the initial `useState` and a new reset effect) and
a `useEffect` that reinitializes `form` whenever `open` becomes `true`. A genuine payroll data-entry
correctness bug, not a Bank Sheet feature change — fixed here rather than left for a future session,
per this project's own established precedent (Phase 3 Checkpoint 6, Phase 3.5 Checkpoint 3) of fixing
real defects the mandatory Playwright pass exists to catch, even when outside the checkpoint's named
feature.

**A second real bug, found and fixed the same pass:** the Bank Sheet totals row was originally styled
`position: sticky; bottom: 0`, intending to stay pinned to the bottom of the table while scrolling —
but the table's only scroll container (`overflow-x-auto`, for wide account-number columns) scrolls
horizontally only, so the sticky row had no bounded vertical scrolling ancestor to attach to and
instead detached from the table entirely, floating at the whole page's own viewport edge. Fixed to a
plain, non-sticky `<tfoot>` (still always reachable at the bottom of the table, satisfying "totals
must always remain visible" without the broken mechanism) — `frontend/src/routes/bank-sheet-page.tsx`
and `docs/prototypes/phase4-bank-sheets-preview.html` both updated to match.

**Frontend**: `frontend/src/hooks/use-bank-sheet.ts` and
`frontend/src/routes/bank-sheet-page.tsx` — a new "Bank Sheet" page (nav item gated on
`bank-sheets:view`, so Payroll Staff never sees it), with a cycle selector (every cycle, not only the
current Draft one — required by "historical exports must always reproduce identical data," since
Finance must be able to regenerate a past cycle's sheet), a Bank-or-Cash filter, the existing
`MultiSelectFilter` reused for the site filter, and Export CSV/Export Excel actions
(`downloadBankSheetExport`, mirroring `downloadPayrollEntryExport` exactly). Layout Integrity:
the table renders in its own `overflow-x-auto` container with `whitespace-nowrap` on every cell (no
column ever truncates an account number or a long employee name), `min-w-[1180px]` so columns are
never compressed to fit a narrow viewport, and `tabular-nums` on every numeric column per
`docs/design-system.md` §4's numeric-alignment rule.

**Tests**: `backend/tests/bank-sheets.test.ts`, 12 cases — permission tests (Payroll Staff rejected
from both view and export; Finance and Master User allowed; a user holding `payroll:view`/
`payroll:entry` but not `bank-sheets:view` rejected); a site-scoping boundary test (manipulated
`siteIds` outside a Finance user's assignment, the C11 pattern); released-only enforcement (a Draft,
unreleased entry never appears; a held entry excluded even after its Unit releases; a released entry
appears once its Unit has released); filtering behaviour (a specific Bank shows only its own
employees; Cash shows only no-bank employees; an inactive Bank filter 400s; a nonexistent Bank 404s);
a `sumMoney`-based totals test (two employees, decimal-precise sum, not floating-point); the
historical snapshot integrity test (changing an employee's bank, account number, and designation
after release leaves a previously generated Bank Sheet, filtered by the *original* bank, completely
unchanged — and the employee's *new* bank shows zero rows for that cycle, proving the release was
never retroactively reassigned); and export correctness (CSV/XLSX row counts, headers, a totals row,
and the summary audit entry). **Full backend suite: 253/253** (241 prior + 12 new).

**Verification**: `prisma validate`/`prisma generate` clean; `typecheck`/`lint`/`build` clean across
all three workspaces (0 errors, same 4 pre-existing frontend `react-refresh` warnings, none new);
**253/253 backend tests** against live PostgreSQL. **Real-stack Playwright pass** (live browser → Vite
dev server → Express → PostgreSQL, no mocks): Master User creates a Bank (Settings → Banks), a
Project Site/Unit, one employee paid via that Bank and one paid Cash, releases the Unit, and creates a
Finance user and a Payroll Staff user; the Finance user's Bank Sheet page correctly isolates each
employee under its own Bank/Cash filter with the full, untruncated account number visible, exports a
CSV successfully: a direct database read after the Master User then edited the banked employee's
designation confirmed the Bank Sheet, re-filtered by the *original* bank, still showed "Verifier," not
the new "Changed After Release" value; Payroll Staff has no "Bank Sheet" sidebar item and a direct API
call to the Bank Sheet route with a Payroll Staff session returns 403. Zero `console.error`/
`pageerror` events across every screen visited (the same expected pre-login session-probe 401 as
every prior Playwright pass in this project, not a defect). `docs/prototypes/phase4-bank-sheets-
preview.html` created (four screens: a real-Bank filter, the Cash filter, the empty state, and Payroll
Staff's sidebar omission) and reviewed directly against the implemented UI's own screenshots,
including updating its totals-row CSS to match the sticky-row fix above, before being finalized.

**Reviewed and approved, committed as a single commit** (`feat(bank-sheets): implement Phase 4
Checkpoint 3 Bank Sheets`) per explicit instruction — exactly one commit, Checkpoint 3 files only
(the two pre-existing, unrelated, already-modified prototype files noted above were deliberately
left out of this commit, same as Checkpoint 2's). This entry, written and committed in that same
commit, cannot self-reference its own not-yet-created hash; the next session's first action should
record it here as a doc-only commit, matching this project's own established convention. **Do not
begin Checkpoint 4 until the next explicit review and authorization.**

### Phase 4 — Employee Statements Architecture Review and Scope Decision (2026-07-11, architecture-only, no code)

A dedicated, read-only architecture review (no application code, no schema, no migrations, no
prototypes) evaluated Employee Statements as candidate next Phase 4 work, immediately following
Checkpoint 3's close. **Finding:** a complete Statement of Account, per `reference/PROJECT_SPEC.md`
§12 and `docs/architecture/overview.md`'s own Statements row, must show salary earned, EOBI,
advances, fines, **and any corrections** with a running balance — which requires reading
`Correction`, `BalanceAdjustment`, `CorrectionPayment`, and `Advance`. None of these tables exist in
`backend/prisma/schema.prisma` yet: Corrections/Balance Adjustments are Phase 6 (not started), and
Advances is Phase 4's own not-yet-built sub-scope (Bank Registry/Salary Release/Bank Sheets —
Checkpoints 1–3 — never included it). Building Statements now, against `PayrollEntry` alone, would
therefore produce a structurally incomplete ledger, missing three of the five line items the
original spec requires — a real financial-correctness risk in a project whose central premise
(Principles 1, 3, 4, 9) is a trustworthy, non-drifting record.

**Decision (approved):**
- **Bank Registry remains Phase 4 Checkpoint 1** (`7c2cdb5`), **Salary Release foundation remains
  Phase 4 Checkpoint 2** (`cedf386`), **Bank Sheets remain Phase 4 Checkpoint 3** — all three
  unchanged, already committed, not reopened by this review.
- **Employee Statements will not be implemented during Phase 4.** It is deferred to the later
  financial-ledger phase — **Phase 7**, exactly as `docs/IMPLEMENTATION_PLAN.md` already specified
  before this review (`### Phase 7 — Statements, Reports, Dashboard`, "**Depends on:** Phase 6")
  — this review **confirms** the existing frozen plan rather than changing it. No prior document
  ever placed Employee Statements in Phase 4; this entry exists to record that the question was
  explicitly raised, reviewed against the actual repository state, and settled, rather than left
  ambiguous the next time a session picks up "what's next after Checkpoint 3."
- **Reports (also Phase 7) should eventually reuse Statements' ledger-computation/aggregation code
  rather than duplicating it** — both modules read the same underlying `PayrollEntry` (and, once it
  exists, `Correction`/`BalanceAdjustment`/`Advance`) data and perform overlapping per-employee/
  per-cycle aggregation. This is a new, explicit architectural note (not previously written down
  anywhere) — recorded here, and in `docs/architecture/overview.md`'s Major Modules table, so Phase 7
  implementation doesn't independently reinvent the same aggregation twice.
- **No redesign of any other Phase 4/5/6/7 checkpoint.** This review did not reopen the per-Unit
  release model, Bank Sheets' scope, or the Phase 6 Corrections/Balance Adjustments design — all
  remain exactly as previously frozen.

**Files reviewed for every reference to Employee Statements**: `docs/IMPLEMENTATION_PLAN.md`,
`docs/PROJECT_PROGRESS.md` (this file), `docs/SESSION_HANDOFF.md`, `docs/architecture/overview.md`,
`docs/architecture/database/relationships.md`, `docs/architecture/database/schema-invariants.md`,
`docs/architecture/database/advances.md`, `docs/architecture/database/balance-adjustments.md`,
`docs/architecture/workflows/corrections-and-balance-adjustments.md`,
`docs/architecture/workflows/payroll-lifecycle.md`, `docs/design-system.md`,
`docs/PROJECT_PRINCIPLES.md`, `docs/architecture/folder-structure.md`,
`docs/prototypes/phase4-bank-sheets-preview.html`. Every schema/workflow-detail file's mentions of
"Statements" already correctly describe it as a future, read-only, no-own-table consumer of
Corrections/Balance Adjustments data with no phase-timing claim of its own — none needed a change.
`docs/PROJECT_PRINCIPLES.md` and `docs/design-system.md` state the general "Statements are a derived,
read-only view" principle and its UI/ledger-table convention respectively, both true regardless of
which phase builds it — reviewed, no change needed. `reference/PROJECT_SPEC.md` and
`reference/payroll_prototype.html` were read for context only, per the standing "frozen, never
edited" rule — not modified. **Files actually changed by this decision**:
`docs/IMPLEMENTATION_PLAN.md` (Phase 4 and Phase 7 section notes), `docs/PROJECT_PROGRESS.md` (this
entry, plus the top-of-file summary and the §2/§5 status tables/next-steps below),
`docs/SESSION_HANDOFF.md` (§1 current-status bullet), and `docs/architecture/overview.md` (a Reports/
Statements reuse note in the Major Modules table). No application code, schema, migration, or HTML
prototype was touched.

### Phase 4, Checkpoint 4 — Cash Receiving Sheets (2026-07-11, COMMITTED as `477fbb1`)

Preceded by a dedicated, read-only architecture review (no files touched) that investigated the
actual repository state — not just documentation — before any code was written. Two changes were
made to the review's own recommendations before approval: (1) reuse the existing `bank-sheets:view`
permission rather than introduce a new `cash-receiving:view` key (even though `authentication.md` had
reserved that name since the Phase 3 architecture review); (2) ship the simplified document layout
below rather than the original historical prototype's full attendance/OT/allowance/deduction
breakdown.

**Data source and Cash rule, reused exactly, unchanged:** `PayrollEntry.bankId IS NULL`, `released =
true`, `hold = false` — the identical rule and query shape Bank Sheets already ships and tests, not a
second definition of "Cash." `accountNumber` deliberately plays no role, per the approved decision
never to silently change this already-shipped classification behaviour, despite a known, pre-existing,
unrelated documentation/code gap around it (flagged in the architecture review, not resolved here —
out of this checkpoint's scope).

**A dedicated module** (`backend/src/modules/cash-receiving/`), not a bolt-on filter inside Bank
Sheets — the two documents' column shapes genuinely differ (this one carries no bank/account columns
at all, and a Signature/Remarks pair Bank Sheets doesn't need) even though they share every
calc/scope/export/audit primitive (`computeEntryCalc`, `assertSiteAccess`/`isMasterAdmin`, `sumMoney`,
`ExcelJS`/`csv-stringify`, `recordAuditLog`). New frontend page (`cash-receiving-page.tsx`) and hook
(`use-cash-receiving.ts`), a new nav item, mounted at `/api/v1/payroll-cycles/:cycleId/cash-receiving`
ahead of `payrollCyclesRouter`'s own `/:id` route, same pattern as `bank-sheet` before it.

**No database changes of any kind** — no new table, column, or migration; `prisma migrate deploy`
confirmed "No pending migrations to apply" both before and after implementation.

**Permission: `bank-sheets:view` reused, not a new permission** — approved explicitly, overriding the
architecture review's own recommendation. Finance and Master User see both Bank Sheets and Cash
Receiving Sheets; Payroll Staff sees neither (verified: no sidebar item, 403 on direct API access).

**Document layout, simplified by approved decision, not matching the original historical prototype**:
Serial No., Employee Code, Employee Name, CNIC, Designation, Site, Net Salary, Signature / Thumb
Impression, Remarks — no Working Days/OT Hours/OT Amount/Allowance/Deduction/Project Unit columns.
Document header (Company, Payroll Cycle, Generation Date, Generated By) and footer (Total Employees,
Total Cash Amount), rendered both on-screen and in every CSV/XLSX export, making the sheet suitable to
print and physically sign without a PDF pipeline (Puppeteer/PDF generation still doesn't exist
anywhere in this codebase and was not added). **Export formats: CSV and Excel only**, reusing the
existing `ExcelJS`/`csv-stringify` helpers — no new dependency.

**Audit: export-only**, one `cash_receiving_sheet.export` entry per download (mirroring
`bank_sheet.export` exactly); viewing is not audited, same asymmetry as Bank Sheets.

**Historical snapshot integrity verified two ways**: a dedicated backend test (change an employee's
designation, and separately give a Cash employee a bank account, both after release — the historical
sheet stays byte-for-byte unchanged, and the employee's later bank assignment never retroactively
removes them from an already-released Cash Receiving Sheet) and a live Playwright check confirming the
same read-exclusively-from-`PayrollEntry` behaviour end to end.

**One real inconsistency found and fixed during pre-commit final verification, not shipped**: the
approved column spec names the first column "Serial No.," and the backend's CSV/XLSX export headers
already said exactly that — but the on-screen page and the prototype had both independently used the
shorter "Sr." (carried over by habit from Bank Sheets' own historical-prototype convention). Fixed
both to read "Serial No.," re-verified live via Playwright (column header text asserted directly) —
a label-only fix, no behavior change, so not treated as reopening the implementation.

**Verified**: `prisma validate`/`generate` clean, both before and after final cleanup;
`typecheck`/`lint`/`build` clean across all three workspaces (same 4 pre-existing `react-refresh`
warnings, none from new files); **264/264 backend tests** (253 prior + 11 new,
`backend/tests/cash-receiving.test.ts` — permissions, released-only, held-entry exclusion, site
scoping, Cash-only filtering, totals via `sumMoney`, historical snapshot integrity, export content +
audit entry); a real-stack Playwright pass (Finance access, Payroll Staff denial via both sidebar and
direct API 403, populated state, cash-only filtering live against a mixed bank/cash release, CNIC
rendered untruncated, Signature column measured at 208px against a 160px reserved minimum, CSV/Excel
downloads triggered, empty state, zero uncaught JavaScript errors) — re-run after the "Serial No."
fix and again after final dev-database cleanup, both clean.

**Ad hoc dev-database test records created during verification were identified and removed** before
commit: Playwright-created test sites/units/employees/users (name/email patterns `PW Cash *`) and a
test Draft payroll cycle (year 2901, itself created by this session's own verification, containing
only this session's own 4 test entries) were all deleted; confirmed zero remaining via a direct
database query. The throwaway verification scripts themselves lived only in the session scratchpad,
never the repository.

**Reviewed and approved, committed as `477fbb1`** ("feat(cash-receiving): implement Phase 4
Checkpoint 4 Cash Receiving Sheets") — backend module, tests, router mount, frontend hook/page/route/
navigation, and the prototype only; the three pre-existing, unrelated, already-modified prototype
files (`phase1-preview.html`, `phase2-employee-registry-preview.html`,
`phase3-payroll-entry-preview.html`) were deliberately excluded, same convention as every prior
checkpoint's commit. **Checkpoint 4 is complete and closed.**

### Phase 4, Checkpoint 5 — Advances (2026-07-11, COMMITTED as `75c5e64`)

Preceded by a dedicated, read-only architecture review (no files touched) that verified every
assumption against the actual implementation, not just documentation — confirming `Advance`,
`ScheduledPayrollPeriod`, and `AdvanceScheduleChange` were 100% documentation with zero code, that
the "Outstanding Payroll Obligation" generic provider/hook registry was likewise pure documentation
(`createPayrollCycle`'s bootstrap was a flat function with no plugin mechanism), and that the
new-cycle bootstrap silently reset `advanceDeduction`/`eidAdvanceDeduction` to zero every cycle — not
a bug, but exactly the gap this checkpoint needed to fill. One pre-implementation finding was
surfaced and resolved before any schema was written: the frozen `advances.md` §15 column list has no
field an `INSTALLMENT`-type advance's automatic materialization could read an amount from —
`docs/IMPLEMENTATION_PLAN.md` had already proposed `Advance.scheduledInstallmentAmount` by name as a
"proposed schema addition... not yet implemented," so this was treated as additive, not a genuine
conflict, and included.

**Approved architecture decisions, implemented exactly as frozen:**
- **At most one `ACTIVE` Advance per employee per type** — the assumption
  `database/schema-invariants.md` had explicitly flagged "not yet confirmed — revisit before Phase 4"
  is now confirmed and enforced: a partial unique index (`Advance_employeeId_type_active_key`, raw
  SQL in the migration, matching the Employee CNIC/employeeCode precedent) backstops an
  application-layer pre-check, translated to a clean 409 by the existing global P2002 error handler.
- **No generic Outstanding-Payroll-Obligation provider/hook registry** — `payroll-processing.service.ts`'s
  `createPayrollCycle` calls a new, exported `materializeScheduledAdvanceDeductions()` in
  `advances.service.ts` directly. `ScheduledPayrollPeriod`'s own resolution step (the
  `payrollCycleId` `NULL → NOT NULL` transition) stays exclusively owned by Payroll Processing, per
  its documented ownership boundary — Advances only ever holds a foreign key into it, via a new
  `findOrCreateScheduledPayrollPeriod()` export, never a direct write.
- **Cash Advances, Advance-only Bank Sheets, and Company Bank Account management** — confirmed out of
  scope; not built.
- **Payroll Entry import/export unchanged** — no automatic Advance linking during CSV/Excel import;
  linkage happens only through payroll generation (interactive entry creation and automatic
  materialization), never a bulk-import side effect.
- **No new permission** — `advances:manage` already existed (seeded since Phase 1, reserved ahead of
  time exactly like `bank-sheets:view` was before Checkpoint 3) and was already granted to Payroll
  Staff; reused unchanged. Finance receives none, unchanged.

**A real design gap found and fixed during implementation, before commit, not shipped broken**:
deferring a `FULL_DEDUCTION` advance's just-materialized deduction initially failed, because
materialization immediately (and correctly, in isolation) marks a `FULL_DEDUCTION` advance
`PAID_OFF` — but the entry carrying that deduction hasn't released yet, so nothing about it should be
treated as final. Fixed by having `deferAdvanceSchedule` read the exact amount the specific entry
being deferred deducted (not `advance.currentScheduledPeriodId`/`.status`, which may have already
auto-advanced past it or been cleared), reverse it back onto `outstandingBalance`, and flip `status`
back to `ACTIVE` — correct for both `FULL_DEDUCTION` and `INSTALLMENT` deferrals, caught by the
checkpoint's own test suite before commit.

**Historical integrity verified directly**: a released `PayrollEntry`'s `advanceDeduction`/
`advanceId` freeze permanently via the same `assertEntryEditable()` guard every other field already
obeys (no new enforcement code needed) — proven by a dedicated test (editing an Advance's notes, and
separately attempting to defer, after its entry has released) asserting the released row is
byte-for-byte unchanged.

**Verified**: `prisma validate`/`generate`/`migrate deploy` clean; `typecheck`/`lint`/`build` clean
across all three workspaces (same 4 pre-existing `react-refresh` warnings, none from new files);
**276/276 backend tests** (264 prior + 12 new, `backend/tests/advances.test.ts` — permissions, site
scoping, at-most-one-`ACTIVE`-per-type, `FULL_DEDUCTION`/`INSTALLMENT` automatic materialization
including the no-standing-schedule skip case, deferral happy path and rejections, historical
snapshot, update+audit); a real-stack Playwright pass (Record Advance via the real UI, automatic
materialization confirmed both via the new Payroll Entry balance indicator and a reduced Advances-page
balance, Defer modal auto-resolving the live materialized entry and succeeding, Finance's sidebar
hiding Advances entirely plus a 403 on direct API access, zero real console errors). Ad hoc
dev-database test records created during two rounds of Playwright verification were identified and
removed before commit.

**Reviewed and approved, committed as `75c5e64`** ("feat(advances): implement Phase 4 Checkpoint 5
Advances") — schema/migration, backend module, tests, frontend hook/page/route/navigation plus the
small Payroll Entry balance indicator, and the prototype only; the three pre-existing, unrelated,
already-modified prototype files were deliberately excluded, same convention as every prior
checkpoint's commit. **Checkpoint 5 is complete and closed. Do not begin the next Phase 4 checkpoint
(Payslip generation) without its own explicit authorization.**

---

### Post-Phase-4 refinement — Employee/Payroll Entry/Bank Sheet banking fields (2026-07-11)

**Explicitly not Phase 4 Checkpoint 6, not Payslips, not Company Bank Account** — a refinement of
already-shipped Employee, Payroll Entry, and Bank Sheet functionality only, preceded by a dedicated
read-only architecture review (no files touched) that surfaced one real conflict with frozen
architecture: `reference/PROJECT_SPEC.md`'s frozen "Sample Bank Sheet Format" requires a "Title of
Account" column. Resolved, with explicit sign-off, by keeping that column on the Bank Sheet as a
**derived** value (the entry's own `employee.name`), never a separately stored field — satisfying
both the frozen spec and the new requirement that Account Title is "no longer entered separately."

**Approved decisions, implemented in full:**
- `Employee.accountTitle`/`PayrollEntry.accountTitle` **removed entirely** — a clean, destructive
  migration (`20260711200000_employee_banking_refinement`), not a soft-deprecation, per explicit
  instruction ("this project is still pre-production... do not leave deprecated columns behind").
  This is this project's **second** genuinely destructive migration (`database/schema-invariants.md
  §25`) and, unlike the first (`ProjectSite.branchCode`, never applied to a live database), a
  materially higher-risk one since both columns had been live since Phase 2/Phase 3 Checkpoint 0.
- `Employee.iban`/`PayrollEntry.iban` **added** (varchar(34), nullable, optional even for a bank
  employee) — trimmed and stored uppercase (`shared/src/schemas/common.ts`'s new
  `optionalUppercaseString`, reused by both schemas rather than duplicated).
- **Banking invariant, new:** a bank employee (`bankId` set) must have an Account Number —
  `Employee` create/update/reactivate hard-reject the violation, checked against the *merged*
  post-update state for partial patches (`employees.service.ts`'s `applyBankingInvariant`); a cash
  employee (`bankId` null) always has `accountNumber`/`iban` both null, enforced by normalization
  (never a rejection) everywhere, including `PayrollEntry`'s own independent Draft-editable banking
  fields. `PayrollEntry`'s per-field autosave grid deliberately does **not** hard-reject "bank set,
  Account Number not yet typed" the way `Employee`'s full-form submission does — a user who just
  picked a bank and hasn't typed the account number yet must not have that in-progress edit
  rejected; see `database/payroll-entry.md`'s new banking-rule note for the full reasoning.
- **Bank Sheet**: `accountTitle` is now derived (`entry.employee.name`, read live — the Bank Sheet
  export's already-established exception for Employee Name/CNIC, same as before), never a stored
  `PayrollEntry` column; verified this holds for Cash rows too (Account Title was never tied to
  having a bank account). IBAN added as a new export column (CSV/Excel headers and on-screen table).
  Excel column widths extended to every business-critical identifier (Employee Code, CNIC, Bank,
  Account Number, IBAN), not just Account Number as before.
- **Permanent Layout Integrity Rule, introduced**: Employee Code, CNIC, Bank, Account Number, and
  IBAN must never be squashed, clipped, or ellipsized — widen columns or scroll horizontally,
  never truncate. Bank Sheet already had this pattern (`whitespace-nowrap` + horizontal-scroll
  table); Payroll Entry's grid columns (`columns.ts`) were widened to match (Bank 110→120, Branch
  Code 100→110, Account No. 130→190, new IBAN column at 200).
- **Employee Registry's bulk CSV/Excel template intentionally left untouched** — its exact header
  set is extracted verbatim from `reference/PROJECT_SPEC.md`'s frozen "Official Data Template" and
  never included Account Title in the first place; adding IBAN there would be a separate,
  explicitly-authorized amendment to that frozen template, not assumed as part of this refinement.
  IBAN is settable via the single-employee Create/Edit/Reactivate form only.

**Verification:** `prisma validate`/`generate`/`migrate deploy` clean, zero drift; typecheck/lint/
build clean across shared/backend/frontend; backend tests 285/285 (276 prior + 9 new, covering the
banking invariant on create/update/reactivate, the derived Account Title including for Cash rows,
and `PayrollEntry`'s own snapshot immutability for `iban`); real-stack verification via direct API
calls against the live dev Postgres (no browser-automation tool available this session) — employee
creation/update covering both the rejection and normalization paths, full cycle→release→Bank Sheet
flow confirming the derived title and IBAN snapshot end-to-end, CSV export header/value correctness.
HTML prototypes (`phase2-employee-registry-preview.html`, `phase3-payroll-entry-preview.html`,
`phase4-bank-sheets-preview.html`) updated to match.

**Committed as `3b74c32`** ("feat(banking): remove Account Title, add IBAN, add banking invariants")
— see the two later "Rejected on review" corrections below for what happened to this pass's own
Layout Integrity fix before the whole working tree was finally committed. No conflicts with frozen
architecture remain unresolved; the one identified (Bank Sheet's "Title of Account") was resolved
as described above, with explicit sign-off, before implementation began.

**Rejected on review, 2026-07-12 — the 2026-07-11 column-width increase did not fix the actual
defect.** Root cause, found by tracing the full width path rather than assuming: (1) Payroll
Entry's Bank `<select>` (`payroll-entry-row.tsx`) was rendering only `bank.code` (e.g. "MCB"), a
genuinely separate, short abbreviation field — never the full `bank.name` — so no column width
could ever have fixed it, since the *displayed value itself* was never the long string in the
first place; this was inconsistent with Employee Registry's own already-correct `"{name} ({code})"`
convention. (2) `ReadOnlyCell` (`inline-cells.tsx`) unconditionally applied Tailwind's `truncate`
class, silently ellipsis-clipping Employee Code — exactly the "hidden overflow" the permanent rule
forbids — independent of any column-width number. (3) The 2026-07-11 widths themselves (Bank 120,
Account No. 190, IBAN 200) were also genuinely too tight once measured against a real character-
width budget, not just masked by (1)/(2).

**Fixed**: Bank select now renders `"{bank.name} ({bank.code})"`; `ReadOnlyCell` gained a
`truncate` opt-out, applied to Employee Code; columns widened again from an explicit character-
width budget documented in `columns.ts`'s own comment (Employee Code 140, Bank 280, Branch Code
140, Account No. 260, IBAN 300 — deliberate margin, not a bare fit); Excel export column widths
increased to match (Bank 32, Account Number 30, IBAN 36). `phase3-payroll-entry-preview.html`
gained matching `min-width` CSS and now renders the exact canonical IBAN test value
(`PK36SCBL0000001123456702`) and full bank names in its actual table, not just its footer text; all
three prototypes were corrected the same way.

**Real-stack Playwright verification this time** — a genuine browser was provisioned in-session
(`playwright` + Chromium, installed into the scratchpad; no browser-automation tool was available
via the harness) and driven against the live Vite dev server + backend + Postgres. Live DOM
measurements confirmed `scrollWidth`/`clientWidth` parity (no internal overflow) for the Bank cell/
control, Account Number cell/control, and IBAN cell/control in the Payroll Entry grid, the Employee
Registry Edit modal, and the Bank Sheet table, all showing the complete test values
(`PK36SCBL0000001123456702`, a 20-digit account number, "National Bank of Pakistan (NBP)") with
zero clipping — screenshots captured as corroborating evidence, not just DOM measurements.

**Snapshot-name finding, unresolved, requires your decision, not silently assumed:** Bank Sheet's
Account Title is confirmed to read `entry.employee.name` — a **live** `Employee` relation, not a
frozen `PayrollEntry` snapshot the way `bankId`/`accountNumber`/`iban` are. A dedicated test
(`bank-sheets.test.ts`, "derives Account Title from the employee name, live") proves this
directly: correcting an employee's name *after* release changes a previously-generated Bank
Sheet's Account Title, while its bank/account/IBAN stay frozen. This exact behavior already existed
for the Bank Sheet's "Employee Name" column before this refinement (pre-existing precedent, not
newly introduced), and was already disclosed in the 2026-07-11 entry above — restated here because
this review explicitly asked it not be softened. Preserving a frozen historical name would require
a new `PayrollEntry`-level name-snapshot column, which is a schema decision beyond this approved
banking refinement's scope — not implemented, not silently assumed away.

Verification re-run in full after the fix: `prisma validate`/`generate`/`migrate deploy` clean, zero
drift (no schema change this pass); typecheck/lint/build clean across shared/backend/frontend;
backend tests 286/286 (one new XLSX-cell-value assertion added; one unrelated, pre-existing flaky
performance test — `payroll-entry-performance.test.ts`'s query-plan check — failed once in the full
suite and passed cleanly both standalone and on re-run, confirmed unrelated to this change by code
inspection). **This 2026-07-12 iteration was itself superseded by the 2026-07-13 correction below
before ever being committed on its own** — the eventual `9d9bc32` commit is that later, corrected
version, not this one.

**Rejected on review again, 2026-07-13 — two architectural corrections, superseding the 2026-07-12
entry above.** (1) The "full `bank.name (code)`" display, added by the 2026-07-12 fix, was itself
wrong for the Payroll Entry grid and the Bank Sheet table: both are dense grids where only the
**Bank Code** should render (e.g. "HABIBMETRO", not "Habib Metropolitan Bank (HABIBMETRO)") —
Employee Registry's own Bank dropdown is the one place the full "Bank Name (Code)" form stays,
since it is a single selection control, not a dense grid, and the extra context is useful there.
(2) The 2026-07-12 fix's own "explicit character-width budget" (Bank 280px, Account No. 260px,
IBAN 300px) was itself exactly the kind of guessed fixed width the Layout Integrity rule always
meant to forbid — a wide-enough guess still silently truncates the next value that happens to be
longer. **Permanent Dynamic Width Rule, added this pass**: no column may use a guessed fixed pixel
width; every business-data column sizes itself from the actual longest loaded header/value plus
padding, with a fixed width reserved only for true UI controls (toggles, the serial column, the
Units pill, Cash Receiving's Signature/Thumb Impression column) — never for text, numeric,
identifier, or monetary columns.

**Fixed**: `frontend/src/components/payroll-entry/measure-column-width.ts` (new) — a pure,
dependency-free `measureColumnWidth({ header, values, paddingPx, minimumPx })` helper using
verified per-character-class width estimates (digit/upper/lower/space/other, calibrated against
real Playwright-measured font metrics), chosen over a Canvas/DOM measurement so it stays unit-
testable in Node. `columns.ts` rewritten around a single `computeColumnWidths(entries, banks)`
that resolves every `PAYROLL_COLUMNS` entry exactly once — `fixedWidth` for true controls,
`measureColumnWidth` against the full loaded dataset for everything else — producing one
`ResolvedPayrollColumnDef[]` that `gridTemplateColumns()`/`totalGridWidth()` both consume, so the
grouped header, column header, virtualized body rows, and sticky totals row all share the exact
same computed template (unchanged from the existing four-layer architecture, just now fed by one
shared calculation instead of a static constant). Bank `<select>` reverted to rendering
`bank.code` only. Bank Sheet's `BankSheetRow.bankName` renamed to `bankCode`
(`bank-sheets.service.ts`), with a new `excelColumnWidth(header, values)` helper replacing the
service's own hardcoded per-column Excel widths with a content-driven calculation; the Bank
Sheet's own filter dropdown correctly keeps the full bank name (a selection control, same
reasoning as Employee Registry). `ReadOnlyCell`'s `truncate` opt-out (added 2026-07-12) is
retained. Guessed `min-w-[NNNpx]` wrapper widths removed from Bank Sheet, Cash Receiving, Advances,
and Project Sites in favor of `min-w-full`/`overflow-x-auto` plus natural per-cell sizing; Project
Sites' Address column's `max-w-[260px] truncate` + tooltip pattern removed in favor of
`whitespace-nowrap` (full address always directly visible, not tooltip-only).

**Historical-name finding restated, still unresolved, still not silently expanded:** Bank Sheet's
Account Title remains a **live** `entry.employee.name` relation, not a frozen `PayrollEntry`
snapshot — unchanged from the 2026-07-12 finding above. No new snapshot column was added this pass
either; it remains a separate, explicitly-approved future decision.

**Tests added**: `frontend/src/components/payroll-entry/measure-column-width.test.ts` (7 cases —
header-floor, longest-value-wins, the 24-vs-34-character IBAN case, multi-row longest-wins, the
explicit minimum floor, header-vs-content, determinism) and `columns.test.ts` (7 cases — Bank Code,
not Name, drives the Bank column's width; a cash entry contributes "Cash"; IBAN widens for the
34-character schema maximum; Account Number reflects the longest value across the whole dataset,
not one row; fixed-width controls never resize; every `PAYROLL_COLUMNS` entry resolved exactly
once, in order; the grouped-header/body/totals shared template sums to `totalGridWidth`) — the
frontend workspace's first unit tests, run via a new Vitest config (Node environment, no jsdom,
since only pure logic needed testing). `backend/tests/bank-sheets.test.ts` updated for
`bankCode`, plus a new case rendering a full 34-character IBAN completely and an Excel
column-width assertion matched to the new dynamic calculation instead of a stale hardcoded
expectation.

Verification re-run in full after this fix: `prisma validate`/`generate`/`migrate deploy` clean,
zero drift; typecheck/lint/build clean across shared/backend/frontend (0 errors, same 4
pre-existing `react-refresh` warnings); **backend 287/287**, **frontend unit tests 14/14** (new);
real-stack Playwright verification against the live dev stack confirmed `scrollWidth`/`clientWidth`
parity (zero internal overflow) for the Bank Code cell/control, Account Number cell/control, and
IBAN cell/control in the Payroll Entry grid (using "HABIBMETRO", a 20-digit account number, both
the 24-character canonical IBAN and a 34-character maximum-length IBAN), the Employee Registry Edit
modal's Bank dropdown (confirmed still rendering "Habib Metropolitan Bank (HABIBMETRO)"), and the
Bank Sheet table (Bank Code column, full Account Number, full IBAN) — screenshots captured as
corroborating evidence. `phase3-payroll-entry-preview.html` and `phase4-bank-sheets-preview.html`
updated to match (Bank Code only in the rendered table rows, natural `table-layout: auto` sizing,
horizontal scroll as the escape valve); the other nine prototypes in scope were reviewed and found
to already comply, so left unmodified. **This 2026-07-13 pass was itself superseded by the header-
width defect fix immediately below, before either was committed on its own** — the eventual `9d9bc32`
commit is that final, corrected version.

**One further defect found and fixed during this entry's own mandatory re-verification pass, before
commit:** `measureColumnWidth`'s header-width estimate used a column header's literal-case label
string (e.g. "Branch Code"), but the header cell itself renders with CSS `text-transform: uppercase`
(`payroll-entry-grid.tsx`'s `role="columnheader"` class) — real uppercase glyphs are wider than the
lowercase ones the estimate was weighting, so the "Branch Code" header underestimated its own real
width and truncated by 3px (confirmed via Playwright DOM measurement: `scrollWidth` 91 vs
`clientWidth` 88, `text-overflow: ellipsis` engaged). Every other header happened to have enough
slack from its own content column to mask the same underlying gap. Fixed in
`measure-column-width.ts` by measuring `header.toUpperCase()` for the header-width half of the
calculation. Re-verified after the fix: frontend unit tests still 14/14 (no test asserted an exact
header-width number), and a fresh Playwright pass against realistic longer values
("DYNVERIFY-0001"/"DYNVERIFY-0002", `HABIBMETRO`, `PK36SCBL0000001123456702`, the 34-character IBAN
maximum, a 20-digit and a 10-digit account number) found zero overflowing cells across Payroll
Entry, Employee Registry, Bank Sheet (with entries actually released this time, not merely
Draft), Cash Receiving, Advances, Project Sites, Settings → Banks, Salary Release, and Tasks — no
console errors, no failed requests (one pre-existing, unrelated `401` on `/auth/me` at the
unauthenticated `/login` boot check, confirmed present before any of this session's changes and
reproducible with zero navigation). Full Definition of Done re-run clean after this fix:
`prisma validate`/`generate`/`migrate deploy` (12 migrations, none pending, no drift);
typecheck/lint/build clean across shared/backend/frontend (0 lint errors, same 4 pre-existing
`react-refresh` warnings); **backend 287/287**; **frontend 14/14**.

**Committed as `9d9bc32`** ("feat(layout): implement dynamic layout integrity improvements"), the
final, corrected version of this whole Layout Integrity pass. Both this commit and banking's own
`3b74c32` above were closed out in the same session by a doc-only commit, `372eeba` ("docs: record
banking refinement and layout integrity refinements") — **reconciled 2026-07-12 (Phase 4 Checkpoint
6.1's own preflight):** `372eeba`'s prose was written and committed narrating the working tree's state
*as it stood before* `3b74c32`/`9d9bc32` were actually committed, and several "not yet committed"/
"pending review" sentences above were never updated afterward to reflect that they had been —
inconsistent with `git log`, though the code itself was never in doubt. Corrected here, in place,
rather than left to mislead a future session into re-litigating already-committed, already-reviewed
work.

### Phase 4, Checkpoint 6.1 — Payslips backend foundation (2026-07-12, COMMITTED as `093a9df`)

Preceded by a dedicated, read-only Payslip architecture review (no files touched) — approved, and
grounded the decisions below. **Explicitly backend/schema foundation only**: no PDF, no batch/ZIP
generation, no frontend surface — those are Checkpoints 6.2 and 6.3, per the explicit three-way split
this checkpoint introduced (superseding this file's own earlier informal "Payslip generation" framing
as a single undivided item): **6.1 Backend Foundation → 6.2 PDF Engine → 6.3 Frontend, Batch
Generation, and Phase Close-Out**.

**Preflight:** working tree confirmed clean; the post-Phase-4 banking/layout refinement confirmed
already committed (`3b74c32`, `9d9bc32`, `372eeba`) — see the reconciliation note immediately above,
recorded as this checkpoint's own first action.

**Database — one additive migration, no `Payslip` table:** `PayrollEntry.employeeNameSnapshot`/
`.fatherNameSnapshot` (both nullable `varchar(160)`), migration `20260712210000_payslip_identity_snapshots`
— closes the "Snapshot-name finding" left open by the banking refinement above. Populated at entry
creation (`createPayrollEntry`); carried forward from the prior cycle's entry at bootstrap
(`createPayrollCycle`), a **deliberate deviation** from designation/banking's own "always refresh from
current Employee" bootstrap rule — see `database/payroll-entry.md §12`'s revision note and
`payroll-processing.service.ts`'s own doc comment for the full reasoning. Pre-existing rows
best-effort-backfilled from their current linked `Employee` in the same migration — no financial
figure touched. No `Payslip`/PDF-storage table, per Principle 1 (Payslips remain a query module, same
as Bank Sheets/Cash Receiving) and this checkpoint's own frozen decision.

**Shared:** new `PERMISSIONS.PAYSLIPS_VIEW` (`payslips:view`), granted to all three roles (Master
Admin implicitly; Payroll Staff and Finance explicitly in `ROLE_PERMISSIONS`) — a dedicated
permission, not a reuse of `payroll:entry`/`payroll:view`/`bank-sheets:view` (see
`docs/architecture/authentication.md`'s new "Payslips: a dedicated permission" section for the
rationale). No new Zod schema needed — both endpoints are parameterless GETs, matching Bank
Sheets/Cash Receiving's own convention of plain inline query parsing.

**Backend:** new module `backend/src/modules/payslips/` (`payslips.service.ts`, `payslips.routes.ts`),
mounted at `/api/v1/payroll-cycles/:cycleId/payslips`. Two endpoints only:
- `GET /` — the picker/list (released, non-held employees; site + free-text search filter;
  pagination matching `payroll-entry.service.ts`'s own convention). Not audited (see below).
- `GET /:employeeId` — one assembled Payslip as JSON. Released/non-held enforced server-side
  regardless of any client input; site-scoped (`assertSiteAccess`); writes exactly one
  `payslip.viewed` `AuditLog` entry (actor, IP, user-agent, `{cycleId, employeeId}`); sets
  `Cache-Control: no-store`.

Both are route-agnostic in their underlying service functions by design (`getPayslip`/`listPayslips`
take only `currentUser`/identifiers, no Express `Request`/`Response`) — intended to back PDF rendering
(6.2), batch/ZIP generation (6.3), and a future Employee Self-Service endpoint without rewriting the
assembly logic (`docs/architecture/overview.md`'s ESS composition note). All money arithmetic reuses
`computeEntryCalc`/`calcNet` (`@payroll/shared`) exactly — nothing recomputed independently
(Principle 6). `docs/architecture/system-conventions.md §3` gained a new subsection documenting the
view-level audit convention this checkpoint introduces (a deliberate step beyond Bank
Sheets/Cash Receiving's export-only audit precedent).

**Known, explicitly out-of-scope gap:** there is not yet any route that lets `employeeNameSnapshot`/
`fatherNameSnapshot` be corrected directly on a Draft `PayrollEntry` — a genuine name-spelling
correction currently requires direct database intervention. Future work, not part of this
checkpoint's approved scope (see `payroll-processing.service.ts`'s own doc comment).

**Testing:** new `backend/tests/payslips.test.ts` (17 tests) — Master User/Payroll Staff/Finance
access, missing-permission rejection, manipulated site-filter rejection, out-of-scope detail
rejection, nonexistent-combination 404, Draft/held exclusion, released-non-held inclusion, `calcNet`
parity (single-line and split-by-unit), employee name/father-name/banking historical-snapshot
integrity, Advance-outstanding-balance non-recalculation, historical-cycle viewability,
`payslip.viewed` audit correctness (written once, never on the list endpoint), `Cache-Control:
no-store`, and no unrelated Employee/User field leakage. Full backend suite: **304/304** (287 prior +
17 new). Typecheck/lint/build clean across shared/backend/frontend. `prisma validate`/`generate`/
`migrate deploy` clean, zero drift.

**Real-stack verification:** a real local PostgreSQL (embedded-postgres, session-scratchpad) plus a
live `tsx src/server.ts` instance, driven via real HTTP (`curl`, real cookie/CSRF/session flow, real
login as the seeded Master Admin and freshly-created Payroll Staff/Finance/no-permission users) —
confirmed end-to-end: bootstrap-created entries carry the new snapshot fields correctly; the
list/detail endpoints return correct data; 401 unauthenticated, 403 missing-permission, 403
manipulated/out-of-scope site, 404 unreleased; `Cache-Control: no-store` present; `AuditLog` rows
written with real IP/user-agent and correct actor per caller. No browser-automation tool was available
this session — no frontend surface exists yet for this checkpoint regardless, so none was needed.

**Documentation updated this pass:** `database/payroll-entry.md §12` (new columns + bootstrap
carry-forward-vs-refresh note), `docs/architecture/authentication.md` (new permission), this file, and
the stale post-Phase-4-refinement "not yet committed" narrative reconciled against `git log` (above).

**Committed as `093a9df`** — reviewed, approved, and committed together with Checkpoint 6.2 below
as one logical implementation commit (Checkpoint 6.1 was intentionally left uncommitted while
Checkpoint 6.2 was built directly on top of it in the same session, per explicit instruction; see
`093a9df`'s own commit message for the combined summary). Doc-only hash record, this pass.

### Phase 4, Checkpoint 6.2 — Payslip PDF Engine (2026-07-12, COMMITTED as `093a9df`)

Preceded by a dedicated, read-only architecture review (no files touched), approved before this
implementation began. Builds the complete backend PDF-generation engine for Payslips — no frontend,
no batch/ZIP generation (both explicitly out of scope, Checkpoint 6.3).

**Dependencies:** `puppeteer` (`^25.3.0`) added to `backend/package.json`. Chrome fetched via
`npx puppeteer browsers install chrome` (the postinstall script itself is blocked by this session's
sandboxing; a normal `npm install` on Render will run it automatically — see the deviation below).

**`backend/src/lib/pdf/` (new, reusable, document-agnostic on purpose):**
- `browser.ts` — a lazily-launched, reused-across-requests Puppeteer browser singleton, with
  crash/disconnect detection and relaunch. `closeBrowser()` wired into `server.ts`'s existing
  graceful-shutdown handler alongside `prisma.$disconnect()`.
- `render-pdf.ts` — `renderHtmlToPdf(html, options?)`, a generic `page.setContent()`+`page.pdf()`
  wrapper (A4, print backgrounds on, 15mm margins, `displayHeaderFooter`/header/footer template
  passthrough for a future multi-page document) — zero Payslip-specific knowledge.
- `html-escape.ts` — `escapeHtml()`, the one escaping utility every interpolated value in the
  template goes through, no exceptions.
- `print-styles.ts` — the shared serif "paper document" stylesheet (`docs/design-system.md §3`),
  reusable by future Bank Sheet/Cash Sheet/Statement PDF templates.
- `templates/payslip.ts` — `renderPayslipHtml(payslip, meta)`, self-contained per this checkpoint's
  own instruction (no speculative shared "document header" module extracted yet — only one
  consumer exists). Reproduces `reference/PROJECT_SPEC.md`'s frozen Sample Payslip Format's exact
  row labels and layout order (title row → centered company name → two-column identity grid →
  side-by-side Earning/Deduction tables → centered Net Salary line). Reserves, but does not yet
  populate, the Balance Settlement line slot `docs/design-system.md §3` calls for (Phase 6 doesn't
  exist yet).

**`payslips.service.ts` extended, not duplicated:** `Payslip.periodStartDate`/`.periodEndDate`
(ISO `YYYY-MM-DD`, first/last calendar day of `cycleYear`/`cycleMonth`, computed via
`Date.UTC(...)`, never stored) added to the Checkpoint 6.1 JSON shape — closes the one JSON-shape
gap the architecture review identified against the frozen sample format's "Pay Period" header
field. New `generatePayslipPdf(currentUser, cycleId, employeeId, meta)`: calls `getPayslip()` for
every field and every authorization check (no independent Prisma query, no independent
calculation), renders via `renderPayslipHtml`/`renderHtmlToPdf`, returns
`{ buffer, entryId, employeeName }` — the latter two so the route can build its audit entry and
filename without a second database round trip.

**New endpoint:** `GET /api/v1/payroll-cycles/:cycleId/payslips/:employeeId/pdf` — identical
`payslips:view` permission, identical site-scoping, identical released/non-held gate as the JSON
route (all inherited from `getPayslip()`). `Cache-Control: no-store`, `Content-Type:
application/pdf`. **One PDF artifact serves both in-app preview and explicit download** —
`?disposition=inline` (default) vs `?disposition=attachment` — rather than a second raw-HTML
preview route, per the architecture review's own refined recommendation (a browser's native PDF
viewer is a narrower, better-understood sandbox than a second `text/html` surface, for no loss of
the "reused, not re-implemented" preview requirement `docs/design-system.md §3` calls for). New
`payslip.exported` audit action, written once per request regardless of disposition
(`metadata.disposition` records which); the JSON route's `payslip.viewed` is never also written,
since the PDF route calls `getPayslip()` directly as a function, never via the JSON route's own
HTTP handler.

**Security — HTML injection, the one genuinely new risk this checkpoint's own architecture review
flagged:** every interpolated value in `renderPayslipHtml` goes through `escapeHtml()` — employee
name, father name, designation, site name, generated-by name — no exceptions, since none of these
fields have any character restriction upstream (`shared/src/schemas/employee.ts`/`payroll-entry.ts`
impose length limits only). Verified directly, both as pure unit tests
(`tests/pdf-template.test.ts`) and end-to-end through the real HTTP endpoint with a genuinely
hostile employee name (`<script>alert(document.cookie)</script>`) against the compiled production
build — the script tag renders as literal, visible text in the PDF, never executes.

**Verification:** `prisma validate`/`generate`/`migrate deploy` clean (no schema change this pass);
typecheck/lint/build clean across shared/backend/frontend; **backend 325/325** (304 prior + 21 new:
9 HTTP-integration tests in `payslips.test.ts`, 12 pure unit tests in the new
`tests/pdf-template.test.ts`); real-stack verification against a real local PostgreSQL plus the
**actual compiled production build** (`node dist/src/server.js`, not just `tsx`/Jest), driven via
real HTTP (login, CSRF, cookies) — confirmed correct headers, correct `%PDF-` magic bytes, correct
`Content-Disposition` behavior for both dispositions, correct audit trail, and visually inspected
(via a Puppeteer screenshot of the same HTML the real endpoint rendered) against
`reference/PROJECT_SPEC.md`'s frozen sample layout — company header, identity grid,
Earning/Deduction tables, and Net Salary line all match.

**Deviation from the approved architecture review, discovered during implementation, not silently
worked around:** Puppeteer 22+ ships **ESM-only** (`"type": "module"`, no CJS build), while this
backend compiles to CommonJS (`backend/tsconfig.json`). A plain `import puppeteer from 'puppeteer'`
fails immediately under Jest/ts-jest (`SyntaxError: Unexpected token 'export'`). TypeScript's own
dynamic `import()` syntax does not help either — verified directly by compiling a minimal
reproduction: under a CommonJS module target, `tsc` downlevels `await import('puppeteer')` to
`await Promise.resolve().then(() => require('puppeteer'))`, which fails identically
(`ERR_REQUIRE_ESM`). Fixed via the standard, documented ESM-from-CJS interop pattern: loading the
specifier through `new Function('return import("puppeteer")')`, which hides the `import(...)` call
from TypeScript's static analysis so it survives as a genuine native dynamic import at runtime —
verified working across `tsc --noEmit`, Jest, and the actual compiled `dist/` output. A second,
related discovery: Jest's own CJS test runner cannot execute a real dynamic `import()` without the
`--experimental-vm-modules` Node flag (`backend/package.json`'s `test` script updated to set
`NODE_OPTIONS=--experimental-vm-modules`) — confirmed this addition is purely additive and doesn't
change behavior for any of the 304 pre-existing tests. A third, minor discovery during the full
(not per-file) test-suite run: the one test in `tests/pdf-template.test.ts` that directly invoked
`renderHtmlToPdf()` was intermittently flaky specifically under the full multi-file suite
(`Test environment has been torn down`) — a Jest/`--experimental-vm-modules` interaction with
Node's process-wide ESM module cache when multiple test files each dynamically `import()` the same
ESM-only package, not an application bug. Removed as redundant (the identical rendering pipeline is
already reliably covered end-to-end by `payslips.test.ts`'s real-HTTP tests, including with hostile
input), keeping `tests/pdf-template.test.ts` a pure, fast, no-I/O suite matching
`tests/calc-net.test.ts`'s own philosophy.

**Known limitation, not resolved this session:** no actual Render (or equivalent Linux container)
deployment smoke test was performed — this sandboxed macOS session has neither Docker nor live
Render deploy access. `--no-sandbox`/`--disable-setuid-sandbox` (the standard flags for
containerized Puppeteer deployments) are already included, Chrome-fetching was verified working via
Puppeteer's own CLI, and the font stack (`"Times New Roman", Times, Georgia, serif`) already
anticipates a bare Linux container substituting a metric-compatible serif font — but none of this
substitutes for an actual staging deploy confirming Chromium starts and fonts render correctly on
Render itself. Flagged as required before this checkpoint is considered fully production-ready, not
silently assumed fine.

**Committed as `093a9df`**, together with Checkpoint 6.1 above, as one logical implementation
commit. Waiting for review and commit approval before beginning Checkpoint 6.3 (Frontend, Batch
Generation, and Phase Close-Out).

**Final narrow pre-commit verification (2026-07-12), approved-in-principle review's own explicit
checklist — one correction made, six confirmed clean:**
1. The ESM/CJS interop workaround (`new Function('return import("puppeteer")')`) is confirmed
   isolated to `browser.ts` alone — the only other `puppeteer` reference anywhere in `backend/src`
   is `render-pdf.ts`'s `import type { PDFOptions }`, which is erased at compile time and has no
   runtime footprint.
2. **Corrected**: `getBrowser()`'s crash/disconnect relaunch previously reassigned the module-level
   `browserPromise` unconditionally, which under concurrent requests racing against the same dead
   browser could trigger two independent relaunches — orphaning one Chrome process that
   `closeBrowser()` could never subsequently reach (it only ever closes whatever `browserPromise`
   currently points to). Fixed with a compare-and-swap: each call captures the promise it started
   with and only relaunches if `browserPromise` still equals that captured value, so a losing
   concurrent caller simply awaits whichever relaunch actually won, rather than starting a second,
   silently-leaked one.
3. Confirmed: `render-pdf.ts`'s `finally { await page.close(); }` wraps both `page.setContent()`
   and `page.pdf()` — a page is closed even if either throws.
4. Confirmed, verified empirically (not just by inspection) with a hostile filename input
   containing a double quote, CR, LF, forward slash, and backslash together: the existing
   `employeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')` already strips every one of them, since
   the character class matches (and collapses) anything outside `a-z0-9` — no change needed.
5. Confirmed: `page.pdf()`'s `Uint8Array` is converted via `Buffer.from(uint8)` (a lossless binary
   copy, never a string round-trip); the route calls `res.status(200).send(buffer)` with no manual
   `Content-Length` anywhere — Express computes it correctly from the buffer's own byte length.
6. Confirmed: the only logging calls anywhere in `backend/src/lib/pdf/` or
   `backend/src/modules/payslips/` are `browser.ts`'s two generic operational messages (launch
   failure, disconnect) — neither logs HTML, PDF bytes, or any Payslip field. The global
   `pino-http` request logger and error handler (both pre-existing, shared by every module) log
   method/path/error object only, never request/response bodies. `payslip.exported`'s `AuditLog`
   metadata (`{ cycleId, employeeId, disposition }`) contains no name/salary/banking value — this
   is the one deliberate, access-controlled exception the check's own wording ("application logs")
   doesn't cover, not an oversight.
7. Re-ran in full after the correction: typecheck/lint/build clean across shared/backend/frontend;
   **backend 325/325**, unchanged.

No other Checkpoint 6.2 file required a change. Committed as `093a9df`.

### Phase 4, Checkpoint 6.3 — Payslip Frontend, Batch Generation, and Phase 4 Close-Out (2026-07-13)

Preceded by a dedicated, read-only architecture review (no files touched), approved with
refinements: bounded stateless ZIP streaming, no Redis/queue/job table/persisted artifact, a named
`300` constant (not an approximate range), validation completed before any streaming begins.

**Checkpoint 6.3.1 — Bulk Payslip assembly, one shared builder.** `payslips.service.ts` gained
`toPayslipCompany()` (factored out of `getPayslip()`, now shared) and `getPayslipsBulk(currentUser,
cycleId, filters)`: one `PayrollEntry.findMany` (same `include` shape as the individual endpoint),
one `CompanySettings` read, every row mapped through the same `buildPayslip()` — no duplicated
`calcNet`/release/hold/snapshot/formatting rule anywhere. `BulkPayslipFilters` supports explicit
`employeeIds` plus `siteIds`/`unitIds`/`search`; site scope is enforced the same way
`listPayslips()` already enforces it (silent exclusion of out-of-scope IDs, never a 403 for a
mixed valid/invalid batch). `ListPayslipsFilters` gained `unitIds` for parity. `generatePayslipPdf`
was refactored to call a new extracted `renderPayslipPdfBuffer(payslip, meta)` — the same function
the batch route calls once per employee, so there is exactly one PDF-rendering call path for both
individual and batch generation.

**Checkpoint 6.3.2 — Batch PDF/ZIP endpoint.** `POST /api/v1/payroll-cycles/:cycleId/payslips/
batch`, gated by the existing `payslips:view` permission (no new key — see the "Payslips: a
dedicated permission" note in `docs/architecture/authentication.md`, extended this checkpoint to
cover batch/ZIP generation explicitly). Request body validated by `shared/src/schemas/payslip.ts`'s
`batchPayslipsSchema` (`employeeIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH_PAYSLIPS_PER_
REQUEST)`) **before any database query** — the 301-item case is rejected at the schema layer,
never touching Prisma. `MAX_BATCH_PAYSLIPS_PER_REQUEST = 300` (`shared/src/constants/payslips.ts`,
an exact named constant, not an approximate range). After `getPayslipsBulk()` resolves the eligible
set (server-side site scope + released/non-held enforced identically to every other Payslip read),
a **canary render**: the first Payslip is fully rendered before any HTTP header is sent, so a
systemic Puppeteer failure (e.g. the shared browser singleton is dead) produces a clean JSON error
rather than a truncated ZIP already in flight. Only after the canary succeeds does the route set
`Cache-Control: no-store`, `Content-Type: application/zip`, `Content-Disposition: attachment`, and
begin piping an `archiver('zip', { zlib: { level: 6 } })` stream directly into `res` — no temp file,
no full-ZIP memory buffer, no persisted artifact. Remaining employees render in chunks of
`BATCH_RENDER_CONCURRENCY = 4` (the same bounded-`Promise.allSettled`-over-chunks pattern already
used by `payroll-processing.service.ts`), reusing the one warm Chromium instance from Checkpoint
6.2; every Puppeteer page is closed via the existing `render-pdf.ts` `finally` block regardless of
success or failure. `res.on('close')` is checked before scheduling each further chunk, so a client
disconnect stops new PDF work immediately (renders already in flight are allowed to finish, not
aborted mid-page). Archive entry names are collision-proof:
`buildArchiveEntryName()`/`slugify()` (exported, pure functions) strip everything outside
`[a-z0-9]` from `{employeeCode-or-shortId}-{employeeName}`, guaranteeing no path traversal,
slash/backslash, quote, or CR/LF can reach the ZIP's central directory, with a `usedNames: Set`
providing a numeric-suffix fallback for genuine collisions (verified as pure unit tests — a real
duplicate-`employeeCode` HTTP test was blocked by the DB's own unique constraint, which is itself
evidence the constraint works).

**Partial failure, deliberately defined:** one employee's render failure never aborts the batch —
it's logged (employeeId/entryId only, never the underlying error's message/stack/SQL) and the ZIP
gains a `_summary.txt` listing which employees failed, by code/ID, with a generic reason string,
whenever `failureCount > 0`. **All-fail-via-canary, deliberately defined:** if the very first
(canary) employee fails, the whole request fails with a clean JSON error and zero bytes are ever
sent — there is nothing to summarize inside a ZIP that was never started, so this case does not
produce a `_summary.txt`-only empty archive; it produces a normal error response, consistent with
every other Payslip failure mode in this codebase. No automatic retry this checkpoint, per the
approved scope.

**Audit — exactly one row per batch, never one per employee.** A single `payslip.batch_exported`
`AuditLog` entry is written after the stream ends (`res.on('finish')`/`res.on('close')`), with
`cycleId`, the applicable site/filter summary, `requestedCount`, `eligibleCount`, `successCount`,
`failureCount`, failed employee codes/IDs (only while the list stays small — never an unbounded
dump), and `cancelled: true/false`. `payslip.exported` (the individual-download action) is never
triggered per employee inside a batch. **Cancellation before the canary completes** (i.e. before
any header is sent) writes no audit entry at all — a defensive `res.writableEnded || res.destroyed`
guard added after the canary prevents a doomed `res.setHeader()` call on an already-dead connection
from throwing down the generic error path; this is a deliberate design choice (nothing meaningful
happened yet to summarize), consistent with the all-fail-via-canary case above, not an oversight.

**Checkpoint 6.3.3 — Frontend Payslips workspace.** New route `/payslips`
(`frontend/src/routes/payslips-page.tsx`), nav entry gated by `payslips:view`
(`nav-config.ts`), and `frontend/src/hooks/use-payslips.ts` (`usePayslips()` query hook,
`payslipPdfUrl()`, `downloadPayslipPdf()`, `downloadPayslipsBatch(cycleId, employeeIds, signal)`).
Cycle select, Site `MultiSelectFilter`, Unit `MultiSelectFilter` (populated only once a single Site
is selected — Units are Site-scoped), employee search, a table with header + per-row checkboxes.
**Selection semantics, one unambiguous rule:** "select all" means every employee **currently
loaded by this picker under the active server-side filters** — never the whole company, never an
employee outside the caller's own site scope. Changing Cycle, Site, Unit, or Search clears the
current selection outright (a `useEffect` keyed on the filter values), so a filter change can never
silently submit a no-longer-visible `employeeId`. Selected count, eligible/loaded count, and the
300 maximum are always visible; exceeding 300 disables the download button with an explicit "narrow
your filters" message. **The frontend limit is UX only — the backend's own `batchPayslipsSchema`
independently re-validates and re-scopes every request regardless of what the client claims was
selected.** Individual preview opens the existing single-PDF endpoint
(`?disposition=inline`) in a new tab via `window.open()`; individual download uses
`?disposition=attachment` — no second HTML preview route, no duplicated template in React, per
Checkpoint 6.2's own architecture decision. Batch download is a `fetch()` + `AbortController` +
Blob + anchor-click flow with a "Generating N Payslips…" busy state (no fake percentage progress
bar — a real streamed HTTP response has no accurate percentage to report) and a Cancel button that
aborts the in-flight request and cleans up any created object URL.

**Checkpoint 6.3.4 — Prototype, verification, and Phase 4 close-out.**
`docs/prototypes/phase4-payslips-preview.html` (new, modeled on the existing Cash Receiving
prototype's structure) — six tab-switchable screens: List & selection, Over the 300 limit, Batch
generating, the printable Payslip document, Empty state, No access. Visually verified via a
headless-browser screenshot of all six tabs — zero console errors. **Verification, this pass:**
`prisma validate`/`migrate status` clean, zero drift; typecheck/lint/build clean across
shared/backend/frontend; **backend 346/346** (325 prior + 21 new: N+1 query-count proof,
individual/bulk DTO parity, released/held-exclusion, site-scope enforcement, no-sensitive-leak,
301-rejection, exact-300-acceptance, permission rejection, site-scope-via-HTTP, zero-eligible
rejection, Draft/held exclusion, duplicate-name distinct-entries, partial-failure/`_summary.txt`,
all-fail-via-canary, audit correctness, cancellation, and 5 pure `slugify`/`buildArchiveEntryName`
unit tests) against a real local PostgreSQL; real production-build HTTP verification; real
Playwright browser verification of the actual React page (login, filter, select-all, individual
preview/download, batch ZIP download, empty state, permission-denied state) — a real multi-entry
ZIP was downloaded and structurally inspected (correct, collision-free filenames), a real individual
PDF was downloaded and inspected (`%PDF-` magic bytes, correct filename), zero unexpected browser
console/page errors. **One flaky test found and fixed, not just re-run around:** the N+1
query-count test occasionally reported an off-by-one query count (`8` vs `7`) under a full-suite
run — root cause was the very first query on a fresh Prisma connection carrying one-off setup cost
unrelated to N+1 shape; fixed by adding a throwaway warm-up call before the two measured calls, and
confirmed non-flaky across 5 consecutive isolated runs. **Unrelated, pre-existing infrastructure
observation, not a regression:** running the full `npm run test` suite twice in immediate
succession can intermittently surface a batch of unrelated failures (FK violations, "record not
found") in older test files — root-caused to the "Jest did not exit one second after…" lingering
Node process from the *previous* invocation still holding open Postgres connections (`max_
connections = 100`, no `$disconnect()` between the 24 per-file `PrismaClient` instances) and
competing with the new run; confirmed by observing `pg_stat_activity` return to baseline (9
connections) once the prior process fully exited, after which a clean run reliably produces
346/346. Not fixed this checkpoint (a global-teardown refactor touching all 24 test files is
outside Checkpoint 6.3's scope) — recorded here as a known artifact so a future session
re-encountering apparent flakiness doesn't mistake it for a code defect.

**Mandatory deployment verification — genuinely attempted, could not be completed, recorded
honestly.** Checked this session for Docker, Podman, Colima, a Render CLI/API token, and a
configured git remote — none present in this sandboxed macOS environment (the same constraint
already recorded as a known limitation under Checkpoint 6.2, still unresolved). **No Render or
equivalent Linux-container smoke test was performed.** A local macOS run does not substitute for
this per explicit instruction, so this checkpoint's deployment-readiness status is **implementation
complete and locally verified, not production-verified.** Everything a local session can check —
`--no-sandbox`/`--disable-setuid-sandbox` present, the ESM/CJS Puppeteer interop working under the
actual compiled `dist/` build, the serif font stack's documented fallback reasoning — remains as
recorded under Checkpoint 6.2; none of it has been confirmed against an actual container.

**Documentation updated this pass:** this file; `docs/IMPLEMENTATION_PLAN.md` (Checkpoint 6.3 entry
+ Phase 4 review-checkpoint marker); `docs/SESSION_HANDOFF.md`; `docs/architecture/authentication.md`
(batch/ZIP generation confirmed covered by the existing `payslips:view` permission, no new key);
`docs/architecture/system-conventions.md` (closes the speculative note left by Checkpoint 6.2 —
batch generation did **not** end up needing a PDF cache or `StorageProvider`; it stayed fully
stateless, per the approved architecture review).

**Committed as `7ff696b`.**

### Phase 4 close-out review (2026-07-13)

Reviewed against every Phase 4 checkpoint and `docs/PROJECT_PRINCIPLES.md`:

- **Bank Registry, Salary Release foundation, Bank Sheets, Cash Receiving Sheets, Advances** —
  unchanged since their own closes (`7c2cdb5`, `cedf386`, Checkpoint 3's commit, `477fbb1`,
  `75c5e64`); no regression introduced by Checkpoint 6.1–6.3 (full backend suite, including every
  pre-existing test file, passes at 346/346 alongside the new Payslip tests).
- **Payslips (6.1 backend, 6.2 PDF engine, 6.3 frontend/batch/close-out)** — complete, tested, and
  locally verified end to end (backend HTTP, compiled production build, real browser).
- **Principle 1 (derived, read-only views)** — a Payslip is never persisted; both the individual
  and batch paths render from live `PayrollEntry`/`CompanySettings` data on every request.
- **Principle 6 (exported values match underlying data)** — batch and individual generation share
  one assembly function (`buildPayslip()`) and one PDF-rendering function
  (`renderPayslipPdfBuffer()`); there is no second calculation or formatting path to drift.
- **Principle 9 (released payroll is immutable)** — both Payslip paths only ever read released,
  non-held `PayrollEntry` rows; neither can be reached for Draft or held entries.
- **Principle 10 (10,000-employee design floor)** — the 300-per-request cap plus bounded
  concurrency is this checkpoint's own answer to that floor: an unbounded whole-company export is
  explicitly Phase 5's job (`BackupPackage`/`StorageProvider`), not this checkpoint's.
- **Two accepted, explicitly-documented gaps, not silently carried forward:**
  1. `CompanySettings` is read live, never snapshotted (`payslips.service.ts`'s own doc comment,
     `docs/architecture/database/access-control.md §19`) — a company rename would change how a
     historical Payslip regenerates. Accepted as lower-probability than an employee's own identity
     changing (which Checkpoint 6.1's snapshot columns already close) and out of this checkpoint's
     schema scope.
  2. There is still no route to correct `employeeNameSnapshot`/`fatherNameSnapshot` on a Draft
     `PayrollEntry` (Checkpoint 6.1's own recorded gap) — a genuine spelling correction still
     requires direct database intervention. Unchanged by 6.3, not this checkpoint's scope.
- **Deliberately deferred to Phase 5, not silently carried in:** a genuinely company-wide "every
  Payslip in the cycle" export (would require `BackupPackage`/`StorageProvider`, a persisted
  artifact); any Payslip caching; any background/queued generation. This checkpoint's 300-item cap
  is for realistic, operator-filtered batches, not an unconditional whole-company archive.
- **Employee Statements — reconfirmed Phase 7 scope**, unaffected by any Payslip work (originally
  settled 2026-07-11, reaffirmed here since Payslips and Employee Statements are easy to conflate).
- **The one condition that did not pass:** real Render/container deployment verification — see
  Checkpoint 6.3's own "Mandatory deployment verification" note above. Because of this, **Phase 4
  is marked code-complete, not fully closed** — the summary table in §2 below reflects this
  precisely rather than rounding up to "closed."

### Phase 5 architecture review (2026-07-14, read-only, no code)

Reviewed the frozen Phase 5 architecture (`docs/architecture/workflows/payroll-lifecycle.md §4–5`,
`database/payroll-cycle.md §10/§10a/§17–18`) against the actual Phase 4 implementation. **Conclusion:
no architectural redesign required** — Phase 4 shipped without surprises that invalidate Phase 5's
design. Findings, all approved before any code was written:

1. `createPayrollCycle` (`payroll-processing.service.ts`) already implements *part* of Phase 5's job
   (cycle creation, carry-forward, `ScheduledPayrollPeriod` resolution, Advances materialization) —
   Phase 5 extends this function in place rather than building a parallel implementation. It
   currently does not require the outgoing cycle to be `RELEASED`, does not archive it, generates no
   `BackupPackage`, and — a genuine functional gap, not by design — never carries forward a departed
   employee, so a departed employee with a scheduled Advance deduction due next cycle currently gets
   no entry and the deduction is stranded.
2. **The Outstanding Payroll Obligation registry question, resolved**: Phase 5 retains the existing
   direct-call convention (Advances only, the sole real provider today); no generic provider/hook
   registry is built in Phase 5; `BalanceAdjustment`'s own carry-forward predicate is out of Phase
   5's implementable scope (the table doesn't exist until Phase 6, which is sequenced after this
   phase) and lands as Phase 6's own direct call, mirroring Advances'; a registry is revisited only
   if a second concurrently-existing provider actually justifies it. Recorded in
   `docs/IMPLEMENTATION_PLAN.md`'s Phase 5 section.
3. `PayrollUnitReadiness` remains intentionally deferred (dated note added to `database/release.md`)
   — not part of Phase 5's `Builds` list; the finalization precondition keys off
   `PayrollEntry.released`/`.hold` only.
4. Schema additions needed: `BackupPackage`/`BackupPackageFile` only (`database/payroll-cycle.md
   §17–18`) — `PayrollCycle.releasedAt`/`.releasedBy`/`.archivedAt`/`.archivedBy` already exist
   (added Phase 3 Checkpoint 0, unused until now), no change needed there.
5. `StorageProvider` confirmed as Phase 5's hard prerequisite, per the standing decision
   (`docs/PROJECT_PROGRESS.md` §3 item 4) — built first, as Checkpoint 0 (below).
6. Cross-system atomicity (Postgres + `StorageProvider` can't share one transaction) identified as a
   real open design question with no prior written answer — resolved and recorded in
   `docs/architecture/system-conventions.md §2`: storage writes complete first, then one final
   database transaction; a late database failure triggers best-effort storage cleanup and may
   temporarily leave an unreferenced storage object, but must never leave payroll database state
   partially advanced.
7. Proposed checkpoint breakdown (Checkpoint 0 `StorageProvider` → 1 Finalize Cycle → 2 Backup
   Package generator → 3 new-cycle-creation transaction upgrade → 4 Payroll Cycle Selector → phase
   close-out) approved; recorded in `docs/IMPLEMENTATION_PLAN.md`'s Phase 5 section.

### Phase 5, Checkpoint 0 — `StorageProvider` Foundation — COMPLETE, 2026-07-14, COMMITTED as `d87b9b0`

Implements the storage abstraction originally planned for Phase 0 (silently never built — see §3
item 4) and confirmed by the architecture review above as Phase 5's own hard prerequisite. Preflight
confirmed branch `main`, a clean working tree, and every documented Phase 4 close-out commit present
in `git log` before any file was touched.

- **`backend/src/lib/storage/`** (new): `storage-provider.ts` (the `StorageProvider` interface —
  `write`/`read`/`createReadStream`/`exists`/`delete` — deliberately narrower than the original
  design sketch, which included `getUrl`/`list` that no real consumer needs yet; see
  `docs/architecture/system-conventions.md §2` for the full shipped shape and reasoning);
  `errors.ts` (`StorageError` hierarchy — `StorageKeyError`/`StorageNotFoundError`/
  `StorageConfigError`/`StorageIOError` — deliberately not `HttpError`, since `StorageProvider` has
  no knowledge of HTTP; a future route translates these itself); `safe-path.ts`
  (`resolveObjectPath()` — the one place key validation happens: rejects `..`/`.` segments, absolute
  paths, backslashes (rejected outright rather than merely normalized, so a key's meaning never
  depends on which OS the process runs on), null bytes, empty segments, and anything that resolves
  outside the configured root); `local-filesystem-storage-provider.ts`
  (`LocalFilesystemStorageProvider` — the first and, for now, only implementation; atomic
  temp-file-then-rename publish with guaranteed temp-file cleanup on failure; a defense-in-depth
  symlink-escape check beyond the lexical path validation, since a subdirectory under the root could
  in principle be replaced by a symlink after creation); `resolve-root.ts` (`resolveStorageRoot()` —
  split into its own file, deliberately, so it stays a pure, testable function of its arguments
  rather than living in `index.ts` where importing it for a test would trigger the singleton's real
  `mkdirSync` side effect); `index.ts` (the app-wide `storageProvider` singleton, matching
  `lib/prisma.ts`'s existing convention — constructed eagerly at import time so a misconfigured root
  fails at startup; **not imported by any route or service yet**, so it has zero side effects on the
  existing test suite or dev environment until the `BackupPackage` checkpoint wires it up).
- **`backend/src/config/env.ts`**: new required `STORAGE_ROOT` (no schema default — matches
  `SESSION_SECRET`/`CSRF_SECRET`'s fail-loudly convention, not `PORT`'s defaulted one).
  **`backend/.env.example`**: `STORAGE_ROOT="storage"` (a working local-dev value, per this
  codebase's existing convention for every other required secret/config). **`backend/tests/
  env.setup.ts`**: a fallback value satisfying schema validation only — never used to create a real
  directory, since every storage test constructs its own provider against an isolated
  `fs.mkdtemp()` root rather than importing the `index.ts` singleton.
- **Path security** (the checkpoint's own explicit requirement — storage keys are untrusted at the
  provider boundary even when application-generated): traversal (`..`, including mid-path and
  multi-level), absolute POSIX paths, Windows drive-letter prefixes, backslashes (both as a
  traversal attempt and as an ordinary separator — rejected unconditionally, not merely normalized),
  null bytes, empty path segments, and single-dot segments are all rejected before any filesystem
  call. Containment is verified twice: lexically (segment-by-segment, plus a `startsWith(root +
  sep)` check guarding against a naive prefix match like a `<root>-evil` sibling directory) and, for
  defense in depth, via `realpath` on the nearest existing ancestor — catching a subdirectory under
  the root having been replaced by a symlink pointing outside it after this provider created it.
  Verified live: a real symlink was created inside a test's storage root pointing at a separate
  `fs.mkdtemp()` directory, and a write through it was confirmed rejected with zero bytes written to
  the target.
- **No HTTP route added, deliberately** — per the checkpoint's own scope boundary, with no
  `BackupPackage` (or any other domain record) yet in existence to authorize a download against,
  inventing an authorization rule now would have had nothing real to check against. `read`/
  `createReadStream` exist at the provider layer only; the authenticated, user-facing download
  endpoint is explicitly deferred to the `BackupPackage` checkpoint. The storage root is not served
  by Express static middleware anywhere in `app.ts`.
- **Tests**: `backend/tests/storage.test.ts` — 37 new pure unit tests (no database, mirroring
  `date-utils.test.ts`/`calc-net.test.ts`'s pattern for a `lib`-level utility), each against its own
  isolated `fs.mkdtemp()` directory, removed in `afterEach`: binary read/write round-trip, nested
  directory auto-creation, write metadata correctness, writing from a stream (not only a `Buffer`),
  zero-byte and 5&nbsp;MB binary content, overwrite (last-writer-wins) and 12-way concurrent-write
  resolution (exactly one of the concurrent values survives, never a byte-level mix), temp-file
  cleanup after a simulated stream failure, `createReadStream` full-content streaming, `exists`
  true/false without throwing, `delete` including idempotent delete-of-missing, 12 malformed-key
  cases each individually rejected across all five operations, the symlink-escape case above,
  recursive root creation, rejection of a filesystem-root storage root, and `resolveStorageRoot`'s
  own cwd-collision guard. **Full backend suite: 383/383** (346 prior + 37 new), confirmed via a live
  local PostgreSQL instance (this session reused an already-running embedded-postgres instance left
  over from an earlier session in the same sandbox rather than starting a conflicting second one on
  the same port — same `payroll_dev` database/migrations, all 13 migrations already applied, `prisma
  migrate deploy` confirmed zero pending). The new storage tests were additionally re-run 5 times in
  isolation to confirm no flakiness (all 37/37 every time).
- **One real defect found and fixed via this checkpoint's own test run, not shipped**: a Jest/Node
  VM-realm gotcha — Jest's `node` test environment runs test files in a separate VM context from the
  one Node's own built-in modules (like `fs`) construct their errors in, so `err instanceof Error`
  silently evaluates to `false` for a perfectly ordinary `fs` ENOENT/EACCES rejection under Jest,
  even though the identical code behaves correctly outside Jest (confirmed by reproducing the exact
  same code via `tsx` directly, where it worked correctly, before finding the Jest-specific cause).
  This made the symlink-containment check's error-type guard mis-classify a routine "the object does
  not exist yet, walk up to the parent" case as an unexpected I/O failure, so `exists()`/`delete()`
  of a genuinely missing key would throw instead of returning `false`/succeeding silently as
  specified. Fixed by checking for a `code` string property (duck-typing) instead of `err instanceof
  Error`, which is also the more standard, realm-agnostic way to identify a `NodeJS.ErrnoException`
  regardless of the Jest-specific trigger. Verified fixed and stable across 5 repeated isolated test
  runs.
- Two pre-existing, unrelated integration-test failures (`payslips.test.ts` — a PDF-rendering
  timing/connection issue; `employees-import-export.test.ts` — a stale-session login failure) were
  observed on the very first full-suite run against the reused live database, before any code in
  this checkpoint's diff was touched by them, and did not reproduce on a clean re-run (383/383
  green) — attributed to the reused Postgres instance's residual state from its prior session, not a
  regression this checkpoint introduced. Neither test file was modified.
- typecheck/lint/build clean across all three workspaces (`prisma validate` also clean — no schema
  change, as expected). No frontend/UI surface was touched — an explicit, approved exception to the
  otherwise-mandatory per-checkpoint Playwright rule, matching the same exception this project's
  earlier schema-only checkpoints (e.g. Phase 3 Checkpoint 0) used, since this checkpoint adds no
  route, service, or component a browser could exercise.
- Git status confirmed clean of leftover artifacts: no stray `.tmp-*`/test-storage directories
  anywhere in the repository tree; `backend/storage/` does not exist on disk (nothing has
  constructed the singleton yet, confirming zero side effects from any verification step run this
  checkpoint) and is confirmed gitignored, along with any file inside it, via `git check-ignore -v`.
- **Reviewed, approved, and COMMITTED as `d87b9b0`** (after the final narrow verification pass
  below). Also not yet begun: Finalize Cycle, `BackupPackage`, cycle archiving, new-cycle-creation
  changes, or historical cycle selection — all explicitly out of this checkpoint's scope and
  unstarted.

### Phase 5, Checkpoint 0 — final narrow pre-commit verification pass (2026-07-14)

Approved in principle; before committing, ten specific properties were checked explicitly against
the actual implementation (not assumed from the design) — the same discipline this project used for
Phase 4 Checkpoint 6.1/6.2's own pre-commit passes. **Two real gaps were found and fixed; the other
eight were confirmed already correct**, each backed by a new test, not just a code read:

1. **Root-as-symlink containment — confirmed already correct, now tested.** The constructor's
   existing `fs.realpathSync(resolved)` already resolves a symlinked root to its real location before
   storing it as the containment baseline — untested until now. Added a test constructing a provider
   whose *root itself* is a symlink, confirming writes land in the real target directory and
   traversal is still rejected.
2. **Collision-resistant concurrent temp filenames — confirmed already correct.** 8 random bytes (16
   hex characters) per temp file was already sufficient; added an explicit assertion that a 12-way
   concurrent write to the same key leaves zero `.tmp-*` files behind afterward (previously only the
   "exactly one value survives" outcome was asserted, not the absence of leaked temp files).
3. **Same-directory atomic rename — confirmed already correct**, unchanged from Checkpoint 0's
   original implementation.
4. **Temp-file cleanup on failure — confirmed correct for write failures, gap found for rename
   failures.** The existing `catch` wraps both the write-to-temp-file step and the rename step, so
   rename failures were already structurally covered — but no test exercised that path specifically.
   Added a deterministic rename-failure test (pre-occupying the destination with a non-empty
   directory, which POSIX `rename()` always rejects for a file source) confirming temp-file cleanup
   and zero impact on the pre-existing occupant.
5. **`createReadStream` contract — confirmed correct, clarified and tested.** Missing-object handling
   was already synchronous (`StorageNotFoundError`, not a stream event). Added a doc comment stating
   the contract explicitly (a *later* failure, after the stream has been returned, is an ordinary
   stream `'error'` event this method cannot intercept) and a deterministic test proving the returned
   stream is the real, unwrapped Node stream — a later externally-triggered error still surfaces
   normally, confirming nothing in this method could silently swallow it.
6. **`delete` scope — confirmed already correct, now tested.** `unlink` only, never recursive; added
   a test writing two objects in the same directory, deleting one, and confirming the sibling and the
   parent directory are both untouched.
7. **No absolute paths or sensitive data in logs — two real gaps found and fixed.** The module itself
   never calls `console`/a logger (confirmed by a new test spying on `console`/`stdout`/`stderr`
   across a representative mix of successful and failing operations — zero calls). But
   `assertNoSymlinkEscape`'s two error messages *did* embed the absolute resolved path (`current`) —
   a real gap, since `backend/src/common/middleware/error-handler.ts:65` (`logger.error({ err, ... })`)
   confirms any future route that lets a `StorageIOError` fall through *would* log it in full. Fixed
   by threading the caller-supplied `key` through to those two messages instead of the absolute path;
   every `StorageError` message is now guaranteed key-only. `StorageIOError.cause` still carries the
   raw underlying Node error (which has its own absolute `.path`) for local debugging — documented
   with an explicit log-hygiene caution in `errors.ts` rather than stripped, since sanitizing a field
   whose entire purpose is developer diagnostics would cost more than it's worth for a field no
   current code path logs.
8. **Directory/file permissions — a real gap found and fixed.** Neither directories nor files were
   given an explicit mode, leaving them subject to the deploying environment's umask (typically
   `0o755`/`0o644` — group/other-readable). Fixed: every `mkdir`/`mkdirSync` call now passes
   `mode: 0o700` (confirmed, via a throwaway script, to apply recursively to every directory created
   in one call on this platform, not only the leaf), and both `writeFile` and `createWriteStream` now
   pass `mode: 0o600`. Explicit modes, not the umask, are what make this a guarantee rather than an
   environment-dependent accident — `0o700`/`0o600` have no group/other bits to begin with, so no
   ordinary umask can widen them. Four new tests assert the actual mode bits on a freshly-created
   root, a nested object directory, a Buffer-sourced file, and a stream-sourced file.
9. **Full suite clean.** `prisma validate` clean (no schema change); typecheck/lint/build clean across
   all three workspaces; full backend suite **392/392** (383 prior + 9 new tests from this pass) —
   one transient, unrelated failure (`payroll-entry-import-export.test.ts`'s login helper) appeared on
   the first full-suite run against the same long-lived reused Postgres instance and did not reproduce
   in isolation or on a clean full re-run (392/392 green both times); the new/expanded storage suite
   (46 tests total) was additionally re-run 5 times in isolation with zero flakiness.
10. **No leftover artifacts** — re-confirmed after this pass: no stray `.tmp-*`/test-storage
    directories anywhere in the repository tree, `backend/storage/` still does not exist on disk, and
    `git status` shows only the intended files touched.

No unrelated code was refactored; no `BackupPackage`/cycle-lifecycle work was started, per this
pass's own explicit scope.

### Phase 5, Checkpoint 1 — Finalize Cycle — COMPLETE, 2026-07-14, COMMITTED as `cad93bc`

Preflight confirmed branch `main`, clean working tree, and Checkpoint 0's commits (`d87b9b0`,
`a2dd31f`) present before any file was touched.

- **Backend**: `finalizePayrollCycle` (`payroll-processing.service.ts`) — the explicit `DRAFT` →
  `RELEASED` cycle-level transition, gated by `payroll-cycle:manage` (no new permission). No-override
  precondition: rejects unless zero `PayrollEntry` rows have `released = false AND hold = false`
  (empty cycles trivially satisfy this). One transaction: re-checks the precondition, atomically
  flips `status` via `updateMany({ where: { id, status: 'DRAFT' } })` (the concurrency backstop — a
  losing concurrent finalize attempt matches zero rows, reporting a clean `409` rather than a
  double-success or duplicate audit row), sets `releasedAt`/`releasedBy`, writes exactly one
  `payroll_cycle.released` `AuditLog` entry (`cycleId`, `year`, `month`, `entryCount`,
  `releasedCount`, `heldCount`). New route: `POST /api/v1/payroll-cycles/:id/finalize`
  (`payroll-processing.routes.ts`). Never touches `PayrollEntry.released`, never archives, never
  generates a Backup Package, never creates a new cycle, never invokes Advances materialization.
- **Dormant editability conflict fixed**: `payroll-entry.service.ts`'s `assertEntryEditable`
  previously locked an entry once its parent cycle left `DRAFT`, regardless of the entry's own
  `released` state — harmless before this checkpoint (no route could ever set a cycle to non-`DRAFT`)
  but would have wrongly frozen every held/straggler entry the instant Finalize shipped, contradicting
  the finalization precondition's own hold exemption. Corrected to key off `PayrollEntry.released`
  alone. One call site (`payroll-entry-import-export.service.ts`) updated to match the narrowed
  signature. **This first pass turned out incomplete — see "final review corrections" below,
  same day**: that module's own separate whole-cycle-not-Draft upfront check was left untouched at
  the time this bullet was first written, and was itself an equally-dormant instance of the same bug.
- **Frontend**: "Finalize Cycle" action on the Salary Release page (`salary-release-page.tsx`),
  visible only with `payroll-cycle:manage`, enabled only for a Draft cycle, behind a confirmation
  modal stating the invariant, the one-way nature of the action, that held employees are not paid by
  finalization, and that archiving/the next cycle happen later. The page now anchors on the *latest*
  cycle regardless of status (new `useLatestPayrollCycle` hook, `use-payroll-cycles.ts`) instead of
  only the one `DRAFT` cycle (`useCurrentPayrollCycle`, unchanged and still used by Payroll Entry/
  Advances, which genuinely need only the editable cycle) — otherwise the page would fall back to its
  "no Draft cycle" empty state the instant finalization succeeded, unable to show the `RELEASED`
  badge or the disabled per-Unit release row it's supposed to.
- **Tests**: 25 new (`backend/tests/payroll-cycle-finalize.test.ts`) — precondition (blocked/
  succeeds/empty-cycle/no-override), lifecycle state (`releasedAt`/`releasedBy`, entry flags
  untouched, double-finalize, an HTTP-level and a direct-service-level concurrent race), RBAC (Master
  Admin/Payroll Staff/Finance/unauthenticated/missing-or-invalid CSRF), audit (exactly one row,
  correct metadata, atomic with the status update), and six regression cases (held-entry
  editability, released-entry immutability, per-Unit release rejecting a finalized cycle, Advance
  deferral's target-cycle guard, Bank Sheets/Cash Receiving Sheets staying entry-release-driven,
  finalization never silently setting `released = true`). One existing test in
  `payroll-entry.test.ts` ("rejects editing a released entry") was corrected from simulating
  immutability via a direct `cycle.status` database write to the real `released`-driven mechanism,
  since the old simulation no longer reflects the corrected rule.
- **Verification (superseded by the clean-environment re-run below — kept for the record of what was
  actually observed at the time):** `prisma validate` clean; typecheck/lint/build clean across all
  three workspaces; full backend suite run against a **reused, long-lived local Postgres instance
  left over from an earlier, unrelated session** — 405–406/417 across several runs, with the
  `payslips.test.ts` PDF-rendering suite and, once, `payroll-release.test.ts`'s site-scoping test
  failing inconsistently. At the time, this was attributed to the same "reused instance" flakiness
  Checkpoint 0's own session had already documented. **That attribution was incomplete — see the
  clean-environment re-run below**, which found the real cause.

### Phase 5, Checkpoint 1 — clean-environment re-verification, 2026-07-14 (same day, after final review corrections, before commit)

Per the final review's explicit instruction not to describe a 405–406/417 run as passing: terminated
every stale process first (`ps aux` turned up a **Puppeteer/Chrome-for-Testing process tree and an
`embedded-postgres` instance both still running from a completely different, older session** — a
different sandbox scratchpad ID than this session's own, evidently never cleaned up after that
earlier session ended), killed all of them, then provisioned a genuinely fresh, isolated PostgreSQL
18 instance in this session's own scratchpad (`@embedded-postgres/darwin-x64`, `initdb`, `pg_ctl`,
role `payroll`/db `payroll_dev` created directly via the `pg` client library), applied all 13
migrations (`prisma migrate deploy`, clean), and seeded once (`prisma/seed.ts`).

- **Full backend suite, run once against this clean database and clean process state: `npm run test`
  (the project's own established script, not a bare `npx jest`, per `docs/SESSION_HANDOFF.md`'s own
  warning about `NODE_ENV`/rate-limiter drift) — 420/420, all 26 suites green, zero failures,
  including every `payslips.test.ts` PDF-rendering test.** The `payslips.test.ts` failures reported in
  every earlier verification pass this checkpoint (and, in hindsight, very likely Checkpoint 0's own
  "pre-existing, environment-dependent" characterization of the same failures) were **not** a genuine
  environment/dependency limitation — they were caused by that stale, days-old Puppeteer process from
  an unrelated prior session interfering with the PDF-generation path's own Puppeteer usage. Once that
  process was killed and a truly isolated environment was used, the failures did not recur. This
  corrects the record: those failures should not have been described as an inherent baseline
  limitation of this sandbox without first checking for exactly this kind of leftover process — a
  useful lesson for any future verification pass in this environment.
- **Focused regression suite (`payroll-cycle-finalize.test.ts`: 27, `payroll-entry.test.ts`: 14,
  `payroll-entry-import-export.test.ts`: 10, `advances.test.ts`: 13 — 64 total) run three times in
  immediate succession: 64/64, three times, identical results every run.**
- `prisma validate`/migration status clean (still no schema change); typecheck/lint/build clean
  across all three workspaces, re-run against the clean environment.
- **Real production-build HTTP flow, re-verified against the fresh database**: compiled
  `dist/src/server.js`, real login/CSRF/cookies — blocked precondition (400) → hold → finalize (200,
  `RELEASED`, `releasedAt`/`releasedBy` set) → second finalize (400, clean) → held entry still
  editable via single-entity PATCH (200) → held entry still editable via bulk update (200,
  `{matchedCount:1,appliedCount:1}`) — all against the corrected code, confirming the final-review
  fixes work end-to-end, not only under Jest. Test data cleaned up afterward; server stopped.
- **Browser/Playwright verification: re-checked, still not possible in this environment.** No
  `playwright` dependency exists in any of this repository's three `package.json` files (root,
  backend, frontend), no Playwright config or test directory exists anywhere in the repo, and no
  browser-automation tool (Playwright MCP or otherwise) is available in this session's toolset. The
  repository defines no supported browser-verification setup to fall back to, so none was installed,
  per this review's own instruction not to add unrelated tooling. Documented as an outstanding gap,
  carried into `docs/SESSION_HANDOFF.md`'s own next-steps — what *was* verified instead: the frontend
  production build (`vite build`) succeeds cleanly, and Vite's dev-server transform of the modified
  `salary-release-page.tsx`/`use-payroll-cycles.ts` succeeds with no compile/transform errors. Neither
  is a substitute for actually clicking through the page in a real browser.
- **Not committed** — pending review, per this checkpoint's explicit instruction.

### Phase 5, Checkpoint 1 — final review corrections, 2026-07-14 (same day, before commit)

A final review found the first-pass editability fix above corrected `assertEntryEditable` and
therefore every one of its direct callers, but missed two further mutation surfaces that carried
their own **independent, equally-dormant** `cycle.status !== 'DRAFT'` gate — a bug in the same shape,
not routed through `assertEntryEditable` at all.

- **`bulkUpdatePayrollEntries` ("Copy to All", `payroll-entry.service.ts`)** — removed its upfront
  `if (cycle.status !== 'DRAFT') throw badRequest(...)`. No other change: the function already
  filtered its matched set to `!entry.released` before writing, so removing the whole-cycle gate is
  the complete fix — a held, unreleased entry is now reachable by this action after its cycle
  finalizes; a released entry stays permanently skipped, unconditionally.
- **`importPayrollEntries` (CSV/Excel importer, `payroll-entry-import-export.service.ts`)** — removed
  the identical upfront check. Already called `assertEntryEditable` per row, so, again, removing the
  whole-cycle gate is the complete fix.
- **Reviewed and confirmed correctly preserved, not touched**: `createPayrollCycle`'s "only one Draft
  cycle at a time" check (cycle-creation eligibility, not entry editability); `createPayrollEntry`'s
  `cycle.status !== 'DRAFT'` check (the Late Entry boundary — no new `PayrollEntry` may ever be
  created against a finalized cycle, a documented, separate invariant,
  `docs/architecture/workflows/payroll-lifecycle.md §4`); `releaseProjectUnit`'s check (the release
  action's own gate, unrelated to editability — already covered by this checkpoint's own regression
  test, "per-Unit release rejects a finalized cycle"); `finalizePayrollCycle`'s own precondition check
  (finalization's own gate); `deferAdvanceSchedule`'s `conflictingCycle.status !== 'DRAFT'` check
  (the deferral *target* period's cycle — a different cycle from the entry's own, an Advance-specific
  invariant explicitly confirmed to keep, not an editability check on the source entry).
- **Tests**: 2 new regression tests in `backend/tests/payroll-cycle-finalize.test.ts` (a held,
  unreleased entry stays editable via bulk update and via CSV import after a real finalize call;
  a released entry stays permanently skipped through both, in the same two tests) and 1 new
  regression test in `backend/tests/advances.test.ts` (a held, unreleased entry's Advance deduction
  may still be deferred after its own cycle finalizes — no new Advance workflow, `deferAdvanceSchedule`
  itself needed no code change since it already called `assertEntryEditable`). 2 existing tests
  corrected to assert the new, correct behavior instead of the old, incorrect one:
  `payroll-entry.test.ts`'s bulk-update test (previously asserted `400` once the cycle left Draft;
  now asserts `200` for the still-unreleased entry, `released` entry still skipped) and
  `payroll-entry-import-export.test.ts`'s import test (previously asserted the whole import rejected
  outright once the cycle left Draft; now asserts the unreleased entry's row still imports
  successfully).
- **Documentation**: `database/payroll-entry.md §12`'s Immutability note and
  `docs/architecture/workflows/payroll-lifecycle.md §4`'s "Released" state description both extended
  to state explicitly that the rule applies identically across single-entity update/delete, work-line
  add/update/delete, bulk update, CSV/Excel import, and Advance Deduction Deferral — not only the
  single-entry PATCH endpoint the first pass's wording implied.

### Phase 5, Checkpoint 2 — Backup Packages: reusable domain and generator — implemented 2026-07-14, pending review before commit

Preflight confirmed branch `main`, clean working tree, and Checkpoint 1's commits (`cad93bc`,
`6d0acd9`) present before any file was touched. Architecture review approved with six final
decisions (include Payroll Entry XLSX; reuse `payroll-cycle:manage`; synchronous generation;
individual files + manifest; no frontend UI this checkpoint; defer Payslip PDFs/Audit Log export).

- **Schema** (docs/architecture/database/payroll-cycle.md §17-18, migration
  `20260714180000_backup_packages`, additive, no unrelated table touched): `BackupPackageStatus`
  (`GENERATING`/`READY`/`FAILED`), `BackupFileType` (`MANIFEST`/`PAYROLL_ENTRY_CSV`/
  `PAYROLL_ENTRY_XLSX`/`BANK_SHEETS_CSV`/`CASH_RECEIVING_CSV`), `BackupPackage` (unique
  `(cycleId, version)`, indexed `cycleId`/`status`, `generatedBy` FK → `User`), `BackupPackageFile`
  (unique `(backupPackageId, fileType)`). Amended from the originally frozen sketch: `status`/
  `generatedBy`/`failureReason` added to `BackupPackage`; `filename`/`contentType`/`checksum`/
  `sortOrder` added to `BackupPackageFile` — all four additions the architecture review found the
  original sketch missing for authenticated download, in-flight/failed tracking, and actor
  attribution. `prisma migrate diff` used to generate the SQL (shadow-database permission denied for
  the test role, same as every prior migration in this project) — the tool's spurious
  `DROP TABLE "session"` line removed by hand, matching established precedent.
- **Service** (`backend/src/modules/backup-packages/backup-packages.service.ts`):
  `generateBackupPackage` — rejects a Draft cycle; reserves the next version atomically
  (`MAX(version) + 1` inside the row-creation call, the `(cycleId, version)` unique constraint as
  the concurrency backstop, a losing race translated to a clean `409` rather than a raw
  constraint-violation leak); assembles Payroll Entry CSV/XLSX, a new combined Bank Sheets CSV, and
  Cash Receiving CSV purely by calling existing, already-shipped export builders (zero new
  calculation logic); computes SHA-256 checksums; builds `manifest.json` last (needs every other
  file's checksum) via a canonical (recursively key-sorted) JSON serializer so its own checksum is
  deterministic; writes all five storage objects; one final transaction creates the five
  `BackupPackageFile` rows, flips the package to `READY`, and writes the audit entry. Any failure
  after version-reservation best-effort deletes this attempt's own already-written storage objects
  and marks the row `FAILED` with a safe, error-class-only diagnostic (`safeFailureReason` —
  `StorageError` subclasses' own messages are logged directly since they're guaranteed path-free;
  anything else logs only its constructor name, never its raw message/stack/SQL/path). `getApplicationVersion`
  reads `backend/package.json`'s own `version` field (resolved against `process.cwd()`, matching
  `STORAGE_ROOT`/`DATABASE_URL`'s own convention); `getDatabaseSchemaVersion` reads the latest
  `migration_name` from Prisma's own `_prisma_migrations` table directly.
- **Combined Bank Sheets CSV** (`bank-sheets.service.ts`'s new `buildCombinedBankSheetCsv`): loops
  every active `Bank` plus the existing `CASH_BANK_FILTER` sentinel through the module's own,
  unchanged `getBankSheet()`, concatenates rows, reuses the existing `BANK_SHEET_HEADERS`/
  `buildExportRow` (both changed from module-private to exported — the only "refactor" this
  checkpoint needed) and `sumMoney` for one combined grand total. No second query or calculation
  path, per the architecture review's explicit instruction.
- **Routes** (`backend/src/modules/backup-packages/backup-packages.routes.ts`, mounted in
  `app.ts`): `POST`/`GET /api/v1/payroll-cycles/:cycleId/backup-packages` (generate, list) and
  `GET /api/v1/backup-packages/:id` / `GET /api/v1/backup-packages/files/:fileId` (detail,
  download) — all four gated by `payroll-cycle:manage` (reused, no new permission), Master-Admin-
  only. `BigInt` fields (`sizeBytes`/`totalSizeBytes`) are serialized to strings at the HTTP
  boundary only (`res.json()` cannot serialize `BigInt` natively) — the service itself keeps native
  Prisma types. Download resolves the storage key exclusively through the `BackupPackageFile` row's
  own id (a client-supplied raw key is never accepted); a missing storage object behind a `READY`
  row is treated as corrupted state and translated to the same generic `404` a nonexistent id gets,
  logged as an operational anomaly, never a `500` leaking storage internals.
- **Audit**: `backup_package.generated`/`.generation_failed` (metadata: `cycleId`, `version`,
  `fileCount`, `totalSizeBytes`/`failureReason`) and `backup_package.file_downloaded` (metadata:
  `backupPackageId`, `fileType`, `filename`) — list/detail are never audited, matching Bank Sheets/
  Payslips' own "viewing isn't audited, retrieving sensitive content is" precedent.
- **Tests**: 26 new (`backend/tests/backup-packages.test.ts`) — Draft-cycle rejection, successful
  generation, version increment, an HTTP-level and a direct-service-level concurrent-generation race
  (no duplicate version ever committed), deterministic 5-file ordering, manifest/checksum/size
  correctness cross-verified against the actual stored bytes, byte-for-byte reuse-parity checks
  against the live Payroll Entry/Cash Receiving/Bank Sheet export endpoints, storage-key-prefix
  verification, two failure-injection tests (an exporter throwing during assembly — zero storage
  writes; a storage write failing mid-sequence — the already-written files get cleaned up) both
  asserting the package ends up `FAILED` with a safe diagnostic and is never exposed as usable, RBAC
  (Master Admin/Payroll Staff/Finance/unauthenticated/missing-or-invalid CSRF), download
  (`Content-Type`/filename/`Cache-Control`/binary integrity/audit/generic 404), audit-noise
  (list/detail never audited), and schema-level constraint tests (both unique constraints, an
  invalid enum value rejected at the database level). `tests/helpers.ts`'s `cleanTestData` gained
  FK-ordered cleanup for both new tables (`BackupPackageFile` before `BackupPackage`, both before
  `PayrollCycle`/`User`). `.gitignore` gained the test-only storage root
  (`backend/storage-test-unused/` — `backend/tests/env.setup.ts`'s fallback, now a real consumer
  since this checkpoint wires the `StorageProvider` singleton up as `backup-packages.routes.ts`'s
  own dependency); the new test suite's own `afterAll` removes that directory wholesale so no
  generated artifact survives a run.

### Phase 5, Checkpoint 2 — final narrow verification pass, 2026-07-14 (same day, before commit)

A 12-point final verification found and fixed **one real gap**: `backup-packages.routes.ts`'s
`serializeBackupPackage` spread each `BackupPackageFile` row's fields directly into the JSON
response, which included `storageKey` verbatim — list and detail responses were leaking the raw
storage key, contradicting this checkpoint's own explicit requirement that every download resolve
server-side through the file's own `id`, never a client-visible key. **Fixed**: `storageKey` is now
explicitly destructured out and discarded before serialization — the one place any Backup Package
response crosses the HTTP boundary. The service layer itself is unchanged (it still returns the
full Prisma row internally); only the HTTP-facing serializer was corrected.

Six new regression tests added to `backup-packages.test.ts` (32 total, up from 26), each proving a
specific point from the verification checklist rather than re-testing what was already covered:
list/detail responses contain no `storageKey`/absolute-path substring anywhere in their JSON;
individual file download is blocked by the actual runtime status check (not merely the structural
absence of file rows) — verified by forcing a real file's parent package to `GENERATING`/`FAILED`
via direct update and confirming download 404s, then flipping back to `READY` and confirming it
succeeds; a `GENERATING` package remains visible in list/detail with zero files; version 2
generation leaves version 1's database row and every stored file byte-for-byte untouched;
`manifestChecksum` is verified non-circular (the manifest's own parsed content has no
`manifestChecksum`/`checksum` key, the raw manifest text never contains its own stored checksum
value, and re-serializing the parsed manifest canonically reproduces the same bytes); and failure
cleanup for a second (failing) version's own storage writes never touches a *prior, successful*
version's rows or files. The existing failure-audit test was also tightened to assert exactly one
`backup_package.generation_failed` row (not just "at least one"), to check the audit metadata's own
`failureReason` field (not only the DB row's) for the absence of stack-trace frames, absolute paths,
and SQL text, and to confirm zero stray `backup_package.generated` rows exist for the same failed
attempt.

Full backend suite re-run clean: **452/452**, all 27 suites green. `prisma validate`/migration
status/drift check clean (no schema change this pass). typecheck/lint/build clean across all three
workspaces. Storage directories (`backend/storage-test-unused/`, `backend/storage/`) confirmed
absent after every test run performed this pass.

- **Not committed** — pending review, per this checkpoint's explicit instruction.

---

## 2. Remaining work (by phase, per `docs/IMPLEMENTATION_PLAN.md`)

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, RBAC, Audit Log | **Closed, 2026-07-02; DB-backed evidence completed 2026-07-04** — full suite passing against live PostgreSQL (§1's Database verification subsection) |
| 2 | Project Sites, Employee Registry, Settings, User Management | **Closed, 2026-07-02; DB-backed evidence completed 2026-07-04** — same basis as Phase 1 |
| 2.5 | Project Units (new module), Payroll Work Lines prerequisite, Employee Registry refinements | **CLOSED and committed, 2026-07-05.** All five checkpoints (0–4) complete — `e26fe8c` |
| 3 | Payroll Entry & Payroll Processing (`calcNet` over Work Lines, the Payroll Entry grid) | **CLOSED, 2026-07-10.** All seven checkpoints (0–6: schema foundation; cycle bootstrap/creation + backend CRUD; the grid frontend; Split by {unitLabel}; multi-site filter + Copy to All; CSV/Excel import/export; 10,000-employee performance/concurrency validation) are COMPLETE and committed — see §1. Phase 3's own 🛑 review checkpoint has passed |
| 3.5 | Tasks Workspace (new — permanent replacement for the previously-planned Team Collaboration/Chat panel) | **CLOSED, 2026-07-10.** All four checkpoints (0: architecture revision — `0fb296e`; 1: database foundation + shared contracts; 2: backend services/routes/notifications; 3: frontend, prototype, testing — `1220dce`) are COMPLETE and committed — see §1. Phase 3.5's own 🛑 review checkpoint has passed |
| 4 | Release (now per Project Unit), Bank Sheets, Cash Receiving, Advances, Payslips | **All six checkpoints implemented, tested, and committed — CODE-COMPLETE, NOT fully closed.** Checkpoints 1–5 (Bank Registry, Salary Release foundation, Bank Sheets, Cash Receiving Sheets, Advances) CLOSED — `7c2cdb5`, `cedf386`, Checkpoint 3's commit, `477fbb1`, and `75c5e64`; Post-Phase-4 banking/layout refinement — `3b74c32`, `9d9bc32`, `372eeba`; Payslips split into Checkpoint 6.1 (backend foundation), 6.2 (PDF engine), 6.3 (frontend, batch generation, Phase Close-Out) — 6.1/6.2 committed as `093a9df`, 6.3 committed per §1's own entry; see §1. Cash Advances/Advance-only Bank Sheets/Company Bank Account management confirmed out of scope. **Employee Statements confirmed NOT part of this phase's scope (2026-07-11 architecture review, §1) — it was never in Phase 4's frozen scope and remains Phase 7 work.** **Held open by exactly one condition: real Render/Linux-container deployment verification was genuinely attempted and could not be completed in this sandboxed environment (no Docker/Podman/Colima, no Render API token, no git remote) — see §1's "Phase 4 close-out review" and Checkpoint 6.3's own "Mandatory deployment verification" note. Not falsely marked passed.** |
| 5 | Cycle Finalization, Archiving, Backups | **IN PROGRESS.** Architecture review complete (2026-07-14, no redesign required). Checkpoint 0 (`StorageProvider` foundation) CLOSED, committed as `d87b9b0` — see §1. Checkpoint 1 (Finalize Cycle) CLOSED, committed as `cad93bc` — see §1. Checkpoint 2 (Backup Packages reusable domain/generator) IMPLEMENTED 2026-07-14, pending review before commit — see §1. Checkpoints 3–4 (new-cycle-creation transaction upgrade, Payroll Cycle Selector) and phase close-out not yet started — each requires its own explicit go-ahead |
| 6 | Corrections & Balance Adjustments (highest-risk logic) | Architecture frozen alongside Phase 3, 2026-07-05 (`CorrectionRequest`, immediate/deferred, installment recovery). Implementation not started |
| 7 | Statements, Reports, Dashboard | Not started — depends on Phase 6 (Corrections/Balance Adjustments) existing, reaffirmed by the 2026-07-11 architecture review (§1), which also newly recorded that Reports should reuse Statements' ledger-computation code rather than duplicating it |
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
3. **Design assumptions from `database/schema-invariants.md` §26 — items 2 and 4 RESOLVED
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
   **CLOSED 2026-07-14 (Phase 5 Checkpoint 0).** `StorageProvider` interface +
   `LocalFilesystemStorageProvider` implemented — `backend/src/lib/storage/`, see §1's Checkpoint 0
   entry and `docs/architecture/system-conventions.md §2`. Company logo/My Profile avatar upload
   remains unwired through this checkpoint (out of its explicit scope — no route or service imports
   the new `storageProvider` singleton yet); the abstraction those features are blocked on now
   exists and is ready for a future checkpoint to wire up, whenever that work is scheduled.
5. **Employee Registry import template's redundant columns — RESOLVED 2026-07-04 (Phase 2.5
   Checkpoint 3), pending only a client sanity-check.** The finalized mapping: `Area` and
   `Area/Location` are unit-level aliases (both export the employee's `ProjectUnit.name`; on import
   they must agree when both present), `Branch Code` is the employee's `ProjectUnit.code`, and
   `Bank Branch Code` remains the employee's own bank branch code — matching `database/sites-and-units.md` §8's revision note that these columns map onto `ProjectUnit` fields. Worth one confirmation pass
   against the client's real files before the first production bulk import, but no longer an open
   design question.
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
   `database/employee.md` §7 and `database/sites-and-units.md` §8 and `database/relationships.md` §21 text (with an explicit revision note, since that
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
   `database/sites-and-units.md` §8's matching revision note. **The `client`/`Client`-entity
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
    describe Render specifically) and on `docs/architecture/system-conventions.md`'s `StorageProvider`
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
    `database/sites-and-units.md` §8/§8a and `database/employee.md` §9. This directly replaces the flat
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
    - Full spec: `database/payroll-entry.md` §12/§12a.
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
    `database/schema-invariants.md` §26 item 6.
22. **Phase 2.5 amendments — RESOLVED 2026-07-03 (session 2), plan approved with five changes before
    any code was written.** The user approved the Phase 2.5 plan (§ above, items 16–21) on the
    condition of these amendments, now written into `docs/IMPLEMENTATION_PLAN.md`'s Phase 2.5 section
    and `database/employee.md` (§8b, §9), `database/relationships.md` (§21), and
    `database/schema-invariants.md` (§22, §25, §26 item 6):
    - A new **Checkpoint 0 (Foundation)** precedes Project Units: the shared `formatDate()`/parse
      utilities, the `DD-MM-YYYY` display convention, a reusable `DateInput` component, and a reusable
      Site → Unit cascading select — built once, ahead of the checkpoints that all need it, rather than
      duplicated.
    - **Import-time Site/Unit validation is now a three-layer requirement**: import-layer per-row
      check, backend/service-layer assertion, and the database composite FK — the same defense-in-depth
      pattern already used for the Work Line same-site rule (`database/payroll-entry.md §12a`), now explicitly required for the
      Employee import path too.
    - **Employee transfers (site and/or unit change) now write a dedicated `employee.transferred`
      `AuditLog` entry** (old unit, new unit, old site, new site, actor, timestamp) **instead of** the
      generic `employee.updated` entry for that specific edit — not merely a diff buried in a generic
      update's metadata.
    - **CNIC duplicate handling is now a final decision, not a recommendation**: CNIC stays globally
      unique, no duplicate `Employee` rows are ever permitted, and rehires go exclusively through a new
      Reactivate Employee action that preserves the existing row (and its historical `PayrollEntry`
      links) while updating current details. See `database/schema-invariants.md §26` item 6's rewritten resolution.
    - **A new `EmployeeTransferHistory` table** (`database/employee.md §8b`) — lightweight, append-only, one row per transfer
      (from/to site, from/to unit, `effectiveDate`, `transferredByUserId`, optional `reason`, optional
      `remarks`, `createdAt`) — is added alongside the `AuditLog` entry above, mirroring the existing
      `BalanceAdjustment`-vs-`AuditLog` pattern (a generic log plus a purpose-built typed table). No UI
      consumes it in Phase 2.5; it's designed so a Transfer History screen can be built later without a
      schema change.
    Per standing instruction, the CNIC/Reactivate checkpoint's concrete implementation (exact endpoint
    shapes, exact fields touched, exact audit contents) still gets presented for explicit approval
    before that checkpoint's code is written, even though the underlying policy is now final — this is
    a design-review gate, not a re-opening of the decision itself. **Satisfied 2026-07-05**: the
    concrete design (§ Checkpoint 4 subsection, §1) was presented and approved, with one added
    requirement — reactivation and the CNIC lookup must each have exactly one implementation, reused
    by every caller — before Checkpoint 4's code was written.
    **Refined further, same day, before any code was written:** (a) `EmployeeTransferHistory` gained
    `effectiveDate` (the date the transfer actually took effect in the business, distinct from
    `createdAt` — HR may enter a transfer after the fact) and `remarks` (distinct from `reason`), and
    its acting-user column is named `transferredByUserId`; it remains append-only with no
    update/delete path except direct database intervention (an application-layer convention, not a DB
    trigger — see `database/employee.md §8b`'s note on how this differs from `AuditLog`'s stronger guarantee). (b) Checkpoint
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

- **Database verification — CLOSED 2026-07-04.** See §1's "Database verification" subsection: all
  seven migrations (the original six plus `20260704180000_audit_log_allow_fk_actor_set_null`) apply
  cleanly to a completely fresh PostgreSQL 18 database, the full DB-backed suite passes 78/78, the
  composite FK and Audit Log immutability are verified at the raw-SQL level, and a real-stack
  Playwright E2E run passed. The live database is provisioned per session in the sandbox scratchpad
  (embedded-postgres binaries — no Docker/Homebrew needed); it does not survive between sessions,
  but re-provisioning is a two-minute, fully scripted step (`migrate deploy` + seed).
- CI (`.github/workflows/ci.yml`) has never actually run — nothing has been pushed to a remote/PR
  yet. Local live-database verification (above) now covers what CI's Postgres job would have; a
  first real CI run remains worthwhile whenever a remote/PR workflow starts.
- `StorageProvider` does not exist despite being called for in Phase 0 — see §3 item 4. Logo/avatar
  upload UI was deliberately left out of Phase 2's Settings module for this reason.
- `README.md` previously stated "Phase 1 complete" without this verification caveat; corrected in a
  prior session's documentation pass, and kept current at the end of every checkpoint since.
- **Render/Linux-container deployment verification — OUTSTANDING, not resolved as of Phase 4
  Checkpoint 6.3 (2026-07-13).** First flagged under Checkpoint 6.2 (2026-07-12) and genuinely
  re-attempted, not skipped, this session: no Docker/Podman/Colima, no Render API token, and no git
  remote are available in this sandboxed macOS environment, so Chromium's real container launch
  behavior, sandbox flags, and font-fallback rendering have never been confirmed against the actual
  Render deployment target — only locally, against `tsx` and the compiled `dist/` build on macOS.
  This is the single condition keeping Phase 4 from being marked fully closed (§1's "Phase 4
  close-out review," §2's Phase 4 row). Must be closed with a real deploy (or genuine Linux
  container) smoke test — a further local run does not satisfy it.

---

## 5. Exact next action for the next development session

**Updated 2026-07-13 — Phase 4 (all six checkpoints) is implemented, tested, and committed, but is
code-complete rather than fully closed; Phase 5 has not been authorized or started.** See §1's
"Phase 4 close-out review" and §2's Phase 4 row for the exact reason (deployment verification
outstanding).

1. **Re-provision the local database before running DB-backed tests** — it does not survive between
   sessions. Recipe unchanged: `@embedded-postgres/darwin-x64` in the scratchpad, `initdb`, start
   TCP-only, create the `payroll`/`payroll_dev` role/database, `cp backend/.env.example backend/.env`,
   `npx prisma migrate deploy`, seed twice (confirm idempotency), `npm run test --workspace backend`
   (expect **346/346** as of Checkpoint 6.3's close — run via the `npm run test` script, which sets
   `NODE_ENV=test` and `--runInBand`; do not run `npx jest` directly with a sourced `.env`, which
   overrides `NODE_ENV` to `development` and drops the login rate limit from 1000/window to
   10/window, producing spurious 429s).
2. **Close the one outstanding Phase 4 condition: a real Render (or genuine Linux container)
   deployment smoke test.** Genuinely attempted and genuinely blocked in this sandboxed macOS
   session (no Docker/Podman/Colima, no Render API token, no git remote) — see §4's "Render/
   Linux-container deployment verification" entry and Checkpoint 6.3's own note in §1. Once real
   deploy access exists, confirm: production build, Chromium launch under `--no-sandbox`/
   `--disable-setuid-sandbox`, PDF generation (individual and a representative batch), font
   rendering (Times New Roman or its documented fallback), memory stability under a real batch,
   graceful shutdown. Only after this passes should Phase 4 be marked fully closed in §2.
3. **Phase 5 (Cycle Finalization, Archiving, and Backups) IN PROGRESS, authorized 2026-07-14** — the
   architecture review, Checkpoint 0 (`StorageProvider` foundation, committed `d87b9b0`),
   Checkpoint 1 (Finalize Cycle, committed `cad93bc`), and Checkpoint 2 (Backup Packages reusable
   domain/generator, implemented 2026-07-14, pending review before commit) are complete, per this
   project's standing per-checkpoint/per-phase practice; Checkpoints 3–4 and phase close-out each
   still require their own separate, explicit go-ahead, same as every other phase. **Known, documented
   gaps carried forward**: there is no post-finalization release path for a held entry yet (Checkpoint
   1's own approved scope) — see `docs/architecture/workflows/payroll-lifecycle.md §4`'s "Released"
   state description; automatic Backup Package generation on the cycle archive transition, Payslip
   PDFs, and an Audit Log export are all explicitly deferred past Checkpoint 2 — see
   `docs/architecture/workflows/payroll-lifecycle.md §5`. `StorageProvider`
   (§3 item 4; Backup Package generation's hard requirement, deliberately kept out of Phases 2.5–4)
   is now built — `backend/src/lib/storage/`, see §1's Checkpoint 0 entry — designed portable to
   whatever hosting a given customer provides per §3 item 13, not assumed cloud-provider-specific
   (local filesystem only today; no Render-specific API anywhere in it).
4. Confirm the two still-open design assumptions from `database/schema-invariants.md` §26: item 5
   (calendar-month-only cycles, already effectively settled by Phase 3's shipped design) and item 3
   (at-most-one-`ACTIVE`-`Advance`-per-type, already confirmed and enforced by Phase 4 Checkpoint 5)
   — both carried forward here only because §3 has not been swept to mark them formally resolved;
   low priority, no functional ambiguity remains.
5. Decide the two Company Bank Account sub-questions (§3 item 7) — still open, unrelated to
   Payslips, relevant whenever Company Bank Account management is scheduled (not yet part of any
   phase's frozen scope).
