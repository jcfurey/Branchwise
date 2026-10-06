import { describe, expect, it } from "vitest";

import type { BranchDetails, RepositoryState } from "@/backend/types";
import { branchPage, commitPage, tagPage } from "@/webview/lib/host-links";

const HASH = "0123456789abcdef0123456789abcdef01234567";

const remote = (name: string, url: string) => ({ name, fetchUrls: [url], pushUrls: [] });

function branch(name: string, upstream: string, gone = false): BranchDetails {
  return { name, hash: HASH, upstream, ahead: 0, behind: 0, gone, date: 0, merged: false };
}

/** A repository with `main` checked out, tracking `origin/main` when `origin` is given. */
function state(origin: string | null, patch: Partial<RepositoryState> = {}): RepositoryState {
  return {
    remotes: origin === null ? [] : [remote("origin", origin)],
    pushDefault: null,
    branches: [branch("main", origin === null ? "" : "origin/main")],
    remoteBranches: [],
    tags: [],
    worktrees: [],
    head: "main",
    operation: null,
    conflicts: [],
    ...patch
  };
}

describe("commit pages", () => {
  it.each([
    ["https://github.com/owner/repo.git", "GitHub", `https://github.com/owner/repo/commit/${HASH}`],
    ["git@github.com:owner/repo.git", "GitHub", `https://github.com/owner/repo/commit/${HASH}`],
    [
      "https://gitlab.com/group/sub/project.git",
      "GitLab",
      `https://gitlab.com/group/sub/project/-/commit/${HASH}`
    ],
    [
      "ssh://git@gitlab.example.com:2222/team/project.git",
      "GitLab",
      `https://gitlab.example.com/team/project/-/commit/${HASH}`
    ],
    [
      "git@gitlab.internal.example:team/project",
      "GitLab",
      `https://gitlab.internal.example/team/project/-/commit/${HASH}`
    ]
  ])("opens a commit of %s on %s", (url, host, page) => {
    expect(commitPage(state(url), HASH)).toEqual({ host, url: page });
  });

  it("has none without a remote on a known host", () => {
    expect(commitPage(state("https://bitbucket.org/owner/repo.git"), HASH)).toBeNull();
    expect(commitPage(state("/srv/git/repo.git"), HASH)).toBeNull();
    expect(commitPage(state(null), HASH)).toBeNull();
    expect(commitPage(null, HASH)).toBeNull();
  });
});

describe("tag pages", () => {
  it("opens a GitHub tag as its release and a GitLab tag on the tags page", () => {
    expect(tagPage(state("git@github.com:owner/repo.git"), "v1.2.0")).toEqual({
      host: "GitHub",
      url: "https://github.com/owner/repo/releases/tag/v1.2.0"
    });
    expect(tagPage(state("ssh://git@gitlab.example.com/team/project"), "v1.2.0")).toEqual({
      host: "GitLab",
      url: "https://gitlab.example.com/team/project/-/tags/v1.2.0"
    });
  });

  it("escapes each part of the name and keeps its slashes", () => {
    expect(tagPage(state("https://github.com/owner/repo"), "release/2024 #1+rc?")?.url).toBe(
      "https://github.com/owner/repo/releases/tag/release/2024%20%231%2Brc%3F"
    );
  });

  it("has none without a known host", () => {
    expect(tagPage(state("https://example.com/owner/repo.git"), "v1")).toBeNull();
    expect(tagPage(null, "v1")).toBeNull();
  });
});

describe("branch pages", () => {
  it("opens the tracked branch on GitHub and GitLab", () => {
    expect(branchPage(state("https://github.com/owner/repo.git"), "main")).toEqual({
      host: "GitHub",
      url: "https://github.com/owner/repo/tree/main"
    });
    expect(branchPage(state("git@gitlab.com:group/sub/project.git"), "main")).toEqual({
      host: "GitLab",
      url: "https://gitlab.com/group/sub/project/-/tree/main"
    });
  });

  it("opens the remote's name for the branch, slashes and special characters included", () => {
    const repo = state("https://github.com/owner/repo.git", {
      branches: [branch("local", "origin/feature/ä b#1%")]
    });
    expect(branchPage(repo, "local")?.url).toBe(
      "https://github.com/owner/repo/tree/feature/%C3%A4%20b%231%25"
    );
  });

  it("finds the remote of the upstream, even when its name has a slash", () => {
    const repo = state("https://github.com/owner/repo.git", {
      remotes: [
        remote("team", "https://github.com/team/repo.git"),
        remote("team/lab", "https://gitlab.example.com/team/lab.git")
      ],
      branches: [branch("topic", "team/lab/topic")]
    });
    expect(branchPage(repo, "topic")).toEqual({
      host: "GitLab",
      url: "https://gitlab.example.com/team/lab/-/tree/topic"
    });
  });

  it("has none for a branch without an upstream, with a gone one, or on an unknown host", () => {
    const github = "https://github.com/owner/repo.git";
    expect(branchPage(state(github, { branches: [branch("main", "")] }), "main")).toBeNull();
    expect(
      branchPage(state(github, { branches: [branch("main", "origin/main", true)] }), "main")
    ).toBeNull();
    // A branch that tracks another local branch has no remote.
    expect(branchPage(state(github, { branches: [branch("main", "trunk")] }), "main")).toBeNull();
    expect(branchPage(state("https://example.com/owner/repo.git"), "main")).toBeNull();
    expect(branchPage(state(github), "missing")).toBeNull();
    expect(branchPage(null, "main")).toBeNull();
  });
});
