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

it("dates each branch by its last commit and says whether HEAD contains it", async () => {
  const other = makeRepo();
  try {
    const env = { ...process.env, GIT_COMMITTER_DATE: "@1700000000 +0000" };
    cp.execFileSync("git", ["checkout", "-q", "-b", "ahead"], { cwd: other });
    cp.execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "ahead"], { cwd: other, env });
    git(["checkout", "-q", "main"], other);
    git(["branch", "behind"], other);
    const state = await loadRepositoryState(createGit(other, "git"));
    const byName = new Map(state.branches.map((branch) => [branch.name, branch]));
    expect(byName.get("ahead")).toMatchObject({ date: 1700000000, merged: false });
    expect(byName.get("behind")).toMatchObject({ merged: true });
    expect(byName.get("main")).toMatchObject({ merged: true });
    expect(byName.get("main")!.date).toBeGreaterThan(0);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

it("counts the paths with staged changes, not unstaged or untracked ones", async () => {
  expect((await loadRepositoryState(createGit(repo, "git"))).staged).toBe(0);
  fs.writeFileSync(`${repo}/f`, "staged");
  git(["add", "f"], repo);
  fs.writeFileSync(`${repo}/f`, "and unstaged");
  fs.writeFileSync(`${repo}/new`, "untracked");
  try {
    expect((await loadRepositoryState(createGit(repo, "git"))).staged).toBe(1);
  } finally {
    git(["reset", "-q", "--hard"], repo);
    fs.rmSync(`${repo}/new`);
  }
});
