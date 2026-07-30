import { formatDate, formatMoney } from '@payroll/shared';
import type { EmployeeStatement, StatementBalances, StatementLedgerEntry } from '../../../modules/statements/statements.types';
import {
  entryDateLabel,
  statementBalanceLabel,
  statementBalanceShortLabel,
  statementCategoryLabel,
  statementPeriodLabel,
} from '../../../modules/statements/statement-labels';
import { escapeHtml } from '../html-escape';
import { PRINT_STYLES } from '../print-styles';

/**
 * Phase 7B Checkpoint 1 — Employee Statement PDF template.
 *
 * **Financial safety (the one invariant this file exists to protect): the canonical
 * `EmployeeStatement` DTO — built once by `statements.service.ts`'s `getEmployeeStatement()` — is
 * this template's sole source of financial truth.** `openingBalances`, every entry's own
 * `movement`/`runningBalances`, and `closingBalances` are rendered exactly as the DTO already
 * carries them: no sum, running total, net figure, or balance is ever computed, inferred from a
 * neighbouring row, or derived here. `formatMoney`/`formatDate` (`@payroll/shared`) only change how
 * a value is *displayed* — they never touch the underlying decimal string. This mirrors
 * `templates/payslip.ts`'s own documented invariant ("no recomputation of any monetary figure...
 * never reformatted independently") applied to a multi-row ledger instead of a single payslip.
 *
 * Pure and side-effect-free, exactly like `renderPayslipHtml`: no I/O, no Prisma, takes only an
 * already-resolved `EmployeeStatement` plus request/company metadata the caller (`statements
 * .service.ts`'s `generateStatementPdf`) has already assembled. Every interpolated string is passed
 * through `escapeHtml()` — no exceptions, matching this codebase's one PDF-injection defense.
 */

export interface StatementPdfMeta {
  companyName: string;
  registeredAddress: string | null;
  generatedByName: string;
  generatedAt: Date;
  /** Print-optimized logo, pre-encoded as a `data:image/png;base64,...` URI (Phase 7C —
   * `modules/settings/company-logo.service.ts`'s `getCompanyLogoDataUri()`), or `null`/`undefined`
   * when no company logo is set. This header block is rendered once, at the top of the flowing
   * HTML document (not a repeating Puppeteer header — `STATEMENT_PDF_FOOTER_TEMPLATE` above is the
   * only thing that actually repeats per page), so this only ever affects page 1's own layout. */
  companyLogoDataUri?: string | null;
}

/**
 * Puppeteer footer template for page numbering (§11 of the checkpoint's own requirements — a
 * Statement, unlike a single-page Payslip, may span many pages). Rendered by Puppeteer in its own
 * isolated context — it does **not** inherit `PRINT_STYLES`/`STATEMENT_EXTRA_STYLES` or any
 * document content, so every rule it needs is inlined here; `pageNumber`/`totalPages` are
 * Puppeteer's own documented special classes, substituted at render time, never computed by this
 * codebase. Exported so `statements.service.ts`'s `renderStatementPdfBuffer` can pass it to
 * `renderHtmlToPdf`'s `footerTemplate` option without duplicating this markup at the call site.
 */
export const STATEMENT_PDF_FOOTER_TEMPLATE =
  '<div style="width: 100%; font-family: Times New Roman, Times, Georgia, serif; font-size: 8px; ' +
  'text-align: center; color: #333333;">Page <span class="pageNumber"></span> of ' +
  '<span class="totalPages"></span></div>';

/** One `<td>`'s worth of movement rendering — `null` (an informational entry) renders the literal
 * word "Informational", never a fabricated `PKR 0.00` or blank cell that could be misread as a real
 * zero-value movement. A real movement renders its own `direction`/`amount`/`balance` verbatim from
 * the DTO — the sign character is presentation only (`direction` already carries the true sign; the
 * DTO's own `amount` is always a positive magnitude string, `StatementMovement`'s own doc comment). */
