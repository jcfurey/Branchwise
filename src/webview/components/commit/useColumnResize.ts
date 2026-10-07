import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { DESCRIPTION_COLUMN, RESIZABLE_COLUMNS } from "@/webview/constants";
import { saveColumnWidths, setColumnWidths } from "@/webview/lib/actions";
import { columnWidths, repoStates, selectedRepo, shownColumns } from "@/webview/lib/stores";
import { MIN_COLUMN, moveBoundary } from "@/webview/utils/columns";

export type ColumnResize = {
  /** Element whose style holds the widths that the `<col>` elements read. */
  containerRef: RefObject<HTMLDivElement>;
  /** Header row, whose cells show the widths the browser laid out. */
  headRef: RefObject<HTMLTableRowElement>;
  /** Whether a boundary follows the pointer. */
  resizing: boolean;
  /** Let the boundary after column `boundary` follow the pointer until the button is released. */
  startResize: (boundary: number, event: MouseEvent) => void;
  /** Move the boundary after column `boundary` one step for an arrow key. */
  nudge: (boundary: number, event: KeyboardEvent) => void;
};

/** Custom properties that size the `<col>` elements, in the order of the stored widths. */
const WIDTH_PROPERTIES = ["--col-graph", "--col-date", "--col-author", "--col-commit"];

/** Pixels one arrow key press moves a boundary. */
const KEY_STEP = 8;
const KEY_MOVES = new Map([
  ["ArrowLeft", -KEY_STEP],
  ["ArrowRight", KEY_STEP]
]);

/** A boundary following the pointer. Only one follows it at a time. */
type Drag = {
  /** Repository that keeps the widths. Selecting another one cancels the drag. */
  repo: string;
  boundary: number;
  /** Where the boundary is: at the press, then wherever the moves took it. */
  x: number;
  /** Widths on screen when the drag began. */
  start: Array<number>;
  /** Widths the drag reached. Still `start` until a move changes a width. */
  widths: Array<number>;
  /** Stored widths the drag replaced so that the table stopped sizing itself. */
  replaced?: { previous: Array<number> | null; written: Array<number> };
  /** Stop listening to the window. */
  stop: () => void;
};

/**
 * Width stored for a hidden column when a resize stores the widths of a table that sized itself.
 * The browser never laid that column out, so this stands in: about as wide as the commit column.
 */
const UNMEASURED_WIDTH = 80;

/**
 * Width the browser gave the header cell of column `index`, padding included, or `undefined`
 * while that column is hidden. The header draws the shown columns only, in table order.
 */
function cellWidth(row: HTMLTableRowElement, index: number) {
  const at = shownColumns.peek().indexOf(index);
  if (at === -1) {
    return undefined;
  }
  const cell = row.cells.item(at);
  if (cell === null) {
    throw new Error(`The commit table header has no column ${index}`);
  }
  return cell.clientWidth;
}

/** Width of the description's header cell. The description is never hidden. */
function descriptionWidth(row: HTMLTableRowElement) {
  return cellWidth(row, DESCRIPTION_COLUMN) ?? 0;
}

/** Widths a resize starts from: the stored ones, else the laid-out ones, in usable whole pixels. */
function startingWidths(row: HTMLTableRowElement) {
  const widths =
    columnWidths.peek() ??
    RESIZABLE_COLUMNS.map((index) => cellWidth(row, index) ?? UNMEASURED_WIDTH);
  return widths.map((width) => Math.max(MIN_COLUMN, Math.round(width)));
}

function sameWidths(a: Array<number>, b: Array<number>) {
  return a.length === b.length && a.every((width, index) => width === b[index]);
}

/**
 * Move `boundary` by `delta`, rounded to a whole pixel. Null when no width changes, which
 * includes a column under its minimum that could only be fixed by moving against the request.
 */
function resized(widths: Array<number>, boundary: number, delta: number, description: number) {
  const request = Math.round(delta);
  const shown = shownColumns.peek();
  const { widths: next, moved } = moveBoundary(widths, boundary, request, description, shown);
  const whole = next.map((width) => Math.round(width));
  if (Math.sign(moved) !== Math.sign(request) || sameWidths(whole, widths)) {
    return null;
  }
  return { widths: whole, moved };
}

/** Size every column, or only suggest the graph width while the browser sizes the table. */
function showWidths(container: HTMLElement, widths: Array<number> | null, graphColumn: number) {
  const shown = widths?.map((width) => Math.max(MIN_COLUMN, width)) ?? [graphColumn];
  WIDTH_PROPERTIES.forEach((property, slot) => {
    const width = shown[slot];
    if (width === undefined) {
      container.style.removeProperty(property);
    } else {
      container.style.setProperty(property, `${width}px`);
    }
  });
}

