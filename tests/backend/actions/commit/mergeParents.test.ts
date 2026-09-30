import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { cherrypickCommit, revertCommit } from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

// main: init - P1 - M, where M merges side's P2, which adds `s`. `target` stays at P1.
const repo = freshRepo((dir) => {
  git(["checkout", "-q", "-b", "side"], dir);
  fs.writeFileSync(path.join(dir, "s"), "from side\n");
  git(["add", "s"], dir);
  git(["commit", "-q", "-m", "P2 adds s"], dir);
  git(["checkout", "-q", "main"], dir);
  fs.writeFileSync(path.join(dir, "m"), "from main\n");
  git(["add", "m"], dir);
  git(["commit", "-q", "-m", "P1 on main"], dir);
  git(["merge", "-q", "--no-ff", "-m", "Bring side in", "side"], dir);
  git(["branch", "target", "main^1"], dir);
});

const rev = (name: string) => gitOutput(["rev-parse", name], repo());
const exists = (file: string) => fs.existsSync(path.join(repo(), file));

describe("choosing a merge parent", () => {
  it("cherry-picks what a merge brought in relative to the chosen parent", async () => {
    const merge = rev("main");
    git(["checkout", "-q", "target"], repo());
    await cherrypickCommit(createGit(repo(), "git"), { commitHash: merge, parentIndex: 1 });

    expect(rev("HEAD^")).toBe(rev("main^1"));
    expect(gitOutput(["rev-list", "--parents", "-n", "1", "HEAD"], repo()).split(" ")).toHaveLength(
      2
    );
    expect(gitOutput(["log", "-1", "--format=%s"], repo())).toBe("Bring side in");
    expect(gitOutput(["diff", "--name-status", "HEAD^", "HEAD"], repo())).toBe("A\ts");
  });

  it("lets Git refuse a merge picked without a parent", async () => {
    const merge = rev("main");
    git(["checkout", "-q", "target"], repo());
    const before = rev("HEAD");

    await expect(
      cherrypickCommit(createGit(repo(), "git"), { commitHash: merge, parentIndex: 0 })
    ).rejects.toThrow();
    expect(rev("HEAD")).toBe(before);
    expect(exists("s")).toBe(false);
  });

  it("reverts the side a merge brought in", async () => {
    const merge = rev("main");
    await revertCommit(createGit(repo(), "git"), { commitHash: merge, parentIndex: 1 });

    expect(rev("HEAD^")).toBe(merge);
    expect(exists("s")).toBe(false);
    expect(exists("m")).toBe(true);
  });
});
