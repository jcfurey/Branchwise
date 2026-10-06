import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { loadWorkspace } from "@/backend/queries/workspace";
import type { WorkspaceEntry } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function repo() {
  const dir = makeRepo();
  dirs.push(dir);
  return dir;
}
function commit(dir: string, file: string, content: string) {
  fs.writeFileSync(path.join(dir, file), content);
  git(["add", "--", file], dir);
  git(["commit", "-q", "-m", `${file}: ${content}`], dir);
}
/** A repository cloned from a bare copy of a fresh one, with `main` tracking `origin/main`. */
function clone() {
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bw-status-")));
  dirs.push(folder);
  git(["clone", "-q", "--bare", repo(), "origin.git"], folder);
  git(["clone", "-q", "origin.git", "local"], folder);
  const dir = path.join(folder, "local");
  git(["config", "user.name", "T"], dir);
  git(["config", "user.email", "t@t.com"], dir);
  return dir;
}
async function status(dir: string): Promise<WorkspaceEntry> {
  const [entry] = await loadWorkspace([dir], "git");
  expect(entry?.error).toBeNull();
  return entry!;
}
/** Everything a read-only query must leave as it was. */
const snapshot = (dir: string) => [
  gitOutput(["status", "--porcelain=v2", "--branch"], dir),
  gitOutput(["for-each-ref"], dir),
  gitOutput(["stash", "list"], dir),
  fs.readdirSync(path.join(dir, ".git")).toSorted()
];

it("reports a clean repository with nothing waiting", async () => {
  const dir = clone();
  expect(await status(dir)).toMatchObject({
    branch: "main",
    operation: null,
    conflicts: 0,
    stashes: 0,
    detached: false,
    upstream: "origin/main",
    aheadBranches: 0,
    remotes: 1,
    // A clone fetches, but writes no FETCH_HEAD.
    fetched: null
  });
});

it("reports a merge stopped by conflicts, with its unmerged files", async () => {
  const dir = repo();
  git(["checkout", "-q", "-b", "clash"], dir);
  commit(dir, "f", "theirs\n");
  commit(dir, "g", "theirs\n");
  git(["checkout", "-q", "main"], dir);
  commit(dir, "f", "ours\n");
  commit(dir, "g", "ours\n");
  expect(() => git(["merge", "-q", "clash"], dir)).toThrow();
  const before = snapshot(dir);
  expect(await status(dir)).toMatchObject({ operation: "merge", conflicts: 2, dirty: 2 });
  expect(snapshot(dir)).toStrictEqual(before);
});

it("reports a rebase, a cherry-pick and a bisect stopped partway", async () => {
  const dir = repo();
  git(["checkout", "-q", "-b", "topic"], dir);
  commit(dir, "f", "topic\n");
  git(["checkout", "-q", "main"], dir);
  commit(dir, "f", "main\n");
  expect(() => git(["cherry-pick", "topic"], dir)).toThrow();
  expect((await status(dir)).operation).toBe("cherry-pick");
  git(["cherry-pick", "--abort"], dir);
  git(["checkout", "-q", "topic"], dir);
  expect(() => git(["rebase", "main"], dir)).toThrow();
  expect((await status(dir)).operation).toBe("rebase");
  git(["rebase", "--abort"], dir);
  git(["bisect", "start", "main", "main~1"], dir);
  expect(await status(dir)).toMatchObject({ operation: "bisect", conflicts: 0 });
  git(["bisect", "reset"], dir);
  expect((await status(dir)).operation).toBeNull();
});

it("counts stashes", async () => {
  const dir = repo();
  for (const content of ["one", "two", "three"]) {
    fs.writeFileSync(path.join(dir, "f"), content);
    git(["stash", "push", "-q", "-m", content], dir);
  }
  expect((await status(dir)).stashes).toBe(3);
  git(["stash", "drop", "-q"], dir);
  expect(await status(dir)).toMatchObject({ stashes: 2, dirty: 0 });
});

