import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadStatistics } from "@/backend/queries/statistics";

import { git, makeRepo } from "@tests/backend/helpers";

/** 2026-06-15 12:00 UTC, the "now" every test counts back from. */
const NOW = 1_781_524_800;
const DAY = 24 * 60 * 60;

/**
 * Only read. After `init` (by T, now − 400 days):
 * - Ann commits twice on `main`, at now − 100 days (3 lines added) and now − 10 days (1 added,
 *   1 deleted), the second under her old address, which `.mailmap` maps to her current one;
 * - Bob commits once on `topic`, at now − 2 days (2 lines added);
 * - `main` merges `topic` at now − 1 day, by T.
 */
describe("repository statistics", () => {
  let repo = "";

  function commitAt(daysAgo: number, author: string, file: string, content: string) {
    fs.writeFileSync(path.join(repo, file), content);
    git(["add", file], repo);
    const date = `${NOW - daysAgo * DAY} +0000`;
    execFileSync("git", ["commit", "-q", `--author=${author}`, "-m", `${file} ${daysAgo}`], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
    });
  }

  beforeAll(() => {
    repo = makeRepo();
    // makeRepo's `init` is dated now; rewrite history so that it is older than every range.
    const old = `${NOW - 400 * DAY} +0000`;
    execFileSync("git", ["commit", "-q", "--amend", "--no-edit", "--reset-author"], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old }
    });
    fs.writeFileSync(path.join(repo, ".mailmap"), "Ann Lee <ann@new.test> <ann@old.test>\n");
    git(["add", ".mailmap"], repo);
    execFileSync("git", ["commit", "-q", "-m", "mailmap"], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old }
    });
    commitAt(100, "Ann Lee <ann@new.test>", "a.txt", "1\n2\n3\n");
    commitAt(10, "Ann <ann@old.test>", "a.txt", "1\n2\nthree\n");
    git(["checkout", "-q", "-b", "topic"], repo);
    commitAt(2, "Bob <bob@example.test>", "b.txt", "x\ny\n");
    git(["checkout", "-q", "main"], repo);
    const merged = `${NOW - DAY} +0000`;
    execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge topic", "topic"], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: merged, GIT_COMMITTER_DATE: merged }
    });
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const load = (query: Partial<Parameters<typeof loadStatistics>[1]>) =>
    loadStatistics(
      createGit(repo, "git"),
      { branch: "", range: "all", lines: false, ...query },
      NOW
    );

  it("counts each person once through .mailmap, most commits first", async () => {
    const stats = await load({});
    expect(stats.commits).toBe(6);
    expect(stats.contributors.map((p) => [p.name, p.email, p.commits])).toStrictEqual([
      ["T", "t@t.com", 3],
      ["Ann Lee", "ann@new.test", 2],
      ["Bob", "bob@example.test", 1]
    ]);
    const ann = stats.contributors[1]!;
    expect([ann.first, ann.last]).toStrictEqual([NOW - 100 * DAY, NOW - 10 * DAY]);
    expect(stats.first).toBe(NOW - 400 * DAY);
    expect(stats.last).toBe(NOW - DAY);
    expect(stats.activeDays).toBe(5);
    expect(ann.added).toBeUndefined();
  });

  it("limits the count to a period and to one branch", async () => {
    expect((await load({ range: "30" })).contributors.map((p) => p.name)).toStrictEqual([
      "Ann Lee",
      "Bob",
      "T"
    ]);
    expect((await load({ range: "30" })).commits).toBe(3);
    const topic = await load({ branch: "refs/heads/topic" });
    // Equal counts go by name.
    expect(topic.contributors.map((p) => [p.name, p.commits])).toStrictEqual([
      ["Ann Lee", 2],
      ["T", 2],
      ["Bob", 1]
    ]);
  });

  it("counts commits per day over the last year", async () => {
    const stats = await load({});
    const day = (daysAgo: number) =>
      new Date((NOW - daysAgo * DAY) * 1000).toISOString().slice(0, 10);
    expect(stats.activity).toStrictEqual({
      [day(100)]: 1,
      [day(10)]: 1,
      [day(2)]: 1,
      [day(1)]: 1
    });
  });

  it("counts lines added and deleted outside merges when asked", async () => {
    const stats = await load({ lines: true });
    const lines = Object.fromEntries(stats.contributors.map((p) => [p.name, [p.added, p.deleted]]));
    expect(lines).toStrictEqual({
      "Ann Lee": [4, 1],
      Bob: [2, 0],
      // `init` adds `f`, and `.mailmap` adds a line; the merge counts nothing.
      T: [2, 0]
    });
    expect(stats.lines).toBe(true);
  });

  it("refuses a branch that is not local and a period it does not offer", async () => {
    await expect(load({ branch: "refs/remotes/origin/x" })).rejects.toThrow(
      "Choose a local branch to count its commits."
    );
    await expect(load({ range: "7" as never })).rejects.toThrow("Choose a period to count.");
  });
});

describe("statistics of a repository without commits", () => {
  let repo = "";

  beforeAll(() => {
    repo = makeRepo();
    git(["checkout", "-q", "--orphan", "empty"], repo);
    git(["branch", "-q", "-D", "main"], repo);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("count nothing", async () => {
    const stats = await loadStatistics(
      createGit(repo, "git"),
      { branch: "", range: "all", lines: true },
      NOW
    );
    expect(stats).toStrictEqual({
      commits: 0,
      activeDays: 0,
      first: null,
      last: null,
      contributors: [],
      activity: {},
      lines: true
    });
  });
});
