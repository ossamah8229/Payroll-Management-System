# Payroll Management System

A commercial web application for managing employee payroll: salaries, deductions, tax
calculations, payslips, and related HR/finance workflows.

> **Status (2026-07-20, `v1.0.0-rc1`):** Phases 1, 2, 2.5, 3, and 3.5 are all **closed, with full
> database-backed evidence**. **Phase 4 (Release, Bank Sheets, Cash Receiving Sheets, Advances,
> Payslips) is code-complete and committed — all six checkpoints implemented and tested.** **Phase 5
> (Cycle Finalization, Archiving, and Backups) is COMPLETE AND CLOSED.** **Phase 6 (Corrections &
> Balance Adjustments) is COMPLETE AND CLOSED**, 2026-07-19 — the full Correction Request workflow
> (propose/decide separation), Review Queue, positive/negative balance settlement
> (`BalanceAdjustmentSettlement`), materialization into a Draft cycle, and consumption on release, all
> implemented, tested, and verified with a real-browser (Playwright) pass across six corrections
> scenarios; a living HTML prototype was added the same session (Checkpoint 7A). **This repository is
> now at Release Candidate 1 (`v1.0.0-rc1`) — Version 1.0 covers Phases 0–6; Phases 7–9 (Statements/
> Reports/Dashboard, Audit Log viewer UI, Render production deployment) are explicitly out of this
> release's scope.** See `docs/release/` for the full RC1 record: scope freeze, configuration
> reference, security review, backup/restore validation, data-volume sanity results, known issues,
> and the UAT package. See "Current Status" below, `docs/PROJECT_PROGRESS.md` (§1 for full history,
> §2 for the phase-by-phase status table), and `docs/SESSION_HANDOFF.md` §0 for the prior
> authoritative development-history summary.

## Getting Started

```bash
npm install
docker compose up -d          # local PostgreSQL
```

See `backend/README.md` for database migration/seed setup, then:

```bash
npm run dev:backend           # http://localhost:4000
npm run dev:frontend          # http://localhost:5173
```

**Running tests** — see `docs/architecture/testing.md` for the full breakdown:

```bash
npm run test:backend          # Jest, against real PostgreSQL — needs the DB above
npm run test:frontend         # Vitest, no database needed
npx playwright install chromium && npm run test:e2e   # provisions/tears down its own database
```

## Current Status

- **Architecture:** frozen. `docs/PROJECT_PRINCIPLES.md` and `docs/architecture/*.md` are the
  binding design; implementation follows `docs/IMPLEMENTATION_PLAN.md`'s phase sequencing.
- **Phase 1 (Auth, RBAC, Audit Log):** closed 2026-07-02; **DB-backed evidence completed
  2026-07-04** — schema/migrations, session auth, CSRF, RBAC/site-scoping middleware, insert-only
  Audit Log with a DB-level immutability trigger, tests, and the frontend login/session/app-shell,
  now all verified against a live PostgreSQL instance (see `docs/PROJECT_PROGRESS.md` §1).
- **Phase 2 (Project Sites, Employee Registry, Settings, User Management):** **closed**,
  2026-07-02 — full CRUD for Project Sites (including a physical `address` field) and the Employee
  Registry (with CNIC/employee-code uniqueness, DOL-based soft "leaving," and site-scoped RBAC for
  Payroll Staff per the C11 decision), Employee Registry CSV/Excel import/export against the official
  client template, the Settings module (Company Details/My Profile/Theme, including a Company Logo
  placeholder), User Management, and a full UI/UX polish pass verified with real browser rendering
  (Playwright). DB-backed evidence completed 2026-07-04, same as Phase 1. One
  flagged gap: file upload (company logo, user avatar) is not yet available — it depends on the
  `StorageProvider` abstraction, which was never actually built despite being called for in Phase 0
  (see `docs/PROJECT_PROGRESS.md` §3 item 4), and remains deferred until before Phase 5.
- **Database verification: CLOSED, 2026-07-04.** All seven migrations applied to a completely fresh
  real PostgreSQL 18 database without modification; the full integration suite passes 78/78; the
  `(unitId, siteId)` composite FK and Audit Log immutability verified at the raw-SQL level; and a
  real-stack (no mocks) Playwright end-to-end run passed with zero console errors. Four real defects
  were surfaced and fixed in the process — see `docs/PROJECT_PROGRESS.md` §1's "Database
  verification" subsection.
- **Process note:** starting with Phase 2's close-out, every future phase's Definition of Done
  includes Playwright-driven visual verification (real browser rendering, not just
  typecheck/lint/build) — see `docs/IMPLEMENTATION_PLAN.md`'s "Definition of Done — Generic Criteria".
