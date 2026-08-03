# Folder Structure

**Owner module(s):** All modules (project-wide folder structure and documentation governance)

**Contains:** The approved top-level and `backend`/`frontend`/`shared` folder structure; the
documentation size guideline; the Documentation Ownership Rule

**Sections:** — (narrative document, not part of the §-numbered schema/workflow set) · Database
index: `database/README.md`

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
    system-conventions.md    # UUID PKs, StorageProvider abstraction, Audit Log immutability policy
    workflows/                # stateful process narratives, by bounded context
      payroll-lifecycle.md            # Draft/Released/Archived, new-cycle creation, cycle selector, backups
      outstanding-obligations.md      # the carry-forward predicate / Payroll Materialization Hook seam
      corrections-and-balance-adjustments.md  # the full Corrections + Balance Adjustments workflow
      reports.md                       # Reports module foundation + Payroll Summary Report (Phase 8B Checkpoint 1)
    database/                 # the formal schema specification, split by bounded context
      README.md                # navigation, ownership map, §→file lookup — see database/README.md
      conventions-and-enums.md
      access-control.md
      sites-and-units.md
      employee.md
      payroll-cycle.md
      payroll-entry.md
      release.md
      corrections.md
      balance-adjustments.md
      advances.md
      audit-log.md
      relationships.md
      schema-invariants.md
  api/                       # API contracts (added as endpoints are designed)
  requirements/              # business/functional requirements, as they're elaborated beyond PROJECT_SPEC.md

reference/                   # Client handoff material — read-only historical reference, never edited
  PROJECT_SPEC.md
  payroll_prototype.html

backend/                     # Express + TypeScript API
  src/
    modules/                 # one folder per business domain — the modular-monolith boundary,
                             # matching the 18 modules in docs/architecture/overview.md
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
      reports/               # Reports (Phase 8B Checkpoint 1) — Payroll Summary Report built; Fines & EOBI
                             # and the rest of the Phase 8A-investigated catalogue remain isolated
                             # read-only queries for a future checkpoint
      dashboard/              # Dashboard — summary stats, read-only, cache candidate
      settings/               # Settings — company details, user profile, theme, User Management
      audit-log/              # Audit Log — append-only writes and queries (no update/delete exposed)
      advances/               # Advances / Eid Advances, balance tracking (feeds Payroll Entry)
      tasks/                  # Tasks (added 2026-07-10, Phase 3.5) — lightweight internal delegation/
                             # tracking; ownership-based visibility, not site-scoped; permanent
                             # replacement for the previously-planned Team Collaboration/Chat panel
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

**Note on the two `database/` directories:** `docs/architecture/database/` (documentation — the
schema *specification*, split by bounded context, per this restructuring) and the top-level
`database/` (ERD diagrams, reference SQL, seed/fixture data — non-documentation artifacts) are
different directories with the same base name, serving different purposes; the live, executable
schema itself is `backend/prisma/schema.prisma` in both cases.

## Rationale for the one structural change: `shared/`

`shared/` did not exist in the original scaffold. It's added because several pieces of this system
must be defined identically on both frontend and backend, and duplicating them invites drift:

- Zod validation schemas (a Payroll Entry row is valid or invalid the same way whether it's being
  typed into a form or imported from a CSV on the server).
- The standardized Adjustment Types list
  (`docs/architecture/workflows/corrections-and-balance-adjustments.md`) — used by the correction
  form on the frontend and validated on the backend.
- The official Employee Registry / Payroll Entry template headers (`PROJECT_SPEC.md`) — used by both
  export (backend) and any client-side preview of an import file.
- The `en-US` number formatting utility — this was corrected multiple times in the original design
  conversation and must be one implementation, not two that could disagree.

This is implemented as an npm workspace package, not a build step or code-generation pipeline — kept
as simple as the project's actual scale warrants.

## Documentation governance

Two rules govern how the documentation under `docs/architecture/` is organized and kept
internally consistent. Both are soft, judgment-based guidance, not mechanically enforced gates —
consistent with this project's general preference (Principle 4, Principle 8) for discipline over
process weight.

### Documentation size guideline (soft threshold)

An individual document under `docs/architecture/`, `docs/architecture/database/`, or
`docs/architecture/workflows/` should normally stay under roughly 250–350 lines. This is a prompt to
*evaluate*, not a limit to enforce: when a file grows substantially past this range, check whether it
still contains exactly one cohesive bounded context, or whether a genuinely separable sub-context has
accreted inside it. If it's still one coherent context — a single workflow narrative that simply has
a lot to say, for example — it stays one file. Splitting always follows ownership/bounded-context
boundaries, never a line count on its own; exceeding this guideline is not, by itself, a defect.
`docs/architecture/workflows/corrections-and-balance-adjustments.md` is the one accepted, deliberate
exception in this document set — it is a single coherent workflow narrative that exceeds the
guideline and is not split further.

### Documentation ownership rule

Every architectural concept has exactly one authoritative home *for each aspect of its
documentation* — its schema (`docs/architecture/database/`), its workflow
(`docs/architecture/workflows/`), and its rationale (an `docs/architecture/` narrative file, e.g.
`overview.md`, `authentication.md`). Detailed definition, invariants, and future amendments for a
given aspect belong only in that aspect's owning file. Other documents may summarize, reference, or
link to it — and are expected to, for discoverability — but must not restate its detail as a second
source of truth. A one-line summary, a pointer, or a name mentioned in passing is not ownership;
re-deriving the rationale, re-listing the columns, or re-stating the business rule is. If changing a
concept's actual definition would require editing more than one file to keep the documentation set
internally consistent, its ownership isn't yet settled and should be resolved before the edit is
made, not worked around by updating both.

**Exception — derived, cross-cutting views.** `docs/architecture/overview.md`'s Major Modules table,
`docs/architecture/database/README.md`'s navigation table, and
`docs/architecture/database/relationships.md` and `schema-invariants.md` are deliberate *derived
indexes*, not competing authorities — they exist because seeing many entities' facts side by side has
value no single entity file can provide alone. A change to an authoritative file should prompt a
check of every derived view that mentions the same fact; the derived view itself is never
independently "corrected" without tracing back to its source.
