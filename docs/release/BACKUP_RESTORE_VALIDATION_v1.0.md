# Version 1.0 — Backup and Restore Validation

Performed 2026-07-19/20 against the RC1 clean-environment database (`payroll_clean_rc1`) after
running the full critical-business-lifecycle smoke test (see `RC1_VALIDATION_REPORT.md` Step 7),
so the database held real multi-table state: 2 employees, 2 payroll cycles (one archived, one
draft), a correction request/approval/materialization chain, and an auto-generated Backup Package.

## 1. Application backup package

A Backup Package is generated automatically by `archive-and-create-next` (and can also be triggered
directly via `POST /api/v1/payroll-cycles/:cycleId/backup-packages` once a cycle leaves `DRAFT`).

**Verified contents** (queried directly from `BackupPackageFile`, cross-checked against the
`/api/v1/backup-packages/:id` API response):

| File | Type | Size (bytes) | Checksum present |
|---|---|---|---|
| `manifest.json` | MANIFEST | 1,315 | Yes |
| `payroll-entry.csv` | PAYROLL_ENTRY_CSV | 392 | Yes |
| `payroll-entry.xlsx` | PAYROLL_ENTRY_XLSX | 6,932 | Yes |
| `bank-sheets.csv` | BANK_SHEETS_CSV | 343 | Yes |
| `cash-receiving.csv` | CASH_RECEIVING_CSV | 361 | Yes |

Package status: `READY`. All five files listed in the manifest with a checksum and size matching
their actual stored bytes (this exact invariant is also covered by
`backend/tests/backup-packages.test.ts`, part of the 791/791 backend suite this checkpoint). The
package record and its storage files agree — no orphaned storage objects, no package row missing a
file.

Note: payslips are not a separate file *inside* the Backup Package bundle (they're generated
on-demand per employee, individually or via the batch ZIP endpoint) — the package's own
`payroll-entry.csv`/`.xlsx`, `bank-sheets.csv`, and `cash-receiving.csv` are the durable per-cycle
artifacts; audit information is captured in `AuditLog` (a `backup_package.generated` row, itself
attributed to the acting user), not duplicated into the package files.

## 2. Database backup and restore

**No `pg_dump`/`pg_restore` binaries are bundled with the `embedded-postgres` package used for local
sandbox validation** (only `initdb`, `pg_ctl`, `postgres` ship in
`node_modules/@embedded-postgres/darwin-x64/native/bin`). Real production (Render managed
PostgreSQL, per `docs/architecture/deployment.md`) uses Render's own managed backup/PITR mechanism,
which is logically equivalent to `pg_dump`/`pg_restore` or continuous WAL archiving — this checkpoint
validates the same underlying guarantee (a backup can be restored to a working, data-complete
database) using PostgreSQL's other documented mechanism, a **physical (file-system-level) backup**,
since that's what the available tooling supports in this sandbox.

Commands used (placeholders for paths/credentials — substitute your own):

```bash
# 1. Stop the source Postgres cleanly (a physical backup requires either a stopped server or
#    pg_start_backup/pg_stop_backup bracketing for a live copy — this validation used the simpler,
#    stopped-server form).
pg_ctl -D <PGDATA> stop -m fast

# 2. Copy the full data directory — this is the "backup."
cp -R <PGDATA> <PGDATA_RESTORE_TARGET>

# 3. Restart the source so it isn't left down.
postgres -D <PGDATA> -p 5432 -c "unix_socket_directories=" &

# 4. Start a second instance from the copy, on a different port — this is the "restore," landing in
#    a genuinely separate running database, not just re-reading the original.
rm -f <PGDATA_RESTORE_TARGET>/postmaster.pid   # stale PID reference from the copied, now-stopped process
postgres -D <PGDATA_RESTORE_TARGET> -p 5433 -c "unix_socket_directories=" &

# 5. Point the application at the restored instance and verify.
# DATABASE_URL="postgresql://payroll:<password>@localhost:5433/payroll_clean_rc1?schema=public"
```

**Verification — record counts and financial totals, source vs. restored, before vs. after:**

| Table / measure | Source (:5432) | Restored (:5433) |
|---|---|---|
| Employee | 2 | 2 |
| PayrollCycle | 2 | 2 |
| PayrollEntry | 4 | 4 |
| ProjectSite | 1 | 1 |
| ProjectUnit | 1 | 1 |
| Bank | 5 | 5 |
| User | 1 | 1 |
| CorrectionRequest | 1 | 1 |
| Correction | 1 | 1 |
| BalanceAdjustment | 1 | 1 |
| BackupPackage | 1 | 1 |
| AuditLog | 30 | 30 |
| SUM(PayrollEntry.grossPay) | 160000.00 | 160000.00 |

Identical on every row, byte-for-byte on the financial total.

**Application-level verification against the restored instance** (production build, `NODE_ENV=production`,
pointed at `:5433`):

- Backend started cleanly, `GET /health` → `200`.
- Login (`admin@broomservices.pk`) → `200`, full session/CSRF flow works identically to the source.
- `GET /api/v1/employees` → 2 employees (matches source).
- `GET /api/v1/payroll-cycles` → both cycles present with correct statuses (`2026-08 ARCHIVED`,
  `2026-09 DRAFT`).
- `GET /api/v1/correction-requests` → 1 request (matches source), corrections ledger intact.

**Result: restore succeeded, full data fidelity confirmed.** No release blocker found in this area.

## Scope note

This validates PostgreSQL's own backup/restore mechanics, which Render's managed-Postgres backups
build on. It does not exercise Render's actual managed-backup product (dashboard-triggered restore,
PITR to a specific timestamp) — that remains untested against a real Render environment, consistent
with the same access constraint already on record for the Phase 4 Render deployment condition
(no Render account/API access available in this sandbox).
