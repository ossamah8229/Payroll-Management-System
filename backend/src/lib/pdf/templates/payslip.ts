import { formatDate, formatMoney, formatNumber } from '@payroll/shared';
import type { Payslip } from '../../../modules/payslips/payslips.service';
import { escapeHtml } from '../html-escape';
import { PRINT_STYLES } from '../print-styles';

/** Request-specific rendering context — who is generating this PDF and when. Deliberately kept
 * separate from the `Payslip` DTO itself (`payslips.service.ts`'s own `getPayslip()`): the DTO is
 * a pure function of `(cycleId, employeeId)`, and must stay that way, not polluted with who
 * happens to be asking right now. Mirrors `cash-receiving.service.ts`'s own
 * `CashReceivingDocumentMeta { generatedByName, generatedAt }` shape exactly. */
export interface PayslipPdfMeta {
  generatedByName: string;
  generatedAt: Date;
  /** Print-optimized logo, pre-encoded as a `data:image/png;base64,...` URI (Phase 7C —
   * `modules/settings/company-logo.service.ts`'s `getCompanyLogoDataUri()`), or `null`/`undefined`
   * when no company logo is set. Fetched once per request by the route/batch caller, never here —
   * this stays a pure rendering function, matching this module's own "no I/O" invariant above. */
  companyLogoDataUri?: string | null;
}

/** Rendered only next to the company name, capped at a height (18px) that stays below the
 * shortest realistic content height of the existing two-line company-name/address block (a 14pt
 * bold line alone is already ~19-20px tall in the Times New Roman print stylesheet) — this
 * guarantees the logo can never grow `.doc-header`'s own height, regardless of whether a
 * registered address is present. Deliberately local to this template (not added to the shared
 * `PRINT_STYLES`, which Bank Sheet/Cash Sheet templates also use) so this change's blast radius
 * stays limited to the Payslip template alone. */
