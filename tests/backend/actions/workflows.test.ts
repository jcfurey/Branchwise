import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit, gitClientFactory } from "@/backend/gitClient";
import { bisectResult, loadBisect } from "@/backend/queries/bisect";
import { repositoryQuery } from "@/backend/queries/repository";
import {
  loadCleanupPlan,
  loadSubmodulePlan,
  loadSyncPlan,
  loadUpstreamPlan,
  submoduleComparison
} from "@/backend/queries/workflows";
import { loadWorkspace } from "@/backend/queries/workspace";
import type { RepositoryAction } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

// The running test's own repository, as `makeRepo` gave it; the `beforeEach` below sets it anew.
let repo = "";
let dirs: string[];
const git = () => createGit(repo, "git");
const read = (args: string[], cwd = repo) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const run = (action: RepositoryAction) => runRepositoryAction(git(), action);
function commit(message: string, cwd = repo) {
  read(["commit", "--allow-empty", "-m", message], cwd);
  return read(["rev-parse", "HEAD"], cwd);
}
function anotherRepo() {
  const dir = makeRepo();
  dirs.push(dir);
  return dir;
}
beforeEach(() => {
  repo = makeRepo();
  dirs = [repo];
});
afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("submodule pointer review", () => {
  it("compares child contributions and stages/unstages only the parent gitlink", async () => {
    const child = anotherRepo();
    read(["-c", "protocol.file.allow=always", "submodule", "add", child, "module"]);
    read(["commit", "-am", "add module"]);
    const module = path.join(repo, "module");
    read(["config", "user.name", "Test"], module);
    read(["config", "user.email", "t@t"], module);
    const latest = commit("child change", module);
    fs.writeFileSync(path.join(repo, "other"), "unrelated staged change");
    read(["add", "other"]);
    const { plan, comparison } = await submoduleComparison(git(), "module", false, "git");
    expect(comparison?.rightOnly.entries.map((entry) => entry.hash)).toEqual([latest]);
    await run({ kind: "submodulePointer", operation: "stage", plan });
    const staged = await loadSubmodulePlan(git(), "module", "git");
    expect(staged.recorded).toBe(latest);
    expect(
      (await submoduleComparison(git(), "module", true, "git")).comparison?.rightOnly.entries[0]
        ?.hash
    ).toBe(latest);
    const entries = await loadWorkspace([repo], "git");
    expect(entries.find((entry) => entry.submodulePath === "module")?.committed).not.toBe(latest);
    await run({ kind: "submodulePointer", operation: "unstage", plan: staged });
    expect(read(["diff", "--cached", "--name-only"])).toBe("other");
    expect(read(["rev-parse", "HEAD"], module)).toBe(latest);
  });
  it("rejects a moved child and permits unstaging a newly added pointer", async () => {
    const child = anotherRepo();
    read(["-c", "protocol.file.allow=always", "submodule", "add", child, "module"]);
    const plan = await loadSubmodulePlan(git(), "module", "git");
    const module = path.join(repo, "module");
    read(["config", "user.name", "Test"], module);
    read(["config", "user.email", "t@t"], module);
    commit("moved", module);
    await expect(run({ kind: "submodulePointer", operation: "stage", plan })).rejects.toThrow(
      "changed"
    );
    await run({
      kind: "submodulePointer",
      operation: "unstage",
      plan: await loadSubmodulePlan(git(), "module", "git")
    });
    expect(read(["ls-files", "module"])).toBe("");
    expect(read(["diff", "--cached", "--name-only"])).toBe(".gitmodules");
  });
});

describe("synchronization previews", () => {
  async function remote() {
    const dest = anotherRepo();
    read(["remote", "add", "origin", dest]);
    await run({ kind: "fetch", remote: "origin" });
    read(["reset", "--hard", "origin/main"]);
    read(["branch", "--set-upstream-to=origin/main"]);
    return dest;
  }
  it("reviews incoming commits and applies exactly the fetched fast-forward", async () => {
    const dest = await remote();
    const incoming = commit("incoming", dest);
    await run({ kind: "fetch", remote: null });
    const plan = await loadUpstreamPlan(git());
    expect(plan.incoming.entries[0]?.hash).toBe(incoming);
    expect(plan.canFastForward).toBe(true);
    commit("newer unreviewed remote change", dest);
    await run({ kind: "sync", operation: "pull", plan, force: false, setUpstream: false });
    expect(read(["rev-parse", "HEAD"])).toBe(incoming);
  });
  it("rejects stale previews, divergence, dirty checkouts, and a branch occupied by another checkout", async () => {
    const dest = await remote();
    commit("incoming", dest);
    await run({ kind: "fetch", remote: null });
    const plan = await loadUpstreamPlan(git());
    fs.writeFileSync(path.join(repo, "f"), "dirty");
    await expect(
      run({ kind: "sync", operation: "pull", plan, force: false, setUpstream: false })
    ).rejects.toThrow("stash");
    read(["restore", "f"]);
    commit("outgoing");
    await expect(
      run({ kind: "sync", operation: "pull", plan, force: false, setUpstream: false })
    ).rejects.toThrow("changed");
    const diverged = await loadUpstreamPlan(git());
    expect(diverged.ahead).toBe(1);
    expect(diverged.behind).toBe(1);
    await expect(
      run({ kind: "sync", operation: "pull", plan: diverged, force: false, setUpstream: false })
    ).rejects.toThrow("fast-forwarded");
    read(["checkout", "-b", "different"]);
    await expect(
      run({ kind: "sync", operation: "pull", plan: diverged, force: false, setUpstream: false })
    ).rejects.toThrow("Check out");
  });
  it("previews a new remote branch and pushes its reviewed tip with tracking", async () => {
    const dest = await remote();
    commit("outgoing");
    const plan = await loadSyncPlan(git(), "main", "origin", "published");
    expect(plan.remoteHead).toBeNull();
    expect(plan.outgoing.entries[0]?.message).toBe("outgoing");
    await run({ kind: "sync", operation: "push", plan, force: false, setUpstream: true });
    expect(read(["rev-parse", "published"], dest)).toBe(plan.local);
    expect(read(["config", "branch.main.merge"])).toBe("refs/heads/published");
  });
  it("keeps force-with-lease protection against an unobserved remote change", async () => {
    const dest = await remote();
    read(["config", "receive.denyCurrentBranch", "ignore"], dest);
    commit("local change");
    const plan = await loadUpstreamPlan(git());
    const remoteHead = commit("remote change", dest);
    await expect(
      run({ kind: "sync", operation: "push", plan, force: true, setUpstream: false })
    ).rejects.toThrow();
    expect(read(["rev-parse", "HEAD"], dest)).toBe(remoteHead);
  });
});

