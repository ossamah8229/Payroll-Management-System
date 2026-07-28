import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type { StatementLedgerEntry, StatementRange } from '@/hooks/use-employee-statement';
import {
  classifyStatementError,
  statementBalanceLabel,
  statementBalanceShortLabel,
  statementCategoryLabel,
  statementEntryDateLabel,
  statementPeriodLabel,
} from './statement-labels';

describe('statementCategoryLabel', () => {
  it('labels every category without color/status semantics', () => {
    expect(statementCategoryLabel('SALARY')).toBe('Salary');
    expect(statementCategoryLabel('CORRECTION')).toBe('Correction');
    expect(statementCategoryLabel('ADVANCE')).toBe('Advance');
  });
});

describe('statementBalanceLabel / statementBalanceShortLabel', () => {
  it('uses "Payable to Employee" / "Recoverable from Employee" — never raw Debit/Credit', () => {
    expect(statementBalanceLabel('PAYABLE')).toBe('Payable to Employee');
    expect(statementBalanceLabel('RECOVERABLE')).toBe('Recoverable from Employee');
    expect(statementBalanceLabel('ADVANCE')).toBe('Advance');
    expect(statementBalanceLabel('PAYABLE')).not.toMatch(/debit|credit/i);
    expect(statementBalanceLabel('RECOVERABLE')).not.toMatch(/debit|credit/i);
  });

  it('has a short form for tight table cells', () => {
    expect(statementBalanceShortLabel('PAYABLE')).toBe('Payable');
    expect(statementBalanceShortLabel('RECOVERABLE')).toBe('Recoverable');
    expect(statementBalanceShortLabel('ADVANCE')).toBe('Advance');
  });
});

function entry(overrides: Partial<StatementLedgerEntry> = {}): Pick<StatementLedgerEntry, 'date' | 'cycleYear' | 'cycleMonth'> {
  return { date: '2026-03-15', cycleYear: null, cycleMonth: null, ...overrides };
}

describe('statementEntryDateLabel', () => {
  it('uses the cycle period label when the entry is cycle-attributed', () => {
    expect(statementEntryDateLabel(entry({ cycleYear: 2026, cycleMonth: 7 }))).toBe('July 2026');
  });

  it('falls back to the entry own date (DD-MM-YYYY) when there is no cycle attribution', () => {
    expect(statementEntryDateLabel(entry({ date: '2026-03-15', cycleYear: null, cycleMonth: null }))).toBe('15-03-2026');
  });
});

const CYCLE_A = { id: 'cycle-a', year: 2026, month: 1 };
const CYCLE_B = { id: 'cycle-b', year: 2026, month: 6 };

describe('statementPeriodLabel', () => {
  it('shows a no-cycles message for the empty-install case', () => {
    const range: StatementRange = { fromCycle: null, toCycle: null, cycleCount: 0 };
    expect(statementPeriodLabel(range)).toBe('No payroll cycles exist yet');
  });

  it('shows a single-cycle label when from and to are the same cycle', () => {
    const range: StatementRange = { fromCycle: CYCLE_A, toCycle: CYCLE_A, cycleCount: 1 };
    expect(statementPeriodLabel(range)).toBe('January 2026');
  });

  it('shows a from-to range with the cycle count for a multi-cycle window', () => {
    const range: StatementRange = { fromCycle: CYCLE_A, toCycle: CYCLE_B, cycleCount: 6 };
    expect(statementPeriodLabel(range)).toBe('January 2026 – June 2026 (6 cycles)');
  });
});

describe('classifyStatementError', () => {
  it('never offers retry for a 403 and never claims access exists', () => {
    const result = classifyStatementError(new ApiError(403, 'FORBIDDEN', 'no'));
    expect(result.retryable).toBe(false);
    expect(result.headline).toMatch(/do not have access/i);
  });

  it('never distinguishes a genuine 404 from a concealed zero-site-overlap 404, and never retries', () => {
    const result = classifyStatementError(new ApiError(404, 'NOT_FOUND', 'Employee not found'));
    expect(result.retryable).toBe(false);
    expect(result.headline).not.toMatch(/no advances|does not exist/i);
  });

  it('never echoes a raw backend error body for a 404', () => {
    const result = classifyStatementError(new ApiError(404, 'NOT_FOUND', 'Employee not found'));
    expect(result.detail).not.toContain('Employee not found');
  });

  it('offers retry for a generic server error and surfaces the backend message', () => {
    const result = classifyStatementError(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    expect(result.retryable).toBe(true);
    expect(result.detail).toBe('boom');
  });

  it('offers retry for a plain network failure, without a raw stack trace', () => {
    const result = classifyStatementError(new TypeError('Failed to fetch'));
    expect(result.retryable).toBe(true);
    expect(result.detail).not.toContain('TypeError');
  });
});
