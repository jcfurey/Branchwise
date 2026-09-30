import { describe, expect, it } from "vitest";

import { commitRelations, lineRelation } from "@/webview/graph/focus";
import { computeGraphLayout } from "@/webview/graph/layout";
import { branchStrokes } from "@/webview/graph/strokes";
import type { BranchRelation, GraphBranch, GraphExpansion, GraphLine } from "@/webview/graph/types";

import { commit, histories } from "./fixtures";

/**
 * A line in grid units, written "x1,y1 x2,y2", followed by "LF" when its bend
 * belongs by the upper end and by "U" when it is part of the uncommitted
 * changes. Its child and parent are the rows of its two ends.
 */
function gridLine(notation: string): GraphLine {
  const [upper = "", lower = "", ...flags] = notation.split(" ");
  const [x1 = 0, y1 = 0] = upper.split(",").map(Number);
  const [x2 = 0, y2 = 0] = lower.split(",").map(Number);
  return {
    child: y1,
    parent: y2,
    p1: { x: x1, y: y1 },
    p2: { x: x2, y: y2 },
    isCommitted: !flags.includes("U"),
    lockedFirst: flags.includes("LF")
  };
}

function lines(...notations: Array<string>): GraphBranch {
  return { colour: 0, lines: notations.map(gridLine) };
}

/** The path data alone, one entry per stroke. */
function pathsOf(
  branch: GraphBranch,
  angular: boolean,
  expansion: GraphExpansion | null = null,
  relationForLine?: (line: GraphLine) => BranchRelation
): Array<string> {
  return branchStrokes(branch, angular, expansion, relationForLine).map(({ path }) => path);
}

const panelUnder = (row: number, height = 250): GraphExpansion => ({ row, height });

/** Absolute M, L and C commands only: whole-pixel x, y to one decimal. */
const POINT = String.raw`-?\d+,-?\d+\.\d`;
const PATH_GRAMMAR = new RegExp(`^M${POINT}(?:[ML]${POINT}|C${POINT} ${POINT} ${POINT})*$`);

describe("single lines", () => {
  it.each([
    ["0,0 0,1", "M8,12.0L8,36.0", "M8,12.0L8,36.0"],
    ["0,0 1,1 LF", "M8,12.0C8,31.2 24,16.8 24,36.0", "M8,12.0L24,26.9L24,36.0"],
    ["0,0 1,1", "M8,12.0C8,31.2 24,16.8 24,36.0", "M8,12.0L8,21.1L24,36.0"],
    ["1,0 0,1", "M24,12.0C24,31.2 8,16.8 8,36.0", "M24,12.0L24,21.1L8,36.0"],
    ["1,0 0,1 LF", "M24,12.0C24,31.2 8,16.8 8,36.0", "M24,12.0L8,26.9L8,36.0"],
    ["0,3 2,4 LF", "M8,84.0C8,103.2 40,88.8 40,108.0", "M8,84.0L40,98.9L40,108.0"],
    ["2,5 0,6", "M40,132.0C40,151.2 8,136.8 8,156.0", "M40,132.0L40,141.1L8,156.0"]
  ])("draws %s as a curve or a cornered line", (notation, rounded, angular) => {
    expect(pathsOf(lines(notation), false)).toEqual([rounded]);
    expect(pathsOf(lines(notation), true)).toEqual([angular]);
  });

  it("returns exactly the four stroke fields, with a normal relation by default", () => {
    const strokes = branchStrokes(
      { colour: 7, lines: [gridLine("0,0 0,1"), gridLine("0,1 1,2 LF")] },
      false,
      null
    );
    expect(strokes).toEqual([
      {
        path: "M8,12.0L8,36.0C8,55.2 24,40.8 24,60.0",
        colour: 7,
        isCommitted: true,
        relation: "normal"
      }
    ]);
    expect(Object.keys(strokes[0]!).toSorted()).toEqual([
      "colour",
      "isCommitted",
      "path",
      "relation"
    ]);
  });

  it("copies any colour index unchanged", () => {
    const [stroke] = branchStrokes({ colour: -3, lines: [gridLine("0,0 0,1")] }, true, null);
    expect(stroke?.colour).toBe(-3);
  });

  it("writes rows far down the list as plain decimals", () => {
    expect(pathsOf(lines("0,99999 0,100000"), false)).toEqual(["M8,2399988.0L8,2400012.0"]);
  });

  it.each([false, true])("draws nothing for a branch without lines (angular=%s)", (angular) => {
    expect(branchStrokes({ colour: 3, lines: [] }, angular, null)).toEqual([]);
    expect(branchStrokes({ colour: 3, lines: [] }, angular, panelUnder(0))).toEqual([]);
  });
});

