import { calcNet, type PayrollEntryCalcInput, type PayrollWorkLineCalcInput } from '@payroll/shared';

/**
 * August 2026 Payroll Financial Integrity Checkpoint — independent verification of `calcNet`
 * (shared/src/lib/calc-net.ts), the system's single canonical net-salary calculation.
 *
 * This file deliberately does NOT import `decimal.js` or any helper from `calc-net.ts` for its own
 * arithmetic. `referenceCalc` below reimplements the documented formula
 * (docs/architecture/database/payroll-entry.md §12's "Calculated, not stored" block) from scratch
 * using exact BigInt rational-fraction arithmetic (`n/d`, always reduced) — infinite precision, no
 * binary float, no decimal-library rounding of any intermediate value. It is the ground truth this
 * suite checks production `calcNet` against, per the checkpoint's independent-reference requirement.
 *
 * FINDING, ROOT-CAUSED AND FIXED 2026-08-28 (see docs/PROJECT_PROGRESS.md's "CalcNet Precision
 * Rounding Fix" entry for the full write-up and numeric proof): production `calcNet` used to compute
 * `dailyRate = grossPay / cycleDays` as its own rounded decimal.js value (default `precision: 20`
 * significant digits — never overridden anywhere in this codebase) and only THEN multiply by `days`.
 * When `cycleDays` does not divide `grossPay` evenly (i.e. `dailyRate` is a non-terminating repeating
 * decimal) but the *final* `earnedAmount` happens to land exactly on a half-cent (`x.xx5`) boundary,
 * the 20-significant-digit truncation of the intermediate `dailyRate` could land fractionally under
 * that boundary, and `ROUND_HALF_UP` would then round DOWN to the wrong cent — always understating
 * the employee's pay by exactly one cent when it triggered (never overstating). `calcNet` now
 * computes `earnedAmount_i`/derived-rate `otEarned_i`/`leaveEarned` as a single fused
 * `(grossPay × days_i) / cycleDays_i` — deferring the one unavoidable division to last — the same
 * approach `referenceCalc` below always used. The property-based comparison
 * (`10,000 seeded cases`, then a 100,000-case expanded run) is the checkpoint's evidence that the fix
 * is complete: both must report 0 mismatches, and did on the post-fix run recorded in
 * docs/PROJECT_PROGRESS.md.
 */

// ---------------------------------------------------------------------------------------------
// Independent exact-rational arithmetic (BigInt fractions) — no decimal.js, no floats.
// ---------------------------------------------------------------------------------------------

interface Frac {
  n: bigint; // signed numerator
  d: bigint; // positive denominator
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}

function mkFrac(n: bigint, d: bigint): Frac {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function parseDecimal(raw: string | number): Frac {
  const s = String(raw).trim();
  let sign = 1n;
  let rest = s;
  if (rest.startsWith('-')) {
    sign = -1n;
    rest = rest.slice(1);
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1);
  }
  const [intPart, fracPart = ''] = rest.split('.');
  const digits = (intPart || '0') + fracPart;
  const n = sign * BigInt(digits === '' ? '0' : digits);
  const d = 10n ** BigInt(fracPart.length);
  return mkFrac(n, d);
}

function fromInt(i: number): Frac {
  return mkFrac(BigInt(i), 1n);
}

const ZERO: Frac = fromInt(0);

function fadd(a: Frac, b: Frac): Frac {
  return mkFrac(a.n * b.d + b.n * a.d, a.d * b.d);
}
function fmul(a: Frac, b: Frac): Frac {
  return mkFrac(a.n * b.n, a.d * b.d);
}
function fdiv(a: Frac, b: Frac): Frac {
  return mkFrac(a.n * b.d, a.d * b.n);
}

/** Round half up (ties away from zero — matches decimal.js `ROUND_HALF_UP`, calc-net.ts's own
 * documented rounding rule) to 2 decimal places, exactly (via exact-fraction comparison, never a
 * float `+0.5`). Returns whole cents as a signed BigInt. */
