import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadHistory } from "@/backend/queries/history";
import { loadCommits } from "@/backend/queries/loadCommits";
import { loadStatistics } from "@/backend/queries/statistics";
import type { GitCommitNode } from "@/backend/types";

import { git, makeRepo } from "@tests/backend/helpers";

/**
 * Only read. `main` is checked out at `base`, the one commit `makeRepo` makes. Each other branch
 * has a commit of its own on top of `base`: `feature`, `bot/one`, `bot/two` and `wip` locally, and
 * `origin/bot/remote` and `origin/feature` as remote-tracking branches. `bot/shared` points at
 * `base`, and the tag `kept` at `bot/two`'s commit.
 */
let repo = "";
let base = "";
const tips: Record<string, string> = {};
const read = (args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
const searchAll = {
  text: "only",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false
};

beforeAll(() => {
  repo = makeRepo();
  base = read(["rev-parse", "HEAD"]);
  const tree = read(["rev-parse", "HEAD^{tree}"]);
  git(["remote", "add", "origin", "."], repo);
  for (const [ref, name] of [
    ["refs/heads/feature", "feature"],
    ["refs/heads/bot/one", "bot/one"],
    ["refs/heads/bot/two", "bot/two"],
    ["refs/heads/wip", "wip"],
    ["refs/remotes/origin/bot/remote", "origin/bot/remote"],
    ["refs/remotes/origin/feature", "origin/feature"]
  ] as const) {
    tips[name] = read(["commit-tree", tree, "-p", base, "-m", `only on ${name}`]);
    git(["update-ref", ref, tips[name]!], repo);
  }
  git(["branch", "bot/shared", base], repo);
  git(["tag", "kept", tips["bot/two"]!], repo);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function graph(hiddenBranchPatterns: string[], extra: { shownBranch?: string } = {}) {
  return loadCommits(createGit(repo, "git"), {
    branchName: "",
    maxCommits: 100,
    showRemoteBranches: true,
    hiddenBranchPatterns,
    ...extra,
    hard: true,
    dateType: "Author Date",
    showUncommittedChanges: false
  });
}

const hashes = (commits: GitCommitNode[]) => commits.map((commit) => commit.hash);
const labels = (commits: GitCommitNode[]) =>
  commits.flatMap((commit) => commit.refs.map((ref) => `${ref.type}:${ref.name}`));

describe("hidden branch patterns in the graph", () => {
  it("leaves out commits only hidden branches reach, keeping shared history and tags", async () => {
    const { commits } = await graph(["bot/*"]);
    expect(hashes(commits)).not.toContain(tips["bot/one"]);
    expect(hashes(commits)).not.toContain(tips["origin/bot/remote"]);
    // The tag still reaches `bot/two`'s commit.
    expect(hashes(commits)).toContain(tips["bot/two"]);
    expect(hashes(commits)).toContain(tips["feature"]);
    expect(hashes(commits)).toContain(tips["origin/feature"]);
    expect(hashes(commits)).toContain(base);
    expect(labels(commits)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(head:bot\/|remote:origin\/bot\/)/)])
    );
    expect(labels(commits)).toEqual(
      expect.arrayContaining(["head:main", "head:feature", "tag:kept", "remote:origin/feature"])
    );
  });

  it("shows everything again without patterns, and ignores blank ones", async () => {
    const results = await Promise.all([graph([]), graph(["", "  "])]);
    for (const { commits } of results) {
      expect(hashes(commits)).toEqual(expect.arrayContaining(Object.values(tips)));
      expect(labels(commits)).toEqual(expect.arrayContaining(["head:bot/one", "head:bot/shared"]));
    }
  });

  it("matches remote branches by their name after the remote", async () => {
    const { commits } = await graph(["feature"]);
    expect(hashes(commits)).not.toContain(tips["feature"]);
    expect(hashes(commits)).not.toContain(tips["origin/feature"]);
    expect(hashes(commits)).toContain(tips["bot/one"]);
    // `origin/*` names no branch after the remote, so it hides nothing.
    const unchanged = await graph(["origin/*"]);
    expect(hashes(unchanged.commits)).toContain(tips["origin/bot/remote"]);
  });

  it("never hides the checked-out branch, even with a pattern for every name", async () => {
    const { commits, head } = await graph(["*"]);
    expect(head).toBe(base);
    expect(labels(commits)).toContain("head:main");
    expect(hashes(commits).toSorted()).toEqual([base, tips["bot/two"]].toSorted());
  });

  it("keeps the branch chosen in the header, local or remote", async () => {
    const local = await graph(["bot/*"], { shownBranch: "bot/one" });
    expect(hashes(local.commits)).toContain(tips["bot/one"]);
    expect(labels(local.commits)).toContain("head:bot/one");
    expect(hashes(local.commits)).not.toContain(tips["origin/bot/remote"]);

    const remote = await graph(["bot/*"], { shownBranch: "remotes/origin/bot/remote" });
    expect(hashes(remote.commits)).toContain(tips["origin/bot/remote"]);
    expect(labels(remote.commits)).toContain("remote:origin/bot/remote");
    expect(hashes(remote.commits)).not.toContain(tips["bot/one"]);

    // A chosen branch that no pattern matches, or that is gone, changes nothing.
    const unaffected = await Promise.all(
      ["feature", "bot/gone"].map((shownBranch) => graph(["bot/*"], { shownBranch }))
    );
    for (const { commits } of unaffected) {
      expect(hashes(commits)).not.toContain(tips["bot/one"]);
    }
  });

  it("drops a hidden branch's label when filtering to a branch that shares its commit", async () => {
    const { commits } = await loadCommits(createGit(repo, "git"), {
      branchName: "main",
      maxCommits: 100,
      showRemoteBranches: true,
      hiddenBranchPatterns: ["bot/*"],
      shownBranch: "main",
      hard: true,
      dateType: "Author Date",
      showUncommittedChanges: false
    });
    expect(hashes(commits)).toEqual([base]);
    expect(labels(commits)).toEqual(["head:main"]);
  });

  it("combines with hidden remotes and the remote switch", async () => {
    const hiddenRemote = await loadCommits(createGit(repo, "git"), {
      branchName: "",
      maxCommits: 100,
      showRemoteBranches: true,
      hiddenRemotes: ["origin"],
      hiddenBranchPatterns: ["wip"],
      hard: true,
      dateType: "Author Date",
      showUncommittedChanges: false
    });
    expect(hashes(hiddenRemote.commits)).not.toContain(tips["origin/feature"]);
    expect(hashes(hiddenRemote.commits)).not.toContain(tips["wip"]);
    expect(hashes(hiddenRemote.commits)).toContain(tips["feature"]);

    const noRemotes = await loadCommits(createGit(repo, "git"), {
      branchName: "",
      maxCommits: 100,
      showRemoteBranches: false,
      hiddenBranchPatterns: ["wip"],
      hard: true,
      dateType: "Author Date",
      showUncommittedChanges: false
    });
    expect(hashes(noRemotes.commits)).not.toContain(tips["wip"]);
    expect(hashes(noRemotes.commits)).not.toContain(tips["origin/bot/remote"]);
    expect(hashes(noRemotes.commits)).toContain(tips["bot/one"]);
  });

  it("changes no ref", () => {
    expect(read(["branch", "--show-current"])).toBe("main");
    expect(read(["rev-parse", "refs/heads/bot/one"])).toBe(tips["bot/one"]);
  });
});

