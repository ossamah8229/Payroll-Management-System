import { useCallback, type RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

/**
 * Delegated Up/Down/Enter keyboard navigation for the Payroll Entry grid — Tab/Shift+Tab already
 * work natively (editable cells are ordinary focusable elements in DOM order), so this only needs
 * to handle vertical movement within the same column, including across the virtualizer's mount/
 * unmount boundary (a target row a few screens away may not be in the DOM yet).
 */
export function useGridKeyboardNav(
  containerRef: RefObject<HTMLDivElement>,
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>,
  rowCount: number,
) {
  const focusCell = useCallback(
    (row: number, col: string, attemptsLeft = 6) => {
      const container = containerRef.current;
      if (!container) return;
      const selector = `[data-grid-row="${row}"][data-grid-col="${CSS.escape(col)}"]`;
      const target = container.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus();
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          target.select();
        }
        return;
      }
      if (attemptsLeft <= 0) return;
      // Not mounted yet (virtualized row outside the current render window) — ask the virtualizer
      // to scroll it into view, then retry on the next animation frame once React has rendered it.
      rowVirtualizer.scrollToIndex(row, { align: 'auto' });
      requestAnimationFrame(() => focusCell(row, col, attemptsLeft - 1));
    },
    [containerRef, rowVirtualizer],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') return;

      const target = event.target as HTMLElement;
      const cell = target.closest<HTMLElement>('[data-grid-row][data-grid-col]');
      if (!cell) return;

      const row = Number(cell.dataset.gridRow);
      const col = cell.dataset.gridCol!;
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      const nextRow = row + delta;
      if (nextRow < 0 || nextRow >= rowCount) return;

      event.preventDefault();
      focusCell(nextRow, col);
    },
    [focusCell, rowCount],
  );

  return { handleKeyDown };
}
