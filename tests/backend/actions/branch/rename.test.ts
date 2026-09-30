import { describe, expect, it } from "vitest";

import { renameBranch } from "@/backend/actions/branch";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput, refNames } from "@tests/backend/helpers";

// `main` is checked out; `old-name` is a second branch on the same, only commit.
const repo = freshRepo((dir) => git(["branch", "old-name"], dir));

const localBranches = () => refNames("refs/heads/", repo());

function rename(oldName: string, newName: string) {
  return renameBranch(createGit(repo(), "git"), { oldName, newName });
}

describe("renameBranch", () => {
  it("gives the branch its new name and keeps it on the same commit", async () => {
    const tipBefore = gitOutput(["rev-parse", "refs/heads/old-name"], repo());

    await expect(rename("old-name", "new-name")).resolves.toBeUndefined();

    expect(localBranches()).toEqual(["main", "new-name"]);
    expect(gitOutput(["rev-parse", "refs/heads/new-name"], repo())).toBe(tipBefore);
  });

  it("rejects a branch that does not exist and leaves the branches alone", async () => {
    await expect(rename("missing", "whatever")).rejects.toThrow();

    expect(localBranches()).toEqual(["main", "old-name"]);
  });

  it("will not rename onto the checked-out branch", async () => {
    await expect(rename("old-name", "main")).rejects.toThrow();

    expect(localBranches()).toEqual(["main", "old-name"]);
  });

  // Git refuses to overwrite a checked-out branch even when forced, so only a branch that is not
  // checked out shows that the rename itself is never forced.
  it("will not rename onto a branch that is not checked out", async () => {
    git(["branch", "taken"], repo());

    await expect(rename("old-name", "taken")).rejects.toThrow();

    expect(localBranches()).toEqual(["main", "old-name", "taken"]);
  });
});
