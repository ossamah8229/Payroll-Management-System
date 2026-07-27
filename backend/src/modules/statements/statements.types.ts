/**
 * Phase 7A Checkpoint 1 — Employee Statement of Account, canonical ledger domain types.
 * Independent of Prisma's generated types and any HTTP concern, matching this codebase's own
 * established convention for a module's pure domain shape (`corrections.types.ts`,
 * `corrections.settlement.types.ts`).
 *
 * **Architecture (Phase 7 report, approved decisions):**
 * - Three independent running balances are exposed — `payableOutstanding` ("Payable to Employee"),
 *   `recoveryOutstanding` ("Recoverable from Employee"), and `advanceOutstanding" (the Advances
 *   sub-ledger) — deliberately never combined into one synthetic "net position" figure. Terminology
 *   is "Payable to Employee" / "Recoverable from Employee", never raw accounting Debit/Credit.
 * - Every ledger entry carries a structural `kind` and, where it moves a balance, a structural
 *   `movement` (`balance`/`direction`/`amount`) — `description` is presentation metadata only and
 *   must never be parsed to recover accounting meaning.
 * - An **informational** entry (`isInformational: true`) never carries a `movement` and therefore
 *   never changes `runningBalances` from the immediately preceding entry — this is a hard invariant,
 *   enforced by construction in `statements.service.ts`, not merely by convention.
 */

/** Which of this domain's three independent sub-ledgers an entry belongs to. Reports/Dashboard
 * (later Phase 7 checkpoints) filter/aggregate by this without needing to inspect `kind`. */
export type StatementLedgerCategory = 'SALARY' | 'CORRECTION' | 'ADVANCE';

/** Closed, code-coupled set — every event kind this checkpoint's ledger can produce. Adding a new
 * kind is a code change (a new business event this domain can represent), never a data-driven
 * addition — matching this schema's own "closed, code-coupled enum" convention
 * (`conventions-and-enums.md §1`) applied to a derived DTO instead of a database enum. */
export type StatementLedgerEventKind =
  // Salary / cycle-outcome (informational only — see the module-level doc comment above)
  | 'CYCLE_PAID'
  | 'CYCLE_NO_PAY_DUE'
  | 'CYCLE_RECOVERY_DUE'
  | 'CYCLE_PENDING'
  | 'CYCLE_LEGACY_NEGATIVE_ANOMALY'
  // Corrections / Balance Adjustments
  | 'CORRECTION_APPROVED'
  | 'BALANCE_ADJUSTMENT_CREATED'
  | 'BALANCE_ADJUSTMENT_SETTLED'
  | 'CORRECTION_PAYMENT'
  // Advances
  | 'ADVANCE_GIVEN'
  | 'ADVANCE_DEDUCTION_RESERVED'
  | 'ADVANCE_DEDUCTION_FINAL'
  | 'ADVANCE_SCHEDULE_CHANGED'
  | 'ADVANCE_PAID_OFF'
  | 'ADVANCE_CANCELLED';

export type StatementBalanceKind = 'PAYABLE' | 'RECOVERABLE' | 'ADVANCE';
export type StatementMovementDirection = 'INCREASE' | 'DECREASE';

export interface StatementMovement {
  balance: StatementBalanceKind;
  direction: StatementMovementDirection;
  /** Decimal string (2dp), always a positive magnitude — `direction` carries the sign, never a
   * negative string. */
  amount: string;
}

export interface StatementBalances {
  /** "Payable to Employee" — `BalanceAdjustment(type: PAYABLE).remainingAmount`, summed. */
  payableOutstanding: string;
  /** "Recoverable from Employee" — `BalanceAdjustment(type: RECOVERY).remainingAmount`, summed
   * (both Correction-originated and negative-payroll-originated rows). */
  recoveryOutstanding: string;
  /** The separate Advances sub-ledger — `Advance.outstandingBalance`, summed across every LOAN and
   * EID_ADVANCE this employee has ever held. Never mixed into the two balances above. */
  advanceOutstanding: string;
}

export interface StatementLedgerReference {
  payrollEntryId?: string;
  correctionId?: string;
  balanceAdjustmentId?: string;
  balanceAdjustmentSettlementId?: string;
  correctionPaymentId?: string;
  advanceId?: string;
  advanceScheduleChangeId?: string;
}

