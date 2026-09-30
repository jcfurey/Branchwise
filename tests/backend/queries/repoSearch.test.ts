import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { git } from "@tests/backend/helpers";

/** The workspace the checks search, by its real path. */
let workspace = "";

const inWorkspace = (relative = "") => join(workspace, ...relative.split("/"));
/** How the search names the repository at `relative`. */
const repoKey = (relative: string) => normalizeRepoPath(inWorkspace(relative));

const REPO_A = "repo-a";
const REPO_B = "nested/repo-b";
/** A work tree whose own folder is named .git, inside an ordinary folder. */
const ODD_WORK_TREE = "odd/.git";

function makeRepository(relative: string) {
  const folder = inWorkspace(relative);
  mkdirSync(folder, { recursive: true });
  git(["init", "--quiet", "--initial-branch=main"], folder);
}

function commitFile(relative: string) {
  const folder = inWorkspace(relative);
  git(["config", "user.name", "Workspace Fixture"], folder);
  git(["config", "user.email", "workspace-fixture@example.invalid"], folder);
  git(["config", "commit.gpgSign", "false"], folder);
  writeFileSync(join(folder, "f"), "x");
  git(["add", "f"], folder);
  git(["commit", "--quiet", "--message", "Add f"], folder);
}

beforeAll(() => {
  workspace = realpathSync.native(mkdtempSync(join(tmpdir(), "bw-find-repos-")));
  // The expectations assume the workspace does not sit inside another work tree.
  expect(() => git(["rev-parse", "--show-toplevel"], workspace)).toThrow();
  for (const repo of [REPO_A, REPO_B]) {
    makeRepository(repo);
    commitFile(repo);
  }
  mkdirSync(inWorkspace("plain"));
  makeRepository(ODD_WORK_TREE);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("folders searched where they are", () => {
  it("finds nothing when there are no folders", async () => {
    expect(await findGitRepos([], "git", 2)).toEqual([]);
  });

  it("finds the repository a folder is", async () => {
    expect(await findGitRepos([inWorkspace(REPO_A)], "git", 0)).toEqual([repoKey(REPO_A)]);
  });

  it("finds nothing in an empty plain folder", async () => {
    expect(await findGitRepos([inWorkspace("plain")], "git", 0)).toEqual([]);
  });

  it("finds nothing below a folder that cannot be listed because it is missing", async () => {
    expect(await findGitRepos([inWorkspace("not-there")], "git", 2)).toEqual([]);
  });
});

describe("folders searched below", () => {
  it("stops at the depth asked for", async () => {
    // One level down holds the first repository; the second is two levels down.
    const found = await findGitRepos([workspace], "git", 1);
    expect(found).toContain(repoKey(REPO_A));
    expect(found).not.toContain(repoKey(REPO_B));
    expect(found).toEqual([repoKey(REPO_A)]);
  });

  it("reaches a repository two levels down at depth 2", async () => {
    const found = await findGitRepos([workspace], "git", 2);
    expect(found).toContain(repoKey(REPO_B));
    expect(found).toContain(repoKey(REPO_A));
  });

  it("merges the results of several folders in collation order", async () => {
    const found = await findGitRepos([inWorkspace(REPO_A), inWorkspace("nested")], "git", 1);
    // ".../nested/repo-b" collates before ".../repo-a", the reverse of the folders' order.
    expect(found).toEqual([repoKey(REPO_B), repoKey(REPO_A)]);
  });

  it("lists a repository once when the same folder is given twice", async () => {
    const found = await findGitRepos([inWorkspace("nested"), inWorkspace("nested")], "git", 1);
    expect(found).toEqual([repoKey(REPO_B)]);
  });

  it("reports no work tree found by entering a folder named .git", async () => {
    // Searched from its own folder, the odd work tree is found and its name ends in /.git.
    expect(await findGitRepos([inWorkspace(ODD_WORK_TREE)], "git", 0)).toEqual([
      repoKey(ODD_WORK_TREE)
    ]);
    const found = await findGitRepos([workspace], "git", 2);
    expect(found.filter((repo) => repo.endsWith("/.git"))).toEqual([]);
  });
});
