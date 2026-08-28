/**
 * **LEGACY_V1 — frozen historical calculation semantics.** This file exists for exactly one reason:
 * to reconstruct, on demand, the financial figures for a `PayrollEntry` that was released before the
 * "CalcNet Precision Rounding Fix" (2026-08-28, see `calc-net.ts`'s own top-of-file comment) cut
 * over to corrected arithmetic, and for which no `PayrollEntryReleaseSnapshot` exists.
 *
 * `calcNetLegacyV1` is a byte-for-byte copy of `calcNet` exactly as it stood immediately before that
 * fix (the divide-first `dailyRate.times(days)` / `otHours.times(dailyRate.dividedBy(8))` /
 * `effectiveLeaveRate.times(leaveDays)` forms) — verified against `git show 9fdb0f6~1` at the time
 * this file was created. Confirmed by git archaeology (see the "Payroll Financial Integrity —
 * Released-Value Immutability Architecture" checkpoint, `docs/PROJECT_PROGRESS.md`) that this was the
 * *only* formula ever used to compute a `PayrollEntry`'s earned/OT/leave amounts from the moment
 * `calcNet`/`PayrollEntry` were first introduced (`aefa64f`, 2026-07-07) through the fix commit
 * (`9fdb0f6`, 2026-08-28) — no intermediate commit touched this arithmetic. This makes "LEGACY_V1" a
 * single, well-defined historical calculation version, not an approximation of several.
 *
 * **This file must never be edited again.** It is not "the old implementation, still around for
 * reference" — it is the permanent, load-bearing definition of what LEGACY_V1 means, read by every
 * historical-financial-surface reconstruction for a released entry that predates snapshotting
 * (`payroll-entry.service.ts`'s `resolveEntryCalc`). If `calcNet` itself is ever corrected again in
 * the future (a hypothetical V3), this file is what keeps that future fix from silently rewriting
 * what a LEGACY_V1-era release is shown to have paid. Any future correction belongs in a new
 * `calc-net-<version>.ts` file, never here and never as a change to current `calc-net.ts` that this
 * file's own historical role depends on staying untouched.
 *
 * Deliberately duplicates `toDecimal`/`roundMoney`/`assertHasWorkLines` from `calc-net.ts` rather than
 * importing them — those are that file's own private helpers, and this file must keep compiling and
 * behaving identically even if `calc-net.ts` internals are refactored later. Only the *types*
 * (`PayrollEntryCalcInput`, `CalcNetResult`, `PayrollWorkLineCalcInput`) are shared, since the input/
 * output *contract* (not the arithmetic) is unaffected by the precision fix and by construction must
 * stay assignable to/from `calcNet`'s own contract.
 */

import { Decimal } from 'decimal.js';
import type { CalcNetResult, PayrollEntryCalcInput, PayrollWorkLineCalcInput, PayrollWorkLineCalcResult } from './calc-net';

const TWO_DP = 2;

function toDecimalLegacy(value: string | number): Decimal {
  return new Decimal(value);
}

function roundMoneyLegacy(value: Decimal): Decimal {
  return value.toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
}

function assertHasWorkLinesLegacy(
  workLines: PayrollWorkLineCalcInput[],
): asserts workLines is [PayrollWorkLineCalcInput, ...PayrollWorkLineCalcInput[]] {
  if (workLines.length === 0) {
    throw new Error('calcNetLegacyV1: a PayrollEntry must have at least one PayrollEntryWorkLine');
  }
}

/**
 * LEGACY_V1 reconstruction — same signature/contract as `calcNet`, deliberately frozen arithmetic.
 * See this file's own top-of-file comment for when this must be called instead of `calcNet`.
 */
