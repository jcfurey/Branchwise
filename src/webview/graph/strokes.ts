import { ROW_HEIGHT } from "@/webview/constants";
import type {
  BranchRelation,
  GraphBranch,
  GraphExpansion,
  GraphLine,
  GraphStroke
} from "@/webview/graph/types";
import { expandOffset, laneX, rowY } from "@/webview/graph/utils";

/** How far the control points of a rounded bend reach from its ends, in pixels. */
const CURVE_REACH = 0.8 * ROW_HEIGHT;

/** Length of the straight stub beside the corner of an angular bend, in pixels. */
const CORNER_STUB = 0.38 * ROW_HEIGHT;

type Pixel = { x: number; y: number };
type Span = { from: Pixel; to: Pixel };

/**
 * A stretch of a line as it is drawn: straight down one lane, or a bend from
 * one lane to another. A line is one piece, or two when it crosses the open
 * commit details.
 */
type Piece = Span & { lockedFirst: boolean };

/**
 * A stroke still being written. Its latest straight piece is held back rather
 * than written, so that the next piece can extend it.
 */
type Pen = {
  isCommitted: boolean;
  relation: BranchRelation;
  commands: Array<string>;
  /** End of the latest piece; `null` before the first. */
  at: Pixel | null;
  straight: Span | null;
};

/**
 * Where a line is drawn, in pixels. Rows after the open details move down by
 * their height, by the same rule as the dots. A line that crosses the details
 * keeps its bend one row high, at the end `lockedFirst` names, and a straight
 * stretch in the other lane spans the rest of the gap.
 */
function piecesOf(line: GraphLine, expansion: GraphExpansion | null): Array<Piece> {
  const { p1, p2, lockedFirst } = line;
  const lowerShift = expandOffset(p2.y, expansion);
  // A line that ends above the details stays where it is, even if it starts below them.
  const upperShift = lowerShift === 0 ? 0 : expandOffset(p1.y, expansion);
  const start = { x: laneX(p1.x), y: rowY(p1.y) + upperShift };
  const end = { x: laneX(p2.x), y: rowY(p2.y) + lowerShift };

  const pieces: Array<Piece> =
    upperShift === lowerShift || start.x === end.x
      ? [{ from: start, to: end, lockedFirst }]
      : splitAround(start, end, lockedFirst);
  // Nothing is drawn for a piece that goes nowhere, such as beside details of no height.
  return pieces.filter(({ from, to }) => !samePixel(from, to));
}

/** The two pieces of a lane change across the details, top first. */
function splitAround(start: Pixel, end: Pixel, lockedFirst: boolean): Array<Piece> {
  const joint = lockedFirst
    ? { x: end.x, y: start.y + ROW_HEIGHT }
    : { x: start.x, y: end.y - ROW_HEIGHT };
  return [
    { from: start, to: joint, lockedFirst },
    { from: joint, to: end, lockedFirst }
  ];
}

function samePixel(a: Pixel, b: Pixel): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Path data coordinates: whole pixels across, tenths of a pixel down. */
function coords({ x, y }: Pixel): string {
  return `${x.toFixed(0)},${y.toFixed(1)}`;
}

/** The commands of a bend, from wherever the pen is to the end of the piece. */
function bendCommands({ from, to, lockedFirst }: Piece, angular: boolean): string {
  if (!angular) {
    const leave = { x: from.x, y: from.y + CURVE_REACH };
    const arrive = { x: to.x, y: to.y - CURVE_REACH };
    return `C${coords(leave)} ${coords(arrive)} ${coords(to)}`;
  }
  const corner = lockedFirst
    ? { x: to.x, y: to.y - CORNER_STUB }
    : { x: from.x, y: from.y + CORNER_STUB };
  return `L${coords(corner)}L${coords(to)}`;
}

/**
 * A straight piece carries on the one held back when it starts where that one
 * ends and heads the same way, so the two draw as one segment.
 */
function carriesOn(straight: Span, piece: Piece): boolean {
  return (
    samePixel(straight.to, piece.from) &&
    Math.sign(straight.to.y - straight.from.y) === Math.sign(piece.to.y - piece.from.y)
  );
}

function releaseStraight(pen: Pen) {
  if (pen.straight !== null) {
    pen.commands.push(`L${coords(pen.straight.to)}`);
    pen.straight = null;
  }
}

function draw(pen: Pen, piece: Piece, angular: boolean) {
  const straight = piece.from.x === piece.to.x;
  if (straight && pen.straight !== null && carriesOn(pen.straight, piece)) {
    pen.straight.to = piece.to;
    pen.at = piece.to;
    return;
  }
  releaseStraight(pen);
  if (pen.at === null || !samePixel(pen.at, piece.from)) {
    pen.commands.push(`M${coords(piece.from)}`);
  }
  if (straight) {
    pen.straight = { from: piece.from, to: piece.to };
  } else {
    pen.commands.push(bendCommands(piece, angular));
  }
  pen.at = piece.to;
}

function finish(pen: Pen, colour: number): GraphStroke {
  releaseStraight(pen);
  return {
    path: pen.commands.join(""),
    colour,
    isCommitted: pen.isCommitted,
    relation: pen.relation
  };
}

/**
 * The SVG paths that draw one branch of the layout. A branch is cut into a new
 * stroke only where its lines change between committed and uncommitted, or
 * change relation to the focused branch; within a stroke, straight lines along
 * one lane are drawn as a single segment. Without `relationForLine`, every
 * line is "normal". A missing `expansion` means no details are open.
 */
export function branchStrokes(
  branch: GraphBranch,
  angular: boolean,
  expansion: GraphExpansion | null,
  relationForLine?: (line: GraphLine) => BranchRelation
): Array<GraphStroke> {
  const details = expansion ?? null;
  const strokes: Array<GraphStroke> = [];
  let pen: Pen | null = null;

  for (const line of branch.lines) {
    const relation = relationForLine === undefined ? "normal" : relationForLine(line);
    for (const piece of piecesOf(line, details)) {
      if (pen === null || pen.isCommitted !== line.isCommitted || pen.relation !== relation) {
        if (pen !== null) {
          strokes.push(finish(pen, branch.colour));
        }
        pen = { isCommitted: line.isCommitted, relation, commands: [], at: null, straight: null };
      }
      draw(pen, piece, angular);
    }
  }

  if (pen !== null) {
    strokes.push(finish(pen, branch.colour));
  }
  return strokes;
}
