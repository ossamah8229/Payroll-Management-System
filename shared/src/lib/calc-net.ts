/**
 * The single source of truth for net-salary calculation (docs/architecture/database/payroll-entry.md
 * §12/§12a, Principle 5 — deterministic and reproducible calculations). Used identically by
 * backend Payroll Processing, the frontend's live grid totals, import/export, reports, and
 * (Phase 6) correction preview — there must never be a second implementation of this formula.
 *
 * Rounding policy (Phase 3 Checkpoint 0 decision): all arithmetic uses `decimal.js`, never native
 * JS floats. Every intermediate value that feeds a further multiplication/division — the per-line
 * daily rate, effective OT rate, and effective leave rate — is carried at full decimal precision
 * and is NEVER rounded before being used in the next step; rounding a rate first and then
 * multiplying would silently corrupt the result (e.g. grossPay/cycleDays is frequently a
 * repeating decimal). Only once a figure is done being multiplied/divided — earnedAmount,
 * otEarned, leaveEarned — is it rounded to 2 decimal places (`ROUND_HALF_UP`), matching the
 * `numeric(12,2)` precision every stored PKR figure in this system uses. totalEarning,
 * totalDeduction, and netSalary are then pure addition/subtraction of already-2dp-safe values, so
 * no further rounding drift is possible and netSalary always reconciles exactly with
 * totalEarning - totalDeduction as displayed. Per-line breakdown figures returned for transparency
 * are independently rounded for display; the authoritative entry-level totals are always summed
 * from the unrounded per-line values, never from the rounded per-line display figures, to avoid
 * "sum of rounded parts" drift.
 */

import { Decimal } from 'decimal.js';

/** Accepts a decimal string (the wire-format convention used everywhere in this codebase, e.g.
 * `shared/src/schemas/employee.ts`'s `decimalString`) or a plain number. Never accepts a
 * pre-computed float result from elsewhere — inputs must be the original stored figures. */
export type MoneyInput = string | number;

export interface PayrollWorkLineCalcInput {
  /** Only used to identify the "primary" line (lowest sortOrder) for the leave-rate basis, and to
   * echo the line back in the per-line breakdown — has no effect on this line's own arithmetic. */
  sortOrder: number;
  days: MoneyInput;
  otHours: MoneyInput;
  /** `null`/`undefined` ⇒ derive as dailyRate / 8 (§12). */
  otRate?: MoneyInput | null;
  cycleDays: number;
}

export interface PayrollEntryCalcInput {
  grossPay: MoneyInput;
  allowance: MoneyInput;
  leaveDays: MoneyInput;
  /** `null`/`undefined` ⇒ derive from grossPay / primary line's cycleDays (§12). */
  leaveRate?: MoneyInput | null;
  eobiAmount: MoneyInput;
  eobiApplicable: boolean;
  advanceDeduction: MoneyInput;
  eidAdvanceDeduction: MoneyInput;
  fine: MoneyInput;
  /** Always at least one line (docs/architecture/database/payroll-entry.md §12a) — calcNet does not
   * special-case a single-line entry; it is simply the case where every sum below has one term. */
  workLines: PayrollWorkLineCalcInput[];
}

/** Per-line breakdown, for transparency/audit/display only. These figures are independently
 * rounded for display and their sum may differ from the entry-level total by a fraction of a cent
 * in rare cases — the entry-level totals are always the authoritative figures, computed from the
 * unrounded per-line values, never by re-summing this breakdown. */
export interface PayrollWorkLineCalcResult {
  sortOrder: number;
  /** Full precision — a rate, not a final monetary figure; not rounded. */
  dailyRate: string;
  /** Full precision — a rate, not a final monetary figure; not rounded. */
  effectiveOtRate: string;
  /** Rounded to 2dp for display; not the value summed into the entry-level `earnedAmount`. */
  earnedAmount: string;
  /** Rounded to 2dp for display; not the value summed into the entry-level `otEarned`. */
  otEarned: string;
}

export interface CalcNetResult {
  workLines: PayrollWorkLineCalcResult[];
  /** Full precision — a rate, not a final monetary figure; not rounded. */
  effectiveLeaveRate: string;
  /** Final, rounded to 2 decimal places. Sum of every line's unrounded earned amount. */
  earnedAmount: string;
  /** Final, rounded to 2 decimal places. Sum of every line's unrounded OT-earned amount. */
  otEarned: string;
  /** Final, rounded to 2 decimal places. */
  leaveEarned: string;
  /** Final, rounded to 2 decimal places. earnedAmount + otEarned + allowance + leaveEarned. */
  totalEarning: string;
  /** Final, rounded to 2 decimal places. `eobiApplicable ? eobiAmount : 0`. */
  eobiDeduction: string;
  /** Final, rounded to 2 decimal places. eobiDeduction + advanceDeduction + eidAdvanceDeduction + fine. */
  totalDeduction: string;
  /** Final, rounded to 2 decimal places. totalEarning - totalDeduction. */
  netSalary: string;
}

const TWO_DP = 2;

function toDecimal(value: MoneyInput): Decimal {
  return new Decimal(value);
}

/** Rounds to 2dp, half-up (e.g. 0.005 -> 0.01) — the conventional rounding rule for currency,
 * applied only to a "final" monetary figure, per this file's rounding policy above. */
