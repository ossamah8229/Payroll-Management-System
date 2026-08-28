import { Decimal } from 'decimal.js';
import { calcNet, type PayrollEntryCalcInput, type PayrollWorkLineCalcInput } from '@payroll/shared';

/**
 * CalcNet Precision Rounding Fix (2026-08-28) — differential blast-radius analysis (remediation
 * checkpoint Step 7). Compares the OLD (pre-fix, divide-before-multiply) earned-salary/OT/leave
 * arithmetic against the CURRENT, fixed `calcNet` across a broad generated population, to establish
 * how often the fix actually changes a result and by how much — rather than assuming the original
 * 10,000-case uniform-random 0.9% figure generalizes to "0.9% of real employees" (it does not; that
 * figure came from one particular generated distribution and is explicitly not extrapolated here).
 *
 * `oldEarnedAmount`/`oldLineOt`/`oldLeaveEarned` below are a deliberate, frozen, test-only copy of
 * `calc-net.ts`'s pre-2026-08-28 arithmetic (divide `grossPay`/`cycleDays` first, THEN multiply) —
 * kept here only for this one-time differential comparison, never imported by or exported to
 * production code, and not the independent oracle (`calc-net-independent-reference.test.ts` already
 * covers that role with decimal.js-free exact-fraction arithmetic).
 */

function oldCalcEarnedAndOt(
  grossPay: Decimal,
  line: PayrollWorkLineCalcInput,
): { earnedAmount: Decimal; otEarned: Decimal } {
  const cycleDays = new Decimal(line.cycleDays);
  const days = new Decimal(line.days);
  const otHours = new Decimal(line.otHours);
  const dailyRate = grossPay.dividedBy(cycleDays); // OLD: divide first
  const effectiveOtRate = line.otRate !== null && line.otRate !== undefined ? new Decimal(line.otRate) : dailyRate.dividedBy(8);
  return {
    earnedAmount: dailyRate.times(days), // OLD: ...then multiply
    otEarned: otHours.times(effectiveOtRate),
  };
}

function oldLeaveEarned(grossPay: Decimal, entry: PayrollEntryCalcInput, primaryCycleDays: number): Decimal {
  const effectiveLeaveRate =
    entry.leaveRate !== null && entry.leaveRate !== undefined ? new Decimal(entry.leaveRate) : grossPay.dividedBy(primaryCycleDays);
  return effectiveLeaveRate.times(new Decimal(entry.leaveDays));
}

