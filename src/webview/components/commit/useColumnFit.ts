import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";

import { DESCRIPTION_COLUMN, OPTIONAL_COLUMNS } from "@/webview/constants";
import { chosenColumns, columnWidths, crowdedColumns, shownColumns } from "@/webview/lib/stores";
import { crowdedCells } from "@/webview/utils/columns";

/**
 * The width each optional cell took the last time it showed, which is what leaving it out gives
 * back and showing it again costs. Until a cell has been measured, a usual width stands in.
 */
const measured = new Map<number, number>([
  [OPTIONAL_COLUMNS.date, 134],
  [OPTIONAL_COLUMNS.author, 100],
  [OPTIONAL_COLUMNS.commit, 72]
]);

/**
 * Measure the header row and leave out the columns the table has no room for. Nothing is done
 * while the table has no width, as before its first layout.
 */
function fit(container: HTMLElement, row: HTMLTableRowElement) {
  const available = container.clientWidth - parseFloat(getComputedStyle(container).paddingRight);
  if (!(available > 0)) {
    return;
  }
  const shown = shownColumns.peek();
  let description = 0;
  shown.forEach((cell, at) => {
    const width = row.cells.item(at)?.getBoundingClientRect().width ?? 0;
    if (cell === DESCRIPTION_COLUMN) {
      description = width;
    } else if (measured.has(cell) && width > 0) {
      measured.set(cell, width);
    }
  });
  // A table wider than its container shows the description at its narrowest, not at what is left.
  const overflow = Math.max(0, row.getBoundingClientRect().width - available);
  const next = crowdedCells(
    chosenColumns.peek(),
    crowdedColumns.peek(),
    description - overflow,
    (cell) => measured.get(cell) ?? 0
  );
  if (next.join() !== crowdedColumns.peek().join()) {
    crowdedColumns.value = next;
  }
}

/**
 * Keep the description readable in a narrow table: the ID, then the author, then the date give
 * way while it has too little room, and return when there is room again. The user's choice of
 * columns is left alone, and so are their widths.
 */
export function useColumnFit(
  containerRef: RefObject<HTMLElement | null>,
  headRef: RefObject<HTMLTableRowElement | null>
) {
  // Read during render, so that a new choice, new widths or a new fit are measured in turn. Each
  // pass moves the fit one way only, so the passes end.
  const chosen = chosenColumns.value;
  const widths = columnWidths.value;
  const shown = shownColumns.value;
  useLayoutEffect(() => {
    if (containerRef.current !== null && headRef.current !== null) {
      fit(containerRef.current, headRef.current);
    }
  }, [chosen, widths, shown]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof ResizeObserver === "undefined") {
      return;
    }
    // Delivered after layout and before paint, so a resize never shows a crowded frame.
    const observer = new ResizeObserver(() => {
      if (headRef.current !== null) {
        fit(container, headRef.current);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
}