/** Put back the stored widths a drag replaced, unless something else replaced them since. */
function restoreWidths({ repo, replaced }: Drag) {
  const state = repoStates.peek()[repo];
  if (replaced === undefined || state?.columnWidths !== replaced.written) {
    return;
  }
  repoStates.value = {
    ...repoStates.peek(),
    [repo]: { ...state, columnWidths: replaced.previous }
  };
}

/**
 * Resize the commit table columns by dragging or arrow keys on the boundaries between them. A
 * drag writes its widths straight to the container, so the rows do not render again while the
 * pointer moves, except once when a table that sized itself switches to fixed widths. The widths
 * are saved on release.
 */
export function useColumnResize(graphColumn: number): ColumnResize {
  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableRowElement>(null);
  const drag = useRef<Drag | null>(null);
  const latestGraphColumn = useRef(graphColumn);
  const [resizing, setResizing] = useState(false);
  // Read during render so that the table renders again when either changes.
  const repo = selectedRepo.value;
  const stored = columnWidths.value;

  /** A drag's widths win over the stored ones, so that a render in between cannot undo a move. */
  function apply() {
    const container = containerRef.current;
    const current = drag.current;
    if (container !== null) {
      const moved = current !== null && current.widths !== current.start;
      showWidths(
        container,
        moved ? current.widths : columnWidths.peek(),
        latestGraphColumn.current
      );
    }
  }

  function stopDrag(current: Drag) {
    current.stop();
    drag.current = null;
    setResizing(false);
  }

  /** End a drag and leave the widths as they were before it began. */
  function cancel(current: Drag) {
    stopDrag(current);
    restoreWidths(current);
    apply();
  }

  /** End a drag and save the widths it reached, if any changed. */
  function release(current: Drag) {
    if (selectedRepo.peek() !== current.repo || sameWidths(current.widths, current.start)) {
      cancel(current);
      return;
    }
    stopDrag(current);
    saveColumnWidths(current.widths);
  }

  function follow(current: Drag, event: MouseEvent) {
    if (selectedRepo.peek() !== current.repo) {
      cancel(current);
      return;
    }
    const row = headRef.current;
    if (row !== null) {
      const description = descriptionWidth(row);
      const next = resized(
        current.widths,
        current.boundary,
        event.clientX - current.x,
        description
      );
      if (next !== null) {
        current.x += next.moved;
        current.widths = next.widths;
        apply();
        // A table that sizes itself switches to these widths, which keeps the other columns in place.
        if (current.replaced === undefined && columnWidths.peek() === null) {
          const previous = repoStates.peek()[current.repo]?.columnWidths ?? null;
          current.replaced = { previous, written: next.widths };
          setColumnWidths(next.widths);
        }
      }
    }
    // The button went up where the webview could not see it, such as outside the panel.
    if ((event.buttons & 1) === 0) {
      release(current);
    }
  }

  function startResize(boundary: number, event: MouseEvent) {
    const row = headRef.current;
    const target = selectedRepo.peek();
    if (event.button !== 0 || drag.current !== null || row === null || target === undefined) {
      return;
    }
    event.preventDefault();
    const start = startingWidths(row);
    const onMove = (move: MouseEvent) => follow(current, move);
    const onEnd = () => release(current);
    const current: Drag = {
      repo: target,
      boundary,
      x: event.clientX,
      start,
      widths: start,
      stop: () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
        window.removeEventListener("blur", onEnd);
      }
    };
    // Listen now: a release can arrive before the next render.
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("blur", onEnd);
    drag.current = current;
    setResizing(true);
  }

  function nudge(boundary: number, event: KeyboardEvent) {
    const delta = KEY_MOVES.get(event.key);
    const row = headRef.current;
    if (
      delta === undefined ||
      row === null ||
      drag.current !== null ||
      selectedRepo.peek() === undefined
    ) {
      return;
    }
    event.preventDefault();
    const next = resized(startingWidths(row), boundary, delta, descriptionWidth(row));
    if (next !== null) {
      saveColumnWidths(next.widths);
    }
  }

  // Widths chosen for one repository never reach another.
  useLayoutEffect(() => {
    const current = drag.current;
    if (current !== null && current.repo !== repo) {
      cancel(current);
    }
  }, [repo]);

  // Before paint, and before the caller's layout effects measure the columns.
  useLayoutEffect(() => {
    latestGraphColumn.current = graphColumn;
    apply();
  }, [stored, graphColumn]);

  useEffect(
    () => () => {
      const current = drag.current;
      if (current !== null) {
        current.stop();
        drag.current = null;
        restoreWidths(current);
      }
    },
    []
  );

  return { containerRef, headRef, resizing, startResize, nudge };
}
