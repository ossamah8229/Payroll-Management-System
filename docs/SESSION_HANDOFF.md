# Session Handoff — Payroll Management System

Read this file first in any new session, alongside `docs/PROJECT_PROGRESS.md`. Together they should
be enough to resume correctly without re-deriving context from scratch — per
`docs/IMPLEMENTATION_PLAN.md`'s own "How to Resume This Project" section, the full read order is:
`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/overview.md` → rest of `docs/architecture/*.md` →
`docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`.

---

## 1. Current repository status

- Branch: `main`
- **Latest committed commit: `3298e34`** — "feat(payroll): complete Phase 3 Checkpoint 6 performance
  validation". Full prior lineage:
  `674ab04` (Phase 2's substantive build) → `89ac6ff` (Phase 2 UI/UX polish pass) → `11cdc9d` (Phase
  2 checkpoint documentation) → `b7ba9cf` (pre-Phase-3 architecture review) → `74c124e` (further doc
  status update) → `0d9ea33` (Checkpoint 0) → `c60094c` (Checkpoint 1) → `70a45ad` (Checkpoint 2) →
  `b27f559` (Checkpoint 2 doc close) → `ed4ed1f` (**database-verification debt closed**, 2026-07-04)
  → `33f2b18` (Checkpoint 3) → `28d4192` (doc-only commit hash record) → `e26fe8c` (Checkpoint 4) →
  `0ca9a8f` (doc-only commit hash record, closing Phase 2.5) → `1c4d61f` (Phase 3 architecture
  freeze, doc-only) → `aefa64f` (Phase 3 Checkpoint 0 implementation) → `d9c3184` (doc-only commit
  hash record) → `55eda58` (Phase 3 Checkpoint 1 implementation) → `0d54a97` (Advance Deduction
  Deferral architecture amendment, doc-only, frozen 2026-07-09) → `e072da5` (Phase 3 Checkpoint 2
  implementation, reviewed and committed) → `3479bff` (doc-only commit hash record, closing
  Checkpoint 2) → `6be6e68` (Phase 3 Checkpoint 3 Split by Unit workflow implementation, reviewed,
  verified, and committed) → `70a52da` (Phase 3 Checkpoint 4 multi-site filtering and Copy to All
  implementation, reviewed, verified, and committed) → `b4c1d21` (Phase 3 Checkpoint 5 Payroll Entry
  CSV/Excel import/export implementation, reviewed, verified, and committed) → `4da8a01` (doc-only
  commit hash record, closing Checkpoint 5) → `3298e34` (Phase 3 Checkpoint 6 10,000-employee
  performance/concurrency validation implementation, reviewed, verified, and committed).
