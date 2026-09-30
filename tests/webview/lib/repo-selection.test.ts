// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it } from "vitest";

import { initRpcHandler } from "@/webview/lib/rpc/rpc-handler";
import { commitList, selectedBranch, selectedRepo } from "@/webview/lib/stores";
import { repoListStore } from "@/webview/lib/stores/repo-list.store";
import { initializeWebviewConfig } from "@/webview/lib/webview-config";

import { vscodeApi } from "@tests/webview/setup";

beforeAll(() => {
  initializeWebviewConfig({
    autoCenterCommitDetailsView: true,
    dateFormat: "Date & Time",
    graphColours: [],
    graphStyle: "rounded",
    initialLoadCommits: 300,
    loadMoreCommits: 100,
    locale: "en",
    showCurrentBranchByDefault: false
  });
  initRpcHandler(new Map());
});

beforeEach(() => {
  selectedRepo.value = "/workspace";
  selectedBranch.value = "main";
  commitList.value = [];
  vscodeApi.postMessage.mockClear();
});

function selectChild() {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        kind: "rpc.notify",
        id: "select-child",
        name: "repo.select",
        message: { name: "child", path: "/workspace/child" }
      }
    })
  );
}

it("switches the graph and loads branches for the clicked repo", () => {
  selectChild();
  expect(selectedRepo.value).toBe("/workspace/child");
  expect(selectedBranch.value).toBeUndefined();
  expect(commitList.value).toBeUndefined();
  expect(vscodeApi.postMessage).toHaveBeenCalledWith({
    command: "loadBranches",
    requestId: expect.any(String),
    repo: "/workspace/child",
    showRemoteBranches: true,
    hiddenRemotes: [],
    visibilityKey: JSON.stringify([true, []]),
    hard: true
  });
});

it("adds an SCM repository missing from the scan without duplicate picker entries", () => {
  selectChild();
  selectChild();
  expect(repoListStore.get()?.filter((repo) => repo.path === "/workspace/child")).toEqual([
    { name: "child", path: "/workspace/child" }
  ]);
});
