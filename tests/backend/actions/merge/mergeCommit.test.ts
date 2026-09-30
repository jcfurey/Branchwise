import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mergeCommit } from "@/backend/actions/merge";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

// `feature` is one commit ahead of `main`, which is checked out, so a merge can fast-forward.
const repo = freshRepo((dir) => {
  git(["checkout", "-q", "-b", "feature"], dir);
  fs.writeFileSync(path.join(dir, "feature.txt"), "feature");
  git(["add", "feature.txt"], dir);
  git(["commit", "-q", "-m", "feature work"], dir);
  git(["checkout", "-q", "main"], dir);
});

const read = (args: string[]) => gitOutput(args, repo());

const merge = (commitHash: string, createNewCommit: boolean) =>
  mergeCommit(createGit(repo(), "git"), { commitHash, createNewCommit }, "git");

describe("mergeCommit", () => {
  it("fast-forwards when no merge commit is asked for", async () => {
    const feature = read(["rev-parse", "refs/heads/feature"]);

    await expect(merge(feature, false)).resolves.toBeUndefined();

    expect(read(["rev-parse", "refs/heads/main"])).toBe(feature);
  });

  it("makes a merge commit with Git's own subject when one is asked for", async () => {
    const feature = read(["rev-parse", "refs/heads/feature"]);
    const mainBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(merge(feature, true)).resolves.toBeUndefined();

    expect(read(["rev-parse", "HEAD^1"])).toBe(mainBefore);
    expect(read(["rev-parse", "HEAD^2"])).toBe(feature);
    expect(read(["log", "-1", "--format=%s"])).toBe(`Merge commit '${feature}'`);
  });

  it.each([false, true])(
    "changes nothing for a commit the branch already contains (merge commit asked: %s)",
    async (createNewCommit) => {
      const mainBefore = read(["rev-parse", "refs/heads/main"]);

      await expect(merge(mainBefore, createNewCommit)).resolves.toBeUndefined();

      expect(read(["rev-parse", "refs/heads/main"])).toBe(mainBefore);
      expect(read(["status", "--porcelain", "--untracked-files=all"])).toBe("");
    }
  );

  it("rejects a commit that does not exist and leaves the branch alone", async () => {
    const mainBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(merge("deadbeef".repeat(5), false)).rejects.toThrow();

    expect(read(["rev-parse", "refs/heads/main"])).toBe(mainBefore);
  });
});
