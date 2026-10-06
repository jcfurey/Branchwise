import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";
import type { ReplayForecastQuery } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const forecast = async (query: {
  mode: ReplayForecastQuery["mode"];
  onto: string;
  commits?: string[];
  mainline?: number;
}) => {
  const result = await repositoryQuery(createGit(repo, "git"), {
    kind: "replayForecast",
    ...query
  } as ReplayForecastQuery);
  return result.kind === "replayForecast" ? result.forecast : null;
};
const rebaseOnto = (onto: string) => forecast({ mode: "rebase", onto });
/** Commit `files` with `message` and return the new commit's ID. */
const commitFiles = (message: string, files: Record<string, string>) => {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(repo, name), content);
  }
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", message], repo);
  return head();
};
const head = () => gitOutput(["rev-parse", "HEAD"], repo);
/** Everything a read-only query must leave alone: the work tree, the index, refs and objects. */
const snapshot = () => [
  gitOutput(["status", "--porcelain", "--untracked-files=all"], repo),
  gitOutput(["for-each-ref"], repo),
  gitOutput(["count-objects", "-v"], repo)
];
/** The commit a real rebase, cherry-pick or revert stopped at, and its conflicted files. */
const realStop = () => ({
  files: gitOutput(["diff", "--name-only", "--diff-filter=U"], repo).split("\n").filter(Boolean)
});

