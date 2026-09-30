import * as path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { searchDirectoryForRepos } from "@/backend/utils/repoSearch";

import { scratchTree } from "@tests/backend/utils/scratchTree";

// Git is replaced by a stand-in that treats folders named `repo…` as repositories and answers
// after a chosen delay, so the search's order and concurrency can be observed.
const stand = vi.hoisted(() => ({
  delays: new Map<string, number>(),
  submodules: new Map<string, string[]>(),
  asked: [] as string[],
  inFlight: 0,
  peak: 0
}));

vi.mock("@/backend/utils/git", () => ({
  workTreeRoot: async (directory: string) => {
    stand.asked.push(directory);
    stand.inFlight += 1;
    stand.peak = Math.max(stand.peak, stand.inFlight);
    const name = path.basename(directory);
    await new Promise((resolve) => setTimeout(resolve, stand.delays.get(name) ?? 1));
    stand.inFlight -= 1;
    return name.startsWith("repo") ? directory : null;
  },
  getSubmodulePaths: async (repo: string) => stand.submodules.get(repo) ?? []
}));

let tree: ReturnType<typeof scratchTree>;
beforeEach(() => {
  tree = scratchTree("schedule");
  stand.delays.clear();
  stand.submodules.clear();
  stand.asked = [];
  stand.inFlight = 0;
  stand.peak = 0;
});
afterEach(() => tree.remove());

it("joins results in listing order, not in the order searches finish", async () => {
  tree.folder("repo1");
  tree.folder("repo2");
  stand.delays.set("repo1", 50).set("repo2", 5);
  expect(await searchDirectoryForRepos(tree.root, 1, "git", [])).toEqual([
    tree.key("repo1"),
    tree.key("repo2")
  ]);
  expect(stand.asked).toEqual([tree.key(), tree.key("repo1"), tree.key("repo2")]);
});

it("searches at most two sibling folders at a time", async () => {
  const names = ["repoA", "repoB", "repoC", "repoD", "repoE"];
  for (const name of names) {
    tree.folder(name);
    stand.delays.set(name, 20);
  }
  const found = await searchDirectoryForRepos(tree.root, 1, "git", []);
  expect(found).toEqual(names.map((name) => tree.key(name)));
  expect(stand.peak).toBe(2);
});

it("lists submodules after their superproject, leaving out known ones", async () => {
  tree.folder("repoRoot");
  const root = tree.key("repoRoot");
  stand.submodules.set(root, [`${root}/a`, `${root}/b`]);
  expect(await searchDirectoryForRepos(root, 0, "git", [`${root}/b`])).toEqual([root, `${root}/a`]);
});

// Decision searchDirectoryForRepos Q3: a path reached twice is listed once, where first found.
it("lists a submodule shared by two repositories once", async () => {
  tree.folder("repo1");
  tree.folder("repo2");
  const shared = tree.key("shared");
  stand.submodules.set(tree.key("repo1"), [shared]);
  stand.submodules.set(tree.key("repo2"), [shared, tree.key("repo2/own")]);
  expect(await searchDirectoryForRepos(tree.root, 1, "git", [])).toEqual([
    tree.key("repo1"),
    shared,
    tree.key("repo2"),
    tree.key("repo2/own")
  ]);
});

it("does not start Git for a folder inside a known repository", async () => {
  tree.folder("repoKnown/inner");
  expect(
    await searchDirectoryForRepos(tree.at("repoKnown/inner"), 3, "git", [tree.at("repoKnown")])
  ).toEqual([]);
  expect(stand.asked).toEqual([]);
});
