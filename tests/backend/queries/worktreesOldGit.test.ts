import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { makeRepo } from "@tests/backend/helpers";

let repo = "";
let outside = "";
const read = (args: string[], cwd = repo) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

beforeEach(() => {
  repo = makeRepo();
  outside = fs.realpathSync.native(fs.mkdtempSync(repo + "-trees-"));
});
afterEach(() => {
  for (const dir of [repo, outside]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/**
 * A client whose Git answers as 2.34 does: that version, and no `-z` for `worktree list`, which
 * came with 2.36. The modules are loaded afresh, since the version is asked once per executable.
 */
async function oldGit() {
  vi.resetModules();
  const { createGit } = await import("@/backend/gitClient");
  const queries = await import("@/backend/queries/repository");
  const { normalizeRepoPath } = await import("@/backend/utils/repoPath");
  const client = createGit(repo, "git");
  const raw = client.raw.bind(client);
  const asked: string[][] = [];
  client.raw = ((args: string[]) => {
    asked.push(args);
    if (args[0] === "--version") {
      return Promise.resolve("git version 2.34.1\n");
    }
    if (args[0] === "worktree" && args.includes("-z")) {
      return Promise.reject(new Error("error: unknown switch `z'"));
    }
    return raw(args);
  }) as typeof client.raw;
  return { client, asked, normalizeRepoPath, ...queries };
}

it("lists worktrees with a Git older than 2.36, and so reads the repository state", async () => {
  const branch = path.join(outside, "on a branch");
  const detached = path.join(outside, "detached");
  read(["worktree", "add", "-q", "-b", "side", branch]);
  read(["worktree", "add", "-q", "--detach", detached]);
  read(["worktree", "lock", detached]);
  const head = read(["rev-parse", "HEAD"]);
  const { client, asked, normalizeRepoPath, loadWorktrees, loadRepositoryState } = await oldGit();

  expect(await loadWorktrees(client)).toEqual([
    {
      path: normalizeRepoPath(repo),
      head,
      branch: "main",
      bare: false,
      locked: false,
      prunable: false
    },
    // Git lists the linked worktrees by their names.
    {
      path: normalizeRepoPath(detached),
      head,
      branch: "",
      bare: false,
      locked: true,
      prunable: false
    },
    {
      path: normalizeRepoPath(branch),
      head,
      branch: "side",
      bare: false,
      locked: false,
      prunable: false
    }
  ]);
  expect(asked.some((args) => args[0] === "worktree" && args.includes("-z"))).toBe(false);

  // The Branches pane, the status strip and Undo all hang on this read.
  const state = await loadRepositoryState(client);
  expect(state.head).toBe("main");
  expect(state.worktrees).toHaveLength(3);
});
