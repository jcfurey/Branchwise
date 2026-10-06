// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryState } from "@/backend/types";
import {
  focusBranchInGraph,
  receiveRepoState,
  selectBranch,
  setHiddenBranchPatterns
} from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import { repositoryState } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";
import {
  branchPatternScope,
  countHiddenBranches,
  graphVisibilityKey,
  hiddenBranchCount,
  isBranchHidden,
  patternLike,
  selectionOverridesPatterns,
  visibleBranchList
} from "@/webview/lib/stores/hidden-branches.store";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

const HASH = "a".repeat(40);
const state: RepositoryState = {
  remotes: [{ name: "origin", fetchUrls: [], pushUrls: [] }],
  pushDefault: null,
  branches: ["main", "feature", "bot/one", "bot/two"].map((name) => ({
    name,
    hash: HASH,
    upstream: "",
    ahead: 0,
    behind: 0,
    gone: false,
    date: 0,
    merged: false
  })),
  remoteBranches: [
    { name: "origin/main", hash: HASH },
    { name: "origin/bot/three", hash: HASH },
    { name: "gone/bot/four", hash: HASH }
  ],
  tags: [],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};

/** Every message the page posted, by command. */
const posted = (command: string) =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as { command: string })
    .filter((message) => message.command === command);

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.headBranch.value = "main";
  stores.branchList.value = [
    "main",
    "bot/one",
    "bot/two",
    "feature",
    "remotes/origin/bot/three",
    "remotes/origin/main"
  ];
  stores.repoStates.value = { "/repo": { columnWidths: null } };
  stores.showRemoteBranch.value = true;
  stores.commitList.value = [];
  repositoryState.value = state;
  vi.clearAllMocks();
});

describe("saving patterns", () => {
  it("stores clean patterns, saves them and reloads the graph with them", () => {
    setHiddenBranchPatterns([" bot/* ", "", "bot/*", "wip"]);
    expect(stores.hiddenBranchPatterns.value).toEqual(["bot/*", "wip"]);
    expect(posted("saveRepoState")).toEqual([
      { command: "saveRepoState", repo: "/repo", state: { hiddenBranchPatterns: ["bot/*", "wip"] } }
    ]);
    expect(latestGraphRequest("loadCommits")).toMatchObject({
      hiddenBranchPatterns: ["bot/*", "wip"],
      visibilityKey: graphVisibilityKey()
    });
    expect(latestGraphRequest("loadCommits")).not.toHaveProperty("shownBranch");
    expect(posted("loadBranches")).toEqual([]);
  });

  it("does nothing when the patterns are the same, and clears them with none", () => {
    setHiddenBranchPatterns(["bot/*"]);
    vi.clearAllMocks();
    setHiddenBranchPatterns(["bot/*", " "]);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    setHiddenBranchPatterns([]);
    expect(stores.hiddenBranchPatterns.value).toEqual([]);
    const request = latestGraphRequest("loadCommits");
    expect(request).not.toHaveProperty("hiddenBranchPatterns");
    expect(request.visibilityKey).toBe(stores.remoteVisibilityKey());
  });

  it("keeps the request and its key as before while no pattern is set", () => {
    expect(graphVisibilityKey()).toBe(stores.remoteVisibilityKey());
    expect(branchPatternScope()).toEqual({});
  });
});

