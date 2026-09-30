import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkoutBranch } from "@/backend/actions/branch";
import { createGit } from "@/backend/gitClient";

import { git, gitOutput, makeRepo, refNames } from "@tests/backend/helpers";

/**
 * `upstream` is a published repository with one commit; `clone` is a clone of it with `main`
 * tracking `origin/main` and a second branch, `other`, on the same commit. `start` is that commit.
 */
let upstream = "";
let clone = "";
let start = "";

beforeEach(() => {
  upstream = makeRepo();
  clone = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-checkout-")));
  git(["clone", "-q", upstream, clone], path.dirname(clone));
  git(["config", "user.name", "Clone"], clone);
  git(["config", "user.email", "clone@example.invalid"], clone);
  git(["config", "commit.gpgsign", "false"], clone);
  git(["config", "branch.autoSetupMerge", "true"], clone);
  // A fast-forward over local edits must be refused, never stashed away and back.
  git(["config", "merge.autoStash", "false"], clone);
  git(["branch", "other"], clone);
  start = gitOutput(["rev-parse", "HEAD"], clone);
});

afterEach(() => {
  for (const dir of [clone, upstream]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/** Publish a commit that rewrites `f`, and fetch it into the clone. Returns the new commit. */
function publishAndFetch() {
  fs.writeFileSync(path.join(upstream, "f"), "remote update");
  git(["add", "f"], upstream);
  git(["commit", "-q", "-m", "published"], upstream);
  git(["fetch", "-q", "origin"], clone);
  return gitOutput(["rev-parse", "HEAD"], upstream);
}

/** An empty commit on the clone's `main`, which the upstream does not have. */
function commitLocally() {
  git(["commit", "--allow-empty", "-q", "-m", "local only"], clone);
  return gitOutput(["rev-parse", "HEAD"], clone);
}

const switchTo = (branch: string) => git(["checkout", "-q", branch], clone);
const head = () => gitOutput(["rev-parse", "HEAD"], clone);
const currentBranch = () => gitOutput(["symbolic-ref", "--quiet", "--short", "HEAD"], clone);
const upstreamOf = (branch: string) =>
  gitOutput(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], clone);
const workTreeFile = () => fs.readFileSync(path.join(clone, "f"), "utf8");
const mergeHeadExists = () => fs.existsSync(path.join(clone, ".git", "MERGE_HEAD"));
const status = () => gitOutput(["status", "--porcelain", "--untracked-files=all"], clone);

function checkout(branchName: string, remoteBranch: string | null, fetch?: boolean) {
  return checkoutBranch(createGit(clone, "git"), {
    branchName,
    remoteBranch,
    ...(fetch === undefined ? {} : { fetch })
  });
}

/** The reason a promise was rejected with, which must be an `Error`. */
async function rejectionOf(promise: Promise<unknown>) {
  const reason = await promise.then(
    () => "resolved",
    (error: unknown) => error
  );
  expect(reason).toBeInstanceOf(Error);
  return reason as Error;
}

describe("checking out a local branch", () => {
  it("only switches, without catching up with the remote", async () => {
    publishAndFetch();
    switchTo("other");

    await expect(checkout("main", null)).resolves.toBeUndefined();

    expect(currentBranch()).toBe("main");
    expect(head()).toBe(start);
  });

  it("refuses a branch that does not exist with the product's own message", async () => {
    const error = await rejectionOf(checkout("nonexistent", null));

    expect(error.message).toBe("The branch changed. Refresh the graph and try again.");
    expect(currentBranch()).toBe("main");
    expect(refNames("refs/heads/", clone)).toEqual(["main", "other"]);
  });
});

describe("checking out from a remote-tracking branch", () => {
  it("creates a new branch there that tracks it, even when Git would not by itself", async () => {
    const published = publishAndFetch();
    git(["config", "branch.autoSetupMerge", "false"], clone);

    await expect(checkout("from-remote", "origin/main")).resolves.toBeUndefined();

    expect(currentBranch()).toBe("from-remote");
    expect(head()).toBe(published);
    expect(upstreamOf("from-remote")).toBe("origin/main");
  });

  it("switches to an existing branch that is already where the remote is", async () => {
    const remoteTip = gitOutput(["rev-parse", "refs/remotes/origin/main"], clone);

    await expect(checkout("other", "origin/main")).resolves.toBeUndefined();

    expect(currentBranch()).toBe("other");
    expect(head()).toBe(remoteTip);
  });

  it("switches to an existing branch and fast-forwards it to the remote", async () => {
    const published = publishAndFetch();
    switchTo("other");

    await expect(checkout("main", "origin/main")).resolves.toBeUndefined();

    expect(currentBranch()).toBe("main");
    expect(head()).toBe(published);
    expect(upstreamOf("main")).toBe("origin/main");
    expect(workTreeFile()).toBe("remote update");
  });

  it("fast-forwards without a merge commit even when merge.ff asks for one", async () => {
    const published = publishAndFetch();
    git(["config", "merge.ff", "false"], clone);

    await expect(checkout("main", "origin/main")).resolves.toBeUndefined();

    expect(head()).toBe(published);
    expect(status()).toBe("");
  });

  it("does not move a branch that is ahead of the remote back to it", async () => {
    const localTip = commitLocally();
    switchTo("other");

    await expect(checkout("main", "origin/main")).resolves.toBeUndefined();

    expect(currentBranch()).toBe("main");
    expect(head()).toBe(localTip);
  });

  it("refuses to merge a branch that has diverged from the remote", async () => {
    const localTip = commitLocally();
    publishAndFetch();

    await expect(checkout("main", "origin/main")).rejects.toThrow();

    expect(head()).toBe(localTip);
    expect(status()).toBe("");
    expect(mergeHeadExists()).toBe(false);
  });

  it("refuses a fast-forward that would overwrite uncommitted edits", async () => {
    publishAndFetch();
    fs.writeFileSync(path.join(clone, "f"), "unfinished local work");

    await expect(checkout("main", "origin/main")).rejects.toThrow();

    expect(head()).toBe(start);
    expect(workTreeFile()).toBe("unfinished local work");
    expect(mergeHeadExists()).toBe(false);
  });

  it("does not rely on `git branch` output that colour settings change", async () => {
    git(["config", "color.branch", "always"], clone);
    const published = publishAndFetch();
    switchTo("other");

    await expect(checkout("main", "origin/main")).resolves.toBeUndefined();

    expect(currentBranch()).toBe("main");
    expect(head()).toBe(published);
  });
});

describe("a remote-tracking ref whose remote is not configured", () => {
  beforeEach(() => {
    // Only `origin` is configured, so nothing names the remote `team` this ref belongs to.
    git(["update-ref", "refs/remotes/team/mirror/topic", start], clone);
  });

  it("cannot be fetched, and the refusal leaves no branch behind", async () => {
    const error = await rejectionOf(checkout("mirror/topic", "team/mirror/topic", true));

    expect(error.message).toBe("The remote for 'team/mirror/topic' is no longer configured.");
    expect(refNames("refs/heads/", clone)).toEqual(["main", "other"]);
    expect(currentBranch()).toBe("main");
  });

  it("can be checked out without a fetch, as a branch that tracks nothing", async () => {
    await expect(checkout("mirror/topic", "team/mirror/topic", false)).resolves.toBeUndefined();

    expect(currentBranch()).toBe("mirror/topic");
    expect(head()).toBe(start);
    expect(() => gitOutput(["config", "branch.mirror/topic.remote"], clone)).toThrow();
  });
});
