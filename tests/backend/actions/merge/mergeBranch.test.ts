import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mergeBranch } from "@/backend/actions/merge";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

/** Commit a new file on the checked-out branch. */
function addFile(dir: string, name: string) {
  fs.writeFileSync(path.join(dir, name), name);
  git(["add", name], dir);
  git(["commit", "-q", "-m", `add ${name}`], dir);
}

// `feature` is one commit ahead of `main`, which is checked out. The subject Git gives a merge
// commit names the branch, so the name `feature` matters below.
const repo = freshRepo((dir) => {
  git(["checkout", "-q", "-b", "feature"], dir);
  addFile(dir, "feature.txt");
  git(["checkout", "-q", "main"], dir);
});

const read = (args: string[]) => gitOutput(args, repo());

const merge = (branchName: string, createNewCommit: boolean) =>
  mergeBranch(createGit(repo(), "git"), { branchName, createNewCommit }, "git");

describe("mergeBranch", () => {
  it("fast-forwards when no merge commit is asked for", async () => {
    await expect(merge("feature", false)).resolves.toBeUndefined();

    expect(read(["rev-parse", "refs/heads/main"])).toBe(read(["rev-parse", "refs/heads/feature"]));
  });

  it("makes a merge commit that names the branch by its short name", async () => {
    const feature = read(["rev-parse", "refs/heads/feature"]);
    const mainBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(merge("feature", true)).resolves.toBeUndefined();

    expect(read(["rev-parse", "HEAD^1"])).toBe(mainBefore);
    expect(read(["rev-parse", "HEAD^2"])).toBe(feature);
    expect(read(["log", "-1", "--format=%s"])).toBe("Merge branch 'feature'");
  });

  it("still makes a merge commit when the branches have diverged", async () => {
    addFile(repo(), "main.txt");
    const feature = read(["rev-parse", "refs/heads/feature"]);
    const mainBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(merge("feature", false)).resolves.toBeUndefined();

    expect(read(["rev-parse", "HEAD^1"])).toBe(mainBefore);
    expect(read(["rev-parse", "HEAD^2"])).toBe(feature);
  });

  it("rejects a branch that does not exist and leaves the current one alone", async () => {
    const mainBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(merge("nonexistent-branch", false)).rejects.toThrow();

    expect(read(["rev-parse", "refs/heads/main"])).toBe(mainBefore);
  });
});
