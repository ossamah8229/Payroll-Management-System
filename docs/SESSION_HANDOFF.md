# Session Handoff — Payroll Management System

Read this file first in any new session, alongside `docs/PROJECT_PROGRESS.md`. Together they should
be enough to resume correctly without re-deriving context from scratch — per
`docs/IMPLEMENTATION_PLAN.md`'s own "How to Resume This Project" section, the full read order is:
`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/overview.md` → rest of `docs/architecture/*.md` →
`docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`.

---

## 1. Current repository status

- Branch: `main`
- Latest commit at this session's start: `79386593af49dcf58e61fdf81925f8a579e65878` — "docs: add
  Phase 1 progress, session handoff, and prototype". Working tree was clean. A mid-session commit
  (`2e804d4`, "docs: close Phase 1 (conditional) and resolve Bank/AdjustmentType/CompanySettings
  scope") closed Phase 1 before Phase 2 implementation began.
- `npm run typecheck`, `npm run lint`, and `npm run build` (backend + frontend) all pass cleanly
  across all three workspaces — verified repeatedly throughout this session, most recently after
  the last Phase 2 module (Employee Registry import/export) was added.
- Still no DB-backed test has been run in any session (no Postgres available in the working
  environment — see §5/§7). This now applies to Phase 2's test suite too, not just Phase 1's.

## 2. What was completed today (2026-07-02)

**Morning: Phase 1 close-out and decision resolution**
- Resumed per `docs/IMPLEMENTATION_PLAN.md`'s "How to Resume This Project"; verified branch/commit/
  clean tree; confirmed the repository matched the documentation exactly.
- Re-confirmed no Postgres is reachable in this environment (checked for Docker, Docker Compose,
  Podman, Homebrew, native `psql`/`pg_ctl`, Postgres.app — none present), and did not attempt to
  install one, per instruction.
- Resolved the Bank/AdjustmentType/CompanySettings Phase-1-vs-Phase-2 scope question with the user
  (ratified the existing `schema.prisma` narrowing) and the two Employee Registry §26 design
  assumptions (CNIC/employeeCode nullability, free-text designation/religion) — both updated in
  `docs/IMPLEMENTATION_PLAN.md`/`docs/architecture/database-schema.md`.
- Obtained the user's **explicit conditional sign-off** on the Phase 1 review checkpoint and
  committed the close-out as `2e804d4`.

**Afternoon: Phase 2 implementation, in full**
- Built all five Phase 2 deliverables per `docs/IMPLEMENTATION_PLAN.md`: the master-data migration
  (`Bank`/`Employee`/`AdjustmentType`/`CompanySettings`), Project Sites
  CRUD, Employee Registry CRUD (C11 site-scoped RBAC, CNIC/employeeCode uniqueness, DOL-based
  leaving), Employee Registry CSV/Excel import/export against the official template, the Settings
  module (Company Details/My Profile/Theme), and User Management — backend + tests + frontend for
  each, in that order, verifying `typecheck`/`lint`/`build` after every module rather than only at
  the end. Full detail in `docs/PROJECT_PROGRESS.md` §1.
- Added site-scoping boundary tests beyond the per-module basics, specifically covering the C11
  decision's "direct API call with a manipulated siteId" requirement, including an update-time
  site-change boundary case.
- Discovered and documented (did not silently work around) a gap: `StorageProvider`, called for in
  Phase 0's plan text, was never actually built in any prior session. Scoped Settings/My Profile to
  text fields only this session and flagged logo/avatar upload as blocked on this — see
  `docs/PROJECT_PROGRESS.md` §3 item 4 for the resolution options.
  Also flagged (non-blocking) the Employee Registry import template's two redundant-looking column
  pairs as an assumption worth client confirmation — §3 item 5.
- Generated three static HTML prototypes under `docs/prototypes/` at meaningful UI milestones
  (Project Sites, Employee Registry, Settings+Users) per the user's standing instruction.
- Added new dependencies: `@radix-ui/react-dialog` (frontend, first Modal component); `exceljs`,
  `csv-parse`, `csv-stringify`, `multer` (backend, import/export).

**Evening: architectural review before the Phase 2 commit**
- Before committing, the user reviewed the Phase 2 work and identified that
  `ProjectSite.defaultBankId` (added during this session) was wrong for Broom Services' actual
  business model: Project Sites are physical work locations only; employees own their own payment
  method/bank account; Broom Services itself owns the company bank account(s) used as disbursement
  *source* accounts. Removed `defaultBankId` completely — schema, the hand-edited (never-applied)
  migration, shared Zod schema, backend service/routes, frontend form/table, HTML prototype, and
  `docs/architecture/database-schema.md`'s §7/§8/§21 text (with an explicit dated revision note,
  since that document is otherwise frozen). See `docs/PROJECT_PROGRESS.md` §3 item 6 for the full
  reasoning.