describe("straight runs and gaps", () => {
  it("draws consecutive lines down one lane as one segment, whatever their lockedFirst", () => {
    expect(pathsOf(lines("0,0 0,1", "0,1 0,2 LF", "0,2 0,3"), true)).toEqual(["M8,12.0L8,84.0"]);
    const tall = Array.from({ length: 10 }, (_, row) => `3,${row} 3,${row + 1}`);
    expect(pathsOf(lines(...tall), false)).toEqual(["M56,12.0L56,252.0"]);
  });

  it("joins the straight runs on both sides of a bend without moving the pen", () => {
    const branch = lines("0,0 0,1", "0,1 0,2", "0,2 1,3 LF", "1,3 1,4", "1,4 1,5");
    expect(pathsOf(branch, false)).toEqual(["M8,12.0L8,60.0C8,79.2 24,64.8 24,84.0L24,132.0"]);
    expect(pathsOf(branch, true)).toEqual(["M8,12.0L8,60.0L24,74.9L24,84.0L24,132.0"]);
  });

  it("moves the pen inside one stroke across a gap or to another lane", () => {
    expect(pathsOf(lines("0,0 0,1", "0,2 0,3"), false)).toEqual(["M8,12.0L8,36.0M8,60.0L8,84.0"]);
    expect(pathsOf(lines("0,0 0,1", "1,1 1,2"), false)).toEqual(["M8,12.0L8,36.0M24,36.0L24,60.0"]);
  });

  it("keeps a line that turns back up its own lane as two segments", () => {
    expect(pathsOf(lines("0,0 0,1", "0,1 0,0"), false)).toEqual(["M8,12.0L8,36.0L8,12.0"]);
  });
});

describe("splitting a branch into strokes", () => {
  const straight = ["0,0 0,1", "0,1 0,2", "0,2 0,3"];

  it("starts a new stroke at every change of relation, and not otherwise", () => {
    const strokes = branchStrokes(
      { colour: 5, lines: straight.map(gridLine) },
      false,
      null,
      (line) => (line.child === 1 ? "direct" : "unrelated")
    );
    expect(strokes).toEqual([
      { path: "M8,12.0L8,36.0", colour: 5, isCommitted: true, relation: "unrelated" },
      { path: "M8,36.0L8,60.0", colour: 5, isCommitted: true, relation: "direct" },
      { path: "M8,60.0L8,84.0", colour: 5, isCommitted: true, relation: "unrelated" }
    ]);
  });

  it("starts a new stroke at every change between committed and uncommitted", () => {
    const branch = lines(straight[0]!, `${straight[1]!} U`, straight[2]!);
    expect(branchStrokes(branch, false, null).map((s) => [s.path, s.isCommitted])).toEqual([
      ["M8,12.0L8,36.0", true],
      ["M8,36.0L8,60.0", false],
      ["M8,60.0L8,84.0", true]
    ]);
  });

  it("gives the uncommitted lines their own stroke and the rest the callback's relation", () => {
    const strokes = branchStrokes(lines("0,0 0,1 U", "0,1 0,2"), false, null, (line) =>
      line.child === 0 ? "normal" : "direct"
    );
    expect(strokes.map((s) => [s.path, s.isCommitted, s.relation])).toEqual([
      ["M8,12.0L8,36.0", false, "normal"],
      ["M8,36.0L8,60.0", true, "direct"]
    ]);
  });

  it("ends a bend's stroke at the commit where the next relation begins", () => {
    const bent = branchStrokes(lines("0,0 1,1 LF", "1,1 1,2"), true, null, (line) =>
      line.child === 0 ? "merged" : "direct"
    );
    expect(bent.map((s) => [s.path, s.relation])).toEqual([
      ["M8,12.0L24,26.9L24,36.0", "merged"],
      ["M24,36.0L24,60.0", "direct"]
    ]);
    const reused = branchStrokes(lines("0,0 0,1 LF", "0,1 0,2 LF"), true, null, (line) =>
      line.child === 0 ? "unrelated" : "direct"
    );
    expect(reused.map((s) => [s.path, s.relation])).toEqual([
      ["M8,12.0L8,36.0", "unrelated"],
      ["M8,36.0L8,60.0", "direct"]
    ]);
  });

  it("copies whatever relation the callback returns", () => {
    const odd = "sideways" as BranchRelation;
    const [stroke] = branchStrokes(lines("0,0 0,1"), false, null, () => odd);
    expect(stroke?.relation).toBe("sideways");
  });
});

