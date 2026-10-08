// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { TreeEntry } from "@/backend/types";
import { LazyTree, type TreeRow } from "@/webview/utils/allFiles";

import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());

const file = (path: string): TreeEntry => ({ path, kind: "file", size: 1 });

/** Each row as its depth in dots, then its name, with "/" after a folder's. */
const shown = (rows: Array<TreeRow>) =>
  rows.map(
    ({ depth, node }) => ".".repeat(depth) + node.name + (node.type === "folder" ? "/" : "")
  );

const sample = [
  "src/b.ts",
  "src/a.ts",
  "src/deep/x/y.ts",
  "file10.txt",
  "file2.txt",
  "README.md",
  "src2/z.ts"
].map(file);

describe("a commit's whole tree", () => {
  it("shows the top level first, folders before files, names in reading order", () => {
    const { rows, more } = new LazyTree(sample).rows(new Set(), 100);

    expect(shown(rows)).toEqual(["src/", "src2/", "file2.txt", "file10.txt", "README.md"]);
    expect(more).toBe(false);
  });

  it("looks into a folder only once it is opened, and only once", () => {
    const tree = new LazyTree(sample);
    const children = vi.spyOn(tree, "childrenOf");

    tree.rows(new Set(), 100);
    expect(children.mock.calls.map(([folder]) => folder)).toEqual([""]);

    children.mockClear();
    const { rows } = tree.rows(new Set(["src", "src/deep"]), 100);
    expect(shown(rows)).toEqual([
      "src/",
      ".deep/",
      "..x/",
      ".a.ts",
      ".b.ts",
      "src2/",
      "file2.txt",
      "file10.txt",
      "README.md"
    ]);
    // A folder inside a closed one stays unread, even when it is marked open.
    expect(children.mock.calls.map(([folder]) => folder)).toEqual(["", "src", "src/deep"]);
    // Read levels are kept.
    expect(tree.childrenOf("src")).toBe(tree.childrenOf("src"));
  });

  it("draws no more rows than the limit, and says so", () => {
    const tree = new LazyTree(Array.from({ length: 50 }, (_, index) => file(`f${index}`)));

    const first = tree.rows(new Set(), 20);
    expect(first.rows).toHaveLength(20);
    expect(first.more).toBe(true);
    expect(tree.rows(new Set(), 50).more).toBe(false);
  });

  it("filters by path, ignoring case, as a flat list of whole paths", () => {
    const tree = new LazyTree(sample);

    const { rows, more } = tree.matching("SRC/", 100);
    expect(rows.map(({ depth, node }) => [depth, node.name])).toEqual([
      [0, "src/b.ts"],
      [0, "src/a.ts"],
      [0, "src/deep/x/y.ts"]
    ]);
    expect(more).toBe(false);
    expect(tree.matching(".", 2)).toMatchObject({ more: true });
    expect(tree.matching(".", 2).rows).toHaveLength(2);
    expect(tree.matching("nothing", 10).rows).toEqual([]);
  });

  it("keeps a folder and a file of the same name apart, and paths with spaces whole", () => {
    const tree = new LazyTree([file("a b/c d.txt"), file("a b.txt"), file("a")]);

    expect(shown(tree.rows(new Set(["a b"]), 10).rows)).toEqual([
      "a b/",
      ".c d.txt",
      "a",
      "a b.txt"
    ]);
  });
});
