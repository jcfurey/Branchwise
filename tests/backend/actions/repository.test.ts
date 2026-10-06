import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkoutBranch } from "@/backend/actions/branch";
import { pushBranch } from "@/backend/actions/remote";
import { runRepositoryAction } from "@/backend/actions/repository";
import { pushTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";
import {
  loadOperation,
  loadRebasePlan,
  loadRepositoryState,
  loadStashes,
  loadWorktrees,
  repositoryQuery
} from "@/backend/queries/repository";
import type { RepositoryAction } from "@/backend/types";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { makeRepo } from "@tests/backend/helpers";

// The running test's own repository, as `makeRepo` gave it; the `beforeEach` below sets it anew.
let repo = "";
let dirs: string[];
const read = (args: string[], cwd = repo) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const run = (action: RepositoryAction) => runRepositoryAction(createGit(repo, "git"), action);
function directory() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-workflow-")));
  dirs.push(dir);
  return dir;
}
function commit(file: string, value: string, cwd = repo) {
  fs.writeFileSync(path.join(cwd, file), value);
  read(["add", "--", file], cwd);
  read(["commit", "-m", value], cwd);
  return read(["rev-parse", "HEAD"], cwd);
}
function remote(name = "backup") {
  const bare = directory();
  read(["clone", "--bare", repo, bare]);
  read(["remote", "add", name, bare]);
  read(["fetch", name]);
  return bare;
}
function conflictBranches() {
  const base = read(["rev-parse", "HEAD"]);
  read(["checkout", "-b", "other"]);
  const other = commit("f", "other");
  read(["checkout", "main"]);
  const head = commit("f", "main");
  return { base, other, head };
}

