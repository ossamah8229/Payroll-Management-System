/**
 * The shared "paper document" stylesheet every PDF template in this codebase uses — one
 * definition, reused (not re-implemented) by Payslip today and by Bank Sheet/Cash Sheet/Statement
 * PDF templates whenever those are built, per `docs/design-system.md` §3's own instruction that
 * the printable-document components are "a separate, smaller design system of their own (serif,
 * print conventions) and should live in their own template directory."
 *
 * Deliberately NOT the app's Tailwind component library — a print document follows print-document
 * conventions (serif type, tight grid, bordered "paper" card), not app UI conventions
 * (`docs/design-system.md` §3: "This is a second, intentional typography system — do not unify it
 * with the UI font.").
 */
export const PRINT_STYLES = `
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: "Times New Roman", Times, Georgia, serif;
    font-size: 11pt;
    color: #1a1a1a;
    background: #ffffff;
  }

  .doc-paper {
    border: 1px solid #333333;
    padding: 16px 20px;
  }

  .doc-header {
    text-align: center;
    margin-bottom: 12px;
  }

  .doc-header .doc-company-name {
    font-size: 14pt;
    font-weight: bold;
  }

  .doc-header .doc-company-detail {
    font-size: 9pt;
    color: #333333;
  }

  .doc-title-row {
    display: flex;
    justify-content: space-between;
    font-size: 10pt;
    border-top: 1px solid #333333;
    border-bottom: 1px solid #333333;
    padding: 4px 0;
    margin-bottom: 8px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 24px;
    font-size: 10pt;
    margin-bottom: 12px;
  }

  .info-grid .info-label {
    font-weight: bold;
  }

  .doc-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 16px;
  }

  .doc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10pt;
  }

  .doc-table caption {
    text-align: left;
    font-weight: bold;
    padding-bottom: 4px;
    caption-side: top;
  }

  .doc-table th,
  .doc-table td {
    border-bottom: 1px solid #cccccc;
    padding: 3px 4px;
    text-align: left;
  }

  .doc-table td.doc-amount,
  .doc-table th.doc-amount {
    text-align: right;
  }

  .doc-table tfoot td {
    font-weight: bold;
    border-top: 2px solid #333333;
    border-bottom: none;
  }

  .doc-net-salary {
    text-align: center;
    font-size: 12pt;
    font-weight: bold;
    margin-top: 14px;
    padding-top: 8px;
    border-top: 1px solid #333333;
  }
`;
