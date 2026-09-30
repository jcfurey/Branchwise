import { describe, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import { computeGraphLayout } from "@/webview/graph/layout";
import type { GraphLayout, GraphPoint } from "@/webview/graph/types";

import { commit, histories } from "./fixtures";

const key = (point: GraphPoint) => `${point.x},${point.y}`;

/** Follow actual drawn segments, including tails shared by two incoming Git edges. */
function checkConnections(commits: GitCommitNode[], layout: GraphLayout) {
  const lines = layout.branches.flatMap((branch) => branch.lines);
  for (const [child, entry] of commits.entries()) {
    for (const hash of entry.parentHashes) {
      const parent = commits.findIndex((candidate) => candidate.hash === hash);
      if (parent < 0) {
        continue;
      }
      const start = layout.vertices[child]!;
      const target = layout.vertices[parent]!;
      const visited = new Set<string>();
      const pending: GraphPoint[] = [start];
      while (pending.length) {
        const point = pending.pop()!;
        if (visited.has(key(point))) {
          continue;
        }
        visited.add(key(point));
        for (const line of lines) {
          if (line.parent === parent && key(line.p1) === key(point)) {
            pending.push(line.p2);
          }
        }
      }
      expect(visited.has(key(target)), `${entry.hash} must connect to ${hash}`).toBe(true);
    }
  }
  for (const line of lines) {
    expect(line.p2.y).toBe(line.p1.y + 1);
    if (line.parent !== null) {
      expect(commits[line.child]!.parentHashes).toContain(commits[line.parent]!.hash);
      expect(line.p2.y).toBeLessThanOrEqual(line.parent);
    }
    for (const point of [line.p1, line.p2]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(layout.lanes);
      const node = layout.vertices[point.y]!;
      if (key(point) === key(node)) {
        expect(
          [line.child, line.parent],
          "An edge must not pass through an unrelated commit"
        ).toContain(point.y);
      }
    }
  }
}

describe("graph topology", () => {
  it.each(Object.entries(histories))("connects all loaded parents in %s", (_name, commits) => {
    const before = structuredClone(commits);
    const layout = computeGraphLayout(commits, commits[0]!.hash);
    expect(layout.vertices.map((vertex) => vertex.y)).toEqual(commits.map((_, index) => index));
    expect(layout.vertices.filter((vertex) => vertex.isCurrent).map((vertex) => vertex.y)).toEqual([
      0
    ]);
    checkConnections(commits, layout);
    expect(commits).toEqual(before);
  });

  it("reuses lanes and colours once a merged branch has ended", () => {
    const layout = computeGraphLayout(histories["reused lanes"], null);
    expect(layout.lanes).toBe(2);
    expect(layout.vertices[2]!.x).toBe(1);
    expect(layout.vertices[6]!.x).toBe(1);
    expect(layout.vertices[2]!.colour).toBe(layout.vertices[6]!.colour);
  });

  it("fans out every octopus parent without sharing commit positions", () => {
    const layout = computeGraphLayout(histories["octopus merge"], null);
    expect(layout.lanes).toBe(4);
    expect(new Set(layout.vertices.slice(1, 5).map((vertex) => vertex.x)).size).toBe(4);
  });

  it("resolves page-boundary parents when older commits are appended", () => {
    const page = histories["parents outside the page"];
    const partial = computeGraphLayout(page, null);
    expect(partial.vertices).toHaveLength(page.length);
    const loaded = [
      ...page,
      commit("outside-main", "base"),
      commit("outside-other", "base"),
      commit("outside-topic", "base"),
      commit("base")
    ];
    const layout = computeGraphLayout(loaded, null);
    checkConnections(loaded, layout);
    expect(layout.vertices).toHaveLength(loaded.length);
    expect(partial.vertices).toHaveLength(page.length);
  });

  it("handles empty history and keeps uncommitted edges separate from committed edges", () => {
    expect(computeGraphLayout([], null)).toEqual({ vertices: [], branches: [], lanes: 0 });
    const rows = [commit("*", "head"), commit("head", "base"), commit("base")];
    const layout = computeGraphLayout(rows, "head");
    checkConnections(rows, layout);
    expect(layout.vertices.map((vertex) => vertex.isCommitted)).toEqual([false, true, true]);
    expect(layout.vertices.map((vertex) => vertex.isCurrent)).toEqual([true, false, false]);
    const lines = layout.branches.flatMap((branch) => branch.lines);
    expect(
      lines.filter((line) => !line.isCommitted).map((line) => [line.child, line.parent])
    ).toEqual([[0, 1]]);
  });
});
