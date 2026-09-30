import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

import { afterAll, beforeAll, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadHistory } from "@/backend/queries/history";
import { loadBranches } from "@/backend/queries/loadBranches";
import { loadCommits } from "@/backend/queries/loadCommits";

import { git, makeRepo } from "@tests/backend/helpers";

let repo: string;
let base: string;
const tips: Record<string, string> = {};
const read = (args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
const historyFilter = {
  text: "remote needle",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false
};
const commits = (hiddenRemotes: string[], showRemoteBranches = true, maxCommits = 100) =>
  loadCommits(createGit(repo, "git"), {
    branchName: "",
    maxCommits,
    showRemoteBranches,
    hiddenRemotes,
    hard: true,
    dateType: "Author Date",
    showUncommittedChanges: false
  });

beforeAll(() => {
  repo = makeRepo();
  base = read(["rev-parse", "HEAD"]);
  const tree = read(["rev-parse", "HEAD^{tree}"]);
  for (const remote of ["origin", "origin2", "team/upstream"]) {
    git(["remote", "add", remote, "."], repo);
  }
  for (const name of [
    "origin/topic",
    "origin/tagged",
    "origin2/topic",
    "team/topic",
    "team/upstream/topic",
    "stale/topic"
  ]) {
    tips[name] = read(["commit-tree", tree, "-p", base, "-m", "remote needle " + name]);
    git(["update-ref", "refs/remotes/" + name, tips[name]!], repo);
  }
  git(["update-ref", "refs/remotes/origin/shared", base], repo);
  git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/topic"], repo);
  git(["tag", "-a", "kept-tag", tips["origin/tagged"]!, "-m", "tag keeps history"], repo);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

it("hides one remote's tips and labels while retaining local, tagged and shared history", async () => {
  const result = await commits(["origin"]);
  const hashes = result.commits.map((commit) => commit.hash);
  expect(hashes).not.toContain(tips["origin/topic"]);
  expect(hashes).toContain(base);
  expect(hashes).toContain(tips["origin/tagged"]);
  expect(hashes).toContain(tips["origin2/topic"]);
  expect(
    result.commits
      .flatMap((commit) => commit.refs)
      .some((ref) => ref.type === "remote" && ref.name.startsWith("origin/"))
  ).toBe(false);
  expect(result.commits.flatMap((commit) => commit.refs)).toContainEqual(
    expect.objectContaining({ type: "tag", name: "kept-tag" })
  );
  const branches = await loadBranches(createGit(repo, "git"), {
    repo,
    gitPath: "git",
    showRemoteBranches: true,
    hiddenRemotes: ["origin"],
    hard: true
  });
  expect(branches.branches).toContain("main");
  expect(branches.branches).toContain("remotes/origin2/topic");
  expect(branches.branches.some((branch) => branch.startsWith("remotes/origin/"))).toBe(false);
  expect((await commits(["origin"], true, 1)).moreCommitsAvailable).toBe(true);
  expect((await commits([])).commits.map((commit) => commit.hash)).toContain(tips["origin/topic"]);
});

it("matches complete remote names, including overlapping names containing slashes and orphan refs", async () => {
  const parentHidden = (await commits(["team", "stale"])).commits.map((commit) => commit.hash);
  expect(parentHidden).not.toContain(tips["team/topic"]);
  expect(parentHidden).not.toContain(tips["stale/topic"]);
  expect(parentHidden).toContain(tips["team/upstream/topic"]);
  const childHidden = (await commits(["team/upstream"])).commits.map((commit) => commit.hash);
  expect(childHidden).toContain(tips["team/topic"]);
  expect(childHidden).not.toContain(tips["team/upstream/topic"]);
});

it("applies the same visibility to history search and the global remote switch", async () => {
  const page = await loadHistory(createGit(repo, "git"), historyFilter, 0, {
    hiddenRemotes: ["origin"]
  });
  expect(page.entries.map((commit) => commit.hash)).not.toContain(tips["origin/topic"]);
  expect(page.entries.map((commit) => commit.hash)).toContain(tips["origin2/topic"]);
  expect(page.entries.map((commit) => commit.hash)).toContain(tips["origin/tagged"]);
  const local = await commits(["origin"], false);
  expect(new Set(local.commits.map((commit) => commit.hash))).toEqual(
    new Set([base, tips["origin/tagged"]])
  );
  expect(local.commits.flatMap((commit) => commit.refs).some((ref) => ref.type === "remote")).toBe(
    false
  );
  const localSearch = await loadHistory(createGit(repo, "git"), historyFilter, 0, {
    showRemoteBranches: false
  });
  expect(localSearch.entries.map((commit) => commit.hash)).toEqual([tips["origin/tagged"]]);
  expect(read(["branch", "--show-current"])).toBe("main");
  expect(read(["rev-parse", "refs/remotes/origin/topic"])).toBe(tips["origin/topic"]);
});
