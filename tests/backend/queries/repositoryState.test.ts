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

it("names each remote's default branch from its HEAD, when the remote has one", async () => {
  const other = makeRepo();
  try {
    for (const name of ["origin", "team/lab", "bare"]) {
      git(["remote", "add", name, `https://example.com/${name}.git`], other);
    }
    git(["update-ref", "refs/remotes/origin/develop", "HEAD"], other);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"], other);
    git(["update-ref", "refs/remotes/team/lab/release/2", "HEAD"], other);
    git(["symbolic-ref", "refs/remotes/team/lab/HEAD", "refs/remotes/team/lab/release/2"], other);
    const state = await loadRepositoryState(createGit(other, "git"));
    expect(state.remotes.map(({ name, defaultBranch }) => ({ name, defaultBranch }))).toEqual([
      { name: "bare", defaultBranch: undefined },
      { name: "origin", defaultBranch: "develop" },
      { name: "team/lab", defaultBranch: "release/2" }
    ]);
    // A remote without a HEAD gets no field at all.
    expect(Object.hasOwn(state.remotes[0]!, "defaultBranch")).toBe(false);
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
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

it.skipIf(process.platform === "win32")(
  "reads every remote's addresses in one process, and skips the untracked files it has no use for",
  async () => {
    const own = makeRepo();
    const bin = fs.mkdtempSync(own + "-bin-");
    try {
      git(["remote", "add", "origin", "https://example.invalid/origin.git"], own);
      git(["remote", "add", "two.dots", "https://example.invalid/first.git"], own);
      git(["remote", "set-url", "--add", "two.dots", "https://example.invalid/second.git"], own);
      git(["remote", "set-url", "--push", "two.dots", "ssh://example.invalid/push.git"], own);
      git(["remote", "add", "backup", "/srv/backup = here.git"], own);
      git(["config", "remote.pushDefault", "backup"], own);
      fs.writeFileSync(`${own}/untracked`, "left alone");
      const { recordingGit } = await import("@tests/backend/queries/loadCommits/fixtures");
      const recorder = recordingGit(bin);

      const state = await loadRepositoryState(createGit(own, recorder.gitPath));

      expect(state.remotes).toEqual([
        { name: "backup", fetchUrls: ["/srv/backup = here.git"], pushUrls: [] },
        { name: "origin", fetchUrls: ["https://example.invalid/origin.git"], pushUrls: [] },
        {
          name: "two.dots",
          fetchUrls: ["https://example.invalid/first.git", "https://example.invalid/second.git"],
          pushUrls: ["ssh://example.invalid/push.git"]
        }
      ]);
      expect(state.pushDefault).toBe("backup");
      const runs = recorder.runs();
      // The state is read again after every change to the work tree, so each process counts.
      // Asked remote by remote, three remotes took seven processes for their settings.
      expect(runs.filter((run) => run.startsWith("config "))).toHaveLength(1);
      expect(runs.find((run) => run.startsWith("status "))).toContain("--untracked-files=no");
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
      fs.rmSync(bin, { recursive: true, force: true });
    }
  }
);
