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

**Superseded 2026-07-24 (Payroll Entry Sorting, Deputed Branch & Import Removal checkpoint, §1 below)
— the *import* half of this checkpoint (parsing, template generation, the `/import` and
`/import-template` routes/UI) has since been removed entirely: payroll data must never be imported,
per an explicit product decision. Export (CSV/Excel) is untouched and remains exactly as this
checkpoint shipped it.**

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
  materialization), never a bulk-import side effect. **(Payroll Entry import itself was later removed
  entirely, 2026-07-24 — see §1's Payroll Entry Sorting, Deputed Branch & Import Removal entry — this
  note is preserved only for the historical linkage-design context.)**
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

### Phase 5, Checkpoint 2 — Backup Packages: reusable domain and generator — COMPLETE, 2026-07-14, COMMITTED as `3ea879e`

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

### Phase 5, Checkpoint 3 — Cycle Archiving, Automatic Backup Generation, and New-Cycle Rollover — COMPLETE, 2026-07-15, COMMITTED as `957ab9d`

Read-only architecture review (2026-07-15, no code) approved with six final decisions: dedicated
rollover endpoint (`POST /api/v1/payroll-cycles/:cycleId/archive-and-create-next`), not folded into
cycle creation; the plain `POST /api/v1/payroll-cycles` restricted to bootstrapping the very first
cycle ever; a minimal frontend slice ships this checkpoint; the next period always derives
automatically (no request body, no override); an additive `PayrollCycle.archivedWithBackupPackageId`
FK; no departed-employee visual indicator this checkpoint. Full narrative, transaction ordering, and
schema detail: `docs/IMPLEMENTATION_PLAN.md`'s Phase 5 Checkpoint 3 entry.

**Backend:** `archiveAndCreateNextPayrollCycle` (`payroll-processing.service.ts`) — one PostgreSQL
transaction (preceded by the non-transactional Backup Package reserve/assemble/storage-write):
guarded `RELEASED` → `ARCHIVED` update → commits the fresh Backup Package's `READY` metadata →
creates the next Draft (derived year/month) → resolves the `ScheduledPayrollPeriod` → bootstraps
entries (active employees ∪ departed employees with a due `ACTIVE` Advance) → materializes due
Advances → writes three audit entries. `backup-packages.service.ts`'s `generateBackupPackage`
refactored into four composable phases (`reserveBackupPackageVersion` /
`assembleBackupPackageFiles` / `writeBackupPackageFilesToStorage` / `commitBackupPackageReady`) so
rollover reuses it rather than duplicating the generator — manual generation's own behavior
unchanged. `createPayrollCycle`'s bootstrap body extracted into a shared `bootstrapPayrollEntries`
helper used by both the now-restricted plain route and rollover. Closes
`materializeScheduledAdvanceDeductions`'s own former accepted gap (a departed employee's due Advance
was previously left permanently unmaterialized) — Advances only, direct call, no registry (the
approved boundary; `docs/architecture/workflows/outstanding-obligations.md` corrected — it had
drifted into describing a registry as already-adopted convention ahead of it ever being built, and
into listing `BalanceAdjustment`, which doesn't exist until Phase 6, as "today's" provider).

**Frontend:** "Start New Payroll Cycle" moved to the Salary Release page next to Finalize Cycle,
visible only when `Released`, confirmation modal, busy/duplicate-submit-prevention state matching
Finalize's own pattern. The Payroll Entry page's redundant "New Payroll Cycle" toolbar button was
removed; its empty state now distinguishes "no cycle has ever existed" (still offers the first-cycle
create action) from "a cycle exists but none is Draft" (points to Salary Release).

**Schema:** one additive migration, `20260715142622_payroll_cycle_archived_with_backup_package` —
nullable `PayrollCycle.archivedWithBackupPackageId`, FK → `BackupPackage.id`, `ON DELETE RESTRICT`.

**Tests:** 17 new (`backend/tests/payroll-cycle-rollover.test.ts`) — lifecycle transitions, backup
freshness (a held-entry edit made after Finalize is reflected in the rollover-generated package, not
an earlier manual one), storage-write and mid-transaction failure injection (rollback verified via a
spied `recordAuditLog` throwing after the archive/backup-commit/bootstrap steps already ran),
bootstrap inclusion/exclusion (departed-with-obligation included with zeroed salary fields and
`hold = true`; a paid-off advance excludes its employee from the *following* rollover), audit
metadata, true HTTP-level concurrent-rollover racing (exactly one success), RBAC/CSRF. 3 existing
tests in `payroll-cycle.test.ts` and 1 in `payslips.test.ts` corrected to reach their second cycle via
Finalize + rollover instead of a second plain-route call. Full backend suite: **469/469**.

**Two real defects caught by this checkpoint's own new tests before commit, not shipped:**
(1) the storage-write phase's refactor initially returned a locally-built `writtenKeys` array rather
than mutating a caller-owned one, so a mid-write failure lost the partial list and cleanup silently
deleted nothing — fixed by passing the array in by reference (also affects, and was fixed for, manual
generation's own catch path, though manual generation's own existing test suite didn't happen to
exercise the exact failing sequence that exposes it); (2) a departed-obligation work line was
initially seeded with `cycleDays = 0`, violating the `cycleDays BETWEEN 1 AND 31` check constraint —
`cycleDays` is the cycle's own day-count basis, not attendance, so it takes the ordinary schema
default (30); "no work performed" is expressed via `days` (already zero by default) instead.

Real-stack verification: real PostgreSQL (embedded-postgres, re-provisioned this session), real
filesystem `StorageProvider`, compiled backend, real login/CSRF/cookies — both via `supertest` and, in
a separate final-verification pass, against the compiled server over live HTTP with `curl` (create
first cycle → finalize → edit a held entry → rollover → confirm the Backup Package reflects the edit
→ confirm archive/new-Draft/Advance-materialization → confirm a second rollover attempt and a second
plain-creation attempt both fail). That same final-verification pass strengthened three existing
tests to explicitly assert properties the checkpoint's own review required proving directly rather
than by construction alone: the concurrent-rollover test now also asserts exactly one
`ScheduledPayrollPeriod`, exactly one `PayrollEntry` per employee, and exactly one Advance
materialization; the departed-obligation test now also asserts zeroed `eobiAmount`/`eobiApplicable`,
zero attendance (`days`/`otHours`), a valid `cycleDays` (1–31), and no duplicate entry; the
Backup-Package-freshness test now also asserts the prior version's own row is untouched
(`status`/`updatedAt` unchanged). Full backend suite re-run clean: **469/469**. `prisma validate`/
migration status/typecheck/lint/build clean across all three workspaces, confirmed twice.

- **COMMITTED as `957ab9d`.**

### Phase 5, Checkpoint 4 — Historical Payroll Cycle Selector — COMPLETE, 2026-07-16, COMMITTED as `10e3194`

Read-only architecture review (2026-07-16, no code) approved with four final decisions: Archived
cycles are fully locked for ordinary Payroll Entry editing; historical navigation uses route segments
(`/payroll-cycles/:cycleId/...`); the Payroll Cycle list stays globally visible, actual data stays
server-side permission/site-filtered; historical export filenames include the payroll period. Full
narrative: `docs/IMPLEMENTATION_PLAN.md`'s Phase 5 Checkpoint 4 entry.

**Backend:** `assertEntryEditable` extended to reject once `cycle.status === 'ARCHIVED'` (mirrors its
existing `released` check) across every mutation surface — single-entity update/delete, work-line
add/update/delete, `bulkUpdatePayrollEntries`, `importPayrollEntries`, and `deferAdvanceSchedule`
(inherited with zero code change). `listPayrollCycles` gained a derived `isCurrentDraft` boolean, no
schema change. Bank Sheet, single Payslip PDF, and Payslip batch ZIP filenames now include the
cycle's period slug (Cash Receiving already had this); file contents unchanged.

**Frontend:** five nested routes (`/payroll-cycles/:cycleId/{payroll-entry,release,bank-sheet,
cash-receiving,payslips}`) added alongside the existing flat routes, which now redirect to the
resolved default cycle (newest Draft → newest Released → newest Archived) rather than carrying their
own state; a malformed/nonexistent explicit `cycleId` is never silently redirected. New shared
`useSelectedPayrollCycle` hook and `<PayrollCycleSelectField>`/`<PayrollCycleStatusBadge>` component
pair (`docs/design-system.md §2.6`) replace three independent duplicated ad hoc selectors (Bank Sheet,
Cash Receiving, Payslips). Payroll Entry gained an Archived read-only banner and full read-only
behavior (edit/delete/bulk/import/hold/work-lines all disabled) while keeping filter/export/navigation
live; fixed a dormant bug where its own `isEntryEditable` was stricter than the backend. Salary
Release now supports Draft/Released/Archived cycle views with action visibility gated per state, all
confirm modals close on cycle change, and a successful rollover navigates straight to the new Draft's
Release page. React Query cache keys were not redesigned — the existing `cycleId`-aware keys already
isolated data correctly.

**Tests:** 8 new backend tests (`payroll-cycle-archived-lock.test.ts`) plus filename assertions in
three existing suites. 7 new frontend unit tests (`use-payroll-cycles.test.ts`) — full frontend suite
**21/21** (14 prior + 7 new). typecheck/lint/production builds clean across all three workspaces.

### Phase 5, Checkpoint 4 — security correction (2026-07-16, before commit): `passwordHash` response leak

Approved in principle, but flagged for one fix before commit: a confirmed `passwordHash` leak,
framed by the request as a "Payroll Cycle response" issue. Investigation traced it precisely instead:
`backend/src/modules/users/users.service.ts`'s `listUsers`/`getUser`/`createUser`/`updateUser` all
called Prisma without a `select`, so `GET/POST/PATCH /api/v1/users` and `GET /api/v1/users/:id`
returned the raw `User` row — including `passwordHash` — straight into the JSON response. Not a
Checkpoint 4 regression (these routes predate it, untouched by anything above), found only because
this checkpoint's own final review looked.

**This closes a previously-noticed, deliberately-deferred gap** — Phase 3.5 Checkpoint 2's own record
(§1, above) already flagged in passing that `users.service.ts`'s `listUsers()`/`getUser()` returned
the full row including `passwordHash`, at the time choosing only to make sure the Tasks module itself
didn't repeat the mistake (`assignedTo`/`assignedBy` were built with an explicit `select` from the
start) rather than fixing the Users module itself, which was out of that checkpoint's scope. This
checkpoint is where it's finally fixed.

**Fix:** an explicit `USER_SUMMARY_SELECT` (Prisma `select`, so `passwordHash` is never even fetched
for these read paths) plus a `toUserSummary()` DTO assembly function, returning exactly the shape the
frontend's own `ManagedUser` type already expected (`id`, `name`, `email`, `isActive`, `lastLoginAt`,
`role: { code, name }`, `siteAssignments: [{ siteId, site }]`) — no `passwordHash`, `roleId`,
`avatarStorageKey`, or `themeAccentColor`.

