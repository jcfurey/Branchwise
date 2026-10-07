import { ROW_HEIGHT } from "@/webview/constants";
import { LANE_OFFSET, LANE_WIDTH } from "@/webview/graph/constants";
import type { GraphExpansion, GraphLayout } from "@/webview/graph/types";

/*
 * Pixels. The graph is drawn on a grid of lanes (columns) and rows. Rows are `rowHeight` tall,
 * the height the `rowDensity` setting gives the table's rows, and the default density's otherwise.
 */

/** Horizontal centre of a lane: where its dots and straight lines are drawn. */
export function laneX(x: number): number {
  return LANE_OFFSET + x * LANE_WIDTH;
}

/** Vertical middle of a row, before any shift from the open commit details. */
export function rowY(y: number, rowHeight: number = ROW_HEIGHT): number {
  return (y + 0.5) * rowHeight;
}

/** A missing expansion, whether `null` or `undefined`, means no details are open. */
function isOpen(expansion: GraphExpansion | null): expansion is GraphExpansion {
  return expansion !== null && expansion !== undefined;
}

/**
 * Width of the drawing. The margin right of the last lane matches the one
 * left of the first, so the outer dots are never clipped.
 */
export function graphWidth(layout: GraphLayout): number {
  return layout.lanes > 0 ? laneX(layout.lanes - 1) + LANE_OFFSET : 0;
}

/**
 * Height of the drawing. Open details add their height only when they belong
 * to one of the layout's rows; anywhere else they would leave an empty gap.
 */
export function graphHeight(
  layout: GraphLayout,
  expansion: GraphExpansion | null,
  rowHeight: number = ROW_HEIGHT
): number {
  const rows = layout.vertices.length;
  const height = rows * rowHeight;
  if (isOpen(expansion) && expansion.row >= 0 && expansion.row < rows) {
    return height + expansion.height;
  }
  return height;
}

/**
 * How far a row moves down to make room for the open details. They open
 * beneath their own row, so only the rows after it move. `strokes.ts` shifts
 * lines by the same rule, so that lines still meet the dots.
 */
export function expandOffset(row: number, expansion: GraphExpansion | null): number {
  return isOpen(expansion) && row > expansion.row ? expansion.height : 0;
}
