import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";
import type { BulkSyncPlan } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

// One shared remote, as several clones of a project in a workspace would have.
let folder: string;
let origin: string;
beforeEach(() => {
  folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bw-bulk-")));
  const seed = makeRepo();
  git(["clone", "-q", "--bare", seed, "origin.git"], folder);
  fs.rmSync(seed, { recursive: true, force: true });
  origin = path.join(folder, "origin.git");
});
afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function clone(name: string) {
  git(["clone", "-q", "origin.git", name], folder);
  const dir = path.join(folder, name);
  git(["config", "user.name", "T"], dir);
  git(["config", "user.email", "t@t.com"], dir);
  return dir;
}
function commit(dir: string, file: string, content: string) {
  fs.writeFileSync(path.join(dir, file), content);
  git(["add", "--", file], dir);
  git(["commit", "-q", "-m", content], dir);
  return gitOutput(["rev-parse", "HEAD"], dir);
}
let published = 0;
/** Another clone publishes a commit to `branch` of the shared remote. */
function publish(branch = "main") {
  published++;
  const peer = clone(`peer-${published}`);
  git(["checkout", "-q", "-B", branch, `origin/${branch}`], peer);
  const hash = commit(peer, "incoming", `incoming ${published} on ${branch}`);
  git(["push", "-q", "origin", branch], peer);
  return hash;
}
async function plan(dir: string, operation: "pull" | "push"): Promise<BulkSyncPlan> {
  const data = await repositoryQuery(createGit(dir, "git"), { kind: "bulkSyncPlan", operation });
  expect(data.kind).toBe("bulkSyncPlan");
  return (data as { plan: BulkSyncPlan }).plan;
}
/** Run every sync of a plan as the page does: one reviewed sync per branch, never forced. */
async function apply(dir: string, bulk: BulkSyncPlan) {
  for (const sync of bulk.syncs) {
    // eslint-disable-next-line no-await-in-loop
    await runRepositoryAction(createGit(dir, "git"), {
      kind: "sync",
      operation: bulk.operation,
      plan: sync,
      force: false,
      setUpstream: false
    });
  }
}
/** Every ref, the work tree and index, and the stashes. */
const snapshot = (dir: string) => [
  gitOutput(["for-each-ref"], dir),
  gitOutput(["status", "--porcelain=v2", "--branch"], dir),
  gitOutput(["stash", "list"], dir)
];

describe("pulling across the workspace", () => {
  it("fast-forwards only the clean branch that is strictly behind, and leaves the rest alone", async () => {
    const behind = clone("behind");
    const dirty = clone("dirty");
    const diverged = clone("diverged");
    const current = clone("current");
    const incoming = publish();
    git(["pull", "-q", "--ff-only"], current);
    fs.writeFileSync(path.join(dirty, "f"), "uncommitted");
    commit(diverged, "local", "local work");
    for (const dir of [behind, dirty, diverged]) {
      git(["fetch", "-q", "origin"], dir);
    }
    const before = [dirty, diverged, current].map(snapshot);
    const plans = await Promise.all(
      [behind, dirty, diverged, current].map((dir) => plan(dir, "pull"))
    );
    expect(plans.map(({ syncs, skipped }) => [syncs.length, skipped])).toStrictEqual([
      [1, []],
      [0, [{ branch: "main", reason: "uncommitted" }]],
      [0, [{ branch: "main", reason: "diverged" }]],
      [0, [{ branch: "main", reason: "upToDate" }]]
    ]);
    expect(plans[0]!.syncs[0]).toMatchObject({
      branch: "main",
      remote: "origin",
      remoteBranch: "main",
      remoteHead: incoming,
      canFastForward: true
    });

    for (const [index, dir] of [behind, dirty, diverged, current].entries()) {
      // eslint-disable-next-line no-await-in-loop
      await apply(dir, plans[index]!);
    }
    expect(gitOutput(["rev-parse", "HEAD"], behind)).toBe(incoming);
    expect(gitOutput(["status", "--porcelain"], behind)).toBe("");
    expect([dirty, diverged, current].map(snapshot)).toStrictEqual(before);
  });

  it("reads plans without changing anything, and pulls only what was fetched", async () => {
    const behind = clone("behind");
    const incoming = publish();
    git(["fetch", "-q", "origin"], behind);
    publish();
    const before = snapshot(behind);
    const bulk = await plan(behind, "pull");
    expect(snapshot(behind)).toStrictEqual(before);
    await apply(behind, bulk);
    expect(gitOutput(["rev-parse", "HEAD"], behind)).toBe(incoming);
  });

  it("skips a repository mid-operation, with HEAD detached, or without an upstream", async () => {
    const stopped = clone("stopped");
    const detached = clone("detached");
    const unpublished = clone("unpublished");
    publish();
    for (const dir of [stopped, detached, unpublished]) {
      git(["fetch", "-q", "origin"], dir);
    }
    git(["checkout", "-q", "-b", "clash"], stopped);
    commit(stopped, "f", "theirs");
    git(["checkout", "-q", "main"], stopped);
    commit(stopped, "f", "ours");
    expect(() => git(["merge", "-q", "clash"], stopped)).toThrow();
    git(["checkout", "-q", "--detach"], detached);
    git(["checkout", "-q", "-b", "local-only"], unpublished);
    const before = [stopped, detached, unpublished].map(snapshot);
    const plans = await Promise.all(
      [stopped, detached, unpublished].map((dir) => plan(dir, "pull"))
    );
    expect(plans.map((item) => [item.syncs, item.skipped])).toStrictEqual([
      [[], [{ branch: "main", reason: "operation" }]],
      [[], [{ branch: "", reason: "detached" }]],
      [[], [{ branch: "local-only", reason: "noUpstream" }]]
    ]);
    expect([stopped, detached, unpublished].map(snapshot)).toStrictEqual(before);
  });

  it("refuses a reviewed pull once the work tree has changed, and moves nothing", async () => {
    const behind = clone("behind");
    publish();
    git(["fetch", "-q", "origin"], behind);
    const bulk = await plan(behind, "pull");
    fs.writeFileSync(path.join(behind, "f"), "edited after the review");
    const before = snapshot(behind);
    await expect(apply(behind, bulk)).rejects.toThrow("Commit or stash your changes");
    expect(snapshot(behind)).toStrictEqual(before);
  });
});