**Narrow review of the directly-related surfaces the request asked for** — `GET/POST
/payroll-cycles`, finalize, rollover, Backup Package list/detail, the Salary Release unit-status
payload — found them **already clean**: `PayrollCycle.createdBy`/`releasedBy`/`archivedBy` are plain
scalar FK strings (no `User` relation is ever included on a Payroll Cycle response); Backup Package
list/detail already strip `storageKey` (`backup-packages.routes.ts`'s `serializeBackupPackage`, a
Checkpoint 2 pre-commit fix); the one place a `User` relation is actually queried
(`payroll-release.service.ts`'s `getUnitReleaseStatus`, `include: { releasedBy: true }`) already
narrows it to `{ id, name }` before returning it. No further leak found in this scope — a genuine
negative finding, not a gap in the review.

**New permanent convention recorded** (none existed before): `docs/architecture/
system-conventions.md §4`, "No HTTP route may return a raw Prisma model or relation object. Every API
response containing users, payroll, financial data, or storage metadata must be assembled through an
explicit DTO."

**Regression tests, 10 new:** 4 in `users.test.ts` (create/list/detail/update responses proven free
of `passwordHash`, plus a database-level check that the stored hash is a real argon2 hash never
echoed back anywhere in the response body); 6 in the new
`backend/tests/payroll-lifecycle-response-security.test.ts` (cycle list/detail, Finalize, rollover,
Backup Package list/detail, and the Salary Release unit-status payload, across Draft/Released/Archived
cycles, plus `isCurrentDraft` correctness) — all using a new shared `assertNoSensitiveKeys()` helper
(`backend/tests/helpers.ts`) that recursively rejects `passwordHash`/`session`/`csrf`/`storageKey`/
`absolutePath` anywhere in a response body, not only at the top level. Full backend suite: **487/487**
(477 prior + 10 new).

**Live-reconfirmed against a freshly compiled server** (real PostgreSQL, real login/CSRF/cookies):
`passwordHash` confirmed absent from every Users route response; the full Checkpoint 4 Archived-lock
matrix (single-entry edit, "Copy to All" bulk update, work-line add, and CSV import — across both a
held-then-archived entry and a genuinely released-then-archived entry, correctly distinguishing the
two different rejection messages by precedence) independently re-verified end-to-end across a fresh
4-cycle Draft→Released→Archived→Draft→...→Archived chain; all five cycle-aware routes resolve;
Finalize/rollover precondition enforcement re-confirmed (finalize rejected on a non-Draft cycle,
rollover rejected on a non-Released cycle); Payroll Staff confirmed to see the full, globally-visible
cycle list while employee/entry data stayed site-scoped; all four export filenames re-confirmed
period-aware and unchanged. Verification data cleaned up afterward; DB confirmed empty before the
final suite re-run.

**One further, non-blocking observation, not fixed (out of the requested narrow scope):** a malformed
(non-UUID) `cycleId` in the URL produces a raw `PrismaClientKnownRequestError` message — including an
absolute filesystem path — in a 500 response body, but **only when `NODE_ENV !== 'production'`**;
`backend/src/common/middleware/error-handler.ts`'s existing, deliberate `isProduction` gate already
masks this to a generic "Something went wrong" in real production. Pre-existing (not introduced by
Checkpoint 4), a minor input-validation gap (a clean 400/404 would be better than a 500) rather than a
live production leak. Left untouched per the explicit "do not turn this into a repository-wide
security refactor" instruction; recorded here so it isn't lost.

**COMMITTED together with the rest of Checkpoint 4, as `10e3194`** — this fix was applied and
verified before that commit, per the same session's own explicit
approval-in-principle-then-fix-then-commit sequencing.

### Phase 5 — final browser verification and close-out (2026-07-16)

**Phase 5 is now COMPLETE AND CLOSED.** The one remaining gap from every prior checkpoint's own
verification pass — genuine browser-based verification, previously unavailable in this sandboxed
environment — was closed this session using a real Playwright-driven Chromium browser (v149.0.7827.55,
already cached locally from a prior session; installed as a scratchpad-only dev dependency, never
added to any workspace's `package.json`).

**Real-stack configuration:** a completely fresh embedded PostgreSQL 18.4 instance (wiped and
re-initialized, all 15 migrations applied, freshly seeded), a freshly compiled backend
(`node dist/src/server.js`), the real production frontend build served via `vite preview` on port
5173 with `VITE_API_URL` pointed at the backend's own origin on port 4000 — the same cross-origin
frontend/backend topology the real Render deployment uses (`vite.config.ts`'s own documented
`server.proxy` is dev-only; production talks to the backend's real URL directly) — a real filesystem
`StorageProvider` (cleared before the run), and real HTTP sessions/cookies/CSRF throughout, no mocked
APIs anywhere.

**Scenarios covered (108 assertions, all passing, across two independent fresh full runs):**
Master Admin login through the real login page and full sidebar navigation; creating 2 Project Sites
(3 Units total) and 3 Employees entirely through the UI; creating the first Payroll Cycle through the
real "Start First Payroll Cycle" UI, confirming the `/payroll-cycles/{id}/...` URL, refresh, and
browser back/forward all behave correctly; Draft Payroll Entry (single-entry edit, hold toggle,
"Copy to All" bulk update, Split-by-Unit work-line interaction including adding a genuine second work
line, Site filtering); Salary Release and Finalize (Unit release, the Finalize precondition genuinely
blocking with an unheld/unreleased entry present, resolving it, Finalize succeeding, Unit-release
actions disappearing, Rollover action appearing); Released-cycle editing behavior (a released entry
provably immutable via disabled fields, the held entry still editable, bulk update on a Released cycle
silently skipping released rows, Import remaining available, Bank Sheet/Cash Receiving/Payslips
showing released-and-non-held data only); Rollover (a due Advance and a departed employee recorded
through the real UI beforehand, a second held-entry edit after Finalize for the fresh-backup check,
the confirmation modal's exact archive/backup/next-month copy verified, duplicate-submission
genuinely blocked at the UI level — proven by a second click throwing a real Playwright timeout
against a disabled button, not merely asserted — exactly one rollover HTTP request sent, the outgoing
cycle Archived, the new cycle Draft at the correct next month, the departed employee's obligation-only
entry present); the Historical Cycle Selector across all five cycle-aware pages (newest-first
ordering, correct labels/badges, URL sync, refresh persistence, back/forward restoration, a
well-formed-but-nonexistent cycle id and a malformed cycle id both correctly *not* silently
redirected, a stale confirmation modal closing on cycle switch, Payslip batch selection resetting on
cycle change, no prior-cycle data persisting after a switch); the Archived-cycle lock (the read-only
banner, every mutating control disabled or hidden, a direct mutation attempt fired through the
browser's own authenticated session via `page.request` rejected server-side, filtering/navigation/
export all still functional); historical reports and filenames for the Archived cycle (Bank Sheet and
Cash Receiving rendering correct historical data, Payslip preview and single/batch download all
working, every downloaded filename confirmed period-aware — `bank-sheet-cash-2032-01.csv`,
`cash-receiving-sheet-2032-01.csv`, `payslip-{employee}-2032-01.pdf`, `payslips-2032-01.zip` — and
downloaded content confirmed to belong to the selected historical cycle); role and site-scoping (a
Payroll Staff user and a Finance user both created and logged in through the real UI, Payroll Staff
confirmed to see the full global cycle list while its Payroll Entry/network access stayed strictly
site-scoped to Alpha with a direct cross-scope API attempt rejected 403, Finance confirmed to see
Salary Release/Bank Sheet/Cash Receiving/Payslips but not Payroll Entry, with a direct write attempt
and an Advances access attempt both rejected 403); Backup integrity (the rollover-created Backup
Package confirmed `READY`, `archivedWithBackupPackageId` confirmed pointing at that exact package, the
package's own CSV confirmed to contain the held-entry's post-Finalize edit, the archived cycle
confirmed stable afterward, no `storageKey` or filesystem path found in any browser-facing API
response).

**Console/network result: zero unexpected errors.** Every entry captured across both full runs was one
of three already-understood, non-defect categories, identified separately per the review's own
instruction: (1) the ordinary pre-login `401` each fresh session's initial `useSession()` probe
produces, before login — three occurrences, one per browser context (Master Admin, Payroll Staff,
Finance); (2) `net::ERR_ABORTED` fetch cancellations produced by React Query's own abort-on-unmount
behavior when the automated script navigates faster than a human ever would — a byproduct of
automation speed, not a defect, and not reproducible under ordinary interactive use; (3) the two
already-known, already-documented (Checkpoint 4's own security-correction entry above) non-blocking
`500`s from deliberately visiting a malformed `cycleId` URL as part of the "does not silently
redirect" negative test, masked in real production by the existing `isProduction` error-handler gate.
No genuine, previously-unknown defect was found anywhere in the walkthrough — the working tree needed
zero code changes as a result of this verification pass.

**Automated regression, re-run after the full walkthrough:** `prisma validate` clean; `prisma migrate
status` — still 15 migrations, zero drift (this verification pass added no schema change); `typecheck`/
`lint` clean across all three workspaces (same 4 pre-existing `react-refresh` warnings only);
production builds clean across all three workspaces; backend suite **487/487** (unchanged baseline —
no new test file was added to the repository, since a Playwright browser suite was intentionally kept
out of the committed workspace per this task's own scope, run instead as scratchpad-only tooling);
frontend suite **21/21** (unchanged baseline).

**Cleanup confirmed:** every scratchpad Playwright script, its `node_modules`, and its temporary
downloads were deleted after the run; the verification database (all Sites/Units/Employees/Cycles/
Users created during the walkthrough) was wiped by re-provisioning a genuinely fresh PostgreSQL
instance rather than attempting a partial row-level cleanup; `backend/storage/` was cleared; both the
compiled backend and `vite preview` processes were stopped; the frontend production build was
re-generated once more without the temporary `VITE_API_URL` override, restoring the exact default
build (`index-EtUPl6NR.js`, matching the hash from before this verification pass began). `git status`
confirmed a clean working tree throughout — no browser artifacts, downloads, traces, or generated test
files were ever staged.

**Phase 4's own outstanding Render/Linux-container Chromium deployment smoke test was NOT performed
this session** (no Docker/Podman/Colima, no Render API access, no git remote, the same constraint
every prior session has hit) — it remains open, explicitly kept separate from Phase 5's own closure,
not conflated with the Playwright-in-this-sandbox verification just completed above, which used a
locally-cached Chromium binary and proves nothing about the actual Render/Linux container runtime.

---

### Post-Phase-5 Stabilization Checkpoint 1 — audit-approved fixes — COMPLETE, 2026-07-16, COMMITTED as `638f45c`

Phase 6 has **not** started. A separate, independent, review-only audit session (no code changes)
produced a prioritized findings report against the closed Phase 0–5 state; the user then explicitly
authorized implementing five specific findings from that report — **AUD-001, AUD-002, AUD-003,
AUD-004, AUD-005** — and only those five. AUD-006 through AUD-013 (emoji/prototype-scroll drift,
contrast, session revocation on password reset, table-density/control-height consistency, orphaned
`GENERATING` Backup Package rows, bundle code-splitting, stale test-count docs) were explicitly
withheld from this checkpoint and remain unimplemented, exactly as scoped.

**AUD-001 — backend production start script fixed.** Root cause: `backend/tsconfig.build.json`
inherited `rootDir: "."` from `tsconfig.json` and did not exclude `prisma/seed.ts`, so `tsc` treated
the whole `backend/` directory (not `src/`) as the compilation root, nesting build output under
`dist/src/server.js` while `package.json`'s `start`/`main` fields (and `render.yaml`'s
`startCommand: npm run start`) both expect `dist/server.js`. Fixed by giving
`tsconfig.build.json` its own `rootDir: "src"` and excluding `prisma` from the build (the seed
script already runs via `tsx prisma/seed.ts` directly — it was never meant to be compiled into
`dist/` at all). No change was needed to `package.json`, `render.yaml`, or the seed script itself —
this was a build-config-only fix. Verified: a clean `rm -rf dist && npm run build` now produces
`dist/server.js` (not `dist/src/server.js`); `npm run build && npm run start` (from the backend
workspace, exactly as `render.yaml` invokes it) boots and answers `GET /health` with `200`.

**AUD-002 — CSV/spreadsheet-formula-injection sanitizer.** A single shared function,
`sanitizeCsvCell`/`stringifyCsvSafe` in `backend/src/common/import-export.ts`, now sits in front of
every CSV export in the codebase — Employee Registry (`employees-import-export.service.ts`), Payroll
Entry (`payroll-entry-import-export.service.ts`), Bank Sheet (`bank-sheets.service.ts`, both its
per-bank export and its combined Backup Package export), and Cash Receiving
(`cash-receiving.service.ts`) — replacing every direct `csv-stringify` call across those four
modules. A cell whose content opens with `=`, `+`, `-`, `@`, tab, or CR gets a neutralizing leading
apostrophe *unless* it parses as a genuine number (so a legitimate negative monetary figure is never
corrupted into text) — the standard OWASP mitigation. XLSX exports are unaffected by design (ExcelJS
writes typed cells, not a line of text a spreadsheet re-parses). Regression coverage:
`backend/tests/csv-formula-injection.test.ts` (13 unit tests against `sanitizeCsvCell`/
`stringifyCsvSafe` directly — trigger characters, legitimate negative numbers, non-string passthrough,
row-level integration) plus one new end-to-end test appended to
`backend/tests/employees-import-export.test.ts` proving the live `GET /api/v1/employees/export`
route neutralizes a malicious employee name, not just the isolated function.

**AUD-003 — malformed UUID route params now return 400, not 500.** Every id column in this schema is
`@db.Uuid` (`backend/prisma/schema.prisma`), so a non-UUID route param never reaches business logic —
it fails at the Postgres driver itself ("invalid input syntax for type uuid"), which Prisma surfaces
as `P2023`. Before this fix that fell through `error-handler.ts`'s generic 500 branch, returning
`INTERNAL_ERROR` and, outside production, the raw Prisma error message (including absolute
filesystem paths). Fixed once, at the shared framework level: `error-handler.ts` now maps `P2023` to
`400 VALIDATION_ERROR`, alongside its existing `P2002`/`P2003` handling — no per-route UUID-shape
validation was added or duplicated anywhere. Regression coverage:
`backend/tests/malformed-uuid-handling.test.ts` — five representative routes across five unrelated
modules (Employees, Project Sites, Users, Payroll Cycles, Backup Packages) each asserted to return
`400`/`VALIDATION_ERROR`, plus one assertion that no raw Prisma error text or filesystem path ever
reaches the response body.

**AUD-004 — Payslips filter row alignment fixed, at the shared-component level.** Root cause: the
Unit filter (only) was wrapped in an extra page-local `flex-col` div carrying an always-rendered
helper line ("Select one Site to filter by Unit") beneath the control — since the whole filter row is
`flex items-end`, that taller wrapper pushed every other control in the row down to match its bottom
edge, leaving Unit's own control sitting ~19px higher than Cycle/Site/Search. Fixed by extending the
existing shared `MultiSelectFilter` component (`frontend/src/components/ui/multi-select-filter.tsx`)
with optional `disabled`/`disabledReason` props — disabling the trigger occupies zero extra layout
height, communicates the same information via a native `title` tooltip plus an
`aria-describedby`-linked `sr-only` paragraph (screen-reader accessible, never a visible line that
changes the field's height), and `payslips-page.tsx`'s Unit filter was flattened to the exact same
call shape every other filter on that row already used (matching Site's own pattern) — no
page-specific markup remains. Browser-verified: all four controls (Cycle/Site/Unit/Search) now
render at an identical `top` offset, both before and after selecting a Site; the disabled Unit
trigger's `title` and `aria-describedby` were confirmed present and correctly linked to the hint text.

**AUD-005 — the missing Phase 5 living HTML prototype was created.**
`docs/prototypes/phase5-payroll-lifecycle-preview.html`, following the exact shell/CSS convention
every prior phase's prototype already established (reused verbatim from
`phase4-salary-release-preview.html`, not reinvented). Eight tabs, each traced to the real
implementation: Draft cycle Salary Release (Finalize button), the Finalize confirmation modal
(exact copy from `FinalizeConfirmModal`), Released cycle Salary Release (Rollover button replacing
Finalize), the Rollover confirmation modal (exact copy from `RolloverConfirmModal`, including the
Backup Package line), Archived-cycle Salary Release and Archived-cycle Payroll Entry (both showing
the real `ArchivedReadOnlyBanner`/read-only-summary copy verbatim), the Historical Cycle Selector
(the shared `PayrollCycleStatusBadge`/`PayrollCycleSelectField` pieces, the dual flat/canonical URL
scheme, and the Draft → newest Released → newest Archived → empty default-resolution order, all as
actually implemented in `App.tsx`/`use-selected-payroll-cycle.ts`), and a Backup Package lifecycle
tab that deliberately states — rather than invents — that no dedicated Backup Package browsing/
download UI exists yet, only the automatic generation-on-rollover path and the tested backend API.
Per the explicit instruction not to invent interfaces that don't exist, AUD-006 (removing prototype
emoji) was left untouched here even though this new file follows the same emoji-nav convention every
other existing prototype uses. Verified with a headless-browser pass over all 8 tabs: each renders
its own screen with zero console/page errors.

**Full verification performed after all five fixes, together:** `prisma validate` clean; `prisma
migrate status` — still 15 migrations, zero drift (`prisma migrate diff` against the schema:
"No difference detected" — this checkpoint touched no Prisma model); backend suite **507/507**
(487 pre-existing + 20 new: 13 in `csv-formula-injection.test.ts`, 6 in
`malformed-uuid-handling.test.ts`, 1 appended to `employees-import-export.test.ts`); frontend suite
**21/21** (unchanged); `typecheck` clean across all three workspaces; `lint` clean (the same 4
pre-existing `react-refresh` warnings only, in files this checkpoint did not touch); production
builds clean across all three workspaces; `npm run build && npm run start` verified booting and
answering `/health` with `200` (AUD-001's own direct verification). The local database was
re-provisioned to a genuinely clean, freshly migrated-and-seeded state both before this checkpoint's
baseline test run and is left in that same clean state afterward, matching this project's standing
per-session convention — it does not persist between sessions.

---

### Post-Phase-5 Stabilization Checkpoint 2 — UI consistency, accessibility, prototype reconciliation — COMPLETE, 2026-07-16, COMMITTED as `d1c543e`

Phase 6 has **not** started. Continuing the same audit-approved, checkpointed remediation as
Checkpoint 1 (`638f45c`/`a139931`), this checkpoint implements exactly **AUD-006, AUD-007, AUD-008,
AUD-010**, plus a complete reconciliation of every living HTML prototype against the shared rules
those four findings establish. AUD-009 (session revocation on password reset), AUD-011 (stale
`GENERATING` Backup Package recovery), AUD-012 (route-level code splitting), and AUD-013 (committed
E2E harness / doc cleanup) remain explicitly out of scope, each its own future checkpoint.

**Design tokens formalized (`frontend/src/index.css`, `docs/design-system.md` new §1.5):**
`--control-height` (36px)/`--control-height-sm` (32px), `--table-row-height-standard` (48px)/
`--table-row-height-compact` (40px)/`--table-header-height`, `--filter-field-gap`/`--filter-row-gap`,
plus the two AUD-008 contrast tokens below. Row height stays content-driven (cell padding, never a
forced `height` on a `<tr>`/`<td>`) — the pixel values are the documented *result*, not an enforced
box constraint.

**AUD-008 — accessibility contrast.** `--color-text-faint` was `#9c978f` (2.90:1 against
`surface-2`/white, 2.49:1 against `bg` — both fail WCAG AA's 4.5:1 for normal-size text); now
`#6f6b66` (5.29:1 / 4.53:1, both pass), chosen to stay visually lighter than `--color-text-muted`
(already-passing, untouched) rather than converge on it. The sidebar's nav-section-label color was
inline `text-white/35` (≈2.48:1 against `--accent`); now a named token, `--sidebar-section-label:
rgba(255,255,255,0.65)` (4.71:1). `--color-text-muted` and every other already-passing color token
were deliberately left untouched, per this checkpoint's own "do not indiscriminately darken all
muted text" instruction. Verified both by direct contrast-ratio calculation and by measuring the
live-rendered `text-faint` token in a real browser (5.29/4.53, matching the calculation exactly).

**AUD-010 — control-size and table-density consistency.**
- *Filter-row button sizing*: nine `size="sm"` (32px) action buttons that shared an `items-end`
  filter row with 36px inputs/selects were changed to the default 36px size —
  `payroll-entry-page.tsx` (Export CSV/Excel, Import), `bank-sheet-page.tsx` and
  `cash-receiving-page.tsx` (Export CSV/Excel each), `advances-page.tsx` (Record Advance),
  `payslips-page.tsx` (Download selected Payslips, and its Cancel-batch replacement state). Buttons
  standing alone in a `CardHeader` title row with no adjacent 36px control (Employees'/Users'/
  Project Sites' own "New X" buttons, Salary Release's Finalize/Rollover, every table-row action)
  were deliberately left at `size="sm"` — the fix is a deliberate per-context choice, not a blanket
  resize.
- *`FilterField`* (`frontend/src/components/ui/filter-field.tsx`, new) — the shared label+control
  shell `MultiSelectFilter` already used (`Label` component, `gap-1.5`), now also used by
  `PayrollCycleSelectField` and every page-level filter that previously hand-rolled a slightly
  different shell (a raw `<label>` at `text-[10px]`/`gap-1`, one pixel-scale smaller than `Label`'s
  `text-[11px]`/`gap-1.5` — a real, if small, per-field drift that compounds across a row).
  Salary Release's Site `<select>` also gained a proper visible "Site" label (previously
  `aria-label`-only, the one filter-row control in the app with no visible label at all).
- *Shared table-density system* (`frontend/src/components/ui/table.tsx`) — `<Table
  density="standard"|"compact">` (default `standard`), propagated via context to `TableHead`/
  `TableCell` so density isn't repeated per cell. `tableHeadPaddingClass`/`tableCellPaddingClass`
  (exported, pure functions) are the deterministic density → padding mapping, unit-tested directly
  (`table-density.test.ts`) rather than via component rendering — this project's own established
  convention (`vitest.config.ts`: "deterministic logic... unit tested", no jsdom/DOM-rendering
  tests; an initial attempt at `@testing-library/react`-based component tests was reverted for
  exactly this reason). `density="compact"` applied explicitly to Bank Sheet and Cash Receiving;
  every other table (Employees, Users, Project Sites, Advances, Payslips, Salary Release, Settings →
  Banks) uses the `standard` default. Every `TableCell` now carries `align-middle`, vertically
  centering whatever control it holds (Badge, Checkbox, Button) regardless of density. Generic
  table-loading `<Skeleton>` placeholders (previously a uniform `h-8` everywhere) were resized to
  `h-12`/`h-10` to match their page's own density, so the loading state doesn't visually jump once
  real rows arrive.
- Live-browser-measured results: Employees/standard rows ≈49px, Advances/standard ≈56px (a wider
  row — two inline actions plus a badge — still clearly the "standard" tier), Bank Sheet/compact
  ≈33px — a clear two-tier distinction confirmed in a real browser, not just unit-tested class names.

**AUD-006/Part 4 — shared Checkbox and icon cleanup.** New `frontend/src/components/ui/checkbox.tsx`,
built on `@radix-ui/react-checkbox` (matching this codebase's existing Radix-primitive convention —
Dialog, DropdownMenu, Label, Avatar), supporting `checked={true|false|'indeterminate'}` and
`disabled`. Replaces every native `<input type="checkbox">` in the live app: Employee Registry's
"Active employees only" filter (also given a `flex h-9 items-center` wrapper so the 16px checkbox
sits vertically centered against its 36px filter-row siblings, not merely bottom-flush with their
taller label+control columns) and its EOBI-applicable form field, Users' site-assignment checklist
and Active toggle, and Payslips' select-all (now genuinely `aria-checked="mixed"` via Radix's own
indeterminate support, not a manual DOM `.indeterminate` ref hack) and per-row selection checkboxes.
The one remaining decorative Unicode glyph found in the live app — a text `✕` line-remove button in
`split-work-lines-modal.tsx` — was replaced with the same Lucide `X` icon and `aria-hidden`
convention the shared `Modal`'s own close button already uses. A full-codebase scan found no other
emoji or decorative pictographs in the live React app (confirmed both before and after this
checkpoint's changes).

**AUD-007 + full prototype reconciliation — every file under `docs/prototypes/` (13 files).** Root
cause of the reported sidebar-gap defect, found by direct DOM/CSS inspection rather than
speculation: every prototype's trailing `<footer class="note">` sat *outside* the `.screen`/
`.app-shell` structure, in normal document flow — making the whole HTML document taller than the
viewport and genuinely scrollable, at which point the sidebar's `position: fixed` visually detaches
once a reader scrolls into the footer (the fixed sidebar doesn't move, but everything shell-shaped
around it does, leaving a bare, sidebar-less footer view — exactly the reported symptom). Fixed,
identically, in all 13 files:
- `html, body { height: 100%; overflow: hidden }` — the document itself can now never scroll, a hard
  guarantee rather than a per-screen sizing hope.
- `.screen.is-active { height: calc(100vh - 37px); overflow: hidden }` — every screen is now
  self-contained to exactly the space below the meta-banner.
- Every file's trailing footer content was moved into a new, dedicated `#screen-notes` section (a
  simple centered, internally-scrolling pane, no sidebar needed) with its own "Implementation notes"
  tab — reachable, never simultaneously on-screen with a live-shell mockup, so it can never push the
  document taller.
- A real, reproduced (not merely theoretical) second defect found during this same investigation:
  `phase3.5-tasks-workspace-preview.html`'s own `.tasks-panel` (`position: fixed`, `z-index: 60`)
  intercepted clicks meant for the preview's own tab navigation whenever that screen was active —
  `.meta-banner` (every file) now carries `position: relative; z-index: 100`, so the preview's own
  chrome always wins regardless of what a mocked-up screen's own fixed-position panel/modal is
  doing. Verified fixed by testing the exact previously-failing click against both the original file
  (reproduced: `TimeoutError`) and the patched one (succeeds, no `force: true` needed).
- Modal centering: four files (`phase2-employee-registry`, `phase2-project-sites`,
  `phase3-payroll-entry`, `phase4-bank-registry`) used a `.modal-standalone-wrap { display: flex;
  justify-content: center }` pattern that — lacking `width: 100%` — sized itself to its own content
  (the modal) as a flex child of `.app-shell`, so `justify-content: center` centered it within a box
  exactly as wide as itself, leaving every such modal pinned to the left edge
  (`hCenterOffset` as far as -432px, measured). Fixed by adding `width: 100%` (`hCenterOffset: 0` on
  every modal in every file, re-verified).
- Icons: every emoji glyph across all 13 files (✕ ⬇ 💵 📋 🏦 🏢 📄 👛 🤝 👁 👤 🧑‍💼 🔒 ✓ — 100 total
  occurrences) replaced with an inline monochrome SVG using the *actual* Lucide path data for the
  matching real-app icon (X, Download, Upload, Banknote, Landmark, Wallet, HandCoins, FileText,
  Users, Building2, UserCog, Bell, Eye, Lock, ClipboardList, Check) — no external request, no build
  step, `stroke="currentColor"` so it inherits the surrounding text color.
- Control heights: every `.btn`/`.btn-sm`/`select` declaration corrected from the prototypes' own
  historical 34px/30px guesses to the real app's actual 36px/32px tokens (several compound
  selectors — `select, input[type="text"] { height: 34px }`, `.filter-select-btn { height: 34px }`
  — needed a second, targeted pass beyond the first mechanical regex sweep, since prototype markup
  wasn't consistent about selector shape file-to-file).
- Table density: `table.data-table td/th` padding split the same standard/compact way as the live
  `<Table>` component — `16px 14px`/`12px 14px` (standard) vs `12px 14px`/`10px 14px` (compact,
  Bank Sheets/Cash Receiving) — replacing one uniform `10px 14px` used everywhere before.
- Contrast: the same `--color-text-faint`/sidebar-section-label token corrections applied to every
  prototype's own copied `:root`/`.nav-section-label` values (prototypes have no build step to read
  `index.css`'s variables through, so the literal values needed the identical edit made 13 times).
- Obsolete behavior corrected, not merely left stale: `phase3-payroll-entry-preview.html`'s
  standalone "+ New Payroll Cycle" button/modal (a manual create-any-cycle-any-time action) was
  **removed** — Phase 5 retired that action entirely; cycle creation is now only the one-time
  "Start First Payroll Cycle" bootstrap or the Rollover action, never a free-standing button on this
  page. The Implementation Notes tab was updated to record the retirement and point to
  `phase5-payroll-lifecycle-preview.html` for the current lifecycle. `phase4-salary-release-
  preview.html` (Phase 4 Checkpoint 2's own frozen scope, still entirely accurate) gained a
  cross-reference note that Finalize/Rollover/Archived/the Historical Cycle Selector were built on
  top of it by Phase 5 and are shown in that later prototype instead. The already-existing Payslips
  Unit-filter helper-text-beneath-control drift (the prototype had copied the exact bug Checkpoint 1
  fixed in the live app) was corrected identically: helper text removed, the Unit `<select>` marked
  `disabled` with a `title` tooltip.

**Full verification performed:** headless-Chromium pass over all 13 prototype files × every one of
their own tabs (zero console/page errors, zero click failures, `window.scrollY === 0` and no visible
overflow on every screen) — repeated after each fix; a second, dedicated modal-centering pass (all
`hCenterOffset: 0`); a responsive sweep at 1280×720/1366×768/1440×900/1920×1080 across all 13 files
(zero horizontal-overflow/scroll-lock violations — 52 file×viewport combinations). Live-app
verification (fresh production build, real backend + Postgres, real browser, demo data seeded
through the live API): sidebar-label contrast, filter-row control heights/alignment across
Payroll Entry/Bank Sheet/Cash Receiving/Advances/Payslips/Employees (every control 36px, same `top`
offset within its row), table row heights confirming the standard/compact split, the Employees
Checkbox toggling correctly on a real click, Payslips' select-all/per-row Checkboxes rendering with
correct `aria-checked`/`aria-label`, no `✕` glyph anywhere on a live Payroll Entry page, and a
responsive sweep at all four required viewports across Dashboard/Employees/Advances/Users (zero
overflow, zero unexpected scroll). Automated: backend suite **507/507** (unchanged — this checkpoint
touched no backend code); frontend suite **23/23** (21 pre-existing + 2 new,
`table-density.test.ts`); `typecheck`/`lint` clean across all three workspaces (same 4 pre-existing
`react-refresh` warnings, plus 2 new instances of the identical category in `table.tsx` — it now
exports plain functions alongside components, the same pattern already accepted in `badge.tsx`/
`button.tsx`); `prisma validate`/`migrate status`/`migrate diff` all clean, zero drift (no schema
touched); production builds clean across all three workspaces.

### Post-Phase-5 Stabilization Checkpoint 3 — authentication hardening, backup lifecycle reliability — COMPLETE, 2026-07-17, COMMITTED as `3102c74`

Repository preflight confirmed before any code change: branch `main`, working tree clean, latest
commits `d1c543e`/`2d4e167` (Checkpoint 2) present, baseline **507/507** backend / **23/23** frontend
/ 15 migrations / zero schema drift all reconfirmed against a freshly-provisioned local Postgres
(`embedded-postgres`, per this project's own no-Docker-in-sandbox convention), Phase 6 not started.
Per the explicit instruction, implements exactly **AUD-009** (session revocation after password
reset) and **AUD-011** (recovery for stale `GENERATING` Backup Packages) — not AUD-012 (route-level
code splitting) or AUD-013 (permanent Playwright/E2E harness), both still deliberately deferred.

**AUD-009 — session revocation on password change/reset.** Both password-change paths — self-service
`POST /auth/change-password` and Master Admin's `POST /users/:id/reset-password` — now invalidate
every existing session for the affected user immediately, including the requesting session itself.
No schema change: the existing `BackupPackage`-adjacent pattern of "look up fresh, never cache"
already meant no session-versioning column was needed — instead, a new
`invalidateAllSessionsForUser` (`backend/src/lib/session-store.ts`) deletes every row in the
connect-pg-simple-owned `session` table whose JSON payload's `userId` matches, via one raw SQL
`DELETE`. The next request on any now-deleted session fails auth immediately (the same "next request
fails" guarantee already proven for deactivation). Both route handlers additionally call
`req.session.destroy()` on the current request's own session when it belongs to the affected user
(always true for self-service change; conditionally true for admin reset, only in the self-reset
edge case) — mirroring `/auth/logout` — so that request's own response reflects the invalidation
immediately and clears the `connect.sid` cookie, rather than only failing on that session's next use.
An admin resetting someone *else's* password keeps their own session, unaffected. See
`docs/architecture/authentication.md`'s "Session revocation on password change" note.

**AUD-011 — recovery for stale `GENERATING` Backup Packages.** Generation is fully synchronous
within one request/process's own lifetime (Phase 5's own architecture), so a row still `GENERATING`
long after its own `updatedAt` can only mean the process that reserved it crashed or was restarted
mid-attempt, before `failBackupPackageGeneration`'s own catch block ever ran. A new
`recoverStaleGeneratingBackupPackages` (`backend/src/modules/backup-packages/
backup-packages.service.ts`) sweeps for exactly this — any `GENERATING` row older than 15 minutes
(`STALE_GENERATING_THRESHOLD_MS`, comfortably beyond the commit transaction's own 30-second timeout
and any realistic large-payroll export time) is transitioned to `FAILED`, reusing a new shared
`markBackupPackageFailed` primitive that both this sweep and the existing live-failure path
(`failBackupPackageGeneration`, refactored to call it) now share — no duplicated update+audit code.
The recovery audit entries use a distinct, system-attributed (`actorUserId: null`) action,
`backup_package.generation_recovered`, so a reviewer can tell a caught exception apart from a
later-discovered abandoned row. Called at two lifecycle points, never a background worker/queue/
scheduler: process startup (`server.ts`, before the server accepts traffic — confirmed by the
real-stack restart test below) and the top of `reserveBackupPackageVersion` itself (before every new
reservation — covering both manual generation and rollover, since both call that one shared
primitive). A `READY` or already-`FAILED` row is never selected (idempotent, no version history ever
revisited). See `docs/architecture/database/payroll-cycle.md §17`'s new subsection.

**Tests added:** `backend/tests/auth.test.ts` (self-service change-password: current session, a
second independent session for the same user, and an unrelated user's session, plus old/new-password
login and unchanged audit behavior); `backend/tests/users.test.ts` (admin-triggered reset: target's
sessions invalidated including a second browser session, acting admin's own session untouched unless
self-targeting, old/new-password login, unchanged audit behavior); `backend/tests/
backup-packages.test.ts` (a new `AUD-011: stale GENERATING recovery` block — stale-past-threshold
recovery + idempotent repeat calls, a fresh/within-threshold `GENERATING` row left untouched, `READY`/
already-`FAILED` rows never revisited, recovery-before-generation preserving correct version
numbering end-to-end through the real HTTP route, and a failure-injection case proving a defensive
DB-update failure during recovery is logged, not thrown).

**Verification performed:** `prisma validate` clean; `prisma migrate status` — 15 migrations, up to
date, zero drift (no schema change was needed for either finding); backend suite **516/516** (507
baseline + 9 new); frontend suite **23/23** (unchanged — no frontend code touched); `typecheck`/
`lint` clean across backend and frontend; production builds clean for both workspaces.

**Real-stack verification (real Postgres, real running backend + frontend dev servers, real
Chromium via Puppeteer, not mocked).** Authentication: two independent, isolated browser contexts
("browser sessions") both logged in as the same user; a real UI password change (Settings → My
Profile) via one context; confirmed both the changing session and the second, untouched browser
context lost authorization immediately (no restart); confirmed login with the old password then
failed and login with the new password succeeded; the seeded account's password was restored
afterward for a clean environment. Backup recovery: a real `READY` Backup Package was generated
end-to-end through the live API for a real payroll cycle; a second, `GENERATING` row was inserted
directly (simulating an in-flight generation) and backdated 20 minutes; the real backend process was
then killed (`SIGKILL`, both the `tsx watch` supervisor and its child) to genuinely simulate a crash
and restarted fresh — the startup log recorded `Recovered stale GENERATING Backup Package(s)
abandoned by a previous process` naming exactly that row's id, confirmed in Postgres as `FAILED`
with a `backup_package.generation_recovered` audit entry, while the pre-existing `READY` version was
byte-for-byte untouched; a further generation immediately after restart succeeded normally,
correctly reserving the next version (not reusing the recovered one). Leftover fixture data created
by this manual pass (a non-`Test`-prefixed site/employees, outside the automated suite's own cleanup
scope) was identified and removed afterward, and the full suite re-run to confirm **516/516** with a
clean database.

### Post-Phase-5 Stabilization Checkpoint 4 — frontend performance, permanent E2E harness — COMPLETE, 2026-07-18, COMMITTED as `4764afb`

Repository preflight confirmed: branch `main`, working tree clean, commits `3102c74`/`31e688f`
(Checkpoint 3) present, baseline **516/516** backend / **23/23** frontend / 15 migrations / zero
schema drift reconfirmed, Phase 6 not started. Implements the final two approved stabilization
findings: **AUD-012** (route-level frontend code splitting) and **AUD-013** (a permanent, committed
Playwright E2E harness, plus the documentation reconciliation it identified as needed). No product,
business-rule, schema, or UI redesign changes.

**AUD-012 — route-level code splitting.** Every authenticated page-level route
(`frontend/src/App.tsx`) is now `React.lazy`-loaded, plus the always-mounted `TasksWorkspace`
topbar widget (`components/layout/topbar.tsx`) — neither gated by a route, so both would otherwise
sit in the initial bundle regardless of which pages a session ever visits. `LoginPage`/
`NotFoundPage` deliberately stay eager (the very first screen an unauthenticated session renders,
and the tiny catch-all route, respectively). A new shared `RouteLoadingFallback`
(`components/layout/route-loading-fallback.tsx`) — a centered pulse on the app's own `bg-bg` token,
`role="status"`/`aria-live="polite"`, no fake sidebar/topbar — is the one fallback both the
`Suspense` boundary and the pre-existing session-loading check now render, so a user can't tell
which kind of "loading" they're seeing. A new minimal `RouteErrorBoundary`
(`components/layout/route-error-boundary.tsx`) catches a failed chunk `import()` (most commonly: an
old tab open past a new deploy asking for a chunk hash that no longer exists) and offers a Reload
button — deliberately no telemetry hook or broader error-reporting system. No new router or
bundler; no manual `manualChunks` configuration — the default Rollup split was not "demonstrably
poor" (this checkpoint's own bar for adding one).

**Bundle results:** initial entry chunk **790.82 kB → 427.65 kB** (44.6% smaller, gzip **225.45 kB →
134.33 kB**, 40.4% smaller) — the JavaScript every session must download before first paint,
regardless of which page it lands on. Total JS across all chunks is materially unchanged (**786.38
kB**, matching the original 790.82 kB — code was relocated, not removed), split across **35 chunks**
by Vite's own default algorithm: 12 page-specific chunks (`employees-page`, `payroll-entry-page`,
etc.), one large shared `app-shell` chunk (92.46 kB, every authenticated page's own Sidebar+Topbar,
loaded once and cached), and ~20 small shared-dependency chunks Rollup factored out automatically.
The build's own ">500 kB chunk" warning, present before this checkpoint, no longer appears — the
largest chunk (the entry) is now 427.65 kB. Real-stack verified (real backend + a real production
`vite build` served via `vite preview`, cross-origin, real Chromium via Puppeteer): direct navigation
to `/login` loads only the entry chunk; each authenticated route's own chunk (plus `app-shell`, once)
loads only on first visit to that route, both via fresh navigation and via client-side
(`react-router`) navigation; a full reload and a refresh on a nested `/payroll-cycles/:cycleId/...`
route both work; zero new console/page errors or failed chunk requests across all eleven routes.

**AUD-013 — permanent Playwright E2E harness.** Replaces this project's own prior pattern (every
phase/checkpoint before this one) of writing a one-off Puppeteer verification script, running it
once, and discarding it. New root-level `playwright.config.ts` + `tests/e2e/` (specs, fixtures,
helpers, and `setup/e2e-environment.ts` — the environment orchestrator). Chromium only; `workers: 1`
(the payroll-lifecycle spec mutates real, shared cycle state end-to-end — proving worker isolation
for that was out of this checkpoint's scope). **Database provisioning reuses the exact
`embedded-postgres` approach already proven stable across Stabilization Checkpoints 1–3** — its own
dedicated port (`55432`), database (`payroll_e2e`), and credentials, entirely distinct from a
developer's normal `payroll_dev` (port `5432`, via the pre-existing root `docker-compose.yml` or the
same embedded-postgres approach by hand) — provisioned fresh and fully torn down (including its own
data directory) every run; never reused, never a developer's own database. The real compiled backend
(`node dist/server.js`, `NODE_ENV=test` — `production` would set `secure` session cookies, which
break over the plain HTTP this harness runs on; `test` also relaxes the login rate limiter the same
way the backend's own integration suite already relies on) and the real **production** frontend
build (not `vite dev` — the only way to genuinely exercise AUD-012's own route-split chunks) are
both started as ordinary detached child processes, killed by process group in teardown so no
subprocess (e.g. `npx`'s own spawned `vite` binary) is ever left orphaned.

**Six spec files, 15 tests, run in a deliberate file order** (`01`–`06`, since several depend on
state an earlier one creates — see each file's own header comment and `tests/e2e/README.md`):
startup/auth (backend health, frontend load, login, authenticated shell render, logout); the one
full Draft → Released → Archived(+rollover) payroll lifecycle path driven through the real UI (owns
the one-time `POST /payroll-cycles` bootstrap — every cycle after the first comes only from
rollover); core navigation (every route direct-navigated and one client-side lazy-route navigation,
zero console/page errors, zero failed chunks, a nested-route refresh); AUD-009 session-revocation
regression (two independent browser contexts, a dedicated test user so its password change can't
affect any other spec's own login, both sessions lose authorization the moment the password
changes); Backup Package generation reaching `READY` through the real stack with no `storageKey`
leak (API-only — no frontend UI for this exists yet, Phase 5 Checkpoint 2's own approved scope);
and a UI regression smoke covering five durable stabilization-era invariants (Payslips filter
alignment/AUD-004, no document-level scroll, standard-vs-compact table density, no sidebar emoji,
modal centering/Escape-to-close) with tolerant geometric assertions, never exact-pixel snapshots.

**Explicitly documented scope boundary:** AUD-011's crash-recovery path is *not* re-tested by this
harness — killing/restarting the real backend process mid-suite would make the harness's own
lifecycle unstable, since it depends on that one backend process staying up for the rest of the run.
That path already has dedicated, real-stack coverage in `backend/tests/backup-packages.test.ts`'s
own `AUD-011: stale GENERATING recovery` block (Checkpoint 3) — same start/kill/restart mechanism,
no browser attached. Documented in `tests/e2e/README.md`, not silently skipped.

**A real, reproducible bug found and fixed during implementation, not by inspection:** the CSRF-aware
API test helper (`tests/e2e/helpers/api.ts`) initially issued requests as paths relative to
`playwright.config.ts`'s own `baseURL` (the frontend, port 4200) — which resolved fine for `page.goto`
navigations but silently targeted the wrong origin for direct `context.request` calls, since `vite
preview` (a static file server) has no `/api` proxy, unlike `vite dev`'s own dev-only one. Fixed by
targeting the backend's own URL directly, matching exactly how the real frontend build itself talks
to the backend cross-origin via `VITE_API_URL` in production. A second real bug, found by the
harness's own "clean-clone simulation" verification pass (removing every `dist/` directory and
re-running from nothing): `prisma/seed.ts` imports `@payroll/shared`, so the environment
orchestrator's own `shared` build had to move ahead of the migrate+seed step, not merely ahead of
starting the backend/frontend servers — a fresh clone with no prior `npm run build` has no
`shared/dist` at all until that build runs.

**Files/directories added:** `playwright.config.ts`; `tests/e2e/` (`README.md`, `global-setup.ts`,
`global-teardown.ts`, `setup/config.ts`, `setup/e2e-environment.ts`, `fixtures/auth.ts`,
`helpers/api.ts`, `helpers/fixtures.ts`, `specs/01`–`06`); `frontend/src/components/layout/
route-loading-fallback.tsx` and `route-error-boundary.tsx`. **Modified:** `frontend/src/App.tsx`
(lazy route imports, `Suspense`/`RouteErrorBoundary` wiring), `frontend/src/components/layout/
topbar.tsx` (lazy `TasksWorkspace`), root `package.json` (`@playwright/test`/`embedded-postgres`
devDependencies, `test:e2e`/`test:e2e:headed`/`test:e2e:ui`/`test:e2e:report` scripts), root
`.gitignore` (E2E artifact directories). The empty, untracked, never-populated `tests/unit/` and
`tests/integration/` placeholder directories (leftover from early scaffolding, superseded in
practice by `backend/tests/` and `frontend/src/**/*.test.tsx` respectively) were removed rather than
retained unexplained. New `docs/architecture/testing.md` consolidates what kind of test lives where,
how each provisions its database, and this checkpoint's own AUD-011 scope-boundary note — the one
place this project's testing story is current going forward, rather than re-derived per checkpoint.

**Verification performed:** `prisma validate` clean; `prisma migrate status` — still 15 migrations,
zero drift (no schema touched); backend suite **516/516** (unchanged — no backend code touched);
frontend suite **23/23** (unchanged — no new frontend unit tests added; per this checkpoint's own
instruction, dynamic-import route-loading logic is proven by the real Playwright suite, not brittle
jsdom mocks); new E2E suite **15/15**, stable across four consecutive full runs including one
genuine clean-clone simulation (every `dist/` directory removed, `npm run test:e2e` run from
nothing, no undocumented manual step); `typecheck`/`lint` clean across all three workspaces (same 6
pre-existing frontend `react-refresh` warnings, zero new); production builds clean for all three
workspaces, zero new warnings.

### Phase 6 started, 2026-07-18 — Checkpoint 1: Corrections Domain & Schema Foundation — COMPLETE, COMMITTED as `ac58748`

Repository preflight confirmed: branch `main`, working tree clean, commit `4764afb`/`544bdc2`
(Post-Phase-5 Stabilization Checkpoint 4, the last of all four) present, baseline **516/516** backend
/ **23/23** frontend / **15/15** E2E / 15 migrations / zero schema drift reconfirmed. All four
Post-Phase-5 Stabilization checkpoints are closed. The Phase 6 Architecture Review (review-only, no
repository changes) and its Product Decision Resolution (review-only, no repository changes) both
precede this checkpoint and are not repeated here. **This checkpoint is scope-limited to the
Corrections & Balance Adjustments schema/domain foundation only** — no calculation engine, no
baseline reconstruction, no correction approval workflow, no settlement logic, no Draft-cycle
materialization, no bank/cash processing, no reporting, no frontend correction workflow, no
correction APIs, and no permissions enforcement (the `corrections:approve` permission constant
already existed, reserved but unused, from an earlier phase — confirmed, not re-added).

**Schema added** (`backend/prisma/schema.prisma`): five new models —
`CorrectionRequest` (the pending-proposal half of the workflow; `PENDING`/`APPROVED`/`REJECTED`,
never edited after the one permitted transition), `Correction` (the immutable, always-already-approved
event; deliberately carries no `employeeId`/`sourceCycleId`/financial-classification/target-cycle —
those live only on `BalanceAdjustment`, per "avoid duplicated financial state," Architecture Review
§3), `BalanceAdjustment` (the one place this domain's live financial state lives —
`remainingAmount` is the single authoritative outstanding-balance figure), `CorrectionPayment` (the
standalone settlement artifact for an `IMMEDIATE PAYABLE` adjustment with no open `PayrollEntry` to
fold into), and `BalanceAdjustmentSettlement` (append-only per-cycle installment history, the
business-history counterpart to `AuditLog`, same precedent as `EmployeeTransferHistory`) — plus five
new enums (`CorrectionField`, `CorrectionRequestStatus`, `BalanceAdjustmentType`,
`BalanceAdjustmentStatus`, `BalanceAdjustmentPaymentTiming`) and back-relations added to `User`,
`Employee`, `Bank`, `AdjustmentType`, `PayrollCycle`, and `PayrollEntry`. `Correction.reversesCorrectionId`
(nullable, self-referencing, `ON DELETE RESTRICT`) implemented exactly as approved by the Product
Decision Resolution (Decision 5/Q6). Every design decision, and every deliberate deviation from the
checkpoint brief's own generic field list, is documented inline in the schema's own model/field
comments rather than only here.

**Migration**: `backend/prisma/migrations/20260718100000_phase6_corrections_domain/` — generated via
`prisma migrate diff` against the live database (this sandbox has no shadow-database permission,
same documented workaround as `20260711160000_advances`), with the same known spurious
`DROP TABLE "session"` line manually removed (connect-pg-simple's table, not part of the Prisma
schema) and 16 hand-added CHECK constraints appended (blank-reason guards, self-reversal rejection,
`CorrectionRequest`/`BalanceAdjustment` state-invariant guards, `remainingAmount` bounds,
type-restricted nullable fields, positive-amount guards) — Prisma's schema DSL cannot express any of
these. Purely additive: no destructive changes, no data backfill, no mutation of any historical
payroll data. Applied via `prisma migrate deploy` — **16 migrations total**, `prisma migrate status`
reports up to date, `prisma validate` passes. One invariant ("`SETTLED` with no `settledInCycleId`
requires a linked `CorrectionPayment`") is cross-table and cannot be expressed as a Postgres CHECK —
documented as an application-layer-only invariant, deferred to whichever future checkpoint implements
settlement.

**Shared package**: `shared/src/schemas/correction.ts` (new) — Zod enum mirrors of all five new
Prisma enums, plus `WORK_LINE_CORRECTION_FIELDS` (the four `CorrectionField` values that live on
`PayrollEntryWorkLine`, not `PayrollEntry`, restricted to single-work-line entries per Product
Decision Resolution Q1). Deliberately just enum mirrors — no request/response DTOs or mutation input
schemas, since this checkpoint has no HTTP surface yet; those belong to whichever later checkpoint
adds the route that needs them. Exported from `shared/src/index.ts` following the exact pattern of
every other schema module.

**Tests added**: `backend/tests/corrections-schema.test.ts` (new, 34 tests) — schema/domain-only,
modeled on the Phase 3 Checkpoint 0 precedent (`payroll-schema.test.ts`), direct-Prisma, no
service/route layer. Covers every model's happy path and relations, every hand-added CHECK
constraint (blank-reason, self-reversal rejection, all state-invariant guards, `remainingAmount`
bounds, type-restricted nullable fields), FK RESTRICT behavior, and every unique constraint —
explicitly no calculation/approval/settlement-workflow tests, per this checkpoint's own scope.
`backend/tests/helpers.ts`'s `cleanTestData()` updated with FK-safe deletion order for the five new
tables (documented inline: `reversesCorrectionId` cleared first, dependents before `BalanceAdjustment`
before `Correction`) and an `AdjustmentType` `TEST_`-prefix cleanup clause.

**Verification performed:** `prisma validate` clean; `prisma migrate status` — 16 migrations, zero
drift; full backend suite **550/550** (516 baseline + 34 new, zero regressions); frontend suite
**23/23** (unchanged, no frontend code touched); E2E suite **15/15** (unchanged, no regression);
`typecheck`/`lint` clean across all three workspaces (same 6 pre-existing frontend `react-refresh`
warnings, zero new); production builds clean for all three workspaces (`shared` → `backend` →
`frontend`).

**Deliberate scope decisions**: no backend service/route/controller scaffolding was added — the
checkpoint brief's own "repository/service scaffolding where required" and "placeholder modules if
necessary" language is conditional, and empty stub files would violate this project's standing
"no half-finished implementations" principle; Prisma + the new Zod enum mirrors constitute the
complete domain layer a schema-only checkpoint calls for. No nullable "approver" field was added to
`Correction` — it would contradict the already-approved "`Correction` is always created
already-approved" design; `approvedById` serves as both creator and approver for a direct correction,
while `CorrectionRequest.requestedById` (a separate table) captures the original proposer for a
request-originated one.

**Explicitly confirmed at close of this checkpoint:** no calculation engine, no correction approval
workflow, no settlement logic, no correction APIs (beyond the plain Zod enum mirrors), and no
frontend correction workflow exist yet. Checkpoint 1 established the immutable correction domain
schema only. Do not begin Checkpoint 2 without its own explicit go-ahead.

### Phase 6 Checkpoint 2 — Baseline Reconstruction & Delta Calculation Engine — COMPLETE, COMMITTED as `1002209`

Repository preflight confirmed: branch `main`, working tree clean, commit `ac58748`/`6ff5e7f`
(Checkpoint 1) present, baseline backend **550/550** / frontend **23/23** / E2E **15/15** / 16
migrations / zero schema drift reconfirmed. **Scope-limited to a pure calculation engine — no
side effects.** Does not implement correction approval, correction application, balance
settlement, payroll materialization, bank/cash processing, Draft-cycle updates, API endpoints,
frontend workflow, or reporting. No schema change, no new migration (16 migrations, unchanged).

**Baseline reconstruction** (`backend/src/modules/corrections/corrections.calculation.ts`,
`reconstructBaseline`): replays every approved `Correction` against a `PayrollEntry`, never from a
cache, exactly per `docs/architecture/workflows/corrections-and-balance-adjustments.md`'s
"Baseline Reconstruction for Sequential Corrections." For each of the 13 `CorrectionField` values,
the effective value is the most recent approved correction's `newValue`, or the stored
`PayrollEntry`/`PayrollEntryWorkLine` value if never corrected — with `LEAVE_RATE`/`OT_RATE`
falling back to `calcNet`'s own derived rate (never re-derived independently) when the stored
column is null, so the payroll formula is never duplicated. A work-line-scoped field
(`DAYS`/`OT_HOURS`/`OT_RATE`/`CYCLE_DAYS`) reports `null` for an entry with more than one work
line — never fabricated, since Product Decision Resolution Q1 makes such a correction impossible
in the first place. Ordering is deterministic: primary sort by `approvedAt`, with a documented
`id`-based tiebreak used purely for reproducibility (Principle 5), never as a proxy for creation
order — in practice unreachable through the normal approval path once the advisory lock (below)
serializes real approvals for the same entry.

**Delta calculation** (`calculateCorrection`): applies the proposed change on top of the
reconstructed baseline, calls `calcNet` (reused directly, not reimplemented) on both states, and
classifies the signed difference as `PAYABLE` (positive) or `RECOVERY` (negative). **A zero delta
is rejected with a typed `ZERO_DELTA` domain error, per this checkpoint's own explicit
instruction** — a deliberate divergence from the settlement layer's `BalanceAdjustmentType.NONE`
path (`docs/architecture/workflows/corrections-and-balance-adjustments.md`), documented in the
module's own header comment as a scope question for whoever implements Checkpoint 3, not resolved
here.

**Advisory-lock helper** (`corrections.lock.ts`, `acquirePayrollEntryLock`/
`withPayrollEntryLock`): `pg_advisory_xact_lock(hashtext(payrollEntryId))`, transaction-scoped,
implementing Product Decision Resolution Decision 2 exactly. **Not wired into any write path in
this checkpoint** — this checkpoint has no transactional correction-creation flow to protect
(Checkpoint 3's own scope); the helper exists standalone, exercised directly by its own tests
(deterministic key derivation; same-entry serialization; different-entry independence).

**Validation** (`corrections.calculation.ts`): a dedicated `CorrectionValidationError` (not
`HttpError` — this checkpoint has no HTTP surface) with a typed `code` covering every rule the
checkpoint specified: `UNSUPPORTED_FIELD`, `IMMUTABLE_FIELD` (a real PayrollEntry column that is
deliberately never correctable, distinct from a field this schema has never heard of),
`INVALID_ADJUSTMENT_TYPE` (DB-backed — existence + `isActive`), `SPLIT_WORK_LINE_RESTRICTED`,
`ZERO_DELTA`, `INVALID_NUMERIC_VALUE` (mirroring `PayrollEntry`/`PayrollEntryWorkLine`'s own CHECK
constraint bounds), `ENTRY_NOT_RELEASED`, `MALFORMED_ENUM_COMBINATION`, and three reversal-specific
codes (`REVERSAL_TARGET_NOT_FOUND`, `REVERSAL_TARGET_MISMATCH`, `REVERSAL_SELF_REFERENCE`).

**Shared domain types** (`corrections.types.ts`): `ReconstructedBaseline`, `EffectiveFieldValue`,
`DeltaPreview`, `CorrectionPreview`, `CorrectionHistoryRecord`, `CorrectionCalculationInput`,
`CorrectionValidationError`/`CorrectionValidationErrorDetails` — independent of both Prisma's
generated types and any HTTP concern, so Checkpoint 3 and Checkpoint 5 can consume them without
redesign.

**Repository layer** (`corrections.repository.ts`): read-only — `getEntryForCorrection`,
`getApprovedCorrectionsForEntry` (queries only the `Correction` table; a `CorrectionRequest` in any
status, including `PENDING`/`REJECTED`, is structurally never returned), `getCorrectionById`,
`assertAdjustmentTypeValid`, and the one orchestration entry point, `previewCorrection` (reads
only, no writes, no transaction opened, not wired to any route).

**Minimal safe refactor**: `payroll-entry.service.ts`'s existing `EntryWithWorkLines` type was
exported (previously module-private) so the corrections module could reuse it directly rather than
duplicating it — no other change to that file, no behavior change.

**Files created:** `backend/src/modules/corrections/` (`corrections.types.ts`,
`corrections.lock.ts`, `corrections.calculation.ts`, `corrections.repository.ts`);
`backend/tests/corrections-calculation.test.ts` (38 tests, pure, no database);
`backend/tests/corrections-repository.test.ts` (21 tests, DB-backed — repository reads,
`previewCorrection` end to end, and the advisory lock's real-Postgres serialization behavior).
**Files modified:** `backend/src/modules/payroll-entry/payroll-entry.service.ts` (one type export).

**Verification performed:** `prisma validate`/`migrate status` — 16 migrations, zero drift
(unchanged, no schema touched); full backend suite **609/609** (550 baseline + 59 new, zero
regressions); frontend suite **23/23** (unchanged); E2E suite **15/15** (unchanged);
`typecheck`/`lint` clean across all three workspaces (same 6 pre-existing frontend `react-refresh`
warnings, zero new); production builds clean for all three workspaces.

**Explicitly confirmed at close of this checkpoint:** no correction approval workflow, no
correction application, no balance settlement logic, no APIs, and no frontend workflow exist yet.
Checkpoint 2 implemented only the deterministic, side-effect-free calculation engine — baseline
reconstruction, delta calculation, and validation — plus the not-yet-wired advisory-lock helper. Do
not begin Checkpoint 3 without its own explicit go-ahead.

### Phase 6 Checkpoint 2A — Calculation Engine Verification & Architecture Alignment — COMPLETE, COMMITTED as `1aede0a`

A review-only checkpoint verifying Checkpoint 2's implementation against the approved architecture
before any write behavior was introduced. **No production-code defects were found** — replay
ordering, the exact three-correction chain scenario, timestamp-tie determinism, reversal handling,
payroll-formula reuse, the advisory lock, and repository purity were all directly verified by
re-reading the code and, for the replay scenario, by executing it directly. Two test coverage gaps
were closed (a permanent test for the three-correction chain; two tests for the previously-untested
`withPayrollEntryLock` wrapper) — test-only, no production code changed. **One substantive finding**:
`ZERO_DELTA`'s rejection and the architecture's `BalanceAdjustmentType.NONE` path were confirmed
genuinely incompatible under a literal reading — flagged as a recommendation for product-owner
resolution, not resolved in that checkpoint (review-only scope). See Checkpoint 3, below, for that
resolution. Verification: backend **612/612** (609 baseline + 3 new), frontend **23/23** unchanged,
E2E **15/15** (one transient 14/15 failure investigated, confirmed environmental — no frontend/E2E
code was touched this checkpoint — and resolved by a clean retry, both runs recorded).

### Phase 6 Checkpoint 3 — Transactional Correction Approval & Balance Adjustment Creation — COMPLETE, COMMITTED as `6189ba9`

Repository preflight confirmed: branch `main`, working tree clean, commits `1002209`/`379d197`
(Checkpoint 2) and `1aede0a` (Checkpoint 2A) present, baseline backend **612/612** / frontend
**23/23** / E2E **15/15** / 16 migrations / zero schema drift reconfirmed. **The first Phase 6
checkpoint to write anything** — implements the transactional `CorrectionRequest` → approve/reject
→ immutable `Correction` + `BalanceAdjustment` pipeline. No schema change, no new migration (16
migrations, unchanged). Does not implement settlement, `CorrectionPayment` processing,
`BalanceAdjustmentSettlement` creation, Draft-cycle materialization, bank/cash processing, the
Corrections Ledger, or any frontend workflow — all remain later checkpoints.

**ZERO_DELTA architecture clarification (resolved, per this checkpoint's own explicit instruction):**
`docs/architecture/workflows/corrections-and-balance-adjustments.md`'s `NONE`-type paragraph now
carries a dated amendment recording that a zero-net-difference correction is rejected outright at
approval time (`ZERO_DELTA`) — no `Correction`/`BalanceAdjustment` created — so `NONE` is not
reachable through the ordinary single-field workflow this document describes. The enum value is
retained (not removed — a schema change was explicitly out of this checkpoint's scope), kept for
forward compatibility with a possible future multi-field/batch-correction scenario.

**Approval transaction** (`corrections.service.ts`, `approveCorrectionRequest`) — one
`prisma.$transaction`, in order: load the request (to find its `PayrollEntry`) → authorize (site
access) → acquire the `PayrollEntry`-scoped advisory lock (`corrections.lock.ts`, Checkpoint 2) →
re-read the request, authoritative and post-lock → confirm `PENDING` → re-read the entry and its
full approved-correction history, fresh → recalculate via the unchanged Checkpoint 2 pure engine
(field/value/adjustmentType/reversal overridable, "may adjust before confirming," per the
Architecture Review) → reject `ZERO_DELTA` internally → create the immutable `Correction` → create
the `BalanceAdjustment` (`amount`/`remainingAmount` = `abs(delta)`, `type` = `PAYABLE`/`RECOVERY`,
`paymentTiming` required only for `PAYABLE`, `recoveryInstallmentAmount` optional and `RECOVERY`-only,
an auto-composed `remark`) → flip the request to `APPROVED` via a conditional `updateMany`
(`WHERE status = 'PENDING'`, a defense-in-depth backstop alongside the lock, per the Product
Decision Resolution's own "conditional updates retained as a secondary safeguard") → one aggregate
`correction.approved` audit event cross-referencing the request and the resulting
`BalanceAdjustment`. Rejection follows the same lock-then-conditional-update pattern (closing a
reject-vs-approve race the lock alone wouldn't, since rejection doesn't otherwise touch the
correction history) — a separate `correction_request.rejected` audit event.

**Reversal**: no separate model — `Correction.reversesCorrectionId`, declared only at approval time
(not request-creation time — `CorrectionRequest` has no such column; confirmed not a Checkpoint 1
defect, since the Architecture Review's own route table already specifies "the request-approval
endpoint accepts an optional reversesCorrectionId"), validated against the same entry+field.
Multiple corrections may reverse the same target — the schema's own one-to-many
`reversedByCorrections` relation permits this deliberately; no artificial "already reversed"
restriction was added.

**Deliberately deferred**: a "direct correction" route (Master User corrects a released entry
personally, bypassing `CorrectionRequest` entirely) — the Architecture Review describes this as a
second valid path to an identical `Correction` row, but this checkpoint's own brief scopes
"Implement" to request creation/listing/detail, approval, and rejection only. Left as a thin,
straightforward addition for a later checkpoint (skip the request-lookup/status-flip steps;
everything else — lock, recalculation, `Correction`/`BalanceAdjustment` creation, audit — is already
directly reusable).

**API routes** (`corrections.routes.ts`, mounted in `app.ts`): `POST
/payroll-entries/:entryId/correction-requests` (`payroll:entry`), `GET
/payroll-entries/:entryId/corrections` and `POST .../corrections/preview` (`payroll:entry` or
`corrections:approve`, matching the Architecture Review's own dual-permission convention), `GET
/correction-requests` / `GET /:id` / `POST /:id/approve` / `POST /:id/reject` (`corrections:approve`
only — Master Admin, today). No new permission key — `corrections:approve` was already reserved
(Checkpoint 1); `payroll:entry` is reused for request submission exactly as the Architecture Review
specified ("Payroll Staff already holds it, it's already site-scoped").

**Error handling**: `CorrectionValidationError` (Checkpoint 2's HTTP-agnostic domain error, extended
here with five new codes) is now mapped through the existing global error handler via one
exhaustive `CorrectionValidationErrorCode -> status` lookup — `*_NOT_FOUND` -> 404,
`REQUEST_NOT_PENDING` -> 409, everything else -> 400. No raw Prisma error ever reaches a client.

**Files created:** `backend/src/modules/corrections/corrections.service.ts`,
`corrections.routes.ts`; `backend/tests/corrections-service.test.ts` (39 tests, full HTTP stack via
`createAuthenticatedAgent` — request creation, approval, sequential approval, real-Postgres
concurrent approval, rejection, reversal, API security, and transaction-rollback tests using
`jest.spyOn` against this module's own exports, the same precedent
`payroll-cycle-rollover.test.ts` already established).
**Files modified:** `corrections.repository.ts` (CorrectionRequest/Correction/BalanceAdjustment
read/write primitives — thin CRUD only, no business logic), `corrections.types.ts` (five new error
codes), `shared/src/schemas/correction.ts` + `shared/src/index.ts` (request/approve/reject/list/
preview Zod schemas), `backend/src/app.ts` (router mounts), `error-handler.ts` (the new mapping),
`docs/architecture/workflows/corrections-and-balance-adjustments.md` (the ZERO_DELTA amendment).

**Verification performed:** `prisma validate`/`migrate status` — 16 migrations, zero drift
(unchanged); full backend suite **651/651** (612 baseline + 39 new, zero regressions); frontend
suite **23/23** (unchanged); E2E suite **15/15** (unchanged, clean run); `typecheck`/`lint` clean
across all three workspaces; production builds clean for all three workspaces.

**Explicitly confirmed at close of this checkpoint:** source `PayrollEntry` records remain
immutable (never written by approval); historical `Correction` rows remain immutable (a second
correction to the same field creates a new row, never edits the first); no settlement logic, no
`CorrectionPayment` processing, no `BalanceAdjustmentSettlement` creation, no Draft-cycle
materialization, and no frontend correction workflow exist yet; no Backup Package was regenerated.
Checkpoint 3 implemented only transactional request approval/rejection and
`Correction`/`BalanceAdjustment` creation. Do not begin Checkpoint 4 without its own explicit
go-ahead.

### Phase 6 Checkpoint 4 — Settlement, Payment Recording & Outstanding Balance Lifecycle — COMPLETE, COMMITTED as `9f9c88d`

Repository preflight confirmed: branch `main`, working tree clean, commit `6189ba9` (Checkpoint 3
implementation) and its doc-hash follow-up `3f986d2`, plus `1aede0a` (Checkpoint 2A) present,
baseline backend **651/651** / frontend **23/23** / E2E **15/15** / 16 migrations / zero schema
drift reconfirmed. Implements the manual settlement-recording lifecycle for outstanding
`BalanceAdjustment` obligations. No schema change, no new migration (16 migrations, unchanged). Does
not implement automatic Draft-cycle materialization, `PayrollEntry` deductions, bank-sheet/
cash-sheet integration, or any frontend workflow — all remain later checkpoints.

**Model responsibility (this checkpoint's own required "First task"):** confirmed `CorrectionPayment`
and `BalanceAdjustmentSettlement` are not duplicates — the schema's own structural constraints
already enforce a clean split. `CorrectionPayment.balanceAdjustmentId` is `@unique` (at most one
per adjustment, ever), carries payment-*execution* metadata (bank/branch/account/iban snapshot,
`paidAt`, `paidById`), has no `cycleId`, and always settles the *entire* remaining balance in one
shot — the standalone, out-of-cycle path for a `PAYABLE` adjustment with no open entry to fold
into. `BalanceAdjustmentSettlement` has `@@unique([balanceAdjustmentId, cycleId])` (many rows
permitted, one per distinct cycle), carries no payment-execution metadata, and is a pure,
repeatable, partial-or-full ledger entry tied to a specific `PayrollCycle` — used for both
`RECOVERY` installments and a `DEFERRED PAYABLE`'s eventual settlement. No schema defect found; no
migration needed.

**Settlement calculation** (`corrections.settlement.ts`, pure, no Prisma/HTTP): `calculateSettlement`
validates and applies one proposed amount against the current `remainingAmount`/`status` — rejects
zero, negative, non-numeric, and over-settlement amounts, and any settlement against an
already-`SETTLED` adjustment, all via `decimal.js` with no hidden tolerance.
`calculateStandalonePayment` reuses it, forcing the proposed amount to always equal the full
remaining balance (the schema's own "no partial CorrectionPayment" rule).

**PAYABLE workflow:** `POST /balance-adjustments/:id/payments` (standalone, `CorrectionPayment`,
always full) and `POST /balance-adjustments/:id/settlements` (cycle-scoped, partial-or-full,
caller-supplied `cycleId` — no automatic "next Draft cycle" discovery, since Draft-cycle
materialization is explicitly out of scope). Optional bank/branch/account/iban metadata, mirroring
`Employee`/`PayrollEntry`'s own "no bankId means cash" convention — no invented required field.

**RECOVERY workflow:** cycle-scoped only (`POST .../settlements`) — no standalone path (bank fields
have no meaning for money moving the other direction). No `PayrollEntry` deduction, no bank/cash
export integration; a settlement here is a pure ledger entry recording that a recovery installment
was applied.

**Departed-employee rule:** implemented exactly per the Product Decision Resolution — "Recovery from
departed employees remains permanently pending." A `RECOVERY` settlement attempt against a departed
employee's (`Employee.dateOfLeaving IS NOT NULL`) adjustment is rejected with a typed
`DEPARTED_EMPLOYEE_RECOVERY_PENDING` error; no automatic or manual path exists (no receivables
system anywhere in this codebase, the same accepted gap as an uncollectable Advance). `PAYABLE`
settlement is entirely unaffected by departure status.

**Transaction sequence and advisory lock:** one `prisma.$transaction` per settlement action —
pre-lock load (to authorize and find the lock key), `acquireBalanceAdjustmentLock` (Checkpoint 4's
own new lock, `corrections.lock.ts` — deliberately *not* a reuse of Checkpoint 2/3's
`PayrollEntry`-keyed lock, namespaced with a `'balance-adjustment:'` prefix so the two lock domains
can never collide in the same 32-bit `hashtext` key space), re-read post-lock, departed-employee/
adjustment-type validation, pure calculation, `CorrectionPayment`/`BalanceAdjustmentSettlement`
creation, a conditional `updateMany` (`WHERE status = 'PENDING' AND remainingAmount = <the exact
value just read>`) as a defense-in-depth backstop returning `STALE_CONCURRENT_WRITE` on zero rows
affected, one aggregate `balance_adjustment.settled` audit event — all inside the same transaction.

**Files created:** `corrections.settlement.ts`, `corrections.settlement.types.ts`,
`corrections.settlement.service.ts`; `backend/tests/corrections-settlement.test.ts` (49 tests —
model responsibility, pure calculation, PAYABLE, RECOVERY, departed employee, real-Postgres
concurrency, transaction rollback via `jest.spyOn`, immutability, API security).
**Files modified:** `corrections.repository.ts` (BalanceAdjustment/CorrectionPayment/
BalanceAdjustmentSettlement read/write primitives), `corrections.lock.ts` (the new
`acquireBalanceAdjustmentLock`/`withBalanceAdjustmentLock`), `corrections.routes.ts` (the new
`balanceAdjustmentsRouter`), `app.ts` (router mount), `error-handler.ts` (the new
`SettlementValidationError` mapping), `shared/src/schemas/correction.ts` + `shared/src/index.ts`
(payment/settlement/preview Zod schemas).

**Verification performed:** `prisma validate`/`migrate status` — 16 migrations, zero drift
(unchanged); full backend suite **700/700** (651 baseline + 49 new, zero regressions); frontend
suite **23/23** (unchanged); E2E suite **15/15** (unchanged, clean run); `typecheck`/`lint` clean
across all three workspaces; production builds clean for all three workspaces.

**Explicitly confirmed at close of this checkpoint:** original `BalanceAdjustment.amount` values
remain immutable; source `PayrollEntry` records remain immutable; historical `Correction` rows
remain immutable; settlement history is append-only (no update/delete route exists for either
`CorrectionPayment` or `BalanceAdjustmentSettlement`); no Draft-cycle materialization exists; no
`PayrollEntry` deduction was ever created; no bank-sheet or cash-sheet integration exists; no
frontend correction workflow exists; no historical Backup Package was regenerated. Checkpoint 4
implemented only payment/settlement recording and the outstanding-balance lifecycle. Do not begin
Checkpoint 5 without its own explicit go-ahead.

---

### Phase 6 Checkpoint 5 — Draft-Cycle Materialization of Outstanding Balance Adjustments — COMPLETE, COMMITTED as `3bab54a`

Repository preflight confirmed: branch `main`, working tree clean, commit `9f9c88d` (Checkpoint 4
implementation) present, baseline backend **700/700** / frontend **23/23** / E2E **15/15** / 16
migrations / zero schema drift reconfirmed. Materializes eligible `BalanceAdjustment` obligations
into the current Draft payroll cycle, without modifying historical payroll, corrections, or
settlements — preserving a hard distinction between the immutable correction obligation
(`BalanceAdjustment`), its cycle-scoped materialization (new: `BalanceAdjustmentMaterialization`),
and actual settlement/payment (`CorrectionPayment`/`BalanceAdjustmentSettlement`, Checkpoint 4,
untouched by this checkpoint). No frontend correction screens, no Corrections Ledger.

**Schema investigation (this checkpoint's own required "First task") and the resulting three-round
revision, in full — the most consequential part of this checkpoint's process, not just its
result:** the approved Checkpoint 1–4 schema had no way to represent materialization identity or
idempotency at all — confirmed genuine, not worked around, by comparing against the one real
precedent for this exact kind of write (Advances' `materializeScheduledAdvanceDeductions`, which
writes directly into dedicated `PayrollEntry` columns; no equivalent columns existed for
corrections, and reusing `advanceDeduction`/`allowance`/`fine` would have conflated a correction
balance with an unrelated payroll field, violating the frozen architecture). Per the checkpoint's own
explicit instruction, this gap was reported and no migration was written before a design was
presented for approval:
1. **First proposal** (two plain `PayrollEntry` aggregate columns, reusing `BalanceAdjustmentSettlement`
   for traceability) was rejected: Checkpoint 4 established `BalanceAdjustmentSettlement` as
   representing an *actual* settlement (decrementing `remainingAmount`); reusing it for
   materialization would have incorrectly marked a Draft-cycle obligation as settled before that
   cycle is even finalized.
2. **Second proposal** (a dedicated `BalanceAdjustmentMaterialization` model, no reservation
   tracking) was caught as having a real double-projection bug: since materialization never
   decrements `remainingAmount`, the same obligation could be re-materialized into every sequential
   Draft cycle, projecting more money than was ever actually owed.
3. **Third round** added the final integrity requirements: a `MaterializationStatus` lifecycle
   (`ACTIVE`/`CONSUMED`/`CANCELLED`, only `ACTIVE` ever created by this checkpoint), an
   `availableToMaterialize = remainingAmount − Σ(ACTIVE reservations across every cycle)` formula
   (re-derived on every attempt, never cached), a unique `settlementId`, exact CHECK-constraint
   combinations tying `status` to `consumedAt`/`cancelledAt`/`settlementId`, and the supporting
   indexes for the availability query.

**Migration** `20260718110000_phase6_correction_materialization` (17th migration, additive only):
new `MaterializationStatus` enum; new `BalanceAdjustmentMaterialization` model
(`@@unique([balanceAdjustmentId, cycleId])` — the actual idempotency guarantee — plus
`@@index([balanceAdjustmentId, status])`/`@@index([payrollEntryId])`/`@@index([cycleId])`); two new
`PayrollEntry` columns, `correctionBalancePayable`/`correctionBalanceRecovery` (`Decimal(12,2)`,
default `0`, both `>= 0` via hand-added CHECK constraints, matching every other money column in this
schema). Hand-added CHECK constraint enforces `amount > 0` and the exact valid
`(status, consumedAt, cancelledAt, settlementId)` combinations. Applied cleanly; `prisma generate`
regenerated the client.

**`calcNet` extension** (`shared/src/lib/calc-net.ts`): two new **optional**, backward-compatible
input fields — `correctionBalancePayable` folds into `totalEarning`, `correctionBalanceRecovery`
folds into `totalDeduction` — both default to `0` when omitted, so every pre-existing caller is
unaffected. `computeEntryCalc` (`payroll-entry.service.ts`) threads the two new `PayrollEntry`
columns through, so materialized amounts are reproducibly visible in the grid/entry-detail calc.
`payslips.service.ts`'s own separate calc-input construction is a deliberate, documented scope
boundary — not touched this checkpoint.

**Eligibility engine** (`corrections.materialization.ts`, pure, no Prisma/HTTP — mirrors
`corrections.calculation.ts`/`corrections.settlement.ts`'s own design): `determineMaterialization`
— target cycle must be DRAFT → not already materialized for that cycle → adjustment not `SETTLED` →
type supported (`RECOVERY`, or `PAYABLE` with `paymentTiming = DEFERRED`; `NONE` and `IMMEDIATE
PAYABLE` rejected — the latter uses Checkpoint 4's own `CorrectionPayment` path instead) → target
employee has a `PayrollEntry` in the target cycle → `RECOVERY` against a departed employee rejected
(the Product Decision Resolution's "Recovery from departed employees remains permanently pending"
rule, reused verbatim) → `remainingAmount > 0` → `availableToMaterialize > 0`. Amount selection:
`PAYABLE` always takes the full `availableToMaterialize`; `RECOVERY` takes
`min(availableToMaterialize, recoveryInstallmentAmount ?? availableToMaterialize)`. All arithmetic
via `decimal.js`.

**Idempotency and concurrency** (`corrections.materialization.service.ts`): idempotency is
guaranteed by the `@@unique([balanceAdjustmentId, cycleId])` constraint plus a pre-check read — a
repeat or concurrent duplicate attempt against the same adjustment+cycle always resolves to exactly
one `MATERIALIZED` and any others `SKIPPED (ALREADY_MATERIALIZED)`, never two rows. **Documented,
deterministic lock order — always cycle, then adjustment, never the reverse:** (1)
`lockPayrollCycleForUpdate` — a native Postgres `SELECT ... FOR UPDATE` on the target `PayrollCycle`
row, deliberately not a custom advisory lock, chosen specifically because Finalize Cycle's own
transaction takes no advisory lock at all (only an implicit row lock via its own conditional
`UPDATE ... WHERE status = 'DRAFT'`) — a `FOR UPDATE` select is the only mechanism that naturally
serializes against that without changing Finalize's own code; (2) `acquireBalanceAdjustmentLock`,
Checkpoint 4's existing advisory lock, reused unchanged. **A genuine cross-checkpoint deadlock was
found and fixed under real concurrent-load testing**, not merely theorized: materializing and
settling the *same* adjustment into/against the *same* cycle concurrently can deadlock — the
materialize transaction holds the cycle's `FOR UPDATE` row lock and then waits on the adjustment's
advisory lock, while a concurrent settlement holds that advisory lock and then triggers an implicit
FK-check lock on that same `PayrollCycle` row via `BalanceAdjustmentSettlement.cycleId`'s foreign
key. Postgres's own deadlock detector correctly aborts one side with `40P01`; the fix maps that
(and `40001`, serialization failure) to a clean `409 CONCURRENT_CONFLICT` in the shared error
handler (`error-handler.ts`), the same "reload and try again" class as `STALE_CONCURRENT_WRITE`,
rather than a misleading `500`. Neither Finalize's own code nor Checkpoint 4's settlement
transaction was modified.

**Archive-and-create-next integration**: `materializeCorrectionObligationsForNewCycle`
(`corrections.materialization.service.ts`) is the second direct consumer of the existing
Materialization Hook seam (`docs/architecture/workflows/outstanding-obligations.md`'s own dated
resolution note) — called from `archiveAndCreateNextPayrollCycle` immediately after Advances' own
`materializeScheduledAdvanceDeductions`, inside the same already-open rollover transaction, reusing
the same `employeeIdToEntryId` map. No registry was introduced (per that file's own standing rule —
two real consumers still doesn't justify one).

**Manual/batch materialization and API routes**: `previewMaterialization` (read-only dry run, no
lock), `materializeBalanceAdjustment` (single, explicit or current-Draft target cycle),
`materializeEligibleAdjustmentsForCycle` (batch scan of every `PENDING` candidate for a cycle, one
independent transaction per adjustment — partial-success semantics, typed skip reasons). Routes:
`GET/POST /balance-adjustments/:id/materializations[/preview]` (view: `payroll:entry` OR
`corrections:approve`; create: `corrections:approve`) and `POST
/payroll-cycles/:cycleId/materializations` (batch, `corrections:approve`) — no new permission key.

**Hard "Materialized ≠ Settled" rule, enforced structurally, not just by convention**: no code path
introduced this checkpoint ever creates a `CorrectionPayment`/`BalanceAdjustmentSettlement` or
touches `BalanceAdjustment.remainingAmount`/`.status` — a materialization row is a reservation only.
The `ACTIVE → CONSUMED`/`CANCELLED` transition remains a later, unbuilt checkpoint's own event; this
checkpoint only ever creates `ACTIVE` rows.

**Files created:** `corrections.materialization.ts`, `corrections.materialization.types.ts`,
`corrections.materialization.service.ts`; `backend/tests/corrections-materialization.test.ts` (55
tests — pure eligibility/amount-selection, PAYABLE, RECOVERY, departed employee, idempotency,
real-Postgres concurrency including the deadlock scenario above, archive-and-create-next
integration, batch result, audit, API security).
**Files modified:** `prisma/schema.prisma` + new migration; `shared/src/lib/calc-net.ts`;
`payroll-entry.service.ts` (`computeEntryCalc`); `corrections.repository.ts` (materialization
read/write primitives, `lockPayrollCycleForUpdate`); `corrections.routes.ts` (new
`payrollCycleMaterializationsRouter` + `balanceAdjustmentsRouter` additions);
`payroll-processing.service.ts` (Hook wiring in `archiveAndCreateNextPayrollCycle`); `app.ts`
(router mount); `error-handler.ts` (`MaterializationValidationError` mapping + the new `P2010`
deadlock/serialization-failure → 409 mapping); `shared/src/schemas/correction.ts` +
`shared/src/index.ts` (`materializeBalanceAdjustmentSchema`); `backend/tests/helpers.ts`
(`cleanTestData` extended for the new `BalanceAdjustmentMaterialization` table's RESTRICT FKs);
`backend/tests/corrections-calculation.test.ts` + `frontend/src/components/payroll-entry/
columns.test.ts` (fixture updates for the two new required `PayrollEntry` columns).

**Verification performed:** `prisma validate`/`migrate status` — 17 migrations, zero drift; full
backend suite **755/755** (700 baseline + 55 new, zero regressions, confirmed stable across three
consecutive full runs of the new file to rule out the deadlock fix being flaky); frontend suite
**23/23** (unchanged); `typecheck`/`lint` clean across all three workspaces; production builds clean
for all three workspaces. Two transient failures observed once during a full-suite run
(`payslips.test.ts`'s N+1-query-count assertion, `payroll-entry-performance.test.ts`'s
indexed-query-plan assertion) were investigated by re-running both files in isolation — both passed
cleanly on retry, consistent with this project's own documented query-planner-sensitivity-under-load
pattern (`docs/architecture/testing.md`), not a regression from this checkpoint's migration.

**Explicitly confirmed at close of this checkpoint:** `PayrollEntry`/`Correction`/`BalanceAdjustment`
rows remain immutable (no materialization write ever touches them beyond the two new aggregate
columns, which are always fully recomputed, never incremented); no adjustment was ever
over-materialized across sequential Draft cycles (the reservation formula, tested directly);
materializing the same adjustment into the same cycle twice, concurrently or sequentially, always
produces exactly one financial effect; departed-employee `RECOVERY` remains permanently pending,
never materialized; materialization never equals settlement — no `CorrectionPayment`/
`BalanceAdjustmentSettlement` was ever created by this checkpoint, and `remainingAmount`/`status`
were never touched; no frontend correction screen, no Corrections Ledger, no bank-sheet/cash-sheet
export change, and no historical Backup Package regeneration exist. Checkpoint 5 implemented only
Draft-cycle materialization. Do not begin Checkpoint 6 without its own explicit go-ahead.

---

### Phase 6 Checkpoint 5A — Reservation vs Settlement Consistency Review — COMPLETE, COMMITTED as `9d19cbb` (+ docs `b8a3e81`)

Review-first checkpoint. Found and fixed one genuine correctness defect: Checkpoint 4's settlement
recording (`recordCorrectionPayment`/`recordBalanceAdjustmentSettlement`) validated a proposed amount
only against `remainingAmount`, never against Checkpoint 5's own `ACTIVE`
`BalanceAdjustmentMaterialization` reservation ledger. Since a materialization never touches
`remainingAmount`/`.status`, an amount already reserved into a Draft cycle's own `PayrollEntry` (and
therefore already counted in that entry's `calcNet`, headed for payment/deduction at that cycle's
release) could also be settled independently — the same obligation processed twice. Every other
question the review posed (materialization consistency, lock ordering, lifecycle-state reachability,
`PayrollEntry` aggregate drift, archive-and-create-next idempotency) was confirmed already correct,
no change needed.

**Fix**: every settlement path (standalone `CorrectionPayment`, cycle-scoped
`BalanceAdjustmentSettlement`, and the read-only preview) now reads `getActiveReservedAmount` — the
same reservation ledger `corrections.materialization.ts` already reads — and rejects
(`RESERVED_AMOUNT_UNAVAILABLE`, mapped to 400) a settlement that would exceed `remainingAmount −
Σ(ACTIVE reservations)`. `activeReservedAmount` is an optional pure-calculation input defaulting to
`'0'`, so every pre-existing caller/test keeps its exact prior behavior. No schema change, no
migration, no unrelated refactoring.

**Files modified:** `corrections.settlement.types.ts` (new field + error code),
`corrections.settlement.ts` (the reservation-aware ceiling check), `corrections.settlement.service.ts`
(wired `getActiveReservedAmount` into all three entry points), `error-handler.ts` (status mapping).
**Tests added:** `backend/tests/corrections-reservation-consistency.test.ts` (14 tests — pure
calculation, Scenario A materialize-then-settle now blocked for PAYABLE/RECOVERY, Scenario B
settle-then-materialize confirmed already safe, concurrent materialize↔settle invariant checks,
lock-ordering deadlock-absence check).

**Verification:** backend **758/769** (11 pre-existing `payslips.test.ts` failures, independently
reproduced on the clean pre-Checkpoint-5A tree via `git stash` — confirmed unrelated); frontend
**23/23**; E2E **15/15** (unchanged — no frontend exists yet for corrections); `prisma validate`/
`migrate status` — still 17 migrations, zero drift; `typecheck`/`lint` clean; production builds
clean. Checkpoint 5 is now fully closed. Do not begin Checkpoint 6 without its own explicit
go-ahead.

---

### Phase 6 Checkpoint 6 — Corrections Ledger, Review Queue & Frontend Operational Workflow — COMPLETE

Repository preflight confirmed: branch `main`, working tree clean, commits `3bab54a`/`9623b31`
(Checkpoint 5) and `9d19cbb`/`b8a3e81` (Checkpoint 5A) present, baseline backend **758/769** (the
same 11 pre-existing `payslips.test.ts` failures reconfirmed, not new) / frontend **23/23** / E2E
**15/15** / 17 migrations / zero schema drift. Builds the frontend Corrections workflow — Review
Queue, Corrections Ledger, request creation/preview/approval/rejection, BalanceAdjustment/
materialization/settlement presentation, reservation-aware standalone settlement UX — over the
already-built Checkpoints 3–5A backend, without altering any financial architecture.

**Two minimal, read-only backend additions** (this checkpoint's own explicitly-permitted carve-out —
"a small backend read projection... if the frontend cannot accurately display an already-established
domain value"), both reusing existing repository shapes verbatim, neither adding a lifecycle, a
migration, or a new permission key:
1. `GET /api/v1/adjustment-types` (new module, `adjustment-types.routes.ts`/`.service.ts`) — no route
   existed anywhere to list the `AdjustmentType` lookup table before this checkpoint, and the
   request-creation form cannot let a user pick a required `adjustmentTypeId` foreign key without
   one. Gated on the corrections domain's existing `[payroll:entry, corrections:approve]` pair.
2. `GET /api/v1/balance-adjustments` (list, added to the existing `balanceAdjustmentsRouter`) — the
   Corrections Ledger's own data source; Checkpoint 4's own module comment had explicitly deferred
   this exact route as "the Corrections Ledger, explicitly out of this checkpoint's scope." Reuses
   `balanceAdjustmentDetailInclude` unchanged, filterable by `status`/`type`/`employeeId`, site-scoped
   for a non-Master caller (mirrors `listCorrectionRequestsForUser`'s own convention exactly).

Also expanded two existing Prisma `include` selects (read-only, same already-joined relations, no new
join): `correctionRequestDetailInclude` gained `payrollEntry.employee`/`.cycle` (Review Queue needs
employee identity and payroll period without a per-row follow-up fetch); `balanceAdjustmentDetailInclude`
gained `employee.employeeCode`.

**Backend tests added:** `backend/tests/corrections-ledger-and-lookups.test.ts` (12 tests — lookup
listing/filtering/permissions, Ledger listing/site-scoping/status-and-type filtering/shape parity
with the single-record route, permission checks).

**Frontend** (`frontend/src/`): three new hooks (`use-adjustment-types.ts`,
`use-correction-requests.ts`, `use-balance-adjustments.ts`, all mirroring `use-advances.ts`'s
established TanStack Query shape); a pure label/tone helper module with its own unit tests
(`components/corrections/correction-labels.ts` + `.test.ts`, 12 tests); four modals
(`request-correction-modal.tsx`, `approve-request-modal.tsx`, `reject-request-modal.tsx`,
`record-settlement-modal.tsx`); three routed pages (`corrections-page.tsx` — Review Queue + Ledger
tabs, permission-gated per tab exactly matching each backend route's own gate;
`correction-request-detail-page.tsx`; `balance-adjustment-detail-page.tsx`), wired into `App.tsx`
(three new routes under `/corrections`) and `nav-config.ts` (one new "Corrections" nav item,
`ScrollText` icon, gated on `payroll:entry`). "Request Correction" is a toolbar action added to the
existing `payroll-entry-page.tsx` (visible only for a Released/Archived cycle, matching the backend's
own `assertEntryIsReleased` gate) — no new column was added to the dense virtualized Payroll Entry
grid itself, avoiding any risk to `columns.ts`'s pixel-width computation.

**No financial calculation was duplicated in React.** The one client-side arithmetic expression
(`availableForStandaloneSettlement = remainingAmount − activeReservedAmount`,
`correction-labels.ts`) is a display-only derived label built from two already-fetched authoritative
backend figures, never sent back to the server and never the sole gate on a submit button — every
actual settlement/payment/approval action still goes through the backend's own fresh transactional
check, and a stale-state rejection (`RESERVED_AMOUNT_UNAVAILABLE`, `STALE_CONCURRENT_WRITE`,
`ZERO_DELTA`, etc.) surfaces via toast exactly as `ApiError.message` reports it.

**Verification:** backend **770/781** (758 baseline + 12 new, same 11 pre-existing unrelated
`payslips.test.ts` failures, no new failures); frontend **35/35** (23 baseline + 12 new);
**E2E 20/20** (15 baseline + 5 new scenario tests, `tests/e2e/specs/07-corrections.spec.ts` —
request-and-approve PAYABLE, request-and-approve RECOVERY, reject, materialized-reservation
visibility with standalone payment correctly blocked, and historical-ledger navigation, all driven
through a real browser against the real backend/database); `prisma validate`/`migrate status` — still
17 migrations, zero drift; `typecheck`/`lint` clean across all workspaces; production builds clean
for backend, frontend, and shared.

**Explicitly confirmed at close of this checkpoint:** no source Released or Archived `PayrollEntry`
was made editable; no `Correction`, `BalanceAdjustment`, materialization, payment, or settlement
history can be edited or deleted through the frontend (every such route remains create/read-only,
unchanged from Checkpoints 3–5A); standalone settlement respects `ACTIVE` reservations end-to-end,
proven in a real browser (E2E Scenario 4); no `CONSUMED`/`CANCELLED` materialization transition was
implemented or exposed; no schema migration was added; no new permission key was added (every route
reuses `payroll:entry`/`corrections:approve` exactly); no bank-sheet, cash-sheet, payslip, or Backup
Package integration was added. Checkpoint 6 implemented only the frontend operational Corrections
workflow. Phase 6 final close-out remains pending — do not begin Checkpoint 7 without its own
explicit go-ahead.

---

### Phase 6 Checkpoint 6A — Corrections Navigation Permission Verification & Focused Fix — COMPLETE, COMMITTED as `9d6a39b`

Repository preflight confirmed: branch `main`, working tree clean, commits `0256ab4`/`790147c`
(Checkpoint 6) present, baseline backend **770/781** (same 11 pre-existing `payslips.test.ts`
failures reconfirmed — one clean **781/781** run was also observed, confirming the 11 are
environment-load-sensitive PDF/Chromium flakiness, not deterministic) / frontend **35/35** / 17
migrations / `prisma validate` clean / migration status clean / zero schema drift.

**Defect confirmed, not imprecise reporting.** `nav-config.ts`'s Corrections sidebar item was gated
on `requiredPermission: 'payroll:entry'` alone — a single-permission field that could not express
"OR `corrections:approve`". A user holding only `corrections:approve` (a reviewer, no
`payroll:entry`) could not see or click the Corrections sidebar item at all, even though the Review
Queue behind it — and the backend route serving it — is authorized for exactly that permission.
Every other part of the stack the checkpoint brief asked to verify was already correct: the
`/corrections` route has no separate frontend guard (`App.tsx`'s `RequireSession` checks
authentication only); `CorrectionsPage`'s own `canView`/tab-default logic already implemented
`payroll:entry OR corrections:approve` correctly, including the landing-tab rule (reviewer-only →
Review Queue, payroll-entry-only → Ledger with Review Queue hidden, neither → its own access-denied
message, never a hidden/unauthorized default tab); the backend's `ENTRY_VIEW_PERMISSIONS`/
`BALANCE_VIEW_PERMISSIONS` convention (`corrections.routes.ts`) already matched the brief's required
contract exactly (Review Queue: `corrections:approve` only; Ledger: `payroll:entry OR
corrections:approve`; request creation: `payroll:entry` only) — no backend change was needed or made.

**Root cause:** Checkpoint 6's own nav-config comment explicitly (and, at the time, correctly)
reasoned that `corrections:approve`'s only holder was Master Admin, who already holds `payroll:entry`
too, so a single-permission gate covered every current holder of either. True the day it was written,
but it silently assumed that coincidence would keep holding for every future role — the first time a
non-Master-Admin role could plausibly hold `corrections:approve` alone (this checkpoint's own verification
step required constructing exactly such a user), the assumption broke.

**Production fix (frontend only, no backend change):** `NavItem.requiredPermission` broadened to
accept `PermissionKey | PermissionKey[]` (OR semantics on an array); the Corrections nav item now
declares `['payroll:entry', 'corrections:approve']`. A new `isNavItemVisible` (moved into
`nav-config.ts`, pure logic, no JSX) evaluates it; `sidebar.tsx` now calls it instead of inlining the
check. A new `frontend/src/lib/permissions.ts` centralizes the corrections-domain permission rule
(`hasPermission`, `hasAnyPermission`, `canAccessCorrections`, `canViewCorrectionsLedger`,
`canReviewCorrectionRequests`, `canRequestCorrection`, `defaultCorrectionsTab`) as the one frontend
source of truth mirroring the backend's own `ENTRY_VIEW_PERMISSIONS`/`BALANCE_VIEW_PERMISSIONS`
convention; `corrections-page.tsx`, `correction-request-detail-page.tsx`,
`balance-adjustment-detail-page.tsx`, and `payroll-entry-page.tsx`'s "Request Correction" gate were
all switched from ad hoc inline `user.permissions.includes(...)` checks to this shared helper
(behavior-preserving — every one of those checks was already correct; this only removed duplication,
per this project's standing "no duplicated utilities" checklist item). No permission key added, no
schema change, no migration.

**A genuine, previously-untested interaction surfaced during verification, not a defect:**
`corrections:approve` has only ever been held by Master Admin until this checkpoint's own test user
construction. `listCorrectionRequestsForUser` (`corrections.service.ts`) site-scopes the Review Queue
to `currentUser.siteIds` for any non-`MASTER_ADMIN` caller — the same site-scoping every other
non-Master role (Payroll Staff, Finance) already has, applied uniformly, not something this checkpoint
introduced or should relax. A reviewer-only test user with no site assignment correctly sees an empty
Review Queue; the Playwright reviewer and backend test users below were both given an explicit site
assignment, exactly as existing Payroll-Staff/Finance test-user fixtures already do.

**Frontend tests added:** `frontend/src/lib/permissions.test.ts` (18 tests — `hasPermission`/
`hasAnyPermission`, and every corrections-domain predicate including all four `defaultCorrectionsTab`
cases: reviewer-only → queue, payroll-entry-only → ledger, both → queue, neither → null);
`frontend/src/components/layout/nav-config.test.ts` (8 tests — general `isNavItemVisible` behavior
plus the four Corrections-sidebar-specific cases: payroll:entry-only/corrections:approve-only/
both/neither). Both follow this repo's existing pure-logic `.test.ts` convention (no jsdom/React
Testing Library introduced) — the real rendered behavior is covered by Playwright below.

**Playwright:** `tests/e2e/specs/07-corrections.spec.ts` gained Scenario 6 (reviewer-only navigation)
plus a new `tests/e2e/helpers/create-scoped-user.ts` (direct-Prisma user creation for a permission
combination no seeded role — `MASTER_ADMIN`/`PAYROLL_STAFF`/`FINANCE` — can produce via the real
`POST /api/v1/users` API; login itself still goes through the real form, same as every other spec).
Also fixed one unrelated pre-existing strict-mode locator ambiguity in Scenario 3 (`getByText('REJECTED')`
case-insensitively matched both the status badge and the "Correction request rejected" toast) — a
test-only fix, required for a clean full-suite run, uncovered by but independent of this checkpoint's
own change.

**Verification:** backend **781/781** (one clean run; **770/781** with the same 11 pre-existing
`payslips.test.ts` failures on other runs, confirmed environment-load flakiness, not a regression —
zero backend files were modified this checkpoint); frontend **61/61** (35 baseline + 26 new); **E2E
21/21** (20 baseline + 1 new Scenario 6, plus the Scenario 3 locator fix); `prisma validate`/`migrate
status` — still 17 migrations, zero drift; `typecheck`/`lint` clean across all workspaces (`shared`,
`backend`, `frontend`, E2E); production builds clean for `shared`, `backend`, `frontend`.

**Explicitly confirmed at close of this checkpoint:** reviewer-only users can now discover Corrections
through the sidebar; reviewer-only users can access the Review Queue (given a site assignment, same
requirement every other non-Master role has); reviewer-only users cannot request corrections without
`payroll:entry` (unchanged — gated in `payroll-entry-page.tsx`, never a Corrections-page tab);
payroll-entry-only users cannot approve or reject (unchanged); unauthorized users (neither permission)
cannot access Corrections (unchanged — `CorrectionsPage`'s own access-denied state); no new permission
key was added; no backend financial behavior changed; no schema migration was added. **Checkpoint 6 is
now fully closed.**

### Phase 6 Checkpoint 7 — End-to-End Financial Lifecycle Validation, Audit Hardening & Phase 6 Close-Out — COMPLETE, COMMITTED as `4812971`, Phase 6 CLOSED

Repository preflight confirmed: branch `main`, working tree clean, commit `9d6a39b` (Checkpoint 6A)
present, baseline backend **781/781** (one clean run observed; the same up-to-11 pre-existing
`payslips.test.ts` failures on other runs, confirmed environment-load flakiness, not deterministic) /
frontend **61/61** / E2E **21/21** / 17 migrations / `prisma validate` clean / migration status clean /
zero schema drift. A validation-first checkpoint, not a feature checkpoint — its purpose was to prove
every Checkpoint 1–6A lifecycle behaves correctly as one integrated system, not to introduce new
functionality.

**Lifecycle matrix and Flow A–E review found the audit trail, API/error consistency, permissions,
reporting, and exports already correct** (see the sub-sections below) — **but found one genuine,
load-bearing correctness gap that blocked Flow A and Flow B from ever reaching their own documented
end state.** The `ACTIVE -> CONSUMED` `BalanceAdjustmentMaterialization` transition — explicitly
deferred by every checkpoint from 4 through 6A as "a later checkpoint's own event" — had never been
built. Consequence, traced precisely: `corrections.settlement.ts`'s `RESERVED_AMOUNT_UNAVAILABLE`
ceiling (Checkpoint 5A) correctly computes `availableForSettlement = remainingAmount −
Σ(ACTIVE reservations)`; once an obligation's entire `remainingAmount` is reserved by materialization
(the normal case), that ceiling is permanently `0` for *any* cycle, forever — no supported workflow
could ever mark a materialized `DEFERRED PAYABLE`/`RECOVERY` obligation `SETTLED`. The employee was
physically paid (or had the recovery deducted) via that cycle's own release — `computeEntryCalc`
already folds `correctionBalancePayable`/`.correctionBalanceRecovery` into `calcNet`, so Bank
Sheets/Cash Receiving Sheets/Payslips, all built on the same shared `computeEntryCalc`, already
correctly reflected the paid amount — but the `BalanceAdjustment`'s own ledger record stayed `PENDING`
forever, permanently visible as outstanding in the Corrections Ledger. This directly blocked Required
Playwright Scenarios 1 ("PAYABLE lifecycle **to payroll completion**") and 2 ("RECOVERY lifecycle...
until outstanding **reaches zero**") from ever completing as specified. Flagged to the user before any
implementation; the user confirmed this is a genuine Phase 6 correctness gap requiring a fix, not
deferred Phase 7 work, and specified the exact ownership model below.

**Fix — release-time consumption, not the ordinary settlement endpoints.** An `ACTIVE` materialization
is committed to a specific Draft cycle; its settlement event is that cycle's own release, not a
separate administrative action. `payroll-release.service.ts`'s `releaseProjectUnit` — the exact moment
a `PayrollEntry` transitions `released: false -> true`, the schema's own definition of "the triggering
PayrollEntry release" a `DEFERRED PAYABLE`/`RECOVERY` settles through (`database/balance-adjustments.md
§14`) — now:
1. Acquires `lockPayrollCycleForUpdate` first (new — this transaction previously took no cycle-level
   lock at all), becoming a third participant in Checkpoint 5's documented "cycle, then adjustment"
   lock order, alongside Draft-cycle materialization; this also closes a pre-existing, unrelated race
   for free (a stale pre-transaction `status === 'DRAFT'` check is now re-verified under lock).
2. Immediately after the existing `toRelease` sweep, calls the new
   `consumeMaterializationsForReleasedEntries` (`corrections.materialization.service.ts`) — scoped to
   exactly the `PayrollEntry` ids that just flipped `released: true` in this call, nothing else.
3. For each `ACTIVE` materialization found (sorted by `balanceAdjustmentId` for deterministic
   cross-adjustment lock ordering): acquires `acquireBalanceAdjustmentLock` (Checkpoint 4's existing
   lock, unchanged), re-reads the `BalanceAdjustment` post-lock, and reuses `calculateSettlement`
   unchanged — passing *other* active reservations (this materialization's own amount excluded) as the
   ceiling, since this settlement is what fulfills this reservation, not a second independent claim
   against it.
4. Creates one `BalanceAdjustmentSettlement` (`amountApplied` = the materialization's own reserved
   amount, never re-derived), updates `BalanceAdjustment.remainingAmount`/`.status` via the existing
   conditional, optimistic-concurrency `updateBalanceAdjustmentAfterSettlement`, flips the
   materialization `ACTIVE -> CONSUMED` with its `settlementId`/`consumedAt` populated (columns
   `BalanceAdjustmentMaterialization` had carried unused since Checkpoint 5's own schema — **no
   migration required**), and writes one `balance_adjustment.settled` audit event
   (`metadata.triggeredBy: 'RELEASE'` distinguishes it from a manually-recorded settlement in the same
   audit trail).
5. All inside `releaseProjectUnit`'s own existing transaction — a failed release leaves no settlement,
   no consumption, and no audit residue, proven by a dedicated rollback test (`jest.spyOn` throwing on
   the release-time audit call, same precedent `payroll-cycle-rollover.test.ts` established).

**Companion eligibility fix, included at the user's explicit direction — required for the above to be
race-safe.** `determineMaterialization` never checked whether the target `PayrollEntry` was already
released — only that it existed. Without a guard, a concurrent manual materialization could still
target an entry mid-release, writing into a supposedly-immutable released entry's aggregate columns
and creating a reservation no future release event for that entry could ever consume — the identical
stuck-forever failure mode being fixed, reached a different way. New skip reason
`TARGET_ENTRY_ALREADY_RELEASED`; `targetEntryReleased` threaded through
`corrections.materialization.ts`/`.types.ts`/`.service.ts` and `listEntriesForCycle`/
`getPayrollEntryForEmployeeInCycle` (`corrections.repository.ts`).

**Explicitly out of scope, by the user's own stated boundary:** the `CANCELLED` materialization
transition. If an entry is `hold`-marked after its obligation already materialized into that cycle,
that one reservation stays `ACTIVE` forever (never released, so release-time consumption never fires
for it) — a narrow, pre-existing edge case, not introduced by this fix, and no rollback/lifecycle
requirement has yet proven `CANCELLED` necessary to close it. Documented, not built.

**Audit review** (full catalogue traced file:line): every financial write in the corrections domain —
`CorrectionRequest` creation/approval/rejection, `Correction`/`BalanceAdjustment` creation,
materialization, standalone payment, cycle-scoped settlement, and the new release-time consumption —
has exactly one `recordAuditLog` call in the same transaction, none inside a retry loop, none
double-fireable on a lost optimistic-lock race (every write path's conditional `updateMany`/lock guard
sits before its audit call). No duplicate audit events, no audited failed transactions, no financial
write found without a corresponding audit entry.

**API/error consistency review:** `CorrectionValidationError`/`SettlementValidationError`/
`MaterializationValidationError` all produce the identical `{ error: { code, message } }` shape via
exhaustive `Record<ErrorCode, number>` status maps (`error-handler.ts`) — no shape divergence. The
three list endpoints (`GET /correction-requests`, `GET /balance-adjustments`, `GET
/payroll-entries/:entryId/corrections`) are consistently unpaginated — appropriate, not a defect, given
every corrections-domain table's own documented row-count expectation ("tens per month," "a subset of
Correction rows," "single digits") — but their filter surfaces genuinely differ (2 fields / 3 fields /
0 fields); left as-is, a real but pre-existing and cosmetic inconsistency, not a functional defect
warranting a change under this checkpoint's own "minimal harmonization only" policy.

**Reporting/export review:** Bank Sheets, Cash Receiving Sheets, and Payslips all reuse the single
shared `computeEntryCalc` (`payroll-entry.service.ts`), which already folds
`correctionBalancePayable`/`.correctionBalanceRecovery` into `calcNet` — so every one of them already
correctly, automatically reflects a materialized-and-now-consumed correction balance with zero
additional integration work, a positive finding rather than a gap. Historical `PayrollEntry` rows
remain immutable; `Correction` values never overwrite history; released/archived cycle data is
untouched by this checkpoint's changes beyond the two new `BalanceAdjustmentMaterialization` columns
this checkpoint populates. Payslip's own per-line correction breakdown (the workflow doc's
"Representation... on Payslips" section) and the Statement of Account remain explicitly out of scope —
unbuilt since before Checkpoint 6, confirmed still Phase 7 work, not silently expanded here.

**Permission review:** no new permission key was introduced; every new/changed code path reuses
`payroll:entry`/`corrections:approve`/`payroll:release` exactly as already established.

**Performance review:** no N+1 queries found in the Review Queue/Ledger list routes (both use a single
Prisma `include`, not per-row follow-up fetches); the new release-time consumption loop is bounded by
one Unit's own headcount's worth of materializations (typically 0–2), the same bound
`releaseProjectUnit`'s own pre-existing per-entry audit loop already has. No speculative optimization
performed.

**Files created:** `backend/tests/corrections-release-consumption.test.ts` (9 tests — full PAYABLE
consumption, multi-cycle RECOVERY installments consumed one release at a time reaching `SETTLED` only
on the final one, release-failure rollback, repeated/idempotent release, concurrent release, unrelated
materializations left untouched, the reservation ceiling still rejecting an over-large standalone
settlement, exactly-once audit, and the companion eligibility guard).
**Files modified:** `corrections.materialization.service.ts` (the new
`consumeMaterializationsForReleasedEntries`, `employeeIdToEntry` map threading), `corrections.materialization.ts`
(`targetEntryReleased` check), `corrections.materialization.types.ts` (new field + skip reason),
`corrections.repository.ts` (`listActiveMaterializationsForEntries`, `consumeMaterializationRow`,
`listEntriesForCycle` now selects `released`), `payroll-release.service.ts` (`releaseProjectUnit`'s new
cycle lock + consumption call, `ReleaseUnitResult.correctionSettlementsConsumed`),
`tests/e2e/specs/07-corrections.spec.ts` (Scenario 4 extended to release the new Draft cycle and verify
`SETTLED`/`CONSUMED`/a real settlement row — the first point in this suite's history the full PAYABLE
lifecycle could ever be observed reaching completion), `backend/tests/corrections-materialization.test.ts`
(fixture `targetEntryReleased` field + one new eligibility test), `backend/prisma/schema.prisma`
(comment-only — updated `MaterializationStatus`/`BalanceAdjustmentMaterialization`/
`BalanceAdjustmentSettlement.materialization` doc comments to record that Checkpoint 7 is the "later
checkpoint" they referenced; zero schema/migration change),
`docs/architecture/workflows/corrections-and-balance-adjustments.md` (new dated Checkpoint 7 scope
note).

**Verification performed:** `prisma validate`/`migrate status` — still 17 migrations, zero drift
(confirmed after the comment-only schema edits too); full backend suite **791/791** (781 baseline + 9
new, one query-planner-sensitivity-under-load transient failure in
`payroll-entry-performance.test.ts` reproduced the project's own already-documented flaky pattern,
confirmed by a clean isolated re-run, unrelated to this checkpoint's changes); frontend suite **61/61**
(unchanged); **E2E 21/21** (unchanged count — Scenario 4 extended in place, not added as a new
scenario); `typecheck`/`lint` clean across all workspaces (`shared`, `backend`, `frontend`, E2E), same
6 pre-existing frontend `react-refresh` warnings, zero new; production builds clean for `shared`,
`backend`, `frontend`.

**Explicitly confirmed at close of this checkpoint:** historical payroll remains immutable; every
correction financial action remains immutable (settlement/consumption is create-only — no
`BalanceAdjustmentSettlement`/`BalanceAdjustmentMaterialization` row is ever updated or deleted, only
the materialization's own `status`/`settlementId`/`consumedAt` transition once, `ACTIVE -> CONSUMED`,
guarded by a conditional `updateMany`); reservation protection is enforced end-to-end (standalone/
cycle-scoped settlement still rejects any amount exceeding the unreserved balance, proven by a
dedicated regression test); no duplicate financial processing is possible through any supported
workflow (idempotent release, concurrent-release-safe, materialize-then-release-then-settle no longer
possible since consumption happens automatically and settlement of a `SETTLED` adjustment is rejected
outright); no backend financial calculation was duplicated in the frontend; no new permission key was
introduced; no schema migration was added (the fix uses columns Checkpoint 5's own migration already
created but left unused). **Phase 6 is now complete and closed.** Phase 7 has not been started.

### Phase 6 Checkpoint 7A — Prototype Completion & UX Documentation — COMPLETE, COMMITTED as `039b109` (no production code changed)

**The missing Phase 6 living HTML prototype was created.** `docs/prototypes/phase6-corrections-preview.html`,
following the exact shell/CSS convention every prior phase's prototype already established (reused
verbatim from `phase4-advances-preview.html`, not reinvented — same `:root` palette, sidebar/topbar/
main-content shell, card/filters-row/data-table/badge/modal markup). Thirteen tabs, each traced to
the real implementation rather than designed fresh: Review Queue and Corrections Ledger (both tabs
of the real `corrections-page.tsx`, exact table columns, exact filters, exact hint copy), Request
Correction (`request-correction-modal.tsx`, including its live preview panel and delta-classification
badge), a dedicated Preview screen with three switchable examples (PAYABLE/RECOVERY/ZERO_DELTA, the
last showing the exact rejection copy `ZERO_DELTA` produces), Approve (`approve-request-modal.tsx`,
including the fresh-preview box, PAYABLE-timing vs. RECOVERY-installment switch, reversal-reference
select, and the immutability warning verbatim), Reject (`reject-request-modal.tsx` verbatim), Balance
Adjustment Detail (`balance-adjustment-detail-page.tsx` — Outstanding Balance's four figures,
Materializations table, Settlement History table), a dedicated Materialization History screen and a
dedicated Settlement History screen (both showing every real status value, including `CANCELLED` as
an explicitly-labeled disabled placeholder — no code path creates one as of Checkpoint 7, correctly
not fabricated as a real example), Payroll Entry integration (the real Archived read-only banner,
`Request Correction` toolbar action, and both outbound links), a UI-states gallery (loading/empty/
success/validation-error/409-conflict/permission-denied/reservation-blocked/`ZERO_DELTA`, each using
real copy pulled from the actual component/error-handler source), and a Permissions screen with four
switchable role examples (Payroll Staff, Reviewer, Master Admin, Unauthorized) matching the real
`ENTRY_VIEW_PERMISSIONS`/`BALANCE_VIEW_PERMISSIONS`/Checkpoint 6A sidebar-visibility rules exactly.

**Two places where the checkpoint brief's own requested table columns diverged from the live UI**
(Materialization History's "Payroll Entry"/"Trigger" columns; Settlement History's "Remaining after
settlement" column) **were resolved in favor of implementation fidelity, per this checkpoint's own
"represent only implemented functionality, do not invent features" instruction** — the actually-
implemented columns are shown, with a caption explaining where that data really lives (audit-event
metadata for the former; the parent `BalanceAdjustment`'s own live aggregate, not a per-row snapshot,
for the latter) rather than fabricating UI columns that don't exist in the real app.

**A real layout defect was found and fixed during verification, not left in the delivered file:**
thirteen meta-banner tabs wrapped to two lines at 1280px, breaking the shared prototype shell's
hard-coded `37px` banner-height assumption (`.sidebar { inset: 37px 0 0 0; }`, `calc(100vh - 37px)`)
inherited from every prior single-line-banner prototype — the sidebar rendered clipped/overlapping.
Fixed by making `.meta-tabs` horizontally scrollable (`overflow-x: auto`, `flex-wrap: nowrap`) and
shortening tab labels, keeping the banner a fixed, verified `37px` at every tab.

**Verified with a headless-browser pass** (Chromium via Playwright, already available for this
repo's E2E harness) over all 13 meta-tabs and all 9 inner-example toggle buttons (Preview's three
classifications, Approve's two timing examples, Permissions' four roles): zero console/page errors,
exactly one `.screen.is-active` at every step, confirmed `37px` banner height. Manually reviewed at
1280px and 480px viewports — the 480px view keeps the sidebar fixed and lets wide tables scroll
horizontally within their own `.table-scroll` container, the same responsive fallback every sibling
prototype already uses (not a mobile-first redesign).

**No production code changed** — this checkpoint touched only `docs/prototypes/` and the two
documentation files below. No backend file, no frontend file, no schema, no migration.

**Files created:** `docs/prototypes/phase6-corrections-preview.html`.
**Files modified:** `docs/PROJECT_PROGRESS.md`, `docs/SESSION_HANDOFF.md` (this entry and its
session-handoff counterpart only — no implementation documentation, e.g. the corrections workflow
doc or `IMPLEMENTATION_PLAN.md`, was touched, since no implementation changed).

---

### Post-Phase-5 Stabilization Checkpoint 5 — Administration & Security Management Phase 1 (Dynamic Roles, Permission Matrix, User Role Assignment) — COMPLETE, COMMITTED as `bf1a749`/`5983232`/`2e4c81f`, NOT PUSHED

**Removes the operational blocker preventing structured team testing**: a Master User
(`users:manage`) can now create business-specific roles at runtime — name, optional description,
and a permission-matrix selection from the full catalog — rename, duplicate, activate/deactivate,
and delete them, and reassign a user's single role, all without a source-code change or
redeployment. Follows on from this same session's Post-Phase-5 Stabilization Checkpoints 4A
(payroll-state validation), 4B (role/permission validation, remediated and committed as `abb68a3`),
and 4C (CSRF race investigation, root-caused but explicitly deferred, not fixed here).

**Schema**: `Role` gains `isActive` (deactivating a role immediately strips its *existing* holders'
effective access — `auth.service.ts` treats `!role.isActive` exactly like `!user.isActive` — a
deliberate, documented deviation from this schema's usual `Bank`/`ProjectSite` "isActive blocks new
links only" convention) and `isSystemRole` (the sole, name-independent signal that Master
Admin/Payroll Staff/Finance can never be deleted; never inferred from `name` or `code`).
Migration `20260722145122_role_admin_fields`.

**Backend**: new `/api/v1/roles` module (list/detail/create/update/duplicate/delete/assigned-users),
all gated on `users:manage`. A permission-based "final active administrator" safeguard
(`CRITICAL_ADMIN_PERMISSIONS`: `users:manage`, `settings:manage`, `sites:manage`, `audit-log:view` —
deliberately excluding `payroll-cycle:manage`, see `docs/architecture/authentication.md`'s new
section for the rationale) blocks deactivating a role, or reassigning/deactivating a user, whenever
it would leave zero qualifying administrators — defined entirely by capability, never by role name
or code. User creation/update now take `roleId` (not the old `roleCode` enum); reassigning a user's
role validates the destination role, applies the same safeguard, writes a dedicated
`user.role_changed` audit entry, and revokes every existing session for that user
(`invalidateAllSessionsForUser`) so the change requires a fresh login. `prisma/seed.ts` is now
bootstrap-only — it grants each system role's permissions only the first time a role code is seen,
never overwriting an administrator's later edits on routine re-seed (verified live: stripping a
permission from Payroll Staff and re-running seed left it stripped).

**Frontend**: a new "Roles & Permissions" page (role list with permission/assigned-user counts and
active/system badges; Create/Edit/Duplicate modals sharing one reusable grouped permission-matrix
component, `components/roles/permission-matrix.tsx`) alongside the existing Users page. Every role
selector (Create/Edit User) now loads roles from the API — no compile-time `MASTER_ADMIN`/
`PAYROLL_STAFF`/`FINANCE` enum anywhere in this new code — and the Edit User form now warns that
changing a user's role signs them out of every active session.

**Explicitly retained, not touched**: one role per user, the relational `Permission`/`RolePermission`
tables, `User.roleId`, the existing permission middleware and site-scope enforcement, and
session-reloading of permissions from the database on every request. **Explicitly not added**:
multiple roles per user, per-user permission overrides/denials, permission inheritance, role
hierarchy, or any role-name-based authorization check in new code (the small set of pre-existing
`roleCode === ROLE_CODES.MASTER_ADMIN` legacy bypasses — site-scope, `users.service.ts`'s
site-assignment skip, `tasks-panel.tsx`'s `isMasterUser` — were reviewed and deliberately left in
place; none of them block this phase's own functionality, since custom roles work correctly
precisely by *not* being recognized as Master Admin). **The Checkpoint 4C CSRF race remains a
separate, still-open, unfixed issue** — no CSRF file was touched this checkpoint.

**Verification**: backend 44 suites / 851 tests, frontend 9 files / 80 tests, both typecheck/lint/
build clean, `prisma validate` and `prisma migrate status` both clean (19 migrations, schema up to
date). Full E2E suite (Playwright/Chromium, disposable Postgres, production frontend build)
**27/27 passing**, including a new `08-role-administration.spec.ts` covering: six named
team-testing roles created (plus one duplicated role, confirming the original is left unchanged);
one user per role with site assignment created through the real UI; logins as the Employee
Registry, Corrections Reviewer, and Reports Viewer testers confirming nav/route/API/site-scope
enforcement and that a real CSRF-attached mutation is still rejected by permission, not just by
missing CSRF; a role rename leaving its user's access unaffected; a permission removal taking
effect on the very next request from an already-logged-in session; a user's role reassignment
producing an audit entry, session revocation, and updated permissions on re-login; and rejection of
an assigned-role deletion, a final-administrator-stripping role deactivation, and assignment of an
inactive role. Three defects were found and fixed in the *test spec itself* during this
verification (not the application): a heading assertion targeting the topbar's non-semantic title
div instead of the page's real `CardTitle`; several raw `context.request` calls using a relative
path that silently hit the frontend's static preview server instead of the backend (no `baseURL`
proxy exists in production-build mode); and a `.first()` site-checkbox selection that could pick
the wrong site once other specs' fixture sites already existed in the same disposable database. All
9 required screenshots captured to `test-results/role-administration-screenshots/` (gitignored, not
committed). The pre-existing `04-session-revocation.spec.ts` was also fixed — the `roleCode` →
`roleId` schema change had broken its own user-creation call — with no weakening of its assertions.

**Not pushed, not deployed**, per this checkpoint's explicit instruction — three commits ahead of
`origin/main` (`bf1a749`, `5983232`, `2e4c81f`) awaiting the user's own decision to push.

---

### Post-Phase-5 Stabilization Checkpoint 4D — CSRF Concurrent First-Request Race, fixed

> **Superseded, 2026-07-23 (same day).** The design below (an in-memory map coalescing concurrent
> requests, keyed by `req.ip`) was rejected on review — see the "Checkpoint 4D Correction and UAT
> Defect Remediation" entry further down for why and for the corrected design. Kept here, not
> deleted, as an honest record of what was tried; do not implement this specific design again.

**Implements the fix for the race Checkpoint 4C root-caused but explicitly deferred** (see that
entry, and the entry directly above): two requests arriving before either had round-tripped its
`Set-Cookie` back to the browser — two tabs opened together, or several parallel first-load
requests from one tab — each minted a *different* CSRF token, and the browser's one shared cookie
jar could only end up holding one of them, producing an intermittent 403 "Missing or invalid CSRF
token" for whichever tab's in-memory copy lost that race.

**Fix — backend-owned, no redesign**: `issueCsrfCookie` (`backend/src/common/middleware/csrf.ts`)
now mints a "first contact" token through `firstContactToken`, a short-lived (3s), in-memory,
per-process map keyed by `req.ip` — concurrent cookie-less requests from the same client converge
on one identical token instead of each minting its own. The double-submit-cookie model itself, its
cookie attributes (`SameSite`/`Secure`/`httpOnly`), and its timing-safe comparison
(`csrfProtection`/`tokensMatch`) are all completely unchanged — this only changes *what value* gets
minted when two requests race, never the verification logic. Middleware ordering
(`session` → `issueCsrfCookie` → `csrfProtection` → `attachUser`) is unchanged. **No frontend change
was required or made** — `frontend/src/lib/api-client.ts` already just reads whatever the response
header says; the fix is entirely a backend issuance-time change.

**Token rotation, added alongside the fix**: a new `rotateCsrfCookie` issues a brand-new token and
echoes it in the response header of that same request (including on state-changing responses, which
normally never carry the header), called after every event that already rotates or destroys the
session — successful login (`backend/src/modules/auth/auth.routes.ts`, alongside the existing
`req.session.regenerate`), logout, self-service `POST /auth/change-password`, and an admin's
`POST /users/:id/reset-password` (`backend/src/modules/users/users.routes.ts`) specifically when
resetting *their own* account (not when resetting someone else's, which leaves the acting admin's
own token untouched). A token learned before authentication is never still valid afterward, matching
the same rationale session-fixation protection already gets from regenerating the session ID.
Because `api-client.ts`'s `captureCsrfToken` already reads the header off *every* response, not just
safe ones, the frontend picks up a rotated token automatically, no code change needed there either.

**A necessary test-helper fix, caught by the existing suite**: rotating the token on login meant
`backend/tests/helpers.ts`'s `createAuthenticatedAgent` — used by the large majority of the backend
integration suite to log in once and then make several further authenticated calls — had to start
returning the token from the *login response* rather than the pre-login priming request, or every
caller's subsequent mutation would 403 against the now-rotated cookie. Two hand-rolled equivalents
in `backend/tests/auth.test.ts` (a direct `/logout` call and a local `loginAgent` helper feeding
`/change-password`) needed the same fix. Caught by simply running the existing suite after adding
rotation — no test assertions were weakened, only the token each already-passing test uses to keep
authenticating was corrected to match the new (deliberate) rotation behavior.

**Regression coverage**: `backend/tests/csrf-concurrency.test.ts` — 17 new tests: single fresh
request; genuinely concurrent first requests (`Promise.all`, exploiting the same
session-middleware-Postgres-lookup event-loop yield that made the original race possible, so the
test reliably exercises real interleaving rather than hoping for timing luck) converging on one
token, including an 8-way burst; token stability across repeated GETs; two independent cookie-jar
"tabs" converging on one token and each independently completing a real login; rotation on
login/logout/self-change-password/admin-self-reset-password, with the pre-rotation token confirmed
rejected afterward; admin-resets-someone-else's-password confirmed to *not* rotate the admin's own
token; CSRF mismatch still 403; unauthenticated requests still behave correctly (still issued a
token, still 403 without one, CSRF-before-auth ordering unchanged — a valid CSRF pair with no
session still 401s, not 403s). **Verified meaningful, not just green**: temporarily reverted the
coalescing fix and re-ran this file — the 4 concurrency/multi-tab tests failed exactly as expected
(the rest, being rotation/mismatch/unauthenticated tests unrelated to the race itself, correctly
kept passing), then the fix was restored and confirmed identical to the pre-experiment file via
`diff`.

`tests/e2e/specs/09-csrf-concurrency.spec.ts` adds the same scenarios through a real Chromium
browser and the real production frontend build — the one thing no `supertest`-driven backend test
can stand in for, since the original bug's defining characteristic was a *browser's shared cookie
jar* diverging from *per-tab JS module memory*: fresh-browser login; rapid reload before login;
five iterations of two real tabs (one `BrowserContext`, two `Page`s — genuinely shared cookies) both
navigating to `/login` concurrently and both independently completing login, with a live check that
no console error mentioning "csrf" appears in either tab; logout-then-login-again with the CSRF
cookie value asserted to actually change at each rotation point; and a dedicated non-Master-Admin
user's self-service password change through the real Settings UI, followed by a fresh login with
the new password, again asserting no CSRF console error anywhere in that flow.

**Verification**: backend **45 suites / 868 tests** (851 baseline + 17 new), typecheck/lint/build
all clean. Frontend **80/80** unchanged (no frontend file was touched), typecheck/lint/build clean.
Full E2E suite (Playwright/Chromium, disposable Postgres, production frontend build) **32/32
passing** — the 8 pre-existing spec files plus the new `09-csrf-concurrency.spec.ts`'s 5 scenarios.
One intermediate run hit 2 unrelated failures in `07-corrections.spec.ts`/
`08-role-administration.spec.ts` (a `SETTLED`-text visibility timeout and a permission-takes-effect
race) — neither file was touched by this checkpoint; re-running the affected spec in isolation and
then the full suite again both came back clean, consistent with this project's own
already-documented pattern of timing-sensitive E2E flakiness under sandbox system load
(`docs/PROJECT_PROGRESS.md`'s own `payslips.test.ts` precedent), not a regression from this
checkpoint's changes. The new spec's own "two tabs" scenario needed one fix during this same
verification pass: it originally used the shared `login()` fixture (which unconditionally
re-navigates to `/login`) for a second, sequential login attempt on an already-authenticated shared
cookie jar — the frontend's own already-authenticated redirect meant the login form never rendered
a second time, and separately, submitting sequentially rather than concurrently would have
legitimately collided with this checkpoint's own login-rotation feature (the first tab's login
correctly rotates the shared cookie, so a *second, sequential* login attempt on the same jar using a
now-stale captured token is supposed to fail — that's correct rotation behavior, not the race being
tested). Fixed by submitting both tabs' login forms concurrently via a local `submitLoginForm`
helper that doesn't re-navigate, matching the real "two tabs opened simultaneously" scenario more
precisely in the process.

**Not pushed, not deployed**, per this checkpoint's explicit instruction.

---

### Post-Phase-5 Stabilization Checkpoint 4D Correction and UAT Defect Remediation

**Three independent items in one session: correcting the rejected Checkpoint 4D CSRF design, and
fixing two UAT defects found in production usage.** All three implemented, tested, and documented
in one pass per the checkpoint's own instructions; none pushed or deployed.

#### 1. CSRF design correction — why the IP-keyed map was rejected, and the corrected design

Reviewed and rejected: the original Checkpoint 4D fix coalesced concurrent "no cookie yet" requests
into one token via an in-memory `Map` keyed by `req.ip`, with correctness resting on a fixed TTL
window. Two independent problems, either alone sufficient to reject it: **`req.ip` is not a browser
identity** — it identifies a network path, and unrelated users behind a shared NAT/corporate egress,
or behind Render's own proxy layer, can present the same IP without being the same client, meaning
the map could silently couple two different people's tokens together. **An in-memory map is
process-local** — its correctness depended on every racing request landing on the *same* Node
process within the TTL window, an assumption that holds in a single-instance dev/test sandbox but
breaks the moment the backend runs as more than one instance (the ordinary case for any real
deployment) or restarts mid-window. A mitigation that only works under those accidental conditions
is not a fix for a security-relevant race condition, regardless of how cleanly it passed every test
written against that same single-instance environment — a genuine blind spot in the original
checkpoint's own verification, not a flaw in the tests' execution.

**Corrected design — the backend no longer tries to prevent the race at all.**
`issueCsrfCookie` (`backend/src/common/middleware/csrf.ts`) reverted to the simplest possible
stateless rule: mint a token if the request has none, echo it on safe methods — identical to before
Checkpoint 4C ever started. The race can still happen; what changed is that it's no longer the
server's problem to solve:

- `csrfProtection` now rejects a genuine mismatch with a distinguishable error code
  (`CSRF_TOKEN_MISMATCH`, `common/http-error.ts`'s new `csrfMismatch` — deliberately distinct from
  the generic `FORBIDDEN` an ordinary permission denial uses) instead of the same generic code every
  other 403 already used.
- A new safe, unauthenticated, dependency-free endpoint, `GET /api/v1/csrf-token`
  (`backend/src/app.ts`, mounted beside `/health`), does nothing beyond what `issueCsrfCookie`
  already does for any safe request — echo the token bound to the request's existing cookie, mint
  one if it has none. Deliberately not `/health` (a liveness probe, semantically unrelated) or
  `/auth/me` (requires authentication and carries session-bootstrap React Query side effects a
  plain recovery call has no business triggering).
- `frontend/src/lib/api-client.ts`'s `apiRequest` performs **exactly one** controlled recovery when
  — and only when — it sees `CSRF_TOKEN_MISMATCH`: call the recovery endpoint, capture the token it
  returns, retry the original mutation once. A second mismatch (on the retry itself) is never
  retried again and surfaces as a normal `ApiError`. No other status/code (401, an ordinary 403
  permission denial, 400, 409, 422, 500) ever enters this path — the match is on the specific error
  code alone. Concurrent requests that all hit a mismatch around the same moment share one in-flight
  recovery call (`pendingCsrfRefresh`) rather than each firing their own, so a burst of failures
  can't turn into a refresh storm. The recovery call itself is a plain `fetch` outside `apiRequest`,
  never routed back through the retry logic, so this cannot loop by construction.

This keeps the double-submit-cookie model, its cookie attributes, and its timing-safe comparison
(`tokensMatch`) completely unweakened — every comparison is still a strict, real equality check —
and needs no shared state, no assumption about process topology, and no client identity signal at
all. **Token rotation is unchanged from the original design** (login/logout/self-service password
change/administrator resetting their own password rotate the token; resetting someone *else's*
password does not, since that only touches the target's own session/cookie jar, not the acting
administrator's) — rotation was not part of what got rejected, only the first-contact coalescing
map was.

**A necessary test-suite correction, caught by re-running the suite after the redesign**: the
original `backend/tests/csrf-concurrency.test.ts` asserted that concurrent first-contact requests
*automatically* converge on one token — true only under the rejected map design. Rewritten entirely
(19 tests) to verify the corrected, stateless design instead: normal double-submit validation;
mismatch still 403 with the specific code; the recovery endpoint's echo/mint behavior; **no
IP-based sharing** — two unrelated simulated clients on the same simulated IP mint independent
tokens and one's token never validates against the other's cookie; **no process-local-map
dependency** — two separately constructed `createApp()` instances (standing in for two backend
processes) issue independent tokens; rotation on every boundary, with the pre-rotation token
confirmed rejected afterward; full login→change-password→re-login flows; and no backend-side
automatic retry of any kind. New `frontend/src/lib/api-client.test.ts` coverage (7 tests) verifies
the recovery/retry logic itself with mocked `fetch`: one refresh + one retry on a recognized
mismatch; a second mismatch surfaced, not retried again; every non-CSRF status/code (401, 403, 400,
409, 422, 500) left completely alone; concurrent-mismatch dedup; and — spied via `vi.stubGlobal`
rather than `Storage.prototype` (this project's vitest config runs under plain Node, not jsdom, so
no real `Storage` global exists to spy on) — no `localStorage`/`sessionStorage` access at any point.
**Verified meaningful, not just green**: both the backend and frontend new-test files were
temporarily run against a reverted (pre-fix) version of the code first, confirmed to fail exactly as
expected, then the fix was restored and re-confirmed passing.

`tests/e2e/specs/09-csrf-concurrency.spec.ts` needed no changes to its own scenarios — the two-tab
race scenario now succeeds via the frontend's own retry-on-mismatch path instead of via backend
convergence, but the *observable* outcome (both tabs end up authenticated, no error surfaced) is
identical, and the existing spec already asserted exactly that outcome, not the mechanism behind it.

#### 2. UAT Defect 1 — custom role with `sites:manage` could not see the Sites list

**Root cause**: `listProjectSites` (`backend/src/modules/project-sites/project-sites.service.ts`)
granted unrestricted site visibility only to the literal seeded Master Admin `roleCode`; every other
role, including a custom role explicitly granted `sites:manage`, was scoped to its
`UserSiteAssignment` rows — empty by default for a brand-new role, since nothing existed yet to
assign it to. `createProjectSite` was, correctly, never site-scoped (a not-yet-created site can't
already be in anyone's assignments), which is exactly why create succeeded while list stayed empty
— an asymmetry between the two operations' authorization models, not a bug in either alone.

**Site-scope rule, confirmed from existing documentation, not invented for this fix**:
`sites:manage` is one of this system's `CRITICAL_ADMIN_PERMISSIONS`
(`shared/src/constants/permissions.ts`) — the same class as the already-unscoped
`users:manage`/`settings:manage`, both genuinely global administrative capabilities with no
"assigned site" concept. This settles the question the checkpoint asked directly: `sites:manage`
represents global site administration (option A), not assignment-scoped mutation (option B) — a
role holding it administers the Site *entity list itself*, structurally distinct from *operational*
site-scoping (which sites can this person enter payroll for), and that distinction, not a
name/role-code shortcut, is what the fix is keyed on.

**Fix**: `listProjectSites` now grants the same unrestricted visibility to any role — system or
custom — currently holding `sites:manage`, *alongside* (not replacing) the existing Master Admin
`roleCode === ROLE_CODES.MASTER_ADMIN` fast path, kept for the same reason that bypass is
role-identity-based everywhere else in this system (`require-site-access.ts`,
`employees.service.ts`'s `isMasterAdmin`): it must keep working even if Master Admin's own role were
ever edited to no longer explicitly hold `sites:manage`. No `roleCode` dependency was removed —
one was added alongside the existing ones, narrowly scoped to this one function. Every *other*
site-scoped check in the system (employees, payroll, `require-site-access.ts`) is unchanged —
`sites:manage` grants nothing there, deliberately, since operational site-scoping and Site-entity
administration are different questions.

**Frontend**: `project-sites-page.tsx`'s Sites list now distinguishes a query error from a genuine
empty list (`error` destructured from `useProjectSites()`, following the same pattern already
established by `advances-page.tsx`/`corrections-page.tsx`/etc.) — "Could not load Sites" instead of
silently falling through to "No project sites yet" for a non-empty-list reason. In practice, the
route-level `RequirePermission` guard (`App.tsx`) intercepts before the Sites page ever mounts once
`sites:manage` is gone, showing the shared "access denied" page instead — this inline fix is the
defense-in-depth layer for a query that fails while the page is already mounted (e.g. a transient
backend error), not the only thing preventing a false empty state.

**Verification**: `backend/tests/project-sites.test.ts` gained a dedicated block (6 new tests): a
custom role with `sites:manage` and zero assignments lists every site; create-then-list works; role
rename doesn't change access; a custom role literally named "Master Admin" gains nothing (only the
real seeded role's `code` matters, never a name); Master Admin's own behavior is unchanged; a
site-scoped user without `sites:manage` still sees only their own assignments (no leak from the
fix). `tests/e2e/specs/10-site-visibility.spec.ts` (2 tests) drives the full real-stack reproduction
through the real UI — create sites, create a custom Payroll Manager role and user through the real
Roles/Users pages, log in as that user, confirm existing and newly-created sites both appear without
logout, confirm a browser refresh preserves the data, confirm the direct API response matches the
UI, confirm renaming the role changes nothing, and confirm removing the permission removes access on
the very next request with no forced logout — plus a second test confirming a role with zero
qualifying permissions cannot enumerate sites at all (403, not a filtered 200).

#### 3. UAT Defect 2 — Roles & Permissions dialog excessive scrolling / frame desync

**Root cause**: the permission matrix (`frontend/src/components/roles/permission-matrix.tsx`) had
its own independently `max-h-[420px]`/`overflow-y-auto` scroll region nested *inside*
`ModalContent`'s own `max-h-[85vh]`/`overflow-y-auto` region (`frontend/src/components/ui/modal.tsx`)
— two competing scroll contexts in one dialog, with neither the header nor the footer pinned in
place. Every *other* modal in the app uses the same outer `ModalContent` pattern without a second
nested scroll region and was confirmed unaffected — this was the Roles dialog's own, unique
divergence, not a defect in the shared component's base design.

**Fix — shared component, not a one-off page patch** (per the checkpoint's own preference: "fix the
shared component if the root cause is shared," and this bug's fix benefits from a more robust
structure regardless): `ModalContent` (`components/ui/modal.tsx`) is now a genuine flex column —
fixed max-height (`max-h-[85vh]`, still overridable per call site), a non-scrolling header
(`shrink-0`), and exactly **one** scrolling body (`min-h-0 flex-1 overflow-y-auto` — the `min-h-0`
is required, not decorative, or a flex child never shrinks below its own content's natural height
and the parent's height cap silently stops doing anything, the standard flexbox-scrolling pitfall).
`ModalFooter` is now `sticky bottom-0` *within* that same scroll region (with a matching
`rounded-b-lg` so its flush background doesn't poke past the dialog's own rounded corners), so it
stays reachable at the bottom without needing every caller to restructure how it composes
header/body/footer — still three children in document order. The permission matrix's own inner
scroll region was removed entirely; every other of the 10 call sites across the app that had opted
into scrolling via `overflow-y-auto`/a matching `max-h-[85vh]` in `widthClassName` had that removed
too (now redundant, handled internally); call sites with a genuinely different height
(`max-h-[75vh]`/`max-h-[80vh]` for a couple of Import Results/Sites modals) kept their own override.

**Verification, measured not just screenshotted**: `tests/e2e/specs/11-permission-dialog-layout.spec.ts`
runs against a role holding the *entire* permission catalog (guaranteed to overflow) at all three
required viewports (1366×768, 1440×900, 1920×1080), checking: the dialog's bounding box stays fully
within the viewport; **no nested scrollable regions exist** (the actual structural bug — checked by
CSS `overflow-y` property directly on every element inside the dialog *including the dialog element
itself*, not by inferring it from measured overflow amounts, which turned out to depend on exact
content height and passed even against the bug on a first attempt at this test — see the note
below); the one recognized scroll region's overflow amount is present but bounded (rules out a
runaway value); the dialog's own position does not move while scrolling internally (the literal
reported "frame stays behind" symptom); the footer remains visible and clickable after scrolling to
the bottom; the overlay still fully covers the viewport; and closing restores the underlying page.
Screenshots captured at top/middle/bottom scroll position for each viewport
(`test-results/permission-dialog-layout-screenshots/`, gitignored). A separate test confirms two
other, unrelated dialogs (New User, New Project Site) still open and close correctly, unaffected by
the shared-component change.

**A real defect in the test itself, found and fixed during this same verification pass**: the first
version of this spec measured "is there exactly one element whose `scrollHeight` currently exceeds
its `clientHeight`" — reverting the fix and re-running showed this still passed, since the outer
frame didn't happen to overflow its own `max-h-[85vh]` at the content size tested (the inner,
independently-capped 420px box absorbed enough of the content that the outer total stayed under the
cap). Rewritten to check the CSS `overflow-y` property structurally on every element instead
(nested-scrollable-inside-scrollable, regardless of whether either currently overflows) — re-run
against the reverted code and confirmed to fail (3/4 tests, exactly the three viewport-scroll tests,
with the fourth, unrelated-dialogs test correctly still passing), then re-confirmed passing against
the real fix. A second, smaller defect in the same first draft — `dialog.evaluate((dialogEl) =>
dialogEl.querySelectorAll('*'))` excludes `dialogEl` itself, which is exactly where the historical
bug's outer `overflow-y: auto` lived — was found and fixed in the same pass.

#### Verification totals (this entry)

Backend: **876 tests**, 45 suites — no new suite *file* (both `csrf-concurrency.test.ts` and
`project-sites.test.ts` already existed; only their content changed): 868 prior, net +2 from
replacing 17 old (map-dependent) CSRF tests with 19 corrected ones, net +6 from the new Sites block.
Full suite run clean twice in a row after an initial run's 11 `payslips.test.ts` failures were
confirmed to be this project's own already-documented system-load-dependent flake (re-ran that file
alone: 47/47) rather than a regression — no code in that module was touched, and it also passed
cleanly the second time as part of the full suite. typecheck/lint/build/`prisma validate`/`prisma
migrate status` all clean; 19 migrations, no new migration introduced (no schema change in this
correction). Frontend: **91 tests** (80 baseline + 11 new in `api-client.test.ts`'s CSRF-recovery
block), typecheck/lint (6 pre-existing warnings, unchanged)/build all clean. E2E: **38/38** (27
prior + 2 Sites + 4 dialog + 5 CSRF, with CSRF's own scenario count and content unchanged from
before — no spec was removed, and the two-tab scenario needed no edits since the *outcome* it
asserts didn't change, only the mechanism producing it).

**Not pushed, not deployed**, per this checkpoint's explicit instruction.

---

### Pre-Deployment Reliability Checkpoint — Payslip PDF Full-Suite Flakiness

**Investigated and substantially improved (not claimed fully eliminated) the intermittent
`payslips.test.ts` failures observed during the previous checkpoint's own full-backend-suite runs
(11 failures in one observed run, isolated reruns passing).** Per this checkpoint's own explicit
instruction, "pre-existing" and "passes in isolation" were not treated as sufficient — this was a
genuine investigation with controlled, repeated reproduction, not a re-labeling.

**Reproduction, done properly before any fix**: 20 isolated `payslips.test.ts` runs and 10 full
`npm test` runs, with `vm_stat`/Chrome-process-count sampling throughout. Isolated: 18/20 clean,
2/20 failed (runs 9 and 19) — both genuine PDF/timeout cascades. Full-suite: 5/10 fully clean; of
the other 5, three (`runs 1, 4, 7`) were entirely unrelated, pre-existing flakes in different
modules (a Corrections concurrent-approval race, a Backup Packages CSV comparison) surfaced by the
same reproduction effort but explicitly out of this checkpoint's scope — not touched. The remaining
two (`runs 6, 8`) were genuine payslips/PDF failures; `run 8`'s 11 failures matched the originally
reported count exactly.

**Every failure, without exception, was a hard Jest timeout** (`Exceeded timeout of 15000 ms`) on an
otherwise-correct operation — the `beforeEach` hook's `cleanTestData()`, or an individual PDF
render — never an incorrect PDF, an incorrect HTTP response, or (checked directly, both before and
after every reproduction run) a leaked Chrome process or unrecovered memory. `backend/src/lib/pdf/
browser.ts`'s singleton-browser lifecycle was reviewed line by line and found correctly bounded:
try/finally page cleanup, a concurrency-safe relaunch guard, and `closeBrowser()` called from this
file's own `afterAll` — confirmed empirically too (zero orphaned Chrome processes and full memory
recovery after every single one of 50+ reproduction runs, clean or failing). The root cause is this
host's own measured, genuine resource contention from processes outside this test suite's control —
`vm_stat` sampling during reproduction showed free memory dropping as low as ~15-20MB and the shared
Puppeteer browser's own RSS reaching ~600-700MB during this file's heaviest test (a 300-employee
batch render, `MAX_BATCH_PAYSLIPS_PER_REQUEST`'s own real production boundary, not reducible without
weakening that test's coverage).

**Fix — three parts, all lifecycle/resource-scoped, no payslip business logic touched:**
1. `backend/src/lib/pdf/render-pdf.ts`'s `renderHtmlToPdf` now retries exactly once, against a
   freshly discarded-and-relaunched browser (`discardBrowser()`, new in `browser.ts`), if a render
   fails for any reason. This closes a real, previously-unaddressed gap: `getBrowser()`'s own health
   check (`!browser.connected`) only detects a browser whose DevTools Protocol connection has fully
   dropped — it cannot detect one that is still connected but transiently unable to service a new
   page under resource pressure, so it would otherwise keep handing back the same degraded instance
   indefinitely. `discardBrowser()` never blocks or throws (fire-and-forget close) — a browser too
   degraded to render may also be too degraded to close cleanly, and the caller must not itself fail
   because of it. A second failure (on the retry) is never retried again and propagates normally.
2. `backend/tests/payslips.test.ts`'s 300-employee batch test — measured directly as this file's
   single heaviest consumer of the shared browser's resources — now calls `closeBrowser()`
   immediately after it succeeds, so its own outsized footprint can't compound into every test that
   runs after it in the same file/process.
3. This file's own Jest timeout is raised from the global 15000ms default (`tests/setup.ts`,
   unchanged — still 15000ms for the other 44 suites) to 45000ms via a file-scoped
   `jest.setTimeout(45000)` call (verified: this does not leak into other test files' own timeout,
   since each Jest test file gets its own isolated test environment even under `--runInBand`'s
   single process). Justified by the measured contention above, not a blind increase — the
   accompanying comment in the test file documents the exact reasoning and evidence.

**A separate, unrelated flake found during this same investigation, not fully resolved**: while
reproducing, `'issues a constant number of queries regardless of batch size (no N+1)'` (a pure
Prisma/Postgres query-count assertion — no Puppeteer involved at all) occasionally failed with an
off-by-one query count (e.g. 8 vs. 7) under contention — a connection-pool-level effect (the
underlying `small`/`large` result *lengths* were always correct, so this was never a real N+1
regression), not the PDF/timeout issue this checkpoint targeted. The test's own warm-up (already
present, with its own comment acknowledging "the very first query on a given connection can carry
extra one-off setup cost") was broadened to prime all three batch shapes used in the test, not just
one — this reduced but did not eliminate the ~5-10% recurrence rate observed in reproduction. Its
exact-equality assertion was **not** weakened (this checkpoint's instructions explicitly forbid
that); the remaining flake is documented (KI-10) as a separate, lower-priority follow-up rather than
claimed fixed.

**Validation — the same 20-isolated/10-full-suite battery repeated on the fixed code, plus the
checkpoint's full required list:**
- 20 isolated runs: 18/20 clean; the 2 failures were both the *separate* N+1 flake above (0/20
  PDF/timeout failures, down from 2/20 pre-fix).
- 10 full-suite runs: 8/10 clean; of the 2 failures, one was the separate N+1 flake, and the other
  (`run 5`) was a genuine PDF-timeout cascade that coincided with a directly measured, severe host
  slowdown — this file alone took 368s in that run against its normal ~70s, a >5x slowdown no
  finite, principled timeout can fully absorb without becoming unrealistic (1/10 full-suite
  PDF/timeout failures, down from 2/10 pre-fix).
- `--detectOpenHandles`: clean, 47/47, zero open-handle warnings (previously, ordinary runs
  regularly printed Jest's own "did not exit one second after" notice).
- `--randomize` (Jest's built-in test-order shuffle): clean, 47/47.
- Zero orphaned Chrome processes at any point across the entire ~50-run investigation (before and
  after the fix, clean runs and failing runs alike).
- typecheck, lint, and `npm run build` all clean.
- Targeted regression check that the same-day CSRF/RBAC/UI checkpoint remains intact:
  `csrf-concurrency.test.ts`, `csrf-cross-origin.test.ts`, `project-sites.test.ts`, `roles.test.ts`
  — 84/84 passing. Frontend: 91/91 unchanged, typecheck/lint/build clean.

**Honest conclusion, per this checkpoint's own explicit instruction not to claim resolution without
repeated evidence**: this is a real, large, measured reduction in failure rate — not a claim of
absolute zero. The residual risk is tied to genuinely severe ambient contention on this shared host,
from processes outside this codebase's control, not to an unfixed defect in this codebase's own PDF
rendering or test lifecycle — both were reviewed and confirmed correct, and no leak of any kind was
found at any point. See `docs/architecture/testing.md`'s "Payslip PDF test reliability" section and
`docs/release/KNOWN_ISSUES_v1.0.md` KI-10 for the full record.

**Not pushed, not deployed**, per this checkpoint's explicit instruction.

---

### System-Wide RBAC Consistency Audit and Remediation (production UAT, 2026-07-23)

Production UAT with real custom roles found the RBAC conversion was incomplete — Checkpoint 4D's
"UAT Defect 1" fix (Sites list visibility for `sites:manage`) had not been applied consistently to
the rest of the Sites/Units domain, to Employees, or audited for the same pattern elsewhere. This
checkpoint was a full system-wide audit against one explicit rule — permissions determine actions,
explicit scope determines which records, role names/codes never do — followed by remediation of
every inconsistency found, both reported and proactively discovered.

**Root causes, all traced to exact code before any fix:**
1. **Sites/Units (reported)**: `requireSiteAccess` (Project Units routes' own middleware) and
   `project-sites.service.ts`'s `listProjectSites` were two independent implementations of the same
   site-scope check, and had drifted — `listProjectSites` recognized `sites:manage` as global
   authority (Checkpoint 4D), `requireSiteAccess` never did. A `sites:manage`-holding custom role
   could list every site but got "You do not have access to this project site" managing that site's
   own Branches/Units.
2. **Employees (reported)**: Employees' own scoping (`isMasterAdmin`/`assertSiteAccess`,
   Master-Admin-only bypass) was and remains correct by design — `sites:manage` deliberately does
   not widen it (a real, load-bearing distinction, not a gap). The actual defects were UX-level: no
   distinct "you have no assigned sites" state (indistinguishable from a genuinely empty registry),
   and the Employee Registry's own site pickers sourced from the shared, `sites:manage`-aware
   `useProjectSites()`, offering sites the user's own Employee scope would reject.
3. **Gross Pay label**: "Gross Pay (Template)" was internal jargon exposed directly to payroll
   users, present only on the New/Edit Employee form (nowhere else in the app used "template" for
   this field).
4. **Modal footer overlap (reported)**: Checkpoint 4D's KI-9 fix consolidated Modal scrolling to one
   region but kept `ModalFooter` `position: sticky` *inside* that scrollable body with no reserved
   height — a dialog only slightly taller than its `max-h-[85vh]` cap rendered the footer overlapping
   the last item(s), not after them.
5. **Tasks (found proactively, not reported)**: `createTask` let any `tasks:manage` holder assign a
   task to anyone, but `listTasks`/`getTask` bypassed ownership-scoping only for the literal Master
   Admin role code — the exact "can mutate but cannot list" pattern this audit was asked to hunt for
   system-wide. A connected bug: the assignee picker called the `users:manage`-gated `GET /users`,
   403ing for a `tasks:manage` holder without `users:manage`.

**Fixes:**
- New `backend/src/common/authz-policy.ts` — the single, shared policy module (`isMasterAdmin`,
  `hasPermission`, `hasAnyPermission`, `hasGlobalAuthority`, `assertSiteAccess`,
  `getAccessibleSiteIds`). `require-site-access.ts`'s middleware now calls the same
  `assertSiteAccess` instead of its own copy, with an optional `{ globalPermission }` a route can
  supply. Project Units' list/create routes now pass `PERMISSIONS.SITES_MANAGE`. Every historical
  importer of `employees.service.ts`'s `isMasterAdmin`/`assertSiteAccess` (11 files across Advances,
  Bank Sheets, Cash Receiving, Corrections ×3, Payroll Entry ×2, Payroll Release, Payslips,
  Employees Import/Export) now imports directly from the new shared module.
- Employees: new `useAccessibleProjectSites(user)` (`frontend/src/hooks/use-project-sites.ts`) scopes
  the Employee Registry's site filter and the New/Edit Employee form's `SiteUnitSelect` to the user's
  real accessible sites; a distinct "You have no assigned project sites" empty state
  (`employees-page.tsx`) replaces the generic "No employees found" whenever that's actually the
  cause. Deliberately **not** applied yet to `corrections-page.tsx`, `salary-release-page.tsx`,
  `payslips-page.tsx`, `payroll-entry-page.tsx`, `bank-sheet-page.tsx`, `advances-page.tsx`,
  `cash-receiving-page.tsx` — same latent pattern, not part of the reported defects, recorded as a
  known remainder (KI-12).
- Gross Pay label renamed to "Default Gross Pay" with a helper line ("Used as the starting gross pay
  in new payroll cycles") — UI text only, no schema/API/payload change, confirmed the only such
  occurrence in the app.
- `ModalContent` (`frontend/src/components/ui/modal.tsx`) now pulls any `ModalFooter` out of its
  scrollable body and renders it as a true, non-overlaying flex sibling after the body — no call
  site needed to restructure how it composes children.
- Tasks: `tasks:manage` classified as its own domain's global-administrative permission
  (`hasGlobalAuthority(user, PERMISSIONS.TASKS_MANAGE)` replaces the literal role-code check in
  `requireTaskAccess`/`listTasks`, mirrored in `tasks-panel.tsx`). New
  `GET /api/v1/users-lookup/assignable` (`tasks:manage`-gated, minimal `{id,name,email}` shape) for
  the assignee picker, replacing its previous `users:manage`-gated call.

**Verification**: Backend 883/883 (7 new tests: `project-units.test.ts` ×2, `employees.test.ts` ×3,
`tasks.test.ts` ×2), typecheck/lint/build clean, Prisma schema/migrations unchanged (pure
application-layer remediation, no schema change). Frontend 91/91, typecheck/lint/build clean. Full
E2E suite 40/40 (2 new specs added to `tests/e2e/specs/10-site-visibility.spec.ts`: the Branch/Unit
creation regression and the "Employee Registry visibility (UAT Defect 3)" describe block) — two
transient failures on the first full run (`07-corrections.spec.ts` Scenario 4,
`08-role-administration.spec.ts`'s role-rename test) did not reproduce on a clean rerun, confirmed
pre-existing environment flakes unrelated to this remediation, not masked or weakened.

See `docs/architecture/authentication.md`'s "System-Wide RBAC Consistency Audit and Remediation"
section for the full permission/scope matrix and every role-code check audited, and
`docs/release/KNOWN_ISSUES_v1.0.md` KI-11 through KI-14 for the per-defect record.

**Not pushed, not deployed**, per this checkpoint's explicit instruction.

---

### Corrections Workflow Redesign / RBAC Consistency Completion (2026-07-24)

Two objectives: finish migrating the remaining site-scoped modules to the centralized RBAC helpers
the previous checkpoint introduced, and complete the Corrections workflow so creating a correction
has a real, discoverable entry point.

**RBAC completion**: all 7 remaining modules the previous checkpoint's own audit flagged as a known,
scoped-out remainder (Corrections, Salary Release, Payslips, Payroll Entry, Bank Sheet, Cash
Receiving, Advances) now call `useAccessibleProjectSites(user)` instead of the raw,
`sites:manage`-aware `useProjectSites()` for their own site filters — `corrections-page.tsx`'s
`ReviewQueueTab`/`CorrectionsLedgerTab` needed `user` prop-threading added, the rest were direct
swaps. No module in this system now follows a different site-scope rule than any other, beyond the
two pages that genuinely want the unrestricted list (Project Sites administration, Users' own
site-assignment picker).

**Corrections workflow**: the backend workflow (create → review → approve/reject → ledger →
outstanding balance) was already fully implemented and exhaustively tested (nine dedicated test
files) — the actual gap, confirmed by direct investigation against the real code before any change,
was frontend discoverability: `RequestCorrectionModal` opened only from a single, page-wide toolbar
button gated on the payroll *cycle's* status, inconsistent with the backend's own per-entry
`released` model (a per-Unit "Late Entry" release can leave a cycle nominally Draft while some
entries are already released and correctable). Fixed: `payroll-entry-row.tsx` now shows a Released
badge and a per-row actions menu (Create Correction, View Correction History) on any released row;
the toolbar button is now gated on "any released entry in view," not cycle status; a new
`CorrectionHistoryModal` surfaces every correction request ever filed against one entry, reusing an
already-existing endpoint. No backend change was needed — `assertEntryEditable`'s per-entry model
was already correct.

**Also delivered**: a reusable, searchable `EmployeeLookup` component (replacing the plain
unsearchable `<select>` in Advances/Corrections; employee search extended to cover Account Number/
IBAN/Site/Branch, not just Name/CNIC/Code); standard print support across all 8 named pages
(`PrintButton`/`PrintContextHeader`, `AppShell`'s `print:` utilities, a non-virtualized print-only
table for Payroll Entry's own virtualized grid); downloadable import templates for Employees and
Payroll Entry (the two modules with real import at the time — Bank Sheet/Cash Receiving/Sites/Users
had none; **Payroll Entry's own import/template was later removed entirely, 2026-07-24, per §1's
Payroll Entry Sorting, Deputed Branch & Import Removal entry — Employee Registry's import/template
is unaffected and remains this system's only import surface**); a terminology audit that found
"Master User" was never actually seeded (only
documented) — `prisma/seed.ts` and a new data-only migration
(`20260723120000_master_user_terminology`) now make it the live, seeded display name everywhere,
with four scattered "Master Admin" UI strings corrected to match.

**Verification**: backend typecheck/lint/build/Prisma-validate clean. Backend full suite: **891
passed plus 1 known pre-existing isolated timing flake, 892 total** — the flake is
`payslips.test.ts`'s Puppeteer-dependent batch tests under host resource contention (the
pre-existing, documented KI-10 load-sensitivity pattern; confirmed via isolated rerun at 47/47, not
a regression introduced by this checkpoint's changes — see KI-10's own updated entry for the full
evidence, including the observed 11-12-failure contended runs this figure is drawn from). Frontend
typecheck/lint/test/build clean, **91/91**. Full E2E suite **44/44, with two legitimate conditional
skips** (`tests/e2e/specs/12-corrections-completion.spec.ts`'s two environment-conditional tests,
which `test.skip()` when their prerequisite row state isn't present). New backend tests:
`project-units.test.ts`/`employees.test.ts`/`tasks.test.ts` (carried over from the previous
checkpoint's own commits), `employees-import-export.test.ts` and
`payroll-entry-import-export.test.ts` (import template endpoints), `employees.test.ts` (extended
search), `roles.test.ts` (seeded terminology). New E2E spec
`tests/e2e/specs/12-corrections-completion.spec.ts` covering the per-row Released actions, the
Employee Lookup search-and-select flow, print support, and import template downloads.

**Not pushed, not deployed**, per this checkpoint's explicit instruction.

---

### Operational Stabilization Checkpoint — Payroll Entry Table Alignment and Draft-Cycle Population (2026-07-24)

Unplanned checkpoint against the `origin/main` baseline (the checkpoint above, already pushed) —
two operational defects reported against the currently shipped Payroll Entry workflow, traced to
root cause and fixed before any Phase 7 work began. **Explicitly does not start Phase 7.**

**Defect A — Payroll Entry table misalignment.** Root cause: `payroll-entry-totals-row.tsx`'s
hand-written JSX cell list (one `<div role="cell">` per column, positionally ordered to match
`PAYROLL_COLUMNS`) silently omitted the IBAN column's own placeholder cell — a manual-sync drift
`columns.test.ts`'s 100%-covered pure-function tests could never catch, since none of them render a
single component. Every total from Gross Pay onward (Cycle Days, Leave Rate, Allowance, EOBI,
both deductions, Fine, Net Salary) rendered one grid column to the left of its own header; Net
Salary's total had no cell at all (grid one short). The header and body rows were independently
verified already correct — this was a totals-row-only defect. Fixed: `payroll-entry-totals-row.tsx`
now iterates `PAYROLL_COLUMNS` directly (one cell per column, looked up by id), making this class of
drift structurally impossible rather than just corrected once. Every cell in the header, body, and
totals rows now also carries a shared `data-col-id` attribute (`ReadOnlyCell` gained an optional
`colId` prop for its four call sites) — real alignment is now mechanically verifiable, not only
visually apparent.

**Defect B — Payroll Manager not seeing expected data.** Traced end-to-end (RBAC → site assignment
→ Draft-cycle population → repository query → API → frontend); the RBAC/site-scoping path itself
was confirmed already correct at every layer. Root cause: `bootstrapPayrollEntries`
(`payroll-processing.service.ts`) only ever runs once per cycle, at that cycle's own creation or
rollover. An employee created (or reactivated) *after* the current Draft cycle already exists had no
automatic path into that cycle's Payroll Entry grid — the only other entry point,
`payroll-entry.service.ts`'s `createPayrollEntry` ("add this employee to the cycle"), was a real,
working, RBAC-checked endpoint the frontend never called. Every user, Master Admin included, saw the
identical absence, because the row simply never existed — not an RBAC defect. Fixed: a new
`syncEmployeeIntoCurrentDraftCycle` (`payroll-processing.service.ts`) runs inside the same
transaction as employee creation (`employees.service.ts`'s `createEmployee`), reactivation
(`reactivateEmployee`), and CSV/Excel import (`employees-import-export.service.ts`) — no-op if no
cycle is currently Draft, if the employee isn't active, or if an entry already exists for that
`(cycleId, employeeId)` pair (the real backstop is still the schema's own unique constraint).
Reuses the exact "genuinely new employee, no prior entry" seeding shape `bootstrapPayrollEntries`/
`createPayrollEntry` already use. Automatic synchronization only ever reaches the current Draft
cycle; released/archived history, and an already-existing entry's own `siteId` after a later
employee site transfer, are both unaffected (verified by test) — no invented behavior for inactive
employees beyond the existing, already-documented departure/carry-forward rules.

**Verification**: backend full suite **901 passed, 1 failed** (`backup-packages.test.ts`'s
"Generated On" timestamp-comparison test) — a distinct test and mechanism from the documented KI-10
(`payslips.test.ts`, Puppeteer-specific), not classified as that same issue. Confirmed
non-reproducible on its own evidence: an immediate isolated rerun of that file passed **38/38**,
consistent with a full-suite-load timing sensitivity rather than a deterministic regression, but not
labeled as any previously-documented known issue. **Not written as 902/902** — this was not a clean
full-suite run. Frontend **94/94** (91 + 3 new: a real-component
render test proving header/body/totals `data-col-id` sequences all equal `PAYROLL_COLUMNS`'s own
order — verified to actually catch the shipped defect, by reproducing it against the pre-fix totals
row and confirming the new test failed). 10 new backend integration tests
(`payroll-entry-draft-cycle-sync.test.ts`) covering the critical lifecycle case, the reactivation and
CSV-import sync paths, Master User/Payroll Manager/multi-site RBAC visibility, the `sites:manage`-
does-not-widen-Payroll-Entry-visibility case, and released-entry site-transfer immutability — every
one independently confirmed to fail against the pre-fix backend and pass after. E2E full suite
**45/46** (one conditional skip, down from the previous checkpoint's two — the second skip's own
precondition happened to become satisfied by this checkpoint's own better Draft-cycle population,
and the newly-run test passed). Typecheck/lint/build all clean (the one pre-existing E2E-spec
typecheck error, `08-role-administration.spec.ts:83`, predates this checkpoint — see the previous
checkpoint's own push review). Real-browser verification performed with realistic data (two Project
Sites, four employees split across them, one created after Draft-cycle creation) as both Master User
and a Payroll Manager scoped to one site: totals row confirmed pixel-aligned under every header in
both normal-width and horizontally-scrolled states; the late-hired employee confirmed visible to the
scoped Payroll Manager; the Site B employee confirmed invisible to them.

**Updated after approval — committed as `a063b25`/`90b5f2f`/`bf89a06`, pushed to `origin/main`, and
deployed via Render's existing auto-deploy.** Production verification with a real Master User and
the one real non-Master-User account (Junaid Khan, Payroll Staff, all-sites) confirmed both fixes
live: the totals row rendered pixel-aligned in production exactly as in local verification, and a
newly-created employee synced into the live Draft cycle immediately (subsequently marked Left as
test cleanup — see the Draft Payroll Roster Reconciliation entry below for the one gap this exposed:
a pre-existing employee who predates the deployed sync hooks, "Asim Khan," stayed absent from that
same Draft cycle, since the fix is forward-looking only). **Phase 7 status is unchanged (Not
started) — this checkpoint did not begin it.**

---

### Draft Payroll Roster Reconciliation (2026-07-24)

Narrow follow-up to the Operational Stabilization Checkpoint, triggered by production verification
finding one real employee ("Asim Khan," ABL West Region) who predates the deployed
create/reactivate/import sync hooks and so was never enrolled in the already-open Draft cycle —
those hooks are forward-looking only; nothing re-checks an already-active employee's presence in an
already-open Draft cycle after the fact.

**Root cause**: `bootstrapPayrollEntries` only ever populates a cycle once, at that cycle's own
creation/rollover; `syncEmployeeIntoCurrentDraftCycle` only fires at employee create/reactivate/
import. An employee active before that fix shipped falls into the gap between both and stays
permanently missing until something else explicitly checks for it.

**Solution**: `reconcileDraftCycleRoster` (`payroll-processing.service.ts`) — an explicit, idempotent
reconciliation operation. Loads the named cycle, hard-rejects (400, before any `PayrollEntry` read)
unless it is still `DRAFT`, computes the set of active employees with no existing entry for that
cycle via two bulk indexed reads and an in-memory set difference (the same bulk-query shape
`bootstrapPayrollEntries` already uses at 10,000-employee scale), then creates exactly the missing
entries by calling `syncEmployeeIntoCurrentDraftCycle` once per employee — no second
`PayrollEntry`-creation implementation. Never updates, deletes, or recreates an existing entry;
never reaches a Released/Archived cycle; the schema's own unique `(cycleId, employeeId)` constraint
remains the final concurrency backstop, same as the sync hooks it reuses.

**Trigger**: an explicit `POST /api/v1/payroll-cycles/:cycleId/reconcile-roster`,
`payroll-cycle:manage`-gated — the same permission class as cycle creation/finalize/rollover, not
the narrower `payroll:entry` a day-to-day Payroll Manager holds — matching every other
cycle-lifecycle action's own route convention exactly. Deliberately **not** a side effect of the
Payroll Entry list's own `GET` (Principle 10's 10,000-employee scale floor makes an eligibility diff
on every read a real, avoidable cost, and a read silently writing rows is exactly the "unsafe/
surprising mutation path" this checkpoint was told not to force). Instead, `payroll-entry-page.tsx`
fires this action once, silently, whenever a session already holding `payroll-cycle:manage` opens a
Draft cycle — self-healing for the sessions that can act on it, without the read endpoint itself
ever mutating. A toast appears only when it actually added someone; a no-op reconciliation is
invisible, and a failed attempt never hides or corrupts the already-independently-fetched Payroll
Entry grid.

**Verification**: 11 new backend integration tests (`payroll-entry-draft-roster-reconciliation.test.ts`)
— a pre-existing missing employee gets reconciled; existing Draft entries (including an already-
released one) stay field-for-field unchanged; idempotent and duplicate-safe under repeated/concurrent
calls; a Released or Archived cycle is rejected before any mutation; a departed employee is never
introduced; an entry's `siteId` survives a later employee transfer unchanged; multiple missing
employees reconcile correctly in one pass; a site-scoped Payroll Manager's own read visibility is
unaffected; the endpoint itself rejects a `payroll:entry`-only Payroll Manager with 403 — every one
independently confirmed to fail against the pre-fix code and pass after (the Draft-only guard
specifically verified by temporarily disabling it and confirming the corresponding test catches it).
Backend typecheck/lint/build clean. Frontend typecheck/lint/build clean, existing 94/94 suite
unaffected. Related existing suites re-run unchanged (`payroll-entry-draft-cycle-sync.test.ts`,
`payroll-cycle.test.ts`, `payroll-release.test.ts`, `payroll-cycle-rollover.test.ts`) — one unrelated
pre-existing failure (`payroll-cycle-finalize.test.ts`, a Bank Sheets test) confirmed to reproduce
identically against unmodified `bf89a06` with this checkpoint's changes fully stashed, not caused by
it, not touched. No schema or migration changes.

**Not committed as of this entry's own writing.**

---

### Payroll Entry & Advances Operational Stabilization Checkpoint (2026-07-24)

Started from deployed baseline `fdd25b3`, against production screenshots/manual-testing observations
covering the Corrections settlement dialog, the Payroll Entry table, a production smoke-test
employee, and a focused end-to-end Advances domain review. See the checkpoint report delivered to
the user for the full 14-point record; summarized here. **Committed LOCALLY only, per the user's own
explicit instruction — NOT pushed, no deploy, Phase 7 not started** — as five commits: `fb13204`
(fix: immediate Draft materialization, BR-ADV-007), `9086e87` (feat: lifecycle-aware edit and
cancel), `1d1e811` (fix: settlement wording), `3647b77` (test: sticky-column guard), and this
documentation commit. Another session is separately implementing Payroll Entry sorting, Branch Code,
and import-functionality removal on `main`; the two lines of local work are to be reconciled together
before any combined verification and push.

**A. Record Settlement wording** — the Balance Adjustment → Record Settlement dialog's bank field
label ("Bank (optional — leave blank for cash)") was redundant with the dropdown's own explicit
`Cash` option. Relabeled to "Payment Method / Bank"; no submission-path/financial behavior touched
(`record-settlement-modal.tsx`).

**B. Payroll Entry table sticky/frozen columns** — investigated in full (`PAYROLL_COLUMNS`,
`payroll-entry-grid.tsx`, `payroll-entry-row.tsx`, `payroll-entry-totals-row.tsx`) and verified in a
real Chromium browser at normal/narrow viewports across full left/mid/right horizontal scroll,
including a Released row: **no code defect found**. The grid's only `position: sticky` usage is the
group-header/column-header/totals rows, pinned on the vertical axis only, inside the one shared
horizontal-scroll container the body also uses — no column, including `status` (the Released badge),
is independently sticky/frozen, and there is no per-cell margin/transform hack. A new mechanical
regression test (`payroll-entry-alignment.test.tsx`) now asserts this directly (no `sticky`/`fixed`/
`left-`/`right-`/`translate-` class and no inline `position` style on any `[data-col-id]` cell) so a
future regression fails immediately rather than only being visually apparent.

**C. Production smoke-test employee (`ZZZ SMOKETEST DeployCheck`)** — confirmed via full-repository
grep (source, seed data, migrations, tests, bootstrap logic) **not hard-coded anywhere**; it is
ordinary production data created through the Employee Registry UI during deployment verification.
No hard-delete path exists for `Employee` (by design — `markEmployeeLeft`/departure is the only
retirement mechanism, matching every other permanent record in this schema). Documented, not
executed (no access to the production database from this environment): the safe cleanup is Mark
Employee Left (dated to the verification date) so it stops appearing in any future Draft cycle
roster, plus — only if it still has an entry in a currently-open Draft cycle — deleting that one
still-Draft `PayrollEntry` via the existing per-entry Delete action (`assertEntryEditable`-gated,
blocked automatically if ever released). Any released history is left untouched, same as any other
employee's.

**D/E. Advance not appearing in current Draft Payroll Entry — root cause found and fixed.** Confirmed
NOT a frontend caching issue: `materializeScheduledAdvanceDeductions` only ever ran at cycle
*bootstrap*, a moment that, for any Advance recorded after the Draft cycle already exists, has
already passed — a genuine missing backend step, the same class of gap `syncEmployeeIntoCurrentDraftCycle`
closed for employees. Fixed in `advances.service.ts`'s `createAdvance`: if the resolved period is the
current Draft cycle and the employee already has a still-editable entry in it, materialize
immediately, in the same transaction, via a newly-extracted `materializeOneAdvanceDeduction` helper
shared with the bulk cycle-bootstrap sweep (one calculation, not two). New BR-ADV-007: a new
Advance's first deduction period may never be earlier than the current Draft cycle (or today's real
month if none is Draft) — enforced server-side (`assertPeriodAtOrAfterFloor`) and reflected in the
Record Advance UI as a "Current Draft Cycle" / "Future Cycle" toggle (defaulting to Current Draft,
replacing two unconstrained year/month number inputs).

**F. Advance Edit — lifecycle-aware editability matrix defined and implemented.** `updateAdvance` now
also accepts `totalAmount`; every financial field is rejected once `PAID_OFF`/`CANCELLED`; `notes`
remains editable always. The deduction start cycle stays not directly editable at any stage — before
materialization, correct it by cancelling and re-recording (G); after, `deferAdvanceSchedule` remains
the only path (its `AdvanceScheduleChange.payrollEntryId NOT NULL` schema constraint architecturally
forecloses a "reschedule before it lands" mechanism, confirmed by inspection, not reopened).

**Post-implementation review correction, same day, before commit.** The user's own pre-commit review
asked to confirm a specific case directly: editing an ACTIVE Advance already materialized into the
current Draft recalculates that Draft deduction correctly and exactly once, while Released payroll
stays untouched. It did not — the original `updateAdvance` only ever wrote `Advance.totalAmount`/
`outstandingBalance`, never touching an already-materialized, still-unreleased `PayrollEntry`, so a
live Draft deduction silently went stale relative to the edit. Fixed: `updateAdvance` now reverses a
live (unreleased) materialized deduction first — the identical math `cancelAdvance`/
`deferAdvanceSchedule` already use — and re-materializes it under the new rules in the same
transaction via the same shared `materializeOneAdvanceDeduction` helper, exactly once; a RELEASED
entry is still never touched. This also corrected the `totalAmount` floor itself: it is now what has
been repaid via **RELEASED** payroll only, never a still-Draft, reversible figure (the original floor
incorrectly counted a live, not-yet-released deduction as locked in). A same-value resubmission
(e.g. a notes-only save) skips the reversal/recalculation entirely, so it never bumps the live
entry's `version` or writes audit noise. New focused tests added and passing: the exact requested
scenario (a two-cycle fixture — Released Cycle 1 stays untouched, Cycle 2's live deduction
recalculates from 4000 to 1500 in exactly one reversal + one re-materialization), the corrected
released-only floor, and a no-op-edit-does-not-touch-the-entry guard. Full focused suite re-run
green after the fix: 27/27 (later 29/29 with the new tests) `advances.test.ts`, 15 suites/368 tests
overall, typecheck/build/lint clean.

**G. Advance Cancel/Void — investigated, Cancel chosen over Delete.** The `Advance` model's own
existing doc comment already states "Never hard-deletable... matching this schema's established
convention for every other permanent financial/master record" — so a hard-delete-if-untouched
carve-out was rejected as inconsistent with the codebase's own frozen design, not merely
under-scoped. Added `AdvanceStatus.CANCELLED` (additive migration
`20260724130000_advance_cancelled_status`, single `ALTER TYPE ... ADD VALUE`) and a new
`cancelAdvance` action, gated by the same `ADVANCES_MANAGE` permission as create/edit: reverses a
still-Draft (unreleased) materialized deduction first if one exists (identical math to
`deferAdvanceSchedule`'s own reversal), never touches a RELEASED deduction, clears the live schedule
pointer, and audits `advance.cancelled`/`payroll_entry.advance_cancelled`. Works uniformly whether or
not any deduction has yet materialized.

**H. Numeric lifecycle reconciliation** — a new three-cycle fixture test independently recomputes
Original − Released deductions = Outstanding Balance at every step (decimal-safe, non-evenly-divisible
installment amounts deliberately used), confirms release-once semantics, no double-decrement on
refetch, and cross-checks the total against every `advance.schedule_materialized` audit-log entry
summed independently.

**Testing**: 27/27 backend `advances.test.ts` (13 pre-existing + 14 new), 15 focused backend suites
(`advances`, `payroll-entry`, `payroll-processing`, `corrections`) **366/366**, frontend **95/95**
(new alignment regression test included), backend/frontend/shared typecheck and build clean,
backend/frontend lint clean (0 errors; 6 pre-existing warnings in untouched files). Full regression
suite deliberately not run — nothing here changed a shared financial-calculation primitive,
authorization primitive, or broad release/settlement behavior, and focused testing surfaced no
evidence a wider run was needed (Section J's own stated bar).

**Real-browser verification** (Chromium via Playwright, driving the actual dev servers — the Claude
in Chrome extension was declined for this session): Record Advance with the new Current Draft/Future
Cycle toggle; a current-Draft Full Deduction advance immediately showing "Paid Off"/PKR 0.00 balance
with no manual refresh; the same deduction visible in Payroll Entry's Advance Ded. column and totals
row with no separate action; a Future Cycle advance correctly resolving to next month and not
deducting in the current Draft; editing `totalAmount` on an ACTIVE advance; Cancel transitioning an
ACTIVE advance to a red "Cancelled" badge with Edit-only actions remaining; Payroll Entry table
horizontal scroll at narrow viewport confirming Section B's finding. Section A's dialog was verified
by source inspection only (reaching it live requires an approved Correction against a released
entry — a materially bigger live-browser fixture than a one-line label change justified).

**Schema/migration impact**: one additive migration (new enum value only, no column/constraint
change to any existing row). Documentation updated: `docs/architecture/database/advances.md` (BR-ADV-007,
immediate materialization, the Edit matrix, Cancel/Void, the `CANCELLED` status) and this entry.
**Phase 7 remains Not Started.** **Committed (`fb13204`/`9086e87`/`1d1e811`/`3647b77`/`1229916`),
integrated on `main` together with the Payroll Entry checkpoint immediately below, approved for push
and Render auto-deploy this same session — see `docs/SESSION_HANDOFF.md` for the push/deploy
record.**

### Payroll Entry Sorting, Deputed Branch & Import Removal — COMPLETE, 2026-07-24 (COMMITTED as `89af663`, integrating the Operational Stabilization checkpoint above)

The next Payroll Entry usability improvement, approved and scoped separately from the Advances/
Corrections stabilization work immediately above (developed in parallel, in an isolated worktree
based on `fdd25b3`, then rebased cleanly onto `main` at `1229916` with no conflicts other than a
trivial auto-merge in `payroll-entry-alignment.test.tsx`, where this checkpoint's `makeEntry` mock
edit and the stabilization checkpoint's appended sticky/frozen-column regression test sit in
non-overlapping regions of the same file — both are preserved intact).

**1. Sortable columns.** The grid's dataset is already fully resident client-side (Checkpoint 6's
own 10,000-employee architecture decision), so sorting is a pure, client-side, non-mutating
reorder (`sort-entries.ts`'s `sortPayrollEntries`) fed into the existing TanStack Table instance as
its `data` — TanStack's own column/header machinery is reused, but its built-in sort engine is not,
since the "missing values always sort last, in both directions" requirement (below) needs direction-
independent null handling that fighting TanStack's automatic desc-negation would have made needlessly
fragile. Sortable: Employee (name, A→Z/Z→A), Employee Code, Deputed Branch, Gross Pay, Net Salary —
alphanumeric compare (`numeric: true`, so "BR-2" sorts before "BR-10") for the two code columns,
numeric compare for the two money columns, plain locale compare for Employee. Every comparator
breaks ties on each entry's original array index, so equal values never reorder relative to each
other regardless of the sort engine's own stability guarantees. Clicking a sortable header toggles
asc → desc → asc via a chevron-indicator button (`ChevronUp`/`ChevronDown`/neutral `ChevronsUpDown`)
that shares the header's own `data-col-id`, so alignment stays mechanically verifiable the same way
Section B's stabilization fix already made the header/body/totals column order. Sorting reorders the
whole `PayrollEntryRow` (bank details, gross pay, units, everything) together, never individual
cells — the row is a single component per TanStack row, not per-column cell renderers. The totals
row reads from the unsorted, already-site-filtered `entries` prop directly (never the sorted view),
so it represents the current filter and is unaffected by display order.

**2. "Deputed Branch" column.** A new, dedicated column showing the deputed branch/site code for
each employee — sourced from `entry.workLines[0].unit.code` (the entry's own *primary work line's*
`ProjectUnit`, newly included server-side via a shared `WORK_LINES_INCLUDE` constant in
`payroll-entry.service.ts`, added to every query that returns work lines), **never**
`employee.unit.code` (the employee's *current* default unit), since work lines are frozen forever
once an entry releases (§12) — reading the live employee assignment would silently rewrite a
released/archived entry's historical branch onto whatever the employee is deputed to today. A Draft
entry's work line reflects the current roster/reconciliation state, exactly as intended. Missing
values (`code` is nullable on `ProjectUnit`) render the standard `—` placeholder and sort
deterministically last in both directions — implemented as a direction-invariant null branch in the
comparator, not by letting the framework's own asc/desc negation flip blank-row position on toggle
(the same reasoning as item 1's TanStack-sort-engine decision).

**Naming decision (flagged, not guessed):** the grid already had a column literally labeled "Branch
Code" (the employee's *bank* branch code, under the "Bank Details" group — an unrelated concept that
only coincidentally shares the word "Branch"). Rendering the new column under the same literal label
would have shipped two identically-named columns in one table — surfaced to the user rather than
resolved unilaterally; the user chose **"Deputed Branch"** for the new column, positioned beside the
other employee/site identity columns (right after Site), never grouped under "Bank Details".

**3. Payroll Entry import removed entirely.** Per an explicit product decision that payroll data
must never be imported: the `/entries/import` and `/import-template` routes, `multer` upload wiring,
template generation/parsing/`importPayrollEntries` (`payroll-entry-import-export.service.ts`), and
every frontend Import/Download-Import-Template affordance (buttons, file input, result modal,
`useImportPayrollEntries`/`downloadPayrollEntryImportTemplate` hooks) are gone. **CSV/Excel export is
completely unaffected** — same headers, same rows, same routes, same tests, now the *only* Payroll
Entry data-transfer surface. **Employee Registry's own, separate import feature is untouched** — it
was never in scope and nothing about it changed. Every backend test file that had exercised the now-
removed import path (`payroll-entry-import-export.test.ts`, `payroll-cycle-finalize.test.ts`,
`payroll-entry-performance.test.ts`, `payroll-cycle-archived-lock.test.ts`) had its obsolete import
coverage removed and, where the same regression concern was import-specific, no replacement was
needed (the underlying held/unreleased-editability and Archived-cycle-lock behavior each already has
independent non-import coverage in the same files).

**Testing**: frontend typecheck/lint/build clean, full suite **113/113**. Backend typecheck/lint
clean; full suite **890-891/902** across two clean full runs (12/11 failures respectively) — every
failure independently confirmed pre-existing and unrelated by `git diff` against `origin/main`
showing zero changes to the failing files: **11 in `payslips.test.ts`** (PDF-generation 500s,
environment-load-sensitive per the Pre-Deployment Reliability Checkpoint above, not this
checkpoint's own regression) and **one flaky concurrency test in `corrections-service.test.ts`**
(passes cleanly, 47/47, in isolation — a full-suite-load flake, not a regression; confirmed
unrelated, since neither file has any diff from `origin/main`). Every Payroll-Entry-specific test
file this checkpoint touched or added is **100% green**. Real-browser verification (Chromium via
Playwright, driving the actual dev servers against a freshly seeded local database): logged in as
Master User, created a site/branch/two employees, started the first Draft cycle, and confirmed by
screenshot — the Deputed Branch column visible and correctly populated; clicking the Employee header
sorted full rows both directions (chevron flips) with the Gross Pay total unchanged
(`PKR 100,000.00`) before and after; horizontal scroll keeps header/body/totals aligned; Import,
Download Import Template, and the file input are completely absent; Export CSV/Export Excel remain
present and clickable.

**Integration**: developed in an isolated worktree branched from `fdd25b3` (before the Operational
Stabilization/Advances-Cancel checkpoints above existed), then cleanly rebased onto `main` at
`1229916` — a fast-forward, zero data loss, zero dropped behavior from either side. **Committed as
`89af663`, on `main` together with the Advances/Corrections stabilization commits above, approved for
push and Render auto-deploy this same session — see `docs/SESSION_HANDOFF.md` for the push/deploy
record.** **Phase 7 remains Not Started; this checkpoint does not begin it.**

---

## 2. Remaining work (by phase, per `docs/IMPLEMENTATION_PLAN.md`)

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, RBAC, Audit Log | **Closed, 2026-07-02; DB-backed evidence completed 2026-07-04** — full suite passing against live PostgreSQL (§1's Database verification subsection) |
| 2 | Project Sites, Employee Registry, Settings, User Management | **Closed, 2026-07-02; DB-backed evidence completed 2026-07-04** — same basis as Phase 1 |
| 2.5 | Project Units (new module), Payroll Work Lines prerequisite, Employee Registry refinements | **CLOSED and committed, 2026-07-05.** All five checkpoints (0–4) complete — `e26fe8c` |
| 3 | Payroll Entry & Payroll Processing (`calcNet` over Work Lines, the Payroll Entry grid) | **CLOSED, 2026-07-10.** All seven checkpoints (0–6: schema foundation; cycle bootstrap/creation + backend CRUD; the grid frontend; Split by {unitLabel}; multi-site filter + Copy to All; CSV/Excel import/export; 10,000-employee performance/concurrency validation) are COMPLETE and committed — see §1. Phase 3's own 🛑 review checkpoint has passed. **Import specifically was later removed entirely (2026-07-24, §1's Payroll Entry Sorting, Deputed Branch & Import Removal entry) — export is unaffected.** |
| 3.5 | Tasks Workspace (new — permanent replacement for the previously-planned Team Collaboration/Chat panel) | **CLOSED, 2026-07-10.** All four checkpoints (0: architecture revision — `0fb296e`; 1: database foundation + shared contracts; 2: backend services/routes/notifications; 3: frontend, prototype, testing — `1220dce`) are COMPLETE and committed — see §1. Phase 3.5's own 🛑 review checkpoint has passed |
| 4 | Release (now per Project Unit), Bank Sheets, Cash Receiving, Advances, Payslips | **All six checkpoints implemented, tested, and committed — CODE-COMPLETE, NOT fully closed.** Checkpoints 1–5 (Bank Registry, Salary Release foundation, Bank Sheets, Cash Receiving Sheets, Advances) CLOSED — `7c2cdb5`, `cedf386`, Checkpoint 3's commit, `477fbb1`, and `75c5e64`; Post-Phase-4 banking/layout refinement — `3b74c32`, `9d9bc32`, `372eeba`; Payslips split into Checkpoint 6.1 (backend foundation), 6.2 (PDF engine), 6.3 (frontend, batch generation, Phase Close-Out) — 6.1/6.2 committed as `093a9df`, 6.3 committed per §1's own entry; see §1. Cash Advances/Advance-only Bank Sheets/Company Bank Account management confirmed out of scope. **Employee Statements confirmed NOT part of this phase's scope (2026-07-11 architecture review, §1) — it was never in Phase 4's frozen scope and remains Phase 7 work.** **Held open by exactly one condition: real Render/Linux-container deployment verification was genuinely attempted and could not be completed in this sandboxed environment (no Docker/Podman/Colima, no Render API token, no git remote) — see §1's "Phase 4 close-out review" and Checkpoint 6.3's own "Mandatory deployment verification" note. Not falsely marked passed.** |
| 5 | Cycle Finalization, Archiving, Backups | **COMPLETE AND CLOSED, 2026-07-16.** Architecture review complete (2026-07-14, no redesign required). Checkpoint 0 (`StorageProvider` foundation) CLOSED, committed as `d87b9b0` — see §1. Checkpoint 1 (Finalize Cycle) CLOSED, committed as `cad93bc` — see §1. Checkpoint 2 (Backup Packages reusable domain/generator) CLOSED, committed as `3ea879e` — see §1. Checkpoint 3 (cycle archiving, automatic backup generation, and new-cycle rollover) CLOSED, committed as `957ab9d` — see §1's Checkpoint 3 entry. Checkpoint 4 (Historical Payroll Cycle Selector) CLOSED, committed as `10e3194` — includes a `passwordHash` response-serialization fix found during final review (Users module, not Checkpoint 4's own code) — see §1's Checkpoint 4 entries. **Final browser verification (real Playwright/Chromium, 108/108 assertions, zero unexpected console errors) closed the one remaining gap — see §1's "Phase 5 — final browser verification and close-out" entry. No code changes were required; the working tree needed no new commit for this pass.** Phase 4's own Render/Linux-container Chromium deployment smoke test remains separately open — not part of Phase 5's own scope |
| 6 | Corrections & Balance Adjustments (highest-risk logic) | **CLOSED, 2026-07-19.** Architecture Review + Product Decision Resolution (review-only) complete. Checkpoint 1 (Domain & Schema Foundation) CLOSED, `ac58748`. Checkpoint 2 (Baseline Reconstruction & Delta Calculation Engine) CLOSED, `1002209`; Checkpoint 2A (review-only) CLOSED, `1aede0a`. Checkpoint 3 (Transactional Correction Approval & Balance Adjustment Creation) CLOSED, `6189ba9`. Checkpoint 4 (Settlement, Payment Recording & Outstanding Balance Lifecycle) CLOSED, `9f9c88d`. Checkpoint 5 (Draft-Cycle Materialization) CLOSED, `3bab54a`. Checkpoint 5A (review-only — found and fixed a genuine reservation-vs-settlement double-processing defect) CLOSED, `9d19cbb`/`b8a3e81`. Checkpoint 6 (Corrections Ledger, Review Queue & Frontend Operational Workflow — the frontend now exists: request/preview/approve/reject, Ledger, BalanceAdjustment/materialization/settlement presentation, reservation-aware settlement UX, two minimal read-only backend additions) CLOSED — see §1. Checkpoint 6A (review-only — found and fixed a real Corrections-sidebar-visibility gap: a `corrections:approve`-only reviewer could not see the sidebar item at all; frontend-only fix, no backend/schema change) CLOSED, `9d6a39b`. **Checkpoint 7 (End-to-End Financial Lifecycle Validation, Audit Hardening & Phase 6 Close-Out) CLOSED** — full lifecycle/audit/API/permission/reporting validation found one genuine gap (the `ACTIVE -> CONSUMED` materialization transition every prior checkpoint deferred, which blocked a materialized obligation from ever reaching `SETTLED`) and fixed it: `releaseProjectUnit` now consumes every `ACTIVE` reservation the moment its `PayrollEntry` actually releases, using the `settlementId`/`consumedAt` columns Checkpoint 5's own schema already reserved for it — no migration, no new permission key. See §1's own Checkpoint 7 entry for the full record. **Phase 6 is now fully closed. Phase 7 has not been started.** |
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

**Updated 2026-07-24 (latest) — Advances/Corrections Operational Stabilization AND Payroll Entry
Sorting/Deputed Branch/Import Removal are both COMPLETE and COMMITTED on `main`** (five commits
`fb13204`/`9086e87`/`1d1e811`/`3647b77`/`1229916` plus `89af663` — see §1's own two entries for the
full record of each). Approved together this session for integration, push, and Render auto-deploy.
See `docs/SESSION_HANDOFF.md` for the exact push/deploy outcome and any production smoke-check
findings. **Phase 7 remains Not Started; do not begin it.**

**Updated 2026-07-24 (superseded by the entry above for status purposes, kept for its own still-
useful record) — Draft Payroll Roster Reconciliation is COMPLETE and has since been committed**
(as `fdd25b3`/`c355d0d`/`af8dbe8`/`06c4863`, the base the two checkpoints above were built on top
of — no longer "NOT COMMITTED" as this entry originally read). See §1's own entry for the full
record. Narrow follow-up to the Operational Stabilization Checkpoint below, triggered by production
verification finding one real pre-existing employee ("Asim Khan") who predates the deployed sync
hooks and so stayed absent from the already-open Draft cycle. Adds an explicit, idempotent
`reconcileDraftCycleRoster` action (`payroll-cycle:manage`-gated, matching every other
cycle-lifecycle route's own convention), triggered automatically but safely — once, silently, on
Draft-cycle Payroll Entry page open by a session already holding that permission — never as a side
effect of the entries list's own `GET`. 11 new backend tests, each verified to fail pre-fix/pass
post-fix; typecheck/lint/build clean for both workspaces; no schema/migration change.

**Updated 2026-07-24 (superseded by the entry above for status purposes, kept for its own still-
useful defect record) — Operational Stabilization Checkpoint (Payroll Entry Table Alignment and
Draft-Cycle Population) is COMPLETE and has since been committed, pushed, and deployed — see §1's
own updated entry for the current status.** Two
reported defects against the currently shipped Payroll Entry workflow: (1) the totals row's
hand-written cell list had silently drifted out of sync with `PAYROLL_COLUMNS`, shifting every total
from Gross Pay onward one column left — fixed by making the totals row iterate the canonical column
array directly, structurally closing the drift, not just correcting the one instance. (2) an
employee created (or reactivated) after the current Draft cycle already existed never appeared in
it, for any user — a Draft-cycle population lifecycle gap, not an RBAC defect — fixed with a new
`syncEmployeeIntoCurrentDraftCycle` running inside employee creation/reactivation/import. Backend
full suite 901 passed, 1 failed (`backup-packages.test.ts`, a distinct test/mechanism from the
documented KI-10 — not classified as that issue; confirmed non-reproducible at 38/38 on an isolated
rerun, not written up as 902/902 since this was not a clean full-suite run), frontend 94/94, E2E
45/46 (one conditional skip), all real-component/integration tests independently verified to catch
the original defects by reproducing them against the pre-fix code. Real-browser verification
performed with realistic Master User and Payroll Manager personas. **Since committed as
`a063b25`/`90b5f2f`/`bf89a06`, pushed, and deployed — see §1's own updated entry and the Draft
Payroll Roster Reconciliation entry above for what production verification found next. Phase 7 was
not, and still is not, started.**

**Updated 2026-07-23 (later still, same day) — Pre-Deployment Reliability Checkpoint (Payslip PDF
Full-Suite Flakiness) is COMPLETE, NOT pushed.** See §1's own entry for the full record.
`payslips.test.ts`'s intermittent full-suite failures (11 observed in one run) were investigated via
extensive controlled reproduction (20 isolated + 10 full-suite runs, before and after the fix, with
`vm_stat`/process sampling) — every failure was a hard Jest timeout on an otherwise-correct
operation, never an incorrect PDF/response and never a leaked process (confirmed directly, 50+
runs). Root cause: this host's own measured, severe ambient resource contention from processes
outside this suite's control (free memory measured as low as ~15-20MB during reproduction), not a
codebase defect — `browser.ts`'s singleton-browser lifecycle was reviewed and found correctly
bounded. **Fix (three parts, no payslip business logic touched): a bounded one-time render-recovery
retry (`render-pdf.ts`/`browser.ts`'s new `discardBrowser()`), the 300-employee batch test recycling
the shared browser immediately after it succeeds, and this file's own Jest timeout raised from the
global 15000ms to 45000ms (file-scoped — the other 44 suites are unaffected).** Measured result:
PDF/timeout failures went from 2/20 to 0/20 isolated, and 2/10 to 1/10 full-suite (that one
remaining case coincided with a directly measured 368s-vs-~70s, >5x host slowdown). **Reported
honestly as a large, measured improvement, not a claim of absolute zero** — per this checkpoint's
own explicit instruction not to claim resolution without repeated evidence. A separate, unrelated
flake (a Prisma query-count assertion, no Puppeteer involved) was also found and partially
(not fully) mitigated — see KI-10. Backend **876/876** (45 suites) on every clean run; targeted
CSRF/RBAC re-verification 84/84; frontend 91/91 unchanged. See
`docs/architecture/testing.md`'s "Payslip PDF test reliability" section for the full investigation.
**Do not re-open this investigation without new evidence, and do not push or deploy without the
user's own separate go-ahead.** The paragraph below is carried forward for its still-open content
only.

**Updated 2026-07-23 (earlier same day) — Checkpoint 4D Correction and UAT Defect Remediation is
COMPLETE, NOT pushed.** See §1's own entry for the full record. Three items in one pass: (1) the
same-day Checkpoint 4D CSRF fix (below) was reviewed and its `req.ip`-keyed in-memory coalescing map
**rejected** — not a browser identity, not correct across multiple backend processes — and replaced
with a stateless backend plus a one-shot client-side recovery on a specific `CSRF_TOKEN_MISMATCH`
code; token rotation itself was unaffected. (2) UAT Defect 1: a custom role granted `sites:manage`
couldn't see the Sites list (`listProjectSites` was scoped to the literal Master Admin role code
only) — fixed, since `sites:manage` is a global `CRITICAL_ADMIN_PERMISSIONS` capability. (3) UAT
Defect 2: the Roles & Permissions dialog's excessive scrolling/frame desync (a nested independent
scroll region) — fixed at the shared `ModalContent`/`ModalFooter` level, benefiting every dialog.
Backend **876/876** (45 suites), frontend **91/91**, E2E **38/38** — new `10-site-visibility.spec.ts`
(2 tests) and `11-permission-dialog-layout.spec.ts` (4 tests) plus every pre-existing regression
spec, including `09-csrf-concurrency.spec.ts` unchanged. **None of these three items is open
anymore — do not re-open or re-fix without a new, genuinely reproduced defect, and do not
reintroduce an IP-keyed CSRF design.** **Do not push or deploy without the user's own separate
go-ahead.** The paragraphs below are carried forward for their still-open content only.

**Updated 2026-07-23 (superseded by the entry above, kept for its still-open content only) —
Post-Phase-5 Stabilization Checkpoint 4D (CSRF Concurrent First-Request Race — Implementation) was
COMPLETE, NOT pushed**, but its design was rejected on review the same day — see the entry above.

**Updated 2026-07-22 — Post-Phase-5 Stabilization Checkpoint 5 (Administration & Security
Management Phase 1 — Dynamic Roles, Permission Matrix, User Role Assignment) is COMPLETE,
committed as `bf1a749`/`5983232`/`2e4c81f`, NOT pushed.** See §1's own entry for the full record.
Master Users can now create/edit/duplicate/deactivate/delete roles and reassign a user's role
entirely at runtime, with a permission-based final-administrator safeguard and immediate session
revocation on role change. Backend **851/851**, frontend **80/80**, E2E **27/27** (new
`08-role-administration.spec.ts` plus every pre-existing regression spec). **Do not push or
deploy these three commits without the user's own separate go-ahead.** The paragraph below
(originally written 2026-07-19, for Phase 6 Checkpoint 6A) is carried forward for its still-open
content only.

**Updated 2026-07-19 — Phase 6 Checkpoint 6A (Corrections Navigation Permission Verification &
Focused Fix) is CLOSED, Checkpoint 6 is now fully closed.** Checkpoints 1–6 (domain/schema,
calculation engine, transactional approval, settlement/payment recording, Draft-cycle
materialization, the reservation-vs-settlement consistency review/fix, and the frontend operational
workflow) were already complete; Checkpoint 6A found and fixed one real gap Checkpoint 6 left open —
a `corrections:approve`-only reviewer could not see the Corrections sidebar item at all — with a
frontend-only fix (no backend/schema change) — see §1's Checkpoint 6A entry and §2's Phase 6 row.
**Current baseline: backend **781/781** on a clean run (**770/781** with the same 11 pre-existing,
independently-reproduced `payslips.test.ts` failures on environment-load-affected runs — confirmed
flaky, not deterministic), frontend **61/61**, E2E **21/21**, 17 migrations, zero schema drift. **Do
not begin Phase 6 Checkpoint 7 or any Phase 6 final close-out without its own separate, explicit
go-ahead** — same standing per-checkpoint practice as every other phase. The items below (originally
written 2026-07-13, for Phase 4/5) are carried forward for their still-open content only; their own
test-count/database figures are stale — use the baseline above instead.

1. **Re-provision the local database before running DB-backed tests** — it does not survive between
   sessions. Recipe unchanged: `@embedded-postgres/darwin-x64` in the scratchpad, `initdb`, start
   TCP-only, create the `payroll`/`payroll_dev` role/database, `cp backend/.env.example backend/.env`,
   `npx prisma migrate deploy`, seed twice (confirm idempotency), `npm run test --workspace backend`
   (expect **770-781/781** as of Phase 6 Checkpoint 6A — the up-to-11 `payslips.test.ts` failures are
   environment-load-sensitive flakiness, not deterministic; a fully clean 781/781 run has been
   observed — run via the `npm run test` script, which sets `NODE_ENV=test` and `--runInBand`; do not run
   `npx jest` directly with a sourced `.env`, which overrides `NODE_ENV` to `development` and drops
   the login rate limit from 1000/window to 10/window, producing spurious 429s).
   **The up-to-11 `payslips.test.ts` failures (PDF generation returning 500/400) remain open, but are
   now confirmed non-deterministic, not a fixed pre-existing state** — Checkpoint 6A observed both a
   full 11-failure run and a fully clean 781/781 run (all 11 passing) across consecutive full-suite
   runs in the same session with no code change between them, tracking this sandbox's system load
   (see Checkpoint 6A's own §1 entry) rather than a stable defect. Independently confirmed unrelated
   to the corrections domain regardless. Not investigated or repaired by any checkpoint to date
   (explicitly out of scope) — worth a dedicated pass before Phase 6's own final close-out, now with
   "reduce environment-load flakiness" as the framing rather than "fix a deterministic failure."
2. **Render production deployment is now live, and the Puppeteer/Chrome runtime-provisioning
   defect that blocked Payslip PDF generation there is resolved** — see
   `docs/RENDER_PRODUCTION_DEPLOYMENT.md` for the full incident record (root cause, troubleshooting
   timeline, final verified dashboard Build/Start commands). Production login and one individual
   Payslip PDF (open + download) were manually verified against the live deployment. **This closes
   the production PDF deployment blocker specifically** — it does **not** by itself close this
   Phase 4 condition in full: batch Payslip generation, font rendering under the real Linux
   container, memory stability under a real batch, and graceful shutdown against the live deploy
   remain separate, not-yet-performed verification work. Do not mark Phase 4 fully closed in §2
   until those remaining checks are also done.
3. **Phase 5 (Cycle Finalization, Archiving, and Backups) is COMPLETE AND CLOSED, 2026-07-16** — the
   architecture review, Checkpoint 0 (`StorageProvider` foundation, committed `d87b9b0`),
   Checkpoint 1 (Finalize Cycle, committed `cad93bc`), and Checkpoint 2 (Backup Packages reusable
   domain/generator, committed `3ea879e`) are complete, per this project's standing
   per-checkpoint/per-phase practice. Checkpoint 3 (cycle archiving, automatic backup generation,
   and new-cycle rollover) is complete, 2026-07-15, committed as `957ab9d` — see §1's Checkpoint 3
   entry. Checkpoint 4 (Historical Payroll Cycle Selector) is complete, 2026-07-16, committed as
   `10e3194` — its final review found and fixed a `passwordHash` response-serialization defect
   (Users module, not Checkpoint 4's own code — see §1's security-correction entry) before that
   commit — see §1's Checkpoint 4 entries. **The one remaining gap every checkpoint's own
   verification had carried forward — genuine browser-based verification — was closed this same
   session with a real Playwright/Chromium run (108/108 assertions, zero unexpected console
   errors, zero defects found) — see §1's "Phase 5 — final browser verification and close-out"
   entry.** Phase 6 requires its own separate, explicit go-ahead before any work begins, same as
   every other phase. **Known,
   documented gaps carried forward**: there is no post-finalization release path for a held entry yet
   (Checkpoint 1's own approved scope) — see `docs/architecture/workflows/payroll-lifecycle.md §4`'s
   "Released" state description; Payslip PDFs and an Audit Log export inside a Backup Package remain
   explicitly deferred — see `docs/architecture/workflows/payroll-lifecycle.md §5`. Automatic Backup
   Package generation on the cycle archive transition (previously listed here as deferred) is now
   implemented, Checkpoint 3. `StorageProvider`
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