/** Each branch of the history's layout, as its strokes' paths and committed state. */
function drawAll(
  commits: Parameters<typeof computeGraphLayout>[0],
  angular: boolean,
  expansion: GraphExpansion | null
) {
  return computeGraphLayout(commits, null).branches.map((branch) =>
    branchStrokes(branch, angular, expansion).map((s) => [s.path, s.isCommitted])
  );
}

describe("the uncommitted changes row", () => {
  it("draws the line down to HEAD as uncommitted and the rest as a stroke of its own", () => {
    const history = [commit("*", "c1"), commit("c1", "c2"), commit("c2", "c3"), commit("c3")];
    const layout = computeGraphLayout(history, null);
    expect(layout.branches).toHaveLength(1);
    expect(branchStrokes(layout.branches[0]!, false, null)).toEqual([
      { path: "M8,12.0L8,36.0", colour: 0, isCommitted: false, relation: "normal" },
      { path: "M8,36.0L8,84.0", colour: 0, isCommitted: true, relation: "normal" }
    ]);
    expect(drawAll(history, true, panelUnder(0))).toEqual([
      [
        ["M8,12.0L8,286.0", false],
        ["M8,286.0L8,334.0", true]
      ]
    ]);
  });

  it("keeps the uncommitted line past another branch tip to HEAD", () => {
    const history = [commit("*", "c2"), commit("c1", "c2"), commit("c2", "c3"), commit("c3")];
    expect(drawAll(history, false, null)).toEqual([
      [
        ["M8,12.0L8,60.0", false],
        ["M8,60.0L8,84.0", true]
      ],
      [["M24,36.0C24,55.2 8,40.8 8,60.0", true]]
    ]);
    expect(drawAll(history, false, panelUnder(0))).toEqual([
      [
        ["M8,12.0L8,310.0", false],
        ["M8,310.0L8,334.0", true]
      ],
      [["M24,286.0C24,305.2 8,290.8 8,310.0", true]]
    ]);
  });

  it("draws a branch that never reaches a commit as uncommitted throughout", () => {
    const history = [commit("*", "c3"), commit("c1", "c2"), commit("c2", "c3"), commit("c3")];
    expect(drawAll(history, false, null)).toEqual([
      [["M8,12.0L8,84.0", false]],
      [["M24,36.0L24,60.0C24,79.2 8,64.8 8,84.0", true]]
    ]);
    expect(drawAll(history, true, null)[1]).toEqual([["M24,36.0L24,60.0L24,69.1L8,84.0", true]]);
  });
});

