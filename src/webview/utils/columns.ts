import { RESIZABLE_COLUMNS } from "@/webview/constants";

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

/**
 * Move `boundary` in `widths`, a copy owned by the caller, and return how far it went. Nothing
 * moves, and 0 comes back, when the request cannot be followed at all.
 */
function shift(widths: Array<number>, boundary: number, delta: number, description: number) {
  // The table has one column more than it stores widths for, so as many boundaries as widths.
  const boundaries = RESIZABLE_COLUMNS.length;
  if (
    widths.length !== RESIZABLE_COLUMNS.length ||
    !Number.isInteger(boundary) ||
    boundary < 0 ||
    boundary >= boundaries ||
    !isFiniteNumber(delta)
  ) {
    return 0;
  }

  // Boundary n is the right edge of header cell n. A cell without a stored width is the description.
  const leftSlot = RESIZABLE_COLUMNS.indexOf(boundary);
  const rightSlot = RESIZABLE_COLUMNS.indexOf(boundary + 1);
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
 * column, which has none stored.
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
  description: number
): { widths: Array<number>; moved: number } {
  const next = [...widths];
  const moved = shift(next, boundary, delta, description);
  return { widths: next, moved };
}
