import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { revertCommit } from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

// HEAD is a commit that adds `g`.
const repo = freshRepo((dir) => {
  fs.writeFileSync(path.join(dir, "g"), "revert-me");
  git(["add", "g"], dir);
  git(["commit", "-q", "-m", "add g"], dir);
});

const read = (args: string[]) => gitOutput(args, repo());

const revert = (commitHash: string) =>
  revertCommit(createGit(repo(), "git"), { commitHash, parentIndex: 0 });

describe("revertCommit", () => {
  it.each([
    ["its full ID", (id: string) => id],
    ["an abbreviated ID", (id: string) => id.slice(0, 7)]
  ])("commits the undoing of a commit named by %s", async (_, spell) => {
    const reverted = read(["rev-parse", "HEAD"]);

    await expect(revert(spell(reverted))).resolves.toBeUndefined();

    expect(read(["rev-parse", "HEAD^"])).toBe(reverted);
    expect(fs.existsSync(path.join(repo(), "g"))).toBe(false);
    expect(read(["status", "--porcelain", "--untracked-files=all"])).toBe("");
  });

  it("rejects a commit that does not exist and leaves HEAD alone", async () => {
    const headBefore = read(["rev-parse", "HEAD"]);

    await expect(revert("0".repeat(40))).rejects.toThrow();

    expect(read(["rev-parse", "HEAD"])).toBe(headBefore);
  });
});
