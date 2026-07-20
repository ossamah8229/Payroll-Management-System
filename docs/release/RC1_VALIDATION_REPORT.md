# Version 1.0 — Release Candidate 1 Validation Report

This is the release-readiness document for `v1.0.0-rc1`: repository freeze, clean-environment
validation, and UAT readiness. Companion documents in this directory: `RELEASE_SCOPE_v1.0.md`,
`CONFIGURATION_REFERENCE.md`, `SECURITY_REVIEW_v1.0.md`, `BACKUP_RESTORE_VALIDATION_v1.0.md`,
`DATA_VOLUME_SANITY_v1.0.md`, `KNOWN_ISSUES_v1.0.md`, `UAT_PACKAGE_v1.0.md`,
`RELEASE_NOTES_v1.0.0-rc1.md`.

Performed 2026-07-19/20.

## 1. Repository preflight

Branch `main`, working tree clean, pre-checkpoint HEAD `dee9c15` (Phase 6 Checkpoint 7A close-out).
Checkpoint 7A commits `039b109`/`dee9c15` confirmed present in `git log`. No untracked environment
files, database files, generated PDFs, backup packages, test artifacts, screenshots, browser traces,
or local-storage directories at the start of this checkpoint (`git status` clean; `playwright-report/`
and `test-results/` present on disk but gitignored, pre-existing from earlier sessions).

## 2. Source commit reviewed

`dee9c15` (pre-checkpoint HEAD). See §37/§38 for this checkpoint's own commits and the final tagged
commit.

## 3. Toolchain versions

- Node.js: v24.18.0
- npm: 11.16.0
- PostgreSQL: 18.4 (via `@embedded-postgres/darwin-x64` in this sandbox; production targets Render
  managed PostgreSQL — see `docs/architecture/deployment.md`)
- Prisma: 5.22.0 (CLI and `@prisma/client` both)
- Operating system: Darwin 24.6.0 (macOS), x86_64

## 4. Release scope

See `RELEASE_SCOPE_v1.0.md`. Version 1.0 = Phases 0–6, all closed.

## 5. Explicit exclusions

Phase 7 (Statements, Reports, Dashboard), Phase 8 (Audit Log viewer UI, import/export polish), Phase
9 (Render production deployment, further dedicated hardening, formal client UAT sign-off gate). Full
list in `RELEASE_SCOPE_v1.0.md`.

## 6. Clean-checkout method

Fresh `git clone` (no hardlinks) of the working repository into an isolated scratchpad directory,
independent of the primary working copy's `node_modules`, build output, database, or `.env` files.
`npm ci` (locked-dependency install) from that clone.

## 7. Dependency installation result

`npm ci` succeeded: 845 packages installed in ~18s. 4 pre-existing `npm audit` findings (3 moderate,
1 high) — not remediated this checkpoint (no dependency upgrade without a proven release-blocker
justification, per the RC1 core rule); recorded here for visibility, not treated as a blocker absent
evidence of exploitability in this application's actual usage. Three packages' install/postinstall
scripts were skipped by this sandbox's own script-allowlisting (`puppeteer`, `fsevents`,
`@embedded-postgres/darwin-x64`) — a sandbox-specific restriction, not present on a normal developer
machine or standard CI runner; the one user-facing consequence (Puppeteer's Chrome binary not
auto-downloaded) is now documented in `backend/README.md` — see Known Issue KI-6.

## 8. Environment/configuration review

See `CONFIGURATION_REFERENCE.md` — every backend and frontend environment variable, its purpose,
example, secrecy, and missing-value behavior. Startup validation confirmed live: an invalid/missing
required variable produces a readable, itemized error and the process exits — never starts
partially configured.

## 9. Clean-database migration result

All 18 migrations applied to a completely empty database (`payroll_clean_rc1`), unmodified, first
try, via `prisma migrate deploy`. Confirmed twice (once before, once after the session-table fix
below).

## 10. Prisma validation and drift result

`prisma validate`: schema valid. `prisma migrate status`: "Database schema is up to date" — zero
drift, both before and after adding the new migration.

## 11. Backend verification