- **Pre-Phase-3 architecture review — closed and committed, 2026-07-03:** Project Sites no longer own
  Branch Codes; a new, dedicated Project Units module models the operational Branch/Department/Section
  an employee is deputed to; Payroll Entry gains `PayrollEntryWorkLine` (every entry always has at
  least one, supporting an employee working across multiple Project Units within one cycle, always
  within a single Project Site — enforced at both the database and application layers); all
  user-facing dates now display as `DD-MM-YYYY` (ISO internally, unchanged); a new architectural
  principle sets a 10,000-employee performance/scale design floor. Full record:
  `docs/PROJECT_PROGRESS.md` §3 items 16–21.
- **Phase 2.5 — CLOSED, 2026-07-05.** All five checkpoints complete and committed
  (`docs/IMPLEMENTATION_PLAN.md`):
  - **Checkpoint 0:** shared `formatDate()`/`parseDateInput()`/`toIsoDateOnly()` utilities and a
    reusable `DateInput` component — the single source of truth for the `DD-MM-YYYY` convention,
    applied to the Employee Registry's date fields.
  - **Checkpoint 1:** `ProjectUnit` as a dedicated master-data module nested under Project Sites,
    replacing `ProjectSite.branchCode` with `ProjectSite.unitLabel`-driven terminology; a "Manage
    Units" panel in the Project Sites UI.
  - **Checkpoint 2:** `Employee.unitId` (composite-FK'd to `ProjectUnit`), the new append-only
    `EmployeeTransferHistory` table, a dedicated `employee.transferred` audit entry (written
    atomically with the Employee update and history row), and a reusable Site → Unit cascading
    selector wired into the Employee Registry's forms.
  - **Checkpoint 3:** Employee Registry import/export template remap to `ProjectUnit` columns
    (`Area`/`Area/Location` = unit name, `Branch Code` = unit code) with three-layer Site/Unit
    validation (import-layer row check, shared service-layer assertion, database composite FK — each
    proven able to catch a violation alone); import updates that change an employee's site/unit now
    write the full transfer trail.
  - **Checkpoint 4:** CNIC normalization, a debounced duplicate-check endpoint, and a Reactivate
    Employee action (rehires update the existing record in place, never a second row for the same
    CNIC) — 99/99 backend tests against live PostgreSQL.
- **Phase 3 Architecture Review — COMPLETE, 2026-07-05 (architecture only, no application code).** A
  dedicated design session froze the complete Payroll Entry, Payroll Processing, Release, and
  Corrections/Balance Adjustments architecture: release now happens independently per Project Unit
  (`PayrollUnitRelease`), executed by a new site-scoped **Finance** role; a non-gating "Ready for
  Release" status (`PayrollUnitReadiness`); a Correction Request/approval workflow
  (`CorrectionRequest`) separating who may propose a correction from who may decide it; a positive
  balance may settle immediately or deferred (`CorrectionPayment` for the no-open-entry case); a
  negative balance may now recover across multiple cycles as an installment
  (`BalanceAdjustmentSettlement`); a Late Entry exception for payroll added after its Unit already
  released. "Master Admin" renamed "Master User" throughout the architecture docs. Full decision
  record in `docs/PROJECT_PROGRESS.md` §1's "Phase 3 Architecture Review" subsection.
- **Phase 3 (Payroll Entry & Payroll Processing) — CLOSED, 2026-07-10.** All seven checkpoints
  (schema foundation; cycle bootstrap + backend CRUD; the Payroll Entry grid frontend; "Split by
  {unitLabel}"; multi-site filter + Copy to All; CSV/Excel import/export; 10,000-employee
  performance/concurrency validation) complete, tested, and committed. Full record:
  `docs/PROJECT_PROGRESS.md` §1.
- **Phase 3.5 (Tasks Workspace) — CLOSED, 2026-07-10.** Replaces the originally-planned Team
  Collaboration/Chat panel. Full record: `docs/PROJECT_PROGRESS.md` §1.
- **Phase 4 (Release, Bank Sheets, Cash Receiving Sheets, Advances, Payslips) — CODE-COMPLETE, NOT
  YET FULLY CLOSED, as of Checkpoint 6.3 (2026-07-13).** All six checkpoints implemented, tested, and
  committed: Bank Registry; Salary Release foundation (per-Project-Unit release, new Finance role);
  Bank Sheets; Cash Receiving Sheets; Advances; and Payslips (split into Checkpoint 6.1 backend
  foundation, 6.2 PDF engine, 6.3 frontend + bounded batch ZIP generation + this close-out). Backend
  test suite: **346/346**. Employee Statements confirmed out of this phase's scope (remains Phase 7).
  **Held open by exactly one condition:** a real Render/Linux-container deployment smoke test was
  genuinely attempted and could not be completed — no Docker/Podman/Colima, no Render API token, and
  no git remote are available in the development environment used so far. Not falsely marked passed.
  Full record, including the close-out review against every Phase 4 checkpoint and
  `docs/PROJECT_PRINCIPLES.md`: `docs/PROJECT_PROGRESS.md` §1's "Phase 4 close-out review".
- **Current git checkpoint:** see `docs/PROJECT_PROGRESS.md`'s header for the exact latest commit
  hash and full lineage — kept there rather than duplicated here to avoid drift between two copies
  of the same fact.
- Static, framework-free visual previews of the current UI are available under `docs/prototypes/` —
  one HTML file per phase (Phase 1 through Phase 6, including Payroll Entry, Salary Release, Bank
  Sheets, Cash Receiving, Payslips, Advances, the Payroll Lifecycle, and Corrections) — open any of
  them directly in a browser. Kept current through Phase 6's close-out (`phase6-corrections-preview.html`,
  added Checkpoint 7A).

