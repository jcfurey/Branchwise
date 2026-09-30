// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

import type { GitRepoSet, GraphPreferences, RequestMessage } from "@/types";

import { vscodeApi } from "@tests/webview/setup";

const preferences: GraphPreferences = {
  branchDisplay: "ancestors",
  focusBranch: "topic",
  focusPaused: true,
  focusDimming: "strong",
  showRemoteBranches: false
};
let disk: GitRepoSet;
const messages = () =>
  vscodeApi.postMessage.mock.calls.map(([message]) => message as RequestMessage);

beforeEach(() => {
  disk = {};
  vi.clearAllMocks();
  vscodeApi.setState.mockReset();
  vscodeApi.getState.mockReturnValue(undefined);
  vscodeApi.postMessage.mockImplementation((message: RequestMessage) => {
    if (message.command === "saveRepoState") {
      disk = JSON.parse(
        JSON.stringify({
          ...disk,
          [message.repo]: { columnWidths: null, ...disk[message.repo], ...message.state }
        })
      );
    }
  });
});

async function freshPanel() {
  vi.resetModules();
  const stores = await import("@/webview/lib/stores");
  const actions = await import("@/webview/lib/actions");
  const navigation = await import("@/webview/lib/navigation");
  const { handleLoadBranches } = await import("@/webview/lib/handler/load-branches");
  const { initializeWebviewConfig } = await import("@/webview/lib/webview-config");
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
  function branches(names = ["main", "topic"], head: string | null = "main") {
    const request = messages().findLast((message) => message.command === "loadBranches");
    if (request?.command !== "loadBranches") {
      throw new Error("No branches request");
    }
    handleLoadBranches({ ...request, branches: names, head, isRepo: true });
  }
  function open(repo: string) {
    actions.selectRepo(repo);
    actions.receiveRepoState({
      command: "repoState",
      repo,
      state: structuredClone(disk[repo] ?? { columnWidths: null })
    });
  }
  return { stores, actions, navigation, messages, branches, open };
}

it("keeps focus and both remote choices per repository across switches and a fresh panel", async () => {
  let panel = await freshPanel();
  panel.open("/first");
  panel.branches();
  panel.actions.focusBranchInGraph("topic");
  panel.actions.setBranchDisplay("ancestors");
  panel.actions.setFocusDimming("strong");
  panel.actions.toggleBranchFocus();
  panel.actions.setRemoteVisible("origin", false);
  panel.actions.setShowRemoteBranch(false);
  panel.actions.saveColumnWidths([80, 90, 100, 110]);
  expect(disk["/first"]).toEqual({
    columnWidths: [80, 90, 100, 110],
    hiddenRemotes: ["origin"],
    graphPreferences: preferences
  });
  panel.open("/second");
  panel.branches();
  expect(panel.stores.branchDisplay.value).toBe("filter");
  expect(panel.stores.showRemoteBranch.value).toBe(true);
  expect(panel.stores.hiddenRemotes.value).toEqual([]);
  panel.open("/first");
  panel.branches();
  expect(panel.stores.branchFocusTarget.value).toBe("topic");
  expect(panel.stores.focusPaused.value).toBe(true);
  expect(panel.stores.showRemoteBranch.value).toBe(false);

  // No navigation state or module singleton survives panel disposal/recreation.
  panel = await freshPanel();
  panel.open("/first");
  expect(panel.stores.branchDisplay.value).toBe("ancestors");
  const request = panel.messages().findLast((message) => message.command === "loadBranches");
  expect(request).toMatchObject({ showRemoteBranches: false, hiddenRemotes: ["origin"] });
  panel.branches();
  expect(panel.stores.branchFocusTarget.value).toBe("topic");
  expect(panel.stores.focusPaused.value).toBe(true);
  expect(panel.stores.focusDimming.value).toBe("strong");
  expect(panel.stores.columnWidths.value).toEqual([80, 90, 100, 110]);
});

it("remembers an explicitly cleared target instead of focusing HEAD again on reopening", async () => {
  disk["/repo"] = { columnWidths: null, graphPreferences: preferences };
  let panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  panel.actions.selectBranch("*");
  panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  expect(panel.stores.branchDisplay.value).toBe("ancestors");
  expect(panel.stores.selectedBranch.value).toBe("*");
  expect(panel.stores.branchFocusTarget.value).toBeUndefined();
  expect(panel.stores.focusPaused.value).toBe(false);
});

