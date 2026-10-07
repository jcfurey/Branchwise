import { describe, expect, it, vi } from "vitest";

import type * as GraphConstants from "@/webview/graph/constants";
import { LANE_OFFSET } from "@/webview/graph/constants";
import { computeGraphLayout } from "@/webview/graph/layout";
import type { GraphExpansion, GraphLayout } from "@/webview/graph/types";
import { expandOffset, graphHeight, graphWidth, laneX, rowY } from "@/webview/graph/utils";

import { commit, histories } from "./fixtures";

function layoutOf(lanes: number, rows: number): GraphLayout {
  return {
    lanes,
    branches: [],
    vertices: Array.from({ length: rows }, (_, y) => ({
      x: 0,
      y,
      colour: 0,
      isCommitted: true,
      isCurrent: false,
      isMerge: false
    }))
  };
}

const details = (row: number, height = 250): GraphExpansion => ({ row, height });

describe("graph geometry", () => {
  it("places lanes and rows at fixed pixel positions", () => {
    expect([0, 1, 2, 3, 10].map(laneX)).toEqual([8, 24, 40, 56, 168]);
    expect([0, 1, 2, 5, 100].map((row) => rowY(row))).toEqual([12, 36, 60, 132, 2412]);
  });

  it("spaces rows by the row height it is given", () => {
    expect([0, 1, 2].map((row) => rowY(row, 20))).toEqual([10, 30, 50]);
    expect([0, 1, 2].map((row) => rowY(row, 30))).toEqual([15, 45, 75]);
    expect(graphHeight(layoutOf(1, 3), null, 20)).toBe(60);
    expect(graphHeight(layoutOf(1, 3), null, 30)).toBe(90);
    // The details keep their own height whatever the rows'.
    expect(graphHeight(layoutOf(1, 3), details(1), 20)).toBe(310);
  });

  it("sizes the width from the lanes, with the same margin on both sides", () => {
    expect([0, 1, 3, 10].map((lanes) => graphWidth(layoutOf(lanes, 5)))).toEqual([0, 16, 48, 160]);
    expect(graphWidth(layoutOf(3, 0))).toBe(48);
    for (const lanes of [1, 2, 3, 10]) {
      expect(graphWidth(layoutOf(lanes, 5))).toBe(laneX(lanes - 1) + LANE_OFFSET);
    }
  });

  it("keeps the right margin equal to the left one when the lane offset changes", async () => {
    vi.resetModules();
    vi.doMock("@/webview/graph/constants", async (importOriginal) => ({
      ...(await importOriginal<typeof GraphConstants>()),
      LANE_OFFSET: 12
    }));
    try {
      const moved = await import("@/webview/graph/utils");
      expect(moved.laneX(0)).toBe(12);
      expect([0, 1, 3].map((lanes) => moved.graphWidth(layoutOf(lanes, 2)))).toEqual([0, 24, 56]);
      expect(moved.graphWidth(layoutOf(3, 2)) - moved.laneX(2)).toBe(moved.laneX(0));
    } finally {
      vi.doUnmock("@/webview/graph/constants");
      vi.resetModules();
    }
  });

  it("sizes the height from the rows and the open details", () => {
    expect(graphHeight(layoutOf(0, 0), null)).toBe(0);
    expect(graphHeight(layoutOf(1, 3), null)).toBe(72);
    expect(graphHeight(layoutOf(7, 3), null)).toBe(72);
    expect(graphHeight(layoutOf(1, 3), null)).toBe(rowY(2) + 12);
    expect(graphHeight(layoutOf(1, 3), details(0))).toBe(322);
    expect(graphHeight(layoutOf(1, 3), details(1))).toBe(322);
    expect(graphHeight(layoutOf(1, 3), details(2))).toBe(322);
    expect(graphHeight(layoutOf(1, 3), details(1, 0))).toBe(72);
  });

  it("adds no height for details under a row outside the layout", () => {
    expect(graphHeight(layoutOf(1, 3), details(3))).toBe(72);
    expect(graphHeight(layoutOf(1, 3), details(99))).toBe(72);
    expect(graphHeight(layoutOf(1, 3), details(-1))).toBe(72);
    expect(graphHeight(layoutOf(0, 0), details(0))).toBe(0);
  });

  it("moves only the rows after the open details", () => {
    expect([0, 1, 5].map((row) => expandOffset(row, null))).toEqual([0, 0, 0]);
    expect([0, 1, 2, 3, 10].map((row) => expandOffset(row, details(2)))).toEqual([
      0, 0, 0, 250, 250
    ]);
    expect(expandOffset(3, details(2, 0))).toBe(0);
  });

  it("treats undefined details the same as no details", () => {
    // The type rules it out, but a caller that loses track must not crash the graph.
    const missing = undefined as unknown as GraphExpansion | null;
    expect(graphHeight(layoutOf(1, 3), missing)).toBe(graphHeight(layoutOf(1, 3), null));
    expect([0, 1, 5].map((row) => expandOffset(row, missing))).toEqual([0, 0, 0]);
  });
});

describe("layouts", () => {
  it("ends a merge on the dot of a parent another branch reached first", () => {
    const commits = histories["merge into a parent another branch reached first"];
    const layout = computeGraphLayout(commits, "tip");
    expect(layout.lanes).toBe(3);
    expect(layout.vertices.map((vertex) => vertex.x)).toEqual([0, 0, 1, 0, 0]);
    expect(layout.vertices.map((vertex) => vertex.colour)).toEqual([0, 0, 1, 0, 0]);

    const mergeLines = layout.branches.flatMap((branch) =>
      branch.lines
        .filter((line) => line.child === 1 && line.parent === 4)
        .map(({ p1, p2 }) => ({ colour: branch.colour, p1, p2 }))
    );
    expect(mergeLines).toStrictEqual([
      { colour: 0, p1: { x: 0, y: 1 }, p2: { x: 2, y: 2 } },
      { colour: 0, p1: { x: 2, y: 2 }, p2: { x: 2, y: 3 } },
      { colour: 0, p1: { x: 2, y: 3 }, p2: { x: 0, y: 4 } }
    ]);
  });

  it("keeps a commit in the colour of its first placement", () => {
    const layout = computeGraphLayout(
      [commit("m", "a", "b"), commit("a", "base"), commit("b", "base"), commit("base")],
      "m"
    );
    expect(layout.lanes).toBe(2);
    expect(layout.vertices.map((vertex) => [vertex.x, vertex.colour])).toEqual([
      [0, 0],
      [0, 0],
      [1, 1],
      [0, 0]
    ]);
  });
});
