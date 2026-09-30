import type { GitCommitNode } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { createBranchColours } from "@/webview/graph/branchColours";
import type { GraphBranch, GraphLayout, GraphPoint, GraphVertex } from "@/webview/graph/types";

/** Stands for "no row": a missing parent, or a commit that has no dot yet. */
const NONE = -1;

/** Shared by every commit without further parents. */
const NO_ROWS: ReadonlyArray<number> = [];

/**
 * Everything known while the graph is laid out. Branches, and the merge lines
 * drawn into them, are walked one at a time, each to its end, in the order in
 * which they start: by row, and within a row the commit's own branch first,
 * then one walk per further parent, in the commit's order. A walk made earlier
 * has first claim on the lanes of every row it crosses, so lanes are simply
 * counted out per row as the walks reach it.
 */
type Walk = {
  lastRow: number;
  /** The first parent of each row that is loaded and below it, or `NONE`. */
  firstParent: Int32Array;
  /** Every other such parent of each row, in the commit's order, each once. */
  otherParents: Array<ReadonlyArray<number>>;
  /** Lanes handed out so far in each row. */
  lanesTaken: Int32Array;
  /** Where each row's dot sits, once a branch has reached it. */
  dots: Array<GraphPoint | undefined>;
  /** The branch that gave each row its dot, as an index into `branches`, or `NONE`. */
  placedBy: Int32Array;
  /**
   * Index, in its branch's lines, of the line that brought the branch onto
   * each row's dot; `NONE` when the branch started at the dot.
   */
  arrival: Int32Array;
  /**
   * For each commit that merge lines lead into, the points those lines pass
   * through, by row. A later merge line into the same commit joins them.
   */
  mergePoints: Map<number, Map<number, GraphPoint>>;
  /** The row whose lines are drawn as uncommitted, or `NONE`. */
  uncommittedRow: number;
  colours: ReturnType<typeof createBranchColours>;
  branches: Array<GraphBranch>;
};

/**
 * Loaded parents of every row, as rows. A hash names its last row in the list.
 * Parents that are not loaded, or not below the commit, are left out, and so
 * is a repeat of a parent the commit already lists. When the first parent is
 * left out, the next loaded one takes its place.
 */
function parentRows(
  commits: ReadonlyArray<GitCommitNode>,
  rowOf: ReadonlyMap<string, number>
): Pick<Walk, "firstParent" | "otherParents"> {
  const firstParent = new Int32Array(commits.length).fill(NONE);
  const otherParents = Array.from({ length: commits.length }, () => NO_ROWS);
  for (const [row, commit] of commits.entries()) {
    let others: Array<number> | null = null;
    for (const hash of commit.parentHashes) {
      const parent = rowOf.get(hash) ?? NONE;
      if (parent <= row) {
        continue;
      }
      if (firstParent[row] === NONE) {
        firstParent[row] = parent;
      } else if (parent !== firstParent[row] && !others?.includes(parent)) {
        others ??= [];
        others.push(parent);
      }
    }
    if (others !== null) {
      otherParents[row] = others;
    }
  }
  return { firstParent, otherParents };
}

/** Only the lines of the uncommitted row's own edges are uncommitted. */
function addLine(
  walk: Walk,
  branch: GraphBranch,
  child: number,
  parent: number,
  from: GraphPoint,
  to: GraphPoint,
  lockedFirst: boolean
) {
  branch.lines.push({
    child,
    parent: parent === NONE ? null : parent,
    p1: from,
    p2: to,
    isCommitted: child !== walk.uncommittedRow,
    lockedFirst
  });
}

/** Hand out the lowest lane of a row that no earlier branch has taken. */
function takeLane(walk: Walk, row: number): number {
  const lane = walk.lanesTaken[row]!;
  walk.lanesTaken[row] = lane + 1;
  return lane;
}

/** Give a row's commit its dot, in the given lane, on the given branch. */
function place(walk: Walk, row: number, lane: number, branch: number, arrival: number): GraphPoint {
  const dot = { x: lane, y: row };
  walk.dots[row] = dot;
  walk.placedBy[row] = branch;
  walk.arrival[row] = arrival;
  return dot;
}

/**
 * Walk a branch down from `start`. A branch that begins at a commit nothing
 * points to places that commit first; one that leaves a merge for a parent not
 * yet placed begins at the merge's dot. On each row it reaches, the branch
 * either places the commit it is heading for, and then heads for that commit's
 * first parent, or passes through in the next free lane. It ends on a dot that
 * another branch placed, or on the last row. A commit without a loaded parent
 * trails a line to the last row, so that it does not look like the end of its
 * history.
 */
