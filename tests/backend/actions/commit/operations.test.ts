import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkoutCommit,
  cherrypickCommit,
  resetToCommit,
  revertCommit
} from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";

import { commitFile, hasGitFile, readFile, run, sandbox, writeFile } from "@tests/backend/sandbox";

const box = sandbox();

/**
 * A merge commit whose second parent, from branch `side`, adds `g`. It is made on `into`, which
 * starts at `main`'s only commit.
 */
function mergeOfSide(into: string) {
  const repo = box.repo();
  run(repo, "checkout", "-q", "-b", "side");
  commitFile(repo, "g", "from side", "add g");
  run(repo, "checkout", "-q", "main");
  if (into !== "main") {
    run(repo, "checkout", "-q", "-b", into);
  }
  run(repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  const merge = run(repo, "rev-parse", "HEAD");
  run(repo, "checkout", "-q", "main");
  return { repo, merge };
}

/** Commits "second" and "third" on `main`, each rewriting `f`, so reverting "second" conflicts. */
function conflictingHistory() {
  const repo = box.repo();
  const second = commitFile(repo, "f", "second", "second");
  commitFile(repo, "f", "third", "third");
  return { repo, second };
}

const conflicted = (repo: string) => run(repo, "diff", "--name-only", "--diff-filter=U");

describe("merge commits", () => {
  it("cherry-picks a merge only against a chosen parent", async () => {
    const { repo, merge } = mergeOfSide("m2");
    const head = run(repo, "rev-parse", "HEAD");
    await expect(
      cherrypickCommit(createGit(repo, "git"), { commitHash: merge, parentIndex: 0 })
    ).rejects.toThrow();
    expect(run(repo, "rev-parse", "HEAD")).toBe(head);

    await expect(
      cherrypickCommit(createGit(repo, "git"), { commitHash: merge, parentIndex: 1 })
    ).resolves.toBeUndefined();
    expect(run(repo, "rev-parse", "HEAD^")).toBe(head);
    expect(run(repo, "ls-tree", "--name-only", "HEAD", "g")).toBe("g");
  });

  it("reverts a merge against its first parent", async () => {
    const { repo, merge } = mergeOfSide("main");
    await expect(
      revertCommit(createGit(repo, "git"), { commitHash: merge, parentIndex: 1 })
    ).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(repo, "g"))).toBe(false);
    expect(run(repo, "log", "-1", "--format=%s")).toBe('Revert "merge side"');
    expect(run(repo, "rev-parse", "HEAD^")).toBe(merge);
  });
});

describe("interrupted operations", () => {
  it("leaves a conflicted cherry-pick in progress", async () => {
    const repo = box.repo();
    run(repo, "checkout", "-q", "-b", "side");
    const picked = commitFile(repo, "f", "side's f", "side change");
    run(repo, "checkout", "-q", "main");
    commitFile(repo, "f", "main's f", "main change");

    await expect(
      cherrypickCommit(createGit(repo, "git"), { commitHash: picked, parentIndex: 0 })
    ).rejects.toThrow();
    expect(hasGitFile(repo, "CHERRY_PICK_HEAD")).toBe(true);
    expect(conflicted(repo)).toBe("f");
    expect(run(repo, "status", "--porcelain", "--untracked-files=no")).toBe("UU f");
  });

  it("leaves a conflicted revert in progress", async () => {
    const { repo, second } = conflictingHistory();
    await expect(
      revertCommit(createGit(repo, "git"), { commitHash: second, parentIndex: 0 })
    ).rejects.toThrow();
    expect(hasGitFile(repo, "REVERT_HEAD")).toBe(true);
    expect(conflicted(repo)).toBe("f");
  });

  it("clears an interrupted revert with a hard reset", async () => {
    const { repo, second } = conflictingHistory();
    const head = run(repo, "rev-parse", "HEAD");
    await expect(
      revertCommit(createGit(repo, "git"), { commitHash: second, parentIndex: 0 })
    ).rejects.toThrow();
    await expect(
      resetToCommit(createGit(repo, "git"), { commitHash: head, resetMode: "hard" })
    ).resolves.toBeUndefined();
    expect(hasGitFile(repo, "REVERT_HEAD")).toBe(false);
    expect(run(repo, "status", "--porcelain", "--untracked-files=no")).toBe("");
    expect(readFile(repo, "f")).toBe("third");
  });
});

describe("checking out a commit over local changes", () => {
  it("refuses and keeps the changes", async () => {
    const repo = box.repo();
    commitFile(repo, "f", "second", "second");
    const first = run(repo, "rev-parse", "HEAD^");
    writeFile(repo, "f", "not committed");
    await expect(checkoutCommit(createGit(repo, "git"), { commitHash: first })).rejects.toThrow();
    expect(run(repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(readFile(repo, "f")).toBe("not committed");
  });
});
