# Payroll Management System

A commercial web application for managing employee payroll: salaries, deductions, tax
calculations, payslips, and related HR/finance workflows.

> **Status:** Phase 1 and Phase 2 are both **closed (conditional)** as of 2026-07-02. Phase 3 (Payroll
> Entry & Payroll Processing) has not started and will not begin without explicit instruction. See
> "Current Status" below, `docs/PROJECT_PROGRESS.md`, and `docs/SESSION_HANDOFF.md` for details.

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
- **Phase 1 (Auth, RBAC, Audit Log):** closed (conditional), 2026-07-02 — schema/migrations, session
  auth, CSRF, RBAC/site-scoping middleware, insert-only Audit Log with a DB-level immutability
  trigger, tests, and the frontend login/session/app-shell all exist and pass `typecheck`/`lint`.
  Closed on that static evidence with explicit user sign-off, since no PostgreSQL instance has been
  reachable in any session so far. The DB-backed test suite (`auth.test.ts`, `audit-log.test.ts`)
  remains a tracked open item to run for real before Phase 9. See `docs/PROJECT_PROGRESS.md` for the
  full checklist.
- **Phase 2 (Project Sites, Employee Registry, Settings, User Management):** **closed (conditional)**,
  2026-07-02 — full CRUD for Project Sites (including a physical `address` field) and the Employee
  Registry (with CNIC/employee-code uniqueness, DOL-based soft "leaving," and site-scoped RBAC for
  Payroll Staff per the C11 decision), Employee Registry CSV/Excel import/export against the official
  client template, the Settings module (Company Details/My Profile/Theme, including a Company Logo
  placeholder), User Management, and a full UI/UX polish pass verified with real browser rendering
  (Playwright). Same DB-backed-verification caveat as Phase 1 — see `docs/PROJECT_PROGRESS.md`. One
  flagged gap: file upload (company logo, user avatar) is not yet available — it depends on the
  `StorageProvider` abstraction, which was never actually built despite being called for in Phase 0
  (see `docs/PROJECT_PROGRESS.md` §3 item 4), and remains deferred until before Phase 5.
- **Database verification:** still outstanding, tracked (not a blocker) — run the DB-backed test
  suite against a real PostgreSQL instance (locally via Docker, or through CI) as soon as one is
  available, and before Phase 9's hardening pass at the latest. This now covers Phase 1's and Phase
  2's test suites and all three hand-written migrations, not just Phase 1's.
- **Process note:** starting with Phase 2's close-out, every future phase's Definition of Done
  includes Playwright-driven visual verification (real browser rendering, not just
  typecheck/lint/build) — see `docs/IMPLEMENTATION_PLAN.md`'s "Definition of Done — Generic Criteria".
- **Current git checkpoint:** `89ac6ff` — "feat(ui): Phase 2 UI polish and UX improvements" (the Phase
  2 closing commit). See `docs/PROJECT_PROGRESS.md` for full lineage and the latest commit hash.
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

See `docs/PROJECT_PROGRESS.md` §5 for the exact next action (Postgres-backed test verification),
and `docs/SESSION_HANDOFF.md` for the full handoff to the next development session.
