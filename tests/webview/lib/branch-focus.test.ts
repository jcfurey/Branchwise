// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  focusBranchInGraph,
  loadMoreCommits,
  refresh,
  selectBranch,
  selectRepo,
  setBranchDisplay,
  setFocusDimming,
  toggleBranchFocus
} from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleLoadBranches } from "@/webview/lib/handler/load-branches";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import { refMenu } from "@/webview/lib/menus";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphRequests();
  stores.repoStates.value = {};
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.focusPaused.value = false;
  stores.focusDimming.value = "subtle";
  stores.showRemoteBranch.value = true;
  stores.headBranch.value = "main";
  stores.branchList.value = ["main", "topic"];
  stores.commitList.value = [];
  stores.maxCommits.value = 600;
  vi.clearAllMocks();
});

it("focuses local branch labels without checking out and resumes the selected view mode", () => {
  const rows = stores.commitList.value;
  const ref = { type: "head" as const, name: "topic", hash: "topic-tip" };
  refMenu(ref, false)
    .find((entry) => entry?.title === "focusThisBranch")!
    .onClick();
  expect(stores.branchFocusTarget.value).toBe("topic");
  expect(stores.branchDisplay.value).toBe("focus");
  expect(stores.headBranch.value).toBe("main");
  expect(stores.commitList.value).toBe(rows);
  setBranchDisplay("ancestors");
  toggleBranchFocus();
  expect(stores.focusPaused.value).toBe(true);
  refMenu(ref, false)
    .find((entry) => entry?.title === "focusThisBranch")!
    .onClick();
  expect(stores.focusPaused.value).toBe(false);
  expect(stores.branchDisplay.value).toBe("ancestors");
  expect(
    vscodeApi.postMessage.mock.calls.every(([message]) => message.command === "saveRepoState")
  ).toBe(true);
  expect(
    refMenu({ ...ref, type: "tag" }, false).some((entry) => entry?.title === "focusThisBranch")
  ).toBe(false);
});

it("reveals a hidden remote branch for focus without checkout or fetch", () => {
  stores.showRemoteBranch.value = false;
  refMenu({ type: "remote", name: "origin/topic", hash: "remote-tip" }, false)
    .find((entry) => entry?.title === "focusThisBranch")!
    .onClick();
  expect(stores.branchFocusTarget.value).toBe("remotes/origin/topic");
  expect(stores.showRemoteBranch.value).toBe(true);
  expect(stores.headBranch.value).toBe("main");
  expect(
    vscodeApi.postMessage.mock.calls
      .map(([message]) => message.command)
      .filter((command) => command !== "saveRepoState")
  ).toEqual(["loadBranches", "loadCommits"]);
  expect(latestGraphRequest("loadCommits")).toEqual(
    expect.objectContaining({ branchName: "", showRemoteBranches: true })
  );
});

it("pauses and resumes without replacing loaded history, its target or expansion", () => {
  focusBranchInGraph("topic");
  const rows = stores.commitList.value;
  stores.expandedCommit.value = "old-commit";
  setFocusDimming("strong");
  toggleBranchFocus();
  expect(stores.focusPaused.value).toBe(true);
  expect(stores.branchFocusTarget.value).toBe("topic");
  toggleBranchFocus();
  expect(stores.focusPaused.value).toBe(false);
  expect(stores.focusDimming.value).toBe("strong");
  expect(stores.commitList.value).toBe(rows);
  expect(stores.expandedCommit.value).toBe("old-commit");
  expect(stores.maxCommits.value).toBe(600);
  expect(
    vscodeApi.postMessage.mock.calls.every(([message]) => message.command === "saveRepoState")
  ).toBe(true);
  selectBranch("*");
  toggleBranchFocus();
  expect(stores.branchFocusTarget.value).toBeUndefined();
  expect(stores.focusPaused.value).toBe(false);
});

it("restores the paused target and dimming per repository", () => {
  focusBranchInGraph("topic");
  setFocusDimming("strong");
  toggleBranchFocus();
  selectRepo("/focus-other");
  expect(stores.focusPaused.value).toBe(false);
  expect(stores.focusDimming.value).toBe("subtle");
  selectRepo("/repo");
  handleLoadBranches({
    command: "loadBranches",
    requestId: latestGraphRequest("loadBranches").requestId,
    repo: "/repo",
    head: "main",
    branches: ["main", "topic"],
    hard: true,
    isRepo: true
  });
  expect(stores.branchFocusTarget.value).toBe("topic");
  expect(stores.focusPaused.value).toBe(true);
  expect(stores.focusDimming.value).toBe("strong");
  toggleBranchFocus();
  expect(stores.branchFocusTarget.value).toBe("topic");
  expect(stores.focusPaused.value).toBe(false);
});

it("focuses the current branch from Show All without replacing rows or checking out", () => {
  const rows = stores.commitList.value;
  setBranchDisplay("focus");
  expect(stores.selectedBranch.value).toBe("main");
  selectBranch("topic");
  setBranchDisplay("ancestors");
  expect(stores.commitList.value).toBe(rows);
  expect(stores.maxCommits.value).toBe(600);
  expect(
    vscodeApi.postMessage.mock.calls.every(([message]) => message.command === "saveRepoState")
  ).toBe(true);
  selectBranch("*");
  expect(stores.commitList.value).toBe(rows);
});

it("loads all branches for focus and ignores an older filtered response", () => {
  stores.selectedBranch.value = "main";
  setBranchDisplay("focus");
  expect(vscodeApi.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ command: "loadCommits", branchName: "" })
  );
  const response = {
    command: "loadCommits" as const,
    requestId: latestGraphRequest("loadCommits").requestId,
    repo: "/repo",
    branchName: "main",
    commits: [],
    head: null,
    moreCommitsAvailable: false,
    hard: true,
    uncommittedChanges: 0
  };
  handleLoadCommits(response);
  expect(stores.commitList.value).toBeUndefined();
  handleLoadCommits({ ...response, branchName: "" });
  expect(stores.commitList.value).toEqual([]);
  loadMoreCommits();
  expect(latestGraphRequest("loadCommits")).toEqual(
    expect.objectContaining({ command: "loadCommits", branchName: "" })
  );
  setBranchDisplay("filter");
  expect(latestGraphRequest("loadCommits")).toEqual(
    expect.objectContaining({ command: "loadCommits", branchName: "main" })
  );
  handleLoadCommits({ ...response, branchName: "" });
  expect(stores.commitList.value).toBeUndefined();
});

it("restores the view per repository and falls back when the focused branch disappears", () => {
  setBranchDisplay("focus");
  selectRepo("/other");
  expect(stores.branchDisplay.value).toBe("filter");
  selectRepo("/repo");
  expect(stores.branchDisplay.value).toBe("focus");
  handleLoadBranches({
    command: "loadBranches",
    requestId: latestGraphRequest("loadBranches").requestId,
    repo: "/repo",
    head: "main",
    branches: ["main"],
    hard: true,
    isRepo: true
  });
  expect(stores.selectedBranch.value).toBe("main");
  selectBranch("topic");
  refresh();
  handleLoadBranches({
    command: "loadBranches",
    requestId: latestGraphRequest("loadBranches").requestId,
    repo: "/repo",
    head: "main",
    branches: ["main"],
    hard: true,
    isRepo: true
  });
  expect(stores.selectedBranch.value).toBe("main");
});
