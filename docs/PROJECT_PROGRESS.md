# Project Progress — Payroll Management System

**Date:** 2026-07-01
**Latest git commit:** `00517e3282c073d5c759233cece13a40f0091dc8` — "Phase 0 + Phase 1 implementation: scaffolding, auth, RBAC, audit log"
**Branch:** `main`
**Current implementation phase:** Phase 1 (Auth, RBAC, Audit Log) — code-complete, **DB verification and review checkpoint still pending**. Phase 2 has not started.

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
| 1 | Auth, RBAC, Audit Log | Code-complete; DB tests unverified; review checkpoint not signed off |
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

1. **Bank / AdjustmentType / CompanySettings seed scope mismatch.** `schema.prisma`'s header
   comment explicitly defers `Bank`, `AdjustmentType`, and `CompanySettings` to Phase 2, but
   `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 "Builds" section literally lists the seed script as
   including "three banks, seven `AdjustmentType` rows... singleton `CompanySettings`." This was
   narrowed unilaterally in a prior session's code comment rather than raised explicitly, per the
   plan's own rule ("if anything encountered during implementation appears to contradict the frozen
   architecture, stop and raise it before proceeding"). **Needs an explicit decision before Phase 2
   schema work begins**, since Phase 2 is where `Bank` would otherwise naturally land.
2. **Phase 1 review checkpoint not signed off.** The plan mandates: "🛑 Review checkpoint. Stop
   here for explicit approval before building anything on top of this foundation." This has not
   happened yet — Phase 2 must not begin until it does.
3. **Open design assumptions from `docs/architecture/database-schema.md` §26** (items 2, 4, 5:
   CNIC/employeeCode nullability, free-text designation/religion, calendar-month-only cycles) — the
   plan's own risk table flags these as needing client confirmation before Phase 2 and Phase 3
   respectively. Not yet confirmed.

---

## 4. Known limitations

- **Database verification is pending.** No Docker, Homebrew, Postgres.app, or other local Postgres
  install was available in the sandboxed environment used for this session. `auth.test.ts` and
  `audit-log.test.ts` (both DB-backed) have never been confirmed passing anywhere — not in this
  session, and no CI run or completion report from a prior session shows evidence they were run
  before either. `rbac.test.ts` is a pure unit test (no DB) and its logic has been read-reviewed but
  not executed in this session.
- CI (`.github/workflows/ci.yml`) has never actually run — nothing has been pushed to a remote/PR
  yet.
- `README.md` previously stated "Phase 1 complete" without this verification caveat; corrected as
  part of this session's documentation pass (see `docs/SESSION_HANDOFF.md`).

---

## 5. Exact next action for the next development session

1. Get a real PostgreSQL instance running (`docker compose up -d` from repo root, or an equivalent
   local Postgres 16), then:
   ```bash
   cp backend/.env.example backend/.env
   npm run prisma:generate --workspace backend
   npx prisma migrate deploy --schema backend/prisma/schema.prisma
   npm run prisma:seed --workspace backend
   npm run test --workspace backend
   ```
2. Confirm `auth.test.ts`, `rbac.test.ts`, and `audit-log.test.ts` all pass — this is the actual,
   still-missing evidence for Phase 1's Definition of Done.
3. Resolve the Bank/AdjustmentType/CompanySettings scope question (§3.1 above) with the user.
4. Get explicit sign-off on the Phase 1 review checkpoint (§3.2 above).
5. Only then begin Phase 2 (Project Sites, Employee Registry, Settings, User Management) per
   `docs/IMPLEMENTATION_PLAN.md`.
