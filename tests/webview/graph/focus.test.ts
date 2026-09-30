import { describe, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import { commitRelations, focusColour, lineRelation } from "@/webview/graph/focus";
import { computeGraphLayout } from "@/webview/graph/layout";
import { branchStrokes } from "@/webview/graph/strokes";

const commit = (hash: string, parentHashes: string[]): GitCommitNode => ({
  hash,
  parentHashes,
  author: "Author",
  email: "",
  date: 0,
  message: hash,
  refs: []
});
// The unrelated lane joins a shared ancestor; the merge's second parent also ends there.
const commits = [
  commit("other", ["base"]),
  commit("merge", ["main", "topic"]),
  commit("topic", ["base"]),
  commit("main", ["base"]),
  commit("base", [])
];
const focus = { direct: ["merge", "main", "base"], merged: ["topic"] };

describe("branch focus graph", () => {
  it("classifies commits without assigning membership by lane colour", () => {
    expect(commitRelations(commits, focus)).toEqual([
      "unrelated",
      "direct",
      "merged",
      "direct",
      "direct"
    ]);
    expect(commitRelations(commits, null)).toEqual(commits.map(() => "normal"));
    expect(commitRelations([commit("*", ["merge"])], focus)).toEqual(["normal"]);
  });

  it("keeps incoming unrelated edges gray and merge connectors muted at a shared ancestor", () => {
    const layout = computeGraphLayout(commits, "merge");
    const relations = commitRelations(commits, focus);
    const lines = layout.branches.flatMap((branch) => branch.lines);
    for (const line of lines) {
      const child = commits[line.child]!.hash;
      const parent = line.parent === null ? null : commits[line.parent]!.hash;
      if (child === "other") {
        expect(lineRelation(line, commits, relations)).toBe("unrelated");
      }
      if (child === "topic" || (child === "merge" && parent === "topic")) {
        expect(lineRelation(line, commits, relations)).toBe("merged");
      }
      if (child === "main" || (child === "merge" && parent === "main")) {
        expect(lineRelation(line, commits, relations)).toBe("direct");
      }
    }
    expect(lines.some((line) => line.child === 1 && line.parent === 2)).toBe(true);
    const before = structuredClone(layout);
    const strokes = layout.branches.flatMap((branch) =>
      branchStrokes(branch, false, { row: 2, height: 200 }, (line) =>
        lineRelation(line, commits, relations)
      )
    );
    expect(new Set(strokes.map((stroke) => stroke.relation))).toEqual(
      new Set(["direct", "merged", "unrelated"])
    );
    expect(layout).toEqual(before);
  });

  it("splits a reused lane at emphasis changes and allows merged history to stay bright", () => {
    const strokes = branchStrokes(
      {
        colour: 0,
        lines: [
          {
            child: 0,
            parent: 1,
            p1: { x: 0, y: 0 },
            p2: { x: 0, y: 1 },
            isCommitted: true,
            lockedFirst: true
          },
          {
            child: 1,
            parent: 2,
            p1: { x: 0, y: 1 },
            p2: { x: 0, y: 2 },
            isCommitted: true,
            lockedFirst: true
          }
        ]
      },
      true,
      null,
      (line) => (line.child === 0 ? "unrelated" : "direct")
    );
    expect(strokes.map((stroke) => stroke.relation)).toEqual(["unrelated", "direct"]);
    expect(focusColour("#ff0000", "merged")).not.toBe("#ff0000");
    expect(focusColour("#ff0000", "merged", true)).toBe("#ff0000");
    expect(focusColour("#ff0000", "unrelated", true)).toContain("descriptionForeground");
  });
});
