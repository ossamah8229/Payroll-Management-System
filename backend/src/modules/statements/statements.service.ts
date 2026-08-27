import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import ExcelJS from 'exceljs';
import type { SessionUser } from '@payroll/shared';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../common/http-error';
import { stringifyCsvSafe } from '../../common/import-export';
import { excelColumnWidth } from '../../common/excel-utils';
import { getAccessibleSiteIds } from '../../common/authz-policy';
import { searchEmployeesByHistoricalPayroll } from '../../common/historical-payroll-employee-lookup';
import { computeEntryCalc, WORK_LINES_INCLUDE } from '../payroll-entry/payroll-entry.service';
import { getCompanySettings } from '../settings/settings.service';
import { getCompanyLogoDataUri } from '../settings/company-logo.service';
import { renderHtmlToPdf } from '../../lib/pdf/render-pdf';
import { renderStatementHtml, STATEMENT_PDF_FOOTER_TEMPLATE, type StatementPdfMeta } from '../../lib/pdf/templates/statement';
import {
  entryDateLabel,
  statementBalanceShortLabel,
  statementCategoryLabel,
  statementPeriodLabel,
} from './statement-labels';
import type {
  EmployeeStatement,
  GetEmployeeStatementParams,
  SearchStatementEmployeesParams,
  SearchStatementEmployeesResult,
  StatementBalanceKind,
  StatementBalances,
  StatementCycleRef,
  StatementEmployeeIdentity,
  StatementLedgerCategory,
  StatementLedgerEntry,
  StatementLedgerEventKind,
  StatementLedgerReference,
  StatementRange,
  StatementScope,
} from './statements.types';

/**
 * Phase 7A Checkpoint 1 — canonical Employee Statement of Account ledger (Phase 7 architecture
 * report, approved decisions). Purely derived, read-only — reads `PayrollEntry`, `Correction`,
 * `BalanceAdjustment` (+ `BalanceAdjustmentSettlement`/`CorrectionPayment`), and `Advance` (+
 * `AdvanceScheduleChange`); owns no primary data of its own and never mutates any of them
 * (Principle 1, Principle 9). No new table is introduced.
 *
 * **Correctness-over-truncation query strategy**: this module always fetches one employee's *full*
 * cross-cycle history (all four source tables, unbounded by the requested display range) and
 * computes running balances via one deterministic, full replay — then slices the *output* down to
 * the requested range. This is the only way to produce a correct "Opening Balance" for a bounded
 * window (exactly how a real bank statement's own opening balance is computed) without a second,
 * separate "balance as of date X" aggregate implementation that could drift from the replay. This
 * is safe and cheap specifically *because* every query here is scoped to one employee — per-employee
 * history (a few dozen cycles, a handful of corrections/advances even over a long tenure) is never
 * proportional to the 10,000-employee company-wide scale Principle 10 is actually concerned with; a
 * genuinely long-tenured employee's full-history fetch is a documented, deliberate scaling note for
 * a future checkpoint, not a Principle 10 violation today (see the checkpoint report's own
 * "Performance" section).
 *
 * **RBAC — historical `PayrollEntry.siteId`, never live `Employee.siteId`** (Phase 7 report,
 * approved decision 8): each `PayrollEntry`-derived row (and every Correction/BalanceAdjustment/
 * Settlement/CorrectionPayment row keyed to that entry's own origin) is independently filtered by
 * whether *that entry's own* `siteId` is in the caller's accessible site set — never gated by the
 * employee's current site. A site-scoped user who administered the employee's *old* site keeps
 * seeing that slice of history even after the employee transfers to a site the user doesn't
 * administer; conversely a user who now administers the employee's new site never gains visibility
 * into history from a site they were never assigned to. The Advances sub-ledger has no historical
 * per-site attribution of its own anywhere in this schema (an `Advance` references only an
 * `Employee`, never a `PayrollEntry`/`ProjectSite` at creation) — it is gated as one all-or-nothing
 * unit by the employee's *current* site, deliberately matching the existing Advances module's own
 * established RBAC convention (`advances.service.ts`'s `assertSiteAccess(currentUser,
 * employee.siteId)`), not a new invention.
 */

const ZERO = '0.00';

function zeroBalances(): StatementBalances {
  return { payableOutstanding: ZERO, recoveryOutstanding: ZERO, advanceOutstanding: ZERO };
}

function periodKeyOf(year: number, month: number): number {
  return year * 12 + month;
}

