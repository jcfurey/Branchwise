import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { searchDirectoryForRepos } from "@/backend/utils/repoSearch";

import { git } from "@tests/backend/helpers";

// One layout serves every check, so no check may leave anything behind in it:
//
//   repo-a/                 a repository with one commit
//   nested/repo-b/          a repository with one commit, two levels down
//   not-a-repo/readme.txt   a plain folder holding a file
//   plain/                  an empty plain folder
//   hidden/.git/stray/      a repository inside a plain folder that is only named .git
let layout = "";

/** The native path of `relative`, written with `/`, inside the layout. */
const at = (relative: string) => join(layout, ...relative.split("/"));
/** `relative` in the form the search reports repositories in. */
const key = (relative: string) => normalizeRepoPath(at(relative));

const search = (relative: string, depth: number, known: string[] = []) =>
  searchDirectoryForRepos(at(relative), depth, "git", known);

const sorted = (paths: string[]) => paths.toSorted();

function repository(relative: string, withCommit: boolean) {
  const folder = at(relative);
  mkdirSync(folder, { recursive: true });
  git(["init", "--quiet", "--initial-branch=main"], folder);
  if (!withCommit) {
    return;
  }
  git(["config", "user.name", "Search Fixture"], folder);
  git(["config", "user.email", "search-fixture@example.invalid"], folder);
  git(["config", "commit.gpgSign", "false"], folder);
  writeFileSync(join(folder, "f"), "x");
  git(["add", "f"], folder);
  git(["commit", "--quiet", "--message", "Add f"], folder);
}

/** A directory link at `relative`; Windows makes junctions without extra rights. */
function link(relative: string, target: string) {
  symlinkSync(at(target), at(relative), "junction");
}

beforeAll(() => {
  layout = realpathSync.native(mkdtempSync(join(tmpdir(), "bw-repo-search-")));
  // Every expectation below assumes the layout is not itself inside some work tree.
  expect(() => git(["rev-parse", "--show-toplevel"], layout)).toThrow();
  repository("repo-a", true);
  repository("nested/repo-b", true);
  mkdirSync(at("not-a-repo"));
  writeFileSync(at("not-a-repo/readme.txt"), "Nothing to see here.\n");
  mkdirSync(at("plain"));
  repository("hidden/.git/stray", false);
});

afterAll(() => {
  rmSync(layout, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("the start folder alone", () => {
  it("reports the repository whose top level it is", async () => {
    expect(await search("repo-a", 0)).toEqual([key("repo-a")]);
  });

  it("reports nothing for a plain folder with a file in it", async () => {
    expect(await search("not-a-repo", 0)).toEqual([]);
  });

  it("reports nothing for a folder that does not exist, at any depth", async () => {
    expect(await search("never-created", 0)).toEqual([]);
    expect(await search("never-created", 3)).toEqual([]);
  });

  it("does not look inside a plain folder at depth 0", async () => {
    expect(await search("", 0)).toEqual([]);
  });
});

describe("known repositories", () => {
  it("skips a start folder that is a known repository", async () => {
    expect(await search("repo-a", 0, [key("repo-a")])).toEqual([]);
  });

  it("skips a start folder inside a known repository", async () => {
    mkdirSync(at("repo-a/src"));
    try {
      // Unknown, the same folder leads to its repository; known, it is skipped.
      expect(await search("repo-a/src", 0)).toEqual([key("repo-a")]);
      expect(await search("repo-a/src", 0, [key("repo-a")])).toEqual([]);
    } finally {
      rmSync(at("repo-a/src"), { recursive: true, force: true });
    }
  });

  it("skips a repository of its own inside a known repository", async () => {
    repository("repo-a/inner", false);
    try {
      expect(await search("repo-a/inner", 0)).toEqual([key("repo-a/inner")]);
      expect(await search("repo-a/inner", 0, [key("repo-a")])).toEqual([]);
    } finally {
      rmSync(at("repo-a/inner"), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("skips a known repository reached while descending", async () => {
    expect(await search("", 2, [key("repo-a")])).toEqual([key("nested/repo-b")]);
  });
});

describe("descending from a plain folder", () => {
  it("finds only the repository one level down at depth 1", async () => {
    expect(await search("", 1)).toEqual([key("repo-a")]);
  });

  it("finds both repositories at depth 2", async () => {
    expect(sorted(await search("", 2))).toEqual(sorted([key("repo-a"), key("nested/repo-b")]));
  });

  it("never enters a folder named .git, even when a repository waits inside it", async () => {
    // The stray repository is real: started from its own folder, the search reports it.
    expect(await search("hidden/.git/stray", 0)).toEqual([key("hidden/.git/stray")]);
    // Depth 3 reaches it from the top if, and only if, the .git folder is entered.
    const found = await search("", 3);
    expect(found.filter((repo) => repo.includes("/.git"))).toEqual([]);
  });
});

describe("symbolic links", () => {
  it("passes over a link whose target is missing", async () => {
    link("dangling", "vanished");
    try {
      expect(sorted(await search("", 2))).toEqual(sorted([key("repo-a"), key("nested/repo-b")]));
    } finally {
      rmSync(at("dangling"), { force: true });
    }
  });

  it("follows a link to a folder and lists a repository reached twice once", async () => {
    link("shortcut", "nested");
    try {
      expect(await search("shortcut", 1)).toEqual([key("nested/repo-b")]);
      expect(sorted(await search("", 2))).toEqual(sorted([key("repo-a"), key("nested/repo-b")]));
    } finally {
      rmSync(at("shortcut"), { force: true });
    }
  });

  it("drops a known repository that a link leads to", async () => {
    link("shortcut", "nested");
    try {
      // By its path the folder is outside the known repository; by Git's answer it is that one.
      expect(await search("shortcut/repo-b", 0)).toEqual([key("nested/repo-b")]);
      expect(await search("shortcut/repo-b", 0, [key("nested/repo-b")])).toEqual([]);
    } finally {
      rmSync(at("shortcut"), { force: true });
    }
  });
});
