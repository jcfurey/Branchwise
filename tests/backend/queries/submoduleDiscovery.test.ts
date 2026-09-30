import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { getSubmodulePaths } from "@/backend/utils/git";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { git, makeRepo } from "@tests/backend/helpers";

let parent: string;
let childSource: string;
let nestedSource: string;
let child: string;
let nested: string;
let uninitialized: string;

beforeAll(() => {
  parent = normalizeRepoPath(makeRepo());
  childSource = makeRepo();
  nestedSource = makeRepo();

  git(
    ["-c", "protocol.file.allow=always", "submodule", "add", nestedSource, "nested module"],
    childSource
  );
  git(["commit", "-am", "Add nested submodule"], childSource);

  const childPath = "src/packages/child module";
  git(["-c", "protocol.file.allow=always", "submodule", "add", childSource, childPath], parent);
  git(["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"], parent);

  const uninitializedPath = "not initialized";
  git(
    ["-c", "protocol.file.allow=always", "submodule", "add", nestedSource, uninitializedPath],
    parent
  );
  git(["submodule", "deinit", "--force", "--", uninitializedPath], parent);

  child = normalizeRepoPath(path.join(parent, childPath));
  nested = child + "/nested module";
  uninitialized = normalizeRepoPath(path.join(parent, uninitializedPath));
});

afterAll(() => {
  for (const repo of [parent, childSource, nestedSource]) {
    if (repo) {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

describe("submodule repository discovery", () => {
  it("finds the parent and initialized submodules with the default search depth", async () => {
    expect((await findGitRepos([parent], "git", 0)).toSorted()).toEqual(
      [parent, child, nested].toSorted()
    );
  });

  it("preserves spaces in submodule paths and includes nested submodules", async () => {
    expect(await getSubmodulePaths(parent, "git")).toEqual([child, nested]);
  });

  it("does not offer uninitialized submodules", async () => {
    expect(await findGitRepos([parent], "git", 0)).not.toContain(uninitialized);
  });

  it("deduplicates submodules also opened as workspace folders", async () => {
    expect((await findGitRepos([parent, child, parent], "git", 0)).toSorted()).toEqual(
      [parent, child, nested].toSorted()
    );
  });

  it("returns no submodules for an ordinary repository", async () => {
    expect(await getSubmodulePaths(nestedSource, "git")).toEqual([]);
  });

  it("tolerates an unavailable Git executable", async () => {
    expect(await getSubmodulePaths(parent, path.join(parent, "missing-git"))).toEqual([]);
  });
});
