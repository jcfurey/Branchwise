import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mergeBranch, mergeCommit } from "@/backend/actions/merge";
import { createGit } from "@/backend/gitClient";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

const STOPPED_ON_CONFLICTS =
  "The merge stopped on conflicts. Resolve and stage the conflicted files, then continue or abort the merge from the status strip.";

/**
 * A stand-in for a Git that answers in another language: it runs the real Git, prints everything
 * it said on standard output alone, with the English conflict wording translated, and exits with
 * Git's status.
 */
const TRANSLATING_GIT = `#!/bin/sh
said=$(git "$@" 2>&1)
status=$?
printf '%s\\n' "$said" | sed -e 's/CONFLICT/KONFLIKT/g' -e 's/Automatic merge failed/Automatischer Merge fehlgeschlagen/g'
exit $status
`;

/** `main` and `topic` each rewrote `f` differently, so merging one into the other conflicts. */
let repo = "";
/** An empty folder beside the repository, for the translating executable. */
let binFolder = "";

function commitF(text: string) {
  fs.writeFileSync(path.join(repo, "f"), text);
  git(["commit", "-q", "-am", `f says ${text}`], repo);
}

beforeEach(() => {
  repo = makeRepo();
  binFolder = fs.realpathSync.native(fs.mkdtempSync(path.join(path.dirname(repo), "ngg-git-")));
  git(["checkout", "-q", "-b", "topic"], repo);
  commitF("topic");
  git(["checkout", "-q", "main"], repo);
  commitF("main");
});

afterEach(() => {
  for (const dir of [binFolder, repo]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function translatingGit() {
  const executable = path.join(binFolder, "git");
  fs.writeFileSync(executable, TRANSLATING_GIT);
  fs.chmodSync(executable, 0o755);
  return executable;
}

const mergeInProgress = () => fs.existsSync(path.join(repo, ".git", "MERGE_HEAD"));

/** The reason a promise was rejected with, which must be an `Error`. */
async function rejectionOf(promise: Promise<unknown>) {
  const reason = await promise.then(
    () => "resolved",
    (error: unknown) => error
  );
  expect(reason).toBeInstanceOf(Error);
  return reason as Error;
}

/** Both merge actions report a stopped merge by Git's state, whatever `executable` prints. */
async function expectConflictsRecognised(executable: string) {
  const branchMerge = mergeBranch(
    createGit(repo, executable),
    { branchName: "topic", createNewCommit: true },
    executable
  );
  expect((await rejectionOf(branchMerge)).message).toBe(STOPPED_ON_CONFLICTS);
  expect(mergeInProgress()).toBe(true);

  git(["merge", "--abort"], repo);
  expect(mergeInProgress()).toBe(false);

  const commitMerge = mergeCommit(
    createGit(repo, executable),
    { commitHash: gitOutput(["rev-parse", "refs/heads/topic"], repo), createNewCommit: false },
    executable
  );
  expect((await rejectionOf(commitMerge)).message).toBe(STOPPED_ON_CONFLICTS);
  expect(mergeInProgress()).toBe(true);
}

describe("a merge that stops on conflicts", () => {
  it("is reported as such with Git's own output", async () => {
    await expectConflictsRecognised("git");
  });

  // Node starts executables on Windows without a POSIX shell, so a `#!` script cannot stand in
  // for git.exe there; the case is registered anyway, so reports show it as skipped.
  it.skipIf(process.platform === "win32")(
    "is reported as such when Git's messages are translated",
    async () => {
      await expectConflictsRecognised(translatingGit());
    }
  );
});

describe("a merge that fails for another reason", () => {
  it("rejects with Git's text, not the conflict message, and starts no merge", async () => {
    fs.writeFileSync(path.join(repo, "f"), "uncommitted");

    const error = await rejectionOf(
      mergeBranch(createGit(repo, "git"), { branchName: "topic", createNewCommit: true }, "git")
    );

    expect(error.message).not.toContain("The merge stopped on conflicts");
    expect(error.message.trim()).not.toBe("");
    expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("uncommitted");
    expect(mergeInProgress()).toBe(false);
  });
});
