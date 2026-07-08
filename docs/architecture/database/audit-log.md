# Audit Log Schema — `AuditLog`

**Owner module(s):** Audit Log

**Contains:** `AuditLog`

**Sections:** §16 · Full index: `database/README.md`

For the Audit Log's immutability *policy* and defense-in-depth rationale, see
`docs/architecture/system-conventions.md §3` — this file is the schema only.

---

## 16. `AuditLog`

**Purpose:** The permanent, append-only record of every financial and administrative action in the
system.
**Why it exists:** Principle 3; `docs/architecture/system-conventions.md §3`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `occurredAt` | timestamptz | no | `now()` | |
| `actorUserId` | uuid | yes | — | FK → `User.id`, `ON DELETE SET NULL` — null for fully automatic/system actions (e.g. automatic cycle archiving); `SET NULL` (not `RESTRICT`) so a historical audit entry is never itself a reason a user record becomes undeletable, though in practice `User` rows are never hard-deleted either |
| `action` | varchar(100) | no | — | app-level constant, e.g. `payroll.released`, `correction.approved` — free text validated against an application registry, not a DB enum, since this list grows with nearly every feature (see `database/conventions-and-enums.md §0`) |
| `entityType` | varchar(60) | no | — | e.g. `PayrollEntry`, `Employee`, `Correction` |
| `entityId` | uuid | yes | — | polymorphic reference — **not a real foreign key**, since it points to different tables depending on `entityType`; integrity here is an application-layer responsibility |
| `metadata` | jsonb | yes | — | flexible payload: old/new values, reason text, amounts — whatever context that specific action needs |
| `ipAddress` | inet | yes | — | |
| `userAgent` | text | yes | — | |

- **Indexes:** (`entityType`, `entityId`); (`actorUserId`); (`occurredAt` desc) for chronological
  paging; optional GIN index on `metadata` if audit search-by-content is needed later
- **Cascade:** `actorUserId` is `SET NULL`
- **Module owner:** Audit Log
- **Immutable, append-only:** enforced at two layers — no application code path updates or deletes a
  row, **and** the database role's `UPDATE`/`DELETE` privileges on this table are revoked (or a
  `BEFORE UPDATE OR DELETE` trigger raises an exception), per `docs/architecture/system-conventions.md
  §3`. **Revised 2026-07-04 (first live-database verification):** the trigger permits exactly one
  narrow UPDATE — `actorUserId` transitioning NOT NULL → NULL with every other column byte-identical,
  i.e. precisely what this table's own `ON DELETE SET NULL` FK action (above) produces when a `User`
  row is deleted. The original trigger rejected *every* UPDATE, which made any user with audit history
  undeletable — contradicting this very section's stated reason for choosing `SET NULL` over
  `RESTRICT`. The two requirements were reconciled in favor of the documented FK semantics
  (migration `20260704180000_audit_log_allow_fk_actor_set_null`); every other UPDATE and every
  DELETE is still rejected at the database level, verified by live test.
- **Transactions required:** yes, always — every audited action writes its `AuditLog` row in the same
  transaction as the change itself; there is no code path where the change commits without its audit
  entry
- **Row count:** the fastest-growing table in the system by row count, but still trivial for
  Postgres — plausibly several thousand rows per month; unbounded retention is intended (this is the
  audit trail, it is not pruned)

---
