import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";
import type { GitCommitNode, GitRef } from "@/backend/types";

import { freshRepo, git, gitOutput, makeRepo } from "@tests/backend/helpers";

type Request = Parameters<typeof loadCommits>[1];

/** Every branch, a 300-commit page, author dates; no remotes and no uncommitted row. */
const BASE: Request = {
  branchName: "",
  maxCommits: 300,
  showRemoteBranches: false,
  hard: false,
  dateType: "Author Date",
  showUncommittedChanges: false
};

function graph(repo: string, changes: Partial<Request> = {}) {
  return loadCommits(createGit(repo, "git"), { ...BASE, ...changes });
}

function removeFolder(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function newFolder(prefix: string) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Commits what is staged, or nothing, with the given author and committer times. */
function commitAt(repo: string, message: string, authored: number, committed: number) {
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], {
    cwd: repo,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: `${authored} +0000`,
      GIT_COMMITTER_DATE: `${committed} +0000`
    }
  });
  return gitOutput(["rev-parse", "HEAD"], repo);
}

/** A commit on `parent` with its tree and no branch, so only the refs a test adds reach it. */
function danglingCommit(repo: string, parent: string, message: string) {
  return gitOutput(["commit-tree", `${parent}^{tree}`, "-p", parent, "-m", message], repo);
}

const label = (hash: string, name: string, type: GitRef["type"]): GitRef => ({ hash, name, type });

const byMessage = (commits: GitCommitNode[], message: string) =>
  commits.find((entry) => entry.message === message);

const dates = (commits: GitCommitNode[]) => commits.map((entry) => [entry.message, entry.date]);

const AUTHORED = { side: 1_600_000_000, second: 1_650_000_000, upstream: 1_690_000_000 };
const COMMITTED = { side: 1_760_000_000, second: 1_750_000_000, upstream: 1_770_000_000 };

/**
 * One history, only read: a clone of `upstream` whose `main` has `second` on top of `init`, and
 * whose `side` branch has `side-only` on `init`. After the clone, `upstream` gained
 * `upstream-only`, which the clone fetched, so only `origin/main` (and the symbolic
 * `origin/HEAD`) reach it. Author and committer times differ on every commit but `init`, and the
 * committer times order the tips `upstream-only`, `side-only`, `second`.
 */