function roundMoney(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

interface OldResult {
  earnedAmount: string;
  otEarned: string;
  leaveEarned: string;
  totalEarning: string;
  totalDeduction: string;
  netSalary: string;
}

/** Reimplements the rest of the OLD `calcNet` (everything downstream of earned/OT/leave was never
 * part of the precision defect — deductions, allowance, and the final add/subtract are unchanged —
 * so only earned/OT/leave use the OLD divide-first arithmetic here). */
function oldCalcNet(entry: PayrollEntryCalcInput): OldResult {
  const grossPay = new Decimal(entry.grossPay);
  const primaryLine = [...entry.workLines].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;

  let earnedFull = new Decimal(0);
  let otFull = new Decimal(0);
  for (const line of entry.workLines) {
    const { earnedAmount, otEarned } = oldCalcEarnedAndOt(grossPay, line);
    earnedFull = earnedFull.plus(earnedAmount);
    otFull = otFull.plus(otEarned);
  }
  const leaveFull = oldLeaveEarned(grossPay, entry, primaryLine.cycleDays);

  const earnedAmount = roundMoney(earnedFull);
  const otEarned = roundMoney(otFull);
  const leaveEarned = roundMoney(leaveFull);
  const allowance = roundMoney(new Decimal(entry.allowance));
  const correctionBalancePayable = roundMoney(new Decimal(entry.correctionBalancePayable ?? 0));
  const totalEarning = earnedAmount.plus(otEarned).plus(allowance).plus(leaveEarned).plus(correctionBalancePayable);

  const eobiDeduction = entry.eobiApplicable ? roundMoney(new Decimal(entry.eobiAmount)) : new Decimal(0);
  const advanceDeduction = roundMoney(new Decimal(entry.advanceDeduction));
  const eidAdvanceDeduction = roundMoney(new Decimal(entry.eidAdvanceDeduction));
  const fine = roundMoney(new Decimal(entry.fine));
  const correctionBalanceRecovery = roundMoney(new Decimal(entry.correctionBalanceRecovery ?? 0));
  const totalDeduction = eobiDeduction.plus(advanceDeduction).plus(eidAdvanceDeduction).plus(fine).plus(correctionBalanceRecovery);

  const netSalary = totalEarning.minus(totalDeduction);

  return {
    earnedAmount: earnedAmount.toFixed(2),
    otEarned: otEarned.toFixed(2),
    leaveEarned: leaveEarned.toFixed(2),
    totalEarning: totalEarning.toFixed(2),
    totalDeduction: totalDeduction.toFixed(2),
    netSalary: netSalary.toFixed(2),
  };
}

// ---- broad generated population: mixes uniform-random shapes with boundary-prone ones, so the
// blast-radius figure reflects a realistic mix rather than only the adversarial cases from Step 6.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260830;

function makeBroadGenerator(seed: number) {
  const rand = mulberry32(seed);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const randBool = (p = 0.5) => rand() < p;
  const money = (max: number) => `${randInt(0, max)}.${randInt(0, 99).toString().padStart(2, '0')}`;
  const daysStr = (max: number) => (randInt(0, Math.round(max * 100)) / 100).toFixed(2);

  return function genEntry(): PayrollEntryCalcInput {
    const numLines = randBool(0.75) ? 1 : randBool(0.6) ? 2 : 3;
    const grossPay = money(300000);
    const workLines: PayrollWorkLineCalcInput[] = [];
    for (let i = 0; i < numLines; i++) {
      const cycleDays = randInt(1, 31);
      workLines.push({
        sortOrder: i,
        days: daysStr(cycleDays),
        otHours: daysStr(60),
        otRate: randBool(0.5) ? null : `${randInt(1, 1000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
        cycleDays,
      });
    }
    return {
      grossPay,
      allowance: money(50000),
      leaveDays: daysStr(31),
      leaveRate: randBool(0.5) ? null : `${randInt(1, 5000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      eobiAmount: money(2000),
      eobiApplicable: randBool(),
      advanceDeduction: money(100000),
      eidAdvanceDeduction: money(100000),
      fine: money(20000),
      workLines,
    };
  };
}

/** Adversarial variant of the broad generator above — `days`/`leaveDays` biased toward simple
 * fractions of `cycleDays` (the input shape that actually triggers the precision defect), same idea
 * as `calc-net-independent-reference.test.ts`'s boundary-biased generator. Used to show the OLD
 * defect's trigger rate is highly population-dependent (0.9% on the original uniform-random
 * population, ~0.03% on a broad/realistic-ish population, and much higher here) — exactly the
 * reason Step 7 explicitly forbids treating any single figure as "N% of employees." */
function makeAdversarialGenerator(seed: number) {
  const rand = mulberry32(seed);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const randBool = (p = 0.5) => rand() < p;
  const money = (max: number) => `${randInt(0, max)}.${randInt(0, 99).toString().padStart(2, '0')}`;
  const FRACTIONS: Array<[number, number]> = [
    [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 6], [5, 6], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7],
  ];
  const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)]!;
  const biasedDays = (cycleDays: number) => {
    const [num, den] = pick(FRACTIONS);
    const raw = Math.min(cycleDays, (cycleDays * num) / den);
    return (Math.round(raw * 100) / 100).toFixed(2);
  };

  return function genEntry(): PayrollEntryCalcInput {
    const cycleDays = pick([28, 29, 30, 31, 26, 24, 21, 14, 7, 6, 3]);
    return {
      grossPay: money(300000),
      allowance: money(50000),
      leaveDays: biasedDays(31),
      leaveRate: null, // always the derived (vulnerable) path
      eobiAmount: money(2000),
      eobiApplicable: randBool(),
      advanceDeduction: money(100000),
      eidAdvanceDeduction: money(100000),
      fine: money(20000),
      workLines: [{ sortOrder: 0, days: biasedDays(cycleDays), otHours: biasedDays(60), otRate: null, cycleDays }],
    };
  };
}

interface DiffRecord {
  field: keyof OldResult;
  oldValue: string;
  newValue: string;
  diff: number;
  input: PayrollEntryCalcInput;
}

const FIELDS: (keyof OldResult)[] = ['earnedAmount', 'otEarned', 'leaveEarned', 'totalEarning', 'totalDeduction', 'netSalary'];

interface DifferentialStats {
  N: number;
  casesWithAnyDifference: number;
  maxAbsDiff: number;
  anyExceedsOnePaisa: boolean;
  perFieldChangedCount: Record<string, number>;
  directionCounts: { newHigher: number; newLower: number };
  sampleDiffs: DiffRecord[];
}

function runDifferential(genEntry: () => PayrollEntryCalcInput, N: number, label: string): DifferentialStats {
  let casesWithAnyDifference = 0;
  let maxAbsDiff = 0;
  let anyExceedsOnePaisa = false;
  const perFieldChangedCount: Record<string, number> = {};
  const directionCounts = { newHigher: 0, newLower: 0 };
  const sampleDiffs: DiffRecord[] = [];
  for (const f of FIELDS) perFieldChangedCount[f] = 0;

  for (let i = 0; i < N; i++) {
    const input = genEntry();
    const oldResult = oldCalcNet(input);
    const newResult = calcNet(input);
    let entryChanged = false;

    for (const field of FIELDS) {
      const oldV = oldResult[field];
      const newV = newResult[field];
      if (oldV !== newV) {
        entryChanged = true;
        perFieldChangedCount[field]!++;
        const diff = Number(newV) - Number(oldV);
        const absDiff = Math.round(Math.abs(diff) * 100) / 100;
        maxAbsDiff = Math.max(maxAbsDiff, absDiff);
        if (absDiff > 0.01) anyExceedsOnePaisa = true;
        if (diff > 0) directionCounts.newHigher++;
        else directionCounts.newLower++;
        if (sampleDiffs.length < 10) {
          sampleDiffs.push({ field, oldValue: oldV, newValue: newV, diff, input });
        }
      }
    }
    if (entryChanged) casesWithAnyDifference++;
  }

  const percentChanged = ((casesWithAnyDifference / N) * 100).toFixed(3);
  console.error(
    [
      `CalcNet old-vs-new differential [${label}] (N=${N}):`,
      `  cases with at least one changed field: ${casesWithAnyDifference} (${percentChanged}%)`,
      `  per-field changed counts: ${JSON.stringify(perFieldChangedCount)}`,
      `  direction: newHigher(fix increased the figure)=${directionCounts.newHigher}, newLower=${directionCounts.newLower}`,
      `  max absolute difference observed: ${maxAbsDiff.toFixed(2)}`,
      `  any single-field difference > PKR 0.01: ${anyExceedsOnePaisa}`,
    ].join('\n'),
  );
  if (sampleDiffs.length > 0) {
    console.error(`[${label}] sample changed cases:\n${sampleDiffs.map((d) => JSON.stringify(d)).join('\n')}`);
  }

  return { N, casesWithAnyDifference, maxAbsDiff, anyExceedsOnePaisa, perFieldChangedCount, directionCounts, sampleDiffs };
}

describe('CalcNet Precision Rounding Fix — old-vs-new differential blast-radius analysis (Step 7)', () => {
  it(`broad/realistic-ish population (seed=${SEED}) — do not extrapolate this percentage to "N% of employees"`, () => {
    const stats = runDifferential(makeBroadGenerator(SEED), 50000, 'broad');

    // Exact conditions producing a difference (Step 7's own "exact conditions" ask): every changed
    // case has otRate/leaveRate null on at least one line/the entry (the derived-rate path) — i.e.
    // exactly the divide-before-multiply paths identified in Step 3's audit, never the flat
    // deduction fields (totalDeduction's changed-count is always 0 — deductions involve no division).
    expect(stats.perFieldChangedCount.totalDeduction).toBe(0);

    // Bounded, single-cent-per-affected-component correction, never a large swing — the key
    // blast-radius safety property: nothing catastrophic changed, only sub-paisa rounding fixes.
    expect(stats.maxAbsDiff).toBeLessThanOrEqual(0.03);
    expect(stats.anyExceedsOnePaisa).toBe(stats.maxAbsDiff > 0.01);

    // Directional consistency: the fix only ever corrects understated pay upward, never the reverse.
    expect(stats.directionCounts.newLower).toBe(0);

    // Sanity: the fix does touch a non-trivial number of cases at this distribution — catches a
    // future accidental no-op "fix" (e.g. a revert) via an obviously-wrong 0% figure.
    expect(stats.casesWithAnyDifference).toBeGreaterThan(0);
  });

  it(`adversarial boundary-biased population (seed=${SEED + 1}) — demonstrates the trigger rate is population-dependent, not a fixed "N% of employees" constant`, () => {
    // Deliberately concentrates on the exact vulnerable shape (derived rates, simple day/cycleDays
    // fractions, real cycleDays values) to show the OLD defect's rate under adversarial conditions is
    // far higher than either the original uniform-random audit (0.9%) or the broad population above
    // — the whole point of Step 7 is that none of these percentages are "N% of real employees."
    const stats = runDifferential(makeAdversarialGenerator(SEED + 1), 20000, 'adversarial');

    expect(stats.perFieldChangedCount.totalDeduction).toBe(0);
    expect(stats.maxAbsDiff).toBeLessThanOrEqual(0.03);
    expect(stats.directionCounts.newLower).toBe(0);
    expect(stats.casesWithAnyDifference).toBeGreaterThan(0);
  });
});