function round2Cents(a: Frac): bigint {
  const sign = a.n < 0n ? -1n : 1n;
  const num = a.n < 0n ? -a.n : a.n;
  const den = a.d;
  const scaled = num * 100n;
  let q = scaled / den;
  const r = scaled % den;
  if (r * 2n >= den) q += 1n;
  return sign * q;
}

function centsToFixed2(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const a = c < 0n ? -c : c;
  const ip = a / 100n;
  const fp = a % 100n;
  return `${sign}${ip.toString()}.${fp.toString().padStart(2, '0')}`;
}

/** Matches `calcNet`'s `totalWorkingDays` formatting: rounded half-up to 2dp, but via `.toString()`
 * (no forced trailing zeros), not `.toFixed(2)`. */
function minimalDecimalString(a: Frac): string {
  const c = round2Cents(a);
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  const ip = abs / 100n;
  const fp = abs % 100n;
  if (fp === 0n) return sign + ip.toString();
  let fpStr = fp.toString().padStart(2, '0');
  if (fpStr.endsWith('0')) fpStr = fpStr[0]!;
  return `${sign}${ip.toString()}.${fpStr}`;
}

interface ReferenceWorkLineResult {
  sortOrder: number;
  earnedAmount: string;
  otEarned: string;
}

interface ReferenceResult {
  workLines: ReferenceWorkLineResult[];
  totalWorkingDays: string;
  earnedAmount: string;
  otEarned: string;
  leaveEarned: string;
  correctionBalancePayable: string;
  totalEarning: string;
  eobiDeduction: string;
  correctionBalanceRecovery: string;
  totalDeduction: string;
  netSalary: string;
}

/**
 * Independent reimplementation of docs/architecture/database/payroll-entry.md §12's formula, using
 * exact rational arithmetic. Deliberately fuses "divide then multiply" into a single division
 * wherever the documented formula derives a rate purely to immediately multiply it back out
 * (`grossPay × days / cycleDays` rather than `(grossPay / cycleDays) × days`) — the one deliberate
 * divergence from `calcNet`'s own operation order, and exactly what exposes the precision defect
 * this file documents (see the top-of-file comment).
 */
function referenceCalc(entry: PayrollEntryCalcInput): ReferenceResult {
  if (entry.workLines.length === 0) throw new Error('referenceCalc: a PayrollEntry must have at least one work line');

  const grossPay = parseDecimal(entry.grossPay);
  const primaryLine = [...entry.workLines].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;

  let earnedFull: Frac = ZERO;
  let otFull: Frac = ZERO;
  let daysFull: Frac = ZERO;
  const workLineResults: ReferenceWorkLineResult[] = [];

  for (const line of entry.workLines) {
    const cycleDays = fromInt(line.cycleDays);
    const days = parseDecimal(line.days);
    const otHours = parseDecimal(line.otHours);
    daysFull = fadd(daysFull, days);

    const lineEarned = fdiv(fmul(grossPay, days), cycleDays);
    const lineOt =
      line.otRate !== null && line.otRate !== undefined
        ? fmul(otHours, parseDecimal(line.otRate))
        : fdiv(fmul(otHours, grossPay), fmul(cycleDays, fromInt(8)));

    earnedFull = fadd(earnedFull, lineEarned);
    otFull = fadd(otFull, lineOt);

    workLineResults.push({
      sortOrder: line.sortOrder,
      earnedAmount: centsToFixed2(round2Cents(lineEarned)),
      otEarned: centsToFixed2(round2Cents(lineOt)),
    });
  }

  const leaveDays = parseDecimal(entry.leaveDays);
  const leaveEarnedFull =
    entry.leaveRate !== null && entry.leaveRate !== undefined
      ? fmul(parseDecimal(entry.leaveRate), leaveDays)
      : fdiv(fmul(leaveDays, grossPay), fromInt(primaryLine.cycleDays));

  const earnedCents = round2Cents(earnedFull);
  const otCents = round2Cents(otFull);
  const leaveCents = round2Cents(leaveEarnedFull);
  const allowanceCents = round2Cents(parseDecimal(entry.allowance));
  const cbPayableCents = round2Cents(parseDecimal(entry.correctionBalancePayable ?? '0'));
  const totalEarningCents = earnedCents + otCents + allowanceCents + leaveCents + cbPayableCents;

  const eobiCents = entry.eobiApplicable ? round2Cents(parseDecimal(entry.eobiAmount)) : 0n;
  const advanceCents = round2Cents(parseDecimal(entry.advanceDeduction));
  const eidCents = round2Cents(parseDecimal(entry.eidAdvanceDeduction));
  const fineCents = round2Cents(parseDecimal(entry.fine));
  const cbRecoveryCents = round2Cents(parseDecimal(entry.correctionBalanceRecovery ?? '0'));
  const totalDeductionCents = eobiCents + advanceCents + eidCents + fineCents + cbRecoveryCents;

  const netCents = totalEarningCents - totalDeductionCents;

  return {
    workLines: workLineResults,
    totalWorkingDays: minimalDecimalString(daysFull),
    earnedAmount: centsToFixed2(earnedCents),
    otEarned: centsToFixed2(otCents),
    leaveEarned: centsToFixed2(leaveCents),
    correctionBalancePayable: centsToFixed2(cbPayableCents),
    totalEarning: centsToFixed2(totalEarningCents),
    eobiDeduction: centsToFixed2(eobiCents),
    correctionBalanceRecovery: centsToFixed2(cbRecoveryCents),
    totalDeduction: centsToFixed2(totalDeductionCents),
    netSalary: centsToFixed2(netCents),
  };
}

