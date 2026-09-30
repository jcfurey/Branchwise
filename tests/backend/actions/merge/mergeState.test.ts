import { describe, expect, it } from "vitest";

import { mergeBranch, mergeCommit } from "@/backend/actions/merge";
import { createGit } from "@/backend/gitClient";

import { recordingGit } from "@tests/backend/queries/loadCommits/fixtures";
import {
  commitFile,
  hasGitFile,
  onWindows,
  readFile,
  run,
  sandbox,
  writeFile
} from "@tests/backend/sandbox";

const box = sandbox();
const STOPPED = "The merge stopped on conflicts";

/** `feature` adds `feature.txt` on top of `main`, which is checked out. */
function withFeature() {
  const repo = box.repo();
  run(repo, "checkout", "-q", "-b", "feature");
  const feature = commitFile(repo, "feature.txt", "feature", "feature work");
  run(repo, "checkout", "-q", "main");
  return { repo, feature, main: run(repo, "rev-parse", "main") };
}

/** `topic` and `main` each rewrite `f`, so merging `topic` conflicts. */
function withConflict() {
  const repo = box.repo();
  run(repo, "checkout", "-q", "-b", "topic");
  commitFile(repo, "f", "topic's f", "topic");
  run(repo, "checkout", "-q", "main");
  commitFile(repo, "f", "main's f", "main");
  return repo;
}

async function failure(promise: Promise<unknown>) {
  const outcome = await promise.then(
    () => new Error("resolved"),
    (reason: unknown) => reason
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}

describe("the merge process", () => {
  it.skipIf(onWindows)("alone runs the given executable", async () => {
    const { repo } = withFeature();
    const recorder = recordingGit(box.folder("bin"));
    await expect(
      mergeBranch(
        createGit(repo, "git"),
        { branchName: "feature", createNewCommit: true },
        recorder.gitPath
      )
    ).resolves.toBeUndefined();
    expect(recorder.runs()).toEqual(["merge --no-ff --no-edit --end-of-options feature"]);
  });

  it("merges by the full ref when a tag has the branch's name", async () => {
    const { repo, feature } = withFeature();
    run(repo, "tag", "feature", "main");
    await mergeBranch(
      createGit(repo, "git"),
      { branchName: "feature", createNewCommit: true },
      "git"
    );
    expect(run(repo, "rev-parse", "HEAD^2")).toBe(feature);
    expect(run(repo, "log", "-1", "--format=%s")).toBe("Merge branch 'refs/heads/feature'");
  });

  it("keeps uncommitted changes the merge does not touch", async () => {
    const { repo, feature, main } = withFeature();
    writeFile(repo, "f", "not committed");
    await mergeBranch(
      createGit(repo, "git"),
      { branchName: "feature", createNewCommit: true },
      "git"
    );
    expect(run(repo, "rev-parse", "HEAD^1")).toBe(main);
    expect(run(repo, "rev-parse", "HEAD^2")).toBe(feature);
    expect(readFile(repo, "f")).toBe("not committed");
  });

  it("follows merge.ff=false when no merge commit is requested", async () => {
    const { repo, feature, main } = withFeature();
    run(repo, "config", "merge.ff", "false");
    await mergeBranch(
      createGit(repo, "git"),
      { branchName: "feature", createNewCommit: false },
      "git"
    );
    expect(run(repo, "rev-parse", "HEAD^1")).toBe(main);
    expect(run(repo, "rev-parse", "HEAD^2")).toBe(feature);
  });

  it("is not started once the client is cancelled", async () => {
    const { repo, main } = withFeature();
    const controller = new AbortController();
    controller.abort();
    const error = await failure(
      mergeBranch(
        createGit(repo, "git", controller.signal),
        { branchName: "feature", createNewCommit: true },
        "git"
      )
    );
    expect(error.message).not.toContain(STOPPED);
    expect(run(repo, "rev-parse", "main")).toBe(main);
    expect(hasGitFile(repo, "MERGE_HEAD")).toBe(false);
  });
});

describe("a merge that stops", () => {
  it("keeps Git's own failure as the cause of the conflict message", async () => {
    const repo = withConflict();
    const error = await failure(
      mergeBranch(createGit(repo, "git"), { branchName: "topic", createNewCommit: true }, "git")
    );
    expect(error.message).toMatch(new RegExp(`^${STOPPED}`));
    expect(error.cause).toBeInstanceOf(Error);
    const cause = error.cause as Error;
    expect(cause.message.trim()).not.toBe("");
    expect(cause.message).not.toContain(STOPPED);
    expect(hasGitFile(repo, "MERGE_HEAD")).toBe(true);
  });

  it("reports Git's refusal when a merge was already in progress", async () => {
    const repo = withConflict();
    await expect(
      mergeBranch(createGit(repo, "git"), { branchName: "topic", createNewCommit: true }, "git")
    ).rejects.toThrow(STOPPED);
    const pending = run(repo, "rev-parse", "MERGE_HEAD");
    const topic = run(repo, "rev-parse", "topic");

    for (const again of [
      () =>
        mergeBranch(createGit(repo, "git"), { branchName: "topic", createNewCommit: true }, "git"),
      () =>
        mergeCommit(createGit(repo, "git"), { commitHash: topic, createNewCommit: false }, "git")
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const error = await failure(again());
      expect(error.message).not.toContain(STOPPED);
      expect(error.message.trim()).not.toBe("");
    }
    expect(run(repo, "rev-parse", "MERGE_HEAD")).toBe(pending);
  });
});
