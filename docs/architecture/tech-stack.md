# Technology Stack

Final, approved stack for the Payroll Management System, with the reasoning behind each choice.
This is a single-tenant, moderate-scale (~1,500 employees, a handful of internal users) but
high-trust financial system — the stack favors correctness, maintainability, and operational
simplicity over raw scale, since scale was never the hard problem here.

## Backend

**Express.js + TypeScript**
Chosen over NestJS: this project doesn't need dependency injection, decorators, or module
metaprogramming to stay organized — it needs disciplined folder structure (see
`docs/architecture/folder-structure.md`), which Express supports without imposing a framework's
opinions on top. TypeScript throughout for type safety on financial data and to share types/Zod
schemas with the frontend.

**Prisma**
Type-safe query builder and migration tool for PostgreSQL. Selected specifically because the
correction/balance-adjustment workflow (`docs/architecture/post-release-corrections.md`) requires
multi-table writes that must succeed or fail together — Prisma's transaction API makes "write the
correction, write the balance adjustment, write the audit log entry, or none of the above" a natural
pattern to enforce, and its migration history gives the additive-schema-evolution principle
(Principle 8) a concrete mechanism.

**PostgreSQL**
The data here is inherently relational — employees, payroll cycles, entries, corrections, advances,
audit log all reference each other, and referential integrity plus transactions matter for financial
correctness in a way a document store doesn't naturally provide. At ~1,500 employees, performance is
a non-issue as long as the known-necessary indexes (CNIC, employee id, site id, cycle id) exist.

## Frontend

**React + Vite**
Vite for a fast local dev loop and simple, modern build tooling. React chosen primarily because the
supporting libraries below (TanStack ecosystem) are the most mature fit for this system's specific,
named performance risk: rendering a 1,500-row, per-cell-editable Payroll Entry table without it
becoming sluggish.

**Tailwind CSS**
Utility-first styling that maps directly onto the token system in `docs/design-system.md` (spacing
scale, color tokens, radius scale) without needing a separate component styling layer to stay
consistent across ~15 pages and a dozen-plus reusable components.

**TanStack Table + (paired with virtualization)**
Handles the Payroll Entry grid: sorting/filtering hooks, per-cell editing, and — critically —
integrates with row virtualization so 1,500 editable rows don't all exist in the DOM at once. This
was explicitly flagged in the original requirements as the most likely real-world source of a "slow"
complaint if done naively.

**TanStack Query**
Server-state management: caching, invalidation, and refetching for all API-backed data (employee
lists, payroll entries, reports, dashboard stats). Avoids hand-rolled loading/error/cache state for
every screen and gives a natural place to hang optimistic-update patterns for inline edits.

**React Hook Form + Zod**
Form state and schema validation. Zod schemas are written once and shared between frontend form
validation and backend request validation (via a shared package), so "what's a valid Payroll Entry
row" is defined in exactly one place, not duplicated and allowed to drift.

## Cross-cutting

**Zod**
Used both for form validation (above) and as the request-validation layer on every Express route,
and for validating CSV/Excel import rows with per-row error reporting — one schema definition
serving three consumers.

**Puppeteer**
Server-side PDF generation for payslips, bank sheets, cash receiving sheets, and statements — chosen
because it renders real HTML/CSS to PDF, letting the exact print-formatted templates (matching the
client's real document formats, per `docs/design-system.md` §3 printable-document components) drive
the PDF output directly, rather than reimplementing those layouts in a lower-level PDF drawing API.

**ExcelJS**
Handles both Excel *generation* (bank sheets, payroll exports, formatted with totals rows) and Excel
*parsing* for import — the original prototype only handled CSV, and the production system needs real
`.xlsx` import robustness with duplicate detection and row-level validation.

**Playwright**
End-to-end testing across the release → hold → correction → new-cycle lifecycle and the
Draft → Released → Archived cycle transitions — these are multi-step, stateful flows where unit
tests alone wouldn't catch integration-level regressions.

**Sentry**
Error monitoring and alerting on both frontend and backend, live from day one per the reliability
requirements — the goal is the client never discovers a bug before the team does.

## Why not alternatives (brief)

- **NestJS** — unnecessary structural overhead for this project's size; Express plus disciplined
  module folders gets the same organizational benefit without the framework tax.
- **MongoDB / NoSQL** — wrong fit; this data is relational and needs transactional integrity across
  related tables (payroll entry, correction, balance adjustment, audit log).
- **GraphQL** — REST is simpler to reason about for per-route RBAC and site-scoping enforcement,
  which is a hard requirement here (Principle 7); GraphQL's flexibility isn't a requirement this
  system has.
