import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deleteBranch } from "@/backend/actions/branch";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, refNames } from "@tests/backend/helpers";

// `merged` sits on `main`'s commit; `unmerged` has one commit of its own that `main` lacks.
const repo = freshRepo((dir) => {
  git(["branch", "merged"], dir);
  git(["checkout", "-q", "-b", "unmerged"], dir);
  fs.writeFileSync(path.join(dir, "g"), "y");
  git(["add", "g"], dir);
  git(["commit", "-q", "-m", "only on unmerged"], dir);
  git(["checkout", "-q", "main"], dir);
});

const localBranches = () => refNames("refs/heads/", repo());

function remove(branchName: string, forceDelete: boolean) {
  return deleteBranch(createGit(repo(), "git"), { branchName, forceDelete });
}

describe("deleteBranch", () => {
  it("deletes a merged branch without force", async () => {
    await expect(remove("merged", false)).resolves.toBeUndefined();

    expect(localBranches()).toEqual(["main", "unmerged"]);
  });

  it("keeps an unmerged branch when force is off", async () => {
    await expect(remove("unmerged", false)).rejects.toThrow();

    expect(localBranches()).toEqual(["main", "merged", "unmerged"]);
  });

  it("deletes an unmerged branch when force is on", async () => {
    await expect(remove("unmerged", true)).resolves.toBeUndefined();

    expect(localBranches()).toEqual(["main", "merged"]);
  });

  it("rejects a missing branch even with force, deleting nothing", async () => {
    await expect(remove("nonexistent", true)).rejects.toThrow();

    expect(localBranches()).toEqual(["main", "merged", "unmerged"]);
  });
});
