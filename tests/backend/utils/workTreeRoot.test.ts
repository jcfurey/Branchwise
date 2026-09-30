import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { workTreeRoot } from "@/backend/utils/git";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { makeRepo } from "@tests/backend/helpers";

let repo: string;
let outside: string;
let subfolder: string;
let link: string;

beforeAll(() => {
  repo = makeRepo();
  outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-outside-")));
  subfolder = path.join(repo, "packages", "app");
  fs.mkdirSync(subfolder, { recursive: true });
  link = path.join(outside, "linked repository");
  // Windows creates directory junctions without extra privileges.
  fs.symlinkSync(repo, link, "junction");
});

afterAll(() => {
  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("workTreeRoot", () => {
  it("maps the repository, a subfolder, and a symlink to the repository's real path", async () => {
    const directories = [repo, subfolder, link, path.join(link, "packages")];
    expect(
      await Promise.all(directories.map((directory) => workTreeRoot(directory, "git")))
    ).toEqual(directories.map(() => normalizeRepoPath(repo)));
  });

  it("returns null outside a work tree", async () => {
    expect(await workTreeRoot(outside, "git")).toBeNull();
    expect(await workTreeRoot(path.join(repo, ".git"), "git")).toBeNull();
    expect(await workTreeRoot(path.join(outside, "missing"), "git")).toBeNull();
  });
});

describe("workspace discovery", () => {
  it("lists a repository once when folders name a subfolder or a symlink of it", async () => {
    expect(await findGitRepos([subfolder], "git", 1)).toEqual([normalizeRepoPath(repo)]);
    expect(await findGitRepos([link], "git", 0)).toEqual([normalizeRepoPath(repo)]);
    expect(await findGitRepos([outside, repo, subfolder, link], "git", 1)).toEqual([
      normalizeRepoPath(repo)
    ]);
  });
});
