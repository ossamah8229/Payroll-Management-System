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

Every feature that produces a **persisted** file — backup packages, company logo/avatar uploads —
depends on this interface only. This is what lets development run entirely on the local filesystem
while production later moves to cloud object storage with no business-logic changes, per the
approved architecture.

**Clarified 2026-07-12 (Phase 4 Checkpoint 6.2's own architecture review) — on-demand PDF
generation does NOT require `StorageProvider`.** This section previously read as if Puppeteer PDF
generation unconditionally depended on `StorageProvider`, which would have implied `StorageProvider`
(not yet built) was a prerequisite for Payslip PDF generation. It isn't: Payslip PDFs are rendered
into an in-memory `Buffer` per request and returned directly in the HTTP response — nothing is
written to disk or object storage, nothing is cached (`backend/src/lib/pdf/`, Checkpoint 6.2).
This is deliberate, not a placeholder: a PDF rendered from a *released* `PayrollEntry` is
provably identical every time it's regenerated (Principle 5/9), so there is no correctness reason
to persist or cache it, and doing so now would mean building `StorageProvider` ahead of the
checkpoint that actually needs it (Phase 5, `BackupPackage`). `StorageProvider` remains load-bearing
for genuinely persisted artifacts — backup packages and uploaded logos/avatars — where the same
"regenerate identically" guarantee doesn't apply. If a future checkpoint (e.g. 6.3's batch
generation, under real measured load) decides a Payslip PDF *cache* is actually justified, that
would go through `StorageProvider` at that time — it does not exist today, and Checkpoint 6.2 does
not depend on it.

**Deletion is restricted and audited.** Generated payroll artifacts persisted via `StorageProvider`
(bank sheets/statements once they exist as stored files, backup packages) are financial records —
deleting one is itself an action that should go through the Audit Log, not a bare storage call
available to any code path. On-demand Payslip PDFs have no delete path to restrict — there is
nothing stored to delete.

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

**Read access to a highly sensitive individual record is also audited, not only mutations —
introduced Phase 4 Checkpoint 6.1 (Payslips, 2026-07-12).** Every other export/download endpoint in
this codebase (Bank Sheets, Cash Receiving, Payroll Entry) audits only the export action itself, not
the plain view. Payslips deliberately go further: `payslip.viewed` is recorded on every successful
single-employee read, not only on a future export/download, because a Payslip exposes one employee's
own net-salary breakdown — a materially more sensitive per-person disclosure than any aggregate sheet
those other endpoints show. The picker/list endpoint (which discloses only names already visible
elsewhere to the same permission holders) is deliberately **not** audited — one entry per actual
disclosure, matching this codebase's existing "one summary entry per operation, not per row" audit
convention. Also new for this same checkpoint: `Cache-Control: no-store` on Payslip responses, a step
beyond the precedent above, justified by the same sensitivity difference.
