import { useCompanySettings } from '@/hooks/use-company-settings';
import { DocumentLogo } from './document-logo';

/**
 * The one shared print-only header (Standard Print Support checkpoint) — invisible on screen
 * (`hidden print:block`), so it never competes with the page's own on-screen title/topbar, and
 * appears only at the top of the printed output: company name, this page's own title, the
 * cycle/site context the on-screen filters had narrowed to (so a printed page is still
 * self-describing once separated from the browser it was printed from), and a generated-at
 * timestamp — every field the checkpoint's own "Print layout" section names explicitly.
 *
 * `showLogo` (Phase 7C) is an explicit opt-in, not a default — this component is shared by every
 * print-enabled page (Payslips list, Statements, Bank Sheet, Cash Receiving), so a blind default
 * would apply to all of them at once with no per-document layout verification. Only pass it once a
 * specific document's print output has actually been checked (page count, row count, no new
 * wrapping) against its own min/max-row fixtures — see docs/architecture/print-architecture.md.
 * `<DocumentLogo>` is capped below this row's own text line height, so enabling it can never grow
 * this header's height regardless.
 */
export function PrintContextHeader({
  title,
  context,
  showLogo = false,
}: {
  title: string;
  context?: string;
  showLogo?: boolean;
}) {
  const companySettings = useCompanySettings();

  return (
    <div className="hidden print:mb-4 print:block print:border-b print:border-border print:pb-3">
      <div className="flex items-center gap-1.5">
        {showLogo && companySettings.data?.hasLogo && <DocumentLogo />}
        <p className="text-sm font-bold">{companySettings.data?.companyName ?? 'Payroll Management System'}</p>
      </div>
      <p className="text-xs font-semibold">{title}</p>
      {context && <p className="text-[11px] text-text-muted">{context}</p>}
      <p className="text-[10px] text-text-faint">Generated {new Date().toLocaleString()}</p>
    </div>
  );
}
