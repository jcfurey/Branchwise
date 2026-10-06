import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

import { afterAll, beforeAll, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadRefTargets } from "@/backend/queries/refTargets";

import { gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
let first: string;
let second: string;

/** Runs Git as if at `date`, so the order by date does not depend on the clock. */
function gitAt(date: string, args: string[]) {
  execFileSync("git", args, {
    cwd: repo,
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  });
}

beforeAll(() => {
  repo = makeRepo();
  first = gitOutput(["rev-parse", "HEAD"], repo);
  gitAt("2030-01-01T00:00:00Z", ["branch", "feature/older"]);
  gitAt("2030-01-01T00:00:00Z", ["tag", "light"]);
  fs.writeFileSync(`${repo}/f`, "second");
  gitAt("2030-01-02T00:00:00Z", ["commit", "-q", "-am", "Second change\n\nWith a body."]);
  second = gitOutput(["rev-parse", "HEAD"], repo);
  gitAt("2030-01-03T00:00:00Z", ["tag", "-a", "release/1.0", "-m", "Release notes"]);
  gitAt("2030-01-03T00:00:00Z", ["update-ref", "refs/remotes/mirror/main", second]);
  gitAt("2030-01-03T00:00:00Z", [
    "symbolic-ref",
    "refs/remotes/mirror/HEAD",
    "refs/remotes/mirror/main"
  ]);
  gitAt("2030-01-03T00:00:00Z", ["tag", "tree-tag", gitOutput(["rev-parse", "HEAD^{tree}"], repo)]);
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

it("lists branches, remote branches and tags, newest first, with their commits' subjects", async () => {
  const targets = await loadRefTargets(createGit(repo, "git"));
  expect(targets).toEqual([
    { type: "head", name: "main", hash: second, subject: "Second change" },
    { type: "head", name: "feature/older", hash: first, subject: "init" },
    // The symbolic mirror/HEAD is not a branch of its own.
    { type: "remote", name: "mirror/main", hash: second, subject: "Second change" },
    // An annotated tag leads to its commit; a tag of a tree, which has no row, is left out.
    { type: "tag", name: "release/1.0", hash: second, subject: "Second change" },
    { type: "tag", name: "light", hash: first, subject: "init" }
  ]);
});