function movementCell(entry: StatementLedgerEntry): string {
  if (!entry.movement) {
    return '<em>Informational</em>';
  }
  const sign = entry.movement.direction === 'INCREASE' ? '+' : '−';
  return `${sign} ${escapeHtml(formatMoney(entry.movement.amount))} (${escapeHtml(statementBalanceShortLabel(entry.movement.balance))})`;
}

function balancesRow(balances: StatementBalances): string {
  return `
    <tr>
      <td class="doc-amount">${escapeHtml(formatMoney(balances.payableOutstanding))}</td>
      <td class="doc-amount">${escapeHtml(formatMoney(balances.recoveryOutstanding))}</td>
      <td class="doc-amount">${escapeHtml(formatMoney(balances.advanceOutstanding))}</td>
    </tr>`;
}

function balancesTable(caption: string, balances: StatementBalances): string {
  return `
    <table class="doc-table stmt-balances-table">
      <caption>${escapeHtml(caption)}</caption>
      <thead>
        <tr>
          <th class="doc-amount">${escapeHtml(statementBalanceLabel('PAYABLE'))}</th>
          <th class="doc-amount">${escapeHtml(statementBalanceLabel('RECOVERABLE'))}</th>
          <th class="doc-amount">${escapeHtml(statementBalanceLabel('ADVANCE'))}</th>
        </tr>
      </thead>
      <tbody>${balancesRow(balances)}</tbody>
    </table>`;
}

/**
 * Advance-history restriction notice — rendered only when
 * `scope.advanceHistoryIncluded === false`, wording deliberately identical in substance to
 * `statements-page.tsx`'s own `AdvanceRestrictionNotice` (a PDF exported from a restricted view
 * must communicate exactly the same restricted-visibility fact the screen already does, never more
 * or less): it must never imply the employee has no Advance history, and must never disclose a
 * hidden count or amount (this template has no such figures to disclose in the first place — the
 * DTO itself withholds them, `StatementScope`'s own doc comment).
 */
function advanceRestrictionNotice(statement: EmployeeStatement): string {
  if (statement.scope.advanceHistoryIncluded) return '';
  return `
    <div class="stmt-notice">
      <strong>Advance history restricted.</strong> ${escapeHtml(statement.employee.name)}&rsquo;s current Site is
      outside your assigned Site access, so their Advance history is not included in this Statement.
      Salary and Correction entries you have access to are shown in full below.
    </div>`;
}

function ledgerRow(entry: StatementLedgerEntry): string {
  return `
    <tr>
      <td class="stmt-nowrap">${escapeHtml(entryDateLabel(entry))}</td>
      <td class="stmt-nowrap">${escapeHtml(statementCategoryLabel(entry.category))}</td>
      <td>${escapeHtml(entry.description)}</td>
      <td class="doc-amount stmt-nowrap">${movementCell(entry)}</td>
      <td class="doc-amount stmt-nowrap">${escapeHtml(formatMoney(entry.runningBalances.payableOutstanding))}</td>
      <td class="doc-amount stmt-nowrap">${escapeHtml(formatMoney(entry.runningBalances.recoveryOutstanding))}</td>
      <td class="doc-amount stmt-nowrap">${escapeHtml(formatMoney(entry.runningBalances.advanceOutstanding))}</td>
    </tr>`;
}

/** Template-local CSS, appended after the shared `PRINT_STYLES` — never modifies that shared
 * constant (still exactly what `templates/payslip.ts` uses unchanged). Two additions specific to a
 * long, page-spanning ledger table that a single-page Payslip never needed: an explicit
 * `table-header-group` guarantee (Chromium already repeats a real `<thead>` across pages by
 * default; this is the same defensive, belt-and-braces rule `frontend/src/index.css`'s own print
 * stylesheet documents for the on-screen Statement table, applied here to the Puppeteer-rendered
 * copy) and a `break-inside: avoid` on ledger rows so a single row's Date/Category/Description/
 * Movement/three-Balance cells never split across a page boundary. */