describe("the graph of a clone with a side branch and a fetched remote commit", () => {
  const made: string[] = [];
  const ids = { init: "", second: "", side: "", upstream: "" };
  let repo = "";

  beforeAll(() => {
    const upstream = makeRepo();
    made.push(upstream);
    repo = newFolder("ngg-clone-");
    made.push(repo);
    git(["clone", "-q", upstream, "."], repo);
    git(["config", "user.name", "T"], repo);
    git(["config", "user.email", "t@t.com"], repo);
    ids.init = gitOutput(["rev-parse", "HEAD"], repo);

    fs.writeFileSync(path.join(repo, "f2"), "y");
    git(["add", "--", "f2"], repo);
    ids.second = commitAt(repo, "second", AUTHORED.second, COMMITTED.second);
    git(["checkout", "-q", "-b", "side", ids.init], repo);
    ids.side = commitAt(repo, "side-only", AUTHORED.side, COMMITTED.side);
    git(["checkout", "-q", "main"], repo);

    ids.upstream = commitAt(upstream, "upstream-only", AUTHORED.upstream, COMMITTED.upstream);
    git(["fetch", "-q", "origin"], repo);
  });

  afterAll(() => {
    for (const dir of made) {
      removeFolder(dir);
    }
  });

  const sideEntry = () => ({
    hash: ids.side,
    parentHashes: [ids.init],
    author: "T",
    email: "t@t.com",
    date: AUTHORED.side,
    message: "side-only",
    refs: [label(ids.side, "side", "head")]
  });
  const secondEntry = () => ({
    hash: ids.second,
    parentHashes: [ids.init],
    author: "T",
    email: "t@t.com",
    date: AUTHORED.second,
    message: "second",
    refs: [label(ids.second, "main", "head")]
  });
  const initEntry = () => ({
    hash: ids.init,
    parentHashes: [],
    author: "T",
    email: "t@t.com",
    date: expect.any(Number),
    message: "init",
    refs: []
  });

  it("lists every local branch newest commit first, each labelled, with HEAD's commit", async () => {
    const result = await graph(repo);
    expect(result).toStrictEqual({
      commits: [sideEntry(), secondEntry(), initEntry()],
      head: ids.second,
      moreCommitsAvailable: false,
      hard: false,
      uncommittedChanges: 0
    });
    expect(result.commits[2]!.date).toBeGreaterThan(0);
  });

  it("returns the request's hard flag unchanged", async () => {
    const soft = await graph(repo);
    const hard = await graph(repo, { hard: true });
    expect(hard.hard).toBe(true);
    expect({ ...hard, hard: false }).toStrictEqual(soft);
  });

  it("gives committer times for the commit date and author times otherwise", async () => {
    const committed = await graph(repo, { dateType: "Commit Date" });
    expect(dates(committed.commits.slice(0, 2))).toStrictEqual([
      ["side-only", COMMITTED.side],
      ["second", COMMITTED.second]
    ]);
    const authored = await graph(repo, { dateType: "Author Date" });
    expect(dates(authored.commits.slice(0, 2))).toStrictEqual([
      ["side-only", AUTHORED.side],
      ["second", AUTHORED.second]
    ]);
  });

  it.each([
    { maxCommits: 1, messages: ["side-only"], more: true },
    { maxCommits: 2, messages: ["side-only", "second"], more: true },
    { maxCommits: 3, messages: ["side-only", "second", "init"], more: false }
  ])("stops a page at $maxCommits commits and says whether more follow", async (page) => {
    const result = await graph(repo, { maxCommits: page.maxCommits });
    expect(result.commits.map((entry) => entry.message)).toStrictEqual(page.messages);
    expect(result.moreCommitsAvailable).toBe(page.more);
    expect(result.head).toBe(ids.second);
  });

  it("keeps to the named branch's history when filtered", async () => {
    const onMain = await graph(repo, { branchName: "main" });
    expect(onMain.commits).toStrictEqual([secondEntry(), initEntry()]);
    expect(onMain.head).toBe(ids.second);
    const onSide = await graph(repo, { branchName: "side", showRemoteBranches: true });
    expect(onSide.commits).toStrictEqual([sideEntry(), initEntry()]);
  });

  it("filters by a remote-tracking branch given as remotes/<remote>/<branch>", async () => {
    const result = await graph(repo, {
      branchName: "remotes/origin/main",
      showRemoteBranches: true
    });
    expect(result.commits.map((entry) => entry.message)).toStrictEqual(["upstream-only", "init"]);
  });

  it("leaves out remote-only commits and remote labels while remotes are off", async () => {
    const result = await graph(repo, { showRemoteBranches: false });
    expect(result.commits.map((entry) => entry.hash)).not.toContain(ids.upstream);
    const types = result.commits.flatMap((entry) => entry.refs.map((ref) => ref.type));
    expect(types).not.toContain("remote");
  });

  it("adds remote-only commits with their remote labels while remotes are on", async () => {
    const result = await graph(repo, { showRemoteBranches: true });
    expect(result.commits).toStrictEqual([
      {
        hash: ids.upstream,
        parentHashes: [ids.init],
        author: "T",
        email: "t@t.com",
        date: AUTHORED.upstream,
        message: "upstream-only",
        refs: [
          label(ids.upstream, "origin/HEAD", "remote"),
          label(ids.upstream, "origin/main", "remote")
        ]
      },
      sideEntry(),
      secondEntry(),
      initEntry()
    ]);
    expect(result.head).toBe(ids.second);
  });
});

describe("a detached HEAD that no branch or tag names", () => {
  const repo = freshRepo((dir) => {
    git(["checkout", "-q", "--detach"], dir);
    git(["branch", "-D", "main"], dir);
  });

  it("is still listed, without labels", async () => {
    const head = gitOutput(["rev-parse", "HEAD"], repo());
    const result = await graph(repo(), { showRemoteBranches: true, showUncommittedChanges: true });
    expect(result).toStrictEqual({
      commits: [
        {
          hash: head,
          parentHashes: [],
          author: "T",
          email: "t@t.com",
          date: expect.any(Number),
          message: "init",
          refs: []
        }
      ],
      head,
      moreCommitsAvailable: false,
      hard: false,
      uncommittedChanges: 0
    });
  });
});

/**
 * HEAD is detached at `hidden-remote-tip`, which only `origin/topic` also reaches; `hidden-only`
 * is reached by `origin/other` alone. The remote `origin` is never fetched.
 */
