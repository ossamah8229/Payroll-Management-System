import { calcNet, type PayrollEntryCalcInput } from '@payroll/shared';

/**
 * Pure unit tests, no database involved — `calcNet` (shared/src/lib/calc-net.ts) is the single
 * source of truth for net-salary calculation (docs/architecture/database-schema.md §12/§12a,
 * Principle 5) and must be exercised directly, the same way `date-utils.test.ts` exercises the
 * shared date utilities.
 */

function baseEntry(overrides: Partial<PayrollEntryCalcInput> = {}): PayrollEntryCalcInput {
  return {
    grossPay: '40000',
    allowance: '0',
    leaveDays: '0',
    leaveRate: null,
    eobiAmount: '400',
    eobiApplicable: true,
    advanceDeduction: '0',
    eidAdvanceDeduction: '0',
    fine: '0',
    workLines: [{ sortOrder: 0, days: '0', otHours: '0', otRate: null, cycleDays: 30 }],
    ...overrides,
  };
}

describe('calcNet — single-line golden cases (from reference/payroll_prototype.html)', () => {
  it('matches the prototype employee #15 fixture (gross 40000, 17/27 days, EOBI 400)', () => {
    // dailyRate = 40000/27 = 1481.4814814814814815 (repeating decimal, full precision)
    // earned = dailyRate * 17 = 25185.185185185185186 -> rounds to 25185.19
    // net = 25185.19 - 400.00 = 24785.19
    const result = calcNet(
      baseEntry({
        workLines: [{ sortOrder: 0, days: '17', otHours: '0', otRate: null, cycleDays: 27 }],
      }),
    );
    expect(result.earnedAmount).toBe('25185.19');
    expect(result.otEarned).toBe('0.00');
    expect(result.leaveEarned).toBe('0.00');
    expect(result.totalEarning).toBe('25185.19');
    expect(result.eobiDeduction).toBe('400.00');
    expect(result.totalDeduction).toBe('400.00');
    expect(result.netSalary).toBe('24785.19');
  });

  it('matches the prototype employee #16 fixture (gross 40000, 27/30 days, EOBI 400)', () => {
    // dailyRate = 40000/30 = 1333.3333333333333333 -> earned = *27 = 36000.00 exactly
    const result = calcNet(
      baseEntry({
        workLines: [{ sortOrder: 0, days: '27', otHours: '0', otRate: null, cycleDays: 30 }],
      }),
    );
    expect(result.earnedAmount).toBe('36000.00');
    expect(result.netSalary).toBe('35600.00'); // 36000.00 - 400.00 EOBI
  });
});

describe('calcNet — OT, allowance, leave, fine, advance, EOBI-off', () => {
  it('derives OT rate as dailyRate/8 when otRate is null', () => {
    // dailyRate = 30000/30 = 1000; otRate derived = 125; 4 hours -> 500.00
    const result = calcNet(
      baseEntry({
        grossPay: '30000',
        workLines: [{ sortOrder: 0, days: '0', otHours: '4', otRate: null, cycleDays: 30 }],
      }),
    );
    expect(result.otEarned).toBe('500.00');
  });

  it('uses an explicit otRate when provided, ignoring the derived rate', () => {
    const result = calcNet(
      baseEntry({
        grossPay: '30000',
        workLines: [{ sortOrder: 0, days: '0', otHours: '4', otRate: '150', cycleDays: 30 }],
      }),
    );
    expect(result.otEarned).toBe('600.00');
  });

  it('applies allowance directly into totalEarning', () => {
    const result = calcNet(baseEntry({ allowance: '2500' }));
    expect(result.totalEarning).toBe('2500.00');
  });

  it('derives leaveRate as grossPay/primary line cycleDays when leaveRate is null', () => {
    // dailyRate/leaveRate = 40000/30 = 1333.3333...; 2 leave days -> 2666.67 (rounded)
    const result = calcNet(baseEntry({ leaveDays: '2', leaveRate: null }));
    expect(result.leaveEarned).toBe('2666.67');
  });

  it('uses an explicit leaveRate when provided', () => {
    const result = calcNet(baseEntry({ leaveDays: '2', leaveRate: '1000' }));
    expect(result.leaveEarned).toBe('2000.00');
  });

  it('excludes EOBI from totalDeduction when eobiApplicable is false', () => {
    const result = calcNet(baseEntry({ eobiApplicable: false, eobiAmount: '400' }));
    expect(result.eobiDeduction).toBe('0.00');
    expect(result.totalDeduction).toBe('0.00');
  });

  it('sums advanceDeduction, eidAdvanceDeduction, and fine into totalDeduction', () => {
    const result = calcNet(
      baseEntry({ advanceDeduction: '1000', eidAdvanceDeduction: '500', fine: '250' }),
    );
    expect(result.totalDeduction).toBe('2150.00'); // 400 EOBI + 1000 + 500 + 250
  });

  it('produces a netSalary that always exactly reconciles with totalEarning - totalDeduction', () => {
    const result = calcNet(
      baseEntry({
        allowance: '1234.56',
        leaveDays: '3',
        leaveRate: '111.11',
        advanceDeduction: '999.99',
        fine: '10',
        workLines: [{ sortOrder: 0, days: '11', otHours: '3', otRate: '77.77', cycleDays: 29 }],
      }),
    );
    const earning = Number(result.totalEarning);
    const deduction = Number(result.totalDeduction);
    expect(Number(result.netSalary)).toBeCloseTo(earning - deduction, 2);
  });
});