// ---------------------------------------------------------------------------------------------
// Deterministic seeded generator (mulberry32) — reproducible property-based fuzzing, no test-run
// flakiness; the seed is logged on every run and on every failure for exact reproduction.
// ---------------------------------------------------------------------------------------------

const SEED = 20260828;

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

function makeGenerator(seed: number) {
  const rand = mulberry32(seed);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const randDecimalStr = (min: number, max: number, maxDp: number) => {
    const dp = randInt(0, maxDp);
    const scale = 10 ** dp;
    const v = randInt(Math.round(min * scale), Math.round(max * scale)) / scale;
    return v.toFixed(dp);
  };
  const randBool = (p = 0.5) => rand() < p;
  const maybeNull = <T,>(fn: () => T, p = 0.3) => (randBool(p) ? null : fn());

  return function genEntry(): PayrollEntryCalcInput {
    const numLines = randBool(0.7) ? 1 : randBool(0.6) ? 2 : 3;
    const grossPay = randDecimalStr(0, 300000, 2);
    const workLines: PayrollWorkLineCalcInput[] = [];
    const sortOrders = [...Array(numLines).keys()];
    if (randBool(0.5)) sortOrders.reverse();
    for (let i = 0; i < numLines; i++) {
      const cycleDays = randInt(1, 31);
      workLines.push({
        sortOrder: sortOrders[i]!,
        days: randDecimalStr(0, cycleDays, randInt(0, 2)),
        otHours: randDecimalStr(0, 60, randInt(0, 2)),
        otRate: maybeNull(() => randDecimalStr(0, 1000, 2)),
        cycleDays,
      });
    }
    return {
      grossPay,
      allowance: randDecimalStr(0, 50000, 2),
      leaveDays: randDecimalStr(0, 31, randInt(0, 2)),
      leaveRate: maybeNull(() => randDecimalStr(0, 5000, 2)),
      eobiAmount: randDecimalStr(0, 2000, 2),
      eobiApplicable: randBool(),
      advanceDeduction: randDecimalStr(0, 100000, 2),
      eidAdvanceDeduction: randDecimalStr(0, 100000, 2),
      fine: randDecimalStr(0, 20000, 2),
      ...(randBool(0.3) ? { correctionBalancePayable: randDecimalStr(0, 20000, 2) } : {}),
      ...(randBool(0.3) ? { correctionBalanceRecovery: randDecimalStr(0, 20000, 2) } : {}),
      workLines,
    };
  };
}

const ENTRY_LEVEL_FIELDS = [
  'earnedAmount',
  'otEarned',
  'leaveEarned',
  'correctionBalancePayable',
  'totalEarning',
  'eobiDeduction',
  'correctionBalanceRecovery',
  'totalDeduction',
  'netSalary',
  'totalWorkingDays',
] as const;