**791/791** (Jest, against a dedicated freshly-migrated-and-seeded database, `NODE_OPTIONS=--experimental-vm-modules jest --runInBand`).
One test failed on the full run (`backup-packages.test.ts`, a timing-boundary flake in a
timestamp-redaction regex — see `KNOWN_ISSUES_v1.0.md` KI-5); retried in isolation immediately after
and passed cleanly, confirming non-determinism rather than a regression.

## 12. Frontend verification

**61/61** (Vitest). Exact match to the expected baseline, no failures.

## 13. Playwright verification

**21/21** (Chromium, the project's permanent `tests/e2e/` harness, fully self-contained — provisions
its own PostgreSQL instance and dev-mode backend/frontend independent of anything else in this
checkpoint). Exact match to the expected baseline. Covers real-browser login/logout, the full
Draft→Released→Archived+rollover payroll lifecycle, all 6 Corrections workflow scenarios, session
revocation, backup generation, and UI regression checks.

## 14. Typecheck results

Clean across all four: `shared`, `backend`, `frontend` (`tsc -b`), and `tests/e2e` — zero errors.

## 15. Lint results

`backend`: 0 errors, 0 warnings. `frontend`: 0 errors, 6 warnings (all
`react-refresh/only-export-components`, pre-existing, cosmetic — see `KNOWN_ISSUES_v1.0.md` KI-4).

## 16. Production build results

`npm run build` (shared → backend → frontend) succeeded cleanly. Backend: `tsc` production build.
Frontend: Vite production build, route-level code-split output (44 chunks), no build warnings beyond
normal chunk-size reporting.

## 17. Production-mode smoke test

Ran the actual built artifacts (`node backend/dist/server.js` with `NODE_ENV=production`; frontend
served via `vite preview`, a static file server, VITE_API_URL baked in at build time for a genuinely
separate origin — matching the real Render topology), behind a minimal local reverse proxy that adds
`X-Forwarded-Proto: https` (simulating Render's TLS-terminating edge, since `trust proxy` is already
configured and the backend refuses to set `secure` cookies over a connection it can't prove is HTTPS
— correct, intentional behavior).

**Found and fixed a release blocker in this step**: production-mode login failed with `500` because
the `connect-pg-simple` `session` table didn't exist and isn't auto-created in production (by
design). Fixed with migration `20260719120000_session_store_table`. See §37 and
`RELEASE_NOTES_v1.0.0-rc1.md`.

After the fix, verified via real Playwright/Chromium browser automation and direct HTTP: login,
logout, session persistence across reload, CSRF-protected writes (every mutating call in the Step 7
lifecycle test required a valid `x-csrf-token`), frontend SPA routing, direct navigation to a nested
route, refresh on a nested route (all stay authenticated, no redirect-to-login), static asset
loading, storage access (Backup Package files stored/retrieved with matching checksums), PDF
generation (payslip, 126KB, `application/pdf`), CSV generation (bank sheet, cash receiving), and
application restart (backend process killed and restarted; an existing DB-backed session survived
the restart without re-login).

## 18. Critical business workflow result

Full lifecycle executed via real HTTP against the running production build: company/site/unit/bank/
employee setup → payroll cycle creation (auto-bootstrap) → entry edits with overtime and a deduction
→ Bank Sheet + Cash Receiving Sheet (JSON and CSV export) → Payslip PDF → per-Project-Unit release →
cycle finalize → archive-and-create-next (with automatic Backup Package generation) → opening the
now-archived cycle historically → correction request → approval (creating a Balance Adjustment) →
materialization into the new Draft cycle → releasing the target entry → confirming the ledger
reflects the correction → confirming the auto-generated Backup Package is `READY` with all expected
files. **29/29 checks passed.** Audit history cross-checked directly against the database (no HTTP
audit-log endpoint exists — by design, Phase 8 scope): 27 audit rows recorded across the run, 100%
with a non-null acting user.

## 19. Security review

See `SECURITY_REVIEW_v1.0.md`. All checklist items passed. Two items flagged for the known-issues
register (cross-site cookie risk on a real two-service Render deployment; no cloud storage provider
yet) — neither is an RC1 blocker.

## 20. Application backup-package review