describe("a rebase", () => {
  it("replays a branch cleanly", async () => {
    git(["checkout", "-q", "-b", "topic"], repo);
    commitFiles("one", { a: "a\n" });
    commitFiles("two", { b: "b\n" });
    commitFiles("three", { c: "c\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { f: "main\n" });
    git(["checkout", "-q", "topic"], repo);
    expect(await rebaseOnto("main")).toEqual({ stop: null, replayed: 3 });
  });

  it("names the commit that would stop and its files, and changes nothing on disk", async () => {
    git(["checkout", "-q", "-b", "topic"], repo);
    commitFiles("one", { a: "a\n" });
    const second = commitFiles("two", { f: "topic\n", "g h.txt": "topic\n" });
    commitFiles("three", { f: "topic again\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { f: "main\n", "g h.txt": "main\n" });
    git(["checkout", "-q", "topic"], repo);
    writeFileSync(path.join(repo, "untracked"), "left alone\n");
    const before = snapshot();

    const result = await rebaseOnto("main");
    expect(result).toEqual({
      stop: { hash: second, subject: "two", files: ["f", "g h.txt"] },
      replayed: 1
    });
    expect(snapshot()).toEqual(before);

    // The real rebase, as Branchwise runs it, stops at the same commit with the same files.
    expect(() => git(["rebase", "--rebase-merges", "main"], repo)).toThrow();
    expect(gitOutput(["rev-parse", "REBASE_HEAD"], repo)).toBe(second);
    expect(realStop().files).toEqual(["f", "g h.txt"]);
    git(["rebase", "--abort"], repo);
  });

  it("drops commits the target already has, as Git does", async () => {
    git(["checkout", "-q", "-b", "topic"], repo);
    commitFiles("same change", { f: "shared\n" });
    commitFiles("new file", { g: "g\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("same change, picked", { f: "shared\n" });
    commitFiles("then more", { f: "later\n" });
    git(["checkout", "-q", "topic"], repo);

    // Replaying the first commit onto main would conflict; Git leaves it out instead.
    expect(await rebaseOnto("main")).toEqual({ stop: null, replayed: 1 });
    git(["rebase", "--rebase-merges", "main"], repo);
    expect(gitOutput(["rev-list", "--count", "main..topic"], repo)).toBe("1");
  });

  it("merges a merge afresh, so a merge resolved by hand would stop again", async () => {
    const base = head();
    git(["checkout", "-q", "-b", "side"], repo);
    commitFiles("side", { f: "side\n" });
    git(["checkout", "-q", "-b", "topic", base], repo);
    commitFiles("topic", { f: "topic\n" });
    expect(() => git(["merge", "-q", "side"], repo)).toThrow();
    writeFileSync(path.join(repo, "f"), "resolved\n");
    git(["commit", "-q", "-a", "-m", "merge side"], repo);
    const merge = head();
    commitFiles("after", { a: "a\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { m: "m\n" });
    git(["checkout", "-q", "topic"], repo);

    // Picked: "topic". Kept, since its fork point is outside the range: "side".
    expect(await rebaseOnto("main")).toEqual({
      stop: { hash: merge, subject: "merge side", files: ["f"] },
      replayed: 2
    });
    expect(() => git(["rebase", "--rebase-merges", "main"], repo)).toThrow();
    const done = readFileSync(path.join(repo, ".git", "rebase-merge", "done"), "utf8");
    expect(done.trim().split("\n").at(-1)).toMatch(new RegExp(`^merge -C ${merge.slice(0, 7)}`));
    expect(realStop().files).toEqual(["f"]);
    git(["rebase", "--abort"], repo);
  });

  it("replays a clean merge with the commits around it", async () => {
    const base = head();
    git(["checkout", "-q", "-b", "side"], repo);
    commitFiles("side", { s: "s\n" });
    git(["checkout", "-q", "-b", "topic", base], repo);
    commitFiles("topic", { t: "t\n" });
    git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], repo);
    commitFiles("after", { a: "a\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { f: "main\n" });
    git(["checkout", "-q", "topic"], repo);
    expect(await rebaseOnto("main")).toEqual({ stop: null, replayed: 4 });
  });

  it("replays nothing onto a commit the branch already contains", async () => {
    const base = head();
    commitFiles("ahead", { a: "a\n" });
    expect(await rebaseOnto(base)).toEqual({ stop: null, replayed: 0 });
  });
});

describe("a cherry-pick", () => {
  it("follows the order given, which can change the outcome", async () => {
    const base = head();
    const create = commitFiles("create g", { g: "one\n" });
    const change = commitFiles("change g", { g: "two\n" });
    expect(await forecast({ mode: "pick", onto: base, commits: [create, change] })).toEqual({
      stop: null,
      replayed: 2
    });
    // Changing g before it exists conflicts.
    expect(await forecast({ mode: "pick", onto: base, commits: [change, create] })).toEqual({
      stop: { hash: change, subject: "change g", files: ["g"] },
      replayed: 0
    });
  });

  it("leaves out a merge without a mainline, and picks it against the parent given", async () => {
    const base = head();
    git(["checkout", "-q", "-b", "side"], repo);
    commitFiles("side", { f: "side\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { g: "g\n" });
    git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], repo);
    const merge = head();
    git(["checkout", "-q", "-b", "other", base], repo);
    commitFiles("other", { f: "other\n" });

    expect(await forecast({ mode: "pick", onto: "HEAD", commits: [merge] })).toEqual({
      stop: null,
      replayed: 0
    });
    // Against its first parent the merge brings in side's change to f, which conflicts here.
    expect(await forecast({ mode: "pick", onto: "HEAD", commits: [merge], mainline: 1 })).toEqual({
      stop: { hash: merge, subject: "merge side", files: ["f"] },
      replayed: 0
    });
    expect(() => git(["cherry-pick", "-m", "1", merge], repo)).toThrow();
    expect(realStop().files).toEqual(["f"]);
    git(["cherry-pick", "--abort"], repo);
  });

  it("skips a list over the limit without running a merge", async () => {
    const commits = Array.from({ length: 201 }, () => head());
    expect(await forecast({ mode: "pick", onto: "HEAD", commits })).toEqual({
      stop: null,
      replayed: 0,
      skipped: "limit"
    });
  });
});

describe("a revert", () => {
  it("stops at a commit whose lines changed since, and reverts newest first cleanly", async () => {
    const first = commitFiles("first", { f: "1\n" });
    const second = commitFiles("second", { f: "2\n" });
    const before = snapshot();
    expect(await forecast({ mode: "revert", onto: "HEAD", commits: [first] })).toEqual({
      stop: { hash: first, subject: "first", files: ["f"] },
      replayed: 0
    });
    expect(await forecast({ mode: "revert", onto: "HEAD", commits: [second, first] })).toEqual({
      stop: null,
      replayed: 2
    });
    expect(snapshot()).toEqual(before);
    expect(() => git(["revert", "--no-edit", first], repo)).toThrow();
    expect(realStop().files).toEqual(["f"]);
    git(["revert", "--abort"], repo);
  });
});

describe("a request cancelled part way", () => {
  /**
   * The modules afresh, with nothing remembered from other tests. `cancelledAt(trigger)` is a
   * client that cancels its own request when it is about to run Git with `trigger`, and
   * `cancelledAtMerge(n)` one that cancels it as its `n`th in-memory merge starts.
   */
  const freshModule = async () => {
    vi.resetModules();
    let merges = 0;
    let stopAt = Infinity;
    let controller = new AbortController();
    vi.doMock("@/backend/utils/runGit", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/backend/utils/runGit")>();
      return {
        ...original,
        readGitCode: (...args: Parameters<typeof original.readGitCode>) => {
          if (args[1][0] === "merge-tree" && (merges += 1) === stopAt) {
            controller.abort();
          }
          return original.readGitCode(...args);
        }
      };
    });
    const [{ loadReplayForecast }, { createGit: freshGit }] = await Promise.all([
      import("@/backend/queries/replayForecast"),
      import("@/backend/gitClient")
    ]);
    vi.doUnmock("@/backend/utils/runGit");
    const cancelledAt = (trigger: string) => {
      controller = new AbortController();
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
    const cancelledAtMerge = (n: number) => {
      controller = new AbortController();
      merges = 0;
      stopAt = n;
      return freshGit(repo, "git", controller.signal);
    };
    const plain = () => {
      stopAt = Infinity;
      return freshGit(repo, "git");
    };
    return { loadReplayForecast, cancelledAt, cancelledAtMerge, plain };
  };

  let second = "";
  beforeEach(() => {
    git(["checkout", "-q", "-b", "topic"], repo);
    commitFiles("one", { a: "a\n" });
    second = commitFiles("two", { f: "topic\n" });
    git(["checkout", "-q", "main"], repo);
    commitFiles("main", { f: "main\n" });
    git(["checkout", "-q", "topic"], repo);
  });

  const expected = () => ({ stop: { hash: second, subject: "two", files: ["f"] }, replayed: 1 });
  const query = { kind: "replayForecast", mode: "rebase", onto: "main" } as const;

  it.each([
    ["the Git version check", "--version"],
    ["the listing of commits", "--cherry-mark"],
    ["the setup of the scratch objects", "--git-path"]
  ])("in %s leaves nothing behind for the next request", async (_, trigger) => {
    const { loadReplayForecast, cancelledAt, plain } = await freshModule();
    await expect(loadReplayForecast(cancelledAt(trigger), query)).rejects.toThrow();
    expect(await loadReplayForecast(plain(), query)).toEqual(expected());
  });

  it("between merges leaves nothing behind for the next request", async () => {
    const { loadReplayForecast, cancelledAtMerge, plain } = await freshModule();
    // The first merge runs; the request is cancelled before the second.
    await expect(loadReplayForecast(cancelledAtMerge(1), query)).rejects.toThrow();
    expect(await loadReplayForecast(plain(), query)).toEqual(expected());
  });

  it("reports an old Git as unsupported", async () => {
    const { loadReplayForecast, plain } = await freshModule();
    const client = plain();
    const raw = client.raw.bind(client);
    client.raw = ((args: string[]) =>
      args[0] === "--version"
        ? Promise.resolve("git version 2.39.5\n")
        : raw(args)) as typeof client.raw;
    expect(await loadReplayForecast(client, query)).toEqual({
      stop: null,
      replayed: 0,
      skipped: "unsupported"
    });
  });
});