function baseEntry(overrides: Partial<PayrollEntryCalcInput> = {}): PayrollEntryCalcInput {
  return {
    grossPay: '30000',
    allowance: '0',
    leaveDays: '0',
    leaveRate: null,
    eobiAmount: '0',
    eobiApplicable: false,
    advanceDeduction: '0',
    eidAdvanceDeduction: '0',
    fine: '0',
    workLines: [{ sortOrder: 0, days: '0', otHours: '0', otRate: null, cycleDays: 30 }],
    ...overrides,
  };
}

describe('calcNet vs independent BigInt-fraction reference — golden hand-calculated cases', () => {
  it('Case 1 — full cycle, no extras: 30000 gross, 30/30 days == exactly grossPay', () => {
    const result = calcNet(baseEntry({ grossPay: '30000', workLines: [{ sortOrder: 0, days: '30', otHours: '0', otRate: null, cycleDays: 30 }] }));
    expect(result.earnedAmount).toBe('30000.00');
    expect(result.netSalary).toBe('30000.00');
  });

  it('Case 2 — half cycle: 30000 gross, 15/30 days == exactly half', () => {
    const result = calcNet(baseEntry({ grossPay: '30000', workLines: [{ sortOrder: 0, days: '15', otHours: '0', otRate: null, cycleDays: 30 }] }));
    expect(result.earnedAmount).toBe('15000.00');
    expect(result.netSalary).toBe('15000.00');
  });

  it('Case 3 — OT only: 10 hours x 50/hr must be exactly 500, not 5000 or 50', () => {
    const result = calcNet(baseEntry({ workLines: [{ sortOrder: 0, days: '0', otHours: '10', otRate: '50', cycleDays: 30 }] }));
    expect(result.otEarned).toBe('500.00');
    expect(result.netSalary).toBe('500.00');
  });

  it('Case 4 — leave: 5 days x rate 200 == exactly 1000, deducted nowhere (leave is earned, not deducted)', () => {
    const result = calcNet(baseEntry({ leaveDays: '5', leaveRate: '200' }));
    expect(result.leaveEarned).toBe('1000.00');
    expect(result.netSalary).toBe('1000.00');
  });

  it('Case 5 — allowance: 3000 flows straight into totalEarning, not doubled/halved', () => {
    const result = calcNet(baseEntry({ allowance: '3000' }));
    expect(result.totalEarning).toBe('3000.00');
    expect(result.netSalary).toBe('3000.00');
  });

  it('Case 6 — EOBI: applicable, amount 400, everything else zero -> netSalary is NEGATIVE 400 (a deduction)', () => {
    const result = calcNet(baseEntry({ grossPay: '0', eobiAmount: '400', eobiApplicable: true }));
    expect(result.eobiDeduction).toBe('400.00');
    expect(result.netSalary).toBe('-400.00');
  });

  it('Case 7 — Advance: deduction 2000 reduces net salary (negative direction, never added)', () => {
    const result = calcNet(baseEntry({ grossPay: '0', advanceDeduction: '2000' }));
    expect(result.netSalary).toBe('-2000.00');
  });

  it('Case 8 — Eid Advance: deduction 1500 reduces net salary, verified independently of ordinary Advance', () => {
    const result = calcNet(baseEntry({ grossPay: '0', eidAdvanceDeduction: '1500' }));
    expect(result.netSalary).toBe('-1500.00');
  });

  it('Case 9 — Fine: 750 reduces net salary', () => {
    const result = calcNet(baseEntry({ grossPay: '0', fine: '750' }));
    expect(result.netSalary).toBe('-750.00');
  });

  it('Case 10 — everything combined, hand-audited step by step (see top-of-file for the arithmetic)', () => {
    const input = baseEntry({
      grossPay: '50000',
      allowance: '2500',
      leaveDays: '2',
      leaveRate: null,
      eobiAmount: '400',
      eobiApplicable: true,
      advanceDeduction: '3000',
      eidAdvanceDeduction: '1000',
      fine: '500',
      workLines: [{ sortOrder: 0, days: '20', otHours: '8', otRate: null, cycleDays: 30 }],
    });
    const result = calcNet(input);
    // dailyRate = 50000/30 = 1666.6666... ; earned = *20 = 33333.333... -> 33333.33
    expect(result.earnedAmount).toBe('33333.33');
    // effectiveOtRate = dailyRate/8 = 208.3333...; otEarned = *8 = 1666.666... -> 1666.67
    expect(result.otEarned).toBe('1666.67');
    // effectiveLeaveRate = dailyRate (primary line) = 1666.6666...; leaveEarned = *2 = 3333.333... -> 3333.33
    expect(result.leaveEarned).toBe('3333.33');
    // totalEarning = 33333.33 + 1666.67 + 2500.00 + 3333.33 = 40833.33
    expect(result.totalEarning).toBe('40833.33');
    // totalDeduction = 400.00 EOBI + 3000.00 advance + 1000.00 eid + 500.00 fine = 4900.00
    expect(result.totalDeduction).toBe('4900.00');
    // netSalary = 40833.33 - 4900.00 = 35933.33
    expect(result.netSalary).toBe('35933.33');
    expect(referenceCalc(input).netSalary).toBe('35933.33');
  });

  it('Case 11 — split unit (2 lines): each line contributes independently, sums do not cross-contaminate', () => {
    const input = baseEntry({
      grossPay: '39000',
      workLines: [
        { sortOrder: 0, days: '12', otHours: '3', otRate: '150', cycleDays: 30 },
        { sortOrder: 1, days: '8', otHours: '2', otRate: null, cycleDays: 26 },
      ],
    });
    const result = calcNet(input);
    // Line 0: dailyRate=39000/30=1300; earned=1300*12=15600.00; otEarned=3*150=450.00
    // Line 1: dailyRate=39000/26=1500; earned=1500*8=12000.00; effOtRate=1500/8=187.5; otEarned=2*187.5=375.00
    expect(result.earnedAmount).toBe('27600.00'); // 15600.00 + 12000.00
    expect(result.otEarned).toBe('825.00'); // 450.00 + 375.00
    expect(result.totalWorkingDays).toBe('20'); // 12 + 8, never just the primary line's own 12
    expect(result.netSalary).toBe('28425.00');
    expect(referenceCalc(input).netSalary).toBe('28425.00');
  });

  it('Case 12 — three units, equal split: no multiplication/double-counting across lines', () => {
    const input = baseEntry({
      grossPay: '45000',
      workLines: [
        { sortOrder: 0, days: '10', otHours: '0', otRate: null, cycleDays: 30 },
        { sortOrder: 1, days: '10', otHours: '0', otRate: null, cycleDays: 30 },
        { sortOrder: 2, days: '10', otHours: '0', otRate: null, cycleDays: 30 },
      ],
    });
    const result = calcNet(input);
    // 3 lines of dailyRate 1500 x 10 days = 15000.00 each; sum must be exactly 45000.00 (= grossPay,
    // since 10+10+10 days = 30 = one full cycle), never 45000*3=135000 (double/triple counting).
    expect(result.earnedAmount).toBe('45000.00');
    expect(result.totalWorkingDays).toBe('30');
    expect(result.netSalary).toBe('45000.00');
    expect(referenceCalc(input).netSalary).toBe('45000.00');
  });
});

