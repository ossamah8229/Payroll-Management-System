# Project Progress — Payroll Management System

**Date:** 2026-07-02
**Latest git commit (at session start):** `79386593af49dcf58e61fdf81925f8a579e65878` — "docs: add Phase 1 progress, session handoff, and prototype"
**Branch:** `main`
**Current implementation phase:** Phase 1 **closed (conditional)** as of 2026-07-02 — see §3.2. Phase 2 (Project Sites, Employee Registry, Settings, User Management) starting now.

This file is the living progress tracker. Update it at the end of every session. For the full phase
roadmap and Definitions of Done, see `docs/IMPLEMENTATION_PLAN.md`; for what must not be changed
without approval, see `docs/SESSION_HANDOFF.md`.

---

## 1. Everything completed so far

### Phase 0 — Project Scaffolding & Foundations (complete)
- npm workspace root (`backend/`, `frontend/`, `shared/`), `tsconfig.base.json`.
- Express + TypeScript skeleton with a `/health` liveness route (no DB dependency).
- Vite + React + TypeScript skeleton with Tailwind configured from `docs/design-system.md` tokens
  (CSS-variable-backed colors so the future Theme picker can swap `--accent` at runtime).
- Prisma initialized against a local PostgreSQL instance (`docker-compose.yml`).
- `shared/` package: Zod schemas (`loginSchema`), `PERMISSIONS`/`ROLE_CODES`/`ROLE_PERMISSIONS`
  constants, `SessionUser` type.
- GitHub Actions CI (`.github/workflows/ci.yml`): install → build shared → typecheck → lint →
  prisma generate → prisma migrate deploy → backend tests → build backend → build frontend, against
  a Postgres service container. **Never yet run** (nothing has been pushed to a PR).

### Phase 1 — Auth, RBAC, and the Audit Log (code-complete, unverified)
- Prisma schema (`backend/prisma/schema.prisma`) — deliberately a *subset* of
  `docs/architecture/database-schema.md`: `Role`, `Permission`, `RolePermission`, `User`,
  `ProjectSite` (minimal — no `defaultBankId` yet), `UserSiteAssignment`, `AuditLog`.
- Two migrations: `20260701164444_init` and `20260701164509_audit_log_immutability` (a DB trigger
  rejecting UPDATE/DELETE on `AuditLog`).
- Seed script (`backend/prisma/seed.ts`): permissions, both roles (`MASTER_ADMIN`, `PAYROLL_STAFF`)
  with grants, one Master Admin account. Idempotent (upserts throughout).
- `express-session` + `connect-pg-simple` + Argon2 login/logout/`me` routes
  (`backend/src/modules/auth/`), with session regeneration on login (fixation protection) and
  immediate session invalidation on deactivation.
- CSRF double-submit-cookie middleware (`backend/src/common/middleware/csrf.ts`).
- `requirePermission` and `requireSiteAccess` middleware
  (`backend/src/common/middleware/{require-permission,require-site-access}.ts`) — independent
  layers per `docs/architecture/authentication.md`.
- Insert-only Audit Log service (`backend/src/modules/audit-log/audit-log.service.ts`) — no
  update/delete export exists at the application layer, on top of the DB-level trigger.
- Test suite: `auth.test.ts` (login/logout/session/CSRF/deactivation, DB-backed), `rbac.test.ts`
  (pure unit tests, no DB), `audit-log.test.ts` (DB-level immutability, DB-backed).
- Frontend: login page (`frontend/src/routes/login-page.tsx`), session hook
  (`frontend/src/hooks/use-session.ts`), app shell/sidebar/topbar
  (`frontend/src/components/layout/`), a Phase-1 placeholder dashboard (`home-page.tsx`).
- `npm run typecheck` and `npm run lint` both pass cleanly across all three workspaces (2 harmless
  `react-refresh/only-export-components` warnings in `badge.tsx`/`button.tsx`, 0 errors).
- All of the above was committed in `00517e3` this session — previously it sat uncommitted in the
  working tree since a prior session crash.

---