function periodKeyOfDate(date: Date): number {
  return periodKeyOf(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `GROSS_PAY` -> `Gross Pay` — presentation-only labelizer for `CorrectionField`. Deliberately
 * local and minimal (not a duplicate of `frontend/src/lib/correction-labels.ts`, a frontend-only
 * concern out of this backend checkpoint's scope) — the returned string is `description` text only,
 * never inspected for accounting meaning by any caller. */
function humanizeCorrectionField(field: string): string {
  return field
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// --- Source query shapes -----------------------------------------------------------------------

const payrollEntryInclude = {
  workLines: WORK_LINES_INCLUDE,
  cycle: { select: { id: true, year: true, month: true } },
} satisfies Prisma.PayrollEntryInclude;

type PayrollEntryForStatement = Prisma.PayrollEntryGetPayload<{ include: typeof payrollEntryInclude }>;

const correctionInclude = {
  adjustmentType: { select: { label: true } },
  payrollEntry: { select: { id: true, siteId: true, cycle: { select: { id: true, year: true, month: true } } } },
} satisfies Prisma.CorrectionInclude;

type CorrectionForStatement = Prisma.CorrectionGetPayload<{ include: typeof correctionInclude }>;

const balanceAdjustmentInclude = {
  correction: { select: { approvedAt: true, payrollEntry: { select: { siteId: true } } } },
  originPayrollEntry: { select: { siteId: true } },
  sourceCycle: { select: { id: true, year: true, month: true } },
  settlements: { orderBy: { appliedAt: 'asc' }, include: { cycle: { select: { id: true, year: true, month: true } } } },
  correctionPayment: { select: { id: true, amount: true, paidAt: true } },
} satisfies Prisma.BalanceAdjustmentInclude;

type BalanceAdjustmentForStatement = Prisma.BalanceAdjustmentGetPayload<{ include: typeof balanceAdjustmentInclude }>;

const advanceInclude = {
  scheduleChanges: {
    orderBy: { changedAt: 'asc' },
    include: { fromPeriod: { select: { year: true, month: true } }, toPeriod: { select: { year: true, month: true } } },
  },
  // `originalScheduledPeriodId` is the one always-present, immutable period anchor an Advance ever
  // has (`currentScheduledPeriodId` is cleared to null on both PAID_OFF and CANCELLED) — used only
  // to attribute the Cancelled marker to a meaningful period, never surfaced as a `cycle` reference
  // in the output DTO (a `ScheduledPayrollPeriod` may not have resolved into a real `PayrollCycle`).
  originalScheduledPeriod: { select: { year: true, month: true } },
} satisfies Prisma.AdvanceInclude;

type AdvanceForStatement = Prisma.AdvanceGetPayload<{ include: typeof advanceInclude }>;

// --- The internal, pre-replay representation of one ledger-worthy event ------------------------

interface RawLedgerItem {
  id: string;
  date: Date;
  periodKey: number;
  /** Secondary, documented sort key — see `KIND_SEQUENCE_PRIORITY` below. */
  kindPriority: number;
  category: StatementLedgerCategory;
  kind: StatementLedgerEventKind;
  isInformational: boolean;
  movement: { balance: StatementBalanceKind; direction: 'INCREASE' | 'DECREASE'; amount: Decimal } | null;
  description: string;
  cycle: StatementCycleRef | null;
  reference: StatementLedgerReference;
}

/**
 * **Deterministic ordering rule (ledger requirement — documented here, the one place it's
 * implemented):** items are sorted by, in order:
 * 1. `periodKey` (`year * 12 + month`) — the calendar period the event is attributed to (a cycle's
 *    own `(year, month)` for cycle-attributed events; the event's own date's calendar month for the
 *    handful of kinds with no cycle attribution at all — Advance Given/Cancelled, a standalone
 *    Correction Payment).
 * 2. `kindPriority` — a fixed, closed lookup below. Chosen so the common causal pairings read
 *    naturally within one period: a Correction's own informational row immediately precedes the
 *    Balance Adjustment it created; a cycle's own Recovery Due outcome immediately precedes the
 *    negative-payroll-origin Balance Adjustment created in the very same release transaction; that
 *    period's own Advance deduction and its payoff confirmation follow the cycle outcome that
 *    caused them; a settlement applied at that same release comes last. This does not claim to be
 *    the *only* correct causal order — only a fixed, documented, testable one, which is what
 *    "deterministic" requires; it does not affect closing-balance correctness either way (sum is
 *    commutative), only which intermediate per-row running balance is shown.
 * 3. The row's own natural sub-ordering timestamp (`date`, in milliseconds) — full stability within
 *    the same period and kind.
 * 4. The row's own id, lexicographically — the final, always-available tie-break guaranteeing a
 *    strict total order even if two rows of the same kind share the exact same timestamp.
 *
 * **`ADVANCE_CANCELLED` is deliberately its own, strictly-higher priority than `ADVANCE_GIVEN`
 * (v1.0.4 Cancel Business Semantics fix — root-caused during that checkpoint's own E2E
 * verification), not merely grouped alongside it:** `ADVANCE_CANCELLED` almost always shares the
 * exact same `periodKey` as its own `ADVANCE_GIVEN` (both attributed to the Advance's
 * `originalScheduledPeriod`), so step 3's `date` comparison is what actually decides their relative
 * order in the common case — but `ADVANCE_GIVEN.date` is the user-editable, purely descriptive
 * `dateGiven` field (editable at any lifecycle stage, per `advances.service.ts`), while
 * `ADVANCE_CANCELLED.date` is the real `updatedAt` timestamp of the cancel action itself. Those two
 * are not reliably comparable — a `dateGiven` set later in its own calendar period than the exact
 * moment cancellation happened would let `ADVANCE_CANCELLED` sort *before* the very `ADVANCE_GIVEN`
 * it cancels. That ordering inversion was harmless while `ADVANCE_CANCELLED` carried `movement:
 * null` (sum is commutative), but became directly consequential once it started carrying a real
 * DECREASE (this same checkpoint) — replaying the waiver before the Advance was even recorded as
 * given would show `ADVANCE_GIVEN`'s own running Advance Outstanding as already-waived. A same-kind
 * `date` tie-break can never fix an ordering requirement *between* two different kinds; only a
 * strictly distinct `kindPriority` can guarantee it, for every advance, unconditionally.
 */
const KIND_SEQUENCE_PRIORITY: Record<StatementLedgerEventKind, number> = {
  CYCLE_PAID: 1,
  CYCLE_NO_PAY_DUE: 1,
  CYCLE_RECOVERY_DUE: 1,
  CYCLE_PENDING: 1,
  CYCLE_LEGACY_NEGATIVE_ANOMALY: 1,
  CORRECTION_APPROVED: 2,
  BALANCE_ADJUSTMENT_CREATED: 3,
  ADVANCE_DEDUCTION_RESERVED: 4,
  ADVANCE_DEDUCTION_FINAL: 4,
  ADVANCE_PAID_OFF: 5,
  BALANCE_ADJUSTMENT_SETTLED: 6,
  ADVANCE_GIVEN: 7,
  ADVANCE_SCHEDULE_CHANGED: 7,
  CORRECTION_PAYMENT: 7,
  ADVANCE_CANCELLED: 8,
};

function sortRawItems(items: RawLedgerItem[]): RawLedgerItem[] {
  return [...items].sort((a, b) => {
    if (a.periodKey !== b.periodKey) return a.periodKey - b.periodKey;
    if (a.kindPriority !== b.kindPriority) return a.kindPriority - b.kindPriority;
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// --- Range resolution ----------------------------------------------------------------------------

const DEFAULT_CYCLE_WINDOW = 12;

interface ResolvedRange {
  fromCycle: StatementCycleRef | null;
  toCycle: StatementCycleRef | null;
  cycleCount: number;
  /** `-Infinity`/`+Infinity` when no `PayrollCycle` exists at all system-wide — every item is then
   * "in range" by definition (there is nothing to bound against), matching the true empty-install
   * case every other cycle-aware page in this codebase already special-cases. */
  fromKey: number;
  toKey: number;
}

/** Cycle counts stay in the dozens even after years of operation (`payroll-lifecycle.md`'s own
 * documented invariant) — fetching every `PayrollCycle` row to resolve a range or validate/count an
 * explicit one is deliberately not a second, bespoke aggregate query; there is no SQL expression of
 * `year * 12 + month` needed anywhere as a result. */
async function resolveStatementRange(params: GetEmployeeStatementParams): Promise<ResolvedRange> {
  const allCycles = await prisma.payrollCycle.findMany({
    select: { id: true, year: true, month: true },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  if (params.fromCycleId || params.toCycleId) {
    if (!params.fromCycleId || !params.toCycleId) {
      throw badRequest('fromCycleId and toCycleId must both be supplied, or neither (to use the default range).');
    }
    const fromCycle = allCycles.find((c) => c.id === params.fromCycleId);
    const toCycle = allCycles.find((c) => c.id === params.toCycleId);
    if (!fromCycle) throw notFound('fromCycleId does not refer to an existing payroll cycle');
    if (!toCycle) throw notFound('toCycleId does not refer to an existing payroll cycle');

    const fromKey = periodKeyOf(fromCycle.year, fromCycle.month);
    const toKey = periodKeyOf(toCycle.year, toCycle.month);
    if (fromKey > toKey) {
      throw badRequest('fromCycleId must not be later than toCycleId');
    }
    const cycleCount = allCycles.filter((c) => periodKeyOf(c.year, c.month) >= fromKey && periodKeyOf(c.year, c.month) <= toKey).length;
    return { fromCycle, toCycle, cycleCount, fromKey, toKey };
  }

  if (allCycles.length === 0) {
    return { fromCycle: null, toCycle: null, cycleCount: 0, fromKey: -Infinity, toKey: Infinity };
  }

  const window = allCycles.slice(Math.max(0, allCycles.length - DEFAULT_CYCLE_WINDOW));
  const fromCycle = window[0]!;
  const toCycle = window[window.length - 1]!;
  return {
    fromCycle,
    toCycle,
    cycleCount: window.length,
    fromKey: periodKeyOf(fromCycle.year, fromCycle.month),
    toKey: periodKeyOf(toCycle.year, toCycle.month),
  };
}

// --- Source-table item builders -------------------------------------------------------------------

function buildCycleOutcomeItem(entry: PayrollEntryForStatement): RawLedgerItem {
  const cycle: StatementCycleRef = { id: entry.cycle.id, year: entry.cycle.year, month: entry.cycle.month };
  const monthLabel = `${cycle.year}-${String(cycle.month).padStart(2, '0')}`;
  const calc = computeEntryCalc(entry);
  const netSalary = new Decimal(calc.netSalary);
  // `releasedAt` is only ever non-null for `released = true` (schema CHECK) — every other outcome
  // uses `updatedAt`, which the release sweep always bumps (`version: { increment: 1 }`) regardless
  // of which of the three outcomes it resolved an entry to, so it's a uniformly-available "when was
  // this entry last resolved" timestamp across all four branches below.
  const date = entry.released ? entry.releasedAt! : entry.updatedAt;
  const reference: StatementLedgerReference = { payrollEntryId: entry.id };

  if (entry.released && netSalary.greaterThan(0)) {
    return {
      id: `payroll-entry:${entry.id}`,
      date,
      periodKey: periodKeyOf(cycle.year, cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.CYCLE_PAID,
      category: 'SALARY',
      kind: 'CYCLE_PAID',
      isInformational: true,
      movement: null,
      description: `Net Salary Paid — ${monthLabel}: PKR ${netSalary.toFixed(2)}`,
      cycle,
      reference,
    };
  }

  // Legacy anomaly: a `released = true` row whose recomputed net salary is non-positive predates
  // the Negative Payroll Recovery architecture (`docs/architecture/database/release.md §12c`) —
  // under the current architecture this can never be newly produced (`releaseProjectUnit` only ever
  // sets `released = true` for `netSalary > 0`). Rendered as an inert historical fact: no movement,
  // no `BalanceAdjustment` is ever created for it here, and nothing about it is ever mutated.
  if (entry.released) {
    return {
      id: `payroll-entry:${entry.id}`,
      date,
      periodKey: periodKeyOf(cycle.year, cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.CYCLE_LEGACY_NEGATIVE_ANOMALY,
      category: 'SALARY',
      kind: 'CYCLE_LEGACY_NEGATIVE_ANOMALY',
      isInformational: true,
      movement: null,
      description: `Historical anomaly — ${monthLabel}: released with a non-positive net salary of PKR ${netSalary.toFixed(2)} (predates the negative-payroll-recovery architecture; not mutated or reconciled by this statement)`,
      cycle,
      reference,
    };
  }

  if (entry.payoutOutcome === 'NO_PAY_DUE') {
    return {
      id: `payroll-entry:${entry.id}`,
      date,
      periodKey: periodKeyOf(cycle.year, cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.CYCLE_NO_PAY_DUE,
      category: 'SALARY',
      kind: 'CYCLE_NO_PAY_DUE',
      isInformational: true,
      movement: null,
      description: `No Payment Due — ${monthLabel}`,
      cycle,
      reference,
    };
  }

  if (entry.payoutOutcome === 'RECOVERY_DUE') {
    // The movement itself is carried entirely by the paired `BalanceAdjustment(originPayrollEntryId:
    // entry.id)` row (`buildBalanceAdjustmentItems`, below) — this row is informational only, so a
    // negative net salary is never independently represented as a second recovery here.
    return {
      id: `payroll-entry:${entry.id}`,
      date,
      periodKey: periodKeyOf(cycle.year, cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.CYCLE_RECOVERY_DUE,
      category: 'SALARY',
      kind: 'CYCLE_RECOVERY_DUE',
      isInformational: true,
      movement: null,
      description: `Recovery Due at Release — ${monthLabel}: net salary of PKR ${netSalary.toFixed(2)} became a recovery obligation (see the linked Salary Recovery entry)`,
      cycle,
      reference,
    };
  }

  return {
    id: `payroll-entry:${entry.id}`,
    date,
    periodKey: periodKeyOf(cycle.year, cycle.month),
    kindPriority: KIND_SEQUENCE_PRIORITY.CYCLE_PENDING,
    category: 'SALARY',
    kind: 'CYCLE_PENDING',
    isInformational: true,
    movement: null,
    description: entry.hold ? `On Hold — ${monthLabel}` : `Pending Release — ${monthLabel}`,
    cycle,
    reference,
  };
}

function buildCorrectionItem(correction: CorrectionForStatement): RawLedgerItem {
  const cycle: StatementCycleRef = {
    id: correction.payrollEntry.cycle.id,
    year: correction.payrollEntry.cycle.year,
    month: correction.payrollEntry.cycle.month,
  };
  return {
    id: `correction:${correction.id}`,
    date: correction.approvedAt,
    periodKey: periodKeyOf(cycle.year, cycle.month),
    kindPriority: KIND_SEQUENCE_PRIORITY.CORRECTION_APPROVED,
    category: 'CORRECTION',
    kind: 'CORRECTION_APPROVED',
    isInformational: true,
    movement: null,
    description: `Correction Approved — ${correction.adjustmentType.label}: ${humanizeCorrectionField(correction.field)} changed from ${correction.oldValue} to ${correction.newValue} (${correction.reason})`,
    cycle,
    reference: { correctionId: correction.id, payrollEntryId: correction.payrollEntry.id },
  };
}

/** The `siteId` this adjustment's origin `PayrollEntry` belongs to — exactly one of `correction`/
 * `originPayrollEntry` is ever set (`BalanceAdjustment_origin_xor_check`), matching the sign
 * convention already established for `PayrollEntry.payoutOutcome`. */
function balanceAdjustmentOriginSiteId(ba: BalanceAdjustmentForStatement): string {
  return ba.correction?.payrollEntry.siteId ?? ba.originPayrollEntry!.siteId;
}

function balanceKindOf(type: 'PAYABLE' | 'RECOVERY'): StatementBalanceKind {
  return type === 'PAYABLE' ? 'PAYABLE' : 'RECOVERABLE';
}

function buildBalanceAdjustmentItems(ba: BalanceAdjustmentForStatement): RawLedgerItem[] {
  const items: RawLedgerItem[] = [];
  const cycle: StatementCycleRef = { id: ba.sourceCycle.id, year: ba.sourceCycle.year, month: ba.sourceCycle.month };
  const reference: StatementLedgerReference = { balanceAdjustmentId: ba.id, ...(ba.correctionId ? { correctionId: ba.correctionId } : {}) };

  // A `NONE`-type row (zero net difference) carries no movement — schema-legal but structurally
  // unreachable via the current approval path (`corrections.calculation.ts`'s `classifyDelta`
  // throws `ZERO_DELTA` instead of creating one), per decision 6 ("use current REAL implementation
  // behaviour as authoritative"). Handled defensively rather than assumed impossible.
  if (ba.type !== 'NONE') {
    items.push({
      id: `balance-adjustment-created:${ba.id}`,
      date: ba.correction?.approvedAt ?? ba.createdAt,
      periodKey: periodKeyOf(cycle.year, cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.BALANCE_ADJUSTMENT_CREATED,
      category: 'CORRECTION',
      kind: 'BALANCE_ADJUSTMENT_CREATED',
      isInformational: false,
      movement: { balance: balanceKindOf(ba.type), direction: 'INCREASE', amount: new Decimal(ba.amount.toString()) },
      description: ba.remark,
      cycle,
      reference,
    });
  }

  let remainingBefore = new Decimal(ba.amount.toString());
  const settlementLabel = ba.type === 'PAYABLE' ? 'Balance Salary Payable' : 'Salary Recovery';
  for (const settlement of ba.settlements) {
    const applied = new Decimal(settlement.amountApplied.toString());
    const remainingAfter = remainingBefore.minus(applied);
    items.push({
      id: `balance-adjustment-settlement:${settlement.id}`,
      date: settlement.appliedAt,
      periodKey: periodKeyOf(settlement.cycle.year, settlement.cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.BALANCE_ADJUSTMENT_SETTLED,
      category: 'CORRECTION',
      kind: 'BALANCE_ADJUSTMENT_SETTLED',
      isInformational: ba.type === 'NONE',
      movement: ba.type === 'NONE' ? null : { balance: balanceKindOf(ba.type), direction: 'DECREASE', amount: applied },
      description: `${settlementLabel} Settled — ${settlement.cycle.year}-${String(settlement.cycle.month).padStart(2, '0')}: PKR ${applied.toFixed(2)} applied (remaining after: PKR ${remainingAfter.toFixed(2)})`,
      cycle: { id: settlement.cycle.id, year: settlement.cycle.year, month: settlement.cycle.month },
      reference: { ...reference, balanceAdjustmentSettlementId: settlement.id },
    });
    remainingBefore = remainingAfter;
  }

  if (ba.correctionPayment) {
    const amount = new Decimal(ba.correctionPayment.amount.toString());
    items.push({
      id: `correction-payment:${ba.correctionPayment.id}`,
      date: ba.correctionPayment.paidAt,
      // Anchored to the originating BalanceAdjustment's own `sourceCycle` — the same period its
      // creation event uses — rather than the raw `paidAt` action timestamp, matching the Advance
      // schedule-change/cancellation anchoring above: a `CorrectionPayment` only ever exists for an
      // `IMMEDIATE` `PAYABLE` (paid out promptly, by definition, not deferred to a future cycle), so
      // its natural period identity is "when the obligation arose," not an incidental clock time.
      periodKey: periodKeyOf(cycle.year, cycle.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.CORRECTION_PAYMENT,
      category: 'CORRECTION',
      kind: 'CORRECTION_PAYMENT',
      isInformational: false,
      movement: { balance: 'PAYABLE', direction: 'DECREASE', amount },
      description: `Correction Payment (standalone) — PKR ${amount.toFixed(2)} paid on ${isoDate(ba.correctionPayment.paidAt)}`,
      cycle: null,
      reference: { ...reference, correctionPaymentId: ba.correctionPayment.id },
    });
  }

  return items;
}

/** Every `PayrollEntry` for this employee, unfiltered by site — the Advances sub-ledger is gated as
 * one all-or-nothing unit by the employee's *current* site (module doc comment), so deduction events
 * are derived from the employee's full entry history regardless of which historical site each entry
 * itself belonged to. */
function buildAdvanceItems(advance: AdvanceForStatement, allEntries: PayrollEntryForStatement[]): RawLedgerItem[] {
  const items: RawLedgerItem[] = [];
  const label = advance.type === 'LOAN' ? 'Advance' : 'Eid Advance';
  const totalAmount = new Decimal(advance.totalAmount.toString());

  items.push({
    id: `advance-given:${advance.id}`,
    date: advance.dateGiven,
    periodKey: periodKeyOfDate(advance.dateGiven),
    kindPriority: KIND_SEQUENCE_PRIORITY.ADVANCE_GIVEN,
    category: 'ADVANCE',
    kind: 'ADVANCE_GIVEN',
    isInformational: false,
    movement: { balance: 'ADVANCE', direction: 'INCREASE', amount: totalAmount },
    description: `${label} Given: PKR ${totalAmount.toFixed(2)}`,
    cycle: null,
    reference: { advanceId: advance.id },
  });

  for (const change of advance.scheduleChanges) {
    items.push({
      id: `advance-schedule-change:${change.id}`,
      date: change.changedAt,
      // Anchored to the period being deferred *from* (`fromPeriod`), not the raw action timestamp —
      // a deferral is meaningfully "about" the period it removed a deduction from, so it belongs in
      // that period's own place in the ledger, not wherever real wall-clock time happened to be when
      // an operator clicked the button (which could be well after the fact).
      periodKey: periodKeyOf(change.fromPeriod.year, change.fromPeriod.month),
      kindPriority: KIND_SEQUENCE_PRIORITY.ADVANCE_SCHEDULE_CHANGED,
      category: 'ADVANCE',
      kind: 'ADVANCE_SCHEDULE_CHANGED',
      isInformational: true,
      movement: null,
      description: `${label} Deferred — from ${change.fromPeriod.year}-${String(change.fromPeriod.month).padStart(2, '0')} to ${change.toPeriod.year}-${String(change.toPeriod.month).padStart(2, '0')} (${change.reason})`,
      cycle: null,
      reference: { advanceId: advance.id, advanceScheduleChangeId: change.id },
    });
  }

  // Deduction events are derived structurally from whichever `PayrollEntry` row *currently* links
  // this advance with a non-zero deduction — see the module doc comment's "correctness-over-
  // truncation" note: a deduction that was later deferred/cancelled/edited away before ever
  // releasing has already had its linking FK/amount reset to null/zero on that same row (the
  // reversal paths in `advances.service.ts`), so it correctly produces no event here at all; a
  // *released* deduction is immutable (Principle 9) and therefore always structurally present,
  // however many cycles ago it happened.
  for (const entry of allEntries) {
    if (advance.type === 'LOAN' && entry.advanceId === advance.id && entry.advanceDeduction.greaterThan(0)) {
      items.push(buildAdvanceDeductionItem(advance, entry, entry.advanceDeduction));
    } else if (advance.type === 'EID_ADVANCE' && entry.eidAdvanceId === advance.id && entry.eidAdvanceDeduction.greaterThan(0)) {
      items.push(buildAdvanceDeductionItem(advance, entry, entry.eidAdvanceDeduction));
    }
  }

  if (advance.status === 'PAID_OFF') {
    const finalEntry = allEntries.find(
      (entry) => entry.released && (entry.advanceId === advance.id || entry.eidAdvanceId === advance.id),
    );
    const cycle = finalEntry ? { id: finalEntry.cycle.id, year: finalEntry.cycle.year, month: finalEntry.cycle.month } : null;
    const date = finalEntry?.releasedAt ?? advance.updatedAt;
    items.push({
      id: `advance-paid-off:${advance.id}`,
      date,
      periodKey: cycle ? periodKeyOf(cycle.year, cycle.month) : periodKeyOfDate(date),
      kindPriority: KIND_SEQUENCE_PRIORITY.ADVANCE_PAID_OFF,
      category: 'ADVANCE',
      kind: 'ADVANCE_PAID_OFF',
      isInformational: true,
      movement: null,
      description: `${label} fully repaid`,
      cycle,
      reference: { advanceId: advance.id, ...(finalEntry ? { payrollEntryId: finalEntry.id } : {}) },
    });
  }

  if (advance.status === 'CANCELLED') {
    // `Advance` has no dedicated `cancelledAt`/`cancellationReason` column (schema.prisma) — the
    // reason text lives only in `AuditLog` metadata (`advance.cancelled`), which this checkpoint
    // deliberately does not query as a ledger source (module doc comment). `updatedAt` is still the
    // best structurally-available *timestamp* for display/tie-break, but `originalScheduledPeriodId`
    // — the one period anchor an Advance always retains, even after `currentScheduledPeriodId` is
    // cleared on cancellation — anchors its *period* attribution, for the same reason a schedule
    // change is anchored to `fromPeriod` above.
    //
    // v1.0.4 Cancel Business Semantics fix: cancelling waives whatever remained unrecovered — this
    // ledger's own running `advanceOutstanding` must reflect that, exactly like every other
    // Advance/BalanceAdjustment movement here. `cancelAdvance` (`advances.service.ts`) already
    // reverses any live unreleased Draft deduction back into `outstandingBalance` before this query
    // ever runs, so the value read here is precisely the true waived remainder — never zeroed by
    // `cancelAdvance` itself (that would have made the `ADVANCE_GIVEN` increase and every real
    // released-deduction decrease disagree with the true recovered history), so this DECREASE is
    // this ledger's own, one-time "waived" event, mirroring `BALANCE_ADJUSTMENT_SETTLED`'s identical
    // `movement: null` only when there is truly nothing left to move (`ba.type === 'NONE'`) pattern
    // just above. No new field, no schema change — `outstandingBalance` was already fetched.
    const waivedRemainder = new Decimal(advance.outstandingBalance.toString());
    const hasWaivedRemainder = waivedRemainder.greaterThan(0);
    items.push({
      id: `advance-cancelled:${advance.id}`,
      date: advance.updatedAt,
      periodKey: advance.originalScheduledPeriod
        ? periodKeyOf(advance.originalScheduledPeriod.year, advance.originalScheduledPeriod.month)
        : periodKeyOfDate(advance.updatedAt),
      kindPriority: KIND_SEQUENCE_PRIORITY.ADVANCE_CANCELLED,
      category: 'ADVANCE',
      kind: 'ADVANCE_CANCELLED',
      isInformational: !hasWaivedRemainder,
      movement: hasWaivedRemainder ? { balance: 'ADVANCE', direction: 'DECREASE', amount: waivedRemainder } : null,
      description: hasWaivedRemainder
        ? `${label} Cancelled — PKR ${waivedRemainder.toFixed(2)} waived`
        : `${label} Cancelled`,
      cycle: null,
      reference: { advanceId: advance.id },
    });
  }

  return items;
}

function buildAdvanceDeductionItem(advance: AdvanceForStatement, entry: PayrollEntryForStatement, amount: Prisma.Decimal): RawLedgerItem {
  const label = advance.type === 'LOAN' ? 'Advance' : 'Eid Advance';
  const cycle: StatementCycleRef = { id: entry.cycle.id, year: entry.cycle.year, month: entry.cycle.month };
  const monthLabel = `${cycle.year}-${String(cycle.month).padStart(2, '0')}`;
  const isFinal = entry.released;
  const decimalAmount = new Decimal(amount.toString());
  return {
    id: `advance-deduction:${entry.id}:${advance.id}`,
    date: entry.released ? entry.releasedAt! : entry.updatedAt,
    periodKey: periodKeyOf(cycle.year, cycle.month),
    kindPriority: isFinal ? KIND_SEQUENCE_PRIORITY.ADVANCE_DEDUCTION_FINAL : KIND_SEQUENCE_PRIORITY.ADVANCE_DEDUCTION_RESERVED,
    category: 'ADVANCE',
    kind: isFinal ? 'ADVANCE_DEDUCTION_FINAL' : 'ADVANCE_DEDUCTION_RESERVED',
    isInformational: false,
    movement: { balance: 'ADVANCE', direction: 'DECREASE', amount: decimalAmount },
    description: isFinal
      ? `${label} Deduction (final) — ${monthLabel}: PKR ${decimalAmount.toFixed(2)}`
      : `${label} Deduction (reserved, pending release — reversible) — ${monthLabel}: PKR ${decimalAmount.toFixed(2)}`,
    cycle,
    reference: { advanceId: advance.id, payrollEntryId: entry.id },
  };
}

// --- Assembly --------------------------------------------------------------------------------

function applyMovement(running: StatementBalances, movement: RawLedgerItem['movement']): StatementBalances {
  if (!movement) return running;
  const key: keyof StatementBalances =
    movement.balance === 'PAYABLE' ? 'payableOutstanding' : movement.balance === 'RECOVERABLE' ? 'recoveryOutstanding' : 'advanceOutstanding';
  const current = new Decimal(running[key]);
  const next = movement.direction === 'INCREASE' ? current.plus(movement.amount) : current.minus(movement.amount);
  return { ...running, [key]: next.toFixed(2) };
}

export async function getEmployeeStatement(
  currentUser: SessionUser,
  employeeId: string,
  params: GetEmployeeStatementParams,
): Promise<EmployeeStatement> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { site: { select: { id: true, name: true } } },
  });
  if (!employee) {
    throw notFound('Employee not found');
  }

  const accessibleSiteIds = getAccessibleSiteIds(currentUser);
  const unrestricted = accessibleSiteIds === undefined;
  const inScope = (siteId: string) => unrestricted || accessibleSiteIds!.includes(siteId);

  const range = await resolveStatementRange(params);

  const [payrollEntries, corrections, balanceAdjustments, advances] = await Promise.all([
    prisma.payrollEntry.findMany({
      where: { employeeId },
      include: payrollEntryInclude,
      orderBy: [{ cycle: { year: 'asc' } }, { cycle: { month: 'asc' } }],
    }),
    prisma.correction.findMany({
      where: { payrollEntry: { employeeId } },
      include: correctionInclude,
      orderBy: { approvedAt: 'asc' },
    }),
    prisma.balanceAdjustment.findMany({
      where: { employeeId },
      include: balanceAdjustmentInclude,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.advance.findMany({
      where: { employeeId },
      include: advanceInclude,
      orderBy: { dateGiven: 'asc' },
    }),
  ]);

  const visibleEntries = payrollEntries.filter((entry) => inScope(entry.siteId));
  const advanceVisible = inScope(employee.siteId);

  if (visibleEntries.length === 0 && !advanceVisible) {
    // Zero overlap between what this caller may see and what this employee actually has — reveal
    // nothing (same "404, not 403" posture Payslips already established for a released/held gate),
    // rather than confirming the employee exists with an empty-but-200 response.
    throw notFound('Employee not found');
  }

  const rawItems: RawLedgerItem[] = [];

  for (const entry of visibleEntries) {
    rawItems.push(buildCycleOutcomeItem(entry));
  }

  for (const correction of corrections) {
    if (!inScope(correction.payrollEntry.siteId)) continue;
    rawItems.push(buildCorrectionItem(correction));
  }

  for (const ba of balanceAdjustments) {
    if (!inScope(balanceAdjustmentOriginSiteId(ba))) continue;
    rawItems.push(...buildBalanceAdjustmentItems(ba));
  }

  if (advanceVisible) {
    for (const advance of advances) {
      rawItems.push(...buildAdvanceItems(advance, payrollEntries));
    }
  }

  const sorted = sortRawItems(rawItems);

  let running = zeroBalances();
  let openingBalances = zeroBalances();
  const entries: StatementLedgerEntry[] = [];
  let sequence = 0;

  for (const item of sorted) {
    if (item.periodKey < range.fromKey) {
      // Still before the requested window — advance the running balance (needed for a correct
      // opening figure) without emitting a displayed row.
      running = applyMovement(running, item.movement);
      openingBalances = running;
      sequence += 1;
      continue;
    }

    running = applyMovement(running, item.movement);

    if (item.periodKey > range.toKey) {
      // Past the requested window entirely — `sorted` is one single global order (not pre-clipped),
      // so later items could in principle still exist; simply stop emitting displayed rows for them
      // while still keeping `running`/`sequence` internally consistent.
      sequence += 1;
      continue;
    }

    entries.push({
      id: item.id,
      date: isoDate(item.date),
      cycleId: item.cycle?.id ?? null,
      cycleYear: item.cycle?.year ?? null,
      cycleMonth: item.cycle?.month ?? null,
      category: item.category,
      kind: item.kind,
      isInformational: item.isInformational,
      movement: item.movement
        ? { balance: item.movement.balance, direction: item.movement.direction, amount: item.movement.amount.toFixed(2) }
        : null,
      runningBalances: running,
      description: item.description,
      reference: item.reference,
      sequence,
    });
    sequence += 1;
  }

  const closingBalances = entries.length > 0 ? entries[entries.length - 1]!.runningBalances : openingBalances;

  // Structured, explicit scope metadata (Phase 7A Checkpoint 1 gap-closure) — `advanceVisible` is
  // the same all-or-nothing gate §7's own doc comment already establishes; this just makes the
  // *reason* for its effect on `entries`/`closingBalances.advanceOutstanding` a first-class,
  // machine-readable field instead of something a caller would otherwise have to infer from an
  // empty Advance history that might just as easily mean "none exists." Carries no count, amount,
  // or other detail about whatever is actually hidden — see `StatementScope`'s own doc comment.
  const scope: StatementScope = advanceVisible
    ? { advanceHistoryIncluded: true }
    : { advanceHistoryIncluded: false, advanceHistoryRestriction: 'CURRENT_SITE_OUT_OF_SCOPE' };

  return {
    employee: {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      cnic: employee.cnic,
      name: employee.name,
      currentSiteId: employee.siteId,
      currentSiteName: employee.site.name,
    },
    range: { fromCycle: range.fromCycle, toCycle: range.toCycle, cycleCount: range.cycleCount },
    scope,
    openingBalances,
    closingBalances,
    entries,
    generatedAt: new Date().toISOString(),
  };
}

// --- PDF export (Phase 7B Checkpoint 1) -------------------------------------------------------

/** Request-specific rendering context — who is generating this PDF and when. Deliberately kept
 * separate from the `EmployeeStatement` DTO itself, exactly matching `templates/payslip.ts`'s own
 * `PayslipPdfMeta { generatedByName, generatedAt }` shape: the DTO is a pure function of
 * `(employeeId, range)` and must stay that way, never polluted with who happens to be asking right
 * now. Company identity is resolved separately by `generateStatementPdf` below (a live
 * `CompanySettings` read, the same accepted, documented gap `payslips.service.ts`'s own module doc
 * comment already carries for Payslip PDFs) and merged into the full `StatementPdfMeta` the
 * template actually consumes. */
export interface StatementPdfRequestMeta {
  generatedByName: string;
  generatedAt: Date;
}

export interface StatementPdfResult {
  buffer: Buffer;
  employee: StatementEmployeeIdentity;
  range: StatementRange;
  entryCount: number;
}

/**
 * Assembles one Employee Statement PDF — calls `getEmployeeStatement()` **exactly once** (never
 * re-queried by the template or the route), matching `payslips.service.ts`'s `generatePayslipPdf`'s
 * own "no independent Prisma query" contract for a PDF-generating wrapper. `getCompanySettings()`
 * is the one additional read this needs beyond the canonical Statement itself — called only after
 * `getEmployeeStatement` has already succeeded (mirroring `getPayslip()`'s own ordering: validate/
 * authorize the underlying record first, fetch Company Settings second), so the common
 * unauthorized/concealed-not-found path never pays for a Company Settings read it will never use.
 *
 * Every RBAC/historical-site-scope/concealment rule is enforced entirely inside
 * `getEmployeeStatement` itself — this function adds no authorization logic of its own, exactly
 * the same "gated by the JSON route's own function, not reimplemented" relationship
 * `generatePayslipPdf`/`getPayslip` already establish.
 */
export async function generateStatementPdf(
  currentUser: SessionUser,
  employeeId: string,
  params: GetEmployeeStatementParams,
  requestMeta: StatementPdfRequestMeta,
): Promise<StatementPdfResult> {
  const statement = await getEmployeeStatement(currentUser, employeeId, params);
  const companySettings = await getCompanySettings();
  // Passes the already-fetched row's own `logoStorageKey` through — avoids a second, redundant
  // `getCompanySettings()` read (see `getCompanyLogoDataUri`'s own doc comment).
  const companyLogoDataUri = await getCompanyLogoDataUri(companySettings.logoStorageKey);

  const meta: StatementPdfMeta = {
    companyName: companySettings.companyName,
    registeredAddress: companySettings.registeredAddress,
    generatedByName: requestMeta.generatedByName,
    generatedAt: requestMeta.generatedAt,
    companyLogoDataUri,
  };

  const buffer = await renderStatementPdfBuffer(statement, meta);
  return { buffer, employee: statement.employee, range: statement.range, entryCount: statement.entries.length };
}

/**
 * Renders one already-assembled `EmployeeStatement` to a PDF `Buffer` — the thin two-call wrapper
 * (`renderStatementHtml` then `renderHtmlToPdf`) both `generateStatementPdf()` above and any future
 * batch caller would share, exactly matching `renderPayslipPdfBuffer`'s own documented role.
 * `displayHeaderFooter`/`footerTemplate` are turned on here (unlike Payslip's own call, which needs
 * neither for a single-page document) — a Statement may span many pages, so every rendered PDF
 * gets a page-number footer regardless of how many pages it actually turns out to be. Stateless:
 * returns a `Buffer` only, nothing is ever written to disk or persisted (Principle 1 applies to
 * exports exactly as it does to the ledger data itself).
 */
export async function renderStatementPdfBuffer(statement: EmployeeStatement, meta: StatementPdfMeta): Promise<Buffer> {
  const html = renderStatementHtml(statement, meta);
  return renderHtmlToPdf(html, { displayHeaderFooter: true, footerTemplate: STATEMENT_PDF_FOOTER_TEMPLATE });
}

// --- Excel/CSV export (Phase 7B Checkpoint 2) ---------------------------------------------------

/** Identical shape and role to `StatementPdfRequestMeta` (who is generating this export and when)
 * — kept as its own type since Excel/CSV are a different rendering path than the PDF template, not
 * because the shape differs. */
export interface StatementExportRequestMeta {
  generatedByName: string;
  generatedAt: Date;
}

export interface StatementExportResult {
  buffer: Buffer;
  employee: StatementEmployeeIdentity;
  range: StatementRange;
  entryCount: number;
}

interface StatementExportMeta {
  companyName: string;
  generatedByName: string;
  generatedAt: Date;
}

/** Resolves the same live `CompanySettings` read `generateStatementPdf` already performs, merged
 * with the caller's request-specific meta — one additional read beyond the canonical Statement
 * itself, called only after `getEmployeeStatement` has already succeeded (identical ordering to the
 * PDF path, so the common unauthorized/concealed-not-found path never pays for a read it will never
 * use). */
async function resolveStatementExportMeta(requestMeta: StatementExportRequestMeta): Promise<StatementExportMeta> {
  const companySettings = await getCompanySettings();
  return {
    companyName: companySettings.companyName,
    generatedByName: requestMeta.generatedByName,
    generatedAt: requestMeta.generatedAt,
  };
}

const STATEMENT_LEDGER_EXPORT_HEADERS = [
  'Date / Period',
  'Category',
  'Description',
  'Movement',
  'Running Payable',
  'Running Recovery',
  'Running Advance',
] as const;

const STATEMENT_BALANCE_EXPORT_HEADERS = ['Payable to Employee', 'Recoverable from Employee', 'Advance'] as const;

/** A `StatementBalances` triple, flattened to its exported row — **financial invariant**: reads
 * `payableOutstanding`/`recoveryOutstanding`/`advanceOutstanding` directly off the balances object
 * passed in, verbatim, never summed or recomputed. The one call site for `statement.openingBalances`
 * and the one for `statement.closingBalances` (in `exportStatementToCsv`/`exportStatementToXlsx`
 * below) are therefore the *only* places those two DTO fields are ever read for export — there is no
 * second, independent balance calculation anywhere in this file. */
function statementBalanceExportRow(balances: StatementBalances): string[] {
  return [balances.payableOutstanding, balances.recoveryOutstanding, balances.advanceOutstanding];
}

/**
 * One ledger row's Movement cell, as plain text — mirrors `templates/statement.ts`'s own
 * `movementCell` exactly (same `null` → literal "Informational" rule, same sign-from-`direction`
 * rule, same `statementBalanceShortLabel` for the trailing balance tag) except the amount is
 * rendered as `entry.movement.amount`'s own raw decimal string, never passed through a display
 * formatter — matching Bank Sheets'/Cash Receiving's own export precedent, where `buildExportRow`
 * exports `row.netSalary` as its own unformatted decimal string rather than a currency-formatted
 * one (`bank-sheets.service.ts`). `direction` supplies the sign character for display only; the
 * DTO's own `amount` is always a positive magnitude string (`StatementMovement`'s own doc comment).
 */
function statementMovementExportCell(entry: StatementLedgerEntry): string {
  if (!entry.movement) return 'Informational';
  const sign = entry.movement.direction === 'INCREASE' ? '+' : '-';
  return `${sign} ${entry.movement.amount} (${statementBalanceShortLabel(entry.movement.balance)})`;
}

/**
 * Flattens one `StatementLedgerEntry` to its exported row shape — the single row-builder shared by
 * both `exportStatementToCsv` and `exportStatementToXlsx` below, matching Bank Sheets'/Cash
 * Receiving's own `buildExportRow` precedent (one flattening function per module, never duplicated
 * per format).
 *
 * **Financial invariant (documented exactly as `templates/statement.ts`'s own module doc comment
 * documents it for the PDF template): every balance cell below is read directly from
 * `entry.runningBalances` — never summed, inferred from a neighbouring row, or recomputed.** The
 * canonical `EmployeeStatement` DTO, built once by `getEmployeeStatement()`, is the sole financial
 * source of truth for every export format (PDF, XLSX, CSV) — this function adds no calculation of
 * its own, only formatting.
 */
export function buildStatementLedgerExportRow(entry: StatementLedgerEntry): string[] {
  return [
    entryDateLabel(entry),
    statementCategoryLabel(entry.category),
    entry.description,
    statementMovementExportCell(entry),
    entry.runningBalances.payableOutstanding,
    entry.runningBalances.recoveryOutstanding,
    entry.runningBalances.advanceOutstanding,
  ];
}

/** Mirrors `templates/statement.ts`'s own `advanceRestrictionNotice` — identical trigger condition
 * (`scope.advanceHistoryIncluded === false`) and identical wording, as plain rows instead of an
 * HTML block. Returns no rows at all when Advance history is not restricted, matching the PDF's own
 * "renders nothing" behaviour exactly — so Advance restriction behaviour is identical across every
 * export format, never a divergent notice. */
function statementAdvanceRestrictionExportRows(statement: EmployeeStatement): string[][] {
  if (statement.scope.advanceHistoryIncluded) return [];
  return [
    ['Advance history restricted.'],
    [
      `${statement.employee.name}'s current Site is outside your assigned Site access, so their Advance history is not included in this Statement. Salary and Correction entries you have access to are shown in full below.`,
    ],
    [],
  ];
}

/**
 * Assembles the full row-block layout shared by both export formats — company/title/period,
 * employee identity, the Advance-restriction notice (when applicable), Opening Balances, the
 * ledger, and Closing Balances — mirroring `renderStatementHtml`'s own section order (Phase 7B
 * Checkpoint 1) so a CSV/XLSX export and the PDF present the identical structure, never a divergent
 * shape. Every balance/movement cell traces directly back to the `EmployeeStatement` DTO — see
 * `buildStatementLedgerExportRow`'s and `statementBalanceExportRow`'s own doc comments for the same
 * invariant stated at the row level. Returned as a plain `string[][]`; `exportStatementToCsv` passes
 * it straight to `stringifyCsvSafe`, and `exportStatementToXlsx` writes the identical rows into a
 * worksheet one at a time so both formats render the same content from the same source.
 */
function buildStatementExportBlocks(statement: EmployeeStatement, meta: StatementExportMeta): string[][] {
  const { employee, range, entries } = statement;
  const ledgerRows =
    entries.length > 0 ? entries.map(buildStatementLedgerExportRow) : [['No ledger entries for this Statement Period']];

  return [
    [meta.companyName],
    [`Employee Statement of Account — ${statementPeriodLabel(range)}`],
    [],
    ['Employee Name', employee.name],
    ['Employee Code', employee.employeeCode ?? '—'],
    ['CNIC', employee.cnic ?? '—'],
    ['Current Site', employee.currentSiteName],
    [],
    ...statementAdvanceRestrictionExportRows(statement),
    ['Opening Balances (brought forward)'],
    [...STATEMENT_BALANCE_EXPORT_HEADERS],
    statementBalanceExportRow(statement.openingBalances),
    [],
    [...STATEMENT_LEDGER_EXPORT_HEADERS],
    ...ledgerRows,
    [],
    ['Closing Balances'],
    [...STATEMENT_BALANCE_EXPORT_HEADERS],
    statementBalanceExportRow(statement.closingBalances),
    [],
    [`Generated By: ${meta.generatedByName}`, `Generated On: ${meta.generatedAt.toLocaleString('en-US')}`],
  ];
}

/**
 * Exports one Employee Statement as CSV — calls `getEmployeeStatement()` **exactly once**, exactly
 * like `generateStatementPdf` does, so every RBAC/historical-site-scope/concealment rule is enforced
 * entirely inside that function and never reimplemented here. Reuses this codebase's one mandatory
 * CSV-serialization entry point, `stringifyCsvSafe` (`common/import-export.ts`), which routes every
 * cell through `sanitizeCsvCell` for formula-injection neutralization — no new serializer, escaping,
 * quoting, delimiter, or BOM is introduced.
 */
export async function exportStatementToCsv(
  currentUser: SessionUser,
  employeeId: string,
  params: GetEmployeeStatementParams,
  requestMeta: StatementExportRequestMeta,
): Promise<StatementExportResult> {
  const statement = await getEmployeeStatement(currentUser, employeeId, params);
  const meta = await resolveStatementExportMeta(requestMeta);
  const csv = stringifyCsvSafe(buildStatementExportBlocks(statement, meta));
  return {
    buffer: Buffer.from(csv, 'utf-8'),
    employee: statement.employee,
    range: statement.range,
    entryCount: statement.entries.length,
  };
}

/**
 * Exports one Employee Statement as XLSX — calls `getEmployeeStatement()` **exactly once**, same
 * RBAC/scope/concealment relationship as `exportStatementToCsv` above. Uses this codebase's existing
 * export style vocabulary only (bold title/section/header rows via ExcelJS's `font: { bold: true }`,
 * content-driven column widths): no formulas, no calculated totals, no Excel currency `numFmt`, no
 * conditional formatting, and no `pageSetup`/print settings, matching Bank Sheets'/Cash Receiving's
 * own XLSX exports, neither of which use those features either.
 */
export async function exportStatementToXlsx(
  currentUser: SessionUser,
  employeeId: string,
  params: GetEmployeeStatementParams,
  requestMeta: StatementExportRequestMeta,
): Promise<StatementExportResult> {
  const statement = await getEmployeeStatement(currentUser, employeeId, params);
  const meta = await resolveStatementExportMeta(requestMeta);
  const { employee, range, entries } = statement;
  const ledgerRows =
    entries.length > 0 ? entries.map(buildStatementLedgerExportRow) : [['No ledger entries for this Statement Period']];

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Employee Statement');

  worksheet.addRow([meta.companyName]).font = { bold: true, size: 13 };
  worksheet.addRow([`Employee Statement of Account — ${statementPeriodLabel(range)}`]);
  worksheet.addRow([]);

  worksheet.addRow(['Employee Name', employee.name]);
  worksheet.addRow(['Employee Code', employee.employeeCode ?? '—']);
  worksheet.addRow(['CNIC', employee.cnic ?? '—']);
  worksheet.addRow(['Current Site', employee.currentSiteName]);
  worksheet.addRow([]);

  for (const row of statementAdvanceRestrictionExportRows(statement)) worksheet.addRow(row);

  worksheet.addRow(['Opening Balances (brought forward)']).font = { bold: true };
  worksheet.addRow([...STATEMENT_BALANCE_EXPORT_HEADERS]).font = { bold: true };
  worksheet.addRow(statementBalanceExportRow(statement.openingBalances));
  worksheet.addRow([]);

  worksheet.addRow([...STATEMENT_LEDGER_EXPORT_HEADERS]).font = { bold: true };
  for (const row of ledgerRows) worksheet.addRow(row);
  worksheet.addRow([]);

  worksheet.addRow(['Closing Balances']).font = { bold: true };
  worksheet.addRow([...STATEMENT_BALANCE_EXPORT_HEADERS]).font = { bold: true };
  worksheet.addRow(statementBalanceExportRow(statement.closingBalances));

  // Dynamic Width Rule, applied to the 7-column ledger — the dominant content on this sheet. The
  // narrower company/employee-identity/balance rows above and below are left at these same
  // widths; a short label in a row with empty trailing cells overflows visually into them exactly
  // like Cash Receiving's own multi-block XLSX export already does, never truncating.
  STATEMENT_LEDGER_EXPORT_HEADERS.forEach((header, index) => {
    const columnValues = ledgerRows.map((row) => row[index] ?? '');
    worksheet.getColumn(index + 1).width = excelColumnWidth(header, columnValues);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    employee: statement.employee,
    range: statement.range,
    entryCount: statement.entries.length,
  };
}

// --- Employee discovery for the Statements picker (Phase 7A Checkpoint 2 correction) ----------

/**
 * Thin wrapper around the shared `searchEmployeesByHistoricalPayroll`
 * (`common/historical-payroll-employee-lookup.ts`) — extracted there in Phase 7 Reports, Employee
 * Payroll History Checkpoint 1A once a second caller (that report's own employee lookup) needed
 * this exact query, not a similar one. Behavior-preserving: same signature, same historical
 * `PayrollEntry.siteId`-based discovery, same "no Advance-only employee" limitation, same fixed
 * three-query cost — see the shared function's own doc comment for the full design (RBAC
 * boundary, why this isn't the ordinary current-site-scoped Employee Lookup, the N+1 proof this
 * extraction must not weaken). Kept as a named export here, unchanged, so every existing caller
 * and test continues to import `searchStatementEmployees` from this module.
 */
export async function searchStatementEmployees(
  currentUser: SessionUser,
  params: SearchStatementEmployeesParams,
): Promise<SearchStatementEmployeesResult> {
  return searchEmployeesByHistoricalPayroll(currentUser, params);
}