it.each(["deleted", "renamed"])(
  "falls back to HEAD when the saved focus branch is %s, and saves the fallback",
  async (change) => {
    disk["/repo"] = { columnWidths: null, graphPreferences: preferences };
    const panel = await freshPanel();
    panel.open("/repo");
    panel.branches(change === "renamed" ? ["main", "new-topic"] : ["main"]);
    expect(panel.stores.branchFocusTarget.value).toBe("main");
    expect(panel.stores.focusPaused.value).toBe(true);
    expect(disk["/repo"]?.graphPreferences?.focusBranch).toBe("main");
    panel.branches(["main", "topic"]);
    expect(panel.stores.branchFocusTarget.value).toBe("main");
  }
);

it("clears unavailable focus in a detached or unborn repository", async () => {
  disk["/repo"] = { columnWidths: null, graphPreferences: preferences };
  const panel = await freshPanel();
  panel.open("/repo");
  panel.branches([], null);
  expect(panel.stores.selectedBranch.value).toBe("*");
  expect(panel.stores.focusPaused.value).toBe(false);
  expect(disk["/repo"]?.graphPreferences?.focusBranch).toBe("*");
});

it("does not overwrite a saved target when switching away before branches load", async () => {
  disk["/repo"] = { columnWidths: null, graphPreferences: preferences };
  const panel = await freshPanel();
  panel.open("/repo");
  panel.open("/other");
  expect(disk["/repo"]?.graphPreferences).toEqual(preferences);
  panel.open("/repo");
  panel.branches();
  expect(panel.stores.branchFocusTarget.value).toBe("topic");
});

it("keeps a newer local choice when an older preference snapshot arrives", async () => {
  const panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  panel.actions.focusBranchInGraph("main");
  panel.actions.setFocusDimming("strong");
  panel.actions.receiveRepoState({
    command: "repoState",
    repo: "/repo",
    state: { columnWidths: null, graphPreferences: preferences }
  });
  expect(panel.stores.branchDisplay.value).toBe("focus");
  expect(panel.stores.branchFocusTarget.value).toBe("main");
  expect(panel.stores.showRemoteBranch.value).toBe(true);
  expect(panel.stores.focusPaused.value).toBe(false);
  expect(panel.stores.repoStates.value["/repo"]?.graphPreferences?.focusBranch).toBe("main");
});

it("migrates old webview focus choices without preferring them over durable choices", async () => {
  disk["/repo"] = { columnWidths: null, hiddenRemotes: ["origin"] };
  vscodeApi.getState.mockReturnValue({
    navigation: { repos: { "/repo": preferences }, workspace: false }
  });
  let panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  expect(panel.stores.branchFocusTarget.value).toBe("topic");
  expect(disk["/repo"]?.graphPreferences).toEqual({ ...preferences, showRemoteBranches: true });
  panel.actions.focusBranchInGraph("main");
  panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  expect(panel.stores.branchFocusTarget.value).toBe("main");
});

it("does not write workspace preferences again for ordinary vertical scrolling", async () => {
  const panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  vscodeApi.postMessage.mockClear();
  panel.navigation.leaveNavigation("/repo");
  panel.navigation.leaveNavigation("/repo");
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
});

it("keeps search and vertical position through webview reload, but clears them on panel closure", async () => {
  let webviewState: unknown;
  vscodeApi.getState.mockImplementation(() => webviewState);
  vscodeApi.setState.mockImplementation((value) => {
    webviewState = structuredClone(value);
  });
  let panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  panel.navigation.setHistoryFilter({ ...panel.navigation.emptyFilter(), text: "needle" });
  panel.navigation.saveHistoryFilter("My filter");
  vi.spyOn(window, "scrollY", "get").mockReturnValue(240);
  panel.navigation.leaveNavigation("/repo");
  vi.restoreAllMocks();
  panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  expect(panel.navigation.historyFilter.value.text).toBe("needle");
  expect(panel.navigation.savedFilters.value[0]?.name).toBe("My filter");
  expect(panel.navigation.restoreScroll.value).toBe(240);
  webviewState = undefined;
  panel = await freshPanel();
  panel.open("/repo");
  panel.branches();
  expect(panel.navigation.historyFilter.value.text).toBe("");
  expect(panel.navigation.savedFilters.value).toEqual([]);
  expect(panel.navigation.restoreScroll.value).toBe(0);
});
