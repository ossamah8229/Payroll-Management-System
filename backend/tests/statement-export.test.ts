import { buildStatementLedgerExportRow } from '../src/modules/statements/statements.service';
import type { StatementLedgerEntry } from '../src/modules/statements/statements.types';

/**
 * Phase 7B Checkpoint 2 — pure unit tests for `buildStatementLedgerExportRow`, the one row-builder
 * shared by both `exportStatementToCsv` and `exportStatementToXlsx`. No database, no HTTP — mirrors
 * `statement-pdf-template.test.ts`'s own approach (real-HTTP/DB integration coverage, including CSV
 * injection routing through `stringifyCsvSafe`, RBAC, scope, audit, and cross-format DTO consistency,
 * lives in `statements.test.ts`'s own Checkpoint 2 describe block, not duplicated here).
 *
 * The one invariant every test below ultimately protects, stated exactly as
 * `templates/statement.ts`'s own module doc comment states it for the PDF template: this function is
 * a pure flattener of an already-computed `StatementLedgerEntry` — it must never sum, net, or
 * recompute a balance; every running-balance cell must equal `entry.runningBalances`'s own value,
 * verbatim.
 */

function baseEntry(overrides: Partial<StatementLedgerEntry> = {}): StatementLedgerEntry {
  return {
    id: 'entry-1',
    date: '2026-07-15',
    cycleId: 'cycle-1',
    cycleYear: 2026,
    cycleMonth: 7,
    category: 'SALARY',
    kind: 'CYCLE_PAID',
    isInformational: true,
    movement: null,
    runningBalances: { payableOutstanding: '0.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' },
    description: 'Net Salary Paid — 2026-07: PKR 35,000.00',
    reference: { payrollEntryId: 'entry-1' },
    sequence: 0,
    ...overrides,
  };
}

describe('buildStatementLedgerExportRow', () => {
  it('renders "Informational" for an entry with movement === null, never a fabricated amount', () => {
    const row = buildStatementLedgerExportRow(baseEntry({ isInformational: true, movement: null }));
    expect(row[3]).toBe('Informational');
  });

  it('renders an INCREASE movement with a "+" sign, the raw amount, and the short balance label', () => {
    const row = buildStatementLedgerExportRow(
      baseEntry({
        isInformational: false,
        movement: { balance: 'PAYABLE', direction: 'INCREASE', amount: '1234.56' },
      }),
    );
    expect(row[3]).toBe('+ 1234.56 (Payable)');
  });

  it('renders a DECREASE movement with a "-" sign, never a "+"', () => {
    const row = buildStatementLedgerExportRow(
      baseEntry({
        isInformational: false,
        movement: { balance: 'RECOVERABLE', direction: 'DECREASE', amount: '4321.50' },
      }),
    );
    expect(row[3]).toBe('- 4321.50 (Recoverable)');
  });

  it('renders the movement amount as its own raw decimal string, never currency-formatted (no thousands separator, no PKR prefix)', () => {
    const row = buildStatementLedgerExportRow(
      baseEntry({
        isInformational: false,
        movement: { balance: 'ADVANCE', direction: 'INCREASE', amount: '150000.00' },
      }),
    );
    expect(row[3]).toBe('+ 150000.00 (Advance)');
    expect(row[3]).not.toContain(',');
    expect(row[3]).not.toContain('PKR');
  });

  it('renders running balances exactly as the entry carries them, verbatim — the financial invariant', () => {
    // Deliberately internally "surprising" figures — if this function ever recomputed a balance
    // from a neighbouring row or from the movement amount, it could not possibly reproduce this
    // exact, arbitrary triple.
    const row = buildStatementLedgerExportRow(
      baseEntry({
        isInformational: false,
        movement: { balance: 'PAYABLE', direction: 'INCREASE', amount: '50.00' },
        runningBalances: { payableOutstanding: '999.00', recoveryOutstanding: '-4321.50', advanceOutstanding: '20.00' },
      }),
    );
    expect(row[4]).toBe('999.00');
    expect(row[5]).toBe('-4321.50');
    expect(row[6]).toBe('20.00');
  });

  it('never combines Payable/Recovery/Advance into one net or total figure', () => {
    const row = buildStatementLedgerExportRow(
      baseEntry({
        runningBalances: { payableOutstanding: '11111.11', recoveryOutstanding: '-22222.22', advanceOutstanding: '33333.33' },
      }),
    );
    expect(row[4]).toBe('11111.11');
    expect(row[5]).toBe('-22222.22');
    expect(row[6]).toBe('33333.33');
    expect(row).not.toContain('22222.22');
  });

  it('uses the cycle period label when the entry has a cycle, and the raw description verbatim', () => {
    const row = buildStatementLedgerExportRow(baseEntry({ cycleYear: 2026, cycleMonth: 7, description: 'Net Salary Paid' }));
    expect(row[0]).toBe('July 2026');
    expect(row[1]).toBe('Salary');
    expect(row[2]).toBe('Net Salary Paid');
  });

  it('falls back to the entry\'s own date when there is no cycle attribution (e.g. a standalone Advance event)', () => {
    const row = buildStatementLedgerExportRow(
      baseEntry({ cycleId: null, cycleYear: null, cycleMonth: null, date: '2026-03-10', category: 'ADVANCE' }),
    );
    expect(row[0]).not.toBe('July 2026');
    expect(row[1]).toBe('Advance');
  });

  it('maps every StatementLedgerCategory to its own label', () => {
    expect(buildStatementLedgerExportRow(baseEntry({ category: 'SALARY' }))[1]).toBe('Salary');
    expect(buildStatementLedgerExportRow(baseEntry({ category: 'CORRECTION' }))[1]).toBe('Correction');
    expect(buildStatementLedgerExportRow(baseEntry({ category: 'ADVANCE' }))[1]).toBe('Advance');
  });

  it('returns exactly seven columns, matching STATEMENT_LEDGER_EXPORT_HEADERS width', () => {
    const row = buildStatementLedgerExportRow(baseEntry());
    expect(row).toHaveLength(7);
  });
});
