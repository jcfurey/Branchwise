import { describe, expect, it } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { nearestBranches, repeatedNearest } from "@/webview/graph/nearest";

/** A commit with these parents and labels; `origin/x` is a remote branch, `v:x` a tag. */
function commit(hash: string, parents: string[], ...labels: string[]): GitCommitNode {
  const refs = labels.map((label): GitRef => {
    if (label.startsWith("v:")) {
      return { type: "tag", name: label.slice(2), hash };
    }
    return { type: label.startsWith("origin/") ? "remote" : "head", name: label, hash };
  });
  return { hash, parentHashes: parents, author: "Ada", email: "", date: 0, message: hash, refs };
}

const nearest = (
  commits: GitCommitNode[],
  headBranch: string | null = "main",
  isHidden?: (branch: string) => boolean
) => Object.fromEntries(nearestBranches(commits, headBranch, isHidden));

describe("nearestBranches", () => {
  it("names the branch above a straight line of commits, and only the unlabelled ones", () => {
    const commits = [
      commit("c", ["b"], "main", "v:v2"),
      commit("b", ["a"], "v:v1"),
      commit("a", [])
    ];
    expect(nearest(commits)).toEqual({ b: "main", a: "main" });
  });

  it("prefers the branch fewer first-parent steps above, wherever the lanes run", () => {
    // main: m2 - m1 - base; topic forks from m1 and is one step above it.
    const commits = [
      commit("m2", ["m1x"], "main"),
      commit("m1x", ["m1"]),
      commit("t1", ["m1"], "topic"),
      commit("m1", ["base"]),
      commit("base", [])
    ];
    expect(nearest(commits)).toEqual({ m1x: "main", m1: "topic", base: "topic" });
  });

  it("prefers a first-parent walk over a shorter path through a merge", () => {
    // main merges side's x directly; feature reaches x by first parents in three steps.
    const commits = [
      commit("merge", ["m1", "x"], "main"),
      commit("f3", ["f2"], "feature"),
      commit("f2", ["f1"]),
      commit("f1", ["x"]),
      commit("m1", ["base"]),
      commit("x", ["base"]),
      commit("base", [])
    ];
    const found = nearest(commits);
    expect(found["x"]).toBe("feature");
    expect(found["m1"]).toBe("main");
  });

  it("falls back to a merge when no first-parent walk reaches the commit", () => {
    // The merged branch was deleted: only main's merge reaches its commits.
    const commits = [
      commit("merge", ["m1", "gone2"], "main"),
      commit("gone2", ["gone1"]),
      commit("m1", ["base"]),
      commit("gone1", ["base"]),
      commit("base", [])
    ];
    expect(nearest(commits)).toEqual({ gone2: "main", gone1: "main", m1: "main", base: "main" });
  });

  it("breaks ties for the checked-out branch, then local over remote, then by name", () => {
    const tie = (...labels: string[]) => [commit("tip", ["below"], ...labels), commit("below", [])];
    expect(nearest(tie("zeta", "alpha", "origin/aaa", "main"))["below"]).toBe("main");
    expect(nearest(tie("zeta", "origin/aaa", "beta"))["below"]).toBe("beta");
    expect(nearest(tie("origin/zz", "origin/aa"))["below"]).toBe("origin/aa");
    // With HEAD detached, no branch is checked out.
    expect(nearest(tie("zeta", "main", "alpha"), null)["below"]).toBe("alpha");
    // Two tips at the same distance on different rows.
    const apart = [
      commit("b1", ["shared"], "origin/beta"),
      commit("a1", ["shared"], "zed"),
      commit("shared", [])
    ];
    expect(nearest(apart)["shared"]).toBe("zed");
  });

  it("leaves out hidden branches, and commits only they reach", () => {
    const commits = [
      commit("h2", ["h1"], "wip/secret"),
      commit("m1", ["base"], "main"),
      commit("h1", ["base"]),
      commit("base", [])
    ];
    const hidden = (branch: string) => branch.startsWith("wip/");
    expect(nearest(commits, "main", hidden)).toEqual({ base: "main" });
    // A hidden branch's own commit carries no label once it is hidden.
    expect(nearest([commit("tip", [], "wip/x")], "main", hidden)).toEqual({});
    expect(
      nearest([commit("tip", [], "origin/wip/x")], "main", (b) => b === "remotes/origin/wip/x")
    ).toEqual({});
  });

  it("names nothing for commits whose branch is beyond the loaded rows", () => {
    // The tip of `old` is further down than the rows loaded; `a` and `b` are its history.
    const commits = [commit("b", ["a"]), commit("a", ["older"]), commit("x", [], "main")];
    expect(nearest(commits)).toEqual({});
  });

  it("skips the uncommitted row, remote HEADs and parents not below their child", () => {
    const commits = [
      commit("*", ["tip"]),
      commit("tip", ["mid"], "origin/HEAD"),
      commit("skewed", ["mid"], "main"),
      commit("mid", ["skewed"])
    ];
    expect(nearest(commits)).toEqual({ mid: "main" });
  });
});

describe("repeatedNearest", () => {
  const repeated = (commits: GitCommitNode[], isHidden?: (branch: string) => boolean) => [
    ...repeatedNearest(commits, nearestBranches(commits, "main", isHidden), isHidden)
  ];

  it("leaves the name to the top of a run: under the branch's own label, every row repeats it", () => {
    const commits = [
      commit("c", ["b"], "main"),
      commit("b", ["a"]),
      commit("a", ["root"], "v:v1"),
      commit("root", [])
    ];
    expect(nearest(commits)).toEqual({ b: "main", a: "main", root: "main" });
    expect(repeated(commits)).toEqual(["b", "a", "root"]);
  });

  it("names the branch again wherever rows of another branch come between", () => {
    // main: m3 - m2 - m1 - base; topic: t2 - t1 - base. The lanes interleave by date.
    const commits = [
      commit("m3", ["m2"], "main"),
      commit("t2", ["t1"], "topic"),
      commit("m2", ["m1"]),
      commit("m1", ["base"]),
      commit("t1", ["base"]),
      commit("base", [])
    ];
    // The fork point is two steps under topic and three under main.
    expect(nearest(commits)).toEqual({ m2: "main", m1: "main", t1: "topic", base: "topic" });
    // m2 follows topic's row and t1 follows main's, so both say where they are; m1 and base
    // sit right under a row of their own branch.
    expect(repeated(commits)).toEqual(["m1", "base"]);
  });

  it("starts a run with the name when the branch's own label is hidden or far above", () => {
    const commits = [commit("c", ["b"], "wip/secret"), commit("b", ["a"]), commit("a", [])];
    // Nothing reaches the rows once the only branch is hidden.
    expect(repeated(commits, (branch) => branch === "wip/secret")).toEqual([]);

    const remote = [commit("r", ["q"], "origin/main"), commit("q", ["p"]), commit("p", [])];
    expect(nearest(remote)).toEqual({ q: "origin/main", p: "origin/main" });
    expect(repeated(remote)).toEqual(["q", "p"]);
  });

  it("passes over the row of uncommitted changes", () => {
    const commits = [commit("*", ["c"]), commit("c", ["b"], "main"), commit("b", [])];
    expect(repeated(commits)).toEqual(["b"]);
  });
});
