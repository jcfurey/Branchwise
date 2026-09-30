import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resetToCommit } from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";
import type { GitResetMode } from "@/backend/types";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

// `f` holds "x" in the first commit and "y" in the second, which is HEAD; nothing is pending.
const repo = freshRepo((dir) => {
  fs.writeFileSync(path.join(dir, "f"), "y");
  git(["commit", "-q", "-am", "f becomes y"], dir);
});

const read = (args: string[]) => gitOutput(args, repo());

const reset = (commitHash: string, resetMode: GitResetMode) =>
  resetToCommit(createGit(repo(), "git"), { commitHash, resetMode });

/** Where HEAD is, and what `f` holds in the index and in the work tree. */
function state() {
  return {
    head: read(["rev-parse", "HEAD"]),
    staged: read(["cat-file", "blob", ":0:f"]),
    workTree: fs.readFileSync(path.join(repo(), "f"), "utf8")
  };
}

describe("resetToCommit", () => {
  it.each<[GitResetMode, string, string]>([
    ["soft", "y", "y"],
    ["mixed", "x", "y"],
    ["hard", "x", "x"]
  ])(
    "a %s reset moves HEAD back and leaves f staged as %j and on disk as %j",
    async (mode, staged, workTree) => {
      const target = read(["rev-parse", "HEAD^"]);

      await expect(reset(target, mode)).resolves.toBeUndefined();

      expect(state()).toEqual({ head: target, staged, workTree });
    }
  );

  it("accepts an abbreviated commit ID", async () => {
    const target = read(["rev-parse", "HEAD^"]);

    await expect(reset(target.slice(0, 7), "hard")).resolves.toBeUndefined();

    expect(state()).toEqual({ head: target, staged: "x", workTree: "x" });
  });

  it("rejects a commit that does not exist and leaves HEAD alone", async () => {
    const headBefore = read(["rev-parse", "HEAD"]);

    await expect(reset("0".repeat(40), "hard")).rejects.toThrow();

    expect(read(["rev-parse", "HEAD"])).toBe(headBefore);
  });
});
