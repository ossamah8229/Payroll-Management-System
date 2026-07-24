import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The one shared "Print" action (Standard Print Support checkpoint) — every page listed in the
 * checkpoint's brief (Payroll Entry, Salary Release, Bank Sheet, Cash Receiving, Payslips,
 * Corrections, Employee Registry, Advances) renders this instead of its own ad hoc button, so the
 * action itself, its icon, and its label never drift between pages. `window.print()` is the whole
 * implementation — the actual print *layout* (hiding navigation/filters, A4 sizing, repeated table
 * headers, a generated-at timestamp) is handled by `AppShell`'s own `print:` utility classes and
 * `index.css`'s `@media print` rules, never bespoke per-page CSS.
 */
export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="h-3.5 w-3.5" aria-hidden />
      Print
    </Button>
  );
}