export function calcNetLegacyV1(entry: PayrollEntryCalcInput): CalcNetResult {
  assertHasWorkLinesLegacy(entry.workLines);

  const grossPay = toDecimalLegacy(entry.grossPay);
  const primaryLine = [...entry.workLines].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;

  let earnedAmountFull = new Decimal(0);
  let otEarnedFull = new Decimal(0);
  let totalWorkingDaysFull = new Decimal(0);
  const workLineResults: PayrollWorkLineCalcResult[] = [];

  for (const line of entry.workLines) {
    const cycleDays = new Decimal(line.cycleDays);
    const days = toDecimalLegacy(line.days);
    const otHours = toDecimalLegacy(line.otHours);
    totalWorkingDaysFull = totalWorkingDaysFull.plus(days);

    // LEGACY_V1: divide first, then multiply — the confirmed pre-fix defect, deliberately
    // preserved here for historical reconstruction only. See `calc-net.ts` for the corrected form.
    const dailyRate = grossPay.dividedBy(cycleDays);
    const effectiveOtRate =
      line.otRate !== null && line.otRate !== undefined ? toDecimalLegacy(line.otRate) : dailyRate.dividedBy(8);

    const lineEarnedAmount = dailyRate.times(days);
    const lineOtEarned = otHours.times(effectiveOtRate);

    earnedAmountFull = earnedAmountFull.plus(lineEarnedAmount);
    otEarnedFull = otEarnedFull.plus(lineOtEarned);

    workLineResults.push({
      sortOrder: line.sortOrder,
      dailyRate: dailyRate.toString(),
      effectiveOtRate: effectiveOtRate.toString(),
      earnedAmount: roundMoneyLegacy(lineEarnedAmount).toFixed(TWO_DP),
      otEarned: roundMoneyLegacy(lineOtEarned).toFixed(TWO_DP),
    });
  }

  const effectiveLeaveRate =
    entry.leaveRate !== null && entry.leaveRate !== undefined
      ? toDecimalLegacy(entry.leaveRate)
      : grossPay.dividedBy(primaryLine.cycleDays);
  // LEGACY_V1: same divide-first defect for the derived-leave-rate path.
  const leaveEarnedFull = effectiveLeaveRate.times(toDecimalLegacy(entry.leaveDays));

  const earnedAmount = roundMoneyLegacy(earnedAmountFull);
  const otEarned = roundMoneyLegacy(otEarnedFull);
  const leaveEarned = roundMoneyLegacy(leaveEarnedFull);
  const allowance = roundMoneyLegacy(toDecimalLegacy(entry.allowance));

  const correctionBalancePayable = roundMoneyLegacy(toDecimalLegacy(entry.correctionBalancePayable ?? 0));
  const totalEarning = earnedAmount.plus(otEarned).plus(allowance).plus(leaveEarned).plus(correctionBalancePayable);

  const eobiDeduction = entry.eobiApplicable ? roundMoneyLegacy(toDecimalLegacy(entry.eobiAmount)) : new Decimal(0);
  const advanceDeduction = roundMoneyLegacy(toDecimalLegacy(entry.advanceDeduction));
  const eidAdvanceDeduction = roundMoneyLegacy(toDecimalLegacy(entry.eidAdvanceDeduction));
  const fine = roundMoneyLegacy(toDecimalLegacy(entry.fine));
  const correctionBalanceRecovery = roundMoneyLegacy(toDecimalLegacy(entry.correctionBalanceRecovery ?? 0));
  const totalDeduction = eobiDeduction.plus(advanceDeduction).plus(eidAdvanceDeduction).plus(fine).plus(correctionBalanceRecovery);

  const netSalary = totalEarning.minus(totalDeduction);

  return {
    workLines: workLineResults,
    totalWorkingDays: totalWorkingDaysFull.toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP).toString(),
    effectiveLeaveRate: effectiveLeaveRate.toString(),
    earnedAmount: earnedAmount.toFixed(TWO_DP),
    otEarned: otEarned.toFixed(TWO_DP),
    leaveEarned: leaveEarned.toFixed(TWO_DP),
    correctionBalancePayable: correctionBalancePayable.toFixed(TWO_DP),
    totalEarning: totalEarning.toFixed(TWO_DP),
    eobiDeduction: eobiDeduction.toFixed(TWO_DP),
    correctionBalanceRecovery: correctionBalanceRecovery.toFixed(TWO_DP),
    totalDeduction: totalDeduction.toFixed(TWO_DP),
    netSalary: netSalary.toFixed(TWO_DP),
  };
}