describe("open commit details", () => {
  const straight = lines("0,0 0,1", "0,1 0,2", "0,2 0,3");

  it.each([
    [-1, "M8,262.0L8,334.0"],
    [0, "M8,12.0L8,334.0"],
    [1, "M8,12.0L8,334.0"],
    [2, "M8,12.0L8,334.0"],
    [3, "M8,12.0L8,84.0"],
    [5, "M8,12.0L8,84.0"],
    [9, "M8,12.0L8,84.0"],
    [99, "M8,12.0L8,84.0"]
  ])("moves only the rows after row %i, as the dots move", (row, path) => {
    expect(pathsOf(straight, false, panelUnder(row))).toEqual([path]);
    expect(pathsOf(straight, true, panelUnder(row))).toEqual([path]);
  });

  it.each([
    ["0,2 0,3", 0, "M8,310.0L8,334.0", "M8,310.0L8,334.0"],
    ["0,4 1,5 LF", 2, "M8,358.0C8,377.2 24,362.8 24,382.0", "M8,358.0L24,372.9L24,382.0"],
    [
      "0,0 1,1 LF",
      0,
      "M8,12.0C8,31.2 24,16.8 24,36.0L24,286.0",
      "M8,12.0L24,26.9L24,36.0L24,286.0"
    ],
    [
      "1,0 0,1",
      0,
      "M24,12.0L24,262.0C24,281.2 8,266.8 8,286.0",
      "M24,12.0L24,262.0L24,271.1L8,286.0"
    ]
  ])("draws %s with details under row %i", (notation, row, rounded, angular) => {
    expect(pathsOf(lines(notation), false, panelUnder(row))).toEqual([rounded]);
    expect(pathsOf(lines(notation), true, panelUnder(row))).toEqual([angular]);
  });

  // A bend that crosses the details stays one row high by the end lockedFirst names.
  const lockedCurve = "M8,12.0L8,36.0C8,55.2 24,40.8 24,60.0";
  const lateCurve = "M8,12.0L8,286.0C8,305.2 24,290.8 24,310.0";
  it.each([
    [" LF", 0, `${lateCurve}L24,334.0`, "M8,12.0L8,286.0L24,300.9L24,310.0L24,334.0"],
    [" LF", 1, `${lockedCurve}L24,334.0`, "M8,12.0L8,36.0L24,50.9L24,60.0L24,334.0"],
    [" LF", 2, `${lockedCurve}L24,334.0`, "M8,12.0L8,36.0L24,50.9L24,60.0L24,334.0"],
    [" LF", 3, `${lockedCurve}L24,84.0`, "M8,12.0L8,36.0L24,50.9L24,60.0L24,84.0"],
    ["", 0, `${lateCurve}L24,334.0`, "M8,12.0L8,286.0L8,295.1L24,310.0L24,334.0"],
    ["", 1, `${lateCurve}L24,334.0`, "M8,12.0L8,286.0L8,295.1L24,310.0L24,334.0"],
    ["", 2, `${lockedCurve}L24,334.0`, "M8,12.0L8,36.0L8,45.1L24,60.0L24,334.0"],
    ["", 3, `${lockedCurve}L24,84.0`, "M8,12.0L8,36.0L8,45.1L24,60.0L24,84.0"]
  ])(
    "places the bend of the lane change '0,1 1,2%s' with details under row %i",
    (flag, row, rounded, angular) => {
      const branch = lines("0,0 0,1", `0,1 1,2${flag}`, "1,2 1,3");
      expect(pathsOf(branch, false, panelUnder(row))).toEqual([rounded]);
      expect(pathsOf(branch, true, panelUnder(row))).toEqual([angular]);
    }
  );

  it("mirrors the bend placement for a line moving left", () => {
    const moving = (flag: string) => lines("1,0 1,1", `1,1 0,2${flag}`, "0,2 0,3");
    expect(pathsOf(moving(" LF"), false, panelUnder(1))).toEqual([
      "M24,12.0L24,36.0C24,55.2 8,40.8 8,60.0L8,334.0"
    ]);
    expect(pathsOf(moving(""), false, panelUnder(1))).toEqual([
      "M24,12.0L24,286.0C24,305.2 8,290.8 8,310.0L8,334.0"
    ]);
  });

  it("rounds a fractional details height to a tenth of a pixel", () => {
    expect(pathsOf(lines("0,0 1,1 LF"), false, panelUnder(0, 12.345))).toEqual([
      "M8,12.0C8,31.2 24,16.8 24,36.0L24,48.3"
    ]);
  });
});

