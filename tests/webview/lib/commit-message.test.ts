// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RepositoryState } from "@/backend/types";
import {
  CommitMessage,
  type IssueTracker,
  issueTracker,
  repositoryTracker
} from "@/webview/lib/commit-message";

describe("issueTracker", () => {
  it.each([
    ["https://github.com/owner/repo.git", "github", "https://github.com/owner/repo"],
    ["https://www.GitHub.com/owner/repo/", "github", "https://github.com/owner/repo"],
    ["git@github.com:owner/repo.git", "github", "https://github.com/owner/repo"],
    ["ssh://git@github.com/owner/repo", "github", "https://github.com/owner/repo"],
    ["https://gitlab.com/group/sub/project.git", "gitlab", "https://gitlab.com/group/sub/project"],
    [
      "ssh://git@gitlab.example.com:2222/team/project.git",
      "gitlab",
      "https://gitlab.example.com/team/project"
    ],
    ["git@gitlab.example.com:team/project", "gitlab", "https://gitlab.example.com/team/project"]
  ])("reads %s as a %s repository at %s", (url, kind, base) => {
    expect(issueTracker(url)).toMatchObject({ kind, base });
  });

  it.each([
    "https://bitbucket.org/owner/repo.git",
    "/srv/git/repo.git",
    "file:///srv/git/repo.git",
    "C:\\repos\\project",
    "https://github.com/owner",
    "not a url"
  ])("knows no tracker for %s", (url) => {
    expect(issueTracker(url)).toBeNull();
  });
});

describe("repositoryTracker", () => {
  const state = (patch: Partial<RepositoryState>): RepositoryState => ({
    remotes: [],
    pushDefault: null,
    branches: [],
    remoteBranches: [],
    tags: [],
    worktrees: [],
    head: "main",
    operation: null,
    conflicts: [],
    ...patch
  });
  const remote = (name: string, url: string) => ({ name, fetchUrls: [url], pushUrls: [] });
  const branch = (name: string, upstream: string) => ({
    name,
    hash: "a".repeat(40),
    upstream,
    ahead: 0,
    behind: 0,
    gone: false,
    date: 0,
    merged: false
  });

  it("follows the checked-out branch's remote, then origin, then the first remote", () => {
    const remotes = [
      remote("fork", "git@github.com:me/repo.git"),
      remote("origin", "git@github.com:them/repo.git"),
      remote("lab", "git@gitlab.com:team/repo.git")
    ];
    expect(
      repositoryTracker(state({ remotes, branches: [branch("main", "lab/main")] }))?.base
    ).toBe("https://gitlab.com/team/repo");
    expect(repositoryTracker(state({ remotes }))?.base).toBe("https://github.com/them/repo");
    expect(repositoryTracker(state({ remotes: [remotes[0]!, remotes[2]!] }))?.base).toBe(
      "https://github.com/me/repo"
    );
    expect(repositoryTracker(state({}))).toBeNull();
    expect(repositoryTracker(null)).toBeNull();
  });
});

describe("CommitMessage", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    render(null, container);
    container.remove();
  });

  const github: IssueTracker = {
    kind: "github",
    host: "github.com",
    base: "https://github.com/owner/repo"
  };
  const gitlab: IssueTracker = {
    kind: "gitlab",
    host: "gitlab.com",
    base: "https://gitlab.com/group/project"
  };
  const show = (body: string, tracker: IssueTracker | null = github) => {
    render(h(CommitMessage, { body, tracker }), container);
    return container;
  };
  const links = () =>
    [...container.querySelectorAll("a")].map((link) => [link.textContent, link.href]);

  it("keeps the text, and its line breaks, exactly as written", () => {
    const body = "Subject <b>not bold</b>\n\n- one\n- two & three";
    expect(show(body).textContent).toBe(body);
    expect(container.querySelector("p b")).toBeNull();
    expect(container.querySelector("p")!.className).toContain("whitespace-pre-wrap");
  });

  it("styles inline code, bold and italic, but not snake_case or a lone asterisk", () => {
    show("Use `git log` **now**, *please*: snake_case_name and 2 * 3 * 4");
    expect(container.querySelector("code")!.textContent).toBe("git log");
    expect(container.querySelector("b")!.textContent).toBe("now");
    expect(container.querySelector("i")!.textContent).toBe("please");
    expect(container.querySelectorAll("i")).toHaveLength(1);
    expect(container.textContent).toBe("Use git log now, please: snake_case_name and 2 * 3 * 4");
  });

  it("links web addresses without the punctuation that ends a sentence", () => {
    show("See https://example.com/a_(b)?q=1#x. Or (http://example.org/path), then stop.");
    expect(links()).toEqual([
      ["https://example.com/a_(b)?q=1#x", "https://example.com/a_(b)?q=1#x"],
      ["http://example.org/path", "http://example.org/path"]
    ]);
  });

  it("links issue references to GitHub", () => {
    show("Fixes #12 and GH-3, see other/repo#4; not a#5, &#6; or !7\nhttps://x.test/#8");
    expect(links()).toEqual([
      ["#12", "https://github.com/owner/repo/issues/12"],
      ["GH-3", "https://github.com/owner/repo/issues/3"],
      ["other/repo#4", "https://github.com/other/repo/issues/4"],
      ["https://x.test/#8", "https://x.test/#8"]
    ]);
  });

  it("links issues and merge requests to GitLab", () => {
    show("Closes #12 and !34 and group/sub/proj#5, not GH-3", gitlab);
    expect(links()).toEqual([
      ["#12", "https://gitlab.com/group/project/-/issues/12"],
      ["!34", "https://gitlab.com/group/project/-/merge_requests/34"],
      ["group/sub/proj#5", "https://gitlab.com/group/sub/proj/-/issues/5"]
    ]);
  });

  it("links no references without a known tracker, but still links addresses", () => {
    show("Fixes #12 at https://example.com", null);
    expect(links()).toEqual([["https://example.com", "https://example.com/"]]);
  });

  it("sets fenced code apart and leaves an unclosed fence as text", () => {
    show("Before\n```\nconst a = `b` **c**;\n#1\n```\nAfter #2\n~~~\nopen");
    expect(container.querySelector("pre")!.textContent).toBe("const a = `b` **c**;\n#1");
    expect(container.querySelector("pre a, pre b, pre code")).toBeNull();
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Before",
      "After #2\n~~~\nopen"
    ]);
    expect(links()).toEqual([["#2", "https://github.com/owner/repo/issues/2"]]);
  });
});
