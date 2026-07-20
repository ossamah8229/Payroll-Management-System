# Release Notes — v1.0.0-rc1

- **Version**: `1.0.0-rc1`
- **Release date**: 2026-07-20
- **Source commit**: pre-tag HEAD was `dee9c15` (Phase 6 Checkpoint 7A close-out); this RC1
  checkpoint adds one release-blocker fix commit and several documentation-only commits on top — see
  `RC1_VALIDATION_REPORT.md` §37 for the exact commit list and §38 for the final tagged commit hash.
- **Migration count**: 18 (17 inherited + 1 new this checkpoint: `20260719120000_session_store_table`,
  a release-blocker fix — see below).
- **Test counts** (this checkpoint's verified run): Backend 791/791 (one confirmed timing-flake,
  passes on isolated retry — see `KNOWN_ISSUES_v1.0.md` KI-5), Frontend 61/61, Playwright 21/21.
- **Known issues**: see `KNOWN_ISSUES_v1.0.md` — 6 recorded, 0 release-blocking.
- **Supported deployment assumptions**: Node ≥20 (validated on v24.18.0), PostgreSQL 18 (Prisma
  5.22.0), a TLS-terminating reverse proxy in front of the backend in any environment reachable by
  real users (Render's own edge satisfies this — see `CONFIGURATION_REFERENCE.md`), a persistent (not
  purely ephemeral) filesystem for `STORAGE_ROOT` until a cloud `StorageProvider` exists
  (`KNOWN_ISSUES_v1.0.md` KI-3).

## What's in Version 1.0

Phases 0 through 6, complete: authentication/RBAC/audit log, Project Sites/Units/Employee
Registry/Banks/Settings/Users, Payroll Entry & Processing, Release/Bank Sheets/Cash Receiving/
Advances/Payslips, Cycle Finalization/Archiving/Backups, Corrections & Balance Adjustments. Full
statement: `RELEASE_SCOPE_v1.0.md`.

## What's explicitly not in Version 1.0

Employee Statements, Fines & EOBI Report, Dashboard (Phase 7); a dedicated Audit Log viewer UI
(Phase 8); Render production deployment and a further dedicated hardening pass (Phase 9). Full
statement, `RELEASE_SCOPE_v1.0.md`.

## Release-blocking defect found and fixed this checkpoint

**Production-mode login was completely broken** — `connect-pg-simple`'s `session` table was never
created by any migration, and `createTableIfMissing` is deliberately disabled in `NODE_ENV=production`
(to avoid a first-request race), so every login attempt failed with a `500` (`relation "session" does
not exist`). Found during Step 2/6's clean-environment, production-build validation (a scenario the
project's existing dev-mode E2E harness doesn't exercise, since it doesn't run in production mode).
Fixed with a new migration (`20260719120000_session_store_table`) providing the table
`connect-pg-simple` itself expects (reproduced from its own upstream `table.sql`). Verified: full
login → session-persistence → nested-route-refresh → logout cycle now works correctly in production
mode, behind a proxy that sets `X-Forwarded-Proto: https` (matching Render's real topology).

## Validation summary

See `RC1_VALIDATION_REPORT.md` for the complete record: clean-environment install/migrate/seed/build/
start, full verification suite, production-mode smoke test, a full critical-business-lifecycle
walkthrough via real HTTP (company setup through corrections/materialization/settlement/backup),
security review, database backup/restore validation, and a ~1,500-employee data-volume sanity check.
No unresolved release blocker remains as of this release candidate.
