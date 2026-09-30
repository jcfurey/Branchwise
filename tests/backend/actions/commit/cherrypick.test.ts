import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cherrypickCommit } from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

/**
 * `side` adds `g` in a commit that `main` lacks. `main` then gets an empty commit of its own, so
 * that a pick cannot rebuild the picked commit exactly when it happens within the same second.
 */
const repo = freshRepo((dir) => {
  git(["checkout", "-q", "-b", "side"], dir);
  fs.writeFileSync(path.join(dir, "g"), "cherry");
  git(["add", "g"], dir);
  git(["commit", "-q", "-m", "cherry commit"], dir);
  git(["checkout", "-q", "main"], dir);
  git(["commit", "--allow-empty", "-q", "-m", "main moves on"], dir);
});

const read = (args: string[]) => gitOutput(args, repo());

const pick = (commitHash: string) =>
  cherrypickCommit(createGit(repo(), "git"), { commitHash, parentIndex: 0 });

describe("cherrypickCommit", () => {
  it.each([
    ["its full ID", (id: string) => id],
    ["an abbreviated ID", (id: string) => id.slice(0, 7)]
  ])("copies a commit named by %s onto the current branch", async (_, spell) => {
    const picked = read(["rev-parse", "refs/heads/side"]);
    const tipBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(pick(spell(picked))).resolves.toBeUndefined();

    expect(read(["rev-parse", "HEAD^"])).toBe(tipBefore);
    expect(read(["log", "-1", "--format=%s"])).toBe("cherry commit");
    expect(fs.readFileSync(path.join(repo(), "g"), "utf8")).toBe("cherry");
    expect(read(["rev-parse", "HEAD"])).not.toBe(picked);
  });

  it("rejects a commit that does not exist and leaves the branch alone", async () => {
    const tipBefore = read(["rev-parse", "refs/heads/main"]);

    await expect(pick("0".repeat(40))).rejects.toThrow();

    expect(read(["rev-parse", "refs/heads/main"])).toBe(tipBefore);
  });
});
