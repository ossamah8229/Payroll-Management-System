# Data, Storage, and History Architecture

Covers: primary key strategy, the file storage abstraction, immutable audit logging, and the payroll
cycle lifecycle / backup package strategy. This document governs schema design before scaffolding
begins.

---

## 1. Primary Keys — UUID

All major entities use UUID primary keys, generated at the database layer (Postgres
`gen_random_uuid()`, matching Prisma's `@default(uuid())`), rather than auto-increment integers:

`Employee, PayrollCycle, PayrollEntry, User, ProjectSite, Correction, Advance, AuditLog`,
and, for consistency, every other application-owned table (`Role`, `Permission`,
`BalanceAdjustment`, `BackupPackage`, `CompanySettings`, etc.).

**Why:** sequential integer IDs leak information (row counts, creation order) and collide easily
across import/export/merge operations — a real risk here given CSV/Excel import is a first-class
workflow. UUIDs also let records be safely referenced in exported files, backup packages, and audit
log entries without depending on a live database sequence.

The one exception is the `express-session` / `connect-pg-simple` session table, whose schema is
dictated by that library, not by this rule.

---

## 2. Storage Abstraction Layer

Generated files (PDFs, Excel exports, backup packages, uploaded logos/avatars) are never written
directly to `fs` or a cloud SDK from business logic. All file I/O goes through a single
`StorageProvider` interface:

```
StorageProvider
  save(key, data, contentType)   -> StorageRef
  read(key)                      -> Buffer
  getUrl(key)                    -> string        // signed URL in cloud impl, local path/route in dev
  delete(key)                    -> void           // restricted; see audit note below
  list(prefix)                   -> StorageRef[]
```

**Implementations:**
- `LocalFilesystemStorageProvider` — development default. Writes under a project-local storage
  directory (e.g. `backend/storage/`), served back via a simple authenticated route for local use.
- Cloud implementation (e.g. S3 or R2-backed) — introduced when production hosting is finalized.
  Selected via configuration/environment variable; business logic that calls `StorageProvider` never
  changes when the implementation swaps.

Every feature that produces a file — Puppeteer PDF generation, ExcelJS exports, backup packages,
company logo/avatar uploads — depends on this interface only. This is what lets development run
entirely on the local filesystem while production later moves to cloud object storage with no
business-logic changes, per the approved architecture.

**Deletion is restricted and audited.** Generated payroll artifacts (payslips, bank sheets, backup
packages) are financial records — deleting one is itself an action that should go through the Audit
Log, not a bare storage call available to any code path.

---

## 3. Immutable, Append-Only Audit Log

The Audit Log is a permanent record. Application code has no code path that updates or deletes an
audit row — only `auditLog.record(...)`, an insert.

This is enforced at two layers, deliberately redundant (defense in depth — an application-layer rule
alone is one bug away from being violated):

1. **Application layer:** no service function exists to modify or remove an audit entry. Code review
   should treat any such function as an automatic rejection.
2. **Database layer:** the application's database role has `UPDATE`/`DELETE` privileges revoked on
   the `audit_log` table, and/or a `BEFORE UPDATE OR DELETE` trigger raises an exception. This
   protects against future bugs, ad hoc scripts, or a raw query bypassing the service layer.
   *(Revised 2026-07-04: the trigger carves out exactly one permitted UPDATE — the
   `actorUserId` NOT NULL → NULL transition produced by that FK's documented `ON DELETE SET NULL`
   action, with all other columns unchanged — because the original unconditional trigger made any
   `User` with audit history undeletable, contradicting `database-schema.md` §16's explicit FK
   design. See §16's matching revision note.)*

**Every financial mutation writes its audit entry in the same database transaction as the change
itself** — release, hold, correction (including a zero-net-difference correction — see
`docs/architecture/post-release-corrections.md`), balance adjustment created/settled, advance
recorded, advance balance reconciled by a correction, cycle status transition (Released, Archived),
employee record created/updated (including a site transfer, bank-detail change, or a departure being
recorded), user/role/site-assignment changes, company settings changes. If the transaction fails,
neither the change nor its audit entry persists — there is no state where a financial change exists
without a corresponding audit record, and there is no entity in the system whose mutations are exempt
from this list.

---

## 4. Payroll Cycle Lifecycle & Historical Access

### When the Correction workflow applies

This is the single trigger condition referenced everywhere in this document set — stated once here,
authoritatively, and never rephrased differently elsewhere:

> **A `PayrollEntry` requires the Correction workflow whenever the `PayrollEntry` has been
> individually released, OR its parent `PayrollCycle` is no longer in Draft.**

This is an OR across two independent granularities that both matter: an individually-released
employee is locked immediately, even while the rest of the cycle is still `Draft` (the original,
spec-verified rule); and once the cycle itself leaves `Draft` (Released or Archived), every entry in
it is locked regardless of whether that specific employee was ever individually released. Any
document or table that previously said "a Released or Archived cycle" as the trigger is describing
only the second half of this condition and should be read as shorthand for the full statement above.

### Cycle states

```
Draft (Open)
     ↓
 Released
     ↓
Archived (Locked)
```

- **Draft (Open)** — the current, in-progress cycle.
  - Payroll editing is allowed (all Payroll Entry fields, per employee) for any entry not yet
    individually released.
  - Employee release is allowed (per-employee release, or bulk Release All/Hold All scoped by site).
  - Reports (Dashboard, Fines & EOBI Report, progress bars) continue updating live as figures change.

- **Released** — the cycle as a whole has been finalized by an explicit Master Admin action
  ("Finalize Payroll Cycle"), not automatically and not as a side effect of any other action.
  - **Finalization precondition, strictly enforced, with no override:** the cycle cannot transition
    from `Draft` to `Released` while any `PayrollEntry` in it has `released = false AND hold = false`
    — i.e., every employee who could be released has been. Employees left `hold = true` are
    explicitly exempted from this precondition and may remain outstanding indefinitely; they do not
    block finalization. **There is no Master Admin override of this precondition.** A cycle with
    unreleased, non-held stragglers simply cannot be finalized until they are released or held — this
    is deliberate: Corrections exist for genuine post-release discoveries, not as a shortcut around
    finishing the month's release work.
  - Once `Released`, payroll is finalized — ordinary field edits no longer apply to any entry in this
    cycle (see the trigger condition above: the cycle is no longer Draft, so every entry in it now
    requires the Correction workflow, including any entry that happened to never be individually
    released — though finalization guarantees no such non-held entry exists).
  - Corrections are allowed, per Principle 9.
  - Balance Adjustments are generated from approved corrections (see
    `docs/architecture/post-release-corrections.md`) rather than the original figures being changed.
  - The original released payroll record remains unchanged, permanently (Principle 9).
  - "Start New Payroll Cycle" is only available once the current cycle is `Released` — attempting to
    start a new cycle while the current one is still `Draft` is blocked with a message to finalize it
    first.

- **Archived (Locked)** — triggered automatically the moment a new payroll cycle is created.
  - The entire cycle becomes historical and fully read-only.
  - Archived cycles continue to accept Corrections indefinitely (a dispute or discovered error
    doesn't have an expiry) — per the trigger condition above, this was already true the moment the
    cycle became `Released`; `Archived` doesn't change the correction-eligibility rule, only the
    cycle's own visibility/historical status. What never happens, in either state, is the historical
    `PayrollEntry` record itself being edited. Every approved Correction against a Released or
    Archived cycle creates a Balance Adjustment, which is always settled inside the *currently active
    Draft* cycle — never by writing back into the original cycle's own figures, and never by
    reopening it. See `docs/architecture/post-release-corrections.md` for the full settlement
    workflow.
  - A backup package is automatically generated for the cycle being archived (§5).

Only one cycle is ever in `Draft` state at a time.

### New Cycle Creation & Employee Selection

Creating a new cycle requires the current cycle to already be `Released` (above) and, in one
transaction: transitions the current cycle to `Archived`, generates its backup package (§5), and
creates the new `Draft` cycle's `PayrollEntry` rows.

**Which employees get a new `PayrollEntry`:** the union of (a) every currently active employee
(`dateOfLeaving IS NULL`), and (b) any employee — active or departed — who has at least one `PENDING`
`BalanceAdjustment`. (b) exists specifically so a departed employee's pending balance is never
stranded: since Balance Adjustments settle automatically only through a Draft cycle's `PayrollEntry`
(`docs/architecture/post-release-corrections.md`), a departed employee with an outstanding balance
must still receive a `PayrollEntry` in the new cycle — with all earning/attendance fields at zero — so
the automatic settlement pipeline can pay it out through the ordinary release action, exactly as for
any other employee. Such an entry is visually flagged in the UI (a computed "Final Settlement"
indicator, not a stored field — see `docs/design-system.md`) so it never reads as an active
employee's ordinary monthly pay.

Carried-forward fields for continuing employees (gross pay, cycle days, OT/leave rate overrides, EOBI
amount/applicability, site/bank/designation as of the source cycle) follow the same copy-at-creation
rule as any new `PayrollEntry` — see `docs/architecture/database-schema.md` §12.

### Payroll Cycle Selector

Users can open and view **any** previous cycle at any time, in whichever state it's in — Payroll
Entry, Release status, Bank Sheets, Cash Sheets, Payslips, and Statements as they existed for that
cycle. Every such view is scoped by `cycleId` and reads live from PostgreSQL. Editability of what's
shown follows the trigger condition above: an entry is editable only if it hasn't been individually
released **and** its cycle is still `Draft`; otherwise, changes only via Correction.

**Historical viewing inside the application always comes from PostgreSQL — never from a backup
package.** Backup packages (below) exist for disaster recovery and external/offline access only. This
distinction is intentional and must not be blurred: if PostgreSQL is the record of truth, any code
path that renders historical data from a backup file instead is a bug, even if it happens to produce
the same numbers today.

---

## 5. Backup Packages

When a cycle transitions to `Archived` (i.e., the moment a new cycle is created — see §4), the
system automatically generates a backup package for the cycle being archived.

**Contents:**
- Payroll CSV — full Payroll Entry data for the cycle, matching the existing Payroll Entry
  import/export column set.
- Bank Sheets CSV — the released, non-held, bank-account-holding employees for the cycle, one row
  per employee, using the same combined payment amount (net salary ± any settling Balance
  Adjustments) as the in-app Bank Sheet — see
  `docs/architecture/post-release-corrections.md` ("Representation in Bank Sheets, Cash Sheets, and
  Payslips"). The backup must never diverge from what the in-app sheet showed.
- Receivings CSV — the same, for released, non-held, cash-payment employees (Cash Receiving Sheet
  data).
- `metadata.json`, containing:
  - Cycle month/label and release-status summary (released / held / pending counts)
  - **Application Version** — the deployed app release/build identifier at generation time
  - **Database Schema Version** — the applied Prisma migration identifier at generation time
  - **Backup Version** — this package's own version number (see Versioning, below)
  - **Generated Timestamp** — when the package was produced

  Capturing application and schema version alongside the data itself means a backup package is
  self-describing: restoring or auditing it later doesn't require guessing which code/schema version
  produced it.

**Storage:** written through the `StorageProvider` abstraction (§2) — local filesystem in
development, swappable to cloud object storage in production without touching the generation logic.

**Versioning:** a backup package's `Backup Version` increments if it is regenerated for a cycle that
has already been archived — which happens when a correction is later approved against that
historical cycle's data (see `docs/architecture/post-release-corrections.md`). Each version is
retained, not overwritten; the package itself follows the same "never overwrite history" rule as the
database.

**Purpose boundary:** backup packages are for disaster recovery and external handoff (e.g. giving the
client an offline copy, or restoring from a catastrophic failure) — they are not, and must never
become, a data source for any in-application feature.
