import { describe, expect, it } from "vitest";

import { checkoutCommit } from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

// `main` gains an empty second commit, so its tip and its parent differ.
const repo = freshRepo((dir) => git(["commit", "--allow-empty", "-q", "-m", "second"], dir));

const read = (args: string[]) => gitOutput(args, repo());

const checkout = (commitHash: string) => checkoutCommit(createGit(repo(), "git"), { commitHash });

describe("checkoutCommit", () => {
  it("detaches HEAD at the commit and leaves the branch where it was", async () => {
    const target = read(["rev-parse", "HEAD^"]);
    const branchTip = read(["rev-parse", "refs/heads/main"]);

    await expect(checkout(target)).resolves.toBeUndefined();

    expect(read(["rev-parse", "HEAD"])).toBe(target);
    // A detached HEAD is not a symbolic ref, so Git exits non-zero and the helper throws.
    expect(() => read(["symbolic-ref", "--quiet", "HEAD"])).toThrow();
    expect(read(["rev-parse", "refs/heads/main"])).toBe(branchTip);
  });

  it("rejects a commit that does not exist and stays on the branch", async () => {
    await expect(checkout("0".repeat(40))).rejects.toThrow();

    expect(read(["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
  });
});