describe("merged branch cleanup", () => {
  it("excludes protected, checked-out, and unmerged branches and validates the selected tips", async () => {
    read(["branch", "merged"]);
    read(["branch", "occupied"]);
    const worktree = path.join(anotherRepo(), "worktree");
    read(["worktree", "add", worktree, "occupied"]);
    read(["checkout", "-b", "unmerged"]);
    commit("keep me");
    read(["checkout", "main"]);
    const plan = await loadCleanupPlan(git());
    expect(plan.branches.map((item) => item.name)).toEqual(["merged"]);
    read(["config", "branch.merged.description", "remove with branch"]);
    await run({ kind: "cleanup", plan });
    expect(read(["branch", "--no-color", "--list", "merged"])).toBe("");
    expect(read(["branch", "--no-color", "--list", "unmerged"])).toContain("unmerged");
    read(["branch", "merged"]);
    const stale = await loadCleanupPlan(git());
    read(["branch", "-f", "merged", "unmerged"]);
    await expect(run({ kind: "cleanup", plan: stale })).rejects.toThrow("changed");
  });
});

describe("guided bisect", () => {
  it("recognizes current and older Git completion logs, including custom terms", () => {
    const hash = "a".repeat(40);
    expect(bisectResult(`# first bad commit: [${hash}] regression`, "bad")).toBe(hash);
    expect(bisectResult(`# first 'bad' commit: [${hash}] regression`, "bad")).toBe(hash);
    expect(bisectResult(`# first 'broken' commit: [${hash}] regression`, "broken")).toBe(hash);
    expect(bisectResult(`# possible first 'bad' commit: [${hash}] regression`, "bad")).toBeNull();
  });
  it("finds the first bad commit and restores the original branch after reset", async () => {
    const good = read(["rev-parse", "HEAD"]);
    const hashes = [good];
    for (let index = 1; index <= 8; index++) {
      hashes.push(commit("revision " + index));
    }
    await run({ kind: "bisectStart", good, bad: "HEAD", expectedHead: hashes[8]! });
    for (let step = 0; step < 5; step++) {
      // Each classification depends on Git's next checkout.
      // eslint-disable-next-line no-await-in-loop
      const state = await loadBisect(git());
      expect(state).not.toBeNull();
      if (state!.firstBad) {
        expect(state!.firstBad).toBe(hashes[4]);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await run({
        kind: "bisectMark",
        state: state!,
        mark: hashes.indexOf(state!.head) >= 4 ? "bad" : "good"
      });
    }
    const state = (await loadBisect(git()))!;
    expect(state.firstBad).toBe(hashes[4]);
    await expect(
      run({ kind: "saveStash", message: "blocked", includeUntracked: false })
    ).rejects.toThrow("bisect");
    await run({ kind: "bisectMark", state, mark: "reset" });
    expect(await loadBisect(git())).toBeNull();
    expect(read(["branch", "--show-current"])).toBe("main");
    expect(read(["rev-parse", "HEAD"])).toBe(hashes[8]);
  });
  it("rejects stale classifications and retains a skipped session for reset", async () => {
    const good = read(["rev-parse", "HEAD"]);
    commit("unknown");
    const bad = commit("bad");
    await run({ kind: "bisectStart", good, bad, expectedHead: bad });
    const state = (await loadBisect(git()))!;
    await run({ kind: "bisectMark", state, mark: "skip" });
    const skipped = (await loadBisect(git()))!;
    expect(skipped.skipped).toContain(state.head);
    expect(skipped.ambiguous).toBe(true);
    await expect(run({ kind: "bisectMark", state, mark: "bad" })).rejects.toThrow("changed");
    await run({ kind: "bisectMark", state: skipped, mark: "reset" });
    expect(read(["rev-parse", "HEAD"])).toBe(bad);
  });
});

it("cancels repository queries without affecting an independent Git client", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    repositoryQuery(gitClientFactory(repo, "git", controller.signal).getInstance(), {
      kind: "cleanupPlan"
    })
  ).rejects.toThrow();
  await expect(loadWorkspace([repo], "git", controller.signal)).rejects.toThrow();
  expect((await loadCleanupPlan(git())).base).toBe(read(["rev-parse", "HEAD"]));
});
