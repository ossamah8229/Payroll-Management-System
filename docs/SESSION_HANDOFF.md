# Session Handoff — Payroll Management System

Read this file first in any new session, alongside `docs/PROJECT_PROGRESS.md`. Together they should
be enough to resume correctly without re-deriving context from scratch — per
`docs/IMPLEMENTATION_PLAN.md`'s own "How to Resume This Project" section, the full read order is:
`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/overview.md` → rest of `docs/architecture/*.md` →
`docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`.

---

## 1. Current repository status

- Branch: `main`
- **Latest commit: `11cdc9d62728c15e35884512f1dda127777cd10e`** — "docs: close Phase 2 checkpoint
  (conditional) and record decisions". Working tree clean as of that commit. Full lineage:
  `7938659` (session start) → `2e804d4` (closed Phase 1, conditional) → `674ab04` (Phase 2's
  substantive build) → `89ac6ff` (Phase 2 UI/UX polish pass + final visual consistency audit) →
  `11cdc9d` (Phase 2 checkpoint documentation).
- **2026-07-03 session (this entry): documentation and architecture only, per explicit instruction —
  no commit made yet, no schema/migration/backend/frontend code touched.** A full pre-Phase-3
  architecture review produced six new business decisions (Project Unit model, Payroll Entry Work
  Lines, date display standard, a 10,000-employee performance floor, a CNIC duplicate-detection
  recommendation pending final sign-off, and a deployment-model reaffirmation), all written into
  `docs/architecture/database-schema.md`, `docs/architecture/overview.md`,
  `docs/architecture/folder-structure.md`, `docs/architecture/tech-stack.md`, `docs/design-system.md`,
  `docs/PROJECT_PRINCIPLES.md` (new Principle 10), and `docs/IMPLEMENTATION_PLAN.md` (new Phase 2.5).
  Full decision record: `docs/PROJECT_PROGRESS.md` §3 items 16–21.
- `npm run typecheck`/`lint`/`build` were **not** re-run this session since no code changed — they
  remain green as of `11cdc9d`, per the prior checkpoint.
