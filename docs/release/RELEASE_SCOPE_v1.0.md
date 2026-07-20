# Version 1.0 — Release Scope

**Status:** Release scope freeze for `v1.0.0-rc1`.
**Source commit at freeze:** `dee9c15` (Phase 6 Checkpoint 7A close-out).
**Effective date:** 2026-07-19.

This document is the authoritative statement of what is, and is not, in Version 1.0. From this
checkpoint onward (per the RC1 core rule), no new features, speculative improvements, architectural
redesign, cosmetic refactoring, or non-essential dependency upgrades are in scope. Only
release-blocking defects may change production code before `v1.0.0-rc1` is tagged.

## In scope for Version 1.0 (Phases 0–6, all closed)

| Area | Implementation phase | Status |
|---|---|---|
| Authentication and authorization (session auth, CSRF, RBAC, site-scoping) | Phase 1 | Closed |
| Audit log (insert-only, DB-level immutability trigger) and audit history on records | Phase 1 | Closed |
| Employee registry (CRUD, CNIC/employee-code uniqueness, DOL soft-leaving, Reactivate) | Phase 2 / 2.5 | Closed |
| Employee import/export (CSV/Excel, official template, Project Unit remap) | Phase 2.5 | Closed |
| Project Sites, Project Units, Banks, Company Settings, User Management | Phase 2 / 2.5 | Closed |
| Permissions (role-based: Master User, Payroll Staff, Finance, Reviewer, site-scoping) | Phases 1–6 | Closed |
| Payroll cycles (creation, bootstrap) | Phase 3 | Closed |
| Payroll entry (grid, Work Lines, split by unit, multi-site filter, Copy to All, import/export) | Phase 3 | Closed |
| Payroll release (per-Project-Unit release, `PayrollUnitRelease`, Finance role, Late Entry exception) | Phase 4 | Code-complete* |
| Bank sheets | Phase 4 | Code-complete* |
| Cash receiving sheets | Phase 4 | Code-complete* |
| Advances | Phase 4 | Code-complete* |
| Payslips (PDF engine, batch ZIP generation, identity snapshots) | Phase 4 | Code-complete* |
| Historical payroll (Historical Payroll Cycle Selector) | Phase 5 | Closed |
| Cycle finalization | Phase 5 | Closed |
| Archive-and-create-next (cycle archiving, automatic backup generation, rollover) | Phase 5 | Closed |
| Backup packages (`StorageProvider`, generation, crash recovery) | Phase 5 | Closed |
| Corrections (`CorrectionRequest` workflow, propose/decide separation) | Phase 6 | Closed |
| Review queue | Phase 6 | Closed |
| Balance adjustments (`BalanceAdjustmentSettlement`, multi-cycle installment recovery) | Phase 6 | Closed |
| Materialization (obligation → entry, consumption on release) | Phase 6 | Closed |
| Settlements (`CorrectionPayment`, immediate/deferred) | Phase 6 | Closed |
| Static phase prototypes (`docs/prototypes/*.html`) | Phases 1–6 | Present, tracked |

*"Code-complete" items are functionally implemented, tested (346/346 backend tests at Phase 4
close-out, now part of the full suite), and committed, but Phase 4's own closure was historically
held open by exactly one condition — a real Render/Linux-container deployment smoke test that this
sandboxed environment could not perform (no Docker/Podman/Colima, no Render API token, no configured
git remote). This RC1 checkpoint's clean-environment and production-mode validation (Steps 2 and 6)
re-examines that condition under this checkpoint's own evidence; see `RC1_VALIDATION_REPORT.md`.

## Explicitly excluded from Version 1.0

The following are deferred to a post-1.0 roadmap and **must not** be implemented during RC1
preparation:

- **Employee Statements (Statement of Account)** — Phase 7. Requires Phase 6's corrections/balance
  adjustments as inputs; not started.
- **Fines & EOBI Report** — Phase 7. Depends on Statements' ledger-computation code.
- **Dashboard (summary stats, per-site payroll summary, release progress, deduction breakdown)** —
  Phase 7. Not started.
- **Dedicated Audit Log viewer UI** (chronological, filterable feed) — Phase 8. The underlying
  `AuditLog` data model, immutability guarantee, and per-record audit history are in scope (Phase 1);
  a standalone browsing UI for the full audit trail is not.
- **Remaining import/export polish and edge-case handling** identified as lower-priority during
  earlier phases — Phase 8.
- **Dedicated post-close security hardening pass** beyond this checkpoint's Step 8 review, full
  RBAC re-verification across every route as a standalone project, and a full Playwright suite
  spanning the entire create→correct→settle→new-cycle lifecycle in one continuous run — Phase 9.
- **Render (or other) managed production deployment**: managed Postgres with PITR, staging/production
  separation, Sentry wiring — Phase 9. Deployment-portability was designed for (not hosting-provider-
  specific), but the actual cloud provisioning has not been performed.
- **Team Collaboration / Chat panel** — permanently removed from scope (superseded by the Phase 3.5
  Tasks Workspace); not a future roadmap item.
- Any `CANCELLED` correction/obligation lifecycle state — see `KNOWN_ISSUES_v1.0.md` for the
  associated known edge case and its release-blocking assessment.

## Roadmap (post-1.0, not committed to a version number)

1. Phase 7 — Statements, Reports, Dashboard.
2. Phase 8 — Audit Log viewer UI, import/export polish.
3. Phase 9 — Full hardening pass, Render production deployment, formal client UAT sign-off gate
   ahead of production cutover.

## Freeze rule

Per the RC1 core rule: no new features, no speculative improvements, no architectural redesign, no
cosmetic refactoring, no non-essential dependency upgrades from this point forward. Only defects
meeting the release-blocker definition in the RC1 checkpoint instructions may change production
code before tagging.
