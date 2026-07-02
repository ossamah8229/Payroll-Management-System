# Project Progress — Payroll Management System

**Date:** 2026-07-02
**Latest git commit (at session start):** `2e804d4651affc0b4166824d53f83d2839038928` — "docs: close Phase 1 (conditional) and resolve Bank/AdjustmentType/CompanySettings scope"
**Branch:** `main`
**Current implementation phase:** Phase 2 (Project Sites, Employee Registry, Settings, User Management) — **code-complete**, same DB-backed-verification caveat as Phase 1 (see §4). Phase 3 has not started.

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
- `npm run typecheck`, `npm run lint`, and `npm run build` re-verified after this pass (see the
  session's final quality-check output for the authoritative result).
- A commit for this pass is pending explicit user approval, per the user's own instruction — nothing
  was committed automatically.

---

## 2. Remaining work (by phase, per `docs/IMPLEMENTATION_PLAN.md`)

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, RBAC, Audit Log | **Closed (conditional), 2026-07-02** — DB-backed test evidence still outstanding, tracked to close before Phase 9 |
| 2 | Project Sites, Employee Registry, Settings, User Management | **Code-complete, 2026-07-02** — same DB-backed-verification caveat as Phase 1, tracked to close before Phase 9 |
| 3 | Payroll Entry & Payroll Processing (`calcNet`, the 1,500-row grid) | Not started |
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
  static confidence, not a `migrate deploy` run. **This must be closed out — either by running the
  full suite in a Postgres-capable environment or via a real CI run — before Phase 9's production
  hardening pass at the latest, and ideally as soon as Docker/Postgres is available.**
- CI (`.github/workflows/ci.yml`) has never actually run — nothing has been pushed to a remote/PR
  yet. Pushing to get a real CI-backed Postgres run remains the fastest way to close the item above.
- `StorageProvider` does not exist despite being called for in Phase 0 — see §3 item 4. Logo/avatar
  upload UI was deliberately left out of Phase 2's Settings module for this reason.
- `README.md` previously stated "Phase 1 complete" without this verification caveat; corrected in a
  prior session's documentation pass, and now updated again for Phase 2.

---

## 5. Exact next action for the next development session

Phase 1 and Phase 2 are both code-complete (Phase 1 conditionally closed, Phase 2 pending the same
closure). Carry forward as background open items, not blockers, unless noted:

1. Close out the DB-backed verification gap (§4) — via a Docker/Postgres-capable environment or a
   real CI push — before Phase 9 at the latest. This now covers both Phase 1's and Phase 2's test
   suites and the hand-written Phase 2 migration.
2. Build `StorageProvider` — confirmed deferred until **before Phase 5** (§3 item 4; Backup Package
   generation hard-requires it). Not scheduled into Phase 3 or Phase 4. File uploads (logo/avatar)
   stay unavailable until then.
3. Confirm the two still-open design assumptions from `docs/architecture/database-schema.md` §26:
   item 5 (calendar-month-only cycles) before Phase 3, item 3 (at-most-one-`ACTIVE`-`Advance`-per-type)
   before Phase 4.
4. Optionally confirm the Employee Registry import template's redundant-column interpretation
   (§3 item 5) with the client — not blocking, but cheap to resolve early.
5. Obtain explicit sign-off on Phase 2, then begin Phase 3 (Payroll Entry & Payroll Processing) per
   `docs/IMPLEMENTATION_PLAN.md` — the largest single phase in the plan (`calcNet`, the 1,500-row
   grid, optimistic locking).
