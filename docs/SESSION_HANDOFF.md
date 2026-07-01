# Session Handoff — Payroll Management System

Read this file first in any new session, alongside `docs/PROJECT_PROGRESS.md`. Together they should
be enough to resume correctly without re-deriving context from scratch — per
`docs/IMPLEMENTATION_PLAN.md`'s own "How to Resume This Project" section, the full read order is:
`docs/PROJECT_PRINCIPLES.md` → `docs/architecture/overview.md` → rest of `docs/architecture/*.md` →
`docs/IMPLEMENTATION_PLAN.md` → this file → `docs/PROJECT_PROGRESS.md`.

---

## 1. Current repository status

- Branch: `main`
- Latest commit: `00517e3282c073d5c759233cece13a40f0091dc8` — "Phase 0 + Phase 1 implementation:
  scaffolding, auth, RBAC, audit log"
- Working tree: clean as of this session's start, aside from the documentation files this closing
  session adds (`docs/PROJECT_PROGRESS.md`, `docs/SESSION_HANDOFF.md`,
  `docs/prototypes/phase1-preview.html`, and a `README.md` "Current Status" section).
- `npm run typecheck` and `npm run lint` both pass with 0 errors across `shared`/`backend`/`frontend`.
- No DB-backed test has been run in this session (no Postgres available in the working environment).

## 2. What was completed today

- Reviewed the repository end-to-end against `docs/IMPLEMENTATION_PLAN.md` after a prior session's
  terminal crash, since no `docs/PROJECT_PROGRESS.md` existed yet to resume from.
- Confirmed Phase 0 scaffolding and Phase 1 (auth/RBAC/audit log) were code-complete: schema,
  migrations, seed, session auth, CSRF, RBAC/site-scoping middleware, Audit Log service, tests,
  and the frontend login/session/app-shell — but **all of it was uncommitted** (only one prior
  commit, "Architecture freeze," existed).
- Ran `npm run typecheck` and `npm run lint` — both clean.
- Attempted to verify DB-backed tests; found no Docker, Homebrew, Postgres.app, or other Postgres
  install available in this environment, and confirmed that verification is deferred to the next
  session (see `docs/PROJECT_PROGRESS.md` §5).
- Committed all previously-uncommitted Phase 0/1 work as `00517e3`.
- Wrote this handoff, `docs/PROJECT_PROGRESS.md`, a static visual prototype of the current UI
  (`docs/prototypes/phase1-preview.html`), and a "Current Status" section in `README.md`.
- **No new application code was written this session** — this was a documentation/handoff pass only,
  by explicit instruction.

## 3. What must not be changed without approval

