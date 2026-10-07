import type { HistoryEntry } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";

/** What a mark on the overview strip stands for. */
export type MarkerKind = "head" | "selected" | "details" | "branch" | "tag" | "unpushed";

/**
 * Every kind, most important first. Where marks meet, the more important one is drawn over the
 * others, and a kind's place here is also its order in the strip's test attribute.
 */
export const MARKER_PRIORITY: readonly MarkerKind[] = Object.freeze([
  "head",
  "selected",
  "details",
  "branch",
  "tag",
  "unpushed"
]);

export type OverviewMarker = Readonly<{ row: number; kind: MarkerKind }>;

/** The rows that share one pixel row of the strip, as the kinds to draw there, most important first. */
export type StripMark = Readonly<{ y: number; kinds: readonly MarkerKind[] }>;

/** What the table knows about its rows, from which the marks are made. */
export type MarkerSources = Readonly<{
  commits: readonly HistoryEntry[];
  head: string | null;
  selected: ReadonlySet<string>;
  /** The commit whose details are open, or `null`. */
  details: string | null;
  unpushed: ReadonlySet<string>;
}>;

/**
 * The marks of every row, in row order. A row may carry several kinds; the uncommitted-changes
 * row carries only selection and open details, since no ref or push state belongs to it.
 */
export function collectMarkers({
  commits,
  head,
  selected,
  details,
  unpushed
}: MarkerSources): OverviewMarker[] {
  const markers: OverviewMarker[] = [];
  commits.forEach((commit, row) => {
    const hash = commit.hash;
    const add = (kind: MarkerKind) => markers.push({ row, kind });
    if (hash !== UNCOMMITTED_CHANGES && hash === head) {
      add("head");
    }
    if (selected.has(hash)) {
      add("selected");
    }
    if (hash === details) {
      add("details");
    }
    if (commit.refs.some((ref) => ref.type !== "tag")) {
      add("branch");
    }
    if (commit.refs.some((ref) => ref.type === "tag")) {
      add("tag");
    }
    if (unpushed.has(hash)) {
      add("unpushed");
    }
  });
  return markers;
}

/**
 * The pixel row of the strip that stands for `row` of `rows`, for a strip `height` pixels tall.
 * Rows share the height evenly, whatever opens between them, and each sits at its share's centre.
 */
export function rowToStrip(row: number, rows: number, height: number): number {
  if (rows <= 0 || height <= 0) {
    return 0;
  }
  return Math.min(height - 1, Math.max(0, Math.floor(((row + 0.5) / rows) * height)));
}

/**
 * The marks to draw on a strip `height` pixels tall: one per pixel row that has any, top to
 * bottom. Rows that land on the same pixel row merge, and a kind is listed there once.
 */
export function collapseMarkers(
  markers: readonly OverviewMarker[],
  rows: number,
  height: number
): StripMark[] {
  const byPixel = new Map<number, Set<MarkerKind>>();
  for (const { row, kind } of markers) {
    const y = rowToStrip(row, rows, height);
    let kinds = byPixel.get(y);
    if (kinds === undefined) {
      kinds = new Set();
      byPixel.set(y, kinds);
    }
    kinds.add(kind);
  }
  return [...byPixel]
    .toSorted(([a], [b]) => a - b)
    .map(([y, kinds]) => ({ y, kinds: MARKER_PRIORITY.filter((kind) => kinds.has(kind)) }));
}

/** The kinds present among `markers`, most important first. */
export function markerKinds(markers: readonly OverviewMarker[]): MarkerKind[] {
  const present = new Set(markers.map((marker) => marker.kind));
  return MARKER_PRIORITY.filter((kind) => present.has(kind));
}

/**
 * How the table's body is laid out: rows of one height, with the open details, if any, after
 * `expandedRow`.
 */
export type BodyGeometry = Readonly<{
  rows: number;
  rowHeight: number;
  /** The row whose details are open, or -1. */
  expandedRow: number;
  expansionHeight: number;
}>;

/** How far down the body the top of `row` is, in pixels. */
export function rowOffset(row: number, body: BodyGeometry): number {
  const below = body.expandedRow >= 0 && row > body.expandedRow;
  return row * body.rowHeight + (below ? body.expansionHeight : 0);
}

/**
 * The row, with its fraction, at `offset` pixels down the body. The open details count as part
 * of the row they belong to, so the visible band does not jump past them.
 */
export function rowAtOffset(offset: number, body: BodyGeometry): number {
  const { rows, rowHeight, expandedRow, expansionHeight } = body;
  let row: number;
  if (expandedRow < 0 || offset <= (expandedRow + 1) * rowHeight) {
    row = offset / rowHeight;
  } else if (offset < (expandedRow + 1) * rowHeight + expansionHeight) {
    row = expandedRow + 1;
  } else {
    row = (offset - expansionHeight) / rowHeight;
  }
  return Math.min(Math.max(row, 0), rows);
}

/**
 * The band of a strip `height` pixels tall that stands for the rows on screen, which are the
 * pixels `top` to `bottom` down the body.
 */
export function visibleBand(
  top: number,
  bottom: number,
  body: BodyGeometry,
  height: number
): { top: number; bottom: number } {
  if (body.rows <= 0) {
    return { top: 0, bottom: height };
  }
  const scale = height / body.rows;
  return {
    top: rowAtOffset(top, body) * scale,
    bottom: rowAtOffset(bottom, body) * scale
  };
}

/** The row that pixel row `y` of a strip `height` pixels tall stands for. */
export function stripToRow(y: number, height: number, rows: number): number {
  if (rows <= 0 || height <= 0) {
    return 0;
  }
  return Math.min(rows - 1, Math.max(0, Math.floor((y / height) * rows)));
}

/** Where the table is on the page, for turning a point on the strip into a scroll position. */
export type PageGeometry = Readonly<{
  /** The top of the table's body from the top of the document, in pixels. */
  bodyTop: number;
  /** The part of the window that shows rows: below the sticky headings, down to the bottom edge. */
  viewTop: number;
  viewBottom: number;
  /** The furthest the window can scroll. */
  maxScroll: number;
}>;

/**
 * The row that pixel row `y` of a strip `height` pixels tall stands for, and the window's scroll
 * position that centres that row between the sticky headings and the bottom of the window, kept
 * within what the page can scroll.
 */
export function scrollForStripPoint(
  y: number,
  height: number,
  body: BodyGeometry,
  page: PageGeometry
): { row: number; scrollTop: number } {
  const row = stripToRow(y, height, body.rows);
  const centre = page.bodyTop + rowOffset(row, body) + body.rowHeight / 2;
  const target = centre - (page.viewTop + page.viewBottom) / 2;
  return { row, scrollTop: Math.round(Math.min(Math.max(target, 0), Math.max(page.maxScroll, 0))) };
}
