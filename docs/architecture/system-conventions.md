# System-Wide Conventions

**Owner module(s):** Cross-cutting

**Contains:** Primary-key strategy; the file-storage abstraction; Audit Log immutability policy

**Sections:** §1–§3 (own sequence, inherited from the former `data-and-storage.md` — distinct from
`database/`'s §0–§26 range; always cite the filename) · Full database index: `database/README.md`

This document governs schema design before scaffolding begins, alongside `docs/PROJECT_PRINCIPLES.md`
and the rest of `docs/architecture/`. For the entity-level schema these conventions apply to, see
`database/`; for the Audit Log's *schema*, see `database/audit-log.md §16`.

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
   `User` with audit history undeletable, contradicting `database/audit-log.md §16`'s explicit FK
   design. See §16's matching revision note.)*

**Every financial mutation writes its audit entry in the same database transaction as the change
itself** — release, hold, correction (including a zero-net-difference correction — see
`docs/architecture/workflows/corrections-and-balance-adjustments.md`), balance adjustment
created/settled, advance recorded, advance balance reconciled by a correction, cycle status
transition (Released, Archived), employee record created/updated (including a site transfer,
bank-detail change, or a departure being recorded), user/role/site-assignment changes, company
settings changes. If the transaction fails, neither the change nor its audit entry persists — there
is no state where a financial change exists without a corresponding audit record, and there is no
entity in the system whose mutations are exempt from this list.
