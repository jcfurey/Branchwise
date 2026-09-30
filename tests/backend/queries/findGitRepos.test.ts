import { afterEach, beforeEach, expect, it } from "vitest";

import { findGitRepos } from "@/backend/queries/repoSearch";

import { scratchTree } from "@tests/backend/utils/scratchTree";

let tree: ReturnType<typeof scratchTree>;
beforeEach(() => {
  tree = scratchTree("find");
});
afterEach(() => tree.remove());

it("sorts by locale collation rather than by UTF-16 code unit", async () => {
  tree.repo("B-repo");
  tree.repo("a-repo");
  const found = await findGitRepos([tree.at("B-repo"), tree.at("a-repo")], "git", 0);
  expect(found).toEqual([tree.key("a-repo"), tree.key("B-repo")]);
});

it("lists a repository reached through a symlink once", async () => {
  tree.repo("r");
  tree.link("link", "r");
  expect(await findGitRepos([tree.root], "git", 1)).toEqual([tree.key("r")]);
});

it("reports only the enclosing repository of a folder inside one", async () => {
  tree.repo("");
  tree.repo("projects/app");
  expect(await findGitRepos([tree.at("projects")], "git", 2)).toEqual([tree.key()]);
  expect(await findGitRepos([tree.at("projects/app")], "git", 2)).toEqual([
    tree.key("projects/app")
  ]);
});

it("resolves to an empty list when the Git executable is missing", async () => {
  tree.repo("r");
  await expect(findGitRepos([tree.at("r")], tree.at("r/missing-git"), 1)).resolves.toEqual([]);
});

it("finds nothing at the path of a file", async () => {
  tree.file("notes.txt");
  expect(await findGitRepos([tree.at("notes.txt")], "git", 2)).toEqual([]);
});

it("merges folders that overlap, keeping each repository once", async () => {
  tree.repo("one");
  tree.repo("two");
  tree.folder("one/deep");
  const found = await findGitRepos(
    [tree.at("two"), tree.root, tree.at("one/deep"), tree.at("one")],
    "git",
    1
  );
  expect(found).toEqual([tree.key("one"), tree.key("two")]);
});