## 2. Remaining work (by phase, per `docs/IMPLEMENTATION_PLAN.md`)

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, RBAC, Audit Log | **Closed (conditional), 2026-07-02** — DB-backed test evidence still outstanding, tracked to close before Phase 9 |
| 2 | Project Sites, Employee Registry, Settings, User Management | Not started |
| 3 | Payroll Entry & Payroll Processing (`calcNet`, the 1,500-row grid) | Not started |
| 4 | Release, Bank Sheets, Cash Receiving, Advances | Not started |
| 5 | Cycle Finalization, Archiving, Backups | Not started |
| 6 | Corrections & Balance Adjustments (highest-risk logic) | Not started |
| 7 | Statements, Reports, Dashboard | Not started |
| 8 | Team Collaboration panel, Audit Log viewer UI | Not started |
| 9 | Hardening, Security Review, Deployment | Not started |

---

## 3. Outstanding architectural/business decisions

1. **Bank / AdjustmentType / CompanySettings seed scope mismatch — RESOLVED 2026-07-02.** The
   `schema.prisma` narrowing (deferring `Bank`, `AdjustmentType`, `CompanySettings` to Phase 2) has
   been explicitly ratified by the user as the correct scope. `docs/IMPLEMENTATION_PLAN.md`'s Phase 1
   and Phase 2 "Builds" text has been updated to match: Phase 1's seed script text no longer mentions
   these three, and Phase 2's "Builds" now explicitly owns their migration + seed rows (three banks,
   seven `AdjustmentType` rows, singleton `CompanySettings`, plus `ProjectSite.defaultBankId`). No
   code change was needed — only the plan text was brought in line with the already-implemented
   schema.
2. **Phase 1 review checkpoint — CONDITIONALLY SIGNED OFF 2026-07-02.** The user reviewed this
   session's report (code-complete, statically clean, DB-backed tests unexecuted because no
   Postgres is reachable in this sandboxed environment) and explicitly approved closing Phase 1 on
   that basis, with DB-backed verification tracked as an open item rather than a blocker. See §4 for
   the exact outstanding evidence and where it must be closed out.
3. **Open design assumptions from `docs/architecture/database-schema.md` §26** (items 2, 4, 5:
   CNIC/employeeCode nullability, free-text designation/religion, calendar-month-only cycles) — the
   plan's own risk table flags these as needing client confirmation before Phase 2 and Phase 3
   respectively. Not yet confirmed.

---

## 4. Known limitations

- **Database verification is still outstanding — tracked, not blocking (per 2026-07-02 conditional
  Phase 1 close, §3.2).** No Docker, Docker Compose, Podman, Homebrew, native `psql`/`pg_ctl`, or
  Postgres.app has been available in any sandboxed session so far. `auth.test.ts` and
  `audit-log.test.ts` (both DB-backed) have never been confirmed passing anywhere; no CI run or
  completion report from any prior session shows evidence they were run before either. `rbac.test.ts`
  is a pure unit test (no DB) and its logic has been read-reviewed but not executed. **This must be
  closed out — either by running the suite in a Postgres-capable environment or via a real CI run —
  before Phase 9's production hardening pass at the latest, and ideally as soon as Docker/Postgres is
  available.**
- CI (`.github/workflows/ci.yml`) has never actually run — nothing has been pushed to a remote/PR
  yet. Pushing to get a real CI-backed Postgres run remains the fastest way to close the item above.
- `README.md` previously stated "Phase 1 complete" without this verification caveat; corrected in a
  prior session's documentation pass.

---

## 5. Exact next action for the next development session

Phase 1 is closed (conditional). Phase 2 (Project Sites, Employee Registry, Settings, User
Management) work begins now per `docs/IMPLEMENTATION_PLAN.md`. Carry forward as background
open items, not blockers:

1. Close out the DB-backed verification gap (§4) — via a Docker/Postgres-capable environment or a
   real CI push — before Phase 9 at the latest.
2. Confirm the open design assumptions from `docs/architecture/database-schema.md` §26 (items 2, 4,
   5: CNIC/employeeCode nullability, free-text designation/religion, calendar-month-only cycles)
   before they become load-bearing in Phase 2/3 schema work (§3.3 above).
