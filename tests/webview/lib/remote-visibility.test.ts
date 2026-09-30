// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  focusBranchInGraph,
  receiveRepoState,
  selectBranch,
  selectRepo,
  setRemoteVisible,
  setShowRemoteBranch
} from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleLoadBranches } from "@/webview/lib/handler/load-branches";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.headBranch.value = "main";
  stores.branchList.value = ["main", "remotes/origin/main", "remotes/other/main"];
  stores.repoStates.value = { "/repo": { columnWidths: [100, 300, 100, 100, 100] } };
  stores.showRemoteBranch.value = true;
  stores.commitList.value = [];
  stores.maxCommits.value = 600;
  vi.clearAllMocks();
});

it("persists individual choices per repository and preserves them through the global toggle", () => {
  setRemoteVisible("origin", false);
  expect(stores.hiddenRemotes.value).toEqual(["origin"]);
  expect(vscodeApi.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      command: "saveRepoState",
      repo: "/repo",
      state: { hiddenRemotes: ["origin"] }
    })
  );
  setShowRemoteBranch(false);
  setShowRemoteBranch(true);
  expect(stores.hiddenRemotes.value).toEqual(["origin"]);
  expect(latestGraphRequest("loadCommits")).toEqual(
    expect.objectContaining({
      command: "loadCommits",
      hiddenRemotes: ["origin"],
      showRemoteBranches: true,
      maxCommits: 600
    })
  );
  selectRepo("/other");
  expect(stores.hiddenRemotes.value).toEqual([]);
  selectRepo("/repo");
  expect(stores.hiddenRemotes.value).toEqual(["origin"]);
});

it("clears a hidden focus target and reveals only the requested remote when selected or focused", () => {
  focusBranchInGraph("remotes/origin/main");
  setRemoteVisible("origin", false);
  expect(stores.selectedBranch.value).toBe("*");
  expect(stores.branchFocusTarget.value).toBeUndefined();
  setRemoteVisible("other", false);
  selectBranch("remotes/origin/main");
  expect(stores.hiddenRemotes.value).toEqual(["other"]);
  expect(stores.branchFocusTarget.value).toBe("remotes/origin/main");
  setRemoteVisible("origin", false);
  setShowRemoteBranch(false);
  focusBranchInGraph("remotes/origin/main");
  expect(stores.showRemoteBranch.value).toBe(true);
  expect(stores.hiddenRemotes.value).toEqual(["other"]);
  expect(stores.branchFocusTarget.value).toBe("remotes/origin/main");
  expect(stores.headBranch.value).toBe("main");
  expect(
    vscodeApi.postMessage.mock.calls.every(([message]) =>
      ["loadBranches", "loadCommits", "saveRepoState"].includes(message.command)
    )
  ).toBe(true);
});

it("ignores history and branch replies from older remote visibility choices", () => {
  const previousKey = stores.remoteVisibilityKey();
  setRemoteVisible("origin", false);
  const rows = stores.commitList.value;
  const branches = stores.branchList.value;
  const commitsReply = {
    command: "loadCommits" as const,
    requestId: latestGraphRequest("loadCommits").requestId,
    repo: "/repo",
    branchName: "",
    commits: [],
    head: "old",
    hard: true,
    moreCommitsAvailable: false,
    uncommittedChanges: 0,
    visibilityKey: previousKey
  };
  const branchesReply = {
    command: "loadBranches" as const,
    requestId: latestGraphRequest("loadBranches").requestId,
    repo: "/repo",
    branches: ["old"],
    head: "old",
    hard: true,
    isRepo: true,
    visibilityKey: previousKey
  };
  handleLoadCommits(commitsReply);
  handleLoadBranches(branchesReply);
  expect(stores.commitList.value).toBe(rows);
  expect(stores.branchList.value).toBe(branches);
  handleLoadCommits({
    ...commitsReply,
    head: "current",
    visibilityKey: stores.remoteVisibilityKey()
  });
  handleLoadBranches({
    ...branchesReply,
    branches: ["main"],
    head: "main",
    visibilityKey: stores.remoteVisibilityKey()
  });
  expect(stores.commitHead.value).toBe("current");
  expect(stores.branchList.value).toEqual(["main"]);
});

it("restores saved remote choices and widths before accepting the graph for a reopened panel", () => {
  stores.repoStates.value = {};
  stores.selectedBranch.value = undefined;
  stores.commitList.value = undefined;
  receiveRepoState({
    command: "repoState",
    repo: "/repo",
    state: { columnWidths: [90, 80, 80, 80], hiddenRemotes: ["origin"] }
  });
  expect(stores.hiddenRemotes.value).toEqual(["origin"]);
  expect(stores.columnWidths.value).toEqual([90, 80, 80, 80]);
  expect(latestGraphRequest("loadBranches").hiddenRemotes).toEqual(["origin"]);
  handleLoadBranches({
    ...latestGraphRequest("loadBranches"),
    branches: ["main"],
    head: "main",
    isRepo: true
  });
  expect(latestGraphRequest("loadCommits").hiddenRemotes).toEqual(["origin"]);
});

it("applies migrated preferences without resetting column widths or another repository's graph", () => {
  stores.repoStates.value = { "/repo": { columnWidths: [90, 80, 80, 80] } };
  const widths = stores.columnWidths.value;
  receiveRepoState({
    command: "repoState",
    repo: "/repo",
    state: { columnWidths: null, hiddenRemotes: ["team/mirror"] }
  });
  expect(stores.columnWidths.value).toBe(widths);
  expect(latestGraphRequest("loadCommits").hiddenRemotes).toEqual(["team/mirror"]);
  vi.clearAllMocks();
  receiveRepoState({
    command: "repoState",
    repo: "/other",
    state: { columnWidths: null, hiddenRemotes: ["origin"] }
  });
  expect(stores.repoStates.value["/other"]?.hiddenRemotes).toEqual(["origin"]);
  expect(stores.hiddenRemotes.value).toEqual(["team/mirror"]);
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
});