- Still no DB-backed test has been run in any session (no Postgres available in the working
  environment — see §5/§7). This now applies to Phase 2's test suite, its two hand-written migrations,
  and the UI polish pass's migration, not just Phase 1's — unchanged by this session.

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
- **This Phase 2 work was subsequently committed as `674ab04`** ("Phase 2: Project Sites, Employee
  Registry, Settings, User Management") — the commit approval referenced above was obtained and
  acted on; `674ab04` is HEAD as of the polish pass below.

**Later same day: Phase 2 UI/UX polish pass (explicitly not Phase 3)** — full detail in
`docs/PROJECT_PROGRESS.md`'s "Phase 2 UI/UX polish pass" subsection. Summary: fixed a global
`AppShell` scroll bug (blank space above the sidebar on overscroll), added a local-time-based
dashboard greeting, fixed an Employee Registry table header/value alignment mismatch, added
`ProjectSite.address` (a scoped, explicitly user-authorized exception to this pass's own
no-schema-changes rule — see `docs/PROJECT_PROGRESS.md` §3 item 8 and
`docs/architecture/database-schema.md` §8's revision note), added a Company Logo placeholder section
to Settings and a matching logo slot on the login page (both UI-only, still blocked on
`StorageProvider`), improved Settings page spacing/hierarchy, standardized the seed script's company
name to "Broom Services Private Limited", and standardized `Button` height to match `Input`. A new
migration (`20260702165738_project_site_address`) was hand-written the same way as Phase 2's
migration, for the same reason (no Postgres reachable in this environment to run `prisma migrate
dev`) — validated via `prisma validate`/`format`, not yet applied to a live database.

**Still later same day: final visual consistency audit, then the Phase 2 checkpoint close.** The user
asked for one more pass — a full audit of every page/modal for spacing, alignment, typography,
padding, table headers, button heights, card widths, modal spacing, and responsive behavior — before
Phase 3. This is where Playwright-driven visual verification (real headless-Chromium rendering with
mocked API responses, screenshotted and measured, not just read as code) was actually used for the
first time in this project, and it caught two real, previously-undetected defects: a design-system-
contradicting label-casing inconsistency (8 call sites overriding the shared `Label` component to
`normal-case` for no discernible reason, contradicting `docs/design-system.md` §2.4's explicit
uppercase-filter-label rule) and a spacing value outside the documented scale (`gap-8`/`gap-9`,
self-introduced earlier the same pass). Both fixed. A suspected z-index stacking bug (dropdown menu
apparently rendering on top of a modal opened from it) was investigated with pixel-level sampling and
found to be a false alarm — a defensive fix was kept anyway (`Modal` now explicitly outranks
`DropdownMenuContent` in z-index) since it costs nothing and removes an implicit assumption. Full
detail in `docs/PROJECT_PROGRESS.md`'s "Final visual consistency audit" subsection.

The whole polish pass (layout fix, greeting, table alignment, Project Sites address, logo
placeholders, Settings layout, company name, button/input heights, plus this audit's two fixes) was
committed together as `89ac6ff` ("feat(ui): Phase 2 UI polish and UX improvements") after explicit
user approval — the commit message the user asked for at the start of the pass. The user then
explicitly stated **"Phase 2 is now complete"** and requested this formal checkpoint (this
documentation update), on the same conditional basis as Phase 1's closure (§4's DB-backed-
verification caveat carried forward as a tracked open item, not a blocker). **Phase 3 has not started
and must not begin without the user's explicit instruction next session.**

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
  `20260702084133_phase2_master_data`, `20260702165738_project_site_address`) should not be edited in
  place once applied anywhere beyond a fresh local dev database — per Principle 8 (additive-first
  schema evolution), later changes are new migrations, not edits to these.
- The C11 decision (Payroll Staff fully site-scoped on Employee Registry view/edit/create, no
  exceptions) is enforced via `assertSiteAccess()` in
  `backend/src/modules/employees/employees.service.ts` on every read/write path, including the
  site-change case on update and the import path. Do not add a code path that trusts a
  client-supplied `siteId` without this check.
- The `StorageProvider` gap (`docs/PROJECT_PROGRESS.md` §3 item 4) is a known, flagged deviation
  from the frozen Phase 0 plan — do not silently build an ad-hoc file-upload mechanism to route
  around it (e.g. a one-off multer-to-disk handler for the logo). **Confirmed 2026-07-02: deferred
  until before Phase 5**, not Phase 3 or Phase 4 — do not add file upload UI before then without
  building `StorageProvider` first. **New consideration, confirmed 2026-07-02** (`docs/PROJECT_
  PROGRESS.md` §3 item 13): design it for portability to whatever hosting a given customer provides —
  the deployment model remains single-company-per-installation (no multi-tenancy), but is not assumed
  to run on one specific hosting platform.
- **New, permanent process rule, added 2026-07-02**: every future phase's Definition of Done includes
  Playwright-driven visual verification (real headless-browser rendering + screenshots, mocked API
  data where no live backend/DB is available) as a mandatory step, in this order: typecheck → lint →
  build → Playwright visual verification → documentation update → git checkpoint. This is not optional
  polish — it caught real defects in the Phase 2 UI polish pass that static checks alone missed (see
  §2's final entry). Do not skip it for a future phase's frontend work on the assumption that
  typecheck/lint/build passing is sufficient.
- **New 2026-07-03, final architecture decisions — do not re-litigate:**
  - `ProjectSite` no longer owns a Branch Code or Department; `ProjectUnit` (a new, dedicated
    master-data module, not folded into Project Sites) is the operational sub-division an employee is
    deputed to. Internally generic, always displayed via that site's own `unitLabel` terminology.
  - **Explicit business rule, not merely a schema implication:** a `PayrollEntryWorkLine` may only
    reference a `ProjectUnit` belonging to the same `ProjectSite` as its parent `PayrollEntry` — an
    employee's Work Lines can never span more than one Project Site within a single cycle. Enforced
    at **two** independent layers, both required, neither a substitute for the other: a
    database-level **composite foreign key** (`(unitId, siteId) → ProjectUnit(id, siteId)`) and
    application-layer validation. `Employee.unitId` is paired with `Employee.siteId` the same way.
    Do not simplify either to a plain FK.
  - **Every `PayrollEntry` always has at least one `PayrollEntryWorkLine` — never optional, never
    zero.** This was an explicit simplification the user requested over an earlier "optional split"
    design specifically to keep `calcNet` to one calculation path. Do not reintroduce a
    split/non-split branch.
  - **No cross-site editing exception of any kind for a multi-unit employee.** Payroll Staff remain
    scoped to their assigned Project Sites only; multi-unit splitting is always intra-site (a
    `ProjectUnit` belongs to exactly one `ProjectSite`), which is precisely what makes this possible
    without a new RBAC concept. Do not add one.
  - Every user-facing date renders as `DD-MM-YYYY`; internal storage/API stay ISO. This is
    `docs/design-system.md` §4, a permanent UI standard, not a suggestion.
  - `docs/PROJECT_PRINCIPLES.md` Principle 10: the system must comfortably support **at least 10,000
    employees**. This is a design floor to weigh in every future phase, not a Phase 9 concern —
    Principle 4 (never sacrifice correctness for performance) is explicitly not in tension with it.
  - **CNIC duplicate handling is NOT yet decided.** A recommendation (keep the database-unique
    constraint, no override, add a Reactivate-employee action) is written into
    `docs/architecture/database-schema.md` §26 item 6 and `docs/PROJECT_PROGRESS.md` §3 item 20, but
    the user has explicitly reserved final sign-off before any constraint-related implementation.
    **Do not implement this as if it were already decided.**
  - A new **Phase 2.5** (`docs/IMPLEMENTATION_PLAN.md`) sits between Phase 2 and Phase 3, covering
    everything above plus CNIC normalization/reactivation and the `formatDate()` utility. **It has not
    been implemented — architecture and documentation only.** Phase 3 depends on it (specifically,
    `PayrollEntryWorkLine.unitId` cannot exist without `ProjectUnit`).

## 4. Current frozen architecture (reference index)

- `docs/PROJECT_PRINCIPLES.md` — **10 standing principles as of 2026-07-03** (e.g. Payroll Entry as
  single source of truth, additive-first migrations, insert-only Audit Log, and the new Principle 10:
  a 10,000-employee performance/scale design floor).
- `docs/architecture/overview.md` — the load-bearing data path: Employee Registry/Project Units →
  Payroll Entry (+ Payroll Entry Work Lines) → Payroll Processing → Release → Bank Sheets/Cash
  Receiving, with Corrections/Balance Adjustments as the highest-risk branch. Major Modules table now
  includes **Project Units** as its own module.
- `docs/architecture/database-schema.md` — **full 20-table schema as of 2026-07-03** (18 original +
  `ProjectUnit`, §8a, + `PayrollEntryWorkLine`, §12a; Phase 1 + Phase 2 together implement a subset of
  it; see §1 of `docs/PROJECT_PROGRESS.md`). §26 item 6 (new) holds the CNIC duplicate-detection
  recommendation still pending final sign-off.
- `docs/architecture/authentication.md` — session-based auth, CSRF double-submit, RBAC +
  site-scoping as independent middleware layers. **Unaffected by 2026-07-03's changes** — multi-unit
  attendance splitting is always intra-site, so no unit-level RBAC concept was introduced.
- `docs/architecture/post-release-corrections.md` — the baseline-reconstruction/replay algorithm,
  deliberately scheduled late (Phase 6) per the plan.
- `docs/architecture/data-and-storage.md` — `StorageProvider` abstraction, Finalize Cycle
  precondition, Backup Package versioning.
- `docs/design-system.md` — tokens (color/type/spacing/radius), layout patterns, the shared component
  inventory the frontend must reuse rather than re-implement per page, and, **as of 2026-07-03, §4's
  `DD-MM-YYYY` date-display convention** (alongside the existing `en-US` number-format convention).

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

**Phase 2 is CLOSED (conditional), 2026-07-02** — same conditional basis as Phase 1 (code-complete +
statically verified + explicit user sign-off, with DB-backed evidence carried forward as a tracked
open item, not a blocker):

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
      Definition of Done, `docs/IMPLEMENTATION_PLAN.md`) — logic is implemented and tested, but still
      not executed against a live database; this specific DB-backed check remains the one real gap
      carried into Phase 9 (see §4/§8), same pattern as Phase 1's five unchecked items.
- [x] Phase 2 UI/UX polish pass + final visual consistency audit (Playwright-verified) — see §2.
- [x] **🛑 Phase 2 review checkpoint sign-off — CONDITIONAL, obtained 2026-07-02.** The user explicitly
      stated "Phase 2 is now complete" and requested this checkpoint. Phase 2 has no explicit 🛑 gate
      in `docs/IMPLEMENTATION_PLAN.md` (unlike Phase 1/3/5/6/9), but per this project's established
      practice, an explicit sign-off was still obtained before Phase 3 — on the same conditional basis
      as Phase 1's: the one DB-backed item directly above remains open, not re-litigated.

**Bottom line: Phase 2 is closed (conditional), matching Phase 1's pattern exactly.** The one
DB-backed item above is real, tracked debt — close it out the first time a Postgres-capable
environment is available (see §7 item 2), before Phase 9's hardening pass at the latest.

## 7. Next steps, in order

**Phase 1 and Phase 2 are closed (conditional). Phase 2.5's architecture (Project Units, Payroll
Entry Work Lines prerequisite, Employee Registry refinements) was designed and documented 2026-07-03
but has no code yet. Do not begin Phase 2.5 or Phase 3 implementation without the user's explicit
instruction next session** — this is a standing instruction from this session's close-out, not an
inference.

