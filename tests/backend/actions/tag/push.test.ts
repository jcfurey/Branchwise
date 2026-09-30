import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pushTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput, refNames } from "@tests/backend/helpers";

const repo = freshRepo();

/** A bare `origin` that has `main` but none of the repository's tags. */
let bare = "";

// Registered after `freshRepo`, so its repository already exists here and is deleted after this.
beforeEach(() => {
  bare = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-test-bare-")));
  git(["init", "-q", "--bare"], bare);
  git(["remote", "add", "origin", bare], repo());
  git(["push", "-q", "origin", "main"], repo());
  git(["tag", "v1.0"], repo());
  git(["tag", "v2.0"], repo());
});

afterEach(() => {
  fs.rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const push = (tagName: string) => pushTag(createGit(repo(), "git"), { tagName, remote: "origin" });

describe("pushTag", () => {
  it("pushes only the named tag, pointing at its commit", async () => {
    await expect(push("v1.0")).resolves.toBeUndefined();

    expect(refNames("refs/tags/", bare)).toEqual(["v1.0"]);
    expect(gitOutput(["rev-parse", "refs/tags/v1.0"], bare)).toBe(
      gitOutput(["rev-parse", "HEAD"], repo())
    );
  });

  it("rejects a tag the repository does not have and pushes nothing", async () => {
    await expect(push("v99.0-nonexistent")).rejects.toThrow();

    expect(refNames("refs/tags/", bare)).toEqual([]);
  });
});