- Anything in `docs/architecture/*.md` or `docs/PROJECT_PRINCIPLES.md` — the architecture is
  explicitly frozen (see `docs/IMPLEMENTATION_PLAN.md`'s opening section). Any implementation detail
  that appears to contradict these documents must be raised, not silently reinterpreted.
- The phase ordering and review checkpoints in `docs/IMPLEMENTATION_PLAN.md` (🛑 after Phase 1,
  Phase 3, Phase 5, Phase 6, Phase 9) — these are explicit stop-and-approve gates, not suggestions.
- The Phase 1 Prisma schema's table scope (`Role`/`Permission`/`RolePermission`/`User`/
  `ProjectSite`(minimal)/`UserSiteAssignment`/`AuditLog`) should not be silently expanded to include
  `Bank`/`AdjustmentType`/`CompanySettings` (or vice versa — Phase 2 narrowed back to match the
  plan's literal Phase 1 text) without first resolving the scope question in
  `docs/PROJECT_PROGRESS.md` §3.1.
- Audit Log immutability: no application code path should ever add an update/delete export from
  `audit-log.service.ts`, and the database trigger from the
  `20260701164509_audit_log_immutability` migration must never be dropped or worked around.
- Existing migrations (`20260701164444_init`, `20260701164509_audit_log_immutability`) should not be
  edited in place once applied anywhere beyond a fresh local dev database — per Principle 8
  (additive-first schema evolution), later changes are new migrations, not edits to these.

## 4. Current frozen architecture (reference index)

- `docs/PROJECT_PRINCIPLES.md` — the 8 standing principles (e.g. Payroll Entry as single source of
  truth, additive-first migrations, insert-only Audit Log).
- `docs/architecture/overview.md` — the load-bearing data path: Employee Registry → Payroll Entry →
  Payroll Processing → Release → Bank Sheets/Cash Receiving, with Corrections/Balance Adjustments as
  the highest-risk branch.
- `docs/architecture/database-schema.md` — full 18-table schema (Phase 1 implements a 7-table
  subset of it; see §1 of `docs/PROJECT_PROGRESS.md`).
- `docs/architecture/authentication.md` — session-based auth, CSRF double-submit, RBAC +
  site-scoping as independent middleware layers.
- `docs/architecture/post-release-corrections.md` — the baseline-reconstruction/replay algorithm,
  deliberately scheduled late (Phase 6) per the plan.
- `docs/architecture/data-and-storage.md` — `StorageProvider` abstraction, Finalize Cycle
  precondition, Backup Package versioning.
- `docs/design-system.md` — tokens (color/type/spacing/radius), layout patterns, and the shared
  component inventory the frontend must reuse rather than re-implement per page.

## 5. Phase 1 completion checklist

Per `docs/IMPLEMENTATION_PLAN.md`'s Phase 1 Definition of Done:

- [x] Migration applies cleanly to an empty database *(believed true — migrations are additive and
      reviewed; not re-verified against a live DB this session)*
- [ ] **Seed script confirmed idempotent against a live database** — not run this session
- [ ] **Scripted login as the seeded Master Admin succeeds** — not run this session
- [ ] **Scripted attempt to call a protected route without a session fails with 401** — covered by
      `auth.test.ts`, not executed this session
- [ ] **Scripted attempt to update or delete an audit log row fails at the database level** —
      covered by `audit-log.test.ts`, not executed this session
- [ ] **CSRF-missing requests to state-changing routes are rejected** — covered by `auth.test.ts`,
      not executed this session
- [x] RBAC middleware unit tests (no DB required) — read-reviewed, logic matches spec
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean (0 errors)
- [ ] **🛑 Explicit review-checkpoint sign-off** — not yet obtained

Bottom line: **Phase 1 is not confirmed complete.** It is code-complete and statically clean, but the
Definition of Done requires runtime DB evidence that does not yet exist.

## 6. Next steps, in order

1. Provision a real Postgres instance (`docker compose up -d` or equivalent) in an environment that
   supports it.
2. Apply migrations + seed, then run `npm run test --workspace backend` and confirm all three test
   files pass.
3. Resolve the Bank/AdjustmentType/CompanySettings Phase-1-vs-Phase-2 scope question.
4. Obtain explicit sign-off on the Phase 1 review checkpoint.
5. Begin Phase 2 (Project Sites, Employee Registry, Settings, User Management) — only after 1–4.

## 7. Risks and assumptions

- **Assumption**: the migrations as written are correct and will apply cleanly — this is inferred
  from code review and clean `prisma generate`/typecheck, not from an actual `migrate deploy` run
  against Postgres in this session.
- **Risk**: if the DB-backed tests fail when finally run, the fix may touch files already committed
  in `00517e3` — that commit should be treated as a checkpoint to diff against, not as untouchable
  history.
- **Risk**: the unresolved Bank/AdjustmentType/CompanySettings scope question could ripple into
  Phase 2's migration design if decided late — resolve before Phase 2 schema work starts, not
  mid-phase.
- **Assumption**: no one has manually altered the database, `.env`, or any untracked local file
  outside of what's described here since commit `00517e3`.
