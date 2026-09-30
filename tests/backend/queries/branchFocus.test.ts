import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";

import { git, makeRepo } from "@tests/backend/helpers";

let repo: string;
let base: string;
let main: string;
let merged: string;
let side: string;
let tip: string;
const hash = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();

beforeAll(() => {
  repo = makeRepo();
  base = hash();
  git(["checkout", "-b", "merged"], repo);
  git(["commit", "--allow-empty", "-m", "merged contribution"], repo);
  merged = hash();
  git(["checkout", "-b", "side", base], repo);
  git(["commit", "--allow-empty", "-m", "unmerged contribution"], repo);
  side = hash();
  git(["checkout", "main"], repo);
  git(["commit", "--allow-empty", "-m", "main line"], repo);
  main = hash();
  git(["merge", "--no-ff", "merged", "-m", "merge contribution"], repo);
  tip = hash();
  git(["update-ref", "refs/remotes/origin/main", tip], repo);
  git(["tag", "main", side], repo);
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

it("distinguishes direct, merged and unrelated history without requiring the tip or connecting rows", async () => {
  const before = hash();
  const result = await repositoryQuery(createGit(repo, "git"), {
    kind: "branchFocus",
    branch: "main",
    hashes: [base, merged, side, "*"]
  });
  expect(result).toEqual({ kind: "branchFocus", tip, direct: [base], merged: [merged] });
  expect(hash()).toBe(before);
});

it("handles remote refs and changes the direct line when focusing a merged branch", async () => {
  const remote = await repositoryQuery(createGit(repo, "git"), {
    kind: "branchFocus",
    branch: "remotes/origin/main",
    hashes: [tip, main, base, merged, side]
  });
  expect(remote).toEqual({ kind: "branchFocus", tip, direct: [tip, main, base], merged: [merged] });
  expect(
    await repositoryQuery(createGit(repo, "git"), {
      kind: "branchFocus",
      branch: "merged",
      hashes: [tip, main, base, merged, side]
    })
  ).toEqual({ kind: "branchFocus", tip: merged, direct: [merged, base], merged: [] });
});

it.each(["missing", "main~1", "--all"])(
  "rejects invalid branch %s instead of colouring everything unrelated",
  async (branch) => {
    await expect(
      repositoryQuery(createGit(repo, "git"), {
        kind: "branchFocus",
        branch,
        hashes: [base]
      })
    ).rejects.toThrow();
  }
);

it("follows parent links despite skewed dates and sees a moved branch immediately", async () => {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repo }).toString().trim();
  function create(message: string, date: string, parents: string[]) {
    return execFileSync(
      "git",
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
      {
        cwd: repo,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
      }
    )
      .toString()
      .trim();
  }
  const a = create("older timestamp child", "2001-01-01T00:00:00Z", [base]);
  const b = create("newer timestamp side", "2030-01-01T00:00:00Z", [base]);
  const merge = create("skewed merge", "2002-01-01T00:00:00Z", [a, b]);
  git(["update-ref", "refs/heads/skewed", merge], repo);
  const hashes = [base, a, b, merge, "*"];
  const query = { kind: "branchFocus" as const, branch: "skewed", hashes };
  expect(await repositoryQuery(createGit(repo, "git"), query)).toEqual({
    kind: "branchFocus",
    tip: merge,
    direct: [merge, a, base],
    merged: [b]
  });
  git(["update-ref", "refs/heads/skewed", b], repo);
  expect(await repositoryQuery(createGit(repo, "git"), query)).toEqual({
    kind: "branchFocus",
    tip: b,
    direct: [b, base],
    merged: []
  });
});

it("reclassifies newly available ancestry after a shallow repository is deepened", async () => {
  const shallow = makeRepo();
  try {
    rmSync(shallow, { recursive: true, force: true });
    git(
      ["clone", "--depth=1", "--no-tags", "--branch=main", pathToFileURL(repo).href, shallow],
      repo
    );
    const query = {
      kind: "branchFocus" as const,
      branch: "main",
      hashes: [tip, main, base, merged, side]
    };
    expect(await repositoryQuery(createGit(shallow, "git"), query)).toEqual({
      kind: "branchFocus",
      tip,
      direct: [tip],
      merged: []
    });
    git(["fetch", "--unshallow"], shallow);
    expect(await repositoryQuery(createGit(shallow, "git"), query)).toEqual({
      kind: "branchFocus",
      tip,
      direct: [tip, main, base],
      merged: [merged]
    });
  } finally {
    rmSync(shallow, { recursive: true, force: true });
  }
});