describe("pushing across the workspace", () => {
  it("pushes every branch strictly ahead of its upstream, and skips the others", async () => {
    const dir = clone("work");
    git(["push", "-q", "origin", "main:topic", "main:stale", "main:gone"], dir);
    git(["fetch", "-q", "origin"], dir);
    for (const name of ["topic", "stale", "gone"]) {
      git(["branch", "-q", "--track", name, `origin/${name}`], dir);
    }
    const mainHead = commit(dir, "f", "main work");
    git(["checkout", "-q", "topic"], dir);
    const topicHead = commit(dir, "f", "topic work");
    git(["checkout", "-q", "stale"], dir);
    commit(dir, "f", "stale work");
    git(["checkout", "-q", "-b", "local-only"], dir);
    commit(dir, "f", "unpublished work");
    git(["checkout", "-q", "main"], dir);
    publish("stale");
    git(["push", "-q", "origin", "--delete", "gone"], dir);
    git(["fetch", "-q", "--prune", "origin"], dir);

    const bulk = await plan(dir, "push");
    expect(bulk.syncs.map((sync) => [sync.branch, sync.remoteBranch, sync.local])).toStrictEqual([
      ["main", "main", mainHead],
      ["topic", "topic", topicHead]
    ]);
    expect(bulk.skipped).toStrictEqual([
      { branch: "gone", reason: "upstreamGone" },
      { branch: "stale", reason: "diverged" }
    ]);
    const remoteBefore = gitOutput(["for-each-ref", "refs/heads/stale"], origin);
    await apply(dir, bulk);
    expect(gitOutput(["rev-parse", "main", "topic"], origin).split("\n")).toStrictEqual([
      mainHead,
      topicHead
    ]);
    // Nothing forced, nothing recreated, nothing published that had no upstream.
    expect(gitOutput(["for-each-ref", "refs/heads/stale"], origin)).toBe(remoteBefore);
    expect(gitOutput(["for-each-ref", "refs/heads/gone", "refs/heads/local-only"], origin)).toBe(
      ""
    );
  });

  it("skips a repository whose branches have no upstream, and changes nothing there", async () => {
    const lone = makeRepo();
    try {
      git(["remote", "add", "origin", origin], lone);
      commit(lone, "f", "never published");
      const before = snapshot(lone);
      const remoteBefore = gitOutput(["for-each-ref"], origin);
      const bulk = await plan(lone, "push");
      expect(bulk).toStrictEqual({
        operation: "push",
        syncs: [],
        skipped: [{ branch: "main", reason: "noUpstream" }]
      });
      await apply(lone, bulk);
      expect(snapshot(lone)).toStrictEqual(before);
      expect(gitOutput(["for-each-ref"], origin)).toBe(remoteBefore);
    } finally {
      fs.rmSync(lone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("reports a repository with nothing to push, and skips one mid-operation", async () => {
    const level = clone("level");
    const stopped = clone("stopped");
    commit(stopped, "f", "ahead");
    git(["checkout", "-q", "-b", "clash", "HEAD~1"], stopped);
    commit(stopped, "f", "theirs");
    git(["checkout", "-q", "main"], stopped);
    expect(() => git(["merge", "-q", "clash"], stopped)).toThrow();
    expect((await plan(level, "push")).skipped).toStrictEqual([
      { branch: "main", reason: "upToDate" }
    ]);
    expect(await plan(stopped, "push")).toStrictEqual({
      operation: "push",
      syncs: [],
      skipped: [{ branch: "main", reason: "operation" }]
    });
  });
});