beforeEach(() => {
  repo = makeRepo();
  dirs = [repo];
  read(["config", "rerere.enabled", "false"]);
  read(["config", "rebase.autoStash", "false"]);
  read(["config", "merge.autoStash", "false"]);
});
afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("remote and tracking configuration", () => {
  it("adds, edits, renames and removes remotes while maintaining push defaults and tracking", async () => {
    const bare = directory();
    read(["clone", "--bare", repo, bare]);
    await run({ kind: "addRemote", name: "team/origin", url: bare, fetch: true });
    await run({ kind: "setTracking", branch: "main", upstream: "refs/remotes/team/origin/main" });
    await run({ kind: "pushDefault", remote: "team/origin" });
    read(["config", "branch.main.pushRemote", "team/origin"]);
    // Colored `git branch` output must not hide branches whose push remote changes.
    read(["config", "color.branch", "always"]);
    read(["branch", "topic"]);
    read(["config", "branch.topic.pushRemote", "team/origin"]);
    await run({
      kind: "editRemote",
      name: "team/origin",
      fetchUrls: [bare, bare + "-mirror"],
      pushUrls: [bare]
    });
    expect((await loadRepositoryState(createGit(repo, "git"))).remotes[0]).toEqual({
      name: "team/origin",
      fetchUrls: [bare, bare + "-mirror"],
      pushUrls: [bare]
    });
    await run({ kind: "renameRemote", name: "team/origin", newName: "team/upstream" });
    expect(read(["config", "remote.pushDefault"])).toBe("team/upstream");
    expect(read(["config", "branch.main.pushRemote"])).toBe("team/upstream");
    expect(read(["config", "branch.topic.pushRemote"])).toBe("team/upstream");
    expect(read(["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe("team/upstream/main");
    await run({ kind: "editRemote", name: "team/upstream", fetchUrls: [bare], pushUrls: [] });
    expect((await loadRepositoryState(createGit(repo, "git"))).remotes[0]?.pushUrls).toEqual([]);
    await run({ kind: "removeRemote", name: "team/upstream" });
    expect((await loadRepositoryState(createGit(repo, "git"))).remotes).toEqual([]);
    expect(read(["branch", "--show-current"])).toBe("main");
    expect(fs.existsSync(bare)).toBe(true);
    expect((await loadRepositoryState(createGit(repo, "git"))).pushDefault).toBeNull();
  });

  it("reports ahead/behind and allows tracking to be cleared without pushing", async () => {
    remote();
    await run({ kind: "setTracking", branch: "main", upstream: "backup/main" });
    commit("a", "local");
    expect((await loadRepositoryState(createGit(repo, "git"))).branches[0]).toMatchObject({
      upstream: "backup/main",
      ahead: 1,
      behind: 0
    });
    await run({ kind: "setTracking", branch: "main", upstream: null });
    expect((await loadRepositoryState(createGit(repo, "git"))).branches[0]?.upstream).toBe("");
  });

  it("validates all URLs before changing an existing remote", async () => {
    const bare = remote();
    await expect(
      run({ kind: "editRemote", name: "backup", fetchUrls: ["valid", "bad\nurl"], pushUrls: [] })
    ).rejects.toThrow();
    expect(read(["remote", "get-url", "backup"])).toBe(bare);
    await expect(
      run({ kind: "addRemote", name: "--bad", url: bare, fetch: false })
    ).rejects.toThrow();
  });

  it("pushes tags to a selected remote and deletes only the selected ref namespace", async () => {
    const bare = remote();
    read(["branch", "release"]);
    read(["tag", "release"]);
    await pushTag(createGit(repo, "git"), { remote: "backup", tagName: "release" });
    read(["push", "backup", "refs/heads/release"]);
    await run({ kind: "deleteRemoteRef", remote: "backup", name: "release", refType: "branch" });
    expect(read(["tag", "--list"], bare)).toBe("release");
    expect(read(["branch", "--no-color", "--list", "release"], bare)).toBe("");
    await run({ kind: "deleteRemoteRef", remote: "backup", name: "release", refType: "tag" });
    expect(read(["tag", "--list"], bare)).toBe("");
    expect(read(["tag", "--list"])).toBe("release");
  });

  it("fetches before checkout and tracks explicitly even when automatic tracking is disabled", async () => {
    const bare = remote("team/origin");
    const peer = directory();
    read(["clone", bare, peer]);
    read(["config", "user.name", "T"], peer);
    read(["config", "user.email", "t@t"], peer);
    read(["config", "commit.gpgsign", "false"], peer);
    const latest = commit("latest", "latest", peer);
    read(["push", "origin", "main"], peer);
    read(["config", "branch.autoSetupMerge", "false"]);
    await checkoutBranch(createGit(repo, "git"), {
      branchName: "feature/navigation",
      remoteBranch: "team/origin/main",
      fetch: true
    });
    expect(read(["rev-parse", "HEAD"])).toBe(latest);
    expect(read(["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe("team/origin/main");
  });

  it("uses an explicit lease that remains protective after a background fetch", async () => {
    const bare = remote();
    const lease = await repositoryQuery(createGit(repo, "git"), {
      kind: "lease",
      remote: "backup",
      branch: "main"
    });
    if (lease.kind !== "lease") {
      throw new Error("Expected lease");
    }
    read(["commit", "--amend", "-m", "rewritten"]);
    await pushBranch(createGit(repo, "git"), {
      requestId: "push",
      remote: "backup",
      branchName: "main",
      remoteBranch: "main",
      setUpstream: false,
      expectedRemoteHash: lease.hash
    });
    const rewritten = read(["rev-parse", "main"], bare);
    expect(rewritten).not.toBe(lease.hash);
    read(["fetch", "backup"]);
    read(["commit", "--amend", "-m", "another rewrite"]);
    await expect(
      pushBranch(createGit(repo, "git"), {
        requestId: "push",
        remote: "backup",
        branchName: "main",
        remoteBranch: "main",
        setUpstream: false,
        expectedRemoteHash: lease.hash
      })
    ).rejects.toThrow();
    expect(read(["rev-parse", "main"], bare)).toBe(rewritten);
  });
});

describe("stashes", () => {
  it("saves untracked files, inspects a stable stash and restores staged changes", async () => {
    fs.writeFileSync(path.join(repo, "f"), "staged");
    read(["add", "f"]);
    fs.writeFileSync(path.join(repo, "untracked"), "new file");
    await run({ kind: "saveStash", message: "my work", includeUntracked: true });
    const stash = (await loadStashes(createGit(repo, "git")))[0]!;
    expect(stash.message).toContain("my work");
    expect(read(["status", "--porcelain"])).toBe("");
    const inspected = await run({
      kind: "stash",
      operation: "inspect",
      stash,
      reinstateIndex: false
    });
    expect(inspected).toMatchObject({ kind: "document" });
    if (inspected?.kind === "document") {
      expect(inspected.text).toContain("new file");
    }
    fs.writeFileSync(path.join(repo, "f"), "newer stash");
    await run({ kind: "saveStash", message: "newer", includeUntracked: false });
    await run({ kind: "stash", operation: "pop", stash, reinstateIndex: true });
    expect(fs.readFileSync(path.join(repo, "untracked"), "utf8")).toBe("new file");
    expect(read(["diff", "--cached"])).toContain("staged");
    expect((await loadStashes(createGit(repo, "git"))).map((entry) => entry.message)).toEqual([
      expect.stringContaining("newer")
    ]);
  });

  it("retains a stash when pop conflicts and exposes the conflicted files", async () => {
    fs.writeFileSync(path.join(repo, "f"), "stashed");
    await run({ kind: "saveStash", message: "conflict", includeUntracked: false });
    const stash = (await loadStashes(createGit(repo, "git")))[0]!;
    commit("f", "committed change");
    await expect(
      run({ kind: "stash", operation: "pop", stash, reinstateIndex: false })
    ).rejects.toThrow();
    expect((await loadStashes(createGit(repo, "git")))[0]?.hash).toBe(stash.hash);
    expect((await loadRepositoryState(createGit(repo, "git"))).conflicts).toEqual(["f"]);
  });

  it("drops the selected stash and rejects a stale selection", async () => {
    fs.writeFileSync(path.join(repo, "f"), "stash");
    await run({ kind: "saveStash", message: "drop", includeUntracked: false });
    const stash = (await loadStashes(createGit(repo, "git")))[0]!;
    await run({ kind: "stash", operation: "drop", stash, reinstateIndex: false });
    expect(await loadStashes(createGit(repo, "git"))).toEqual([]);
    await expect(
      run({ kind: "stash", operation: "drop", stash, reinstateIndex: false })
    ).rejects.toThrow(/changed/);
  });
});

describe("operation recovery", () => {
  it("detects and completes a conflicted merge after explicitly staging the resolution", async () => {
    conflictBranches();
    // Git reports conflicts in the user's language; its exit status is the stable signal.
    expect(() => read(["merge", "other"])).toThrow();
    const state = await loadRepositoryState(createGit(repo, "git"));
    expect(state.operation?.kind).toBe("merge");
    await expect(
      run({ kind: "recover", operation: state.operation!, resolution: "continue" })
    ).rejects.toThrow(/Resolve and stage/);
    expect(await run({ kind: "conflict", path: "f", operation: "open" })).toEqual({
      kind: "conflict",
      path: path.join(repo, "f"),
      status: "UU"
    });
    fs.writeFileSync(path.join(repo, "f"), "resolved");
    await run({ kind: "conflict", path: "f", operation: "stage" });
    await run({ kind: "recover", operation: state.operation!, resolution: "continue" });
    expect(await loadOperation(createGit(repo, "git"))).toBeNull();
    expect(read(["show", "-s", "--format=%P", "HEAD"]).split(" ")).toHaveLength(2);
  });

  it.each(["abort", "skip"] as const)("can %s a conflicted cherry-pick", async (resolution) => {
    const { other, head } = conflictBranches();
    await expect(createGit(repo, "git").raw(["cherry-pick", other])).rejects.toThrow();
    const operation = (await loadOperation(createGit(repo, "git")))!;
    expect(operation.kind).toBe("cherry-pick");
    await run({ kind: "recover", operation, resolution });
    expect(await loadOperation(createGit(repo, "git"))).toBeNull();
    expect(read(["rev-parse", "HEAD"])).toBe(head);
  });

  it("detects and aborts a conflicted revert", async () => {
    const first = commit("f", "first");
    commit("f", "second");
    await expect(createGit(repo, "git").raw(["revert", first])).rejects.toThrow();
    const operation = (await loadOperation(createGit(repo, "git")))!;
    expect(operation.kind).toBe("revert");
    await run({ kind: "recover", operation, resolution: "abort" });
    expect(await loadOperation(createGit(repo, "git"))).toBeNull();
  });

  it.each(["abort", "skip", "continue"] as const)(
    "can %s a conflicted rebase",
    async (resolution) => {
      const { head, other } = conflictBranches();
      await expect(
        run({ kind: "rebase", branch: "main", onto: "other", expectedHead: head })
      ).rejects.toThrow();
      const operation = (await loadOperation(createGit(repo, "git")))!;
      expect(operation.kind).toBe("rebase");
      if (resolution === "continue") {
        fs.writeFileSync(path.join(repo, "f"), "resolved");
        await run({ kind: "conflict", path: "f", operation: "stage" });
      }
      await run({ kind: "recover", operation, resolution });
      expect(await loadOperation(createGit(repo, "git"))).toBeNull();
      if (resolution === "abort") {
        expect(read(["rev-parse", "HEAD"])).toBe(head);
      }
      if (resolution === "skip") {
        expect(read(["rev-parse", "HEAD"])).toBe(other);
      }
    }
  );

  it("rejects recovery for an operation that already ended", async () => {
    conflictBranches();
    // Git reports conflicts in the user's language; its exit status is the stable signal.
    expect(() => read(["merge", "other"])).toThrow();
    const operation = (await loadOperation(createGit(repo, "git")))!;
    await run({ kind: "recover", operation, resolution: "abort" });
    await expect(run({ kind: "recover", operation, resolution: "abort" })).rejects.toThrow(
      /changed/
    );
  });
});

it("stages only the selected conflict when its name contains pathspec patterns", async () => {
  commit("[ab].txt", "base");
  commit("a.txt", "unrelated original");
  read(["checkout", "-b", "other"]);
  commit("[ab].txt", "other");
  read(["checkout", "main"]);
  commit("[ab].txt", "main");
  expect(() => read(["merge", "other"])).toThrow();
  fs.writeFileSync(path.join(repo, "[ab].txt"), "resolved");
  fs.writeFileSync(path.join(repo, "a.txt"), "unrelated unstaged");

  await run({ kind: "conflict", path: "[ab].txt", operation: "stage" });

  expect(read(["diff", "--cached", "--name-only"])).toBe("[ab].txt");
  expect(read(["diff", "--name-only"])).toBe("a.txt");
  expect(read(["show", ":a.txt"])).toBe("unrelated original");
});

describe("interactive rebase", () => {
  it("reorders, rewords, squashes and drops commits without interpreting message text as code", async () => {
    const base = read(["rev-parse", "HEAD"]);
    for (const name of ["a", "b", "c", "d"]) {
      commit(name, name);
    }
    const plan = await loadRebasePlan(createGit(repo, "git"), base);
    const [a, b, c, d] = plan.entries;
    const message = "reworded `literal` $(text) 'quoted'\n\nDetailed message";
    plan.entries = [
      { ...b!, action: "reword", message },
      a!,
      { ...c!, action: "squash" },
      { ...d!, action: "drop" }
    ];
    await run({ kind: "interactiveRebase", plan });
    expect(read(["rev-list", "--count", `${base}..HEAD`])).toBe("2");
    expect(read(["log", "-1", "--format=%B", "HEAD^"])).toBe(message);
    expect(read(["log", "-1", "--format=%B"])).toContain("a\n\nc");
    expect(fs.existsSync(path.join(repo, "d"))).toBe(false);
    expect(fs.existsSync(path.join(repo, ".git", "branchwise-rebase"))).toBe(false);
  });

  it("refuses stale or invalid plans before rewriting history", async () => {
    const base = read(["rev-parse", "HEAD"]);
    commit("a", "a");
    const plan = await loadRebasePlan(createGit(repo, "git"), base);
    await expect(
      run({
        kind: "interactiveRebase",
        plan: { ...plan, entries: [{ ...plan.entries[0]!, action: "squash" }] }
      })
    ).rejects.toThrow(/first retained/);
    commit("b", "b");
    const head = read(["rev-parse", "HEAD"]);
    await expect(run({ kind: "interactiveRebase", plan })).rejects.toThrow(/branch changed/);
    expect(read(["rev-parse", "HEAD"])).toBe(head);
  });

  it("continues an interactive plan after a conflict and still applies later reword instructions", async () => {
    const base = read(["rev-parse", "HEAD"]);
    commit("f", "first");
    commit("f", "second");
    commit("later", "later");
    const plan = await loadRebasePlan(createGit(repo, "git"), base);
    const [a, b, c] = plan.entries;
    plan.entries = [
      { ...a!, action: "drop" },
      b!,
      { ...c!, action: "reword", message: "after recovery" }
    ];
    await expect(run({ kind: "interactiveRebase", plan })).rejects.toThrow();
    const operation = (await loadOperation(createGit(repo, "git")))!;
    fs.writeFileSync(path.join(repo, "f"), "second");
    await run({ kind: "conflict", path: "f", operation: "stage" });
    await run({ kind: "recover", operation, resolution: "continue" });
    expect(read(["log", "-1", "--format=%s"])).toBe("after recovery");
    expect(await loadOperation(createGit(repo, "git"))).toBeNull();
  });
});

describe("squashing selected commits", () => {
  /** The plan the graph asks for when squashing `hashes`, whose oldest has `base` as parent. */
  async function squashPlan(base: string, hashes: string[]) {
    const data = await repositoryQuery(createGit(repo, "git"), {
      kind: "rebasePlan",
      base,
      squash: hashes
    });
    if (data.kind !== "rebasePlan") {
      throw new Error("No plan");
    }
    return data.plan;
  }

  it("squashes a run in the middle and picks the commits after it", async () => {
    const base = commit("base", "base");
    const a = commit("a", "a");
    const b = commit("b", "b");
    const c = commit("c", "c");
    const later = commit("later", "later");
    const plan = await squashPlan(base, [c, a, b]);
    expect(plan.base).toBe(base);
    expect(plan.entries.map(({ hash, action }) => [hash, action])).toEqual([
      [a, "pick"],
      [b, "squash"],
      [c, "squash"],
      [later, "pick"]
    ]);
    // Nothing is rewritten until the plan is submitted.
    expect(read(["rev-parse", "HEAD"])).toBe(later);

    const tree = read(["rev-parse", "HEAD^{tree}"]);
    await run({ kind: "interactiveRebase", plan });
    expect(read(["log", "--reverse", "--format=%s", `${base}..HEAD`])).toBe("a\nlater");
    expect(read(["log", "-1", "--format=%B", "HEAD^"])).toBe("a\n\nb\n\nc");
    expect(read(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD^"])).toBe("a\nb\nc");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
  });

  it("squashes a run that ends at HEAD", async () => {
    const base = read(["rev-parse", "HEAD"]);
    const a = commit("a", "a");
    const b = commit("b", "b");
    const plan = await squashPlan(base, [a, b]);
    expect(plan.entries.map((entry) => entry.action)).toEqual(["pick", "squash"]);
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    await run({ kind: "interactiveRebase", plan });
    expect(read(["rev-parse", "HEAD^"])).toBe(base);
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
    expect(read(["log", "-1", "--format=%B"])).toBe("a\n\nb");
  });

  it("refuses the root commit, which has no parent to rebase onto", async () => {
    const root = read(["rev-parse", "HEAD"]);
    const a = commit("a", "a");
    await expect(squashPlan(root, [root, a])).rejects.toThrow(/current branch/);
  });

  it("builds the plan with uncommitted changes but refuses to start, as interactive rebase does", async () => {
    const base = read(["rev-parse", "HEAD"]);
    const a = commit("a", "a");
    const b = commit("b", "b");
    fs.writeFileSync(path.join(repo, "a"), "uncommitted");
    const plan = await squashPlan(base, [a, b]);
    await expect(run({ kind: "interactiveRebase", plan })).rejects.toThrow(/Commit or stash/);
    expect(read(["rev-parse", "HEAD"])).toBe(b);
    expect(fs.readFileSync(path.join(repo, "a"), "utf8")).toBe("uncommitted");
  });

  it("refuses commits from another branch", async () => {
    const base = read(["rev-parse", "HEAD"]);
    read(["checkout", "-b", "other"]);
    const other = commit("other", "other");
    read(["checkout", "main"]);
    const a = commit("a", "a");
    const b = commit("b", "b");
    await expect(squashPlan(base, [a, other])).rejects.toThrow(/current branch/);
    // Branches merged into the current one are refused too: their range is not linear.
    read(["merge", "--no-ff", "-m", "merge", "other"]);
    await expect(squashPlan(base, [a, b])).rejects.toThrow(/merge commits/);
  });

  it("needs at least two consecutive commits", async () => {
    const base = read(["rev-parse", "HEAD"]);
    const a = commit("a", "a");
    commit("b", "b");
    const c = commit("c", "c");
    await expect(squashPlan(base, [a])).rejects.toThrow(/at least two/);
    await expect(squashPlan(base, [a, a])).rejects.toThrow(/at least two/);
    await expect(squashPlan(base, [a, c])).rejects.toThrow(/consecutive/);
  });
});

describe("worktrees", () => {
  it("creates and opens a linked worktree, reports occupancy, and removes only clean worktrees", async () => {
    const folder = path.join(
      directory(),
      process.platform === "win32" ? "work tree with spaces" : "work tree\nwith newline"
    );
    await run({
      kind: "addWorktree",
      path: folder,
      branch: "feature/worktree",
      newBranch: true,
      startPoint: "HEAD"
    });
    const entry = (await loadWorktrees(createGit(repo, "git"))).find(
      (item) => item.branch === "feature/worktree"
    )!;
    expect(entry.path).toBe(normalizeRepoPath(folder));
    expect(await run({ kind: "openWorktree", path: folder })).toEqual({
      kind: "worktree",
      path: normalizeRepoPath(folder)
    });
    const second = path.join(directory(), "second");
    await expect(
      run({
        kind: "addWorktree",
        path: second,
        branch: "feature/worktree",
        newBranch: false,
        startPoint: ""
      })
    ).rejects.toThrow();
    expect(fs.existsSync(second)).toBe(false);
    fs.writeFileSync(path.join(folder, "untracked"), "keep me");
    await expect(
      run({ kind: "removeWorktree", path: folder, expectedHead: entry.head })
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(folder, "untracked"))).toBe(true);
    fs.unlinkSync(path.join(folder, "untracked"));
    await run({ kind: "removeWorktree", path: folder, expectedHead: entry.head });
    expect(fs.existsSync(folder)).toBe(false);
    expect(read(["branch", "--no-color", "--list", "feature/worktree"])).toBe("feature/worktree");
  });

  it("detects operations inside linked worktrees using their own Git directory", async () => {
    conflictBranches();
    const folder = path.join(directory(), "linked");
    await run({
      kind: "addWorktree",
      path: folder,
      branch: "linked",
      newBranch: true,
      startPoint: "main"
    });
    expect(() => read(["merge", "other"], folder)).toThrow();
    const operation = (await loadOperation(createGit(folder, "git")))!;
    expect(operation.kind).toBe("merge");
    expect(await loadOperation(createGit(repo, "git"))).toBeNull();
    await runRepositoryAction(createGit(folder, "git"), {
      kind: "recover",
      operation,
      resolution: "abort"
    });
    expect(await loadOperation(createGit(folder, "git"))).toBeNull();
  });
});