describe("relations from the focused branch", () => {
  it("colours each edge of a focused history by its own relation", () => {
    const history = [
      commit("other", "base"),
      commit("merge", "main", "topic"),
      commit("topic", "base"),
      commit("main", "base"),
      commit("base")
    ];
    const layout = computeGraphLayout(history, "merge");
    const relations = commitRelations(history, {
      direct: ["merge", "main", "base"],
      merged: ["topic"]
    });
    const relationOf = (line: GraphLine) => lineRelation(line, history, relations);
    const draw = (angular: boolean, expansion: GraphExpansion | null) =>
      layout.branches.map((branch) =>
        branchStrokes(branch, angular, expansion, relationOf).map((s) => [s.relation, s.path])
      );

    expect(draw(false, null)).toEqual([
      [["unrelated", "M8,12.0L8,108.0"]],
      [["direct", "M24,36.0L24,84.0C24,103.2 8,88.8 8,108.0"]],
      [["merged", "M24,36.0C24,55.2 40,40.8 40,60.0L40,84.0C40,103.2 8,88.8 8,108.0"]]
    ]);
    expect(draw(false, panelUnder(2, 200))).toEqual([
      [["unrelated", "M8,12.0L8,308.0"]],
      [["direct", "M24,36.0L24,284.0C24,303.2 8,288.8 8,308.0"]],
      [["merged", "M24,36.0C24,55.2 40,40.8 40,60.0L40,284.0C40,303.2 8,288.8 8,308.0"]]
    ]);
    expect(draw(true, panelUnder(2, 200))).toEqual([
      [["unrelated", "M8,12.0L8,308.0"]],
      [["direct", "M24,36.0L24,284.0L24,293.1L8,308.0"]],
      [["merged", "M24,36.0L40,50.9L40,60.0L40,284.0L40,293.1L8,308.0"]]
    ]);
  });

  it("splits a merge line added to its parent's branch from that branch's own line", () => {
    const history = histories["merge into a parent another branch reached first"];
    const layout = computeGraphLayout(history, "tip");
    const relations = commitRelations(history, {
      direct: ["tip", "merge", "main", "base"],
      merged: ["side"]
    });
    const draw = (angular: boolean, expansion: GraphExpansion | null) =>
      layout.branches.map((branch) =>
        branchStrokes(branch, angular, expansion, (line) =>
          lineRelation(line, history, relations)
        ).map((s) => [s.relation, s.path])
      );

    expect(draw(false, null)).toEqual([
      [
        ["direct", "M8,12.0L8,108.0"],
        ["merged", "M8,36.0C8,55.2 40,40.8 40,60.0L40,84.0C40,103.2 8,88.8 8,108.0"]
      ],
      [["merged", "M8,12.0C8,31.2 24,16.8 24,36.0L24,84.0C24,103.2 8,88.8 8,108.0"]]
    ]);
    expect(draw(true, null)).toEqual([
      [
        ["direct", "M8,12.0L8,108.0"],
        ["merged", "M8,36.0L40,50.9L40,60.0L40,84.0L8,98.9L8,108.0"]
      ],
      [["merged", "M8,12.0L24,26.9L24,36.0L24,84.0L24,93.1L8,108.0"]]
    ]);
    // Beside details under row 3 the merge line runs down its parent's lane.
    expect(draw(false, panelUnder(3))).toEqual([
      [
        ["direct", "M8,12.0L8,358.0"],
        ["merged", "M8,36.0C8,55.2 40,40.8 40,60.0L40,84.0C40,103.2 8,88.8 8,108.0L8,358.0"]
      ],
      [["merged", "M8,12.0C8,31.2 24,16.8 24,36.0L24,334.0C24,353.2 8,338.8 8,358.0"]]
    ]);
    expect(draw(true, panelUnder(3))).toEqual([
      [
        ["direct", "M8,12.0L8,358.0"],
        ["merged", "M8,36.0L40,50.9L40,60.0L40,84.0L8,98.9L8,108.0L8,358.0"]
      ],
      [["merged", "M8,12.0L24,26.9L24,36.0L24,334.0L24,343.1L8,358.0"]]
    ]);
  });
});