describe('calcNet vs independent BigInt-fraction reference — decimal/rounding torture cases (Step 7)', () => {
  it('awkward gross/days/cycleDays/OT combination reconciles between production and reference', () => {
    const input = baseEntry({
      grossPay: '37913',
      leaveDays: '0',
      workLines: [{ sortOrder: 0, days: '17', otHours: '13.5', otRate: '217.37', cycleDays: 31 }],
    });
    const result = calcNet(input);
    const ref = referenceCalc(input);
    expect(result.earnedAmount).toBe(ref.earnedAmount);
    expect(result.otEarned).toBe(ref.otEarned);
    expect(result.netSalary).toBe(ref.netSalary);
  });

  it('regression: grossPay/cycleDays a repeating decimal, true earnedAmount lands exactly on a half-cent boundary — fixed 2026-08-28', () => {
    // 190221.91 * 14 / 28 = 190221.91 / 2 = 95110.955 EXACTLY (a terminating value) — but
    // dailyRate = 190221.91/28 is a non-terminating repeating decimal. Before the 2026-08-28 fix,
    // `calcNet` computed `dailyRate.times(days)`, which truncated dailyRate to decimal.js's default
    // 20-significant-digit `precision` BEFORE multiplying by 14, landing a hair under the true value
    // and rounding DOWN to 95110.95 instead of the mathematically correct 95110.96 (ROUND_HALF_UP on
    // an exact .xx5 tie rounds up). `calcNet` now computes `grossPay.times(days).dividedBy(cycleDays)`
    // — the same fused single-division the independent reference always used — and matches exactly.
    const input = baseEntry({
      grossPay: '190221.91',
      workLines: [{ sortOrder: 0, days: '14', otHours: '0', otRate: null, cycleDays: 28 }],
    });
    const result = calcNet(input);
    const ref = referenceCalc(input);
    expect(ref.earnedAmount).toBe('95110.96'); // mathematically correct (exact fraction, no rounding ambiguity)
    expect(result.earnedAmount).toBe('95110.96'); // FIXED — was '95110.95' before the 2026-08-28 precision fix
  });

  it('second regression: 68423.69 gross, 3/6 days, same exact-half-cent-boundary case — fixed 2026-08-28', () => {
    const input = baseEntry({
      grossPay: '68423.69',
      workLines: [{ sortOrder: 0, days: '3', otHours: '0', otRate: null, cycleDays: 6 }],
    });
    const result = calcNet(input);
    const ref = referenceCalc(input);
    expect(ref.earnedAmount).toBe('34211.85');
    expect(result.earnedAmount).toBe('34211.85'); // FIXED — was '34211.84' before the 2026-08-28 precision fix
  });

  it('half-up rounds exactly on the .005 boundary the same way for a non-division-derived figure (allowance)', () => {
    const result = calcNet(baseEntry({ allowance: '100.005' }));
    expect(result.totalEarning).toBe('100.01');
  });
});

