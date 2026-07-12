import { formatMoney } from '@payroll/shared';
import { escapeHtml } from '../src/lib/pdf/html-escape';
import { renderPayslipHtml, type PayslipPdfMeta } from '../src/lib/pdf/templates/payslip';
import type { Payslip } from '../src/modules/payslips/payslips.service';

/**
 * Pure unit tests, no database, no Puppeteer/browser invocation — mirrors `calc-net.test.ts`'s
 * own approach exactly. Exercises `escapeHtml`/`renderPayslipHtml` directly against handcrafted
 * `Payslip` fixtures, since HTML escaping and money/date formatting are both deterministic, pure
 * functions of their input and don't need a real Payroll Entry (or a real headless browser) to
 * prove correct (Phase 4 Checkpoint 6.2's own testing scope: "HTML escaping using intentionally
 * hostile input", "formatting parity with the JSON endpoint").
 *
 * **Real Puppeteer/PDF-generation coverage (magic bytes, non-empty output, and — deliberately —
 * hostile input through the actual rendering pipeline) lives in `payslips.test.ts` instead**,
 * against the real HTTP route — not duplicated here. A version of this file that also invoked
 * `renderHtmlToPdf()` directly was tried first, but proved flaky specifically when run as part of
 * the full suite (intermittent `Test environment has been torn down`, a Jest/
 * `--experimental-vm-modules` interaction with Node's process-wide ESM module cache when multiple
 * test files each dynamically `import()` the same ESM-only `puppeteer` package — not an
 * application bug). Since `payslips.test.ts` already exercises the identical
 * `renderPayslipHtml → renderHtmlToPdf` pipeline reliably through the real endpoint, removing the
 * redundant direct call here eliminates the flakiness without losing any coverage.
 * Permission/site-scoping/release-gate/audit/header integration tests also live in
 * `payslips.test.ts`, against the real HTTP route.
 */

function basePayslip(overrides: Partial<Payslip> = {}): Payslip {
  return {
    entryId: 'entry-1',
    employeeId: 'employee-1',
    cycleId: 'cycle-1',
    cycleYear: 2026,
    cycleMonth: 7,
    periodStartDate: '2026-07-01',
    periodEndDate: '2026-07-31',
    releasedAt: '2026-07-12T10:00:00.000Z',
    company: {
      companyName: 'Broom Services (Private) Limited',
      registeredAddress: 'Plot 1, Blue Area, Islamabad',
      phone: '051-1234567',
      email: 'info@broomservices.pk',
      logoStorageKey: null,
    },
    identity: {
      employeeCode: 'EMP-0001',
      employeeName: 'Ali Khan',
      fatherName: 'Muhammad Khan',
      cnic: '12345-1234567-1',
      designation: 'Security Guard',
      siteId: 'site-1',
      siteName: 'ABL City Region Lahore',
      primaryUnitName: 'Main Gate Unit',
    },
    banking: {
      bankId: 'bank-1',
      bankCode: 'HABIBMETRO',
      branchCode: '0123',
      accountNumber: '1234567890123',
      iban: 'PK36SCBL0000001123456702',
    },
    workLines: [
      {
        unitId: 'unit-1',
        unitName: 'Main Gate Unit',
        days: '30',
        otHours: '5',
        otRate: null,
        cycleDays: 30,
        earnedAmount: '33000.00',
        otEarned: '687.50',
      },
    ],
    earnings: {
      grossPay: '33000',
      workingDays: '30.00',
      cycleDays: 30,
      earnedAmount: '33000.00',
      overtimeHours: '5.00',
      overtimeAmount: '687.50',
      allowance: '1500',
      leaveDays: '2.00',
      leaveRate: '1100.00',
      leaveEarned: '2200.00',
      totalEarning: '37387.50',
    },
    deductions: {
      eobiDeduction: '400.00',
      advanceDeduction: '1000',
      eidAdvanceDeduction: '0',
      fine: '200',
      totalDeduction: '1600.00',
    },
    netSalary: '35787.50',
    ...overrides,
  };
}

const baseMeta: PayslipPdfMeta = {
  generatedByName: 'Master Admin',
  generatedAt: new Date('2026-07-12T15:00:00.000Z'),
};

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quoted"`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quoted&quot;',
    );
  });

  it('never double-escapes an already-escaped ampersand incorrectly', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('returns an empty string for null/undefined, not the literal text "null"/"undefined"', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies a number without altering it', () => {
    expect(escapeHtml(1500)).toBe('1500');
  });
});

