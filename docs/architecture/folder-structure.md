# Folder Structure

This is the final, approved folder structure for the Payroll Management System, and the
responsibility of every top-level directory. The project root already contains the outer scaffold
(`docs/`, `reference/`, `frontend/`, `backend/`, `database/`, `tests/`, `scripts/`, `assets/`,
`config/`, `.github/`); this document adds the internal structure of `backend/` and `frontend/`, and
introduces one new top-level package, `shared/`. **None of this has been created yet** — it is
documented here to be scaffolded in one deliberate step once architecture sign-off is complete.

```
docs/                        # Project documentation — source of truth for decisions, not derivable from code
  PROJECT_PRINCIPLES.md
  design-system.md
  architecture/
    overview.md
    tech-stack.md
    authentication.md
    deployment.md
    folder-structure.md      # this file
    data-and-storage.md
    post-release-corrections.md
    database-schema.md
  api/                       # API contracts (added as endpoints are designed)
  requirements/              # business/functional requirements, as they're elaborated beyond PROJECT_SPEC.md

reference/                   # Client handoff material — read-only historical reference, never edited
  PROJECT_SPEC.md
  payroll_prototype.html

backend/                     # Express + TypeScript API
  src/
    modules/                 # one folder per business domain — the modular-monolith boundary,
                             # matching the 15 modules in docs/architecture/overview.md
      auth/                  # Authentication — login/logout, session management, CSRF
      employees/             # Employee Registry — identity/employment/bank fields
      sites/                 # Project Sites — pure client/location master data
      project-units/         # Project Units (added 2026-07-03) — dedicated module, one level under
                             # Project Sites; the operational Branch/Department/Section master data
      payroll-entry/         # Payroll Entry — the single editable data-capture surface (current Draft
                             # cycle); owns PayrollEntry and its PayrollEntryWorkLine attendance rows
      payroll-processing/    # Payroll Processing — PayrollCycle lifecycle (Draft/Released/Archived), calcNet
      release/               # Release Salary — release/hold, bulk release/hold
      corrections/           # Corrections — correction workflow, approval, standardized Adjustment Types
      balance-adjustments/   # Balance Adjustments — automatic settlement pipeline
      bank-sheets/           # Bank Sheets — derived, read-only
      cash-receiving/        # Cash Receiving — derived, read-only
      statements/            # Statements — per-employee ledger (read/aggregation only)
      reports/               # Reports — Fines & EOBI and future reports, isolated read-only queries
      dashboard/             # Dashboard — summary stats, read-only, cache candidate
      settings/              # Settings — company details, user profile, theme, User Management
      audit-log/             # Audit Log — append-only writes and queries (no update/delete exposed)
      advances/              # Advances / Eid Advances, balance tracking (feeds Payroll Entry)
    common/                  # Cross-cutting middleware: session/auth guard, RBAC + site-scoping, error handling, request logging
    lib/
      prisma/                # Prisma client instance
      storage/                # StorageProvider interface + Local/Cloud implementations
      pdf/                    # Puppeteer-based PDF template rendering (payslip, bank sheet, cash sheet, statement)
      excel/                  # ExcelJS-based import/export
      backup/                 # Backup package generation (triggered on cycle archive)
    config/                  # Environment/config loading
  prisma/
    schema.prisma
    migrations/
  tests/                     # Jest unit/integration tests, colocated by module

frontend/                    # React + Vite application
  src/
    pages/                   # Route-level pages, mirroring the app's navigation structure
    features/                # Feature-scoped API hooks (TanStack Query) and page-specific logic, one folder per backend module
    components/              # Shared UI components implementing docs/design-system.md (Button, Badge, MultiSelect, Modal, Toast, etc.)
    lib/                     # API client, formatting utilities (e.g. the shared en-US number formatter)
    styles/                  # Tailwind config and CSS-variable theme tokens (including the user-customizable accent color)
  tests/                     # Component/unit tests

shared/                      # NEW — npm workspace package importable by both backend and frontend
  schemas/                   # Zod schemas — one definition per data shape, validated identically on both ends
  types/                     # Shared TypeScript types derived from schemas
  constants/                 # Official template headers (Employee Registry / Payroll Entry import-export), standardized Adjustment Types, number-format utility

database/                    # ERD diagrams, reference SQL, seed/fixture data — the live schema itself lives in backend/prisma
tests/                       # Top-level Playwright E2E suites only — cross-cutting, full-stack flows (release → correction → new cycle, etc.)
scripts/                     # One-off and recurring developer/ops scripts (seeding, backup verification, etc.)
assets/                      # Static assets not owned by frontend build (e.g. marketing/branding source files)
config/                      # Deployment/environment configuration shared across services
.github/
  workflows/                 # CI: lint, type-check, Jest, Playwright, gated deploys
```

## Rationale for the one structural change: `shared/`

`shared/` did not exist in the original scaffold. It's added because several pieces of this system
must be defined identically on both frontend and backend, and duplicating them invites drift:

- Zod validation schemas (a Payroll Entry row is valid or invalid the same way whether it's being
  typed into a form or imported from a CSV on the server).
- The standardized Adjustment Types list (`docs/architecture/post-release-corrections.md`) — used by
  the correction form on the frontend and validated on the backend.
- The official Employee Registry / Payroll Entry template headers (`PROJECT_SPEC.md`) — used by both
  export (backend) and any client-side preview of an import file.
- The `en-US` number formatting utility — this was corrected multiple times in the original design
  conversation and must be one implementation, not two that could disagree.

This is implemented as an npm workspace package, not a build step or code-generation pipeline — kept
as simple as the project's actual scale warrants.
