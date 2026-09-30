import { describe, expect, it } from "vitest";

import { computeGraphLayout } from "@/webview/graph/layout";
import { branchStrokes } from "@/webview/graph/strokes";
import type { GraphBranch, GraphExpansion } from "@/webview/graph/types";
import { expandOffset, graphHeight, graphWidth, laneX, rowY } from "@/webview/graph/utils";

import { histories } from "./fixtures";

/** SVG path endpoints, independently of whether a segment is straight or cubic. */
function segments(path: string) {
  return [...path.matchAll(/([MLC])([^MLC]+)/g)].map((match) => {
    const values = match[2]!.trim().split(/[ ,]+/).map(Number);
    return { command: match[1], values, end: values.slice(-2) };
  });
}

describe.each([false, true])("graph strokes (angular=%s)", (angular) => {
  it.each(Object.entries(histories))(
    "keeps %s connected with expanded details",
    (_name, commits) => {
      const layout = computeGraphLayout(commits, null);
      const before = structuredClone(layout);
      for (const expansion of [null, ...commits.map((_, row) => ({ row, height: 250 }))]) {
        const drawn: { from: number[]; to: number[]; command: string | undefined }[] = [];
        const starts = new Set<string>();
        for (const branch of layout.branches) {
          for (const stroke of branchStrokes(branch, angular, expansion)) {
            let cursor: number[] = [];
            for (const segment of segments(stroke.path)) {
              expect(segment.values.every(Number.isFinite)).toBe(true);
              for (let i = 0; i < segment.values.length; i += 2) {
                expect(segment.values[i]).toBeGreaterThanOrEqual(0);
                expect(segment.values[i]).toBeLessThanOrEqual(graphWidth(layout));
                expect(segment.values[i + 1]).toBeGreaterThanOrEqual(0);
                expect(segment.values[i + 1]).toBeLessThanOrEqual(graphHeight(layout, expansion));
              }
              if (segment.command === "M") {
                starts.add(segment.end.join(","));
              } else {
                drawn.push({ from: cursor, to: segment.end, command: segment.command });
              }
              cursor = segment.end;
            }
          }
        }
        // A combined vertical segment can pass through a commit without ending there.
        const contains = (point: string) => {
          const [x, y] = point.split(",").map(Number);
          return drawn.some(
            ({ from, to, command }) =>
              to.join(",") === point ||
              (command === "L" && from[0] === x && to[0] === x && from[1]! < y! && y! < to[1]!)
          );
        };
        const nodePoints = new Set(
          layout.vertices.map(
            (vertex) => `${laneX(vertex.x)},${rowY(vertex.y) + expandOffset(vertex.y, expansion)}`
          )
        );
        for (const start of starts) {
          expect(nodePoints.has(start) || contains(start), `Disconnected path at ${start}`).toBe(
            true
          );
        }
        for (const [row, commit] of commits.entries()) {
          if (commits.some((child) => child.parentHashes.includes(commit.hash))) {
            const node = layout.vertices[row]!;
            expect(
              contains(`${laneX(node.x)},${rowY(row) + expandOffset(row, expansion)}`),
              `Missing stroke into ${commit.hash}`
            ).toBe(true);
          }
        }
      }
      expect(layout).toEqual(before);
    }
  );

  it.each([true, false])(
    "keeps lane-change corners outside details (lockedFirst=%s)",
    (lockedFirst) => {
      const branch: GraphBranch = {
        colour: 2,
        lines: [
          {
            child: 0,
            parent: 1,
            p1: { x: lockedFirst ? 0 : 1, y: 0 },
            p2: { x: lockedFirst ? 1 : 0, y: 1 },
            isCommitted: true,
            lockedFirst
          }
        ]
      };
      const expansion: GraphExpansion = { row: 0, height: 250 };
      const strokes = branchStrokes(branch, angular, expansion);
      const parts = segments(strokes[0]!.path);
      expect(parts[0]!.end).toEqual([lockedFirst ? 8 : 24, 12]);
      expect(parts.at(-1)!.end).toEqual([lockedFirst ? 24 : 8, 286]);
      let previous = parts[0]!.end;
      let diagonals = 0;
      for (const part of parts.slice(1)) {
        if (part.command !== "M" && previous[0] !== part.end[0]) {
          diagonals++;
          expect(Math.abs(part.end[1]! - previous[1]!)).toBeLessThanOrEqual(24);
        }
        previous = part.end;
      }
      expect(diagonals).toBe(1);
      // Curves retain one row of height; the details gap is covered by a vertical line.
      for (const curve of parts.filter((part) => part.command === "C")) {
        const ys = curve.values.filter((_, index) => index % 2 === 1);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(24);
      }
    }
  );
});