const STATEMENT_EXTRA_STYLES = `
  .stmt-header-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 10pt;
    border-top: 1px solid #333333;
    border-bottom: 1px solid #333333;
    padding: 4px 0;
    margin-bottom: 8px;
  }

  .stmt-balances-section {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
    margin-bottom: 12px;
  }

  .stmt-balances-table {
    margin-bottom: 4px;
  }

  .stmt-notice {
    border: 1px solid #333333;
    padding: 6px 8px;
    font-size: 9pt;
    margin-bottom: 10px;
  }

  .stmt-nowrap {
    white-space: nowrap;
  }

  .stmt-ledger-table {
    font-size: 8.5pt;
  }

  .stmt-ledger-table th,
  .stmt-ledger-table td {
    padding: 2px 4px;
  }

  .stmt-ledger-table thead {
    display: table-header-group;
  }

  .stmt-ledger-table tr {
    break-inside: avoid;
  }

  .stmt-empty-ledger {
    padding: 10px 0;
    font-size: 9pt;
    font-style: italic;
    text-align: center;
  }

  /* Same reasoning as templates/payslip.ts's identical rule: capped below the shortest realistic
     height of the existing company-name/address block, so a logo can never grow .doc-header's own
     height regardless of whether a registered address is present. */
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

/**
 * Renders one already-assembled `EmployeeStatement` (Phase 7A Checkpoint 1's
 * `getEmployeeStatement()` output) into the exact HTML `render-pdf.ts` hands to Puppeteer. Pure —
 * see the module doc comment above for the financial-safety invariant this function must never
 * violate.
 */
export function renderStatementHtml(statement: EmployeeStatement, meta: StatementPdfMeta): string {
  const { employee, range, entries } = statement;

  const ledgerRowsHtml = entries.length > 0
    ? entries.map(ledgerRow).join('')
    : `<tr><td colspan="7" class="stmt-empty-ledger">No ledger entries for this Statement Period</td></tr>`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${PRINT_STYLES}${STATEMENT_EXTRA_STYLES}</style>
  </head>
  <body>
    <div class="doc-paper">
      <div class="stmt-header-row">
        <span>Employee Statement of Account</span>
        <span>Statement Period: ${escapeHtml(statementPeriodLabel(range))}</span>
      </div>
      <div class="doc-header">
        <div class="doc-header-row">
          ${meta.companyLogoDataUri ? `<img src="${meta.companyLogoDataUri}" class="doc-header-logo" alt="" />` : ''}
          <div>
            <div class="doc-company-name">${escapeHtml(meta.companyName)}</div>
            ${meta.registeredAddress ? `<div class="doc-company-detail">${escapeHtml(meta.registeredAddress)}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div><span class="info-label">Employee Name:</span> ${escapeHtml(employee.name)}</div>
        <div><span class="info-label">Employee Code:</span> ${escapeHtml(employee.employeeCode ?? '—')}</div>
        <div><span class="info-label">CNIC:</span> ${escapeHtml(employee.cnic ?? '—')}</div>
        <div><span class="info-label">Current Site:</span> ${escapeHtml(employee.currentSiteName)}</div>
      </div>

      ${advanceRestrictionNotice(statement)}

      <div class="stmt-balances-section">
        ${balancesTable('Opening Balances (brought forward)', statement.openingBalances)}
      </div>

      <table class="doc-table stmt-ledger-table">
        <thead>
          <tr>
            <th>Date / Period</th>
            <th>Category</th>
            <th>Description</th>
            <th class="doc-amount">Movement</th>
            <th class="doc-amount">Running Payable</th>
            <th class="doc-amount">Running Recovery</th>
            <th class="doc-amount">Running Advance</th>
          </tr>
        </thead>
        <tbody>${ledgerRowsHtml}</tbody>
      </table>

      <div class="stmt-balances-section" style="margin-top: 10px;">
        ${balancesTable('Closing Balances', statement.closingBalances)}
      </div>

      <div class="doc-header" style="margin-top: 16px;">
        <div class="doc-company-detail">
          Generated by ${escapeHtml(meta.generatedByName)} on ${escapeHtml(formatDate(meta.generatedAt.toISOString()))}
        </div>
      </div>
    </div>
  </body>
</html>`;
}
