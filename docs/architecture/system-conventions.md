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
`StorageProvider` interface.

**Implemented 2026-07-14 (Phase 5 Checkpoint 0) — supersedes the design sketch this section
previously carried.** The interface below is what actually shipped
(`backend/src/lib/storage/storage-provider.ts`), scoped to Phase 5's concrete needs rather than the
earlier speculative sketch (which included `getUrl` and `list`, neither of which any real consumer
needs yet):

```
StorageProvider
  write(key, data: Buffer | ReadableStream, options?: { contentType })  -> StorageObjectMetadata
  read(key)                                                             -> Buffer
  createReadStream(key)                                                 -> ReadableStream
  exists(key)                                                           -> boolean
  delete(key)                                                           -> void
```

No signed URLs, multipart upload, bucket/container exposure to domain code, CDN behavior, ACLs,
provider-specific ETags, or lifecycle policies — deliberately excluded as speculative ahead of a
real need (Principle 8's spirit applied to this interface, not just the database schema); any
future implementation adds these behind the interface if a real consumer ever needs them, without
changing what domain modules call. Overwrite policy: last-writer-wins, published atomically (a
concurrent reader never observes a partially-written file) — a caller that needs "never overwrite"
semantics (e.g. a versioned `BackupPackage`) chooses a unique key per version itself; the interface
does not enforce key uniqueness. `delete` is idempotent — deleting a missing key succeeds silently,
matching common cloud-object-storage (e.g. S3) semantics, so a future cloud implementation never has
to fake a not-found error just to match local behavior. Storage keys are treated as untrusted at the
provider boundary even when application-generated — validated against traversal, absolute paths,
backslashes, null bytes, empty segments, and containment (including a defense-in-depth symlink
check) before any filesystem operation is attempted (`backend/src/lib/storage/safe-path.ts`).

**Implementations:**
- `LocalFilesystemStorageProvider` (`backend/src/lib/storage/local-filesystem-storage-provider.ts`)
  — the only implementation today; suitable for both local development and a self-hosted production
  deployment with no cloud object storage (§3 item 13's portability requirement — this codebase is
  not assumed to run on any specific host or cloud provider). Writes under a configured root
  directory (`STORAGE_ROOT`, default `backend/storage/` in development, gitignored), created
  automatically if missing, via an atomic temp-file-then-rename publish. **Not yet served back by
  any HTTP route** — `read`/`createReadStream` exist at the provider layer only; the authenticated,
  user-facing download endpoint is deferred to the `BackupPackage` checkpoint (Phase 5), the first
  checkpoint with a real domain record to authorize a download against. The storage root itself is
  never served via Express static middleware. **Permissions, verified 2026-07-14**: every directory
  (the root itself and every nested directory a key's path implies) is created with explicit
  owner-only `0o700`; every object file is written with explicit owner-only `0o600` — an explicit
  mode, not the deploying environment's umask, is what guarantees this, confirmed to apply
  recursively on this platform. The containment baseline is the storage root's *real* (symlinked-
  resolved) location, established once at construction, so a configured root that is itself a
  symlink is handled correctly, not merely a root whose subdirectories might later become one.
  Every thrown error names the caller-supplied key, never an absolute filesystem path, in its own
  `message` — see `backend/src/lib/storage/errors.ts`'s log-hygiene note on `StorageIOError.cause`
  for the one field that still carries a raw underlying filesystem error (kept for local debugging,
  not meant to be logged wholesale).
- **`R2StorageProvider` (`backend/src/lib/storage/r2-storage-provider.ts`) — implemented Phase 7C.**
  An S3-compatible implementation backed by Cloudflare R2, satisfying the exact same five-method
  interface with no caller-visible difference from `LocalFilesystemStorageProvider`. Selected via
  `STORAGE_PROVIDER=r2` (env var, `backend/src/config/env.ts`; `local` remains the default) — the
  one place this selection happens is `lib/storage/index.ts`'s `createStorageProvider()`; no module
  that imports `storageProvider` branches on which implementation is active, confirming the
  "business logic never changes when the implementation swaps" promise this section always made.
  Requires five R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME`, `R2_ENDPOINT`) — enforced present together via the env schema's own
  `.superRefine`, so a misconfigured `STORAGE_PROVIDER=r2` fails at startup, never mid-request. The
  R2 bucket itself stays **private** — this interface still has no signed-URL/public-URL concept
  (deliberately, per this section's own "no signed URLs... deliberately excluded as speculative"
  rule above, which still holds); a route that needs to expose an object's bytes to an unauthenticated
  browser (e.g. the Company Logo public routes, `modules/settings/company-logo-public.routes.ts`)
  reads through `storageProvider.read()`/`createReadStream()` as any other caller would and proxies
  the bytes itself — the interface was never extended, only used exactly as designed.

Every feature that produces a **persisted** file — backup packages, company logo/avatar uploads —
depends on this interface only. This is what let development run entirely on the local filesystem
while production later moved to cloud object storage with no business-logic changes, per the
approved architecture (`STORAGE_PROVIDER=r2` still needs to be explicitly configured per-environment
— see `docs/release/KNOWN_ISSUES_v1.0.md` KI-3 and `docs/release/CONFIGURATION_REFERENCE.md`).

**Cross-system atomicity (Phase 5 Checkpoint 0 architecture decision — implemented Phase 5
Checkpoint 2, `backup-packages.service.ts`'s `generateBackupPackage`).** A backup package's
generation spans two systems — PostgreSQL and `StorageProvider` — that cannot share one
transaction. The implemented ordering: reserve the next version (a `GENERATING` `BackupPackage` row,
inside its own transaction, before any storage write — the concurrency backstop, see
`docs/architecture/database/payroll-cycle.md §17`) → assemble every file's content in memory → write
all five storage objects → one final PostgreSQL transaction (insert every `BackupPackageFile` row,
flip the package to `READY`, write the audit entry) → commit. If anything fails after the version
was reserved, this attempt's own already-written storage objects are best-effort deleted and the
reserved row is marked `FAILED` with a short, non-sensitive diagnostic — this is accepted as
non-blocking: a late failure may leave a temporarily unreferenced storage object, but must never
leave a `BackupPackage` row falsely reporting `READY` (Principle 2). Checkpoint 2 generates
**synchronously, within the HTTP request** — with Payslip PDFs deferred (see
`docs/architecture/workflows/payroll-lifecycle.md §5`), the entire generation cost is CSV/XLSX
building plus a handful of SHA-256 hashes, sub-second even at Principle 10's 10,000-employee design
floor; no queue or background-job mechanism was introduced. **The archive-transition trigger this
ordering was originally scoped for is implemented, Phase 5 Checkpoint 3 (2026-07-15)** —
`archiveAndCreateNextPayrollCycle` (`payroll-processing.service.ts`) calls the same generator
Checkpoint 2 built, refactored into four composable phases (reserve → assemble → write storage →
final commit) so the fourth phase, `commitBackupPackageReady`, can run inside rollover's own larger
transaction (which also archives the outgoing cycle, creates the next Draft, and bootstraps it)
instead of opening its own — the one shape change this required, with zero behavior change for
manual generation's own call site. Rollover always generates a fresh version, never reuses an
earlier `READY` one — see `docs/architecture/workflows/payroll-lifecycle.md §5`.

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

**Resolved 2026-07-13 (Phase 4 Checkpoint 6.3) — batch generation did not end up needing a cache or
`StorageProvider` either.** The speculative note above is now closed: Checkpoint 6.3's batch/ZIP
endpoint streams each Payslip PDF directly into the HTTP response as it's rendered
(`archiver` piped straight to `res`), with bounded render concurrency, not a persisted or cached
artifact. Under the measured load this checkpoint actually tested (up to the enforced 300-employee
cap), a cache was not justified — the same "regenerate identically from a released `PayrollEntry`"
guarantee that let Checkpoint 6.2 skip `StorageProvider` still holds. `StorageProvider` remains
Phase 5's own prerequisite (`BackupPackage`), unchanged by this checkpoint.

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

## 4. API Response Serialization — No Raw Prisma Model

**No HTTP route may return a raw Prisma model or relation object. Every API response containing
users, payroll, financial data, or storage metadata must be assembled through an explicit DTO.**

Established as a permanent convention 2026-07-16 (Phase 5 Checkpoint 4 security correction), after a
confirmed defect: `backend/src/modules/users/users.service.ts`'s `listUsers`/`getUser`/`createUser`/
`updateUser` called `prisma.user.findMany()`/`findUnique()`/`create()` with no `select`, and each of
`GET /api/v1/users`, `GET /api/v1/users/:id`, `POST /api/v1/users`, and `PATCH /api/v1/users/:id`
returned that raw row straight into `res.json({ user })`/`{ users }` — including `passwordHash`. Not
a Phase 5 Checkpoint 4 regression (the routes predate it), but found and fixed during Checkpoint 4's
final review. A companion review of every Payroll Cycle/Backup Package/Salary Release response this
codebase exposes (`GET/POST /payroll-cycles`, finalize, rollover, Backup Package list/detail, the
Salary Release unit-status payload) found those already clean — none of them fetch or return a raw
`User` relation; `PayrollCycle.createdBy`/`releasedBy`/`archivedBy` are plain scalar FK strings, and
the one place that does look up a `User` relation (`payroll-release.service.ts`'s
`getUnitReleaseStatus`, `include: { releasedBy: true }`) already narrows it to `{ id, name }` before
it's ever returned — a correct precedent this convention formalizes retroactively, not a new pattern.

**The fix, and the standing rule going forward:**

1. **Fetch narrow.** Use Prisma's `select` (not `include`) so a sensitive column is never pulled out
   of the database for a read path that doesn't need it — not merely stripped from the object after
   the fact. `users.service.ts`'s `USER_SUMMARY_SELECT` is the reference example.
2. **Assemble explicitly.** Build the response shape as a plain object literal naming every field,
   the same pattern `auth.service.ts`'s `loadSessionUser` (returning `SessionUser`, never a raw
   `User`) and `payroll-release.service.ts`'s `getUnitReleaseStatus` (`releasedBy: { id, name }`)
   already established — Checkpoint 4's fix brings the Users module in line with a pattern the rest
   of the codebase already followed, not a new one.
3. **Never expose:** `passwordHash`, any other authentication secret, session/CSRF internals, a raw
   storage key (`BackupPackageFile.storageKey` — already stripped by `backup-packages.routes.ts`'s
   `serializeBackupPackage`, the other pre-existing correct precedent), an absolute filesystem path,
   or a `User`'s `roleId`/`avatarStorageKey`/`themeAccentColor` unless a specific page genuinely
   consumes it.
4. **A nested actor** (who released/archived/generated something) is always `{ id, name }` — never
   the full `User` row, never `email` unless the specific page genuinely displays it.

**Regression coverage:** `backend/tests/helpers.ts`'s `assertNoSensitiveKeys()` walks a parsed JSON
response body recursively (not just the top level — a leak typically hides inside a nested relation
object, exactly how the `passwordHash` defect was shaped) and fails if any key anywhere matches a
forbidden substring (`passwordHash`, `session`, `csrf`, `storageKey`, `absolutePath`, case-insensitive
substring match, extensible per-call). Used in `backend/tests/users.test.ts` (the direct fix) and
`backend/tests/payroll-lifecycle-response-security.test.ts` (the negative-finding confirmation across
cycle list/detail, Finalize, rollover, Backup Package list/detail, and the Salary Release unit-status
payload, across Draft/Released/Archived cycles).
