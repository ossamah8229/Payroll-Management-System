import { useCompanySettings } from '@/hooks/use-company-settings';

/**
 * The one shared print-only header (Standard Print Support checkpoint) — invisible on screen
 * (`hidden print:block`), so it never competes with the page's own on-screen title/topbar, and
 * appears only at the top of the printed output: company name, this page's own title, the
 * cycle/site context the on-screen filters had narrowed to (so a printed page is still
 * self-describing once separated from the browser it was printed from), and a generated-at
 * timestamp — every field the checkpoint's own "Print layout" section names explicitly.
 */
export function PrintContextHeader({ title, context }: { title: string; context?: string }) {
  const companySettings = useCompanySettings();

  return (
    <div className="hidden print:mb-4 print:block print:border-b print:border-border print:pb-3">
      <p className="text-sm font-bold">{companySettings.data?.companyName ?? 'Payroll Management System'}</p>
      <p className="text-xs font-semibold">{title}</p>
      {context && <p className="text-[11px] text-text-muted">{context}</p>}
      <p className="text-[10px] text-text-faint">Generated {new Date().toLocaleString()}</p>
    </div>
  );
}