export interface StatementLedgerEntry {
  /** Stable within one assembled statement — `${sourceTable}:${sourceRowId}` — never a persisted
   * primary key of its own (this ledger is a derived read model; see the module doc comment). */
  id: string;
  /** ISO date (`YYYY-MM-DD`) this event is attributed to — display only; `sequence` (below) is the
   * authoritative order. */
  date: string;
  cycleId: string | null;
  cycleYear: number | null;
  cycleMonth: number | null;
  category: StatementLedgerCategory;
  kind: StatementLedgerEventKind;
  /** Structural flag, never derived from `description`. */
  isInformational: boolean;
  /** `null` for every informational entry — enforced by construction. */
  movement: StatementMovement | null;
  /** The three running balances immediately *after* this entry is applied — identical to the
   * previous entry's (or the opening balance's) figures for an informational entry. */
  runningBalances: StatementBalances;
  /** Human-readable, presentation metadata only — see the module doc comment. */
  description: string;
  reference: StatementLedgerReference;
  /** 0-based position in the full, deterministically-ordered replay this statement was built from
   * (`statements.service.ts`'s documented ordering rule) — strictly increasing across the *entire*
   * unbounded history, not renumbered per page, so a caller can always tell relative order even
   * across two separately-fetched ranges. */
  sequence: number;
}

export interface StatementEmployeeIdentity {
  employeeId: string;
  employeeCode: string | null;
  cnic: string | null;
  name: string;
  currentSiteId: string;
  currentSiteName: string;
}

export interface StatementCycleRef {
  id: string;
  year: number;
  month: number;
}

export interface StatementRange {
  fromCycle: StatementCycleRef | null;
  toCycle: StatementCycleRef | null;
  /** How many `PayrollCycle` rows (system-wide) fall within the resolved range — `0` only in the
   * true empty-install case (no `PayrollCycle` has ever been created). */
  cycleCount: number;
}

/** Closed, code-coupled set — the one reason Advance history can currently be excluded from a
 * Statement despite the caller holding `statements:view` and having *some* visibility into this
 * employee. Not extensible by data (unlike `AdjustmentType`) — a second restriction reason would be
 * a genuine new business rule, not a data row. */
export type AdvanceHistoryRestrictionReason = 'CURRENT_SITE_OUT_OF_SCOPE';

/**
 * Whether the Advances sub-ledger this employee actually has was included in `entries`/
 * `closingBalances.advanceOutstanding`, and — when it wasn't — *why*, so a caller can distinguish
 * "this employee genuinely has no Advance history" (`advanceHistoryIncluded: true`, zero `ADVANCE_*`
 * entries) from "Advance history exists or may exist, but this requester's current site assignment
 * doesn't cover it" (`advanceHistoryIncluded: false`). Deliberately carries no count, amount, or any
 * other detail about the excluded history itself — even *how many* Advances are hidden is
 * information a site-scoped caller isn't entitled to (module doc comment, §7 — Advances have no
 * historical per-site attribution, so this is an all-or-nothing exclusion, never a partial one).
 * Master Admin (and anyone else with unrestricted site authority) always has
 * `advanceHistoryIncluded: true`.
 */
export interface StatementScope {
  advanceHistoryIncluded: boolean;
  advanceHistoryRestriction?: AdvanceHistoryRestrictionReason;
}

export interface EmployeeStatement {
  employee: StatementEmployeeIdentity;
  range: StatementRange;
  scope: StatementScope;
  /** The three running balances immediately *before* the first entry in `entries` — correctly
   * accounts for every movement before the requested range, not just a display artifact (see
   * `statements.service.ts`'s full-history replay). */
  openingBalances: StatementBalances;
  /** Equal to the last entry's `runningBalances`, or `openingBalances` unchanged if `entries` is
   * empty. */
  closingBalances: StatementBalances;
  entries: StatementLedgerEntry[];
  generatedAt: string;
}

export interface GetEmployeeStatementParams {
  /** Both or neither — validated in `statements.service.ts`. Omitted entirely resolves to the
   * latest 12 `PayrollCycle` rows system-wide (the approved future-UI default), computed here so a
   * later UI never needs to duplicate this rule. */
  fromCycleId?: string;
  toCycleId?: string;
}