/** Runs `calcNet` vs `referenceCalc` over `N` generated entries and returns every mismatched field
 * with its complete reproducible input — shared by the 10,000-case and 100,000-case comparisons
 * below (Steps 8 and 6 of the remediation checkpoint) so both use identical comparison logic. */
function compareAgainstReference(genEntry: () => PayrollEntryCalcInput, N: number): string[] {
  const mismatches: string[] = [];
  for (let i = 0; i < N; i++) {
    const input = genEntry();
    const prod = calcNet(input);
    const ref = referenceCalc(input);

    for (const field of ENTRY_LEVEL_FIELDS) {
      if (prod[field] !== ref[field]) {
        mismatches.push(`case ${i} field=${field} prod=${prod[field]} ref=${ref[field]} input=${JSON.stringify(input)}`);
      }
    }
    for (const line of input.workLines) {
      const pw = prod.workLines.find((w) => w.sortOrder === line.sortOrder)!;
      const rw = ref.workLines.find((w) => w.sortOrder === line.sortOrder)!;
      if (pw.earnedAmount !== rw.earnedAmount || pw.otEarned !== rw.otEarned) {
        mismatches.push(`case ${i} sortOrder=${line.sortOrder} workLine prod=${JSON.stringify(pw)} ref=${JSON.stringify(rw)} input=${JSON.stringify(input)}`);
      }
    }
  }
  return mismatches;
}

describe('calcNet vs independent BigInt-fraction reference — 10,000-case deterministic property comparison (Step 8)', () => {
  it(`matches the independent reference component-by-component across 10,000 seeded cases (seed=${SEED})`, () => {
    const mismatches = compareAgainstReference(makeGenerator(SEED), 10000);
    // REQUIRED: 0 mismatches. Before the 2026-08-28 fix, this exact seed reproducibly found 90/10000
    // (~0.9%) mismatches, all traced to the single confirmed root cause documented at the top of this
    // file (decimal.js's default 20-significant-digit `precision` truncating `grossPay/cycleDays`
    // before multiplication, at an exact half-cent boundary) — see PROJECT_PROGRESS.md's writeup. This
    // is a permanent regression guard, not merely audit evidence — if this ever goes red again, it
    // means the same (or an equivalent) precision defect has been reintroduced.
    if (mismatches.length > 0) {
      console.error(`${mismatches.length}/10000 mismatches (seed=${SEED}), first 5:\n${mismatches.slice(0, 5).join('\n')}`);
    }
    expect(mismatches).toEqual([]);
  });
});

