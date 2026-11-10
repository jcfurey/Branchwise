import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadBatchPlan } from "@/backend/queries/history";
import { loadOperation, loadWorktrees } from "@/backend/queries/repository";
import type { RepositoryAction } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

// Actions that must refuse, or hold back, rather than lose work nobody asked them to touch.

let repo = "";
let dirs: string[];
const read = (args: string[], cwd = repo) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const git = () => createGit(repo, "git");
const run = (action: RepositoryAction) => runRepositoryAction(git(), action, "git");
function directory() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-guard-")));
  dirs.push(dir);
  return dir;
}
function commit(file: string, value: string, cwd = repo) {
  fs.writeFileSync(path.join(cwd, file), value);
  read(["add", "--", file], cwd);
  read(["commit", "-q", "-m", value], cwd);
  return read(["rev-parse", "HEAD"], cwd);
}

beforeEach(() => {
  repo = makeRepo();
  dirs = [repo];
  read(["config", "rerere.enabled", "false"]);
});
afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("rebasing a branch", () => {
  it("moves only the checked-out branch, whatever rebase.updateRefs asks", async () => {
    read(["checkout", "-q", "-b", "topic"]);
    const first = commit("a", "topic one");
    read(["branch", "mid"]);
    const head = commit("b", "topic two");
    read(["checkout", "-q", "main"]);
    commit("c", "main one");
    read(["checkout", "-q", "topic"]);
    read(["config", "rebase.updateRefs", "true"]);

    await run({ kind: "rebase", branch: "topic", onto: "main", expectedHead: head });

    expect(read(["merge-base", "--is-ancestor", "main", "topic"])).toBe("");
    // Git 2.38 and later would have carried `mid` along, a move the Safety Net never recorded.
    expect(read(["rev-parse", "mid"])).toBe(first);
  });

  it("leaves other branches alone in an interactive rebase too", async () => {
    read(["checkout", "-q", "-b", "topic"]);
    const base = read(["rev-parse", "HEAD"]);
    const first = commit("a", "topic one");
    read(["branch", "mid"]);
    commit("b", "topic two");
    read(["config", "rebase.updateRefs", "true"]);
    const plan = await (await import("@/backend/queries/repository")).loadRebasePlan(git(), base);
    plan.entries[0]!.action = "reword";
    plan.entries[0]!.message = "topic one, reworded";

    await run({ kind: "interactiveRebase", plan });

    expect(read(["log", "--format=%s", "-2"])).toBe("topic two\ntopic one, reworded");
    expect(read(["rev-parse", "mid"])).toBe(first);
  });
});

describe("applying several commits", () => {
  it("refuses a mainline that some selected commit has no parent for, before applying any", async () => {
    read(["checkout", "-q", "-b", "source"]);
    const plain = commit("plain", "plain commit");
    read(["checkout", "-q", "-b", "side", "main"]);
    commit("side", "side commit");
    read(["checkout", "-q", "source"]);
    read(["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    const merge = read(["rev-parse", "HEAD"]);
    read(["checkout", "-q", "main"]);
    const head = read(["rev-parse", "HEAD"]);
    const plan = await loadBatchPlan(git(), [plain, merge]);

    // The second parent exists for the merge only. Git would pick nothing and stop on the plain
    // commit, or with the merge first apply it and then stop, half way through.
    await expect(
      run({ kind: "batch", operation: "cherry-pick", plan, mainline: 2 })
    ).rejects.toThrow(/mainline/i);
    expect(read(["rev-parse", "HEAD"])).toBe(head);
    expect(await loadOperation(git())).toBeNull();

    const reversed = await loadBatchPlan(git(), [merge, plain]);
    await expect(
      run({ kind: "batch", operation: "cherry-pick", plan: reversed, mainline: 2 })
    ).rejects.toThrow(/mainline/i);
    expect(read(["rev-parse", "HEAD"])).toBe(head);
    expect(await loadOperation(git())).toBeNull();

    // The first parent is one every commit has.
    await run({ kind: "batch", operation: "cherry-pick", plan, mainline: 1 });
    expect(read(["log", "--format=%s", "-2"])).toBe("merge side\nplain commit");
  });
});

describe("deleting a remote branch", () => {
  function shared() {
    const bare = directory();
    read(["init", "-q", "--bare", "--initial-branch=main", bare]);
    read(["remote", "add", "origin", bare]);
    read(["checkout", "-q", "-b", "topic"]);
    commit("t", "topic work");
    read(["push", "-q", "origin", "main", "topic"]);
    read(["checkout", "-q", "main"]);
    return bare;
  }

  it("holds back when the branch has commits on the remote that were never fetched", async () => {
    const bare = shared();
    const peer = directory();
    read(["clone", "-q", "--branch", "topic", bare, peer]);
    read(["config", "user.name", "P"], peer);
    read(["config", "user.email", "p@p.com"], peer);
    const theirs = commit("theirs", "a colleague's commit", peer);
    read(["push", "-q", "origin", "topic"], peer);

    await expect(
      run({ kind: "deleteRemoteRef", remote: "origin", name: "topic", refType: "branch" })
    ).rejects.toThrow(/fetch/i);
    expect(read(["rev-parse", "refs/heads/topic"], bare)).toBe(theirs);

    // Once fetched, the user has seen what the branch holds, and it goes.
    read(["fetch", "-q", "origin"]);
    await run({ kind: "deleteRemoteRef", remote: "origin", name: "topic", refType: "branch" });
    expect(read(["for-each-ref", "refs/heads/topic"], bare)).toBe("");
  });

  it("deletes a branch it has no remote-tracking branch for, and tags, as before", async () => {
    const bare = shared();
    read(["tag", "v1"]);
    read(["push", "-q", "origin", "v1"]);
    read(["update-ref", "-d", "refs/remotes/origin/topic"]);

    await run({ kind: "deleteRemoteRef", remote: "origin", name: "topic", refType: "branch" });
    await run({ kind: "deleteRemoteRef", remote: "origin", name: "v1", refType: "tag" });

    expect(read(["for-each-ref", "refs/heads/topic", "refs/tags/v1"], bare)).toBe("");
  });
});

describe("removing a worktree", () => {
  async function linked() {
    const folder = path.join(directory(), "linked");
    read(["worktree", "add", "-q", "--detach", folder, "main"]);
    const entry = (await loadWorktrees(git())).find((item) => item.path.endsWith("linked"))!;
    return { folder, path: entry.path };
  }

  it("refuses while its detached HEAD holds commits that nothing else keeps", async () => {
    const { folder, path: listed } = await linked();
    read(["config", "user.name", "T"], folder);
    const lonely = commit("experiment", "work on no branch", folder);

    await expect(
      run({ kind: "removeWorktree", path: listed, expectedHead: lonely })
    ).rejects.toThrow(/branch/i);
    expect(fs.existsSync(folder)).toBe(true);

    // A branch keeps the commits, and then the worktree can go.
    read(["branch", "kept", lonely]);
    await run({ kind: "removeWorktree", path: listed, expectedHead: lonely });
    expect(fs.existsSync(folder)).toBe(false);
    expect(read(["rev-parse", "kept"])).toBe(lonely);
  });

  it("removes a detached worktree whose commit a branch, a tag or a remote branch has", async () => {
    const { folder, path: listed } = await linked();

    await run({
      kind: "removeWorktree",
      path: listed,
      expectedHead: read(["rev-parse", "main"])
    });

    expect(fs.existsSync(folder)).toBe(false);
  });
});
