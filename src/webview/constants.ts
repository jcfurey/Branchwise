import type { OptionalColumn, RowDensity } from "@/types";

/* Values that mean "not a real branch or commit" */

/** The branch choice that shows every branch, with nothing filtered or emphasised. */
export const SHOW_ALL_BRANCHES = "*";

/** The `hash` of the row standing for the working tree's changes, listed above every commit. */
export const UNCOMMITTED_CHANGES = "*";

/** The batch cherry-pick and revert dialogs refuse selections larger than this. */
export const BATCH_LIMIT = 100;

/* Table geometry, in CSS pixels */

/**
 * The height of every commit row at each `branchwise.rowDensity`, and so the graph's row pitch:
 * row `y` is centred at `(y + 0.5)` times the height. Rendered rows must be exactly this tall, or
 * the dots drift off them. Compact stops at 20, the height of the row's menu button, so that no
 * control in a row gets smaller than it is at the default density; only the gaps between rows do.
 */
export const ROW_HEIGHTS: Readonly<Record<RowDensity, number>> = Object.freeze({
  compact: 20,
  default: 24,
  comfortable: 30
});

/** The row height of the default density, which the graph's drawing functions assume unless told. */
export const ROW_HEIGHT = ROW_HEIGHTS.default;

/** The height of the table's header row, and the graph's top offset when nothing else sets one. */
export const TABLE_HEADER_HEIGHT = 32;

/** The height of the commit details opened under a row; the rows and lines below move down by it. */
export const COMMIT_DETAILS_HEIGHT = 250;

/* Table columns, by cell index: graph, description, date, author, commit */

/**
 * The cells the user can resize, in the order their widths are stored in `columnWidths`: stored
 * width `k` belongs to cell `RESIZABLE_COLUMNS[k]`.
 */
export const RESIZABLE_COLUMNS: readonly number[] = Object.freeze([0, 2, 3, 4]);

/** The cell that is never given a width, and takes whatever the others leave. */
export const DESCRIPTION_COLUMN = 1;

/** Every cell of a row, in table order. */
export const ALL_COLUMNS: readonly number[] = Object.freeze([0, 1, 2, 3, 4]);

/**
 * The cells the user can hide, by the name a repository's record stores them under. The graph and
 * the description are left out: the graph is what the table is for, and the description takes
 * the room the others leave.
 */
export const OPTIONAL_COLUMNS: Readonly<Record<OptionalColumn, number>> = Object.freeze({
  date: 2,
  author: 3,
  commit: 4
});