- **A Phase 3.5 architecture revision was decided 2026-07-10, documentation-only, NOT YET COMMITTED
  as of this entry.** Before Phase 4 begins, a new **Phase 3.5 — Tasks Workspace** is inserted between
  Phase 3 and Phase 4: the previously-planned Team Collaboration/Chat panel is permanently removed
  (never deferred) and replaced by a lightweight, ownership-based internal task-delegation tool. Full
  decision record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3.5 architecture revision" entry; the frozen
  decisions are repeated in §3 below. This same session also made the HTML-prototype
  review/create/update rule a permanent Definition-of-Done requirement
  (`docs/IMPLEMENTATION_PLAN.md`'s Definition of Done section), alongside the existing Playwright
  rule. **No code, schema, or prototype was touched — documentation only**, per this revision's own
  explicit scope. Affected files: `docs/architecture/database/tasks.md` (new), `docs/architecture/
  database/README.md`, `docs/architecture/overview.md`, `docs/architecture/authentication.md`,
  `docs/architecture/folder-structure.md`, `docs/design-system.md`, `docs/IMPLEMENTATION_PLAN.md`,
  this file, `docs/PROJECT_PROGRESS.md`. `reference/PROJECT_SPEC.md` and
  `reference/payroll_prototype.html` were **not** touched, per standing convention (frozen, never
  edited) — both still describe the retired Chat concept as client-provided historical reference only.
- **Phase 3 Checkpoint 6 (10,000-employee performance/concurrency validation) is reviewed, approved,
  verified, and COMMITTED as `3298e34` (2026-07-10). Phase 3 (Checkpoints 0–6) is now fully complete
  and closed — its own 🛑 review checkpoint has passed.** A read-only architecture review preceded
  implementation and froze five decisions before any code was written — see
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 6" entry for the full decision record; the
  frozen decisions are repeated in §3 below, permanently binding on any future session that touches
  this code. Measurement-first: a new committed backend performance/concurrency suite
  (`backend/tests/payroll-entry-performance.test.ts`, 9 tests against a synthetic 10,000-employee
  cycle) plus a real-browser Playwright pass drove every decision — **Decision 1 (fetch
  parallelization) was applied because measurement justified it** (sequential fetch measured at
  2.8s, ~94% of the 3s acceptable ceiling); **Decisions 2 (`LiveTotalsStore`) and 3 (cache
  invalidation) were deliberately left unchanged because measurement did not justify a change**. The
  measurement work also surfaced and fixed a real, pre-existing correctness bug — `createPayrollCycle`
  never assigned `sortOrder`, making pagination unstable at 10,000 tied rows (23 rows silently
  duplicated across page boundaries, 23 others dropped) — fixed in
  `payroll-processing.service.ts` with a dedicated regression test asserting 10,000 distinct
  `sortOrder` values. Verified: `typecheck`/`lint`/`build` clean across all three workspaces;
  **184/184 backend tests** (175 prior + 9 new) against live PostgreSQL; a real-browser regression
  pass confirming every Decision 4 target met (2.75s initial load, 47–52ms typing latency, zero
  scroll long tasks, 580ms Copy to All, stable memory) and zero regressions in inline autosave, the
  site filter, Copy to All scoping, and Split by Unit at 10,000-row scale. **Checkpoint 6 is complete
  and closed.**
- **Phase 3 Checkpoint 5 (Payroll Entry CSV/Excel import/export) is reviewed, approved, verified, and
  COMMITTED as `b4c1d21`.** A read-only architecture review preceded implementation and surfaced one
  three-option design fork plus four further open questions, all frozen by explicit user decision
  before any code was written — see `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 5" entry
  for the full decision record; the frozen decisions are repeated in §3 below, permanently binding on
  any future session that touches this code. Verified: `typecheck`/`lint`/`build` clean across all
  three workspaces; **175/175 backend tests** (165 prior + 10 new,
  `backend/tests/payroll-entry-import-export.test.ts`) against live PostgreSQL; a real-stack
  Playwright pass, **13/13 checks**. **Checkpoint 5 is complete and closed.**
- **Phase 3 Checkpoint 2 (Payroll Entry grid frontend) is reviewed, approved, verified, and
  COMMITTED.** A pre-commit verification pass found and fixed three genuine defects within scope: a
  numeric-input crash (unparseable text crashed the live `calcNet` preview — no error boundary
  existed anywhere in the app), the sticky totals row only summing currently-mounted/virtualized-
  visible rows (undercounting at scale), and a Cycle Days validation inconsistency (invalid
  keystrokes were silently discarded rather than flagged). All three are fixed; full record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 2" and "Pre-Commit Final Verification Pass"
  subsections. **Checkpoint 2 is complete and closed.**
- **Phase 3 Checkpoint 3 ("Split by {unitLabel}" workflow) is reviewed, approved, verified, and
  COMMITTED as `6be6e68`.** A dedicated design-only review preceded implementation and approved a
  Modal-based Split editor (over three other compared alternatives) with eight required
  implementation decisions — most importantly, that the modal shares the grid's existing debounced-
  autosave/optimistic-locking commit queue rather than introducing a separate Save/Cancel workflow.
  No backend or shared-schema changes were needed (Checkpoint 1 already built the Work Line CRUD
  this checkpoint calls). Before commit, an explicit final architectural verification pass (network-
  capture Playwright: autosave batching across multiple lines in one debounce window, queueing
  during an in-flight save, a rapid add/edit/delete restructuring stress test, and a Checkpoint 2
  regression check) found and fixed one further real bug — a totals-row column-misalignment from the
  new `units` column. `typecheck`/`lint`/`build` clean; backend suite re-confirmed at 160/160 against
  a freshly re-provisioned database. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3,
  Checkpoint 3" and "Pre-Commit Final Verification Pass" subsections. **Checkpoint 3 is complete and
  closed.**
- **Phase 3 Checkpoint 4 (multi-select site filter + "Copy to All") is reviewed, approved, verified,
  and COMMITTED as `70a52da` (2026-07-09).** A read-only architecture review preceded implementation,
  followed by a dedicated investigation answering two open questions with evidence from the actual
  codebase (not assumption): a new backend bulk-update endpoint is required (`database/schema-invariants.md`
  §23's standing "bulk writes over row-by-row loops" rule, the `employee.import` summary-audit
  precedent, and a real O(N²) cache-merge cost the looping alternative would introduce); Copy to All
  applies only to a split entry's **primary** work line (documentation was genuinely ambiguous on
  this point — stated as such, not silently resolved — with primary-line-only frozen for consistency
  with the grid's own existing inline columns). One new backend endpoint (`PATCH
  /api/v1/payroll-cycles/:cycleId/entries/bulk`, one transaction, one summary audit entry, a
  deliberate and documented exception to per-row optimistic locking for this endpoint only); the site
  filter itself needed no backend change (pure in-memory filtering of the already-fully-fetched
  entries array). New reusable `MultiSelectFilter` (`frontend/src/components/ui/multi-select-filter.tsx`,
  no Payroll-Entry-specific logic, per spec item 10's stated future reuse in Release Salary/Fines
  report) and `CopyToAllToolbar`. `typecheck`/`lint`/`build` clean; **5 new backend tests, full suite
  165/165** against a freshly re-provisioned database; a real-stack Playwright pass, **15/15 checks**,
  covering the filter, primary-line-only bulk targeting on a genuinely split entry, cross-site
  isolation, and explicit Checkpoint 2/3 regression checks. A final repository-wide verification pass
  (diff scope, merge markers, TODO/debug-logging sweeps, a fresh typecheck/lint/build, and both the
  backend suite and Playwright pass re-confirmed against a freshly re-provisioned database) found no
  defects before commit. Full record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 4"
  subsection. **Checkpoint 4 is complete and closed.**
- **The Advance Deduction Deferral architecture is now FROZEN (2026-07-09, architecture-only session,
  no application code).** New business rule: authorized users may defer an Advance's scheduled
  deduction to any future Draft payroll cycle before release (BR-ADV-001 through BR-ADV-006,
  `database/advances.md` §15). Two new tables (`ScheduledPayrollPeriod`, §10a;
  `AdvanceScheduleChange`, §15a) and two new `Advance` columns are speced, plus the generalized
  **Outstanding Payroll Obligations** extension seam on Payroll Processing's cycle bootstrap
  (`docs/architecture/workflows/outstanding-obligations.md`, `docs/architecture/overview.md` Extensibility). Full
  decision record: `docs/PROJECT_PROGRESS.md` §1's "Advance Deduction Deferral" subsection. **Do not
  reopen or redesign this without a genuine implementation blocker or a new business requirement** —
  Phase 4 should implement directly against this frozen documentation.
- **Phase 3 Checkpoint 1 (cycle bootstrap/creation, Payroll Entry/Work Line backend CRUD, RBAC/
  site-scoping, audit logging) is reviewed, approved, and COMMITTED** as `55eda58`. Two business
  decisions were frozen as part of this review — the **Payroll Bootstrap Rule** (continuing
  employees carry forward payroll-specific values from their prior entry, never from `Employee`'s
  own record, while designation/bank/unit/site fields always refresh from `Employee`'s current
  record) and **`PayrollEntry.siteId` is permanently non-editable via the update API** (site
  changes flow only through the Employee Transfer workflow). Both are recorded in full in
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 1" subsection and in code comments
  (`payroll-processing.service.ts`'s `createPayrollCycle`, `payroll-entry.ts`'s
  `updatePayrollEntrySchema`). **160/160 backend tests passing** (145 prior + 15 new),
  typecheck/lint/build clean.
- **Phase 3 Checkpoint 0 was completed in an earlier session** (schema/migration + shared
  `calcNet` — no routes, services, or frontend), committed as `aefa64f` + `d9c3184`. Full decision
  record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 0" subsection. **Checkpoints 2–6
  have NOT started** — each requires its own explicit go-ahead, per the checkpoint breakdown
  `docs/IMPLEMENTATION_PLAN.md`'s Phase 3 section established.
- **The earlier Phase 3 Architecture Review session (2026-07-05, architecture only, no code)**
  produced the complete Payroll Entry, Payroll Processing, Release (now per Project Unit), and
  Corrections/Balance Adjustments design now frozen into `docs/architecture/*.md` and
  `docs/IMPLEMENTATION_PLAN.md`. Full decision record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3
  Architecture Review" subsection. Checkpoint 0 implemented against that frozen design, with two
  explicitly approved deviations recorded in `database/payroll-entry.md` §12 and `database/schema-invariants.md` §25's dated revision notes
  (the `advanceId`/`eidAdvanceId` deferral to Phase 4, and the new `PayrollEntry.remarks` column)
  and one in `overview.md` (`calcNet`'s implementation living in `shared/`, not backend-only).
  Checkpoint 1 implements CRUD/RBAC against that same frozen design and Checkpoint 0's schema, with
  its own explicit, approved scope boundary around cycle creation (see below) and the now-frozen
  Payroll Bootstrap Rule/`siteId`-non-editable decisions above — none of these are
  docs/architecture/*.md revisions; all are implementation-level decisions recorded in
  `docs/PROJECT_PROGRESS.md`.
- Checkpoint 2 shipped (prior session): `Employee.unitId` + composite FK against
  `ProjectUnit(id, siteId)`, the new append-only `EmployeeTransferHistory` table, migration
  `20260703140000_employee_unit_and_transfer_history`, `assertUnitBelongsToSite()`, `updateEmployee()`
  rewritten to detect a transfer and write the Employee update + `EmployeeTransferHistory` row +
  `employee.transferred` `AuditLog` entry atomically in one transaction (also fixing a pre-existing,
  unrelated atomicity gap in the ordinary `employee.updated` path — see §3 below), a new reusable
  `SiteUnitSelect` component wired into the Employee Registry's create/edit form, interim
  import/export unit handling (single-unit-per-site auto-resolve; full column remap is Checkpoint 3),
  new/updated backend tests, and a `pluralize()`-utility-reuse fix caught while writing an error
  message. **Do not begin Checkpoint 3 without first closing the database-verification debt below —
  this is now an explicit, mandatory gate, not a background item.**
- **Phase 2 is complete and committed. The pre-Phase-3 architecture review is complete and
  committed.** A full pre-Phase-3 architecture review produced six new business decisions (Project
  Unit model, Payroll Entry Work Lines, date display standard, a 10,000-employee performance floor, a
  CNIC duplicate-detection recommendation, and a deployment-model reaffirmation), all written into
  `docs/architecture/database-schema.md`, `docs/architecture/overview.md`,
  `docs/architecture/folder-structure.md`, `docs/architecture/tech-stack.md`, `docs/design-system.md`,
  `docs/PROJECT_PRINCIPLES.md` (new Principle 10), and `docs/IMPLEMENTATION_PLAN.md` (new Phase 2.5).
  **The CNIC recommendation is now a finalized decision, not pending** — see §3 below and
  `docs/PROJECT_PROGRESS.md` §3 item 22. Full decision record: `docs/PROJECT_PROGRESS.md` §3 items
  16–22.
- **Phase 2.5 is now CLOSED (updated 2026-07-05 — this bullet described an in-progress state as of an
  earlier point in the project and is corrected here to avoid contradicting §1's current-status
  summary above).** All five checkpoints are complete and committed: 0–2 in prior sessions, the
  database-verification close and Checkpoint 3 (import/export remap to Project Units with
  three-layer Site/Unit validation) on 2026-07-04, and Checkpoint 4 (CNIC normalization, duplicate-
  check, Reactivate workflow) on 2026-07-05 — see §2's entries for the full detail on each.
- `npm run typecheck`, `npm run lint` (0 errors, same 3 pre-existing `react-refresh` warnings), and
  `npm run build` were all re-run at the end of this session after Checkpoint 2's code changes and
  are clean across all three workspaces. `backend/tests/date-utils.test.ts` and `rbac.test.ts` (no DB
  required) were run directly and pass (23/23 assertions); every updated/new DB-backed test file
  (`employees.test.ts`, `employees-import-export.test.ts`, `project-sites.test.ts`,
  `project-units.test.ts`) was confirmed to compile and execute correctly through `ts-jest`, failing
  only on the expected "no Postgres reachable" environment constraint — not a code defect. A final,
  whole-app Playwright pass (Employee Registry + Project Sites/Manage Units together) also ran clean
  with zero console errors.
- **The database-verification debt is CLOSED (2026-07-04).** Real PostgreSQL 18 was provisioned in
  the session sandbox (embedded-postgres npm binaries — no Docker/Homebrew needed; see
  `docs/PROJECT_PROGRESS.md` §1's "Database verification" subsection for the recipe). All six
  pre-existing migrations applied to a completely fresh database without modification; the full
  backend suite passes **78/78**; the composite FK and Audit Log immutability were additionally
  verified at the raw-SQL level; a second fresh database replayed the whole chain to prove
  reproducibility; and a first-ever **real-stack Playwright E2E** (live browser → frontend →
  backend → PostgreSQL, no mocks) passed with zero console errors. Four real defects were found and
  fixed — see §2's 2026-07-04 entry and §3's new rules. The live DB is scratchpad-local and must be
  re-provisioned each session (fast: migrate deploy + seed).

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
`database/sites-and-units.md` §8's revision note), added a Company Logo placeholder section
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

**This ordering was revised 2026-07-03 (Phase 2.5, Checkpoint 1) — `DropdownMenuContent` now
outranks `Modal`, not the other way around.** Checkpoint 1's Manage Units panel was the first place
in the app a `DropdownMenu` opens *from inside* an already-open `Modal`, and at the old ordering
this was a confirmed, reproducible bug (not a false alarm this time): the open Modal's own overlay
permanently intercepted every click on the nested dropdown's menu items. See
`docs/PROJECT_PROGRESS.md`'s Checkpoint 1 entry for the full reasoning and the trade-off this
re-opens (a still-unconfirmed, purely cosmetic transition-overlap risk in the original direction).

The whole polish pass (layout fix, greeting, table alignment, Project Sites address, logo
placeholders, Settings layout, company name, button/input heights, plus this audit's two fixes) was
committed together as `89ac6ff` ("feat(ui): Phase 2 UI polish and UX improvements") after explicit
user approval — the commit message the user asked for at the start of the pass. The user then
explicitly stated **"Phase 2 is now complete"** and requested this formal checkpoint (this
documentation update), on the same conditional basis as Phase 1's closure (`docs/PROJECT_PROGRESS.md`
§4's DB-backed-verification caveat carried forward as a tracked open item, not a blocker). **Phase 3 has not started
and must not begin without the user's explicit instruction next session.**

### What was completed this session (2026-07-03 to 2026-07-04)

A new session, picking up per "How to Resume This Project": confirmed branch/commit/clean tree
against `74c124e`, re-read the full doc set, and confirmed Phase 2 plus the pre-Phase-3 architecture
review were both genuinely complete and committed.

- **Approved the Phase 2.5 checkpoint breakdown** (Checkpoints 0–4) with five amendments: a
  Checkpoint 0 foundation step, three-layer Site/Unit import validation, dedicated employee transfer
  audit entries, a finalized CNIC/Reactivate policy (CNIC stays globally unique, no override,
  Reactivate for rehires), and the new `EmployeeTransferHistory` table — refined further to add
  `effectiveDate`/`remarks`/`transferredByUserId` and an explicit single-source-of-truth requirement
  for date formatting.
- **Checkpoint 0** — shared `formatDate()`/`parseDateInput()`/`toIsoDateOnly()` and a `DateInput`
  component; a full-codebase grep caught and fixed two pre-existing ad-hoc date-formatting call sites
  in the CSV/Excel export/import service. Committed as `0d9ea33`.
- **Checkpoint 1** — `ProjectUnit` as a dedicated master-data module, `ProjectSite.unitLabel`
  replacing `branchCode`, a "Manage Units" frontend panel. Playwright verification caught and fixed
  two real bugs: a nested-`Modal` Radix `aria-hidden` bug, and a `DropdownMenuContent`-behind-`Modal`
  z-index bug (this project's first `DropdownMenu`-inside-`Modal` usage). Committed as `c60094c`.
- **Checkpoint 2** — `Employee.unitId` + composite FK, `EmployeeTransferHistory`, atomic transfer
  writes (which also fixed a pre-existing, unrelated audit-logging atomicity gap in the ordinary
  employee-update path), a reusable `SiteUnitSelect` component, interim import/export unit handling.
  Also honored a Checkpoint-1 forward-reference by wiring up `deleteProjectUnit`'s previously-a-no-op
  delete guard. Committed in this session's final commit, together with this documentation update and
  refreshed HTML prototypes.
- **All four `docs/prototypes/*.html` files reviewed and updated** to reflect Checkpoints 0–2:
  Branch Code → Unit label throughout, a new "Manage Units panel" screen, `DD-MM-YYYY` date
  placeholders, a Site → Branch/Department cascading select in the Employee form. The two prototypes
  with nothing relevant to change (`phase1-preview.html`, `phase2-settings-users-preview.html`) were
  still reviewed individually and got a footer note confirming that review took place.
- **Full documentation consistency pass**: `IMPLEMENTATION_PLAN.md`, `PROJECT_PROGRESS.md`,
  `SESSION_HANDOFF.md` (this file), and `README.md` all updated to remove stale commit-hash
  references, "not yet committed" phrasing for now-committed work, and the outdated claim that
  Phase 2.5 was "architecture/documentation only."
- **The session was explicitly closed after Checkpoint 2** — the user's instruction was not to begin
  Checkpoint 3, and to make closing the database-verification debt the mandatory first task of the
  next session, ahead of any further implementation.

### What was completed this session (2026-07-04, evening): database-verification debt CLOSED

Executed exactly per §7 item 1 (as it stood): provisioned real PostgreSQL 18.4 in the sandbox
scratchpad via `@embedded-postgres/darwin-x64` (no Docker/Homebrew exists here; the binaries run
TCP-only on `localhost:5432` because the scratchpad path exceeds the Unix-socket length limit),
created the `payroll`/`payroll_dev` role/database matching `backend/.env.example`, and ran the full
sequence: `migrate deploy` (all six migrations applied to a fresh DB, unmodified, first try) → seed
(run twice — idempotency confirmed live) → full test suite.

**The first live run failed and surfaced four real defects, all fixed the same session** (full
detail: `docs/PROJECT_PROGRESS.md` §1 "Database verification"):
1. The Audit Log immutability trigger blocked the FK's own `ON DELETE SET NULL` — any `User` with
   audit history was undeletable, contradicting `database/audit-log.md` §16. Fixed by a new migration,
   `20260704180000_audit_log_allow_fk_actor_set_null` (permits exactly that one column transition,
   rejects everything else); dated revision notes added to `database/audit-log.md` §16 and
   `docs/architecture/system-conventions.md` §3.
2. Every `Employee` date write 500'd against real Postgres (Prisma `@db.Date` rejects the bare
   `YYYY-MM-DD` strings the Zod schemas produce) — create-with-DOB, mark-as-left, transfer
   `effectiveDate`, and import DOB/DOJ/DOL were all affected. Fixed via a new shared
   `isoDateToUtcDate()` in `shared/src/lib/date.ts`, applied at every Prisma date-write boundary.
3. `cleanTestData()` deleted AuditLog rows — rejected by the project's own trigger. Tests no longer
   delete audit rows (assertions were already entity-scoped); `EmployeeTransferHistory` cleanup was
   added in FK-safe order (its `RESTRICT` FKs otherwise block employee/user cleanup).
4. The login rate limiter (10/IP/15 min) tripped under one-login-per-test; relaxed to 1000 under
   `NODE_ENV=test` only — production limit unchanged.

After the fixes: **78/78 tests, 10/10 suites, green**; a second fresh database replayed all seven
migrations + seed + suite from zero; `prisma migrate diff` against a real shadow DB shows no drift;
raw-SQL probes confirmed the composite FK rejects cross-site pairs at the database level and the
audit trigger still rejects ordinary UPDATE/DELETE. Then typecheck/lint/build (all clean; frontend
`.tsbuildinfo` cleared first per §3's standing lesson) and a real-stack Playwright E2E — seeded-admin
login, site + two units created, employee created **with a DOB** (exercising fix 2 end to end), DOB
round-tripping as `15-03-1990`, same-site transfer writing its `EmployeeTransferHistory` row and
`employee.transferred` audit entry — zero console errors. E2E fixtures were cleaned from the dev DB
afterward (audit rows remain, by design). **Phase 1's five open DB-backed checklist items and
Phase 2's one are now genuinely closed — see §5/§6.**

### What was completed this session (2026-07-04, evening, continued): Checkpoint 3

Built immediately after the database verification closed, per the session plan — the first
checkpoint in this project developed with its DB-backed tests actually running. Full detail:
`docs/PROJECT_PROGRESS.md` §1's Checkpoint 3 subsection; plan text updated in
`docs/IMPLEMENTATION_PLAN.md` (Checkpoint 3 marked COMPLETE with the as-built mapping).

- **Export**: `Area`/`Area/Location` → the employee's `ProjectUnit.name` (documented aliases);
  `Branch Code` → `ProjectUnit.code`. The template's mapping comment is now a finalized decision,
  resolving `docs/PROJECT_PROGRESS.md` §3 item 5 (subject to one client sanity-check).
- **Import**: `resolveRowUnit()` resolves a row's unit within its named site by code, then name,
  case-insensitively; all provided columns must agree; a row naming no unit is a per-row error —
  Checkpoint 2's interim single-unit auto-resolution is gone. Error messages use the site's own
  `unitLabel` via `pluralize()`.
- **Three-layer validation**: (1) `resolveRowUnit()` explicitly rejects a unit that exists under a
  *different* site, naming the mismatch; (2) `assertUnitBelongsToSite()` — now exported — is
  re-asserted before every import write; (3) the composite FK backstops, now with its own raw-write
  test. Each layer has a test proving it catches the violation alone.
- **Import-driven transfers are real transfers**: `updateEmployee()`'s transfer block was extracted
  into a shared `recordEmployeeTransfer()` (single implementation of the history-row +
  `employee.transferred`-entry invariant); the import path calls it atomically with the row update
  whenever a row changes an existing employee's site/unit (reason: "Employee Registry import").
  `importEmployees()` now takes `RequestMeta`. The one-summary-`employee.import`-entry design is
  unchanged for non-transfer rows.
- **88/88 tests against live PostgreSQL**; typecheck/lint/build clean; real-stack Playwright pass
  drove an actual CSV upload through the UI (2 created, 1 cross-site row skipped with the exact
  per-row reason shown in the Import Results modal; units verified via the edit form; zero console
  errors). Prototypes reviewed — none depict import contents, none changed.

### What was completed this session (2026-07-05): Phase 3 Architecture Review — COMPLETE, no code

A dedicated, explicitly design-only session ("do not begin implementation yet" was the opening
instruction) run immediately after Phase 2.5 Checkpoint 4 closed. Objective: freeze the complete
Payroll Entry, Payroll Processing, Release, and Corrections/Balance Adjustments architecture before
any Phase 3 code is written, incorporating six new business rules — the system is not an attendance
management system; payroll managers may freely edit until release; "Ready for Release" is a
non-locking status; payroll releases independently per Project Unit; Finance may release immediately
or wait for client funding; corrections after release require Master User approval, with positive/
negative balances settling differently (immediate/deferred, or installment recovery).

**Full decision record: `docs/PROJECT_PROGRESS.md` §1's "Phase 3 Architecture Review" subsection** —
not duplicated here in full; the highlights any future session needs to know before touching Phase 3:

- **Release moves to Project Unit granularity** (`PayrollUnitRelease`, `database/release.md` §12b),
  executed by a new **Finance** role, not Payroll Staff. `PayrollEntry.released` keeps its existing
  shape but is now *derived* — an entry releases only once every Project Unit its work lines touch has
  released, so a multi-unit split employee (Phase 2.5's own capability) still resolves to exactly one
  net salary and one Bank Sheet row (Principle 1, 6 both held intact — this was the session's central
  design fork, resolved after weighing three candidate options with the user).
- **`PayrollUnitReadiness`** — the new, explicitly non-gating "Ready for Release" signal, modeled by
  row existence (not a boolean), the one deliberate exception to this schema's anti-deletion
  convention.
- **The correction trigger simplifies to one clause**: `PayrollEntry.released = true` (previously two
  clauses — released OR cycle-not-Draft — now redundant since Cycle status is itself derived).
- **`CorrectionRequest`** (`database/corrections.md §13a`) — any authorized payroll user may propose a correction; only a Master
  User may approve (producing a `Correction`) or reject it. A Master User correcting personally still
  bypasses this table entirely, unchanged from before this session.
- **`BalanceAdjustment` gains immediate/deferred timing** (`PAYABLE`, via a new `CorrectionPayment`
  table for the no-open-entry case, `database/balance-adjustments.md §14a`) **and installment recovery** (`RECOVERY`, via
  `recoveryInstallmentAmount`/`remainingAmount` and a new append-only `BalanceAdjustmentSettlement`
  history table, `database/balance-adjustments.md §14b`, mirroring `Advance.scheduledInstallmentAmount`'s and
  `EmployeeTransferHistory`'s already-established patterns respectively).
- **Late Entry exception**: an entry created after its Unit already released needs its own one-off
  release (`PayrollEntry.lateReason`, a single field — "is this entry late" is derived, never stored).
  Documented (not yet built): its one-off document should share implementation with
  `CorrectionPayment`'s where practical, while staying separate business entities.
- **`FINANCE`** — new, third, site-scoped role (reuses `UserSiteAssignment`, no new mechanism); can
  view payroll/release Units/execute Correction Payments; explicitly cannot edit payroll, mark Ready,
  or approve/reject corrections.
- **"Master Admin" renamed "Master User"** — `docs/architecture/*.md` and `docs/IMPLEMENTATION_PLAN.md`
  **only**. Not applied to `reference/PROJECT_SPEC.md` (frozen, never edited), the HTML prototypes
  (reviewed this session, left unchanged — see below), or this file's/`PROJECT_PROGRESS.md`'s own
  historical entries.

**Net schema growth:** 5 new tables, 2 new enums, 4 new columns across `PayrollEntry`/
`BalanceAdjustment` — bringing the documented schema to 25 tables. **None of this exists in
`backend/prisma/schema.prisma` yet** — it's a design specification, same as the rest of
`docs/architecture/database/`, waiting for Phase 3 implementation.

**Files touched:** `docs/architecture/database-schema.md`, `data-and-storage.md`,
`post-release-corrections.md`, `authentication.md`, `overview.md`, `docs/IMPLEMENTATION_PLAN.md`
(Phase 3/4/6 sections + file-wide Master User rename). `docs/PROJECT_PRINCIPLES.md` reviewed, no
changes needed — every decision is additive/consistent with the existing ten principles.

**HTML prototypes reviewed this session, none refreshed**: none of the four existing prototypes
(`phase1-preview.html`, `phase2-project-sites-preview.html`,
`phase2-employee-registry-preview.html`, `phase2-settings-users-preview.html`) depict Payroll Entry,
Release, or Corrections screens, so nothing in them is factually contradicted by tonight's decisions.
The full UI/UX prototype pass for these new screens stays deferred until the corresponding functional
phases are actually built, per standing project practice — this was a deliberate "leave alone unless
factually wrong" review, not an oversight.

**No architectural questions remain open from this session.** Pre-existing open items unrelated to
tonight (Company Bank Account modeling, at-most-one-`ACTIVE`-`Advance`-per-type, calendar-month-only
cycles — `docs/PROJECT_PROGRESS.md` §3) are untouched, still open on their own original timelines.

**Documentation architecture restructuring — COMPLETE, 2026-07-08.** Commit `cfc4ef4`
(`docs(architecture): split architecture into modular bounded-context documentation`).
`docs/architecture/database-schema.md`, `data-and-storage.md`, and `post-release-corrections.md`
were split into bounded-context files under the new `docs/architecture/database/` (13 schema files
+ `README.md` index), the new `docs/architecture/workflows/` (3 workflow narratives), and a new
`docs/architecture/system-conventions.md`, per a restructuring plan frozen across multiple
architecture-review rounds — global §-numbering preserved unchanged, the Documentation Ownership
Rule and a size guideline adopted (`docs/architecture/folder-structure.md`). **Documentation-only:
no application behavior, database schema, migrations, or API surface changed** — every code and
migration comment citing an old path was rewritten to its new location (migration `.sql` files had
only `--` comment lines touched, never DDL), and all three workspaces typecheck cleanly. A
dedicated pre-commit documentation-integrity audit (bare `§N` cross-reference review across the
three process docs) preceded the commit.

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
  `audit-log.service.ts`, and the database trigger (originally
  `20260701164509_audit_log_immutability`, amended by
  `20260704180000_audit_log_allow_fk_actor_set_null`) must never be dropped or worked around.
  **The 2026-07-04 amendment is not a weakening**: it permits exactly one UPDATE shape — the
  `actorUserId` NOT NULL → NULL transition the FK's documented `ON DELETE SET NULL` action produces
  (`database/audit-log.md` §16's revision note) — and still rejects every other UPDATE and all DELETEs,
  verified live. Do not widen it further.
- **New rule (2026-07-04): every Prisma write to a `@db.Date` column goes through
  `isoDateToUtcDate()`** (`shared/src/lib/date.ts`) — Prisma rejects the bare `YYYY-MM-DD` strings
  the Zod schemas validate, and this was a real, live-DB-only 500 on every Employee date write.
  When adding any new date field (Phase 3's cycles, Phase 4's advances `dateGiven`, etc.), convert
  at the write boundary; grep for unconverted writes before calling the work done.
- Existing migrations (`20260701164444_init`, `20260701164509_audit_log_immutability`,
  `20260702084133_phase2_master_data`, `20260702165738_project_site_address`,
  `20260703100000_project_units`, `20260703140000_employee_unit_and_transfer_history`,
  `20260704180000_audit_log_allow_fk_actor_set_null`) should not be edited in
  place once applied anywhere beyond a fresh local dev database — per Principle 8 (additive-first
  schema evolution), later changes are new migrations, not edits to these. All seven are now
  verified against real PostgreSQL (2026-07-04).
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
  - **CNIC duplicate handling is now finalized (2026-07-03, session 2) — no longer pending.** CNIC
    stays globally unique with no override mechanism; duplicate `Employee` records are never
    permitted; rehires go exclusively through a new Reactivate Employee action that updates the
    existing row in place. See `database/schema-invariants.md` §26 item 6 (rewritten as a final
    decision) and `docs/PROJECT_PROGRESS.md` §3 item 22. **Per standing instruction, the concrete
    implementation (exact endpoint shapes, fields touched, audit contents) still gets presented for
    approval before Checkpoint 4's code is written** — the policy is settled, the implementation still
    gets a design-review gate.
  - **`EmployeeTransferHistory`** (new table, `database/employee.md` §8b) — one row
    per Employee site/unit transfer (`effectiveDate`, `transferredByUserId`, optional `reason`/
    `remarks`, `createdAt`), append-only except by direct database intervention, no UI in Phase 2.5.
    Employee transfers also write a dedicated `employee.transferred` `AuditLog` entry, not the generic
    `employee.updated` entry. Do not fold these into a generic update path.
  - A new **Phase 2.5** (`docs/IMPLEMENTATION_PLAN.md`) sits between Phase 2 and Phase 3, now broken
    into five explicit, individually-gated checkpoints (0–4). **Checkpoints 0, 1, and 2 are all
    committed; Checkpoints 3–4 have not started**, and won't until the database-verification debt
    (§1 above) closes out. Phase 3 depends on it (specifically, `PayrollEntryWorkLine.unitId` cannot
    exist without `ProjectUnit`, built in Checkpoint 1).
  - **`ProjectUnit` now exists in the schema and is queryable** (Checkpoint 1,
    `backend/prisma/schema.prisma`, migration `20260703100000_project_units`) — nested under a
    Project Site, CRUD via the dedicated `project-units` module
    (`backend/src/modules/project-units/`), mounted at `/api/v1/sites/:siteId/units` (list/create,
    `requireSiteAccess`-gated) and `/api/v1/units/:id` (update/delete, `sites:manage`-gated).
    `ProjectSite.branchCode` no longer exists anywhere in the codebase — it is `unitLabel` now.
    `deleteProjectSite` blocks on referencing `ProjectUnit` rows in addition to `Employee` rows.
    **`Employee.unitId` still does not exist** (Checkpoint 2) — `deleteProjectUnit`'s guard is
    therefore currently a no-op in practice (nothing references a unit yet) and is explicitly flagged
    as such in its own code comment; do not mistake this for a finished guard.
  - **`DropdownMenuContent`'s z-index was raised above `Modal`'s (`z-[70]` vs. `z-[60]`), reversing
    the 2026-07-02 Phase 2 polish-audit ordering** (`frontend/src/components/ui/dropdown-menu.tsx`,
    `modal.tsx`). Checkpoint 1's Manage Units panel was the first place in the app a `DropdownMenu`
    opens *from inside* an already-open `Modal`; at the old ordering this was a **confirmed,
    reproducible bug** (not the "false alarm" the 2026-07-02 audit found in the other direction) — the
    open Modal's own overlay permanently intercepted every click on the nested dropdown, verified via
    Playwright to persist indefinitely, not just during a transition. This re-opens a still-unconfirmed,
    purely cosmetic risk in the original direction (a dropdown closing at the same moment a new Modal
    opens from it could theoretically render above that new Modal during the fade transition) — judged
    an acceptable trade-off since that risk was never confirmed as a real bug, while the one just fixed
    was. Do not revert this ordering without re-verifying the Manage Units panel (or any future
    dropdown-inside-modal usage) still works.
  - **`Employee.unitId` now exists and is required** (Checkpoint 2, migration
    `20260703140000_employee_unit_and_transfer_history`), composite-FK'd against
    `ProjectUnit(id, siteId)`. Every place that creates an `Employee` — the API, the CSV/Excel
    importer, and every test fixture — must supply a valid `unitId` belonging to the same site.
    `deleteProjectUnit`'s delete guard (Checkpoint 1, previously a documented no-op) is **now wired
    up** to block deletion while any `Employee.unitId` references the unit, honoring the forward
    reference left in that function's own Checkpoint 1 code comment — the `PayrollEntryWorkLine`
    half of this guard still belongs here once Phase 3 adds that table.
  - **`EmployeeTransferHistory` exists and is written to** whenever an Employee edit changes
    `siteId`/`unitId`, in the same transaction as the Employee update and a dedicated
    `employee.transferred` `AuditLog` entry (never the generic `employee.updated` entry for that
    specific change — other fields changed in the same request still get the generic entry). No UI
    consumes this table yet, per the original design.
  - **A pre-existing atomicity gap, unrelated to the new transfer logic, was found and fixed while
    implementing Checkpoint 2's explicit "atomic in a single transaction" requirement**: before this
    checkpoint, `employees.routes.ts`'s PATCH handler logged the generic `employee.updated` audit
    entry itself, *after* `updateEmployee()` returned — not in the same database transaction as the
    `Employee` row update, a real (if narrow) Principle 3 violation. Fixed by moving all audit
    logging for employee updates inside `updateEmployee()`'s own `prisma.$transaction(...)`. This
    wasn't asked for directly, but was necessary to make the transfer case genuinely atomic, and the
    fix applies to the ordinary update path too, not just the new one.
  - **Lesson learned, worth repeating for future sessions**: a stale `tsc -b` incremental cache
    (`frontend/dist-types-app/*.tsbuildinfo`) briefly reported a clean frontend typecheck despite a
    real, missing-`unitId` type error in `employees-page.tsx` — caught only because the clean result
    looked suspicious given that file hadn't been touched yet. **Whenever `@payroll/shared` changes,
    clear frontend's `.tsbuildinfo` files before trusting `npm run typecheck --workspace frontend`.**
- **New 2026-07-05, Phase 3 Architecture Review — final decisions, do not re-litigate:**
  - **Release granularity is per Project Unit, not per Site/Cycle.** `PayrollUnitRelease`
    (`database/release.md` §12b) is the release event; `PayrollEntry.released` is derived from it,
    releasing an entry only once *every* Project Unit its work lines touch has released. Do not
    reintroduce a direct per-employee "release" write path, and do not collapse a multi-unit entry's
    release back to "whichever unit releases first" — it must wait for all of them, preserving one
    entry/one net salary/one Bank Sheet row.
  - **`PayrollUnitReadiness` ("Ready for Release") is permanently non-gating.** Do not add any code
    path where Finance's ability to release a Unit depends on whether it was marked Ready — this was
    an explicit business rule ("NOT locked"), not an oversight to "fix" later.
  - **`FINANCE` is a real, permanent third role**, site-scoped identically to Payroll Staff, holding
    `payroll:view` (read-only) + `payroll:release` + `bank-sheets:view`/`cash-receiving:view` only. Do
    not grant Finance payroll-edit, mark-ready, or corrections-approve/reject permissions — the
    separation of preparation/execution/governance across Payroll Staff/Finance/Master User is
    deliberate, not provisional.
  - **The correction trigger is now one clause**: `PayrollEntry.released = true`. Do not reintroduce
    the old two-clause "OR cycle no longer Draft" form — it's now redundant by construction, since
    Cycle status is itself derived from Unit releases.
  - **`CorrectionRequest` (`database/corrections.md §13a`) is the only path for a non-Master-User-initiated correction.** A
    Master User correcting directly still bypasses it entirely — do not force every correction through
    the request table regardless of who's making it.
  - **`BalanceAdjustment.paymentTiming`/`recoveryInstallmentAmount`/`remainingAmount` are additive.**
    `NULL` `recoveryInstallmentAmount` must continue to reproduce the original full-amount-next-cycle
    behavior exactly — this is a regression risk worth its own explicit test when Phase 6 is built.
  - **A Late Entry (`PayrollEntry.lateReason`) only applies while its Cycle is still Draft.** Do not
    extend this exception to an already-`Released` cycle — a new hire after full cycle finalization
    simply waits for the next cycle, no exception needed there.
  - **"Master Admin" → "Master User" is scoped to `docs/architecture/*.md` and
    `docs/IMPLEMENTATION_PLAN.md` only.** Do not rename it in `reference/PROJECT_SPEC.md` (frozen,
    never edited) or in this file's/`PROJECT_PROGRESS.md`'s own historical entries describing what was
    literally built and named at the time — those are accurate historical record, not architecture.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3 Architecture Review"
    subsection. **Phase 3 implementation still requires separate, explicit authorization** — the
    architecture being frozen does not itself authorize starting to write code.
- **New 2026-07-07, Phase 3 Checkpoint 0 — implementation decisions, do not re-litigate:**
  - **`PayrollEntry.advanceId`/`.eidAdvanceId` do not exist yet.** Deferred to a Phase 4 additive
    migration (they FK to `Advance`, which Phase 4 builds). Do not add them to a Checkpoint 1–6
    migration — they land specifically when Phase 4 introduces `Advance`.
  - **`PayrollEntry.remarks` (nullable text) exists**, an approved addition beyond
    `database/payroll-entry.md` §12's original design — ordinarily Draft-editable, frozen into the permanent
    snapshot once released, intended as the Payroll Entry grid's last column (a later checkpoint's UI
    work, not yet built).
  - **`calcNet`'s implementation lives in `shared/src/lib/calc-net.ts`**, not backend-only — exported
    from `@payroll/shared`, built on a new `decimal.js` dependency. **There must be exactly one
    implementation**, used by backend Payroll Processing, the frontend's live grid totals,
    import/export, reports, and (Phase 6) correction calculations. Do not write a second, backend- or
    frontend-only reimplementation of this formula anywhere.
  - **Rounding policy, do not relitigate**: every intermediate value feeding a further
    multiplication/division (daily rate, effective OT rate, effective leave rate) is carried at full
    decimal precision and never rounded before use in the next step. Only `earnedAmount`/`otEarned`/
    `leaveEarned` — each "done" being multiplied/divided — are rounded to 2dp (`ROUND_HALF_UP`).
    `totalEarning`/`totalDeduction`/`netSalary` are pure addition/subtraction of already-2dp values,
    guaranteeing `netSalary` always exactly equals `totalEarning - totalDeduction` as displayed. Do
    not round a rate before multiplying it, and do not compute `netSalary` from independently
    re-rounded full-precision totals — the existing addition-of-already-rounded-values approach is
    what keeps the payslip's own numbers internally consistent.
  - **No routes, service layer, frontend component, cycle-bootstrap action, or `AuditLog`/RBAC changes
    exist for Payroll Entry/Processing yet.** Checkpoint 0 is schema/migration + `calcNet` only.
    Checkpoint 1 owns the cycle bootstrap ("Start First Payroll Cycle", Master-User-only, audited,
    available only when zero `PayrollCycle` rows exist) and the first CRUD/read routes.
  - **`--shadow-database-url` must always point at a dedicated, disposable database** (e.g.
    `payroll_shadow`), never the working `payroll_dev` scratch database — Prisma uses that URL as
    scratch space and will reset whatever database it points at. This was a real process mistake this
    checkpoint (no lasting harm, since `payroll_dev` is ephemeral by design, but avoid repeating it).
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 0" subsection.
    **Checkpoint 1 still requires its own separate, explicit authorization** — Checkpoint 0 being
    complete does not itself authorize starting Checkpoint 1.
- **New 2026-07-07, Phase 3 Checkpoint 1 — implementation decisions, do not re-litigate:**
  - **`createPayrollCycle` is one function for both the first-ever cycle and every subsequent
    one.** Enforces only the one timeless invariant (§10): a single `DRAFT` cycle at a time. It
    does **not** require the outgoing cycle to be `RELEASED`, does not archive it, does not
    generate a `BackupPackage`, and does not account for departed employees with a pending
    `BalanceAdjustment` — that full transaction is explicitly Phase 5's job. Do not extend
    `createPayrollCycle` with any of that; build it as Phase 5's own, separate mechanism when
    Finalize/Release/`BackupPackage`/`BalanceAdjustment` exist.
  - **The Payroll Bootstrap Rule — a frozen business rule, confirmed 2026-07-07 (do not
    re-litigate):** a continuing employee's `grossPay`/`eobiAmount`/`eobiApplicable`/`leaveRate`
    and new line's `cycleDays`/`otRate` — payroll-specific values — always come from their most
    recent **prior entry**, never `Employee`'s own record (payroll values represent payroll history
    and stay stable until intentionally changed in Payroll Entry itself). `designation`, `bankId`,
    `branchCode`, `accountNumber`, `accountTitle`, and the new line's `unitId` (Primary Project
    Unit) always refresh from `Employee`'s **current** record instead (Employee master data should
    always reflect the latest assignment/banking information) — which is also what keeps a
    cross-site transfer's new entry consistent with its own work line's unit (the composite-FK
    invariant). Do not change which fields draw from which source without a new explicit decision.
  - **`PayrollEntry.siteId` is permanently non-editable via the update API — confirmed 2026-07-07,
    do not re-litigate.** Future site changes flow exclusively through the Employee Transfer
    workflow (picked up automatically by the next cycle's bootstrap via the Payroll Bootstrap Rule
    above), never a direct edit to an existing entry's site.
  - **`PERMISSIONS.PAYROLL_CYCLE_MANAGE` is Master-User-only** — cycle creation is a
    system-lifecycle action, not Payroll Staff's routine data entry. Do not grant it to Payroll
    Staff or fold it into `PERMISSIONS.PAYROLL_ENTRY`.
  - **Work-line mutations never get their own `AuditLog` action type.** Adding/updating/deleting a
    `PayrollEntryWorkLine` is folded into a `payroll_entry.updated` entry (`database/schema-invariants.md §22`'s explicit
    instruction) — do not introduce a `payroll_entry_work_line.*` action.
  - **`deletePayrollEntry` is permitted only while unreleased and the cycle is still Draft** — this
    is Draft data entry, not yet "historical payroll," so Principle 2 does not block it. Do not
    extend delete permission to a released entry or a non-Draft cycle.
  - **`backend/src/common/audit-diff.ts` and `backend/src/common/request-meta.ts` are now the
    single implementations** of the field-diff/`RequestMeta` utilities — `employees.service.ts`
    imports from them rather than defining its own copy. Any future module needing the same
    concern imports from these files; do not reintroduce a local copy.
  - **`createPayrollCycleSchema`'s `year` bound is 2000–2999**, not a narrower "realistic" range —
    deliberately wide enough to include the project's own `year: 2900` test-fixture convention.
    Do not narrow it back to exclude 2900 without also changing that test convention.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 1" subsection.
    **Checkpoint 2 still requires its own separate, explicit authorization.**
- **New 2026-07-09, final architecture decisions — Advance Deduction Deferral, do not re-litigate:**
  - BR-ADV-001 through BR-ADV-006 (`database/advances.md` §15) are frozen business
    rules. An Advance's scheduled deduction may be deferred, before release, to any future Draft
    payroll cycle — not limited to "next" or "one after next" — by Payroll Staff (site-scoped) or
    Master User, with a mandatory reason, permanently recorded.
  - **`ScheduledPayrollPeriod`** (`database/payroll-cycle.md §10a`) is the single, canonical representation of a not-yet-existing
    future payroll period — never a raw `(year, month)` scalar pair on any other table. It is
    **infrastructure owned exclusively by Payroll Processing**: domain modules (Advances) may only
    reference it by foreign key and must go through Payroll Processing's own exposed find-or-create
    function — never a direct write. Do not reintroduce year/month scalars on `Advance` or any future
    obligation provider's tables to work around this.
  - **`AdvanceScheduleChange`** (`database/advances.md §15a`) is append-only (no updates, no deletes, only inserts) — named
    for recording schedule *changes*, not the schedule itself (that's `Advance.currentScheduledPeriodId`).
    Do not rename it back to something deferral-specific if a future "bring forward" rule arrives —
    extend it additively instead.
  - **Outstanding Payroll Obligations** (`docs/architecture/workflows/outstanding-obligations.md`,
    `docs/architecture/overview.md` Extensibility) is the generalized new-cycle carry-forward seam.
    Payroll Processing's bootstrap must never contain obligation-specific (e.g. `BalanceAdjustment`- or
    `Advance`-specific) knowledge, and registered providers must never be order-dependent. A future
    obligation type registers its own predicate/**Payroll Materialization Hook** — do not hardcode a
    new provider's checks directly into Payroll Processing's bootstrap logic.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Advance Deduction Deferral" subsection.
    **This architecture is frozen — do not reopen or redesign it unless implementation reveals a
    genuine blocker or a new business requirement is introduced.** Phase 4 implements directly against
    it. Phase 3 Checkpoint 2 is unaffected and still requires its own separate authorization.
- **New 2026-07-09, Phase 3 Checkpoint 5 — implementation decisions, do not re-litigate (implemented,
  verified, and COMMITTED as `b4c1d21` — see §1 above):**
  - **The Payroll Entry import/export file format is permanently flat, representing only an entry's
    primary work line ("Option C").** Do not add a Unit/Branch column or multi-row-per-employee
    semantics to represent a split entry's non-primary lines — that was explicitly considered
    ("Option B") and rejected, since it would reopen Checkpoint 4's own frozen "Copy to All touches
    the primary line only" precedent. A split employee's non-primary lines remain reachable
    exclusively through the grid's Split by {unitLabel} modal; the limitation is a UI note, not a
    format concern.
  - **Import matches an existing `PayrollEntry` by `Employee Code` and/or `CNIC`** — both supported,
    neither one alone sufficient by design (CNIC is optional per Phase 2.5 Checkpoint 4). Do not
    narrow this back to CNIC-only.
  - **Import is permanently update-only.** It must never create a `PayrollEntry` or
    `PayrollEntryWorkLine`, never bootstrap an employee into a cycle, never modify `siteId` or
    `released`/`releasedAt`/`releasedBy`. A row identifying no matching entry in the target cycle is
    skipped and reported — do not add an "auto-create" fallback later without a fresh, explicit
    decision.
  - **Import does not require or check a per-row `version`** — it follows Checkpoint 4's
    administrative-bulk-operation precedent (no pre-check, but every written row still increments
    `version` so a concurrently-open grid row correctly 409s on its own next save). Do not add a
    `version` column to the spreadsheet format to "fix" this; it was a deliberate choice, not an
    oversight.
  - **Both import and export write their own summary `AuditLog` entry** (`payroll_entry.import`,
    `payroll_entry.export`) — a deliberate, approved deviation from Employee Registry's own export
    (which logs nothing). Do not remove the export-side audit entry to "match" that precedent.
  - **No new RBAC permission was introduced** — both routes reuse the single existing
    `PERMISSIONS.PAYROLL_ENTRY`. Do not split this module into separate view/create permissions the
    way Employee Registry has, without a fresh, explicit decision.
  - **`backend/src/common/import-export.ts`** now holds the one shared CSV/XLSX-to-table parsing
    implementation (`parseTableFromFile`) both Employee Registry's and Payroll Entry's importers call
    — do not reintroduce a second, duplicate implementation of that logic in a future importer;
    extend/reuse this one.
  - **`mapUpdateInputToEntryData`, `mapUpdateInputToWorkLineData`, and `assertEntryEditable`**
    (`backend/src/modules/payroll-entry/payroll-entry.service.ts`) are now exported and reused by the
    import path — the single implementation of "which fields does an edit touch" and "is this entry
    locked," respectively. Do not reintroduce a second copy of either mapping or the lock check in
    any future Payroll Entry code path (e.g. a future bulk-correction or reporting feature).
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 5" subsection.
- **New 2026-07-10, Phase 3 Checkpoint 6 — implementation decisions, do not re-litigate (implemented,
  verified, and COMMITTED as `3298e34` — see §1 above). Phase 3 (Checkpoints 0–6) is now fully
  complete and closed:**
  - **The in-memory grid architecture is permanently retained — no server-side windowed fetching.**
    This was an explicit, frozen decision (Decision 1), not merely undone-for-now: `LiveTotalsStore`,
    Copy to All, the multi-site filter, import/export, and the React Query cache all assume the whole
    cycle's entries are resident client-side. Do not introduce a windowed/paginated fetch without a
    coordinated rewrite of all of those pieces together, per a fresh, explicit decision.
  - **`usePayrollEntries` (`frontend/src/hooks/use-payroll-entries.ts`) now fetches page 1 alone,
    then the remaining pages in concurrency-capped (8-wide) parallel batches** — replacing the
    original fully-sequential one-page-at-a-time loop, because measurement proved the sequential
    version left too little headroom under the load-time target at 10,000 rows (2.8s of a 3s
    ceiling, before client-side rendering cost). The concurrency cap of 8 is a measured, not
    arbitrary, value (`backend/tests/payroll-entry-performance.test.ts`). Do not remove the cap.
  - **`LiveTotalsStore`'s full-recomputation-per-read model is unchanged, deliberately.** Real
    keystroke measurement (47–52ms per real keystroke, one >50ms long task only under an artificial
    rapid-fire stress test far faster than any human typist) did not meet the bar of "proves it is
    the bottleneck." Do not replace it with an incremental running-total model, a server aggregate,
    or a hybrid without new measurement evidence that it has actually become a problem.
  - **The `invalidateQueries` cache strategy after Copy to All/import is unchanged, deliberately** —
    no measurement showed it as a bottleneck. Do not build a targeted per-row cache merge for bulk
    operations without measurement justifying it first.
  - **`createPayrollCycle`'s bootstrap now assigns every entry its own `sortOrder`**
    (`backend/src/modules/payroll-processing/payroll-processing.service.ts`), fixing a real,
    pre-existing bug: every bootstrapped entry previously defaulted to `sortOrder = 0` (the schema
    column default, never overridden), which made `ORDER BY sortOrder ASC LIMIT/OFFSET` pagination
    unstable at the 10,000-employee floor — confirmed to silently duplicate 23 rows across page
    boundaries while dropping 23 others. This was found via this checkpoint's own real-browser
    measurement, not any prior test. A dedicated regression test
    (`backend/tests/payroll-entry-performance.test.ts`) asserts the bootstrap produces one distinct
    `sortOrder` per entry — do not remove it, and do not reintroduce a code path that creates
    `PayrollEntry` rows without an explicit, distinct `sortOrder`.
  - **`backend/tests/payroll-entry-performance.test.ts` is now the committed, repeatable
    10,000-employee performance/concurrency validation** — closing the gap Checkpoint 1's own
    informal, uncommitted 3,000-employee smoke test left open. Its fetch-comparison assertions check
    **distinct entry IDs seen across pagination**, not the row count summed across pages — the latter
    cannot detect a duplicate/gap pagination bug (50 pages of 200 always sums to 10,000 regardless).
    Any future change to `listPayrollEntries`'s pagination should be measured against this file, not
    assumed correct from a passing row-count-only test.
  - **The Definition of Done's "review, release" clause in `docs/IMPLEMENTATION_PLAN.md`'s Phase 3
    section is historical wording**, predating the 2026-07-07 checkpoint restructuring — confirmed by
    explicit decision (Decision 5) that Checkpoint 6 does not implement or validate Release, and a
    dated revision note was added there rather than the sentence being silently reinterpreted or
    deleted.
  - **Full decision record:** `docs/PROJECT_PROGRESS.md` §1's "Phase 3, Checkpoint 6" subsection.
    **Phase 4 implementation still requires its own separate, explicit authorization** — Phase 3
    being fully closed does not itself authorize starting Phase 4 work.
- **New 2026-07-10, Phase 3.5 architecture revision — frozen decisions, do not re-litigate
  (documentation-only, NOT YET COMMITTED — see §1 above). Full decision record:
  `docs/PROJECT_PROGRESS.md` §1's "Phase 3.5 architecture revision" subsection:**
  - **Chat is permanently removed, not deferred.** The previously-planned Team Collaboration panel
    (`reference/PROJECT_SPEC.md`; `reference/payroll_prototype.html` — both frozen, unedited) will
    never contain chat, messaging, comments, discussion threads, attachments, subtasks, a Kanban view,
    or recurring tasks. Do not propose adding any of these to Tasks later without a fresh, explicit
    decision reopening this — it was a deliberate boundary, not an oversight.
  - **A new Phase 3.5 — Tasks Workspace exists between Phase 3 and Phase 4** in
    `docs/IMPLEMENTATION_PLAN.md`, with its own 🛑 review checkpoint. Phase 4 begins exactly as
    previously planned once Phase 3.5 closes — nothing about Phase 4's own frozen scope changed.
  - **Task visibility is ownership-based — an explicit, permanent exception to this system's role/site
    RBAC model**, documented in `docs/architecture/authentication.md`'s "Tasks: ownership-based
    visibility" section. Master User sees every task; the one user in `assignedToUserId` sees only
    their own; no one else can see or query it — regardless of role or site assignment. **Do not add
    site-scoping to Tasks.** This is not a variant of `assertSiteAccess()`; it is a distinct ownership
    check.
  - **One new permission, `tasks:manage`, Master-User-only.** Assignees need no permission beyond
    authentication to view their own tasks and mark them complete. No new role was introduced.
  - **Status lifecycle is `TO_DO` → `COMPLETED`/`CANCELLED` — no `IN_PROGRESS` value exists.** This
    was evaluated and deliberately rejected as unnecessary granularity, not an oversight. Master User
    may reopen a completed task (clears `completedAt`, reverts to `TO_DO`); only Master User edits
    title, description, priority, due date, or assignment — an assignee's only write is the completion
    flip.
  - **Priority is Low/Medium/High.** Due date is optional; recurring tasks are explicitly out of
    scope and will not be added.
  - **Notifications persist only three event types** — assigned, reassigned, completed. Due-today and
    overdue are computed live from `dueDate`/`status` at read time, never stored. **No WebSockets or
    SSE** — ordinary client polling, matching this project's existing infrastructure-restraint
    reasoning (`docs/architecture/authentication.md`'s Postgres-over-Redis rationale).
  - **Sorting supports exactly three dimensions**: Due Date, Priority, Recently Assigned (the last one
    driven by a dedicated `Task.assignedAt` column, distinct from `createdAt`, updated on
    reassignment). Nothing beyond this without a fresh decision.
  - **The HTML prototype review rule is now permanent, alongside the Playwright rule** —
    `docs/IMPLEMENTATION_PLAN.md`'s Definition of Done section. **It checks both directions**: every
    shipped feature has a prototype where appropriate, AND no prototype demonstrates behavior that no
    longer exists in the shipped architecture (the second direction is what would have caught the
    obsolete Chat panel, had a prototype for it ever existed). Every phase close, in order: review
    existing prototypes → remove/update obsolete behavior → create missing prototypes → verify the set
    matches shipped behavior → **only then** documentation updates → repository close-out.
  - **Prototype filenames use the literal phase number, including fractional ones** —
    `phase3.5-tasks-workspace-preview.html`, never folded into `phase3-*` or `phase4-*` naming.
  - **`reference/PROJECT_SPEC.md` and `reference/payroll_prototype.html` were not touched and must
    never be** — both still describe the retired Chat concept; living documentation (this revision)
    supersedes them, it does not conform to them.
  - **Phase 8 keeps its current name unchanged for now**, even though it loses the Team Collaboration
    line entirely (moved to Phase 3.5) — do not rename it preemptively; revisit only if it becomes
    genuinely misleading after further low-priority work accumulates there.

## 4. Current frozen architecture (reference index)

- `docs/PROJECT_PRINCIPLES.md` — **10 standing principles as of 2026-07-03** (e.g. Payroll Entry as
  single source of truth, additive-first migrations, insert-only Audit Log, and the new Principle 10:
  a 10,000-employee performance/scale design floor). **Reviewed 2026-07-05 — no changes needed**,
  every Phase 3 architecture-review decision is additive/consistent with all ten.
- `docs/architecture/overview.md` — the load-bearing data path: Employee Registry/Project Units →
  Payroll Entry (+ Payroll Entry Work Lines) → Payroll Processing → Release (**now per Project Unit,
  2026-07-05**) → Bank Sheets/Cash Receiving, with CorrectionRequest → Corrections/Balance Adjustments
  as the highest-risk branch. Major Modules table includes **Project Units** as its own module and
  reflects Finance's new role in Release Salary. **As of 2026-07-09**, also includes a dedicated
  **Advances** module row (Advance Deduction Deferral) and a new "Outstanding Payroll Obligations"
  Extensibility bullet documenting the generalized, order-independent carry-forward seam.
- `docs/architecture/database/` (formal schema specification — see `database/README.md` for the
  per-file index) — **27-table schema as of 2026-07-09** (25 as of 2026-07-05 +
  `ScheduledPayrollPeriod`/`AdvanceScheduleChange`, 2026-07-09; Phase 1 + Phase 2 together implement a
  subset of it; see §1 of `docs/PROJECT_PROGRESS.md`). `database/schema-invariants.md §26` item 6 (CNIC duplicate-detection) is
  resolved, no longer pending. `Advance` (`database/advances.md §15`) now carries `originalScheduledPeriodId`/
  `currentScheduledPeriodId` and the frozen BR-ADV-001–006 rule set, none of it in
  `backend/prisma/schema.prisma` yet (Phase 4 work).
- `docs/architecture/authentication.md` — session-based auth, CSRF double-submit, RBAC +
  site-scoping as independent middleware layers. **Now three roles as of 2026-07-05**: Master User,
  Payroll Staff, and the new site-scoped **Finance** role (its own permission set documented in full).
  Multi-unit attendance splitting is still always intra-site, so no unit-level RBAC concept was
  introduced for that reason — unchanged since 2026-07-03. **As of 2026-07-09**, also documents that
  Advance Deduction Deferral reuses the existing payroll-edit permission/site-scoping — no new
  permission was introduced, and Finance still cannot perform it.
- `docs/architecture/workflows/corrections-and-balance-adjustments.md` — the baseline-reconstruction/replay algorithm
  (unaffected by 2026-07-05's changes — always operates on the resulting `Correction` regardless of
  which path produced it), deliberately scheduled late (Phase 6) per the plan. **As of 2026-07-05**,
  also covers the `CorrectionRequest` request/approval/rejection split, immediate/deferred `PAYABLE`
  settlement, and installment `RECOVERY` settlement.
- `docs/architecture/system-conventions.md` (`StorageProvider` abstraction) and
  `docs/architecture/workflows/payroll-lifecycle.md` — Finalize Cycle
  precondition (wording unchanged by 2026-07-05's per-Unit release move), Backup Package versioning.
  **As of 2026-07-05**, §4 also documents the per-Unit release mechanism, the simplified one-clause
  correction trigger, and the Late Entry exception. **As of 2026-07-09**, §4 also documents the Advance
  Deduction Deferral workflow and the generalized, order-independent Outstanding Payroll Obligations
  new-cycle carry-forward seam (replacing the old Balance-Adjustment-specific wording).
- `docs/design-system.md` — tokens (color/type/spacing/radius), layout patterns, the shared component
  inventory the frontend must reuse rather than re-implement per page, and, **as of 2026-07-03, §4's
  `DD-MM-YYYY` date-display convention** (alongside the existing `en-US` number-format convention).
  **Not touched by 2026-07-05's session** — no new UI/UX design decisions were made, only backend/data
  architecture.

## 5. Phase 1 completion checklist

Per `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 Definition of Done:

- [x] Migration applies cleanly to an empty database — **verified live 2026-07-04** (fresh
      PostgreSQL 18, `migrate deploy`, unmodified, twice — second fresh DB replay included)
- [x] **Seed script confirmed idempotent against a live database** — verified 2026-07-04 (run twice)
- [x] **Scripted login as the seeded Master Admin succeeds** — verified 2026-07-04 (`auth.test.ts`
      live, plus a real-browser login in the Playwright E2E)
- [x] **Scripted attempt to call a protected route without a session fails with 401** — verified
      2026-07-04 (`auth.test.ts` live)
- [x] **Scripted attempt to update or delete an audit log row fails at the database level** —
      verified 2026-07-04 (`audit-log.test.ts` live, plus an independent raw-SQL probe)
- [x] **CSRF-missing requests to state-changing routes are rejected** — verified 2026-07-04
      (`auth.test.ts` live)
- [x] RBAC middleware unit tests (no DB required) — passing
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean (0 errors)
- [x] **🛑 Review-checkpoint sign-off — obtained 2026-07-02 (conditional at the time).** The
      condition — DB-backed evidence — was fully discharged 2026-07-04.

**Bottom line: Phase 1 is closed, unconditionally, as of 2026-07-04.**

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
- [x] **Master Admin can create a Payroll Staff user, assign sites, and confirm that user's session
      genuinely cannot see or touch employees/sites outside that assignment** (the Phase 2
      Definition of Done, `docs/IMPLEMENTATION_PLAN.md`) — **verified live 2026-07-04**:
      `users.test.ts` + the C11 boundary tests in `employees.test.ts`/`employees-import-export.test.ts`
      all passing against real PostgreSQL, including the manipulated-`siteId` direct-API cases.
- [x] Phase 2 UI/UX polish pass + final visual consistency audit (Playwright-verified) — see §2.
- [x] **🛑 Phase 2 review checkpoint sign-off — CONDITIONAL, obtained 2026-07-02.** The user explicitly
      stated "Phase 2 is now complete" and requested this checkpoint. Phase 2 has no explicit 🛑 gate
      in `docs/IMPLEMENTATION_PLAN.md` (unlike Phase 1/3/5/6/9), but per this project's established
      practice, an explicit sign-off was still obtained before Phase 3 — on the same conditional basis
      as Phase 1's: the one DB-backed item directly above remains open, not re-litigated.

**Bottom line: Phase 2 is closed, unconditionally, as of 2026-07-04** — its one outstanding
DB-backed item was verified against live PostgreSQL, same as Phase 1's five.

## 7. Next steps, in order

**Updated 2026-07-10 (second revision, same day) — Phase 1, Phase 2, Phase 2.5, and Phase 3 (all
seven checkpoints, 0–6) are all closed with full DB-backed evidence — see §1/§2. Phase 3's own 🛑
review checkpoint has passed. A new Phase 3.5 — Tasks Workspace now sits between Phase 3 and Phase 4
(architecture decided this session, documentation-only, not yet committed — see §1/§3 above);
**Phase 3.5 is next, not Phase 4** — item 4 below is updated accordingly.**

1. **Re-read the doc set in order** (`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/*.md` →
   `docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`), confirm branch/latest
   commit/clean working tree, per this project's standing "How to Resume" procedure.
2. **Re-provision the local database before running DB-backed tests** — the Postgres instance lives
   in the sandbox scratchpad and does not survive between sessions. Recipe: install
   `@embedded-postgres/darwin-x64` in the scratchpad, hydrate its symlinks, `initdb -U postgres -A
   trust`, start with `-c unix_socket_directories=''` (TCP only), create role `payroll` (password
   `payroll_dev_password`) and database `payroll_dev`, then `cp backend/.env.example backend/.env`,
   `npx prisma migrate deploy` (8 migrations, unchanged since Checkpoint 0), seed **twice** (confirm
   idempotency), `npm run test --workspace backend` (expect **184/184** as of Checkpoint 6's close).
   **If using `prisma migrate diff` with `--shadow-database-url` for a future migration, point it at
   a dedicated, disposable shadow database — never the working `payroll_dev` one.** **If seeding a
   large synthetic dataset for manual/browser testing, clean it up before running the automated
   backend suite** — `createPayrollCycle`'s bootstrap scans every active `Employee` system-wide, so
   leftover large-scale fixtures from a prior manual session will silently inflate other tests'
   expected entry counts (a real false-failure encountered and resolved during Checkpoint 6's own
   close-out).
3. **Confirm the 184/184 baseline is green before touching any new code.**
4. **Phase 3.5 (Tasks Workspace) is next — still requires its own separate, explicit authorization**
   to begin implementation planning, per this project's standing per-checkpoint/per-phase practice.
   Its architecture is frozen (2026-07-10 Phase 3.5 revision, documentation-only) — see
   `docs/IMPLEMENTATION_PLAN.md`'s Phase 3.5 section and §3 above for the full frozen-decision list
   (ownership-based visibility, no chat/messaging/comments/attachments/subtasks/Kanban/recurring
   tasks, three-status lifecycle with no `IN_PROGRESS`, `tasks:manage` permission). **Phase 4
   (Release, Payment Artifacts, and Advances) follows it, unchanged from its own already-frozen scope
   — its architecture was frozen 2026-07-05 (Phase 3 Architecture Review).**
5. Build `StorageProvider` (`docs/PROJECT_PROGRESS.md` §3 item 4) — confirmed deferred until before
   Phase 5, not scheduled into Phase 2.5, 3, or 4. Design for hosting portability (§3 item 13).
   **Unaffected by Phase 3.**
6. Decide how Broom Services' own disbursement source bank account(s) should be modeled
   (`docs/PROJECT_PROGRESS.md` §3 item 7) — before Phase 4 schema work begins. **Unaffected by
   Phase 3** — this is about the source account for disbursements, a separate concern.
7. Confirm the two still-open design assumptions from `database/schema-invariants.md` §26:
   calendar-month-only cycles (Checkpoint 0 assumed this holds — `PayrollCycle.year`/`.month` has no
   other period-length concept — but it remains formally unconfirmed with the client),
   at-most-one-`ACTIVE`-`Advance`-per-type before Phase 4.
8. Optionally confirm the Employee Registry import template's redundant-column interpretation with the
   client (`docs/PROJECT_PROGRESS.md` §3 item 5) — likely resolved as a side effect of Checkpoint 3's
   `ProjectUnit` remap, but worth an explicit client confirmation once that lands.
9. When explicitly instructed to begin **Phase 3.5** — Tasks Workspace (`Task`/`TaskNotification`,
   ownership-based visibility, `tasks:manage` permission, the repurposed right-side panel) — follow
   the standing Definition of Done, **now including the HTML prototype review step**: architecture
   compliance → implementation → typecheck → lint → build → backend tests → real-stack Playwright →
   HTML prototype review/update (`phase3.5-tasks-workspace-preview.html`, literal phase number per
   the 2026-07-10 naming decision) → documentation updates → ask before committing.
10. When explicitly instructed to begin **Phase 4** (after Phase 3.5 closes) — Release (per Project
    Unit), Bank Sheets, Cash Receiving Sheets, Advances (including the frozen Advance Deduction
    Deferral architecture, `docs/PROJECT_PROGRESS.md` §1's "Advance Deduction Deferral" subsection) —
    follow the same standing Definition of Done: **architecture compliance → implementation →
    typecheck → lint → build → backend tests → real-stack Playwright → HTML prototype review/update →
    documentation updates → ask before committing.**

## 8. Risks and assumptions

- **Resolved 2026-07-04 — migrations verified for real.** The long-standing assumption that the
  hand-written/`migrate diff`-generated migrations would apply cleanly was tested and held: all six
  applied to a completely fresh PostgreSQL 18 database unmodified, first try. The companion risk
  ("if the DB-backed tests fail, the fix may touch committed files") also materialized exactly as
  anticipated and was handled: four real defects were found and fixed (see §2's 2026-07-04 entry),
  one of them via a new migration — existing migrations were not edited.
- **Resolved**: the Bank/AdjustmentType/CompanySettings scope question, the two Employee Registry
  `database/schema-invariants.md §26` items, the `ProjectSite.defaultBankId` removal, the `StorageProvider` deferral timing (confirmed:
  before Phase 5), `ProjectSite.address` (added, scoped exception), the company name ("Broom Services
  Private Limited"), and the deployment-portability nuance (single-company, but not
  hosting-provider-specific) — see `docs/PROJECT_PROGRESS.md` §3.
- **Still unresolved, carried forward**: the import-template redundant-column assumption (§3 item 5,
  likely resolved as a side effect of Checkpoint 3's `ProjectUnit` remap but not yet confirmed with
  the client), Broom Services' own disbursement source account modeling (§3 item 7, including its two
  sub-questions — needed before Phase 4 schema work), and the two open `database/schema-invariants.md` §26
  design assumptions (calendar-month-only cycles, at-most-one-`ACTIVE`-`Advance`-per-type). **The
  CNIC duplicate-handling decision (§26 item 6) is no longer on this list — it was finalized
  2026-07-03/04**: CNIC stays globally unique with no override, and rehires go through a Reactivate
  action — see `docs/PROJECT_PROGRESS.md` §3 item 22. Only the concrete Checkpoint 4 implementation
  still needs a separate design-approval gate, not the policy itself.
- **Assumption, flagged for revisit (2026-07-03)**: gross pay does not vary by Project Unit — verified
  against `reference/PROJECT_SPEC.md` and the schema doc (only the day-rate basis is documented as
  location-varying), but this is a documentation-based finding, not confirmed against the client's
  actual current practice. If real-world practice contradicts it, `PayrollEntryWorkLine`'s design
  (§12a) needs revisiting before Phase 3 schema work, since it currently assumes a single `grossPay`
  scalar per employee per cycle regardless of how many units they worked.
- **Assumption**: no one has manually altered the database, `.env`, or any untracked local file
  outside of what's described here since the last commit.
- **New, 2026-07-05 — the Phase 3 architecture freeze spans what were originally Phase 3, 4, and 6
  territory (Payroll Entry/Processing, Release, and Corrections/Balance Adjustments), because the
  session's new business rules made those three areas tightly interdependent (per-Unit release
  changes what "released" means for the correction trigger; the correction settlement model needed
  designing alongside it).** This does not change the implementation *sequencing* in
  `docs/IMPLEMENTATION_PLAN.md` — Phase 3's code should still be built and proven before Phase 4's,
  and Phase 4's before Phase 6's, per the plan's own stated strategy (build the trunk before its
  branches) — only the *architecture* for all three was frozen together, in one session, because they
  couldn't be designed in isolation from each other this time. Future sessions implementing Phase 4 or
  6 should not re-open architecture review for those phases; the design is already frozen and dated
  2026-07-05 alongside Phase 3's.
