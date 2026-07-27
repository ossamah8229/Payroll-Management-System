# Release Schema — `PayrollUnitRelease`, `PayrollUnitReadiness`

**Owner module(s):** Payroll Processing / Release Salary jointly

**Contains:** `PayrollUnitRelease`, `PayrollUnitReadiness`

**Sections:** §12b, §12c · Full index: `database/README.md`

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
  distinct touched Unit now has a `PayrollUnitRelease` row, classify it per §12c below, settle any
  `PENDING` `BalanceAdjustment` for that employee (merged into the Bank Sheet/Cash Sheet payment
  amount, unchanged from the existing rule, `database/balance-adjustments.md §14`), and write the
  corresponding `AuditLog` entries (a `payroll_unit.released` entry for this event itself, plus one of
  `payroll_entry.released` / `.no_pay_due` / `.recovery_due` / `.release_blocked` per swept entry)
- **Row count:** roughly (Units per Site × Sites) per cycle — comparable in order of magnitude to
  `ProjectUnit` itself (`database/sites-and-units.md §8a`: ~50–300 total), not to `PayrollEntry`

### `PayrollUnitReadiness`

**Still intentionally deferred, reconfirmed 2026-07-14 (Phase 5 Checkpoint 0 preflight).** Deferred
past Phase 4 Checkpoint 2 when it was first scoped out, and not part of Phase 5's own `Builds` list
(`docs/IMPLEMENTATION_PLAN.md` — Finalize Cycle's precondition keys off `PayrollEntry.released`/
`.hold`, never off Readiness). Recorded here explicitly, rather than left to be silently
rediscovered by a future session, since it has now been dangling across two phases: this table
remains unimplemented (no migration, no route, no UI) until a session is explicitly authorized to
build it.

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

## 12c. Negative Payroll Recovery — release outcome classification

**Added 2026-07-26, Negative Payroll Recovery & Employee Identity/Banking Uniqueness checkpoint.**
Closes a real production gap: `calcNet()` (`shared/src/lib/calc-net.ts`) has no floor at zero — heavy
`advanceDeduction`/`eidAdvanceDeduction`/`fine`/`correctionBalanceRecovery` can legitimately push
`netSalary` below zero — and, before this checkpoint, `releaseProjectUnit` swept every non-held entry
into `released = true` regardless of sign, so a negative-net entry could be marked "Released" and
(had Bank Sheet/Cash Receiving not independently filtered on `released`) counted as payable.

**`released` is never redefined** — it continues to mean exactly what it always has: money was paid.
Going forward it is only ever set `true` for an entry whose own `netSalary > 0` at the moment its
Unit(s) release. The sweep (`payroll-release.service.ts`) now classifies every candidate entry via
one canonical function, `evaluatePayrollEntryReleaseReadiness` (`payroll-release-eligibility.ts`),
before writing anything:

| `netSalary` | Outcome | `released` | `PayrollEntry.payoutOutcome` |
|---|---|---|---|
| `> 0` | Paid | `true` | `null` |
| `= 0` | No payment due | `false` | `NO_PAY_DUE` |
| `< 0` | Employee overpaid/over-deducted | `false` | `RECOVERY_DUE` |

`payoutOutcome` (enum `PayrollEntryPayoutOutcome`, nullable on `PayrollEntry`) is the new column that
records the two non-payment resolutions — set exactly once, at the same moment `released` would
otherwise flip, and mutually exclusive with `released = true` by a raw-SQL CHECK constraint
(`PayrollEntry_payoutOutcome_released_check`). An entry with `payoutOutcome` set is just as locked as
a released one (`assertEntryEditable`, `database/payroll-entry.md §12`) and just as "resolved" for
Finalize's purposes (`payroll-processing.service.ts`'s `blockingCount` query) — even though `released`
itself stays `false`.

**`RECOVERY_DUE` creates a `BalanceAdjustment(type: RECOVERY)`** for `abs(netSalary)`, in the same
transaction — see `docs/architecture/workflows/corrections-and-balance-adjustments.md`'s own section
on this. **Mixed-Unit release**: a Unit release sweep processes every eligible candidate entry in one
pass regardless of sign — a positive-net and a negative-net employee touching the same Unit both
resolve in the same release event; neither blocks the other.

**Release-eligibility gate (identity/payment-destination validity):** the same
`evaluatePayrollEntryReleaseReadiness` call also checks, per candidate entry: a duplicate CNIC or
Employee Code elsewhere (defense-in-depth — the database's own partial unique indexes already
prevent new duplicates, `database/employee.md §9`), a duplicate Account Number/IBAN elsewhere
(compared against the entry's own frozen banking snapshot, not the live Employee record — the "copied,
not linked" convention this schema already uses), and a bank-paid entry (`bankId` set) missing its
Account Number. A Cash entry (`bankId = null`) is never blocked for missing banking details. A
non-releasable entry is excluded from the sweep entirely — same tier as `hold` — staying
`released: false, hold: false, payoutOutcome: null`; it remains visible and still blocks Finalize
until the underlying master data is fixed or it is manually held. No new "Late Entry"/exceptional
one-off release mechanism is introduced by this gate — a blocked entry whose Unit(s) have already
released has the same "addressed forward in a future cycle" limitation an ordinary held entry already
has (`database/payroll-entry.md §12`'s own documented gap), not a new one.

**Bank Sheet/Cash Receiving** (`bank-sheets.service.ts`/`cash-receiving.service.ts`) add an explicit
`netSalary > 0` filter on top of their existing `released: true, hold: false` query — defense-in-depth
only, since `released` is now only ever set for positive-net entries going forward, but cheap
insurance against a pre-existing bad row (a negative-net entry marked `released` before this
checkpoint shipped) ever resurfacing as payable if a historical cycle's sheet is regenerated. Neither
generator nets one employee's recovery against another's payable total — each entry stands alone.

**A carried-forward recovery deduction larger than the target cycle's earnings never double-counts**
— see `docs/architecture/workflows/corrections-and-balance-adjustments.md`'s "Preventing
double-counted recovery" section for the full accounting (`computeReleaseRecoveryAdjustment`).
`payoutOutcome`/`released` classification always uses that adjusted figure, never the raw `calcNet`
result, whenever `correctionBalanceRecovery > 0`.

**Pre-release "Needs Attention" visibility (2026-07-27 refinement):** a still-unresolved entry the
release-eligibility gate would block is surfaced in the Payroll Entry grid itself, before an operator
ever attempts release — `PayrollEntry`'s list/detail responses carry a `releaseBlockReasons: string[]`
field (empty for a resolved or fully-eligible entry), computed via the exact same
`RELEASE_BLOCK_REASONS` wording `evaluatePayrollEntryReleaseReadiness` itself throws. The list
endpoint uses a bulk-batched variant (`attachReleaseBlockReasonsBulk`,
`payroll-entry.service.ts`) — a handful of batched queries per page instead of up to four sequential
lookups per row — after an unbatched per-row version measurably regressed this codebase's own
10,000-employee concurrency suite (`payroll-entry-performance.test.ts`). The Salary Release result
(`ReleaseUnitResult.blockedEntries`) likewise reports each blocked employee's name and reasons, not
just a bare count, so a mixed-Unit release's blocked employees are inspectable, not silently excluded.

---
