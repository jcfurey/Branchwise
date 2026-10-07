import type { ReadonlySignal } from "@preact/signals";
import { Fragment } from "preact";
import { useMemo } from "preact/hooks";

import { VERTEX_RADIUS } from "@/webview/graph/constants";
import { focusColour } from "@/webview/graph/focus";
import { branchColour, UNCOMMITTED_COLOUR } from "@/webview/graph/palette";
import { branchStrokes } from "@/webview/graph/strokes";
import type {
  BranchRelation,
  GraphExpansion,
  GraphLayout,
  GraphLine,
  GraphVertex
} from "@/webview/graph/types";
import { expandOffset, graphHeight, graphWidth, laneX, rowY } from "@/webview/graph/utils";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import type { FocusDimming } from "@/webview/types";

type CommitGraphProps = {
  layout: GraphLayout;
  /** The open details, which push the rows after theirs down. */
  expansion: GraphExpansion | null;
  /** Each row's relation to the focused branch, by row index. */
  relations: Array<BranchRelation>;
  relationForLine: (line: GraphLine) => BranchRelation;
  keepMergedBright: boolean;
  dimming: FocusDimming;
  /** Rows whose dot keeps its full colour whatever their relation. */
  revealed: ReadonlySet<number>;
  /** Hash of the row under the pointer. Only this component reads it. */
  hovered: ReadonlySignal<string | null>;
  commitRows: ReadonlyMap<string, number>;
  /** The height of the table's rows, which the dots and lines are spaced by. */
  rowHeight: number;
};

/**
 * How a dot is drawn, so that its shape and not only its colour tells commits apart: HEAD is a
 * ring, the uncommitted changes a dashed ring, a merge a wider ring around a small dot, and any
 * other commit a filled dot. The kind is also written on the dot as `data-dot`.
 */
type DotKind = "commit" | "head" | "uncommitted" | "merge";

function dotKind(vertex: GraphVertex): DotKind {
  if (!vertex.isCommitted) {
    return "uncommitted";
  }
  if (vertex.isCurrent) {
    return "head";
  }
  return vertex.isMerge ? "merge" : "commit";
}

/** A merge's ring: one pixel wider than a dot, and still well inside a row. */
const MERGE_RADIUS = VERTEX_RADIUS + 1;

/** The radius of the dot in the middle of a merge's ring. */
const MERGE_CENTRE = 2;

/** Twelve equal dashes and gaps round the uncommitted ring. */
const UNCOMMITTED_DASHES = String((2 * Math.PI * VERTEX_RADIUS) / 12);

/**
 * The lanes and dots drawn behind the commit table's first column. Lines come first so that the
 * dots paint over them, and the dots follow in row order.
 */
export function CommitGraph({
  layout,
  expansion,
  relations,
  relationForLine,
  keepMergedBright,
  dimming,
  revealed,
  hovered,
  commitRows,
  rowHeight
}: CommitGraphProps) {
  const angular = getWebviewConfig().graphStyle === "angular";
  // Building the paths walks every line of the layout, so a hover or a colour change reuses them.
  const strokes = useMemo(
    () =>
      layout.branches.flatMap((branch) =>
        branchStrokes(branch, angular, expansion, relationForLine, rowHeight)
      ),
    [layout, angular, expansion, relationForLine, rowHeight]
  );

  const hoveredHash = hovered.value;
  const hoveredRow = hoveredHash === null ? undefined : commitRows.get(hoveredHash);
  const paint = (colour: number, relation: BranchRelation) =>
    focusColour(branchColour(colour), relation, keepMergedBright, dimming);

  /** The colour of a dot. A dot the user is looking at is drawn as if nothing were focused. */
  const dotColour = (vertex: GraphVertex, relation: BranchRelation) => {
    if (!vertex.isCommitted) {
      return UNCOMMITTED_COLOUR;
    }
    const plain = vertex.isCurrent || vertex.y === hoveredRow || revealed.has(vertex.y);
    return paint(vertex.colour, plain ? "normal" : relation);
  };

  return (
    <svg
      class="block"
      width={graphWidth(layout)}
      height={graphHeight(layout, expansion, rowHeight)}
      aria-hidden="true"
    >
      {strokes.map((stroke, index) => (
        <g key={index}>
          {/* A band of background under each line keeps crossing lines and dots apart. */}
          <path d={stroke.path} fill="none" stroke-width="4" class="stroke-editor/75" />
          <path
            d={stroke.path}
            fill="none"
            stroke-width="2"
            data-branch-relation={stroke.relation}
            stroke={stroke.isCommitted ? paint(stroke.colour, stroke.relation) : UNCOMMITTED_COLOUR}
          />
        </g>
      ))}
      {layout.vertices.map((vertex) => {
        const relation = relations[vertex.y] ?? "normal";
        const colour = dotColour(vertex, relation);
        const cx = laneX(vertex.x);
        const cy = rowY(vertex.y, rowHeight) + expandOffset(vertex.y, expansion);
        const kind = dotKind(vertex);
        // Each row has exactly one circle, which carries the dot's place and relation.
        switch (kind) {
          case "head":
          case "uncommitted":
            return (
              <circle
                key={vertex.y}
                cx={cx}
                cy={cy}
                r={VERTEX_RADIUS}
                data-dot={kind}
                data-branch-relation={relation}
                stroke={colour}
                stroke-width="2"
                stroke-dasharray={kind === "uncommitted" ? UNCOMMITTED_DASHES : undefined}
                class="fill-editor"
              />
            );
          case "merge":
            return (
              <Fragment key={vertex.y}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={MERGE_RADIUS}
                  data-dot={kind}
                  data-branch-relation={relation}
                  stroke={colour}
                  stroke-width="1.5"
                  class="fill-editor"
                />
                {/* A rect with fully rounded corners, so the row still has one circle. */}
                <rect
                  x={cx - MERGE_CENTRE}
                  y={cy - MERGE_CENTRE}
                  width={MERGE_CENTRE * 2}
                  height={MERGE_CENTRE * 2}
                  rx={MERGE_CENTRE}
                  fill={colour}
                />
              </Fragment>
            );
          default:
            return (
              <circle
                key={vertex.y}
                cx={cx}
                cy={cy}
                r={VERTEX_RADIUS}
                data-dot={kind}
                data-branch-relation={relation}
                fill={colour}
                stroke-width="1"
                class="stroke-editor/75"
              />
            );
        }
      })}
    </svg>
  );
}
