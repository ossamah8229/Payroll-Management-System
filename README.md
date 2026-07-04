# Payroll Management System

A commercial web application for managing employee payroll: salaries, deductions, tax
calculations, payslips, and related HR/finance workflows.

> **Status:** Phase 1 and Phase 2 are both **closed, with full database-backed evidence as of
> 2026-07-04**. Phase 2.5 (Project Units, Payroll Work Lines prerequisite, Employee Registry
> refinements) is **in progress**: Checkpoints 0–2 are **complete and committed** (shared date
> formatting, the Project Unit module, and the Employee → Project Unit relationship with transfer
> history), and the **long-standing database-verification debt is closed** — every migration
> applied to a fresh, real PostgreSQL instance and the full integration suite passing against it.
> **Checkpoint 3 (import/export remap to Project Units, three-layer Site/Unit validation) is also
> complete** — 88/88 tests against live PostgreSQL. Checkpoint 4 (CNIC normalization/Reactivate)
> is next, gated on a design approval before any code.
> See "Current Status" below, `docs/PROJECT_PROGRESS.md`, and `docs/SESSION_HANDOFF.md` for details.

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
- **Phase 2.5 — in progress, 2026-07-03/04.** Broken into five checkpoints
  (`docs/IMPLEMENTATION_PLAN.md`):
  - **Checkpoint 0 (committed `0d9ea33`):** shared `formatDate()`/`parseDateInput()`/`toIsoDateOnly()`
    utilities and a reusable `DateInput` component — the single source of truth for the `DD-MM-YYYY`
    convention, applied to the Employee Registry's date fields.
  - **Checkpoint 1 (committed `c60094c`):** `ProjectUnit` as a dedicated master-data module nested
    under Project Sites, replacing `ProjectSite.branchCode` with `ProjectSite.unitLabel`-driven
    terminology; a "Manage Units" panel in the Project Sites UI.
  - **Checkpoint 2 (committed — see the commit hash below):** `Employee.unitId` (composite-FK'd to
    `ProjectUnit`), the new append-only `EmployeeTransferHistory` table, a dedicated
    `employee.transferred` audit entry (written atomically with the Employee update and history row),
    and a reusable Site → Unit cascading selector wired into the Employee Registry's forms.
  - **Checkpoint 3 (complete, 2026-07-04):** Employee Registry import/export template remap to
    `ProjectUnit` columns (`Area`/`Area/Location` = unit name, `Branch Code` = unit code) with
    three-layer Site/Unit validation (import-layer row check, shared service-layer assertion,
    database composite FK — each proven able to catch a violation alone); import updates that
    change an employee's site/unit now write the full transfer trail.
  - **Checkpoint 4 (not started):** CNIC normalization, duplicate-check, and a Reactivate Employee
    action (policy finalized — see `docs/PROJECT_PROGRESS.md` §3 item 22 — but the concrete
    implementation still needs a design-approval gate before it's built).
  - The CNIC duplicate-handling decision itself is **finalized, no longer pending**: CNIC stays
    globally unique with no override; rehires go through a Reactivate action that updates the
    existing record in place.
- **Current git checkpoint:** see `docs/PROJECT_PROGRESS.md`'s header for the exact latest commit
  hash and full lineage — kept there rather than duplicated here to avoid drift between two copies
  of the same fact.
- Static, framework-free visual previews of the current UI are available under `docs/prototypes/`
  (`phase1-preview.html`; `phase2-project-sites-preview.html`;
  `phase2-employee-registry-preview.html`; `phase2-settings-users-preview.html`) — open any of them
  directly in a browser.

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
├── tests/                # Automated tests
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── e2e/              # End-to-end tests
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
- **tests/** — Automated test suites, separated by scope (unit, integration, end-to-end).
- **scripts/** — Helper scripts for setup, builds, deployments, or maintenance tasks.
- **assets/** — Static, non-code files such as images and branding materials.
- **config/** — Configuration files for different environments (development, staging,
  production).
- **.github/workflows/** — CI/CD automation (tests, linting, deployments) via GitHub
  Actions.

## Next Steps

The database-verification debt is closed and Checkpoint 3 is complete (both 2026-07-04). The next
implementation task is **Phase 2.5 Checkpoint 4** (CNIC normalization/duplicate-check/Reactivate),
whose concrete implementation must be presented for explicit approval before any code is written.
See `docs/PROJECT_PROGRESS.md` §5 for the exact next action and `docs/SESSION_HANDOFF.md` for the
full handoff to the next development session.