describe("hidden branch patterns in history search and statistics", () => {
  it("searches without the hidden branches' commits or names", async () => {
    const page = await loadHistory(createGit(repo, "git"), searchAll, 0, {
      hiddenBranchPatterns: ["bot/*"]
    });
    const found = page.entries.map((entry) => entry.hash);
    expect(found).not.toContain(tips["bot/one"]);
    expect(found).not.toContain(tips["origin/bot/remote"]);
    expect(found).toContain(tips["feature"]);

    const named = await loadHistory(createGit(repo, "git"), { ...searchAll, text: "bot" }, 0, {
      hiddenBranchPatterns: ["bot/*"]
    });
    expect(named.refs ?? []).toEqual([]);

    const byBranch = await loadHistory(
      createGit(repo, "git"),
      { ...searchAll, text: "", branch: "one" },
      0,
      { hiddenBranchPatterns: ["bot/*"], shownBranch: "bot/one" }
    );
    expect(byBranch.entries.map((entry) => entry.hash)).toEqual([tips["bot/one"]]);
  });

  it("counts every branch's commits less the hidden ones'", async () => {
    const query = { branch: "", range: "all", lines: false } as const;
    const all = await loadStatistics(createGit(repo, "git"), query);
    const less = await loadStatistics(createGit(repo, "git"), {
      ...query,
      hiddenBranchPatterns: ["bot/*", "wip"]
    });
    // bot/one, origin/bot/remote and wip; the tag keeps bot/two's commit.
    expect(all.commits - less.commits).toBe(3);
  });
});