function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
}

/** Every PayrollEntry always has at least one PayrollEntryWorkLine (§12a) — this is a caller-side
 * invariant (enforced transactionally at write time, not by this pure function), asserted here
 * defensively since calcNet has no other way to produce a meaningful dailyRate/primary line. */
function assertHasWorkLines(workLines: PayrollWorkLineCalcInput[]): asserts workLines is [PayrollWorkLineCalcInput, ...PayrollWorkLineCalcInput[]] {
  if (workLines.length === 0) {
    throw new Error('calcNet: a PayrollEntry must have at least one PayrollEntryWorkLine');
  }
}

/**
 * Computes a PayrollEntry's net salary and every named intermediate figure from
 * docs/architecture/database/payroll-entry.md §12, summed across the entry's work lines (§12a). Pure —
 * no I/O, no DB access; the caller is responsible for loading the entry and its work lines first.
 */
export function calcNet(entry: PayrollEntryCalcInput): CalcNetResult {
  assertHasWorkLines(entry.workLines);

  const grossPay = toDecimal(entry.grossPay);

  // Non-null: assertHasWorkLines guarantees at least one element, so a copy of a non-empty
  // array sorted in place always has a [0] element — the `!` reflects that invariant, not an
  // unchecked assumption.
  const primaryLine = [...entry.workLines].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;

  let earnedAmountFull = new Decimal(0);
  let otEarnedFull = new Decimal(0);
  const workLineResults: PayrollWorkLineCalcResult[] = [];

  for (const line of entry.workLines) {
    const cycleDays = new Decimal(line.cycleDays);
    const days = toDecimal(line.days);
    const otHours = toDecimal(line.otHours);

    // Full precision — never rounded before being used in the next multiplication (this file's
    // rounding policy). grossPay/cycleDays is frequently a repeating decimal (e.g. 40000/27).
    const dailyRate = grossPay.dividedBy(cycleDays);
    const effectiveOtRate =
      line.otRate !== null && line.otRate !== undefined ? toDecimal(line.otRate) : dailyRate.dividedBy(8);

    const lineEarnedAmount = dailyRate.times(days);
    const lineOtEarned = otHours.times(effectiveOtRate);

    earnedAmountFull = earnedAmountFull.plus(lineEarnedAmount);
    otEarnedFull = otEarnedFull.plus(lineOtEarned);

    workLineResults.push({
      sortOrder: line.sortOrder,
      dailyRate: dailyRate.toString(),
      effectiveOtRate: effectiveOtRate.toString(),
      earnedAmount: roundMoney(lineEarnedAmount).toFixed(TWO_DP),
      otEarned: roundMoney(lineOtEarned).toFixed(TWO_DP),
    });
  }

  const effectiveLeaveRate =
    entry.leaveRate !== null && entry.leaveRate !== undefined
      ? toDecimal(entry.leaveRate)
      : grossPay.dividedBy(primaryLine.cycleDays);
  const leaveEarnedFull = effectiveLeaveRate.times(toDecimal(entry.leaveDays));

  // From here on, every figure is a final, "done being multiplied/divided" monetary value —
  // rounded once, then only added/subtracted, which introduces no further precision drift.
  const earnedAmount = roundMoney(earnedAmountFull);
  const otEarned = roundMoney(otEarnedFull);
  const leaveEarned = roundMoney(leaveEarnedFull);
  const allowance = roundMoney(toDecimal(entry.allowance));

  const totalEarning = earnedAmount.plus(otEarned).plus(allowance).plus(leaveEarned);

  const eobiDeduction = entry.eobiApplicable ? roundMoney(toDecimal(entry.eobiAmount)) : new Decimal(0);
  const advanceDeduction = roundMoney(toDecimal(entry.advanceDeduction));
  const eidAdvanceDeduction = roundMoney(toDecimal(entry.eidAdvanceDeduction));
  const fine = roundMoney(toDecimal(entry.fine));
  const totalDeduction = eobiDeduction.plus(advanceDeduction).plus(eidAdvanceDeduction).plus(fine);

  const netSalary = totalEarning.minus(totalDeduction);

  return {
    workLines: workLineResults,
    effectiveLeaveRate: effectiveLeaveRate.toString(),
    earnedAmount: earnedAmount.toFixed(TWO_DP),
    otEarned: otEarned.toFixed(TWO_DP),
    leaveEarned: leaveEarned.toFixed(TWO_DP),
    totalEarning: totalEarning.toFixed(TWO_DP),
    eobiDeduction: eobiDeduction.toFixed(TWO_DP),
    totalDeduction: totalDeduction.toFixed(TWO_DP),
    netSalary: netSalary.toFixed(TWO_DP),
  };
}

/**
 * Sums a list of monetary decimal strings using `decimal.js`, never native floats — the same
 * rounding-policy requirement `calcNet` itself follows (Principle 5). Added Phase 4 Checkpoint 3
 * for Bank Sheet totals (a plain sum of already-2dp `netSalary` figures, no further calculation),
 * but generic enough for any other "sum of monetary strings" need — one implementation, not one
 * per caller.
 */
export function sumMoney(values: MoneyInput[]): string {
  const total = values.reduce((sum, value) => sum.plus(toDecimal(value)), new Decimal(0));
  return roundMoney(total).toFixed(TWO_DP);
}