describe("which branches are hidden", () => {
  beforeEach(() => setHiddenBranchPatterns(["bot/*"]));

  it("leaves matching branches out of the picker, local and remote", () => {
    expect(visibleBranchList.value).toEqual(["main", "feature", "remotes/origin/main"]);
    expect(isBranchHidden("bot/one")).toBe(true);
    expect(isBranchHidden("remotes/origin/bot/three")).toBe(true);
    // A remote's name is never matched against the pattern.
    expect(isBranchHidden("remotes/origin/main")).toBe(false);
  });

  it("keeps the checked-out branch and the chosen one", () => {
    setHiddenBranchPatterns(["bot/*", "main"]);
    stores.selectedBranch.value = "bot/two";
    expect(visibleBranchList.value).toEqual(["main", "bot/two", "feature"]);
    expect(isBranchHidden("main")).toBe(false);
    expect(isBranchHidden("bot/two")).toBe(false);
    expect(selectionOverridesPatterns.value).toBe(true);
    stores.selectedBranch.value = "main";
    expect(selectionOverridesPatterns.value).toBe(false);
  });

  it("counts the listed branches hidden, with remotes shown or not", () => {
    // bot/one, bot/two, origin/bot/three, and gone/bot/four of a remote no longer configured.
    expect(hiddenBranchCount.value).toBe(4);
    stores.selectedBranch.value = "remotes/origin/bot/three";
    expect(hiddenBranchCount.value).toBe(3);
    stores.showRemoteBranch.value = false;
    expect(hiddenBranchCount.value).toBe(2);
    expect(countHiddenBranches(null)).toBe(0);
  });

  it("does not count branches of a hidden remote", () => {
    stores.repoStates.value = {
      "/repo": { columnWidths: null, hiddenRemotes: ["origin"], hiddenBranchPatterns: ["bot/*"] }
    };
    expect(hiddenBranchCount.value).toBe(3);
  });
});

describe("a chosen branch that a pattern matches", () => {
  beforeEach(() => {
    setHiddenBranchPatterns(["bot/*"]);
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    vi.clearAllMocks();
  });

  it("is named to the graph while focused, and dropped again when the focus moves on", () => {
    focusBranchInGraph("bot/one");
    expect(latestGraphRequest("loadCommits")).toMatchObject({
      branchName: "",
      hiddenBranchPatterns: ["bot/*"],
      shownBranch: "bot/one"
    });
    vi.clearAllMocks();
    focusBranchInGraph("feature");
    const request = latestGraphRequest("loadCommits");
    expect(request).not.toHaveProperty("shownBranch");
    expect(stores.hiddenBranchPatterns.value).toEqual(["bot/*"]);
  });

  it("asks nothing more when the focus moves between visible branches", () => {
    focusBranchInGraph("feature");
    expect(posted("loadCommits")).toEqual([]);
  });

  it("refuses rows for the earlier choice and takes those for the current one", () => {
    const before = graphVisibilityKey();
    selectBranch("remotes/origin/bot/three");
    const request = latestGraphRequest("loadCommits");
    expect(request.shownBranch).toBe("remotes/origin/bot/three");
    const reply = {
      command: "loadCommits" as const,
      requestId: request.requestId,
      repo: "/repo",
      branchName: "",
      commits: [],
      head: "old",
      hard: true,
      moreCommitsAvailable: false,
      uncommittedChanges: 0
    };
    handleLoadCommits({ ...reply, visibilityKey: before });
    expect(stores.commitHead.value).not.toBe("old");
    handleLoadCommits({ ...reply, head: "new", visibilityKey: request.visibilityKey });
    expect(stores.commitHead.value).toBe("new");
  });
});

describe("patterns saved earlier", () => {
  it("apply when the stored record arrives, reloading the graph", () => {
    stores.repoStates.value = {};
    receiveRepoState({
      command: "repoState",
      repo: "/repo",
      state: { columnWidths: null, hiddenBranchPatterns: ["bot/*"] }
    });
    expect(stores.hiddenBranchPatterns.value).toEqual(["bot/*"]);
    expect(latestGraphRequest("loadCommits").hiddenBranchPatterns).toEqual(["bot/*"]);
  });

  it("give way to patterns the page set since", () => {
    setHiddenBranchPatterns(["wip"]);
    vi.clearAllMocks();
    receiveRepoState({
      command: "repoState",
      repo: "/repo",
      state: { columnWidths: null, hiddenBranchPatterns: ["bot/*"] }
    });
    expect(stores.hiddenBranchPatterns.value).toEqual(["wip"]);
    expect(posted("loadCommits")).toEqual([]);
  });
});

describe("patternLike", () => {
  it("offers the first segment of a local or remote branch's own name", () => {
    expect(patternLike({ type: "head", name: "dependabot/npm/foo", hash: HASH })).toBe(
      "dependabot/*"
    );
    expect(patternLike({ type: "remote", name: "origin/dependabot/npm/foo", hash: HASH })).toBe(
      "dependabot/*"
    );
    expect(patternLike({ type: "remote", name: "origin/main", hash: HASH })).toBe("main");
  });
});
