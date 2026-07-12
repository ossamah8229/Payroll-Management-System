/**
 * Deterministic, dependency-free text-width estimation — the "ch-based calculation" option
 * (2026-07-13 Layout Integrity correction), chosen over `<canvas>` `measureText` specifically so
 * this stays unit-testable in a plain Node/Vitest environment with no DOM/canvas polyfill, per the
 * "avoid fragile screenshot-only checks when deterministic width logic can be unit tested"
 * instruction.
 *
 * The per-character-class widths below are not guessed — they were measured directly in a real
 * headless Chromium instance (Playwright) against this app's actual font stack (`-apple-system,
 * BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`) at the exact sizes/weights this grid
 * uses: 12px/400 for cell values (`InlineTextCell`/`InlineNumberCell`/`InlineSelectCell`'s
 * `text-xs`), 10px/600 for column headers. Validated against real sample strings (a 24-character
 * IBAN, a 20-digit account number, a 10-character bank code) within 1–4px — comfortably inside the
 * padding budget every caller already adds on top. Re-measure and update these constants if the
 * app's font stack or base sizes ever change.
 */
type CharClass = 'digit' | 'upper' | 'lower' | 'space' | 'other';
type CharWeights = Record<CharClass, number>;

const CHAR_WIDTH: { body: CharWeights; header: CharWeights } = {
  body: { digit: 7.3, upper: 8.2, lower: 6.4, space: 3.4, other: 4.5 },
  header: { digit: 6.5, upper: 7.2, lower: 5.8, space: 2.8, other: 4.1 },
};

function classify(ch: string): CharClass {
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch >= 'A' && ch <= 'Z') return 'upper';
  if (ch >= 'a' && ch <= 'z') return 'lower';
  if (ch === ' ') return 'space';
  return 'other';
}

function estimateTextWidth(text: string, weights: CharWeights): number {
  let width = 0;
  for (const ch of text) width += weights[classify(ch)];
  return width;
}

export interface MeasureColumnWidthOptions {
  /** The column header's own label — a column is never narrower than its header needs, even if
   * every loaded value happens to be short or the dataset is empty. */
  header: string;
  /** Every rendered value currently loaded for this column (the full dataset, not just whichever
   * rows a virtualizer happens to have mounted) — nullish entries are skipped. */
  values: (string | null | undefined)[];
  /** Extra horizontal budget beyond the raw text: cell padding, input/select border, and any
   * icon/badge/toggle sharing the column. Defaults to this grid's own `InlineTextCell`/
   * `InlineSelectCell` chrome (`px-1.5` padding × 2 + border × 2 = 14px) plus deliberate margin,
   * not a bare fit. */
  paddingPx?: number;
  /** Never narrower than this, however short the loaded data is — keeps a column from looking
   * cramped when a dataset is empty or every value is unusually short today. */
  minimumPx?: number;
}

const DEFAULT_PADDING_PX = 24;
const DEFAULT_MINIMUM_PX = 60;

/**
 * One column's required width — the longer of its header and its longest loaded value, plus
 * padding, floored at a minimum. Pure and synchronous: no DOM, no canvas, safe to call from a unit
 * test or from `useMemo` in the real grid identically.
 */
export function measureColumnWidth({
  header,
  values,
  paddingPx = DEFAULT_PADDING_PX,
  minimumPx = DEFAULT_MINIMUM_PX,
}: MeasureColumnWidthOptions): number {
  // Header cells render with CSS `text-transform: uppercase` (see payroll-entry-grid.tsx's
  // `role="columnheader"` class), so a mixed-case label like "Branch Code" is displayed as wider
  // uppercase glyphs — measuring the literal-case string underestimated real header width and
  // caused a confirmed truncation risk (Playwright: "Branch Code" scrollWidth 91 > clientWidth 88).
  const headerWidth = estimateTextWidth(header.toUpperCase(), CHAR_WIDTH.header);
  let longestValueWidth = 0;
  for (const value of values) {
    if (!value) continue;
    const width = estimateTextWidth(value, CHAR_WIDTH.body);
    if (width > longestValueWidth) longestValueWidth = width;
  }
  const contentWidth = Math.max(headerWidth, longestValueWidth);
  return Math.max(minimumPx, Math.ceil(contentWidth + paddingPx));
}
