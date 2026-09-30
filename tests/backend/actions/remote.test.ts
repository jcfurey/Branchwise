import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fetchRemote, pullBranch, pushBranch } from "@/backend/actions/remote";
import { createGit } from "@/backend/gitClient";
import { loadRemotes } from "@/backend/queries/loadRemotes";

import { git, makeRepo } from "@tests/backend/helpers";

let repo: string;
let origin: string;
let peer: string;
let dirs: string[];
const requestId = "test-request";

function read(cwd: string, args: string[]) {
  return cp.execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngg-remote-"));
  dirs.push(dir);
  return dir;
}

function addBackup() {
  const backup = directory();
  git(["clone", "--bare", repo, backup], repo);
  git(["remote", "add", "backup", backup], repo);
  return backup;
}

function advanceRemote() {
  fs.writeFileSync(path.join(peer, "f"), "remote update");
  git(["add", "f"], peer);
  git(["commit", "-m", "remote update"], peer);
  git(["push", "origin", "main"], peer);
  return read(peer, ["rev-parse", "HEAD"]);
}

beforeEach(() => {
  repo = makeRepo();
  dirs = [repo];
  origin = directory();
  peer = directory();
  git(["clone", "--bare", repo, origin], repo);
  git(["remote", "add", "origin", origin], repo);
  git(["fetch", "origin"], repo);
  git(["branch", "--set-upstream-to=origin/main", "main"], repo);
  git(["config", "merge.autoStash", "false"], repo);
  git(["clone", origin, peer], repo);
  git(["config", "user.name", "T"], peer);
  git(["config", "user.email", "t@t.com"], peer);
  git(["config", "commit.gpgsign", "false"], peer);
});

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("pushBranch", () => {
  it("pushes a non-current branch to the chosen destination and sets its upstream", async () => {
    const backup = addBackup();
    const main = read(repo, ["rev-parse", "HEAD"]);
    git(["checkout", "-b", "feature/navigation"], repo);
    git(["commit", "--allow-empty", "-m", "feature work"], repo);
    const feature = read(repo, ["rev-parse", "HEAD"]);
    git(["checkout", "main"], repo);
    git(["tag", "feature/navigation"], repo);
    fs.writeFileSync(path.join(repo, "uncommitted.txt"), "unfinished work");
    await pushBranch(createGit(repo, "git"), {
      requestId,
      branchName: "feature/navigation",
      remote: "backup",
      remoteBranch: "review/navigation",
      setUpstream: true
    });
    expect(read(backup, ["rev-parse", "refs/heads/review/navigation"])).toBe(feature);
    expect(read(repo, ["rev-parse", "HEAD"])).toBe(main);
    expect(read(repo, ["branch", "--show-current"])).toBe("main");
    expect(read(repo, ["config", "branch.feature/navigation.remote"])).toBe("backup");
    expect(read(repo, ["config", "branch.feature/navigation.merge"])).toBe(
      "refs/heads/review/navigation"
    );
    expect(fs.readFileSync(path.join(repo, "uncommitted.txt"), "utf8")).toBe("unfinished work");
  });

  it("preserves an existing upstream when pushing to another remote without changing tracking", async () => {
    addBackup();
    await pushBranch(createGit(repo, "git"), {
      requestId,
      branchName: "main",
      remote: "backup",
      remoteBranch: "published",
      setUpstream: false
    });
    expect(read(repo, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe("origin/main");
  });

  it("rejects a non-fast-forward push without replacing remote commits", async () => {
    const remote = advanceRemote();
    git(["commit", "--allow-empty", "-m", "local work"], repo);
    await expect(
      pushBranch(createGit(repo, "git"), {
        requestId,
        branchName: "main",
        remote: "origin",
        remoteBranch: "main",
        setUpstream: false
      })
    ).rejects.toThrow();
    expect(read(origin, ["rev-parse", "main"])).toBe(remote);
  });

  it("only accepts configured remotes and valid destination branch names", async () => {
    const original = read(origin, ["rev-parse", "main"]);
    await expect(
      pushBranch(createGit(repo, "git"), {
        requestId,
        branchName: "main",
        remote: origin,
        remoteBranch: "main",
        setUpstream: false
      })
    ).rejects.toThrow(/not configured/);
    await expect(
      pushBranch(createGit(repo, "git"), {
        requestId,
        branchName: "main",
        remote: "origin",
        remoteBranch: "main:other",
        setUpstream: false
      })
    ).rejects.toThrow(/valid branch name/);
    expect(read(origin, ["rev-parse", "main"])).toBe(original);
  });
});

describe("fetchRemote", () => {
  it("updates remote refs while keeping the local branch and working tree unchanged", async () => {
    const original = read(repo, ["rev-parse", "HEAD"]);
    const latest = advanceRemote();
    fs.writeFileSync(path.join(repo, "f"), "unfinished work");
    await fetchRemote(createGit(repo, "git"), { requestId, remote: "origin", prune: false });
    expect(read(repo, ["rev-parse", "origin/main"])).toBe(latest);
    expect(read(repo, ["rev-parse", "HEAD"])).toBe(original);
    expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("unfinished work");
  });

  it("prunes deleted remote refs only when requested", async () => {
    git(["branch", "gone", "main"], origin);
    git(["fetch", "origin"], repo);
    git(["branch", "-D", "gone"], origin);
    git(["config", "fetch.prune", "true"], repo);
    await fetchRemote(createGit(repo, "git"), { requestId, remote: "origin", prune: false });
    expect(read(repo, ["branch", "--no-color", "-r", "--list", "origin/gone"])).toBe("origin/gone");
    await fetchRemote(createGit(repo, "git"), { requestId, remote: "origin", prune: true });
    expect(read(repo, ["branch", "--no-color", "-r", "--list", "origin/gone"])).toBe("");
  });

  it("fetches all configured remotes", async () => {
    const backup = addBackup();
    const latest = advanceRemote();
    git(["branch", "backup-only", "main"], backup);
    await fetchRemote(createGit(repo, "git"), { requestId, remote: null, prune: false });
    expect(read(repo, ["rev-parse", "origin/main"])).toBe(latest);
    expect(read(repo, ["branch", "--no-color", "-r", "--list", "backup/backup-only"])).toBe(
      "backup/backup-only"
    );
  });
});

describe("pullBranch", () => {
  it("fetches and fast-forwards the checked-out branch despite rebase or merge configuration", async () => {
    const latest = advanceRemote();
    git(["config", "pull.rebase", "true"], repo);
    git(["config", "merge.ff", "false"], repo);
    await pullBranch(createGit(repo, "git"), {
      requestId,
      branchName: "main",
      remote: "origin",
      remoteBranch: "main"
    });
    expect(read(repo, ["rev-parse", "HEAD"])).toBe(latest);
    expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("remote update");
  });

  it("refuses to pull into a branch that is not checked out", async () => {
    const original = read(repo, ["rev-parse", "HEAD"]);
    git(["branch", "other"], repo);
    advanceRemote();
    await expect(
      pullBranch(createGit(repo, "git"), {
        requestId,
        branchName: "other",
        remote: "origin",
        remoteBranch: "main"
      })
    ).rejects.toThrow(/Check out branch/);
    expect(read(repo, ["rev-parse", "HEAD"])).toBe(original);
    expect(read(repo, ["branch", "--show-current"])).toBe("main");
  });

  it("refuses diverged history without rebasing or merging local commits", async () => {
    git(["config", "pull.rebase", "true"], repo);
    git(["commit", "--allow-empty", "-m", "local work"], repo);
    const local = read(repo, ["rev-parse", "HEAD"]);
    advanceRemote();
    await expect(
      pullBranch(createGit(repo, "git"), {
        requestId,
        branchName: "main",
        remote: "origin",
        remoteBranch: "main"
      })
    ).rejects.toThrow();
    expect(read(repo, ["rev-parse", "HEAD"])).toBe(local);
    expect(read(repo, ["status", "--porcelain"])).toBe("");
    expect(fs.existsSync(path.join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("preserves uncommitted changes that conflict with the remote update", async () => {
    const original = read(repo, ["rev-parse", "HEAD"]);
    advanceRemote();
    fs.writeFileSync(path.join(repo, "f"), "unfinished work");
    await expect(
      pullBranch(createGit(repo, "git"), {
        requestId,
        branchName: "main",
        remote: "origin",
        remoteBranch: "main"
      })
    ).rejects.toThrow();
    expect(read(repo, ["rev-parse", "HEAD"])).toBe(original);
    expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("unfinished work");
  });
});

describe("loadRemotes", () => {
  it("reports the upstream and respects branch pushRemote over remote.pushDefault", async () => {
    addBackup();
    git(["config", "remote.pushDefault", "backup"], repo);
    expect(await loadRemotes(createGit(repo, "git"), "main")).toEqual({
      remotes: ["backup", "origin"],
      upstream: { remote: "origin", branchName: "main" },
      pushRemote: "backup"
    });
    git(["config", "branch.main.pushRemote", "origin"], repo);
    expect((await loadRemotes(createGit(repo, "git"), "main")).pushRemote).toBe("origin");
  });

  it("preserves upstream branch names with slashes and supports unpublished branches", async () => {
    git(["config", "branch.main.merge", "refs/heads/release/stable"], repo);
    expect((await loadRemotes(createGit(repo, "git"), "main")).upstream?.branchName).toBe(
      "release/stable"
    );
    git(["branch", "new-branch"], repo);
    expect((await loadRemotes(createGit(repo, "git"), "new-branch")).upstream).toBeNull();
  });

  it("reports no remotes without assuming origin exists", async () => {
    git(["remote", "remove", "origin"], repo);
    expect(await loadRemotes(createGit(repo, "git"), null)).toEqual({
      remotes: [],
      upstream: null,
      pushRemote: null
    });
  });
});