describe('calcNet — multi-line entries (Split by Unit)', () => {
  it('sums earned/OT across 2 lines with different cycleDays and otRate, and matches the single-line reduction', () => {
    const twoLine = calcNet(
      baseEntry({
        grossPay: '60000',
        workLines: [
          { sortOrder: 0, days: '10', otHours: '2', otRate: '200', cycleDays: 30 },
          { sortOrder: 1, days: '5', otHours: '1', otRate: null, cycleDays: 26 },
        ],
      }),
    );
    // Line 0: dailyRate = 2000; earned = 20000.00; otEarned = 400.00
    // Line 1: dailyRate = 60000/26 = 2307.6923...; earned = 11538.46; otEarned = dailyRate/8 * 1 = 288.46
    expect(twoLine.earnedAmount).toBe('31538.46'); // 20000.00 + 11538.46 (full-precision sum, then rounded)
    expect(twoLine.otEarned).toBe('688.46'); // 400.00 + 288.46
    expect(twoLine.workLines).toHaveLength(2);
  });

  it('reduces to the exact same result as a single-line entry when there is only one line', () => {
    const singleLine = calcNet(
      baseEntry({
        grossPay: '52000',
        allowance: '1500',
        leaveDays: '1',
        workLines: [{ sortOrder: 0, days: '22', otHours: '3', otRate: null, cycleDays: 31 }],
      }),
    );
    // No special-cased branch — this is simply the N=1 case of the general summation (§12a).
    // gross 52000 / 31 cycleDays = dailyRate 1677.4193548387096774 (repeating decimal).
    expect(singleLine.earnedAmount).toBe('36903.23'); // dailyRate * 22 days
    expect(singleLine.otEarned).toBe('629.03'); // (dailyRate/8) * 3 hours
    expect(singleLine.leaveEarned).toBe('1677.42'); // dailyRate (primary line basis) * 1 leave day
    expect(singleLine.totalEarning).toBe('40709.68'); // 36903.23 + 629.03 + 1500.00 allowance + 1677.42
    expect(singleLine.netSalary).toBe('40309.68'); // 40709.68 - 400.00 EOBI
  });

  it('uses the lowest-sortOrder line as the primary line for the leave-rate basis, regardless of array order', () => {
    const result = calcNet(
      baseEntry({
        grossPay: '30000',
        leaveDays: '1',
        leaveRate: null,
        // Primary line (sortOrder 0) has cycleDays 30; the other (sortOrder 1) has cycleDays 20.
        // Array order is deliberately reversed to prove sortOrder, not array position, decides.
        workLines: [
          { sortOrder: 1, days: '0', otHours: '0', otRate: null, cycleDays: 20 },
          { sortOrder: 0, days: '0', otHours: '0', otRate: null, cycleDays: 30 },
        ],
      }),
    );
    // effectiveLeaveRate should derive from cycleDays=30 (sortOrder 0), i.e. 1000, not 1500 (cycleDays=20).
    expect(result.leaveEarned).toBe('1000.00');
  });
});

describe('calcNet — boundary values', () => {
  it('handles cycleDays at its minimum (1)', () => {
    const result = calcNet(
      baseEntry({
        grossPay: '3100',
        workLines: [{ sortOrder: 0, days: '1', otHours: '0', otRate: null, cycleDays: 1 }],
      }),
    );
    expect(result.earnedAmount).toBe('3100.00');
  });

  it('handles cycleDays at its maximum (31)', () => {
    const result = calcNet(
      baseEntry({
        grossPay: '3100',
        workLines: [{ sortOrder: 0, days: '31', otHours: '0', otRate: null, cycleDays: 31 }],
      }),
    );
    expect(result.earnedAmount).toBe('3100.00');
  });

  it('handles zero days worked', () => {
    const result = calcNet(baseEntry());
    expect(result.earnedAmount).toBe('0.00');
    expect(result.netSalary).toBe('-400.00'); // still deducts EOBI
  });

  it('handles zero grossPay', () => {
    const result = calcNet(baseEntry({ grossPay: '0' }));
    expect(result.earnedAmount).toBe('0.00');
  });

  it('rounds half-up at exactly the .005 boundary', () => {
    // 100.005 is exactly on the rounding boundary — ROUND_HALF_UP must round up to 100.01, not
    // down to 100.00 (a native-float `Math.round`-based implementation would be unreliable here).
    const result = calcNet(baseEntry({ allowance: '100.005' }));
    expect(result.totalEarning).toBe('100.01');
  });
});

describe('calcNet — invariants', () => {
  it('throws if called with zero work lines (a PayrollEntry must always have at least one, §12a)', () => {
    expect(() => calcNet(baseEntry({ workLines: [] }))).toThrow();
  });

  it('never produces native floating-point drift for a classic repeating-decimal rate', () => {
    // 10/3 style repeating decimal — a naive float implementation risks visible drift across
    // many lines; decimal.js must keep this exact through summation.
    const result = calcNet(
      baseEntry({
        grossPay: '10000',
        workLines: [
          { sortOrder: 0, days: '1', otHours: '0', otRate: null, cycleDays: 3 },
          { sortOrder: 1, days: '1', otHours: '0', otRate: null, cycleDays: 3 },
          { sortOrder: 2, days: '1', otHours: '0', otRate: null, cycleDays: 3 },
        ],
      }),
    );
    // 3 lines of exactly one full dailyRate (10000/3) each = exactly grossPay (10000.00), not
    // 9999.99 or 10000.01 as float accumulation error could produce.
    expect(result.earnedAmount).toBe('10000.00');
  });
});
