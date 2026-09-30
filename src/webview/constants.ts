/* Values that mean "not a real branch or commit" */

/** The branch choice that shows every branch, with nothing filtered or emphasised. */
export const SHOW_ALL_BRANCHES = "*";

/** The `hash` of the row standing for the working tree's changes, listed above every commit. */
export const UNCOMMITTED_CHANGES = "*";

/* Table geometry, in CSS pixels */

/**
 * The height of every commit row, and so the graph's row pitch: row `y` is centred at
 * `(y + 0.5) * ROW_HEIGHT`. Rendered rows must be exactly this tall, or the dots drift off them.
 */
export const ROW_HEIGHT = 24;

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
