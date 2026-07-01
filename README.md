# Payroll Management System

A commercial web application for managing employee payroll: salaries, deductions, tax
calculations, payslips, and related HR/finance workflows.

> **Status:** Phase 1 (auth, RBAC/audit infrastructure, app shell) is code-complete; database
> verification and the Phase 1 review checkpoint are still pending. See "Current Status" below,
> `docs/PROJECT_PROGRESS.md`, and `docs/SESSION_HANDOFF.md` for the up-to-date details.

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
- **Phase 1 (Auth, RBAC, Audit Log):** code-complete — schema/migrations, session auth, CSRF,
  RBAC/site-scoping middleware, insert-only Audit Log with a DB-level immutability trigger, tests,
  and the frontend login/session/app-shell all exist and pass `typecheck`/`lint`. **Not yet
  confirmed** against a live database, and the plan's mandatory review checkpoint for Phase 1 has
  not been signed off. See `docs/PROJECT_PROGRESS.md` for the full checklist.
- **Phase 2 (Project Sites, Employee Registry, Settings, User Management):** not started.
- **Database verification:** pending — the DB-backed test suite (`auth.test.ts`,
  `audit-log.test.ts`) needs to be run against a real PostgreSQL instance before Phase 1 can be
  considered done.
- **Current git checkpoint:** commit `00517e3282c073d5c759233cece13a40f0091dc8` on `main`.
- A static, framework-free visual preview of the current UI (login page, sidebar, topbar,
  dashboard placeholder) is available at `docs/prototypes/phase1-preview.html` — open it directly
  in a browser.

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
