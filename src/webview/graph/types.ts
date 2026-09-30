// The graph's drawing, as the layout builds it and the strokes and components read it. Unless a
// field says otherwise, positions are grid cells: `x` counts lanes from the left and `y` counts
// rows from the top, both from 0, and a row's `y` is its commit's index in the displayed list.
// Every `colour` is an index into the configured palette, not a CSS colour.

/** Lane `x` of row `y`. */
export type GraphPoint = { x: number; y: number };

/**
 * How a commit or line stands to the emphasised branch: `"normal"` when nothing is emphasised,
 * `"direct"` on the branch's first-parent line, `"merged"` for an ancestor reached through a
 * merge, and `"unrelated"` for anything else. The same strings mark rows, dots and lines in the
 * DOM (`data-branch-relation`), where the stylesheet and the UI tests select them.
 */
export type BranchRelation = "normal" | "direct" | "merged" | "unrelated";

/** One row's worth of an edge between a commit and its parent. */
export type GraphLine = {
  /** Row of the commit the edge leaves, the same for each segment of the edge. */
  child: number;
  /** Row of the parent the edge reaches, or `null` when that parent is not loaded. */
  parent: number | null;
  /** The upper end. */
  p1: GraphPoint;
  /** The lower end, one row below `p1`. */
  p2: GraphPoint;
  /** `false` only on the edge from the uncommitted-changes row. */
  isCommitted: boolean;
  /**
   * Where a change of lane happens: `true` at the upper end, so the segment then runs in `p2`'s
   * lane; `false` at the lower end, after running in `p1`'s lane.
   */
  lockedFirst: boolean;
};

/**
 * One continuous track: its lines as the track was walked from the top, then the lines of the
 * merge edges attached to it.
 */
export type GraphBranch = { colour: number; lines: Array<GraphLine> };

/** A commit's dot. */
export type GraphVertex = {
  x: number;
  /** Always the vertex's own index in `GraphLayout.vertices`. */
  y: number;
  /** The colour of the track that placed the dot. */
  colour: number;
  /** `false` only for the uncommitted-changes row. */
  isCommitted: boolean;
  /** The checked-out commit, or the uncommitted row when shown. Drawn hollow. */
  isCurrent: boolean;
};

/**
 * The whole drawing: one vertex per displayed commit, in row order, and the most lanes any row
 * uses (0 when there are no commits).
 */
export type GraphLayout = {
  branches: Array<GraphBranch>;
  vertices: Array<GraphVertex>;
  lanes: number;
};

/**
 * Commit details open beneath `row`, `height` CSS pixels tall, pushing later rows down by that
 * much. Callers write `null` when nothing is open.
 */
export type GraphExpansion = { row: number; height: number };

/**
 * What one `path` element draws. `path` is SVG path data in CSS pixels of the drawing; every line
 * in it shares `relation`, `colour` and `isCommitted`.
 */
export type GraphStroke = {
  relation: BranchRelation;
  path: string;
  colour: number;
  isCommitted: boolean;
};
