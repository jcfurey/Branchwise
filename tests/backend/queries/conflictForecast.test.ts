import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const forecast = async () => {
  const result = await repositoryQuery(createGit(repo, "git"), { kind: "conflictForecast" });
  return result.kind === "conflictForecast" ? result.conflicts : null;
};
const commitFiles = (message: string, files: Record<string, string>) => {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(repo, name), content);
  }
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", message], repo);
};
const status = () => gitOutput(["status", "--porcelain"], repo);
const refs = () => gitOutput(["for-each-ref"], repo);

it("names the branches that would conflict with HEAD, and their conflicted files", async () => {
  git(["checkout", "-q", "-b", "clash"], repo);
  commitFiles("clash", { f: "clash\n", "a b.txt": "theirs\n" });
  git(["checkout", "-q", "-b", "clean", "main"], repo);
  commitFiles("clean", { g: "new\n" });
  git(["checkout", "-q", "-b", "merged", "main"], repo);
  git(["checkout", "-q", "main"], repo);
  commitFiles("main", { f: "main\n", "a b.txt": "ours\n" });
  writeFileSync(path.join(repo, "untracked"), "left alone\n");
  const before = [status(), refs()];

  expect(await forecast()).toEqual([{ branch: "clash", files: ["a b.txt", "f"] }]);
  // Nothing on disk or among the refs changed.
  expect([status(), refs()]).toEqual(before);
});

it("leaves out HEAD's own branch, merged branches, and branches with unrelated history", async () => {
  git(["checkout", "-q", "--orphan", "lone"], repo);
  commitFiles("lone", { f: "unrelated\n" });
  git(["checkout", "-q", "-b", "behind", "main"], repo);
  git(["checkout", "-q", "main"], repo);
  commitFiles("main", { f: "main\n" });
  expect(await forecast()).toEqual([]);
});

it("reports nothing on a branch without commits, or while a merge is under way", async () => {
  git(["checkout", "-q", "-b", "clash"], repo);
  commitFiles("clash", { f: "clash\n" });
  git(["checkout", "-q", "main"], repo);
  commitFiles("main", { f: "main\n" });
  expect(await forecast()).toHaveLength(1);

  expect(() => git(["merge", "-q", "clash"], repo)).toThrow();
  expect(await forecast()).toEqual([]);
  git(["merge", "--abort"], repo);

  git(["checkout", "-q", "--orphan", "empty"], repo);
  expect(await forecast()).toEqual([]);
});

describe("a request cancelled part way", () => {
  /**
   * The module afresh, with nothing remembered from other tests, and the Git client module it
   * reads cancellation from. `cancelledAt(trigger)` is a client that cancels its own request
   * when it is about to run Git with `trigger`.
   */
  const freshModule = async () => {
    vi.resetModules();
    const [{ loadConflictForecast }, { createGit: freshGit }] = await Promise.all([
      import("@/backend/queries/conflictForecast"),
      import("@/backend/gitClient")
    ]);
    const cancelledAt = (trigger: string) => {
      const controller = new AbortController();
      const client = freshGit(repo, "git", controller.signal);
      const raw = client.raw.bind(client);
      client.raw = ((args: string[]) => {
        if (args.includes(trigger)) {
          controller.abort();
        }
        return raw(args);
      }) as typeof client.raw;
      return client;
    };
    return { loadConflictForecast, cancelledAt, plain: () => freshGit(repo, "git") };
  };

  beforeEach(() => {
    git(["checkout", "-q", "-b", "clash"], repo);
    commitFiles("clash", { f: "clash\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { f: "main\n" });
  });

  it.each([
    ["the Git version check", "--version"],
    ["a merge", "--show-toplevel"]
  ])("in %s leaves nothing behind for the next request", async (_, trigger) => {
    const { loadConflictForecast, cancelledAt, plain } = await freshModule();
    await expect(loadConflictForecast(cancelledAt(trigger))).rejects.toThrow();
    expect(await loadConflictForecast(plain())).toEqual([{ branch: "clash", files: ["f"] }]);
  });
});
