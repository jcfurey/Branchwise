import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import {
  CONFLICT_FORECAST_LIMIT,
  REMOTE_FORECAST_DAYS,
  REMOTE_FORECAST_LIMIT
} from "@/backend/queries/conflictForecast";
import { repositoryQuery } from "@/backend/queries/repository";
import type { RepositoryQuery } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

type ForecastQuery = Extract<RepositoryQuery, { kind: "conflictForecast" }>;

/** The whole forecast, with the committer and date of each branch. */
const forecastDetails = async (options: Omit<ForecastQuery, "kind"> = { scope: "local" }) => {
  const result = await repositoryQuery(createGit(repo, "git"), {
    kind: "conflictForecast",
    ...options
  });
  return result.kind === "conflictForecast" ? result.conflicts : null;
};
/** Each branch of the forecast with its conflicted files. */
const forecast = async (options?: Omit<ForecastQuery, "kind">) =>
  (await forecastDetails(options))?.map(({ branch, files }) => ({ branch, files })) ?? null;
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
    expect(await loadConflictForecast(plain())).toMatchObject([{ branch: "clash", files: ["f"] }]);
  });
});

describe("remote branches", () => {
  const DAY = 24 * 60 * 60;
  const now = () => Math.floor(Date.now() / 1000);
  let bare: string;
  let peer: string;
  const scratch: string[] = [];
  const folder = () => {
    const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "ngg-test-")));
    scratch.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of scratch.splice(0)) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  /** Git in `cwd` with extra environment variables, such as a committer date. */
  const gitWith = (cwd: string, env: Record<string, string>, args: string[], input?: string) =>
    execFileSync("git", args, { cwd, env: { ...process.env, ...env }, input, stdio: "pipe" })
      .toString()
      .trim();

  /**
   * A teammate's commit on `branch` of the remote, from `origin/main`, that writes `content` to
   * `file`: made by Alice in her own clone at `date` (seconds since 1970), then pushed.
   */
  const push = (branch: string, file: string, content: string, date = now() - 2 * DAY) => {
    git(["checkout", "-q", "-B", branch, "origin/main"], peer);
    writeFileSync(path.join(peer, file), content);
    git(["add", "-A"], peer);
    gitWith(peer, { GIT_COMMITTER_DATE: `@${date} +0000` }, ["commit", "-q", "-m", branch]);
    git(["push", "-q", "-f", "origin", `HEAD:refs/heads/${branch}`], peer);
  };
  const fetch = () => git(["fetch", "-q", "--prune", "origin"], repo);
  const remoteBranches = async (options: Omit<ForecastQuery, "kind">) =>
    (await forecastDetails(options))?.filter((entry) => entry.remote).map((entry) => entry.branch);

  // `repo` tracks `origin/main` on a bare remote, with `origin/HEAD` set, then commits a change
  // to `f` on main. Alice works in a clone of her own.
  beforeEach(() => {
    bare = folder();
    git(["clone", "-q", "--bare", repo, bare], bare);
    git(["remote", "add", "origin", bare], repo);
    fetch();
    git(["branch", "-q", "--set-upstream-to=origin/main", "main"], repo);
    git(["remote", "set-head", "origin", "main"], repo);
    peer = folder();
    git(["clone", "-q", bare, peer], peer);
    git(["config", "user.name", "Alice"], peer);
    git(["config", "user.email", "alice@example.org"], peer);
    git(["config", "commit.gpgsign", "false"], peer);
    commitFiles("main", { f: "mine\n" });
  });

  it("names a teammate's branch that would conflict, with its files, committer and date", async () => {
    const date = now() - 2 * DAY;
    push("alice/payments", "f", "theirs\n", date);
    push("alice/clean", "g", "new\n");
    fetch();
    writeFileSync(path.join(repo, "untracked"), "left alone\n");
    const before = [status(), refs()];

    expect(await forecastDetails({ scope: "localAndRemote" })).toEqual([
      { branch: "origin/alice/payments", remote: true, files: ["f"], committer: "Alice", date }
    ]);
    // Nothing on disk or among the refs changed.
    expect([status(), refs()]).toEqual(before);
  });

  it("leaves out the checked-out branch's upstream and <remote>/HEAD", async () => {
    // The upstream moved on with a change of its own to `f`: main is behind, not in a clash.
    push("main", "f", "upstream\n");
    fetch();
    expect(gitOutput(["symbolic-ref", "refs/remotes/origin/HEAD"], repo)).toBe(
      "refs/remotes/origin/main"
    );
    expect(await remoteBranches({ scope: "localAndRemote" })).toEqual([]);

    // Once main tracks nothing, origin/main is tried like any other, and origin/HEAD still is not.
    git(["branch", "-q", "--unset-upstream", "main"], repo);
    expect(await remoteBranches({ scope: "localAndRemote" })).toEqual(["origin/main"]);
  });

  it("leaves a remote branch to the local branch at its commit or tracking it", async () => {
    push("alice/same", "f", "same\n");
    push("alice/ahead", "f", "ahead\n");
    fetch();
    git(["branch", "-q", "--no-track", "copy", "origin/alice/same"], repo);
    git(["branch", "-q", "alice/ahead", "origin/alice/ahead"], repo);
    // Alice adds to her branch; the local branch tracking it stands for it all the same.
    writeFileSync(path.join(peer, "h"), "more\n");
    git(["add", "-A"], peer);
    git(["commit", "-q", "-m", "more"], peer);
    git(["push", "-q", "origin", "HEAD:refs/heads/alice/ahead"], peer);
    fetch();

    const conflicts = await forecastDetails({ scope: "localAndRemote" });
    expect(conflicts?.map((entry) => [entry.branch, entry.remote]).toSorted()).toEqual([
      ["alice/ahead", false],
      ["copy", false]
    ]);
  });

  it("leaves out hidden remotes, branches hidden by pattern, and all of them while remotes are hidden", async () => {
    const fork = folder();
    git(["clone", "-q", "--bare", bare, fork], fork);
    push("alice/payments", "f", "alice\n");
    push("dependabot/npm/left-pad", "f", "bot\n");
    fetch();
    git(["remote", "add", "fork", fork], repo);
    git(["push", "-q", "fork", "refs/remotes/origin/alice/payments:refs/heads/bob/payments"], repo);
    git(["fetch", "-q", "fork"], repo);

    expect((await remoteBranches({ scope: "localAndRemote" }))?.toSorted()).toEqual([
      "fork/bob/payments",
      "origin/alice/payments",
      "origin/dependabot/npm/left-pad"
    ]);
    expect(
      await remoteBranches({
        scope: "localAndRemote",
        hiddenRemotes: ["fork"],
        hiddenBranchPatterns: ["dependabot/*"]
      })
    ).toEqual(["origin/alice/payments"]);
    expect(await remoteBranches({ scope: "localAndRemote", showRemoteBranches: false })).toEqual(
      []
    );
  });

  it(`leaves out branches with no commit in the last ${REMOTE_FORECAST_DAYS} days`, async () => {
    push("alice/recent", "f", "recent\n", now() - (REMOTE_FORECAST_DAYS - 1) * DAY);
    push("alice/abandoned", "f", "old\n", now() - (REMOTE_FORECAST_DAYS + 10) * DAY);
    fetch();
    expect(await remoteBranches({ scope: "localAndRemote" })).toEqual(["origin/alice/recent"]);
  });

  it("follows the setting: remote branches with localAndRemote only, nothing when off", async () => {
    push("alice/payments", "f", "theirs\n");
    fetch();
    git(["checkout", "-q", "--no-track", "-b", "clash", "main~1"], repo);
    commitFiles("clash", { f: "clash\n" });
    git(["checkout", "-q", "main"], repo);
    const before = [status(), refs()];

    expect(await forecast({ scope: "localAndRemote" })).toEqual([
      { branch: "clash", files: ["f"] },
      { branch: "origin/alice/payments", files: ["f"] }
    ]);
    expect(await forecast({ scope: "local" })).toEqual([{ branch: "clash", files: ["f"] }]);
    expect(await forecast({ scope: "off" })).toEqual([]);
    expect([status(), refs()]).toEqual(before);
  });

  it(`tries at most ${CONFLICT_FORECAST_LIMIT} local and ${REMOTE_FORECAST_LIMIT} remote branches, newest first`, async () => {
    const base = gitOutput(["rev-parse", "main~1"], repo);
    const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
    /** A commit on `base` that rewrites `f`, `age` minutes old, at `ref`, for `fast-import`. */
    const branchAt = (ref: string, content: string, age: number) =>
      `commit ${ref}\ncommitter T <t@t.com> ${now() - age * 60} +0000\n${data(content)}` +
      `from ${base}\nM 100644 inline f\n${data(content)}`;
    const extra = 3;
    const stream = [
      ...Array.from({ length: CONFLICT_FORECAST_LIMIT + extra }, (_, index) =>
        branchAt(`refs/heads/local-${index}`, `local ${index}\n`, index)
      ),
      ...Array.from({ length: REMOTE_FORECAST_LIMIT + extra }, (_, index) =>
        branchAt(`refs/remotes/origin/remote-${index}`, `remote ${index}\n`, index)
      )
    ];
    // One process writes every commit and ref.
    gitWith(repo, {}, ["fast-import", "--quiet"], stream.join(""));

    const conflicts = (await forecastDetails({ scope: "localAndRemote" })) ?? [];
    expect(conflicts.filter((entry) => !entry.remote).map((entry) => entry.branch)).toEqual(
      Array.from({ length: CONFLICT_FORECAST_LIMIT }, (_, index) => `local-${index}`)
    );
    expect(conflicts.filter((entry) => entry.remote).map((entry) => entry.branch)).toEqual(
      Array.from({ length: REMOTE_FORECAST_LIMIT }, (_, index) => `origin/remote-${index}`)
    );
  });
});
