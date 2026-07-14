# Payroll Cycle Schema — `PayrollCycle`, `ScheduledPayrollPeriod`, `BackupPackage`, `BackupPackageFile`

**Owner module(s):** Payroll Processing

**Contains:** `PayrollCycle`, `ScheduledPayrollPeriod`, `BackupPackage`, `BackupPackageFile`

**Sections:** §10, §10a, §17–§18 · Full index: `database/README.md`

For the cycle-lifecycle *workflow* (Draft/Released/Archived state transitions, new-cycle creation,
the Payroll Cycle Selector, backup-package generation), see
`docs/architecture/workflows/payroll-lifecycle.md` — this file is the schema only.

---

## 10. `PayrollCycle`

**Purpose:** One calendar month's payroll processing run, and its lifecycle state.
**Why it exists:** Owns the Draft → Released → Archived state machine
(`docs/architecture/workflows/payroll-lifecycle.md §4`) that everything else in the system keys off.
**Business rule tie-in:** Principles 2 and 9; historical viewing (Payroll Cycle Selector) is always
scoped by a `PayrollCycle`.
**Revised 2026-07-05 (Phase 3 architecture review) — release now happens per Project Unit, not
per Cycle directly:** `PayrollEntry.released` (below, `database/payroll-entry.md §12`) is no longer
set by a direct per-employee action — it's now derived, set transactionally the moment every
`ProjectUnit` an entry's work lines touch has its own `PayrollUnitRelease` row
(`database/release.md §12b`) for this cycle. **This section's finalization precondition wording is
unchanged** — "no `PayrollEntry` with `released = false AND hold = false`" — because that flag's
*meaning* didn't change, only what sets it. Finalize Cycle also **stays an explicit, separate Master
User action** on top of per-Unit release completing (confirmed 2026-07-05, not automatic) — a cycle
whose every Unit has released-or-been-held is merely *eligible* to finalize, still shown as `DRAFT`
until a Master User explicitly finalizes it, exactly as today.

**Implemented Phase 5 Checkpoint 1 (2026-07-14):** `POST /api/v1/payroll-cycles/:cycleId/finalize`
(`payroll-processing.service.ts`'s `finalizePayrollCycle`), gated by `payroll-cycle:manage` (the
same permission cycle creation already uses — both are system-lifecycle actions). In one
transaction: re-checks the precondition, atomically flips `status` `DRAFT` → `RELEASED` via an
`updateMany` scoped to `status: 'DRAFT'` (the concurrency backstop — a losing concurrent request's
`updateMany` matches zero rows and reports a clean conflict rather than double-finalizing or writing
a duplicate audit row), sets `releasedAt`/`releasedBy`, and writes exactly one
`payroll_cycle.released` `AuditLog` entry (`cycleId`, `year`, `month`, `entryCount`, `releasedCount`,
`heldCount`). No override parameter exists anywhere in the route or service signature. Finalization
never touches `PayrollEntry.released` — see `database/payroll-entry.md §12`'s corrected Immutability
note for the held-entry-editability rule this checkpoint's own architecture review fixed. Empty
cycles (zero `PayrollEntry` rows) trivially satisfy the precondition and may be finalized. Archiving,
Backup Package generation, and the new-cycle-creation transaction upgrade remain later, separately
authorized Phase 5 checkpoints.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `year` | smallint | no | — | |
| `month` | smallint | no | — | 1–12; **display label (e.g. "April 2026") is computed, never stored** — see `database/schema-invariants.md §22` |
| `status` | `PayrollCycleStatus` | no | `'DRAFT'` | |
| `sourceCycleId` | uuid | yes | — | FK → `PayrollCycle.id` (self), `ON DELETE RESTRICT` — the cycle this one was carried forward from, for traceability |
| `createdAt` | timestamptz | no | `now()` | |
| `createdBy` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` |
| `releasedAt` | timestamptz | yes | — | set when status → `RELEASED` |
| `releasedBy` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT` |
| `archivedAt` | timestamptz | yes | — | set when status → `ARCHIVED` |
| `archivedBy` | uuid | yes | — | FK → `User.id`, `ON DELETE RESTRICT`; null if the archive was a fully automatic system action |

- **Unique constraints:** (`year`, `month`) — one cycle per calendar month, ever
- **Check constraints:** `month BETWEEN 1 AND 12`
- **Indexes:** unique(`year`, `month`); (`status`) — the "which cycle is currently Draft" lookup is
  hot and should be a fast partial index `WHERE status = 'DRAFT'` (also enforces, together with
  application logic, that only one cycle is ever Draft)
- **Cascade:** all FKs `RESTRICT` — a cycle and the users who acted on it are never deleted out from
  under this record
