import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { searchDirectoryForRepos } from "@/backend/utils/repoSearch";

import { git } from "@tests/backend/helpers";
import { scratchTree } from "@tests/backend/utils/scratchTree";

let tree: ReturnType<typeof scratchTree>;
beforeEach(() => {
  tree = scratchTree("walk");
});
afterEach(() => tree.remove());

const search = (relative: string, depth: number, gitPath = "git", known: string[] = []) =>
  searchDirectoryForRepos(tree.at(relative), depth, gitPath, known);

describe("symlinks", () => {
  it("follows a symlinked folder to the real repository", async () => {
    tree.repo("r");
    tree.link("x/link", "r");
    expect(await search("x", 1)).toEqual([tree.key("r")]);
  });

  // Decision searchDirectoryForRepos Q3: each path is listed once.
  it("ends a symlink loop when the depth runs out and lists its repository once", async () => {
    tree.repo("loop/r");
    tree.link("loop/self", "loop");
    expect(await search("loop", 3)).toEqual([tree.key("loop/r")]);
  });

  it("keeps a repository where it is first found", async () => {
    tree.repo("b-repo");
    tree.repo("c-repo");
    tree.link("a-link", "c-repo");
    expect(await search("", 1)).toEqual([tree.key("c-repo"), tree.key("b-repo")]);
  });
});

describe("which folders are searched", () => {
  it("skips an entry named .git even outside a repository", async () => {
    tree.repo("fake/.git/inner");
    expect(await search("fake", 3)).toEqual([]);
  });

  it("searches hidden folders and node_modules like any other", async () => {
    tree.repo(".hidden/r");
    tree.repo("node_modules/p");
    expect(await search("", 2)).toEqual([tree.key(".hidden/r"), tree.key("node_modules/p")]);
  });

  it("reports neither bare repositories nor repositories inside a work tree", async () => {
    git(["init", "-q", "--bare", tree.at("b.git")], tree.root);
    tree.repo("o", true);
    tree.repo("o/in");
    git(["worktree", "add", "-q", "--detach", tree.at("w")], tree.at("o"));
    expect(await search("", 3)).toEqual([tree.key("o"), tree.key("w")]);
  });

  it("returns the root of a work tree when started below it", async () => {
    tree.repo("r");
    tree.folder("r/a/b");
    expect(await search("r/a/b", 5)).toEqual([tree.key("r")]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "skips an unreadable folder and still finds its siblings",
    async () => {
      tree.folder("locked");
      tree.repo("open");
      fs.chmodSync(tree.at("locked"), 0o000);
      try {
        expect(await search("", 2)).toEqual([tree.key("open")]);
      } finally {
        fs.chmodSync(tree.at("locked"), 0o755);
      }
    }
  );
});

describe("depth", () => {
  it("still reports the directory's own repository at a negative depth", async () => {
    tree.repo("r");
    expect(await search("r", -1)).toEqual([tree.key("r")]);
    expect(await search("", -1)).toEqual([]);
  });

  it("treats a fractional depth as the next whole number", async () => {
    tree.repo("one/two");
    expect(await search("", 0.5)).toEqual([]);
    expect(await search("", 1.5)).toEqual([tree.key("one/two")]);
  });
});

it("finds nothing when the Git executable is missing", async () => {
  tree.repo("r");
  expect(await search("r", 2, tree.at("r/missing-git"))).toEqual([]);
});