- Performed a full architecture consistency review against the corrected business model and
  surfaced two further items *without* silently fixing them — `docs/PROJECT_PROGRESS.md` §3 items
  7–8: (a) Broom Services' own disbursement source bank account(s) aren't modeled anywhere yet
  (matters for Phase 4, not Phase 2); (b) `ProjectSite` may be missing `address`/`client` fields per
  the user's own restated model, though site names already encode the client as free text so this
  may not be a real gap. Both presented to the user for a decision, not resolved.
- Confirmed the deployment model is unaffected: single-company-per-installation (the `CompanySettings`
  singleton, fixed-UUID pattern) with no `Tenant`/`Organization`/`Workspace`/`Company` abstraction
  anywhere in the codebase — nothing needed to change here, this was a confirmation, not a fix.
- Re-ran `typecheck`/`lint`/`build` after the correction; this file and `docs/PROJECT_PROGRESS.md`
  updated again to reflect the revised Phase 2 state. A commit is still pending explicit user
  approval, now for the corrected version of Phase 2.

## 3. What must not be changed without approval

- Anything in `docs/architecture/*.md` or `docs/PROJECT_PRINCIPLES.md` — the architecture is
  explicitly frozen (see `docs/IMPLEMENTATION_PLAN.md`'s opening section). Any implementation detail
  that appears to contradict these documents must be raised, not silently reinterpreted.
- The phase ordering and review checkpoints in `docs/IMPLEMENTATION_PLAN.md` (🛑 after Phase 1,
  Phase 3, Phase 5, Phase 6, Phase 9) — these are explicit stop-and-approve gates, not suggestions.
- The Phase 1 Prisma schema's table scope (`Role`/`Permission`/`RolePermission`/`User`/
  `ProjectSite`(minimal)/`UserSiteAssignment`/`AuditLog`) is now the **confirmed, permanent** Phase 1
  scope — resolved 2026-07-02, see `docs/PROJECT_PROGRESS.md` §3.1. `Bank`/`AdjustmentType`/
  `CompanySettings` belong to Phase 2 per the now-updated `docs/IMPLEMENTATION_PLAN.md`. Do not
  re-litigate this without a new explicit request.
- Audit Log immutability: no application code path should ever add an update/delete export from
  `audit-log.service.ts`, and the database trigger from the
  `20260701164509_audit_log_immutability` migration must never be dropped or worked around.
- Existing migrations (`20260701164444_init`, `20260701164509_audit_log_immutability`,
  `20260702084133_phase2_master_data`) should not be edited in place once applied anywhere beyond a
  fresh local dev database — per Principle 8 (additive-first schema evolution), later changes are
  new migrations, not edits to these.
- The C11 decision (Payroll Staff fully site-scoped on Employee Registry view/edit/create, no
  exceptions) is enforced via `assertSiteAccess()` in
  `backend/src/modules/employees/employees.service.ts` on every read/write path, including the
  site-change case on update and the import path. Do not add a code path that trusts a
  client-supplied `siteId` without this check.
