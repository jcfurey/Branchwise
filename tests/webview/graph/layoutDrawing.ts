import type { GitCommitNode } from "@/backend/types";
import type {
  GraphBranch,
  GraphLayout,
  GraphLine,
  GraphPoint,
  GraphVertex
} from "@/webview/graph/types";

/**
 * Commits from one string per row, top row first: the hash, then its parents
 * in order, separated by spaces. `history("m a b", "a", "b")` is a merge of
 * two roots.
 */
export function history(...rows: Array<string>): Array<GitCommitNode> {
  return rows.map((row) => {
    const [hash = "", ...parentHashes] = row.split(" ");
    return {
      hash,
      parentHashes,
      author: "Layout Tester",
      email: "layout@example.test",
      date: 1_700_000_000,
      message: `row ${hash}`,
      refs: []
    };
  });
}

/** A point written `"x,y"`. */
function pointOf(notation: string): GraphPoint {
  const [x = "", y = ""] = notation.split(",");
  return { x: Number(x), y: Number(y) };
}

/**
 * A line in the notation of the layout specification, with plain `>` for the
 * arrows: `"child>parent x1,y1>x2,y2"`, then `early` when `lockedFirst` is set
 * and `uncommitted` when `isCommitted` is not. The parent is `none` for a
 * line that runs on below a commit without a loaded parent.
 */
export function line(notation: string): GraphLine {
  const [edge = "", ends = "", ...flags] = notation.split(" ");
  const [child = "", parent = ""] = edge.split(">");
  const [upper = "", lower = ""] = ends.split(">");
  const unknown = flags.filter((flag) => flag !== "early" && flag !== "uncommitted");
  if (unknown.length > 0 || upper === "" || lower === "") {
    throw new Error(`Cannot read line "${notation}"`);
  }
  return {
    child: Number(child),
    parent: parent === "none" ? null : Number(parent),
    p1: pointOf(upper),
    p2: pointOf(lower),
    isCommitted: !flags.includes("uncommitted"),
    lockedFirst: flags.includes("early")
  };
}

/** A dot written `"lane/colour"`, then `current` and `uncommitted` when set. */
export function dot(notation: string, row: number): GraphVertex {
  const [position = "", ...flags] = notation.split(" ");
  const [lane = "", colour = ""] = position.split("/");
  return {
    x: Number(lane),
    y: row,
    colour: Number(colour),
    isCommitted: !flags.includes("uncommitted"),
    isCurrent: flags.includes("current")
  };
}

/** One track: its colour, then its lines in order. */
export type TrackDrawing = [colour: number, ...lines: Array<string>];

export type LayoutDrawing = {
  lanes: number;
  /** One dot per row, in row order. */
  dots: Array<string>;
  tracks: Array<TrackDrawing>;
};

/** The full layout a drawing describes, to compare with `toStrictEqual`. */
export function layoutOf({ lanes, dots, tracks }: LayoutDrawing): GraphLayout {
  const branches = tracks.map(([colour, ...lines]): GraphBranch => ({
    colour,
    lines: lines.map(line)
  }));
  return { branches, vertices: dots.map(dot), lanes };
}

/** Every line of a layout, track by track. */
export function allLines(layout: GraphLayout): Array<GraphLine> {
  return layout.branches.flatMap((branch) => branch.lines);
}

/** A line back in the notation of `line`, for readable failures. */
export function notationOf(drawn: GraphLine): string {
  const flags = [drawn.lockedFirst ? " early" : "", drawn.isCommitted ? "" : " uncommitted"];
  const parent = drawn.parent ?? "none";
  const ends = `${drawn.p1.x},${drawn.p1.y}>${drawn.p2.x},${drawn.p2.y}`;
  return `${drawn.child}>${parent} ${ends}${flags.join("")}`;
}