const PAYSLIP_EXTRA_STYLES = `
  .doc-header-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .doc-header-logo {
    display: block;
    height: 18px;
    width: auto;
  }
`;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "July 2026" from a plain year/month pair — presentation-only, local to this one template
 * (no other document type resolves a cycle label this way yet, so there is nothing to share it
 * with — extracting a shared helper now would be exactly the speculative abstraction this
 * checkpoint's scope explicitly avoids). */
function formatCycleLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ''} ${year}`;
}

/**
 * Renders one assembled `Payslip` (Checkpoint 6.1's `getPayslip()` output) into the exact HTML
 * `render-pdf.ts` hands to Puppeteer. Pure — no I/O, no Prisma, no recomputation of any monetary
 * figure; every number/date passed through is rendered via `formatMoney`/`formatDate`/
 * `formatNumber` from `@payroll/shared`, never reformatted independently (Principle 6).
 *
 * **Every interpolated value is escaped via `escapeHtml()` — no exceptions**, including fields
 * that look "safe" (designation, site name) — this checkpoint's own security requirement, since
 * none of these strings have any character restriction upstream.
 *
 * Layout matches `reference/PROJECT_SPEC.md`'s frozen "Sample Payslip Format" as closely as
 * possible: title row (month + pay period) → centered company name → two-column identity grid →
 * side-by-side Earning/Deduction tables → centered Net Salary line.
 *
 * **Balance Settlement line, not yet implemented**: `docs/design-system.md` §3 reserves a slot
 * here for an optional Balance Salary Payable/Recovery line once Phase 6 (Balance Adjustments)
 * exists — there is no field for it on the `Payslip` DTO yet (Phase 6 isn't built), so nothing is
 * rendered for it today. When Phase 6 ships, add it as a conditionally-rendered row directly
 * below the Net Salary line, not by restructuring this function.
 */
export function renderPayslipHtml(payslip: Payslip, meta: PayslipPdfMeta): string {
  const { company, identity, banking, earnings, deductions } = payslip;

  const earningRows = [
    { label: 'Basic Pay', qty: '', amount: earnings.grossPay },
    { label: 'Working Days', qty: formatNumber(earnings.workingDays), amount: earnings.earnedAmount },
    { label: 'Overtime', qty: formatNumber(earnings.overtimeHours), amount: earnings.overtimeAmount },
    { label: 'Allowance', qty: '', amount: earnings.allowance },
    { label: 'Claimed Leaves', qty: formatNumber(earnings.leaveDays), amount: earnings.leaveEarned },
  ];

  const deductionRows = [
    { label: 'Absent/Late', amount: deductions.fine },
    { label: 'EOBI Contribution', amount: deductions.eobiDeduction },
    { label: 'Advance salaries/loan', amount: deductions.advanceDeduction },
    { label: 'Eid Advance', amount: deductions.eidAdvanceDeduction },
  ];

  const earningRowsHtml = earningRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td class="doc-amount">${escapeHtml(row.qty)}</td>
          <td class="doc-amount">${escapeHtml(formatMoney(row.amount))}</td>
        </tr>`,
    )
    .join('');

  const deductionRowsHtml = deductionRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td class="doc-amount">${escapeHtml(formatMoney(row.amount))}</td>
        </tr>`,
    )
    .join('');

  // A split-by-unit entry's individual work lines aren't part of the frozen sample format (which
  // predates Split by Unit entirely) — the Earning table's "Working Days"/"Overtime" rows above
  // already show the entry-level totals `buildPayslip()` sums across every line, matching the
  // spec's own single-row-per-earning-type shape. `payslip.workLines` itself is deliberately not
  // rendered as a separate breakdown here.

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${PRINT_STYLES}${PAYSLIP_EXTRA_STYLES}</style>
  </head>
  <body>
    <div class="doc-paper">
      <div class="doc-title-row">
        <span>Salary Slip FTM of: ${escapeHtml(formatCycleLabel(payslip.cycleYear, payslip.cycleMonth))}</span>
        <span>Pay Period: ${escapeHtml(formatDate(payslip.periodStartDate))} &ndash; ${escapeHtml(formatDate(payslip.periodEndDate))}</span>
      </div>
      <div class="doc-header">
        <div class="doc-header-row">
          ${meta.companyLogoDataUri ? `<img src="${meta.companyLogoDataUri}" class="doc-header-logo" alt="" />` : ''}
          <div>
            <div class="doc-company-name">${escapeHtml(company.companyName)}</div>
            ${company.registeredAddress ? `<div class="doc-company-detail">${escapeHtml(company.registeredAddress)}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div><span class="info-label">Employee Name:</span> ${escapeHtml(identity.employeeName)}</div>
        <div><span class="info-label">Father Name:</span> ${escapeHtml(identity.fatherName ?? '')}</div>
        <div><span class="info-label">Account Number:</span> ${escapeHtml(banking.accountNumber ?? '')}</div>
        <div><span class="info-label">CNIC:</span> ${escapeHtml(identity.cnic ?? '')}</div>
        <div><span class="info-label">Designation:</span> ${escapeHtml(identity.designation)}</div>
        <div><span class="info-label">Deputed Location:</span> ${escapeHtml(identity.siteName)}</div>
      </div>

      <div class="doc-columns">
        <table class="doc-table">
          <caption>EARNING</caption>
          <thead>
            <tr><th>Description</th><th class="doc-amount">Days/Hours</th><th class="doc-amount">Amount</th></tr>
          </thead>
          <tbody>${earningRowsHtml}</tbody>
          <tfoot>
            <tr><td>Total Earning</td><td></td><td class="doc-amount">${escapeHtml(formatMoney(earnings.totalEarning))}</td></tr>
          </tfoot>
        </table>

        <table class="doc-table">
          <caption>DEDUCTION</caption>
          <thead>
            <tr><th>Description</th><th class="doc-amount">Amount</th></tr>
          </thead>
          <tbody>${deductionRowsHtml}</tbody>
          <tfoot>
            <tr><td>Total Deduction</td><td class="doc-amount">${escapeHtml(formatMoney(deductions.totalDeduction))}</td></tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-net-salary">Net Salary: ${escapeHtml(formatMoney(payslip.netSalary))}</div>

      <div class="doc-header" style="margin-top: 16px;">
        <div class="doc-company-detail">
          Generated by ${escapeHtml(meta.generatedByName)} on ${escapeHtml(formatDate(meta.generatedAt))}
        </div>
      </div>
    </div>
  </body>
</html>`;
}
