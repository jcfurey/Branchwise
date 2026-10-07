import type { OptionalColumn } from "@/types";
import { ALL_COLUMNS, OPTIONAL_COLUMNS, RESIZABLE_COLUMNS } from "@/webview/constants";

/** Narrowest, in pixels, a move may make a stored column: graph, date, author or commit. */
export const MIN_COLUMN = 40;

/** Narrowest, in pixels, a move may leave the description column. */
export const MIN_DESCRIPTION = 64;

/** A number that arithmetic can use: not `NaN`, not infinite, and not some other type. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Whether stored widths can size the table: one finite, positive number for each resizable
 * column. They come back from workspace state as JSON, so anything else is refused rather than
 * trusted, including values that are not arrays at all. Widths under the minimum are fine; the
 * table raises them when it shows them.
 */
export function isColumnWidths(widths: Array<number> | null): widths is Array<number> {
  return (
    Array.isArray(widths) &&
    widths.length === RESIZABLE_COLUMNS.length &&
    // Indexing every slot, rather than `widths.every`, so that a hole counts as a bad width.
    RESIZABLE_COLUMNS.every((_, slot) => {
      const width = widths[slot];
      return isFiniteNumber(width) && width > 0;
    })
  );
}

/** Whether `name` is a column the user can hide. Own keys only, so `"toString"` is not one. */
function isOptionalColumn(name: unknown): name is OptionalColumn {
  return typeof name === "string" && Object.hasOwn(OPTIONAL_COLUMNS, name);
}

/**
 * The hidden columns a repository's record names, in table order and each once. The record comes
 * back from workspace state as JSON, so anything but a list counts as none hidden, and entries
 * that name no column the user can hide are dropped.
 */
export function hiddenColumnsOf(stored: unknown): Array<OptionalColumn> {
  if (!Array.isArray(stored)) {
    return [];
  }
  const names = new Set<unknown>(stored);
  return (Object.keys(OPTIONAL_COLUMNS) as Array<OptionalColumn>).filter((name) => names.has(name));
}

/** The cells a row shows while the `hidden` columns are hidden, in table order. */
export function shownCells(hidden: ReadonlyArray<string>): Array<number> {
  const gone = new Set(hidden.filter(isOptionalColumn).map((name) => OPTIONAL_COLUMNS[name]));
  return ALL_COLUMNS.filter((cell) => !gone.has(cell));
}

/**
 * Move `boundary` in `widths`, a copy owned by the caller, and return how far it went. Nothing
 * moves, and 0 comes back, when the request cannot be followed at all.
 */
function shift(
  widths: Array<number>,
  boundary: number,
  delta: number,
  description: number,
  shown: ReadonlyArray<number>
) {
  // Boundary n is the right edge of header cell n, where it meets the next cell shown. The last
  // cell shown has no boundary to move, and neither has a hidden one.
  const at = shown.indexOf(boundary);
  const next = at === -1 ? undefined : shown[at + 1];
  if (widths.length !== RESIZABLE_COLUMNS.length || next === undefined || !isFiniteNumber(delta)) {
    return 0;
  }

  // A cell without a stored width is the description.
  const leftSlot = RESIZABLE_COLUMNS.indexOf(boundary);
  const rightSlot = RESIZABLE_COLUMNS.indexOf(next);
  const left = leftSlot === -1 ? description : widths[leftSlot];
  const right = rightSlot === -1 ? description : widths[rightSlot];
  if (!isFiniteNumber(left) || !isFiniteNumber(right)) {
    return 0;
  }

  // Going left narrows the left column and going right the right one, each down to its minimum.
  // A column already under its minimum pushes the boundary away until it is back there.
  const lowest = (leftSlot === -1 ? MIN_DESCRIPTION : MIN_COLUMN) - left;
  const highest = right - (rightSlot === -1 ? MIN_DESCRIPTION : MIN_COLUMN);
  if (lowest > highest) {
    return 0;
  }

  const clamped = Math.min(Math.max(delta, lowest), highest);
  // A request of -0 that fits is still no move, and reads as one.
  const moved = clamped === 0 ? 0 : clamped;
  if (leftSlot !== -1) {
    widths[leftSlot] = left + moved;
  }
  if (rightSlot !== -1) {
    widths[rightSlot] = right - moved;
  }
  return moved;
}

/**
 * Move the boundary on the right of header cell `boundary` by `delta` pixels, positive to the
 * right, taking width from the column on one side and giving it to the column on the other.
 * `widths` are the stored widths and `description` the measured width of the description
 * column, which has none stored. `shown` are the cells on screen, in table order: the column on
 * the right is the next of them, and the stored widths of hidden columns are left alone.
 *
 * The boundary goes as far as asked unless that takes a column under its minimum, where it
 * stops. If a column is already under its minimum, the boundary moves far enough to restore it,
 * even against the request. If no position suits both columns, or the boundary, the request or
 * a width beside the boundary is unusable, the boundary stays. `moved` is exactly what was added
 * to or taken from the widths, never -0. The given widths are left alone: a copy comes back.
 */
export function moveBoundary(
  widths: Array<number>,
  boundary: number,
  delta: number,
  description: number,
  shown: ReadonlyArray<number> = ALL_COLUMNS
): { widths: Array<number>; moved: number } {
  const next = [...widths];
  const moved = shift(next, boundary, delta, description, shown);
  return { widths: next, moved };
}