/** A second, boundary-biased generator (remediation checkpoint Step 6) — unlike `makeGenerator`
 * above (uniform random, which is what originally *found* the defect), this one deliberately
 * concentrates probability mass on the exact input shape that triggers a divide-before-multiply
 * precision defect: `days`/`leaveDays` chosen as simple fractions (1/2, 1/3, 2/3, 1/7, 5/7, …) of
 * `cycleDays`, so `grossPay × (days/cycleDays)` is more likely to land near/on an exact half-cent
 * boundary while the *intermediate* `grossPay/cycleDays` is a genuinely repeating decimal;
 * `cycleDays` weighted toward the real 28-31 range plus other "bad prime" divisors (3, 6, 7, 26);
 * `grossPay` deliberately NOT round numbers. This is the population a fix must be robust across, not
 * just the uniform-random one that happened to find 90/10000. */
const BOUNDARY_SEED = 20260829;

function makeBoundaryBiasedGenerator(seed: number) {
  const rand = mulberry32(seed);
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const randBool = (p = 0.5) => rand() < p;
  const CYCLE_DAYS_POOL = [28, 29, 30, 31, 28, 29, 30, 31, 30, 30, 26, 24, 22, 21, 20, 18, 15, 14, 13, 10, 9, 7, 6, 3, 2, 1];
  const FRACTIONS: Array<[number, number]> = [
    [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5],
    [1, 6], [5, 6], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [1, 9], [4, 9], [7, 9],
  ];
  const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)]!;

  const randAwkwardGrossPay = (): string => {
    // Deliberately not round: random integer part plus a random 2dp fraction, biased toward values
    // with a large, "unfriendly" prime factor after any /cycleDays reduction.
    const intPart = randInt(1, 400000);
    const cents = randInt(0, 99);
    return `${intPart}.${cents.toString().padStart(2, '0')}`;
  };

  const biasedDays = (cycleDays: number): string => {
    if (randBool(0.65)) {
      const [num, den] = pick(FRACTIONS);
      const raw = (cycleDays * num) / den;
      const clamped = Math.min(cycleDays, Math.max(0, raw));
      return (Math.round(clamped * 100) / 100).toFixed(2);
    }
    const scale = 100;
    return (randInt(0, cycleDays * scale) / scale).toFixed(2);
  };

  return function genEntry(): PayrollEntryCalcInput {
    const numLines = randBool(0.55) ? 1 : randBool(0.6) ? 2 : 3;
    const grossPay = randAwkwardGrossPay();
    const workLines: PayrollWorkLineCalcInput[] = [];
    for (let i = 0; i < numLines; i++) {
      const cycleDays = pick(CYCLE_DAYS_POOL);
      workLines.push({
        sortOrder: i,
        days: biasedDays(cycleDays),
        otHours: randBool(0.5) ? biasedDays(Math.max(cycleDays, 8)) : (randInt(0, 6000) / 100).toFixed(2),
        // Biased toward null (derived rate) — the vulnerable path — but still covers explicit rates.
        otRate: randBool(0.6) ? null : `${randInt(1, 1000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
        cycleDays,
      });
    }
    return {
      grossPay,
      allowance: `${randInt(0, 50000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      leaveDays: biasedDays(31),
      leaveRate: randBool(0.6) ? null : `${randInt(1, 5000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      eobiAmount: `${randInt(0, 2000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      eobiApplicable: randBool(),
      advanceDeduction: `${randInt(0, 100000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      eidAdvanceDeduction: `${randInt(0, 100000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      fine: `${randInt(0, 20000)}.${randInt(0, 99).toString().padStart(2, '0')}`,
      ...(randBool(0.3) ? { correctionBalancePayable: `${randInt(0, 20000)}.${randInt(0, 99).toString().padStart(2, '0')}` } : {}),
      ...(randBool(0.3) ? { correctionBalanceRecovery: `${randInt(0, 20000)}.${randInt(0, 99).toString().padStart(2, '0')}` } : {}),
      workLines,
    };
  };
}

describe('calcNet vs independent BigInt-fraction reference — 100,000-case boundary-biased comparison (Step 6)', () => {
  it(`matches the independent reference across 100,000 boundary-biased cases (seed=${BOUNDARY_SEED}) — half-paisa/repeating-division/28-31-cycleDays/awkward-gross-pay/fractional-OT/multi-line`, () => {
    const mismatches = compareAgainstReference(makeBoundaryBiasedGenerator(BOUNDARY_SEED), 100000);
    if (mismatches.length > 0) {
      console.error(`${mismatches.length}/100000 mismatches (seed=${BOUNDARY_SEED}), first 5:\n${mismatches.slice(0, 5).join('\n')}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('calcNet — mathematical invariants (Step 9)', () => {
  it('zero OT hours produces zero OT amount, regardless of rate', () => {
    expect(calcNet(baseEntry({ workLines: [{ sortOrder: 0, days: '10', otHours: '0', otRate: '500', cycleDays: 30 }] })).otEarned).toBe('0.00');
  });

  it('increasing OT hours cannot reduce netSalary, all else equal', () => {
    const low = calcNet(baseEntry({ workLines: [{ sortOrder: 0, days: '10', otHours: '2', otRate: '100', cycleDays: 30 }] }));
    const high = calcNet(baseEntry({ workLines: [{ sortOrder: 0, days: '10', otHours: '5', otRate: '100', cycleDays: 30 }] }));
    expect(Number(high.netSalary)).toBeGreaterThanOrEqual(Number(low.netSalary));
  });

  it('increasing a deduction (fine) cannot increase netSalary', () => {
    const low = calcNet(baseEntry({ fine: '100' }));
    const high = calcNet(baseEntry({ fine: '500' }));
    expect(Number(high.netSalary)).toBeLessThanOrEqual(Number(low.netSalary));
  });

  it('increasing allowance cannot reduce netSalary', () => {
    const low = calcNet(baseEntry({ allowance: '1000' }));
    const high = calcNet(baseEntry({ allowance: '5000' }));
    expect(Number(high.netSalary)).toBeGreaterThanOrEqual(Number(low.netSalary));
  });

  it('a full-cycle entry (days == cycleDays) earns exactly grossPay', () => {
    expect(calcNet(baseEntry({ grossPay: '77777', workLines: [{ sortOrder: 0, days: '19', otHours: '0', otRate: null, cycleDays: 19 }] })).earnedAmount).toBe('77777.00');
  });

  it('zero worked days produces zero earnedAmount', () => {
    expect(calcNet(baseEntry({ grossPay: '99999' })).earnedAmount).toBe('0.00');
  });

  it('split lines with the SAME cycleDays basis reconcile to the single-line equivalent for earnedAmount (pure days, no OT/rate asymmetry)', () => {
    const split = calcNet(
      baseEntry({
        grossPay: '60000',
        workLines: [
          { sortOrder: 0, days: '9', otHours: '0', otRate: null, cycleDays: 30 },
          { sortOrder: 1, days: '11', otHours: '0', otRate: null, cycleDays: 30 },
        ],
      }),
    );
    const single = calcNet(baseEntry({ grossPay: '60000', workLines: [{ sortOrder: 0, days: '20', otHours: '0', otRate: null, cycleDays: 30 }] }));
    expect(split.earnedAmount).toBe(single.earnedAmount);
  });

  it('is deterministic: identical input produces byte-identical output across repeated calls', () => {
    const input = baseEntry({ grossPay: '54321.99', workLines: [{ sortOrder: 0, days: '17.5', otHours: '6.25', otRate: null, cycleDays: 29 }] });
    const a = calcNet(input);
    const b = calcNet(input);
    expect(a).toEqual(b);
  });
});
