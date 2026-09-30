import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

import { afterEach, expect, it, vi } from "vitest";

import { manageRemote } from "@/backend/actions/remotes";
import { createGit } from "@/backend/gitClient";
import { loadBatchPlan } from "@/backend/queries/history";
import { loadRebasePlan } from "@/backend/queries/repository";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

/**
 * Add empty commits with these messages to the current branch in one Git process, and return
 * their hashes oldest first. A process per commit takes about 40 seconds for 500 on Windows.
 */
function emptyCommits(messages: string[]): string[] {
  const branch = gitOutput(["symbolic-ref", "HEAD"], repo);
  const base = gitOutput(["rev-parse", "HEAD"], repo);
  const stream = messages
    .map((message, i) => {
      const data = Buffer.from(message);
      return [
        `commit ${branch}`,
        `committer T <t@t.com> ${1_700_000_000 + i} +0000`,
        `data ${data.length}`,
        data.toString(),
        ...(i === 0 ? [`from ${base}`] : []),
        ""
      ].join("\n");
    })
    .join("\n");
  execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, input: stream });
  git(["reset", "-q", "--hard"], repo);
  return gitOutput(["rev-list", "--reverse", `${base}..HEAD`], repo).split("\n");
}

/** A client that counts the Git processes simple-git starts. */
function countingClient() {
  const client = createGit(repo, "git");
  const raw = vi.spyOn(client, "raw");
  const getConfig = vi.spyOn(client, "getConfig");
  const getRemotes = vi.spyOn(client, "getRemotes");
  return {
    client,
    processes: () =>
      raw.mock.calls.length + getConfig.mock.calls.length + getRemotes.mock.calls.length
  };
}

it("renames a remote with 1,000 branches in a few Git processes", async () => {
  repo = makeRepo();
  git(["remote", "add", "origin", "."], repo);
  const head = gitOutput(["rev-parse", "HEAD"], repo);
  execFileSync("git", ["update-ref", "--stdin"], {
    cwd: repo,
    input: Array.from({ length: 1000 }, (_, i) => `create refs/heads/branch-${i} ${head}\n`).join(
      ""
    )
  });
  git(["config", "remote.pushDefault", "origin"], repo);
  git(["config", "branch.branch-7.pushRemote", "origin"], repo);
  git(["config", "branch.Branch.Case.pushRemote", "origin"], repo);
  git(["config", "branch.branch-8.pushRemote", "other"], repo);

  const { client, processes } = countingClient();
  const started = performance.now();
  await manageRemote(client, { kind: "renameRemote", name: "origin", newName: "upstream" });
  const elapsed = performance.now() - started;

  expect(gitOutput(["config", "remote.pushDefault"], repo)).toBe("upstream");
  expect(gitOutput(["config", "branch.branch-7.pushRemote"], repo)).toBe("upstream");
  expect(gitOutput(["config", "branch.Branch.Case.pushRemote"], repo)).toBe("upstream");
  expect(gitOutput(["config", "branch.branch-8.pushRemote"], repo)).toBe("other");
  expect(processes()).toBeLessThan(20);
  if (process.platform === "linux") {
    expect(elapsed).toBeLessThan(1000);
  }
});

it("reads a 500-commit rebase plan with its messages in one log", async () => {
  repo = makeRepo();
  const base = gitOutput(["rev-parse", "HEAD"], repo);
  const hashes = emptyCommits(
    Array.from({ length: 500 }, (_, i) => `commit ${i}\n\nbody ${i}\n\ttabbed\n`)
  );
  const { client, processes } = countingClient();
  const plan = await loadRebasePlan(client, base);
  expect(plan.entries).toHaveLength(500);
  expect(plan.entries[0]).toMatchObject({
    action: "pick",
    message: "commit 0\n\nbody 0\n\ttabbed"
  });
  expect(plan.entries.map((entry) => entry.hash)).toEqual(hashes);
  expect(processes()).toBeLessThan(10);
});

it("reads a batch plan in the order given, in one log", async () => {
  repo = makeRepo();
  const hashes = emptyCommits(Array.from({ length: 50 }, (_, i) => `batch ${i}\n`));
  const order = [hashes[3]!, hashes[40]!, hashes[0]!, ...hashes.slice(10, 20)];
  const { client, processes } = countingClient();
  const plan = await loadBatchPlan(client, order);
  expect(plan.entries.map((entry) => entry.hash)).toEqual(order);
  expect(plan.entries[1]).toMatchObject({ message: "batch 40" });
  expect(processes()).toBeLessThan(10);
  await expect(loadBatchPlan(client, [hashes[0]!, "f".repeat(40)])).rejects.toThrow();
});