- **Module owner:** Payroll Processing
- **Finalization precondition (`DRAFT` → `RELEASED`):** enforced at the application/service layer as
  a cross-row check inside the same transaction as the status update — the transition is refused
  unless zero `PayrollEntry` rows in this cycle have `released = false AND hold = false`. This cannot
  be expressed as a single-row `CHECK` constraint since it spans every entry in the cycle. **There is
  no Master User override**: a cycle with unreleased, non-held stragglers cannot be finalized until
  they are released or held. Employees left on `hold` do not block finalization and may remain
  outstanding indefinitely. **A Late Entry (`database/release.md §12b`) does not block finalization
  either** if it's still awaiting its own one-off release — it behaves like an unreleased-and-non-held
  entry for this precondition's purposes, same as any other straggler, with no special exception.
- **Immutability:** the row itself (status/timestamps) is updated exactly three times over its
  lifetime (created → released → archived); **once `ARCHIVED`, no column on this row changes again**
- **Transactions required:** yes — every status transition is a multi-table transaction (see
  `database/schema-invariants.md §22`)
- **Row count:** one per month — trivially small (~12/year)

## 10a. `ScheduledPayrollPeriod`

**Added 2026-07-08, pre-Checkpoint-2 architecture amendment (Advance Deduction Deferral).** The
canonical way any module references a calendar payroll period that does not yet have a materialized
`PayrollCycle` row — introduced specifically so the Advance Deduction Deferral rule (§15's BR-ADV
rules, `database/advances.md §15`) never needs a second, competing representation of "a payroll
cycle." `PayrollCycle` remains the only entity with real cycle identity and lifecycle (status,
entries, release); this table is deliberately thin — no status, no lifecycle, no entries — purely a
calendar coordinate that resolves into a `PayrollCycle` once one is created for it.
**Why it exists:** Only one `PayrollCycle` is ever `DRAFT` at a time
(`docs/architecture/workflows/payroll-lifecycle.md §4`), and future cycles do not exist as rows until
the ordinary sequential "Start New Payroll Cycle" bootstrap reaches them. A business rule that needs to
reference an arbitrary future month (not just "next cycle") has nothing to point a foreign key at
until that month's cycle actually exists. Rather than let each consumer (Advances today, any future
Outstanding Payroll Obligation provider tomorrow —
`docs/architecture/workflows/outstanding-obligations.md`) invent its own raw `(year, month)` scalar
pair to work around this — which would recreate exactly the two-competing-representations problem this
table exists to avoid — every such reference goes through this one table instead.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `year` | smallint | no | — | |
| `month` | smallint | no | — | 1–12 |
| `payrollCycleId` | uuid | yes | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` — **null until a `PayrollCycle` is actually created for this `(year, month)`**, set exactly once, never again |
| `resolvedAt` | timestamptz | yes | — | set in the same instant `payrollCycleId` is set |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** `(year, month)` — the same shape as `PayrollCycle`'s own uniqueness (§10);
  two different consumers referencing the same future month share exactly one row, never two
- **Check constraints:** `month BETWEEN 1 AND 12`
- **Indexes:** unique(`year`, `month`); partial index `WHERE payrollCycleId IS NULL` (the
  "still-pending periods" lookup the cycle-bootstrap resolution step needs every time a new cycle is
  created — see `docs/architecture/workflows/payroll-lifecycle.md §4`)
- **Cascade:** `payrollCycleId` is `RESTRICT`
- **Module owner:** Payroll Processing — the same module that owns `PayrollCycle` and the cycle
  bootstrap logic that resolves these rows. Every consuming module (Advances today; a future module
  tomorrow) only ever holds a foreign key into this table; none of them owns it.
- **Ownership boundary — explicit clarification (added 2026-07-09, no schema/workflow/behavioral
  change):** `ScheduledPayrollPeriod` is infrastructure owned **exclusively** by Payroll Processing —
  the same "modules interact through each other's service-layer functions, never by reaching directly
  into another module's database tables" discipline `docs/architecture/overview.md` already states for
  this codebase generally. Domain modules (Advances today; any future Outstanding Payroll Obligation
  provider) may **reference** a `ScheduledPayrollPeriod` row via foreign key, but must never create,
  resolve, mutate, or delete one directly — there is no code path in any domain module that writes to
  this table itself. When a domain module needs a period that may not exist yet (e.g. Advances at the
  moment of a deferral, `database/advances.md §15a`), it calls Payroll Processing's own exposed
  find-or-create function rather than touching the table directly — the row is still created lazily,
  exactly as already described below, only ever performed by Payroll-Processing-owned code, whether
  that code is invoked by its own cycle bootstrap or by another module's request. **Resolution**
  (`payrollCycleId`/`resolvedAt`, `NULL → NOT NULL`) remains, as already specified, exclusively a
  cycle-creation-time step — no other code path ever performs it.
- **Creation:** lazily, find-or-create by `(year, month)` — performed only by Payroll Processing's own
  function (per the ownership boundary above), the first time anything needs to reference that future
  month (an Advance's very first schedule, or a schedule change) — never pre-created in bulk for months
  nobody has referenced yet. The unique constraint is the concurrency backstop: two consumers
  referencing the same future month at the same instant race on find-or-create, one wins, the other
  finds the row the winner just created.
- **Resolution (one-time transition):** when a new `PayrollCycle` is created for `(Y, M)`
  (`docs/architecture/workflows/payroll-lifecycle.md §4`), the bootstrap looks up
  `ScheduledPayrollPeriod WHERE (year, month) = (Y, M)` **first, before invoking any registered
  Outstanding Payroll Obligation provider** and, if found, sets `payrollCycleId`/`resolvedAt` — a
  single, generic step owned by Payroll Processing that has no knowledge of which module(s), if any,
  reference that period. If no row exists for `(Y, M)`, there is nothing to resolve and ordinary cycle
  creation proceeds unaffected.
- **Immutability — explicit invariant (strengthened 2026-07-08):** `year` and `month` are immutable
  from the moment a row is created — there is no code path, application-layer or otherwise, that ever
  changes which calendar period a `ScheduledPayrollPeriod` row identifies. **The only permitted state
  transition on this table is `payrollCycleId`/`resolvedAt` moving `NULL → NOT NULL`, exactly once** —
  the same single-permitted-transition pattern already used for `CorrectionRequest`
  (`database/corrections.md §13a`). Once created, a `ScheduledPayrollPeriod` row represents a permanent
  payroll identity: which specific calendar month it names never changes, only whether that month has
  since acquired a real `PayrollCycle`.
- **Deletion:** never, under any circumstance, once referenced by any payroll obligation —
  `originalScheduledPeriodId`/`currentScheduledPeriodId` (`database/advances.md §15`) and
  `fromPeriodId`/`toPeriodId` (`database/advances.md §15a`) are all `ON DELETE RESTRICT`, so the
  database itself refuses to delete a referenced row. This holds **even after the row resolves and its
  `PayrollCycle` completes and archives** — a resolved period is not "done" and eligible for cleanup;
  it becomes a permanent part of payroll history (which month an advance was originally due, which
  months it passed through before finally landing) and exists for auditability exactly as
  EmployeeTransferHistory/BalanceAdjustmentSettlement rows do (`database/employee.md §8b`,
  `database/balance-adjustments.md §14b`) — never pruned, never reused for a different calendar month
  later.
- **RBAC:** no direct RBAC surface — this table is never independently created, viewed, or edited by a
  user action; rows exist only as a side effect of another module's own scheduling workflow
  (`database/advances.md §15`), and are resolved only by the cycle-bootstrap process itself.
- **Row count:** small — bounded by the number of distinct future months anything has ever referenced,
  not by employee or advance count; realistically a handful to low dozens of rows even at scale, since
  schedule changes are rare and the granularity is a calendar month, not a per-employee or per-advance
  record.

---

## 17. `BackupPackage`

**Purpose:** The disaster-recovery/external-access artifact for one payroll cycle.
**Why it exists:** `docs/architecture/workflows/payroll-lifecycle.md §5`. **Never a data source for
in-app historical viewing** — that always comes from Postgres directly.

**Implemented Phase 5 Checkpoint 2 (2026-07-14), amended from the sketch this section previously
carried** — the architecture review found the original sketch (below the amendment note)
under-specified for authenticated download, in-flight/failed generation, and actor attribution, and
added `status`, `generatedBy`, and `failureReason`. Generation is **manually triggered only** this
checkpoint (`POST /api/v1/payroll-cycles/:cycleId/backup-packages`, Master-Admin-only via
`payroll-cycle:manage`) — automatic generation on the cycle archive transition remains later,
separately-authorized Phase 5 work; this checkpoint builds the generator that later work will call.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `version` | integer | no | `1` | reserved atomically as `MAX(version) + 1` inside the same transaction that creates this row — never client-supplied; increments on every regeneration (a later correction against an archived cycle, or a manual retry), never overwritten |
| `status` | `BackupPackageStatus` | no | `GENERATING` | `GENERATING` → exactly one of `READY`/`FAILED`, never changes again after that |
| `generatedAt` | timestamptz | yes | — | set only on the `GENERATING → READY` transition |
| `generatedBy` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — the actor who triggered generation, matching `PayrollCycle.createdBy`/`.releasedBy`'s own convention |
| `applicationVersion` | varchar(40) | no | — | deployed app release identifier at generation time (`backend/package.json`'s own `version` field — this project does not yet bump it per deploy, a known, accepted limitation) |
| `databaseSchemaVersion` | varchar(60) | no | — | the latest applied Prisma migration name at generation time, read from Prisma's own `_prisma_migrations` table |
| `releaseStatusSummary` | jsonb | no | — | released/held counts at generation time, computed identically to Finalize Cycle's own `payroll_cycle.released` audit metadata shape |
| `totalSizeBytes` | bigint | yes | — | nullable until `READY` |
| `fileCount` | integer | yes | — | nullable until `READY` |
| `manifestChecksum` | varchar(64) | yes | — | SHA-256 hex of the manifest's own canonical-JSON bytes; nullable until `READY` |
| `failureReason` | text | yes | — | set only when `status = FAILED` — a short, non-sensitive diagnostic (the failing error's class name, never its raw message/stack/SQL detail/filesystem path) |
| `createdAt` | timestamptz | no | `now()` | |
| `updatedAt` | timestamptz | no | (auto) | |

- **Unique constraints:** (`cycleId`, `version`)
- **Indexes:** unique(`cycleId`, `version`); (`cycleId`); (`status`)
- **Cascade:** `cycleId` and `generatedBy` are both `RESTRICT`
- **Module owner:** Payroll Processing (this checkpoint's own module, `backup-packages.service.ts`) via
  the storage abstraction (`docs/architecture/system-conventions.md §2`)
- **Immutable, append-only** with exactly one permitted transition per row (`GENERATING` →
  `READY`/`FAILED`); a `FAILED` row is never retried in place — a fresh attempt reserves a brand new
  version
- **Invariant:** a `BackupPackage` is either `READY` (fully generated, downloadable, exactly `fileCount`
  `BackupPackageFile` rows exist) or it is not a usable domain record (`GENERATING`/`FAILED` are never
  exposed as downloadable by list/detail/download)
- **Row count:** ~1/month, occasionally more when a correction against an archived cycle triggers a
  new version, or an operator manually regenerates

## 18. `BackupPackageFile`

**Purpose:** One physical stored file within a `BackupPackage`.
**Why it exists:** Modeled as its own table rather than hardcoded columns on `BackupPackage`, so a
future artifact type is a new row type, not a new column (Principle 8).

**Implemented Phase 5 Checkpoint 2, amended from the sketch this section previously carried** —
`filename`, `contentType`, `checksum`, and `sortOrder` were added: a safe, sanitized download
filename distinct from the (untrusted) `storageKey`; a `Content-Type` response header
(`StorageProvider` itself never retains this after `write()`); per-file SHA-256 integrity
verification; and deterministic listing/manifest order.

**Approved content, this checkpoint (docs/architecture/workflows/payroll-lifecycle.md §5):**
`manifest.json`, Payroll Entry CSV, Payroll Entry XLSX, one combined Bank Sheets CSV (every active
Bank plus Cash), Cash Receiving CSV — five rows per package version, always. Payslip PDFs and an
Audit Log export were both evaluated in the 2026-07-14 architecture review and explicitly deferred.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `backupPackageId` | uuid | no | — | FK → `BackupPackage.id`, `ON DELETE RESTRICT` |
| `fileType` | `BackupFileType` | no | — | `MANIFEST` \| `PAYROLL_ENTRY_CSV` \| `PAYROLL_ENTRY_XLSX` \| `BANK_SHEETS_CSV` \| `CASH_RECEIVING_CSV` |
| `filename` | text | no | — | e.g. `payroll-entry.csv` — always one of five fixed, server-generated values, never derived from user input |
| `storageKey` | text | no | — | key/path resolved via the `StorageProvider` abstraction, under `backups/{cycleId}/v{version}/{filename}` — never exposed to API clients directly; every download is authorized and resolved through this row's own `id` |
| `contentType` | text | no | — | echoed back on download (`StorageProvider.write()` does not persist this itself) |
| `sizeBytes` | bigint | no | — | |
| `checksum` | varchar(64) | no | — | SHA-256 hex, computed from the exact bytes written to storage |
| `sortOrder` | integer | no | — | deterministic order — `manifest.json` is always `0`, then the four data files in the fixed order the service always generates them in |
| `createdAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`backupPackageId`, `fileType`)
- **Indexes:** (`backupPackageId`)
- **Cascade:** `RESTRICT`
- **Module owner:** Payroll Processing
- **Immutable, append-only** — a regenerated package is always a new `BackupPackage` version with its
  own new `BackupPackageFile` rows, never an edit to an existing one's rows

---