## Project Structure

```
.
├── docs/                 # Project documentation
│   ├── architecture/     # System design, diagrams, ADRs (architecture decision records)
│   ├── api/              # API specifications (e.g. OpenAPI/Swagger docs)
│   └── requirements/     # Business/functional requirements, user stories
├── reference/            # Reference material (regulations, tax tables, sample payroll data, etc.)
├── frontend/             # Client-side web application (UI)
├── backend/              # Server-side application (API, business logic)
├── database/             # Database schema and data
│   ├── migrations/       # Schema migration scripts
│   └── seeds/            # Seed/fixture data for development and testing
├── tests/
│   └── e2e/              # Permanent Playwright E2E harness (AUD-013) — see tests/e2e/README.md.
│                         #   Backend unit/integration tests live in backend/tests/ (Jest, against
│                         #   real PostgreSQL); frontend unit tests are colocated in frontend/src/
│                         #   (Vitest) — see docs/architecture/testing.md for the full breakdown.
├── scripts/              # Developer/build/deployment utility scripts
├── assets/               # Static assets
│   ├── images/           # General images used across the project
│   └── branding/         # Logos, brand colors, style guides
├── config/               # Environment and application configuration files
└── .github/
    └── workflows/        # CI/CD pipeline definitions
```

## Folder Purpose Overview

- **docs/** — All project documentation lives here: architecture decisions, API contracts,
  and business/functional requirements. Keep this up to date as the system evolves.
- **reference/** — Non-code reference material used to inform implementation, such as
  payroll tax regulations, compliance references, or sample datasets.
- **frontend/** — The web UI the end users (HR staff, employees, admins) interact with.
- **backend/** — Server-side services: API endpoints, business logic, authentication,
  payroll calculation engines, integrations with external systems (e.g. banking, tax
  authorities).
- **database/** — Everything related to persistent storage: schema migrations and seed
  data for local/dev environments.
- **tests/e2e/** — The permanent, committed Playwright end-to-end harness (`npm run test:e2e`).
  Backend unit/integration tests live alongside the backend itself (`backend/tests/`, Jest against
  real PostgreSQL); frontend unit tests are colocated with the components they cover
  (`frontend/src/**/*.test.tsx`, Vitest). See `docs/architecture/testing.md`.
- **scripts/** — Helper scripts for setup, builds, deployments, or maintenance tasks.
- **assets/** — Static, non-code files such as images and branding materials.
- **config/** — Configuration files for different environments (development, staging,
  production).
- **.github/workflows/** — CI/CD automation (tests, linting, deployments) via GitHub
  Actions.

## Next Steps

Phases 0–6 are implemented, tested, and closed. This repository is at Release Candidate 1
(`v1.0.0-rc1`) — see `docs/release/RC1_VALIDATION_REPORT.md` for the full clean-environment
validation, verification-suite results, security review, backup/restore validation, and known
issues, and `docs/release/UAT_PACKAGE_v1.0.md` for the User Acceptance Testing package. Phases 7–9
(Statements/Reports/Dashboard, Audit Log viewer UI, Render production deployment, and a further
dedicated hardening pass) are explicitly out of Version 1.0's scope — see
`docs/release/RELEASE_SCOPE_v1.0.md`. See `docs/SESSION_HANDOFF.md` §0 for the prior development
history's authoritative summary (latest commits, test counts, essential commands) and
`docs/PROJECT_PROGRESS.md` §1 for the full dated history.