- The `StorageProvider` gap (`docs/PROJECT_PROGRESS.md` §3 item 4) is a known, flagged deviation
  from the frozen Phase 0 plan — do not silently build an ad-hoc file-upload mechanism to route
  around it (e.g. a one-off multer-to-disk handler for the logo). **Confirmed 2026-07-02: deferred
  until before Phase 5**, not Phase 3 or Phase 4 — do not add file upload UI before then without
  building `StorageProvider` first.

## 4. Current frozen architecture (reference index)

- `docs/PROJECT_PRINCIPLES.md` — the 8 standing principles (e.g. Payroll Entry as single source of
  truth, additive-first migrations, insert-only Audit Log).
- `docs/architecture/overview.md` — the load-bearing data path: Employee Registry → Payroll Entry →
  Payroll Processing → Release → Bank Sheets/Cash Receiving, with Corrections/Balance Adjustments as
  the highest-risk branch.
- `docs/architecture/database-schema.md` — full 18-table schema (Phase 1 + Phase 2 together
  implement an 11-table subset of it; see §1 of `docs/PROJECT_PROGRESS.md`).
- `docs/architecture/authentication.md` — session-based auth, CSRF double-submit, RBAC +
  site-scoping as independent middleware layers.
- `docs/architecture/post-release-corrections.md` — the baseline-reconstruction/replay algorithm,
  deliberately scheduled late (Phase 6) per the plan.
- `docs/architecture/data-and-storage.md` — `StorageProvider` abstraction, Finalize Cycle
  precondition, Backup Package versioning.
- `docs/design-system.md` — tokens (color/type/spacing/radius), layout patterns, and the shared
  component inventory the frontend must reuse rather than re-implement per page.

## 5. Phase 1 completion checklist

