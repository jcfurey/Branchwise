import * as cp from "node:child_process";
import * as fs from "node:fs";

import { afterAll, beforeAll, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadRepositoryState } from "@/backend/queries/repository";

import { git, makeRepo } from "@tests/backend/helpers";

let repo: string;

beforeAll(() => {
  repo = makeRepo();
  git(["branch", "feature"], repo);
  git(["tag", "light"], repo);
  git(["tag", "-a", "annotated", "-m", "note"], repo);
  git(["update-ref", "refs/remotes/mirror/main", "HEAD"], repo);
  git(["symbolic-ref", "refs/remotes/mirror/HEAD", "refs/remotes/mirror/main"], repo);
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

it("reports the commit behind every branch, remote branch and tag", async () => {
  const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();
  const state = await loadRepositoryState(createGit(repo, "git"));
  expect(state.branches.map((branch) => [branch.name, branch.hash])).toEqual([
    ["feature", head],
    ["main", head]
  ]);
  // The symbolic mirror/HEAD is not a branch. An annotated tag reports its commit.
  expect(state.remoteBranches).toEqual([{ name: "mirror/main", hash: head }]);
  expect(state.tags).toEqual([
    { name: "annotated", hash: head },
    { name: "light", hash: head }
  ]);
});
