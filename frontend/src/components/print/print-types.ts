/**
 * RBAC Creator Ownership & Professional Printing checkpoint — the shared print-layout system's
 * type vocabulary. `docs/architecture/print-architecture.md` is the full write-up; this file is
 * just the shapes every print-enabled page and the shared dialog/hook agree on.
 */

/** `auto` resolves to a page's own `recommendedOrientation` at print time (see `use-print.ts`) —
 * the default selection, not a fixed choice, so a page can recommend Landscape for a wide table
 * without forcing it; the user can still pick Portrait/Landscape explicitly. */
export type PrintOrientation = 'auto' | 'portrait' | 'landscape';

export type ResolvedPrintOrientation = 'portrait' | 'landscape';

/** `fit` scales table typography/column layout to the printable page WIDTH only (never forces a
 * dataset's full row count onto one physical sheet — see the architecture doc's "Fit to page"
 * semantics). `normal` prints at each page's own default table sizing, which may overflow for a
 * wide table; an explicit opt-out, not the default. */
export type PrintFitMode = 'fit' | 'normal';

export interface PrintSettings {
  orientation: PrintOrientation;
  fit: PrintFitMode;
}

export function resolveOrientation(
  orientation: PrintOrientation,
  recommended: ResolvedPrintOrientation,
): ResolvedPrintOrientation {
  return orientation === 'auto' ? recommended : orientation;
}