Per `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 Definition of Done:

- [x] Migration applies cleanly to an empty database *(believed true — migrations are additive and
      reviewed; still not re-verified against a live DB)*
- [ ] **Seed script confirmed idempotent against a live database** — still not run; tracked open item
- [ ] **Scripted login as the seeded Master Admin succeeds** — still not run; tracked open item
- [ ] **Scripted attempt to call a protected route without a session fails with 401** — covered by
      `auth.test.ts`, still not executed; tracked open item
- [ ] **Scripted attempt to update or delete an audit log row fails at the database level** —
      covered by `audit-log.test.ts`, still not executed; tracked open item
- [ ] **CSRF-missing requests to state-changing routes are rejected** — covered by `auth.test.ts`,
      still not executed; tracked open item
- [x] RBAC middleware unit tests (no DB required) — read-reviewed, logic matches spec
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean (0 errors)
- [x] **🛑 Review-checkpoint sign-off — CONDITIONAL, obtained 2026-07-02.** The user explicitly
      approved closing Phase 1 on code-complete + static-check evidence alone, given no Postgres is
      reachable in this environment, with the five unchecked items above carried forward as a tracked
      open item (not a re-opened blocker) to close before Phase 9's hardening pass.

**Bottom line: Phase 1 is closed (conditional).** The five DB-backed items above are real, tracked
debt — the first Postgres-capable environment (local Docker, or a CI push) should run
`npm run test --workspace backend` and check them off for real, but that is no longer a precondition
for Phase 2 work.

## 6. Phase 2 completion status

Phase 2 is **code-complete but not yet Definition-of-Done verified**, for the identical reason as
Phase 1 — no DB-backed evidence yet:

- [x] Master-data migration (`Bank`/`Employee`/`AdjustmentType`/`CompanySettings`) written and
      validated (`prisma validate`/`generate`/`format`); *not yet applied to a live database*.
      (`ProjectSite.defaultBankId` was added, then removed the same session after architectural
      review — see §2 "Evening" and `docs/PROJECT_PROGRESS.md` §3 item 6.)
- [x] Seed script extended (banks, adjustment types, company settings placeholder) — idempotent by
      construction (upserts throughout, matching Phase 1's pattern); *not yet run against a live
      database*.
- [x] Project Sites, Employee Registry, Settings, User Management: all built, backend + frontend.
- [x] Employee Registry CSV/Excel import/export against the official template.
- [x] Site-scoping boundary tests written, covering the C11 decision via direct API calls with a
      manipulated `siteId` (not just the intended UI path) — *not yet executed against a live
      database*.
- [x] `npm run typecheck` clean (all three workspaces).
- [x] `npm run lint` clean (0 errors, same 2 pre-existing warnings as Phase 1).
- [x] `npm run build` clean (backend + frontend production builds).
- [ ] **Master Admin can create a Payroll Staff user, assign sites, and confirm that user's session
      genuinely cannot see or touch employees/sites outside that assignment** (the Phase 2
      Definition of Done, `docs/IMPLEMENTATION_PLAN.md`) — logic is implemented and tested, but not
      executed against a live database this session.
- [ ] **🛑 Phase 2 review checkpoint sign-off** — not yet obtained (Phase 2 has no explicit 🛑 gate
      in the plan, unlike Phase 1/3/5/6/9, but the user should still confirm before Phase 3 begins,
      per this project's general practice this session).

## 7. Next steps, in order

1. Obtain the user's sign-off on Phase 2 (conditional, on the same basis as Phase 1) and a commit
   approval for this session's work.
2. The first time a Postgres-capable environment is available, run:
   ```bash
   cp backend/.env.example backend/.env
   npm run prisma:generate --workspace backend
   npx prisma migrate deploy --schema backend/prisma/schema.prisma
   npm run prisma:seed --workspace backend
   npm run test --workspace backend
   ```
   and confirm the full test suite (Phase 1's three files plus Phase 2's five) passes — or push the
   branch to get a real CI-backed Postgres run.
3. Build `StorageProvider` (`docs/PROJECT_PROGRESS.md` §3 item 4) — confirmed deferred until before
   Phase 5, not scheduled into Phase 3 or Phase 4.
4. Decide how Broom Services' own disbursement source bank account(s) should be modeled
   (`docs/PROJECT_PROGRESS.md` §3 item 7) — before Phase 4 schema work begins.
5. Decide whether `ProjectSite` needs `address`/`client` fields (`docs/PROJECT_PROGRESS.md` §3
   item 8) — not blocking, but cheap to resolve before Phase 2's Project Sites UI is relied on for
   real data entry.
6. Confirm the two still-open design assumptions from `docs/architecture/database-schema.md` §26:
   calendar-month-only cycles before Phase 3, at-most-one-`ACTIVE`-`Advance`-per-type before Phase 4.
7. Begin Phase 3 (Payroll Entry & Payroll Processing) — `calcNet`, the 1,500-row grid, optimistic
   locking — the largest single phase in the plan.

## 8. Risks and assumptions

- **Assumption**: the migrations as written are correct and will apply cleanly — this is inferred
  from code review and clean `prisma generate`/typecheck, not from an actual `migrate deploy` run
  against Postgres. This now includes the hand-written Phase 2 migration
  (`20260702084133_phase2_master_data`), built without `prisma migrate dev`'s auto-generation since
  no shadow database was available — cross-checked line-by-line against Phase 1's actual generated
  SQL for convention consistency, but still unverified against a real database.
- **Risk (open, tracked)**: if the DB-backed tests fail when finally run, the fix may touch files
  already committed — treat existing commits as a checkpoint to diff against, not untouchable
  history. This risk is explicitly accepted by proceeding under the conditional close pattern.
- **Resolved**: the Bank/AdjustmentType/CompanySettings scope question, the two Employee Registry
  §26 items, the `ProjectSite.defaultBankId` removal, and the `StorageProvider` deferral timing
  (confirmed: before Phase 5) — see `docs/PROJECT_PROGRESS.md` §3.
- **New, unresolved**: the import-template redundant-column assumption (§3 item 5), Broom Services'
  own disbursement source account modeling (§3 item 7), and whether `ProjectSite` needs `address`/
  `client` fields (§3 item 8) — see `docs/PROJECT_PROGRESS.md` §3.
- **Assumption**: no one has manually altered the database, `.env`, or any untracked local file
  outside of what's described here since the last commit.
