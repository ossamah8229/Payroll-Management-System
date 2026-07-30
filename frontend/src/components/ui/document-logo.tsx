import { COMPANY_LOGO_PRINT_URL } from '@/hooks/use-company-settings';

/**
 * The one shared "small logo next to the company name" element for printable documents that have
 * no PDF pipeline (Bank Sheet, Cash Receiving — `<PrintContextHeader>` and Cash Receiving's own
 * document header, Phase 7C). Always the print-optimized asset, never the UI asset — this element
 * only ever appears inside a print-typography document header, on-screen or in an actual printed
 * page alike (Cash Receiving's own header renders even outside `@media print`, per its existing
 * "this actually gets printed today via the browser's own print" doc comment).
 *
 * Capped at a fixed small height, deliberately below the shortest existing text line height it
 * sits beside in every caller (mirrors `templates/payslip.ts`/`templates/statement.ts`'s identical
 * PDF-side rule) — this guarantees the logo can never grow its row's height, so it can never shift
 * table pagination. `onError` hides the element entirely rather than leaving a broken-image icon
 * in the layout if the request ever fails (no logo set, network hiccup, etc.) — callers still
 * gate rendering on `hasLogo` themselves so the common "no logo" case never issues the request at
 * all, but this is the safety net for the request itself failing regardless.
 */
export function DocumentLogo({ className = 'h-3.5 w-auto' }: { className?: string }) {
  return (
    <img
      src={COMPANY_LOGO_PRINT_URL}
      alt=""
      className={className}
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}
