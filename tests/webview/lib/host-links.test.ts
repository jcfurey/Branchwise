import { describe, expect, it } from "vitest";

import type { BranchDetails, RepositoryState } from "@/backend/types";
import { issueTracker } from "@/webview/lib/commit-message";
import {
  branchPage,
  branchReviewRequest,
  commitPage,
  pushedReviewRequest,
  remoteBranchReviewRequest,
  reviewRequestUrl,
  tagPage
} from "@/webview/lib/host-links";

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
    staged: 0,
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

describe("pull and merge request pages", () => {
  const tracker = (url: string) => issueTracker(url)!;

  it.each([
    [
      "https://github.com/owner/repo.git",
      "main",
      "https://github.com/owner/repo/compare/main...topic?expand=1"
    ],
    ["git@github.com:owner/repo.git", null, "https://github.com/owner/repo/compare/topic?expand=1"],
    [
      "https://gitlab.com/group/sub/project.git",
      "main",
      "https://gitlab.com/group/sub/project/-/merge_requests/new?merge_request[source_branch]=topic&merge_request[target_branch]=main"
    ],
    [
      "ssh://git@gitlab.example.com:2222/team/project.git",
      null,
      "https://gitlab.example.com/team/project/-/merge_requests/new?merge_request[source_branch]=topic"
    ],
    [
      "git@gitlab.internal.example:team/project",
      "develop",
      "https://gitlab.internal.example/team/project/-/merge_requests/new?merge_request[source_branch]=topic&merge_request[target_branch]=develop"
    ]
  ])("builds the page for %s into %s", (url, base, page) => {
    expect(reviewRequestUrl(tracker(url), "topic", base)).toBe(page);
  });

  it("keeps the slashes of GitHub's compare path and escapes everything else", () => {
    expect(
      reviewRequestUrl(tracker("https://github.com/o/r"), "feature/a b#1+%?", "release/2.0")
    ).toBe("https://github.com/o/r/compare/release/2.0...feature/a%20b%231%2B%25%3F?expand=1");
  });

  it("escapes GitLab's query values whole, slashes included", () => {
    expect(
      reviewRequestUrl(tracker("https://gitlab.com/g/p"), "feature/a b&c=d#e", "release/2.0")
    ).toBe(
      "https://gitlab.com/g/p/-/merge_requests/new?merge_request[source_branch]=feature%2Fa%20b%26c%3Dd%23e&merge_request[target_branch]=release%2F2.0"
    );
  });
});

describe("proposing a branch for review", () => {
  const withDefault = (url: string, defaultBranch?: string) => ({
    ...remote("origin", url),
    ...(defaultBranch === undefined ? {} : { defaultBranch })
  });
  const repo = (url: string, defaultBranch?: string) =>
    state(url, {
      remotes: [withDefault(url, defaultBranch)],
      branches: [
        branch("main", "origin/main"),
        branch("topic", "origin/remote-name"),
        branch("fresh", ""),
        branch("gone", "origin/gone", true),
        branch("local", "main")
      ]
    });

  it("opens the request for the branch the upstream names, into the remote's default branch", () => {
    expect(branchReviewRequest(repo("git@github.com:o/r.git", "main"), "topic")).toEqual({
      kind: "github",
      push: false,
      url: "https://github.com/o/r/compare/main...remote-name?expand=1"
    });
    expect(branchReviewRequest(repo("git@gitlab.com:g/p.git"), "topic")).toEqual({
      kind: "gitlab",
      push: false,
      url: "https://gitlab.com/g/p/-/merge_requests/new?merge_request[source_branch]=remote-name"
    });
  });

  it("asks for a push first without an upstream, with a gone one, or tracking a local branch", () => {
    const github = repo("https://github.com/o/r.git", "main");
    for (const name of ["fresh", "gone", "local"]) {
      expect(branchReviewRequest(github, name)).toEqual({ kind: "github", push: true });
    }
  });

  it("pushes to the push default, else origin, else the first remote", () => {
    const remotes = [
      remote("lab", "https://gitlab.com/g/p.git"),
      remote("origin", "https://github.com/o/r.git")
    ];
    const both = state("x", { remotes, branches: [branch("fresh", "")] });
    expect(branchReviewRequest(both, "fresh")).toMatchObject({ kind: "github" });
    expect(branchReviewRequest({ ...both, pushDefault: "lab" }, "fresh")).toMatchObject({
      kind: "gitlab"
    });
    expect(branchReviewRequest({ ...both, remotes: remotes.slice(0, 1) }, "fresh")).toMatchObject({
      kind: "gitlab"
    });
  });

  it("offers nothing for the default branch, on an unknown host, or without the branch", () => {
    const bitbucket = repo("https://bitbucket.org/o/r.git", "main");
    expect(branchReviewRequest(repo("https://github.com/o/r.git", "main"), "main")).toBeNull();
    expect(branchReviewRequest(bitbucket, "topic")).toBeNull();
    expect(branchReviewRequest(bitbucket, "fresh")).toBeNull();
    expect(branchReviewRequest(repo("https://github.com/o/r.git"), "missing")).toBeNull();
    expect(branchReviewRequest(null, "topic")).toBeNull();
    expect(
      branchReviewRequest(state(null, { branches: [branch("fresh", "")] }), "fresh")
    ).toBeNull();
  });

  it("proposes a remote branch, under the longest remote name it starts with", () => {
    const nested = state("x", {
      remotes: [
        withDefault("https://github.com/team/repo.git", "main"),
        { ...remote("team/lab", "https://gitlab.example.com/team/lab.git"), defaultBranch: "dev" }
      ]
    });
    expect(remoteBranchReviewRequest(nested, "team/lab/fix/x")).toEqual({
      kind: "gitlab",
      url: "https://gitlab.example.com/team/lab/-/merge_requests/new?merge_request[source_branch]=fix%2Fx&merge_request[target_branch]=dev"
    });
    expect(remoteBranchReviewRequest(nested, "origin/fix/x")?.url).toBe(
      "https://github.com/team/repo/compare/main...fix/x?expand=1"
    );
    expect(remoteBranchReviewRequest(nested, "origin/main")).toBeNull();
    expect(remoteBranchReviewRequest(nested, "origin/HEAD")).toBeNull();
    expect(remoteBranchReviewRequest(nested, "elsewhere/topic")).toBeNull();
  });

  it("opens the request for a branch just pushed to the remote chosen in the push dialog", () => {
    const pushed = repo("git@github.com:o/r.git", "main");
    expect(pushedReviewRequest(pushed, "origin", "fresh")?.url).toBe(
      "https://github.com/o/r/compare/main...fresh?expand=1"
    );
    expect(pushedReviewRequest(pushed, "missing", "fresh")).toBeNull();
    expect(pushedReviewRequest(null, "origin", "fresh")).toBeNull();
  });
});