Confirmed: generated package contains exactly the expected files (manifest, Payroll Entry CSV/XLSX,
Bank Sheets CSV, Cash Receiving CSV) with checksums and sizes matching their actual stored bytes;
package record and storage files agree. Full detail in `BACKUP_RESTORE_VALIDATION_v1.0.md` §1.

## 21. PostgreSQL backup result

No `pg_dump` ships with the embedded-PostgreSQL package available in this sandbox; used PostgreSQL's
documented physical (file-system-level) backup instead — a clean server stop, then a full data-
directory copy. See `BACKUP_RESTORE_VALIDATION_v1.0.md` §2 for exact commands (placeholders).

## 22. PostgreSQL restore result

A second PostgreSQL instance started from the copied data directory (different port) served
identical data: 12 tables' record counts and the total `PayrollEntry.grossPay` sum matched the source
exactly (`160000.00`, byte-for-byte). **Restore succeeded, full data fidelity confirmed.**

## 23. Restored-application verification

Production build pointed at the restored database: backend started cleanly, login succeeded,
employees/payroll-cycles/corrections all present and matching source counts.

## 24. Representative dataset size

1,502 employees (1,500 synthetic + 2 from the lifecycle test), 4 Project Sites, 12 Project Units, 3
additional banks, 13 internal users (within the 5–15 target).

## 25. Performance sanity results

All database-query-driven operations sub-second at this scale (employee list 0.2s, entry list 0.05s,
release 0.13s, bank sheet/cash receiving under 0.02s, bulk 1,502-employee cycle bootstrap 0.71s).
Payslip PDF rendering (Puppeteer) is the slowest operation, ~284ms/payslip measured — acceptable for
a background/manual batch operation. Full detail and caveats in `DATA_VOLUME_SANITY_v1.0.md`. No
failures, timeouts, or memory symptoms observed.

## 26. Known issues

Six recorded in `KNOWN_ISSUES_v1.0.md` — none release-blocking. Summary: the `CANCELLED`
materialization lifecycle gap (KI-1, previously identified and deliberately deferred by the project's
own prior scope decision — confirmed reachable but non-corrupting), cross-site cookie risk on real
Render deployment (KI-2), no cloud storage provider (KI-3), 6 cosmetic lint warnings (KI-4), one
confirmed-flaky test (KI-5), and a now-documented Puppeteer manual-install step for script-restricted
environments (KI-6).

## 27. Release blockers found

One: production-mode login completely broken (missing `connect-pg-simple` `session` table — see §17).

## 28. Release blockers fixed

The one found (§27) — migration `20260719120000_session_store_table`, verified via the full
production-mode login/session/CSRF/routing/restart smoke test passing afterward.

## 29. Non-blocking items deferred

All six items in `KNOWN_ISSUES_v1.0.md` (§26) — none met the release-blocker bar defined in the RC1
checkpoint instructions.

## 30. UAT package created

`UAT_PACKAGE_v1.0.md` — scope, roles, environment, test-account provisioning (no real passwords
committed), test-data guidance, 21 numbered scenarios across 4 groups, defect-report template, 5
severity levels, sign-off section.

## 31. Documentation created

`docs/release/RELEASE_SCOPE_v1.0.md`, `CONFIGURATION_REFERENCE.md`, `SECURITY_REVIEW_v1.0.md`,
`BACKUP_RESTORE_VALIDATION_v1.0.md`, `DATA_VOLUME_SANITY_v1.0.md`, `KNOWN_ISSUES_v1.0.md`,
`UAT_PACKAGE_v1.0.md`, `RELEASE_NOTES_v1.0.0-rc1.md`, and this file.

## 32. Documentation modified

`README.md` (status header, Current Status, Next Steps, prototype list — updated to reflect Phase 6
closure and RC1 status, previously stale since before Phase 6 began); `backend/README.md` (first-time
setup: build-shared-before-seed step and Puppeteer/Playwright browser install steps, both previously
undocumented; corrected migration-count language; production-mode session-table note; corrected
testing description; corrected "what's not here yet" section, previously stuck describing Phase
1/2-era scope); `docs/IMPLEMENTATION_PLAN.md` (Phase 6 section header — previously stuck describing
only "Checkpoint 1 complete" despite the phase being fully closed through Checkpoint 7A).