1. **Get the CNIC duplicate-handling final decision** (`docs/architecture/database-schema.md` §26
   item 6 / `docs/PROJECT_PROGRESS.md` §3 item 20) — a recommendation is written up, but the user
   explicitly reserved final sign-off before any constraint-related work. Needed before Phase 2.5's
   CNIC-related items are implemented (the normalization/duplicate-check UX itself doesn't depend on
   this, but shouldn't be built as if the constraint question were already settled).
2. **When explicitly instructed to begin implementation, start with Phase 2.5**
   (`docs/IMPLEMENTATION_PLAN.md`) — the `ProjectUnit` migration (including the destructive
   `ProjectSite.branchCode` drop, this project's first), the dedicated Project Units module,
   `Employee.unitId`, the Employee Registry import/export template remap, CNIC
   normalization/duplicate-check/Reactivate action, and the shared `formatDate()`/`DD-MM-YYYY`
   convention. Phase 3 cannot build `PayrollEntryWorkLine.unitId` without this landing first.
3. The first time a Postgres-capable environment is available, run:
   ```bash
   cp backend/.env.example backend/.env
   npm run prisma:generate --workspace backend
   npx prisma migrate deploy --schema backend/prisma/schema.prisma
   npm run prisma:seed --workspace backend
   npm run test --workspace backend
   ```
   and confirm the full test suite (Phase 1's three files plus Phase 2's five) passes — or push the
   branch to get a real CI-backed Postgres run. This now also applies the `20260702165738_project_
   site_address` migration, and will need to apply Phase 2.5's migrations once they exist.
4. Build `StorageProvider` (`docs/PROJECT_PROGRESS.md` §3 item 4) — confirmed deferred until before
   Phase 5, not scheduled into Phase 2.5, 3, or 4. Design for hosting portability (§3 item 13).
5. Decide how Broom Services' own disbursement source bank account(s) should be modeled
   (`docs/PROJECT_PROGRESS.md` §3 item 7) — before Phase 4 schema work begins.
6. Confirm the two still-open design assumptions from `docs/architecture/database-schema.md` §26:
   calendar-month-only cycles before Phase 3, at-most-one-`ACTIVE`-`Advance`-per-type before Phase 4.
7. Optionally confirm the Employee Registry import template's redundant-column interpretation with the
   client (`docs/PROJECT_PROGRESS.md` §3 item 5) — likely resolved as a side effect of Phase 2.5's
   `ProjectUnit` remap, but worth an explicit client confirmation once that lands.
8. When explicitly instructed to begin Phase 3 (Payroll Entry & Payroll Processing) — `calcNet` over
   Work Lines, the Payroll Entry grid at a 10,000-employee design floor (Principle 10), optimistic
   locking, the largest single phase in the plan — its Definition of Done now includes Playwright-
   driven visual verification and a Principle-10 performance review as mandatory steps (§3's new
   process rules, `docs/IMPLEMENTATION_PLAN.md`'s "Definition of Done — Generic Criteria"), not just
   typecheck/lint/build.

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
  §26 items, the `ProjectSite.defaultBankId` removal, the `StorageProvider` deferral timing (confirmed:
  before Phase 5), `ProjectSite.address` (added, scoped exception), the company name ("Broom Services
  Private Limited"), and the deployment-portability nuance (single-company, but not
  hosting-provider-specific) — see `docs/PROJECT_PROGRESS.md` §3.
- **Still unresolved, carried forward**: the import-template redundant-column assumption (§3 item 5,
  likely resolved as a side effect of Phase 2.5's `ProjectUnit` remap but not yet confirmed with the
  client), Broom Services' own disbursement source account modeling (§3 item 7, including its two
  sub-questions — needed before Phase 4 schema work), the two open `database-schema.md` §26 design
  assumptions (calendar-month-only cycles, at-most-one-`ACTIVE`-`Advance`-per-type), and **the new
  CNIC duplicate-handling final decision (§26 item 6, added 2026-07-03)** — a recommendation is
  written up but explicitly not yet approved by the user — see `docs/PROJECT_PROGRESS.md` §3.
- **Assumption, flagged for revisit (2026-07-03)**: gross pay does not vary by Project Unit — verified
  against `reference/PROJECT_SPEC.md` and the schema doc (only the day-rate basis is documented as
  location-varying), but this is a documentation-based finding, not confirmed against the client's
  actual current practice. If real-world practice contradicts it, `PayrollEntryWorkLine`'s design
  (§12a) needs revisiting before Phase 3 schema work, since it currently assumes a single `grossPay`
  scalar per employee per cycle regardless of how many units they worked.
- **Assumption**: no one has manually altered the database, `.env`, or any untracked local file
  outside of what's described here since the last commit.
