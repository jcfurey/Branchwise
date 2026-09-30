import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";

import {
  commit,
  defaults,
  type GraphInput,
  git,
  repoA,
  repoB,
  repoI,
  useTempDirs
} from "@tests/backend/queries/loadCommits/fixtures";

const tempDir = useTempDirs();

const RESULT_KEYS = ["commits", "hard", "head", "moreCommitsAvailable", "uncommittedChanges"];

/** The graph, and the `--max-count` its log asked Git for. */
async function page(repo: string, input: GraphInput) {
  const client = createGit(repo, "git");
  const raw = vi.spyOn(client, "raw");
  const result = await loadCommits(client, input);
  const log = raw.mock.calls
    .map(([args]) => args as unknown as string[])
    .find((args) => args[0] === "log");
  return { result, maxCount: log?.find((arg) => arg.startsWith("--max-count=")) };
}

describe("graph order and page", () => {
  it("orders by commit date and fills dates from the chosen timestamp", async () => {
    const { repo, I, M2, F1 } = repoB(tempDir());
    const input = { ...defaults, showUncommittedChanges: false };
    const authored = await loadCommits(createGit(repo, "git"), input);
    expect(authored.commits.map((entry) => [entry.hash, entry.date])).toEqual([
      [F1, 1_600_000_000],
      [M2, 1_800_000_000],
      [I, 1_700_000_000]
    ]);
    const committed = await loadCommits(createGit(repo, "git"), {
      ...input,
      dateType: "Commit Date"
    });
    expect(committed.commits.map((entry) => [entry.hash, entry.date])).toEqual([
      [F1, 1_700_000_200],
      [M2, 1_700_000_100],
      [I, 1_700_000_000]
    ]);
    expect(committed.commits.map((entry) => entry.refs)).toEqual([
      [{ hash: F1, name: "feature", type: "head" }],
      [{ hash: M2, name: "main", type: "head" }],
      []
    ]);
  });

  it("lists a child before an older-dated parent", async () => {
    const { repo, I } = repoI(tempDir());
    const parent = commit(repo, "parent", 1_700_000_900);
    const child = commit(repo, "child", 1_700_000_500);
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(result.commits.map((entry) => entry.hash)).toEqual([child, parent, I]);
  });

  it("puts the uncommitted row first even when HEAD's commit is further down", async () => {
    const { repo, I, M2, F1 } = repoB(tempDir());
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(result.commits.map((entry) => entry.hash)).toEqual(["*", F1, M2, I]);
    expect(result.commits[0]).toMatchObject({ parentHashes: [M2], refs: [] });
    expect(result).toMatchObject({ head: M2, moreCommitsAvailable: false, uncommittedChanges: 1 });
  });

  it("counts only real commits towards the page", async () => {
    const { repo, I } = repoI(tempDir());
    fs.writeFileSync(path.join(repo, "untracked"), "");
    const result = await loadCommits(createGit(repo, "git"), { ...defaults, maxCommits: 1 });
    expect(result.commits.map((entry) => entry.hash)).toEqual(["*", I]);
    expect(result).toMatchObject({ moreCommitsAvailable: false, uncommittedChanges: 1 });
  });

  it("reports more history only for the selected branch", async () => {
    const { repo, I, F1 } = repoB(tempDir());
    const input = { ...defaults, branchName: "feature", showUncommittedChanges: false };
    const whole = await loadCommits(createGit(repo, "git"), input);
    expect(whole.commits.map((entry) => entry.hash)).toEqual([F1, I]);
    expect(whole.moreCommitsAvailable).toBe(false);
    const first = await loadCommits(createGit(repo, "git"), { ...input, maxCommits: 1 });
    expect(first.commits.map((entry) => entry.hash)).toEqual([F1]);
    expect(first.moreCommitsAvailable).toBe(true);
  });

  it("returns exactly the five result keys", async () => {
    const { repo } = repoB(tempDir());
    const empty = tempDir();
    git(empty, ["init", "-q", "-b", "main"]);
    const cases: [string, GraphInput][] = [
      [repo, defaults],
      [repo, { ...defaults, branchName: "feature", hard: true }],
      [repo, { ...defaults, showRemoteBranches: false, hiddenRemotes: ["origin"] }],
      [empty, defaults]
    ];
    const results = await Promise.all(
      cases.map(([where, input]) => loadCommits(createGit(where, "git"), input))
    );
    for (const [index, result] of results.entries()) {
      expect(Object.keys(result).toSorted(), JSON.stringify(cases[index]?.[1])).toEqual(
        RESULT_KEYS
      );
      expect("visibilityKey" in result).toBe(false);
    }
  });
});

describe("page size", () => {
  it.each([0, -1, -5, 0.5, Number.NaN])(
    "treats %s commits as a page of one",
    async (maxCommits) => {
      const { repo, S } = repoA(tempDir());
      const { result, maxCount } = await page(repo, {
        ...defaults,
        maxCommits,
        showUncommittedChanges: false
      });
      expect(result.commits.map((entry) => entry.hash)).toEqual([S]);
      expect(result.moreCommitsAvailable).toBe(true);
      expect(maxCount).toBe("--max-count=2");
    }
  );

  it("rounds a fractional page down", async () => {
    const { repo, I } = repoI(tempDir());
    const second = commit(repo, "second", 1_700_000_100);
    const third = commit(repo, "third", 1_700_000_200);
    const input = { ...defaults, showUncommittedChanges: false };
    const { result, maxCount } = await page(repo, { ...input, maxCommits: 2.5 });
    expect(result.commits.map((entry) => entry.hash)).toEqual([third, second]);
    expect(result.moreCommitsAvailable).toBe(true);
    expect(maxCount).toBe("--max-count=3");
    const whole = await page(repo, { ...input, maxCommits: 3.9 });
    expect(whole.result.commits.map((entry) => entry.hash)).toEqual([third, second, I]);
    expect(whole.result.moreCommitsAvailable).toBe(false);
  });

  it("does not report more history after a single commit or none", async () => {
    const { repo, I } = repoI(tempDir());
    const single = await loadCommits(createGit(repo, "git"), { ...defaults, maxCommits: 0 });
    expect(single.commits.map((entry) => entry.hash)).toEqual([I]);
    expect(single.moreCommitsAvailable).toBe(false);
    const empty = tempDir();
    git(empty, ["init", "-q", "-b", "main"]);
    expect(await loadCommits(createGit(empty, "git"), { ...defaults, maxCommits: -1 })).toEqual({
      commits: [],
      head: null,
      moreCommitsAvailable: false,
      hard: false,
      uncommittedChanges: 0
    });
  });

  it("shows the uncommitted row above a clamped page that holds HEAD", async () => {
    const { repo, S } = repoA(tempDir());
    fs.writeFileSync(path.join(repo, "untracked"), "");
    const result = await loadCommits(createGit(repo, "git"), { ...defaults, maxCommits: 0 });
    expect(result.commits.map((entry) => entry.hash)).toEqual(["*", S]);
    expect(result).toMatchObject({ moreCommitsAvailable: true, uncommittedChanges: 1 });
  });
});
