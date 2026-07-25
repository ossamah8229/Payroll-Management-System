import { useCallback } from 'react';
import { type PrintSettings, resolveOrientation, type ResolvedPrintOrientation } from './print-types';

const DYNAMIC_PAGE_STYLE_ID = 'app-dynamic-print-page-style';
const FIT_CLASS = 'print-fit';
const ACTIVE_CLASS = 'print-active';

/**
 * A browser's native print dialog is the final authority on paper size/orientation (the OS/driver
 * can still override it) — this application can only set what it *recommends* the browser start
 * from. `@page` is a top-level at-rule that cannot be scoped by a class selector
 * (`.landscape { @page { ... } }` is not valid CSS), so per-print-job orientation is applied the
 * standard way: inject a `<style>` element containing the resolved `@page` rule into `<head>`
 * immediately before `window.print()`, then remove it afterward (`afterprint`, with a timeout
 * fallback in case that event never fires — observed to be unreliable after a cancelled print in
 * some browsers). This is verified in Chromium (docs/architecture/print-architecture.md); document
 * order makes the injected rule win over `index.css`'s own static `@page` fallback with equal
 * specificity, since it's appended after that stylesheet in the document.
 */
function applyPrintLayout(orientation: ResolvedPrintOrientation, fit: PrintSettings['fit']) {
  let styleEl = document.getElementById(DYNAMIC_PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = DYNAMIC_PAGE_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@page { size: A4 ${orientation}; margin: 12mm; }`;

  document.documentElement.classList.toggle(FIT_CLASS, fit === 'fit');
  document.documentElement.classList.add(ACTIVE_CLASS);
}

function clearPrintLayout() {
  document.getElementById(DYNAMIC_PAGE_STYLE_ID)?.remove();
  document.documentElement.classList.remove(FIT_CLASS, ACTIVE_CLASS);
}

/**
 * The one shared "actually print" action — every print-enabled page reaches `window.print()`
 * through this, never directly, so orientation/fit resolution never drifts between pages
 * (`PrintButton` → `PrintSettingsDialog` → this hook).
 */
export function useTriggerPrint(recommendedOrientation: ResolvedPrintOrientation) {
  return useCallback(
    (settings: PrintSettings) => {
      const orientation = resolveOrientation(settings.orientation, recommendedOrientation);
      applyPrintLayout(orientation, settings.fit);

      const cleanup = () => {
        clearPrintLayout();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      // Fallback only — `afterprint` is the normal cleanup path. Long enough that no real print
      // dialog interaction is cut off; short enough that a stuck class never survives meaningfully
      // past the print action itself.
      window.setTimeout(cleanup, 8000);

      window.print();
    },
    [recommendedOrientation],
  );
}
