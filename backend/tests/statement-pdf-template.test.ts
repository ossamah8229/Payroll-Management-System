import { formatMoney } from '@payroll/shared';
import { escapeHtml } from '../src/lib/pdf/html-escape';
import { renderStatementHtml, type StatementPdfMeta } from '../src/lib/pdf/templates/statement';
import type { EmployeeStatement, StatementLedgerEntry } from '../src/modules/statements/statements.types';

/**
 * Phase 7B Checkpoint 1 — pure unit tests for `renderStatementHtml`, no database, no Puppeteer/
 * browser invocation — mirrors `pdf-template.test.ts`'s own approach (and its own documented reason
 * for staying pure: real Puppeteer/PDF-generation coverage lives in the real-HTTP-route integration
 * suite, `statements.test.ts`'s own Checkpoint 1 (PDF) describe block, not duplicated here).
 *
 * The one invariant every test below ultimately protects: this template is a pure renderer of an
 * already-assembled `EmployeeStatement` DTO — it must never sum, net, or recompute a balance, and
 * every monetary/date value must reach the page through `formatMoney`/`formatDate`
 * (`@payroll/shared`), never a raw decimal string or ISO date.
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

function baseStatement(overrides: Partial<EmployeeStatement> = {}): EmployeeStatement {
  return {
    employee: {
      employeeId: 'employee-1',
      employeeCode: 'EMP-0001',
      cnic: '12345-1234567-1',
      name: 'Ali Khan',
      currentSiteId: 'site-1',
      currentSiteName: 'ABL City Region Lahore',
    },
    range: {
      fromCycle: { id: 'cycle-1', year: 2026, month: 1 },
      toCycle: { id: 'cycle-6', year: 2026, month: 6 },
      cycleCount: 6,
    },
    scope: { advanceHistoryIncluded: true },
    openingBalances: { payableOutstanding: '1000.00', recoveryOutstanding: '-500.00', advanceOutstanding: '2500.00' },
    closingBalances: { payableOutstanding: '1500.00', recoveryOutstanding: '-750.00', advanceOutstanding: '1250.00' },
    entries: [baseEntry()],
    generatedAt: '2026-07-28T10:00:00.000Z',
    ...overrides,
  };
}

const baseMeta: StatementPdfMeta = {
  companyName: 'Broom Services (Private) Limited',
  registeredAddress: 'Plot 1, Blue Area, Islamabad',
  generatedByName: 'Master Admin',
  generatedAt: new Date('2026-07-28T15:00:00.000Z'),
};

describe('renderStatementHtml — HTML injection safety (intentionally hostile input)', () => {
  it('never lets a raw <script> tag from the employee name reach the output', () => {
    const statement = baseStatement({
      employee: { ...baseStatement().employee, name: '<script>alert(document.cookie)</script>' },
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).not.toContain('<script>alert(document.cookie)</script>');
    expect(html).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
  });

  it('escapes an <img onerror> injection attempt in a ledger entry description', () => {
    const statement = baseStatement({
      entries: [baseEntry({ description: '<img src=x onerror=alert(1)>' })],
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes hostile input in company name, site name, and generated-by name', () => {
    const statement = baseStatement({
      employee: { ...baseStatement().employee, currentSiteName: '<b>Injected Site</b>' },
    });
    const html = renderStatementHtml(statement, {
      ...baseMeta,
      companyName: '"><svg onload=alert(1)>',
      generatedByName: '<i>Hostile User</i>',
    });
    expect(html).not.toContain('<b>Injected Site</b>');
    expect(html).not.toContain('"><svg onload=alert(1)>');
    expect(html).not.toContain('<i>Hostile User</i>');
    expect(html).toContain('&lt;b&gt;Injected Site&lt;/b&gt;');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(1)&gt;');
    expect(html).toContain('&lt;i&gt;Hostile User&lt;/i&gt;');
  });

  it('escapes hostile input in employee code and CNIC', () => {
    const statement = baseStatement({
      employee: { ...baseStatement().employee, employeeCode: '"><script>x</script>', cnic: "'; DROP TABLE--" },
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).not.toContain('"><script>x</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('renderStatementHtml — opening/closing balances rendered verbatim from the DTO', () => {
  it('renders the opening balances exactly as the DTO provides them, all three kept separate', () => {
    const statement = baseStatement();
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain(escapeHtml(formatMoney(statement.openingBalances.payableOutstanding)));
    expect(html).toContain(escapeHtml(formatMoney(statement.openingBalances.recoveryOutstanding)));
    expect(html).toContain(escapeHtml(formatMoney(statement.openingBalances.advanceOutstanding)));
    expect(html).toContain('Opening Balances');
    expect(html).toContain('brought forward');
  });

  it('renders the closing balances exactly as the DTO provides them, all three kept separate', () => {
    const statement = baseStatement();
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain(escapeHtml(formatMoney(statement.closingBalances.payableOutstanding)));
    expect(html).toContain(escapeHtml(formatMoney(statement.closingBalances.recoveryOutstanding)));
    expect(html).toContain(escapeHtml(formatMoney(statement.closingBalances.advanceOutstanding)));
    expect(html).toContain('Closing Balances');
  });

  it('never combines Payable/Recovery/Advance into one net or total figure', () => {
    // A deliberately distinctive, individually-identifiable triple — if the template ever summed
    // or netted them, no single rendered figure would equal any of these three exact strings.
    const statement = baseStatement({
      closingBalances: { payableOutstanding: '11111.11', recoveryOutstanding: '-22222.22', advanceOutstanding: '33333.33' },
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain(escapeHtml(formatMoney('11111.11')));
    expect(html).toContain(escapeHtml(formatMoney('-22222.22')));
    expect(html).toContain(escapeHtml(formatMoney('33333.33')));
    // The sum/net of the three would render as one of these — neither ever legitimately appears.
    expect(html).not.toContain(escapeHtml(formatMoney('22222.22'))); // 11111.11 + -22222.22 + 33333.33 magnitude coincidence guard
  });

  it('never recomputes a balance — renders exactly the (deliberately internally-inconsistent) DTO value handed to it', () => {
    // Deliberately opening=1000 but closing=1500 with a single zero-movement entry in between —
    // a template that "helpfully" recomputed closing from opening + entries would disagree with
    // this; the correct, safe behavior is to render exactly what the DTO says, no matter what.
    const statement = baseStatement({
      openingBalances: { payableOutstanding: '1000.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' },
      closingBalances: { payableOutstanding: '1500.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' },
      entries: [baseEntry({ movement: null, isInformational: true })],
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain(escapeHtml(formatMoney('1000.00')));
    expect(html).toContain(escapeHtml(formatMoney('1500.00')));
  });
});

describe('renderStatementHtml — ledger row rendering', () => {
  it('renders "Informational" for an entry with movement === null, never a fabricated amount', () => {
    const statement = baseStatement({ entries: [baseEntry({ isInformational: true, movement: null })] });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain('Informational');
    expect(html).not.toMatch(/Informational[\s\S]{0,20}PKR 0\.00 \(/);
  });

  it('renders a real movement with its own direction, amount, and balance label — never invented', () => {
    const statement = baseStatement({
      entries: [
        baseEntry({
          isInformational: false,
          movement: { balance: 'RECOVERABLE', direction: 'DECREASE', amount: '4321.50' },
          runningBalances: { payableOutstanding: '10.00', recoveryOutstanding: '-4321.50', advanceOutstanding: '20.00' },
        }),
      ],
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain(escapeHtml(formatMoney('4321.50')));
    expect(html).toContain('Recoverable');
    expect(html).toContain('−'); // DECREASE renders a minus sign, never a plus
  });

  it('renders running balances exactly as each entry carries them, never inferred from the previous row', () => {
    const entryA = baseEntry({ id: 'a', sequence: 0, runningBalances: { payableOutstanding: '100.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' } });
    const entryB = baseEntry({
      id: 'b',
      sequence: 1,
      isInformational: false,
      movement: { balance: 'PAYABLE', direction: 'INCREASE', amount: '50.00' },
      runningBalances: { payableOutstanding: '999.00', recoveryOutstanding: '0.00', advanceOutstanding: '0.00' },
    });
    const statement = baseStatement({ entries: [entryA, entryB] });
    const html = renderStatementHtml(statement, baseMeta);
    // 999.00, not 150.00 (100 + 50) — proves the template used the DTO's own runningBalances,
    // not a locally-recomputed running total.
    expect(html).toContain(escapeHtml(formatMoney('999.00')));
    expect(html).not.toContain(escapeHtml(formatMoney('150.00')));
  });

  it('categories SALARY/CORRECTION/ADVANCE remain distinguishable text labels', () => {
    const statement = baseStatement({
      entries: [
        baseEntry({ id: '1', category: 'SALARY' }),
        baseEntry({ id: '2', category: 'CORRECTION' }),
        baseEntry({ id: '3', category: 'ADVANCE' }),
      ],
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain('Salary');
    expect(html).toContain('Correction');
    expect(html).toContain('Advance');
  });

  it('renders "No ledger entries" when the range has zero entries, without fabricating a row', () => {
    const statement = baseStatement({ entries: [] });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain('No ledger entries for this Statement Period');
  });
});

describe('renderStatementHtml — Advance-history restriction notice', () => {
  it('renders the restriction notice when advanceHistoryIncluded is false', () => {
    const statement = baseStatement({
      scope: { advanceHistoryIncluded: false, advanceHistoryRestriction: 'CURRENT_SITE_OUT_OF_SCOPE' },
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain('Advance history restricted');
    expect(html).toContain('outside your assigned Site access');
    // Must never imply "no advances" or disclose a hidden count/amount.
    expect(html).not.toMatch(/no advance/i);
    expect(html).not.toContain('advance history restriction');
  });

  it('does not render the restriction notice for a full-scope Statement', () => {
    const statement = baseStatement({ scope: { advanceHistoryIncluded: true } });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).not.toContain('Advance history restricted');
  });
});

describe('renderStatementHtml — header fields (employee/company/period)', () => {
  it('renders employee identity, company identity, and the resolved Statement Period', () => {
    const statement = baseStatement();
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain('Ali Khan');
    expect(html).toContain('EMP-0001');
    expect(html).toContain('12345-1234567-1');
    expect(html).toContain('ABL City Region Lahore');
    expect(html).toContain('Broom Services (Private) Limited');
    expect(html).toContain('Plot 1, Blue Area, Islamabad');
    expect(html).toContain('January 2026');
    expect(html).toContain('June 2026');
    expect(html).toContain('Employee Statement of Account');
  });

  it('omits the registered address text entirely when null, without an empty paragraph', () => {
    const withAddress = renderStatementHtml(baseStatement(), baseMeta);
    const withoutAddress = renderStatementHtml(baseStatement(), { ...baseMeta, registeredAddress: null });
    expect(withAddress).toContain('Plot 1, Blue Area, Islamabad');
    expect(withoutAddress).not.toContain('Plot 1, Blue Area, Islamabad');
  });

  it('renders a single-cycle period without a degenerate range dash', () => {
    const statement = baseStatement({
      range: { fromCycle: { id: 'c', year: 2026, month: 7 }, toCycle: { id: 'c', year: 2026, month: 7 }, cycleCount: 1 },
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).toContain('July 2026');
    expect(html).not.toContain('July 2026 – July 2026');
  });

  it("renders the generated-by name and date, DD-MM-YYYY, never raw ISO", () => {
    const html = renderStatementHtml(baseStatement(), baseMeta);
    expect(html).toContain('Master Admin');
    expect(html).toContain('28-07-2026');
    expect(html).not.toContain('2026-07-28');
  });

  it('falls back to an em dash for a null employee code or CNIC, never the literal text "null"', () => {
    const statement = baseStatement({
      employee: { ...baseStatement().employee, employeeCode: null, cnic: null },
    });
    const html = renderStatementHtml(statement, baseMeta);
    expect(html).not.toContain('null');
  });
});

describe('renderStatementHtml — company logo (Phase 7C)', () => {
  it('embeds the logo inline with the company name when companyLogoDataUri is set', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const html = renderStatementHtml(baseStatement(), { ...baseMeta, companyLogoDataUri: dataUri });
    expect(html).toContain(`<img src="${dataUri}" class="doc-header-logo" alt="" />`);
  });

  it('renders no <img> tag when companyLogoDataUri is null/undefined', () => {
    expect(renderStatementHtml(baseStatement(), { ...baseMeta, companyLogoDataUri: null })).not.toContain('<img');
    expect(renderStatementHtml(baseStatement(), baseMeta)).not.toContain('<img');
  });
});
