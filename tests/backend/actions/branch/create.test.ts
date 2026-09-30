import { describe, expect, it } from "vitest";

import { createBranch } from "@/backend/actions/branch";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

// `main` gains an empty second commit, so HEAD and `HEAD^` are different commits.
const repo = freshRepo((dir) => git(["commit", "--allow-empty", "-q", "-m", "second"], dir));

const commitOf = (rev: string) => gitOutput(["rev-parse", rev], repo());
const headRef = () => gitOutput(["symbolic-ref", "HEAD"], repo());

function create(branchName: string, commitHash: string) {
  return createBranch(createGit(repo(), "git"), { branchName, commitHash });
}

describe("createBranch", () => {
  it("creates the branch at the given commit without checking it out", async () => {
    const older = commitOf("HEAD^");

    await expect(create("new-branch", older)).resolves.toBeUndefined();

    expect(commitOf("refs/heads/new-branch")).toBe(older);
    expect(headRef()).toBe("refs/heads/main");
  });

  it.each([
    ["a tag", "start-tag", () => git(["tag", "start-tag", "HEAD^"], repo())],
    ["a relative revision", "HEAD~1", () => {}],
    [
      "a remote-tracking name",
      "upstream/start",
      () => git(["update-ref", "refs/remotes/upstream/start", "HEAD^"], repo())
    ]
  ])("starts the branch at %s", async (_, revision, prepare) => {
    prepare();
    const older = commitOf("HEAD^");

    await expect(create("from-revision", revision)).resolves.toBeUndefined();

    expect(commitOf("refs/heads/from-revision")).toBe(older);
    expect(commitOf("refs/heads/main")).not.toBe(older);
    expect(headRef()).toBe("refs/heads/main");
  });

  // Git refuses to move a checked-out branch even when forced, so only a branch that is not
  // checked out shows that creating is never forced.
  it.each([
    ["the checked-out branch", "main"],
    ["a branch that is not checked out", "existing"]
  ])("does not move %s", async (_, branchName) => {
    git(["branch", "existing"], repo());
    const tip = commitOf(`refs/heads/${branchName}`);

    await expect(create(branchName, commitOf("HEAD^"))).rejects.toThrow();

    expect(commitOf(`refs/heads/${branchName}`)).toBe(tip);
  });

  it("rejects a commit that does not exist and creates nothing", async () => {
    await expect(create("bad-branch", "deadbeef".repeat(5))).rejects.toThrow();

    expect(gitOutput(["for-each-ref", "--format=%(refname)", "refs/heads/"], repo())).toBe(
      "refs/heads/main"
    );
  });
});