describe("contract with the caller", () => {
  it("asks for each line's relation once, passing the layout's own line", () => {
    const branch = lines("0,0 0,1", "0,1 1,2 LF", "1,2 1,3");
    const asked: Array<GraphLine> = [];
    branchStrokes(branch, false, panelUnder(1), (line) => {
      asked.push(line);
      return "normal";
    });
    expect(asked).toHaveLength(3);
    asked.forEach((line, index) => expect(line).toBe(branch.lines[index]));
  });

  it("leaves its input alone and draws the same strokes every time", () => {
    const branch = { ...lines("0,0 1,1 LF", "1,1 1,2", "1,2 0,3"), colour: 1 };
    const expansion = panelUnder(0);
    const branchBefore = structuredClone(branch);
    const expansionBefore = structuredClone(expansion);
    const first = branchStrokes(branch, true, expansion, () => "merged");
    const second = branchStrokes(branch, true, expansion, () => "merged");
    expect(branch).toEqual(branchBefore);
    expect(expansion).toEqual(expansionBefore);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
  });

  // Decision on Q1: the time taken grows with the number of lines, not its square.
  it("draws a very long branch in linear time", () => {
    const rows = 50_000;
    const tall = Array.from({ length: rows }, (_, row) => gridLine(`0,${row} 0,${row + 1}`));
    let started = performance.now();
    expect(pathsOf({ colour: 0, lines: tall }, false)).toEqual(["M8,12.0L8,1200012.0"]);
    expect(performance.now() - started).toBeLessThan(1000);

    // Every line in a stroke of its own is the other extreme.
    started = performance.now();
    const strokes = branchStrokes({ colour: 0, lines: tall }, true, panelUnder(rows / 2), (line) =>
      line.child % 2 === 0 ? "direct" : "merged"
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(strokes).toHaveLength(rows);
  });
});

// Decision on Q2: a missing expansion means no details, as it does for the dots.
describe("an undefined expansion", () => {
  const missing = undefined as unknown as GraphExpansion | null;

  it.each(Object.entries(histories))("draws %s as if no details were open", (_name, history) => {
    for (const branch of computeGraphLayout(history, null).branches) {
      for (const angular of [false, true]) {
        expect(branchStrokes(branch, angular, missing)).toEqual(
          branchStrokes(branch, angular, null)
        );
      }
    }
  });
});

// Decision on Q5: a piece that starts and ends on the same pixel is not drawn.
describe("pieces of no length", () => {
  it.each([
    ["0,0 1,1 LF", "M8,12.0C8,31.2 24,16.8 24,36.0", "M8,12.0L24,26.9L24,36.0"],
    ["0,0 1,1", "M8,12.0C8,31.2 24,16.8 24,36.0", "M8,12.0L8,21.1L24,36.0"]
  ])("adds no straight stub to %s beside details of no height", (notation, rounded, angular) => {
    expect(pathsOf(lines(notation), false, panelUnder(0, 0))).toEqual([rounded]);
    expect(pathsOf(lines(notation), true, panelUnder(0, 0))).toEqual([angular]);
  });

  it.each(Object.entries(histories))(
    "draws %s beside details of no height exactly as without details",
    (_name, history) => {
      const { branches } = computeGraphLayout(history, null);
      for (const angular of [false, true]) {
        const plain = branches.map((branch) => branchStrokes(branch, angular, null));
        for (const row of [-1, ...history.keys()]) {
          const flat = branches.map((branch) => branchStrokes(branch, angular, panelUnder(row, 0)));
          expect(flat, `row ${row}`).toEqual(plain);
        }
      }
    }
  );

  it("draws nothing for a line that starts where it ends", () => {
    for (const angular of [false, true]) {
      expect(branchStrokes(lines("0,1 0,1"), angular, null)).toEqual([]);
      expect(branchStrokes(lines("2,1 2,1", "0,3 0,3"), angular, panelUnder(0))).toEqual([]);
    }
  });

  it("draws the lines around such a line as if it were not there", () => {
    const branch = lines("0,0 0,1", "0,1 0,1", "0,1 0,2");
    expect(pathsOf(branch, false)).toEqual(["M8,12.0L8,60.0"]);
    const point = branch.lines[1];
    expect(
      branchStrokes(branch, false, null, (line) => (line === point ? "direct" : "normal"))
    ).toEqual([{ path: "M8,12.0L8,60.0", colour: 0, isCommitted: true, relation: "normal" }]);
  });
});

// Decision on Q4: lines spanning several rows may be drawn any way that keeps the grammar.
describe("lines spanning several rows", () => {
  it.each(["0,0 1,3 LF", "0,0 1,3", "1,0 0,3 LF", "0,0 0,3"])(
    "draws %s across details as one continuous path",
    (notation) => {
      for (const angular of [false, true]) {
        for (const row of [0, 1, 2]) {
          const paths = pathsOf(lines(notation), angular, panelUnder(row));
          expect(paths).toHaveLength(1);
          expect(paths[0]).toMatch(PATH_GRAMMAR);
          expect(paths[0]!.match(/M/g)).toHaveLength(1);
          expect(paths[0]).toMatch(/,334\.0$/);
        }
      }
    }
  );

  it("draws them without details from end to end", () => {
    expect(pathsOf(lines("0,0 0,3"), false)).toEqual(["M8,12.0L8,84.0"]);
    expect(pathsOf(lines("0,0 1,3"), false)).toEqual(["M8,12.0C8,31.2 24,64.8 24,84.0"]);
    expect(pathsOf(lines("0,0 1,3 LF"), true)).toEqual(["M8,12.0L24,74.9L24,84.0"]);
  });
});
