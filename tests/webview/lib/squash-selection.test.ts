// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import { squashSelection } from "@/webview/lib/squash-selection";

import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());

function node(hash: string, ...parentHashes: string[]): GitCommitNode {
  return { hash, parentHashes, author: "A", email: "a@b", date: 1, message: hash, refs: [] };
}

/**
 * main: root ← a ← b ← c ← d (HEAD), with a side branch `x ← y` off `a` that was never merged.
 * The rows are newest first, as the graph lists them.
 */
const rows = [
  node("d", "c"),
  node("y", "x"),
  node("c", "b"),
  node("x", "a"),
  node("b", "a"),
  node("a", "root"),
  node("root")
];
const byHash = new Map(rows.map((row) => [row.hash, row]));
const pick = (...hashes: string[]) => hashes.map((hash) => byHash.get(hash)!);
const check = (selected: GitCommitNode[], list = rows, head: string | null = "d") =>
  squashSelection(selected, list, head, "main");

describe("squashSelection", () => {
  it("rebases from the parent of the oldest selected commit, whatever order they were chosen in", () => {
    expect(check(pick("b", "c", "a"))).toEqual({ base: "root", hashes: ["a", "b", "c"] });
  });

  it("includes HEAD in the run", () => {
    expect(check(pick("d", "c"))).toEqual({ base: "b", hashes: ["c", "d"] });
  });

  it("refuses the root commit, which has no parent to rebase onto", () => {
    expect(check(pick("a", "root"))).toEqual({ reason: "squashRootSelected" });
  });

  it("refuses commits from another branch", () => {
    expect(check(pick("x", "y"))).toEqual({ reason: "squashOtherBranch" });
    expect(check(pick("b", "x"))).toEqual({ reason: "squashOtherBranch" });
  });

  it("refuses a selection with an unselected commit between", () => {
    expect(check(pick("d", "b"))).toEqual({ reason: "squashNotConsecutive" });
  });

  it("needs at least two commits", () => {
    expect(check(pick("c"))).toEqual({ reason: "squashNeedsTwo" });
  });

  it("needs a checked-out branch", () => {
    expect(squashSelection(pick("c", "d"), rows, "d", null)).toEqual({
      reason: "squashNeedsBranch"
    });
    expect(squashSelection(pick("c", "d"), rows, null, "main")).toEqual({
      reason: "squashNeedsBranch"
    });
  });

  it("refuses merge commits in the selection and after it", () => {
    const merged = [node("m", "d", "y"), ...rows];
    expect(check([merged[0]!, ...pick("d")], merged, "m")).toEqual({
      reason: "squashMergeSelected"
    });
    expect(check(pick("c", "d"), merged, "m")).toEqual({ reason: "squashMergeAfter" });
  });

  it("follows the first parent only, so commits brought in by a merge are another branch's", () => {
    const merged = [node("m", "d", "y"), ...rows];
    expect(check(pick("x", "y"), merged, "m")).toEqual({ reason: "squashOtherBranch" });
  });

  it("refuses commits the graph has not loaded a path to", () => {
    expect(check(pick("a", "b"), rows.slice(0, 2))).toEqual({ reason: "squashOtherBranch" });
  });
});