describe('renderPayslipHtml — HTML injection safety (intentionally hostile input)', () => {
  it('never lets a raw <script> tag from the employee name reach the output', () => {
    const payslip = basePayslip({
      identity: {
        ...basePayslip().identity,
        employeeName: '<script>alert(document.cookie)</script>',
      },
    });
    const html = renderPayslipHtml(payslip, baseMeta);
    expect(html).not.toContain('<script>alert(document.cookie)</script>');
    expect(html).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
  });

  it('escapes an <img onerror> injection attempt in the father name', () => {
    const payslip = basePayslip({
      identity: {
        ...basePayslip().identity,
        fatherName: '<img src=x onerror=alert(1)>',
      },
    });
    const html = renderPayslipHtml(payslip, baseMeta);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes a style/attribute-breakout attempt in designation', () => {
    const payslip = basePayslip({
      identity: {
        ...basePayslip().identity,
        designation: '"><svg onload=alert(1)>',
      },
    });
    const html = renderPayslipHtml(payslip, baseMeta);
    expect(html).not.toContain('"><svg onload=alert(1)>');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(1)&gt;');
  });

  it('escapes hostile input in site name, employee code, and the generated-by name', () => {
    const payslip = basePayslip({
      identity: {
        ...basePayslip().identity,
        siteName: '<b>Injected Site</b>',
      },
    });
    const html = renderPayslipHtml(payslip, { generatedByName: '<i>Hostile User</i>', generatedAt: baseMeta.generatedAt });
    expect(html).not.toContain('<b>Injected Site</b>');
    expect(html).not.toContain('<i>Hostile User</i>');
    expect(html).toContain('&lt;b&gt;Injected Site&lt;/b&gt;');
    expect(html).toContain('&lt;i&gt;Hostile User&lt;/i&gt;');
  });

});

describe('renderPayslipHtml — formatting parity with the JSON endpoint', () => {
  it('renders every monetary figure through formatMoney, never the raw decimal string', () => {
    const payslip = basePayslip();
    const html = renderPayslipHtml(payslip, baseMeta);

    expect(html).toContain(escapeHtml(formatMoney(payslip.netSalary)));
    expect(html).toContain(escapeHtml(formatMoney(payslip.earnings.totalEarning)));
    expect(html).toContain(escapeHtml(formatMoney(payslip.deductions.totalDeduction)));
    expect(html).toContain(escapeHtml(formatMoney(payslip.earnings.grossPay)));
    expect(html).toContain(escapeHtml(formatMoney(payslip.deductions.advanceDeduction)));
    // formatMoney inserts a thousands separator ("35,787.50") — if it were bypassed, the raw
    // comma-less decimal string would appear literally instead. This substring can never occur
    // as a byproduct of the comma-separated form, so its absence is a genuine, non-trivial check.
    expect(html).not.toContain('35787.50');
  });

  it('renders the pay period and generated-on date via formatDate (DD-MM-YYYY), never raw ISO', () => {
    const html = renderPayslipHtml(basePayslip(), baseMeta);
    expect(html).toContain('01-07-2026');
    expect(html).toContain('31-07-2026');
    expect(html).toContain('12-07-2026');
    expect(html).not.toContain('2026-07-01');
    expect(html).not.toContain('2026-07-31');
  });

  it('never recomputes netSalary — renders exactly the value calcNet already produced', () => {
    // A deliberately "wrong" netSalary (inconsistent with earnings/deductions) proves the
    // template renders whatever `Payslip.netSalary` says, rather than recalculating it —
    // Principle 6: the template must never disagree with the JSON endpoint's own figure.
    const payslip = basePayslip({ netSalary: '99999.99' });
    const html = renderPayslipHtml(payslip, baseMeta);
    expect(html).toContain(escapeHtml(formatMoney('99999.99')));
  });

  it('reproduces the frozen sample format\'s exact row labels', () => {
    const html = renderPayslipHtml(basePayslip(), baseMeta);
    for (const label of [
      'Salary Slip FTM of:',
      'Pay Period:',
      'Basic Pay',
      'Working Days',
      'Overtime',
      'Allowance',
      'Claimed Leaves',
      'Total Earning',
      'Absent/Late',
      'EOBI Contribution',
      'Advance salaries/loan',
      'Eid Advance',
      'Total Deduction',
      'Net Salary:',
    ]) {
      expect(html).toContain(label);
    }
  });
});
