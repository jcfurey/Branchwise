import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadAppliedCommits } from "@/backend/queries/appliedCommits";
import { loadCommitStats } from "@/backend/queries/commitStats";
import { loadConflictForecast } from "@/backend/queries/conflictForecast";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

// A clone made with `--filter=blob:none` holds every commit but only the files it has checked
// out. Git fetches a missing file the moment a command needs it. What the graph reads on its
// own, to fill a column or a mark, must not set off downloads nobody asked for.

let origin = "";
let clone = "";
let older = "";

/** How many objects the clone holds, loose and packed. */
const objects = () =>
  gitOutput(["cat-file", "--batch-all-objects", "--batch-check", "--unordered"], clone).split("\n")
    .length;

beforeEach(() => {
  origin = makeRepo();
  git(["config", "uploadpack.allowFilter", "true"], origin);
  git(["config", "uploadpack.allowAnySHA1InWant", "true"], origin);
  const write = (file: string, text: string, message: string) => {
    fs.writeFileSync(path.join(origin, file), text);
    git(["add", "--", file], origin);
    git(["commit", "-q", "-m", message], origin);
    return gitOutput(["rev-parse", "HEAD"], origin);
  };
  write("a", "one\n", "first version of a");
  older = write("a", "two\n", "second version of a");
  write("b", "b\n", "add b");
  git(["checkout", "-q", "-b", "clash", older], origin);
  write("a", "theirs\n", "a on clash");
  git(["checkout", "-q", "main"], origin);
  write("a", "ours\n", "a on main");

  clone = origin + "-clone";
  execFileSync("git", ["clone", "-q", "--filter=blob:none", "file://" + origin, clone], {
    stdio: "pipe"
  });
  git(["config", "user.name", "T"], clone);
  git(["config", "user.email", "t@t.com"], clone);
  git(["branch", "-q", "clash", "origin/clash"], clone);
});
afterEach(() => {
  for (const dir of [origin, clone]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

it("is a clone that lacks the older versions of its files", () => {
  // The fixture's own claim: the old contents of `a` are not there until something asks.
  const missing = gitOutput(["rev-list", "--objects", "--missing=print", "--all"], clone)
    .split("\n")
    .filter((line) => line.startsWith("?"));
  expect(missing.length).toBeGreaterThan(0);
});

it("does not download files to count a commit's changes", async () => {
  const before = objects();

  const stats = await loadCommitStats(createGit(clone, "git"), [older]);

  expect(objects()).toBe(before);
  // Without the two versions there is nothing to count, and the answer says so by leaving the
  // commit out, as for a commit that is gone.
  expect(stats).toEqual({});
});

it("does not download files to forecast conflicts", async () => {
  const before = objects();

  const forecast = await loadConflictForecast(createGit(clone, "git"));

  expect(objects()).toBe(before);
  expect(forecast).toEqual([]);
});

it("does not download files to mark the commits of a branch that HEAD already has", async () => {
  const before = objects();

  const applied = await loadAppliedCommits(createGit(clone, "git"), "clash");

  expect(objects()).toBe(before);
  expect(applied).toMatchObject({ skipped: true, applied: [] });
});

it("still counts and forecasts in a clone that only left out large files", async () => {
  // Such a clone has nearly every file, and what it lacks is fetched only when it is needed.
  git(["config", "remote.origin.partialclonefilter", "blob:limit=1m"], clone);

  expect(Object.keys(await loadCommitStats(createGit(clone, "git"), [older]))).toEqual([older]);
  expect(await loadConflictForecast(createGit(clone, "git"))).toMatchObject([
    { branch: "clash", files: ["a"] }
  ]);
});