it("reports a detached HEAD, which has no branch and no upstream", async () => {
  const dir = clone();
  git(["checkout", "-q", "--detach"], dir);
  expect(await status(dir)).toMatchObject({ detached: true, branch: "", upstream: null });
});

it("reports a branch without an upstream in a repository with a remote", async () => {
  const dir = clone();
  git(["checkout", "-q", "-b", "local-only"], dir);
  commit(dir, "f", "unpublished\n");
  expect(await status(dir)).toMatchObject({
    branch: "local-only",
    upstream: null,
    remotes: 1,
    ahead: 0,
    aheadBranches: 0
  });
});

it("counts the other branches ahead of their upstream, but not the checked-out one", async () => {
  const dir = clone();
  commit(dir, "f", "main ahead\n");
  for (const name of ["one", "two", "level"]) {
    git(["branch", "-q", "--track", name, "origin/main"], dir);
  }
  for (const name of ["one", "two"]) {
    git(["checkout", "-q", name], dir);
    commit(dir, "f", `${name} ahead\n`);
  }
  // A branch without an upstream is unpublished, not ahead.
  git(["checkout", "-q", "-b", "untracked"], dir);
  git(["checkout", "-q", "main"], dir);
  expect(await status(dir)).toMatchObject({ ahead: 1, aheadBranches: 2 });
});

it("reports when the repository last fetched", async () => {
  const dir = clone();
  const now = Math.floor(Date.now() / 1000);
  git(["fetch", "-q", "origin"], dir);
  const fetched = (await status(dir)).fetched!;
  expect(Math.abs(fetched - now)).toBeLessThan(60);
  const threeDaysAgo = new Date((now - 3 * 86_400) * 1000);
  fs.utimesSync(path.join(dir, ".git", "FETCH_HEAD"), threeDaysAgo, threeDaysAgo);
  expect((await status(dir)).fetched).toBe(now - 3 * 86_400);
});

it("leaves every repository untouched while it reads them", async () => {
  const [stashed, detached] = [clone(), clone()];
  git(["checkout", "-q", "--detach"], detached);
  fs.writeFileSync(path.join(stashed, "f"), "stashed");
  git(["stash", "push", "-q"], stashed);
  fs.writeFileSync(path.join(stashed, "new"), "untracked");
  const before = [stashed, detached].map(snapshot);
  await loadWorkspace([stashed, detached], "git");
  expect([stashed, detached].map(snapshot)).toStrictEqual(before);
});

it("stops when cancelled partway, without starting the next repositories", async () => {
  const repos = [repo(), repo(), repo(), repo(), repo()];
  fs.writeFileSync(path.join(repos[0]!, "u"), "untracked");
  git(["stash", "push", "-q", "--include-untracked"], repos[0]!);
  const controller = new AbortController();
  const visited: string[] = [];
  // The module afresh, over a client factory that notes each repository it is asked for and
  // cancels the read the moment the first repository's stashes are counted.
  vi.resetModules();
  vi.doMock("@/backend/gitClient", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/backend/gitClient")>();
    return {
      ...actual,
      gitClientFactory: (...args: Parameters<typeof actual.gitClientFactory>) => {
        visited.push(args[0]);
        const factory = actual.gitClientFactory(...args);
        const client = factory.getInstance();
        const raw = client.raw.bind(client);
        client.raw = ((command: string[]) => {
          if (command.includes("--walk-reflogs")) {
            controller.abort();
          }
          return raw(command);
        }) as typeof client.raw;
        return { ...factory, getInstance: () => client };
      }
    };
  });
  try {
    const { loadWorkspace: cancellable } = await import("@/backend/queries/workspace");
    await expect(cancellable(repos, "git", controller.signal)).rejects.toThrow();
  } finally {
    vi.doUnmock("@/backend/gitClient");
    vi.resetModules();
  }
  expect(controller.signal.aborted).toBe(true);
  // The first four repositories form one batch; the fifth would have been read after it.
  expect(visited).toStrictEqual(repos.slice(0, 4));
});
