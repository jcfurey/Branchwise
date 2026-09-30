import type { ReadonlySignal } from "@preact/signals";
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
};

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
  commitRows
}: CommitGraphProps) {
  const angular = getWebviewConfig().graphStyle === "angular";
  // Building the paths walks every line of the layout, so a hover or a colour change reuses them.
  const strokes = useMemo(
    () =>
      layout.branches.flatMap((branch) =>
        branchStrokes(branch, angular, expansion, relationForLine)
      ),
    [layout, angular, expansion, relationForLine]
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
      height={graphHeight(layout, expansion)}
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
        const centre = {
          cx: laneX(vertex.x),
          cy: rowY(vertex.y) + expandOffset(vertex.y, expansion),
          r: VERTEX_RADIUS
        };
        // HEAD is an open ring; every other commit a filled dot.
        return vertex.isCurrent ? (
          <circle
            key={vertex.y}
            {...centre}
            data-branch-relation={relation}
            stroke={colour}
            stroke-width="2"
            class="fill-editor"
          />
        ) : (
          <circle
            key={vertex.y}
            {...centre}
            data-branch-relation={relation}
            fill={colour}
            stroke-width="1"
            class="stroke-editor/75"
          />
        );
      })}
    </svg>
  );
}