describe("a hidden remote", () => {
  const repo = freshRepo((dir) => {
    git(["remote", "add", "origin", "."], dir);
    git(["checkout", "-q", "--detach"], dir);
    const hiddenOnly = danglingCommit(dir, "HEAD", "hidden-only");
    git(["update-ref", "refs/remotes/origin/other", hiddenOnly], dir);
    git(["commit", "-q", "--allow-empty", "-m", "hidden-remote-tip"], dir);
    git(["update-ref", "refs/remotes/origin/topic", "HEAD"], dir);
  });

  it("loses its commits and labels, but HEAD's commit stays", async () => {
    const init = gitOutput(["rev-parse", "main"], repo());
    const result = await graph(repo(), { showRemoteBranches: true, hiddenRemotes: ["origin"] });
    const head = gitOutput(["rev-parse", "HEAD"], repo());
    expect(result.head).toBe(head);
    expect(result.commits.map((entry) => [entry.message, entry.refs])).toStrictEqual([
      ["hidden-remote-tip", []],
      ["init", [label(init, "main", "head")]]
    ]);
  });

  it("shows those commits and labels when it is not hidden", async () => {
    const result = await graph(repo(), { showRemoteBranches: true });
    const tip = byMessage(result.commits, "hidden-remote-tip");
    expect(tip?.refs).toStrictEqual([label(result.head!, "origin/topic", "remote")]);
    const other = byMessage(result.commits, "hidden-only");
    expect(other?.refs).toStrictEqual([label(other!.hash, "origin/other", "remote")]);
    expect(result.commits).toHaveLength(3);
  });
});

/**
 * HEAD is detached at `detached-only`, which no ref names; `remote-only` is reached by
 * `origin/wip` alone; `main` stays at `init`; an untracked file makes the tree dirty.
 */
describe("a dirty detached HEAD beside a remote-tracking ref", () => {
  const repo = freshRepo((dir) => {
    git(["checkout", "-q", "--detach"], dir);
    git(["update-ref", "refs/remotes/origin/wip", danglingCommit(dir, "HEAD", "remote-only")], dir);
    git(["commit", "-q", "--allow-empty", "-m", "detached-only"], dir);
    fs.writeFileSync(path.join(dir, "untracked"), "dirty");
  });

  it.each([
    { showRemoteBranches: true, remoteOnly: ["remote-only"] },
    { showRemoteBranches: false, remoteOnly: [] }
  ])(
    "puts the changes on HEAD's commit with remotes $showRemoteBranches",
    async ({ showRemoteBranches, remoteOnly }) => {
      const client = createGit(repo(), "git");
      const detached = (await client.revparse(["HEAD"])).trim();
      const request = { ...BASE, showRemoteBranches, showUncommittedChanges: true };

      const all = await loadCommits(client, request);
      expect(all.head).toBe(detached);
      expect(all.uncommittedChanges).toBe(1);
      expect(all.commits[0]).toMatchObject({ hash: "*", parentHashes: [detached] });
      expect(all.commits.map((entry) => entry.message).toSorted()).toStrictEqual(
        ["", "detached-only", "init", ...remoteOnly].toSorted()
      );
      expect(byMessage(all.commits, "detached-only")?.hash).toBe(detached);

      const mainOnly = await loadCommits(client, { ...request, branchName: "main" });
      expect(mainOnly.head).toBe(detached);
      expect(mainOnly.commits.map((entry) => entry.message)).toStrictEqual(["init"]);
      expect(mainOnly.uncommittedChanges).toBe(0);
    }
  );
});

describe("an untracked file", () => {
  const repo = freshRepo((dir) => {
    fs.writeFileSync(path.join(dir, "untracked"), "z");
  });

  it("adds an uncommitted row on top of HEAD's commit when asked", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await graph(repo(), { showUncommittedChanges: true });
    const after = Math.floor(Date.now() / 1000);
    expect(result.uncommittedChanges).toBe(1);
    expect(result.commits[0]).toStrictEqual({
      hash: "*",
      parentHashes: [result.head],
      author: "*",
      email: "",
      date: expect.any(Number),
      message: "",
      refs: []
    });
    expect(result.commits[0]!.date).toBeGreaterThanOrEqual(before);
    expect(result.commits[0]!.date).toBeLessThanOrEqual(after);
    expect(result.commits.map((entry) => entry.message)).toStrictEqual(["", "init"]);
  });

  it("adds no row and counts nothing when not asked", async () => {
    const result = await graph(repo());
    expect(result.commits.map((entry) => entry.hash)).toStrictEqual([result.head]);
    expect(result.uncommittedChanges).toBe(0);
  });
});

describe("a repository without commits", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      removeFolder(dir);
    }
  });

  it("resolves to an empty page with no HEAD, even with an untracked file", async () => {
    const dir = newFolder("ngg-empty-");
    made.push(dir);
    git(["init", "-q"], dir);
    fs.writeFileSync(path.join(dir, "loose"), "u");
    const result = await graph(dir, { showRemoteBranches: true, showUncommittedChanges: true });
    expect(result).toStrictEqual({
      commits: [],
      head: null,
      moreCommitsAvailable: false,
      hard: false,
      uncommittedChanges: 0
    });
  });
});
