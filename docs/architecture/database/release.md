# Release Schema — `PayrollUnitRelease`, `PayrollUnitReadiness`

**Owner module(s):** Payroll Processing / Release Salary jointly

**Contains:** `PayrollUnitRelease`, `PayrollUnitReadiness`

**Sections:** §12b · Full index: `database/README.md`

---

## 12b. `PayrollUnitRelease` and `PayrollUnitReadiness`

**Added 2026-07-05, Phase 3 architecture review.** Two small tables that together implement release
at Project Unit granularity — the new business rule that payroll may be released independently per
Project Unit, with Finance choosing to release immediately or wait for client funding, rather than
only as a whole-Cycle action.

### `PayrollUnitRelease`

**Purpose:** The actual release event for one Project Unit, for one cycle. This is the new source of
truth that `PayrollEntry.released` (`database/payroll-entry.md §12`) is derived from.
**Why it exists:** Release needed a grain finer than `PayrollCycle` (too coarse — a whole month) and
finer than `ProjectSite` (too coarse — a site can have several Units funded on different schedules by
different client disbursements) without abandoning the one-entry/one-payment model Principle 1 and
Principle 6 already established. A dedicated event-log table, rather than a flag directly on
`PayrollEntry`, is what lets one release action correctly fan out across every entry that Unit
touches — including a multi-unit entry that needs *this* to be the last of several such events before
it can release.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, `ON DELETE RESTRICT` |
| `releasedAt` | timestamptz | no | `now()` | |
| `releasedById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — must hold the `FINANCE` (or Master User) `payroll:release` permission for this Unit's Site, enforced at the application layer |

- **Unique constraints:** (`cycleId`, `unitId`) — a Unit releases at most once per cycle; there is no
  "un-release" action (matches Principle 9 — once released, it stays released)
- **Indexes:** unique(`cycleId`, `unitId`); (`cycleId`) for "which Units have released this cycle";
  (`unitId`) for historical/reporting queries
- **Cascade:** both FKs `RESTRICT`
- **Module owner:** Payroll Processing / Release Salary (the same module boundary as before — this is
  Release Salary's own event log, not a new module)
- **Immutable, append-only:** yes — inserted once per `(cycleId, unitId)`, never updated or deleted,
  same convention as `Correction`/`AuditLog`/`EmployeeTransferHistory`
- **Transactions required:** yes, always — inserting this row must, in the same transaction, sweep
  every `PayrollEntry` with a work line touching `unitId` in `cycleId` and, for each one whose *every*
  distinct touched Unit now has a `PayrollUnitRelease` row, flip `released = true` /
  `releasedAt` / `releasedBy`, settle any `PENDING` `BalanceAdjustment` for that employee (merged into
  the Bank Sheet/Cash Sheet payment amount, unchanged from the existing rule,
  `database/balance-adjustments.md §14`), and write the corresponding `AuditLog` entries (a
  `payroll_unit.released` entry for this event itself, plus the ordinary `payroll.released` entry for
  each entry it swept in)
- **Row count:** roughly (Units per Site × Sites) per cycle — comparable in order of magnitude to
  `ProjectUnit` itself (`database/sites-and-units.md §8a`: ~50–300 total), not to `PayrollEntry`

### `PayrollUnitReadiness`

**Purpose:** The informational "payroll preparation for this Unit is complete" signal — the new
"Ready for Release" status. **Deliberately non-gating**: Finance can release a Unit whether or not it
has been marked Ready; this table has no bearing on whether `PayrollUnitRelease` can be inserted.
**Why it exists:** Payroll Staff need a way to signal "done entering this Unit's data" to Finance
without that signal becoming a lock (the business rule is explicit: "'Ready for Release' is NOT
locked; it simply indicates payroll preparation is complete").

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | PK |
| `cycleId` | uuid | no | — | FK → `PayrollCycle.id`, `ON DELETE RESTRICT` |
| `unitId` | uuid | no | — | FK → `ProjectUnit.id`, `ON DELETE RESTRICT` |
| `markedReadyById` | uuid | no | — | FK → `User.id`, `ON DELETE RESTRICT` — Payroll Staff (site-scoped) or Master User; **not** Finance, which has no permission to mark this |
| `markedReadyAt` | timestamptz | no | `now()` | |

- **Unique constraints:** (`cycleId`, `unitId`) — a Unit is either marked Ready for this cycle or it
  isn't; there's no meaning to marking it twice
- **Row existence, not a boolean column, models readiness** (refined 2026-07-05): the row's presence
  *is* "Ready"; un-marking Ready **deletes** the row rather than flipping a flag. This is the one
  deliberate exception to this schema's general preference against deleting rows — there is no
  historical-preservation requirement here (unlike `PayrollUnitRelease` or any append-only table),
  since this status is purely a live, current-state workflow signal with no business-history value
  once superseded. Deletion and (re)creation are still each their own audited event
  (`payroll_unit.marked_ready` / `payroll_unit.unmarked_ready`) even though the row itself doesn't
  persist — the audit trail is what preserves the historical fact that it happened, not this table.
- **Indexes:** unique(`cycleId`, `unitId`); (`cycleId`) for "which Units are Ready this cycle"
- **Cascade:** both FKs `RESTRICT`
- **Module owner:** Payroll Entry / Release Salary jointly (Payroll Staff set it from the Payroll
  Entry side, Finance reads it from the Release side)
- **"Modified after Ready" indicator:** computed on read, not stored — comparing `markedReadyAt`
  against `MAX(PayrollEntry.updatedAt)` across every entry touching this Unit in this cycle. If any
  entry was edited after the Unit was marked Ready, Finance sees a "modified since marked ready"
  notice (with the last-modified timestamp, and the acting user resolved via the most recent relevant
  `AuditLog` entry for that entry — no new "last edited by" column is added to `PayrollEntry` for
  this, keeping that table's write surface unchanged). This is informational only and never clears
  the readiness row automatically — matches the "not locked" rule exactly.
- **Row count:** at most one row per `(cycleId, unitId)` pair currently marked Ready — small,
  comparable to `PayrollUnitRelease`'s scale, and shrinks further once released (Ready is typically
  cleared or simply superseded by the actual release; nothing requires clearing it, it's just moot
  once released)

---