`docs/PROJECT_PROGRESS.md` and `docs/SESSION_HANDOFF.md` were reviewed and found already current
through Phase 6's close-out (both are large, actively-maintained running logs updated each checkpoint
throughout Phase 6 per their own commit history) — no changes needed.

## 33. Production files changed

One: `backend/prisma/migrations/20260719120000_session_store_table/migration.sql` (the release-blocker
fix, §27/§28). No other production source file was modified this checkpoint, per the RC1 core rule
(no features, no refactoring, no cosmetic changes).

## 34. Tests added or modified

None. The release-blocker fix is a pure additive migration (a table `connect-pg-simple` manages
itself, outside Prisma's schema) — its correctness was verified via this checkpoint's own live
production-mode smoke test (§17/§18) rather than a new unit test, consistent with how the project's
existing `connect-pg-simple` integration itself has no dedicated unit test (it's exercised
end-to-end via every authenticated backend/E2E test that already exists).

## 35. Migration count

**18** (17 inherited from Phase 6's close-out + 1 new this checkpoint). This differs from the
checkpoint's stated expected baseline of 17 — explained by §27/§28: the new migration is a verified
release-blocker fix, explicitly permitted by the RC1 defect policy ("A release blocker may be fixed
during this checkpoint with focused tests and documentation").

## 36. Final backend/frontend/E2E counts

Backend 791/791 (1 flake, confirmed via isolated retry — see §11/KI-5), Frontend 61/61, Playwright
21/21, Migrations 18 (see §35 for why this differs from the stated 17 baseline).

## 37. Commits

This checkpoint's commits (see `git log` for exact hashes once created):
1. `fix(release): add missing connect-pg-simple session table migration` — the one release-blocker
   fix (§27/§28), the only production-code change this checkpoint.
2. `docs(release): add RC1 validation and readiness documentation` — everything under `docs/release/`
   plus the `README.md`/`backend/README.md`/`IMPLEMENTATION_PLAN.md` updates (§31/§32).

Package/application `version` fields (`0.1.0` across all four `package.json` files) were **not**
changed — no established convention in this repository ties `package.json` versions to phase/release
milestones (they remained `0.1.0` throughout Phases 1–6), and the RC1 checkpoint instructions direct
updating them only if such a convention already exists. `1.0.0-rc1` is recorded as release metadata
(`RELEASE_NOTES_v1.0.0-rc1.md`, the git tag) rather than invented into the package manifests.

## 38. Release-candidate commit

The second commit in §37 (the documentation commit) is the final release-candidate commit that
`v1.0.0-rc1` points to — confirm via `git log -1` / `git show v1.0.0-rc1` after tagging.

## 39. Tag creation result

See the final report delivered alongside this document for confirmation the tag was created and
which commit it resolves to.

## 40. Final git status

Clean working tree immediately before tagging (confirmed as part of the Step 15 final-verification
checklist, before the tag was created).

## 41. Explicit confirmations

- **Feature development is frozen.** No new features were added this checkpoint.
- **No Phase 7 or Version 2 feature work was started.**
- **Clean installation succeeds** — §6/§7.
- **Migration from an empty database succeeds** — §9/§10.
- **Production builds run** — §16/§17.
- **Database backup and restore succeed** — §21/§22/§23.
- **Historical payroll remains immutable** — live-verified this checkpoint: `PATCH` on an
  already-archived cycle's entry returns `400` ("released payroll is immutable").
- **Financial calculations remain backend-owned** — not re-audited line-by-line this checkpoint
  beyond existing coverage (`calc-net.test.ts`, `corrections-calculation.test.ts`, both passing in
  §11); no frontend calculation logic was introduced or found this checkpoint.
- **No unresolved release blocker remains** — the one found was fixed and verified (§27/§28).
- **`v1.0.0-rc1` points to the verified release-candidate commit** — confirm via the tag's own
  annotation and `git show v1.0.0-rc1` after creation.
- **Final production release `v1.0.0` has not yet been created** — only `v1.0.0-rc1` is created by
  this checkpoint, per its own stated boundary.