function walkBranch(walk: Walk, start: number, heading: number, isTip: boolean) {
  const colour = walk.colours.claim(start);
  const branch: GraphBranch = { colour, lines: [] };
  const index = walk.branches.push(branch) - 1;

  let from = isTip ? place(walk, start, takeLane(walk, start), index, NONE) : walk.dots[start]!;
  let child = start;
  let target = heading;
  let row = start;
  while (row < walk.lastRow) {
    row++;
    if (row === target && walk.placedBy[row] !== NONE) {
      const dot = walk.dots[row]!;
      addLine(walk, branch, child, target, from, dot, dot.x > from.x);
      break;
    }
    const lane = takeLane(walk, row);
    if (row === target) {
      const dot = place(walk, row, lane, index, branch.lines.length);
      addLine(walk, branch, child, target, from, dot, lane > from.x);
      from = dot;
      child = row;
      target = walk.firstParent[row]!;
    } else {
      const to = { x: lane, y: row };
      addLine(walk, branch, child, target, from, to, lane > from.x);
      from = to;
    }
  }
  walk.colours.release(colour, row);
}

/**
 * Where a merge line into `parent` can end on `row`: the parent's dot, the
 * line on which the parent's own branch arrives at it, or a point that an
 * earlier merge line into the parent passes through. A row never holds more
 * than one of these, since a merge line only takes a lane of its own where
 * there is none.
 */
function joinPoint(walk: Walk, parent: number, row: number): GraphPoint | undefined {
  if (row === parent) {
    return walk.dots[parent];
  }
  const arrival = walk.arrival[parent]!;
  if (arrival !== NONE) {
    // The arriving line has one piece per row below the commit it comes from.
    const lines = walk.branches[walk.placedBy[parent]!]!.lines;
    if (lines[arrival]!.child < row) {
      return lines[arrival - (parent - row)]!.p2;
    }
  }
  return walk.mergePoints.get(parent)?.get(row);
}

/**
 * Draw the edge from a merge to a parent that already has its dot. The lines
 * belong to the branch that placed the parent, and take its colour. They run
 * down in the next free lane of each row until they meet a point leading into
 * the parent, and bend into it at the top of their last line.
 */
function walkMerge(walk: Walk, child: number, parent: number) {
  const branch = walk.branches[walk.placedBy[parent]!]!;
  let from = walk.dots[child]!;
  for (let row = child + 1; row <= parent; row++) {
    const join = joinPoint(walk, parent, row);
    if (join !== undefined) {
      addLine(walk, branch, child, parent, from, join, true);
      return;
    }
    const to = { x: takeLane(walk, row), y: row };
    addLine(walk, branch, child, parent, from, to, to.x > from.x);
    let points = walk.mergePoints.get(parent);
    if (points === undefined) {
      points = new Map();
      walk.mergePoints.set(parent, points);
    }
    points.set(row, to);
    from = to;
  }
}

/**
 * Lay out the commit graph: a dot for every commit, in a lane of its row, and
 * the lines that join each commit to its parents in the list. Each branch of
 * the result follows first parents down from where it starts and has one
 * colour; a colour is used again once its branch has ended above the row
 * where a new branch starts. The edge to a merged parent that already has its
 * dot is drawn in the branch that placed it.
 *
 * `commits` are in display order. When the first row holds the uncommitted
 * changes, that row is the current one and the lines of its edge are drawn as
 * uncommitted; otherwise the row of `commitHead`, if loaded, is current.
 */
export function computeGraphLayout(
  commits: Array<GitCommitNode>,
  commitHead: string | null
): GraphLayout {
  const rows = commits.length;
  const rowOf = new Map<string, number>();
  for (const [row, commit] of commits.entries()) {
    rowOf.set(commit.hash, row);
  }
  const hasUncommitted = commits[0]?.hash === UNCOMMITTED_CHANGES;

  const walk: Walk = {
    lastRow: rows - 1,
    ...parentRows(commits, rowOf),
    lanesTaken: new Int32Array(rows),
    dots: Array.from({ length: rows }, () => undefined),
    placedBy: new Int32Array(rows).fill(NONE),
    arrival: new Int32Array(rows).fill(NONE),
    mergePoints: new Map(),
    uncommittedRow: hasUncommitted ? 0 : NONE,
    colours: createBranchColours(),
    branches: []
  };

  for (let row = 0; row < rows; row++) {
    if (walk.placedBy[row] === NONE) {
      walkBranch(walk, row, walk.firstParent[row]!, true);
    }
    for (const parent of walk.otherParents[row]!) {
      if (walk.placedBy[parent] === NONE) {
        walkBranch(walk, row, parent, false);
      } else {
        walkMerge(walk, row, parent);
      }
    }
  }

  let current = hasUncommitted ? 0 : NONE;
  if (!hasUncommitted && commitHead !== null) {
    current = rowOf.get(commitHead) ?? NONE;
  }
  const vertices = walk.dots.map((dot, row): GraphVertex => ({
    x: dot!.x,
    y: row,
    colour: walk.branches[walk.placedBy[row]!]!.colour,
    isCommitted: row !== walk.uncommittedRow,
    isCurrent: row === current
  }));

  let lanes = 0;
  for (const taken of walk.lanesTaken) {
    lanes = Math.max(lanes, taken);
  }
  return { branches: walk.branches, vertices, lanes };
}
