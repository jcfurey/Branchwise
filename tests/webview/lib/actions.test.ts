// @vitest-environment jsdom
import { effect } from "@preact/signals";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode, RepositoryState } from "@/backend/types";
import type { GraphPreferences, RequestMessage, WebviewConfig } from "@/types";
import * as actions from "@/webview/lib/actions";
import { activity } from "@/webview/lib/activity";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { historyOffset } from "@/webview/lib/navigation";
import {
  repositoryRevision,
  repositoryState,
  resetRepositoryState
} from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import type { DialogInput } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

type Command = RequestMessage["command"];

/** Everything posted to the extension since the last reset, oldest first. */
const posted = () => vscodeApi.postMessage.mock.calls.map((call) => call[0] as RequestMessage);
const postedCommands = () => posted().map((message) => message.command);
/** The same, without the repository-state cancellations another module adds as it sees fit. */
const graphCommands = () =>
  postedCommands().filter((command) => command !== "cancelRepositoryQuery");

function lastPosted<C extends Command>(command: C) {
  const found = posted().findLast((message) => message.command === command);
  if (found === undefined) {
    throw new Error(`nothing posted as ${command}`);
  }
  return found as Extract<RequestMessage, { command: C }>;
}

/** How many times subscribers reading `watch` hear about what `run` does. */
function notifications(watch: () => unknown, run: () => void) {
  let seen = -1;
  const stop = effect(() => {
    watch();
    seen += 1;
  });
  run();
  stop();
  return seen;
}

const someRows: GitCommitNode[] = [];
const viewPreferences: GraphPreferences = {
  branchDisplay: "ancestors",
  focusBranch: "topic",
  focusPaused: true,
  focusDimming: "strong",
  showRemoteBranches: false
};
/** A loaded repository state that knows only these remotes. */
function withRemotes(...names: string[]): RepositoryState {
  return {
    remotes: names.map((name) => ({ name, fetchUrls: [], pushUrls: [] })),
    pushDefault: null,
    branches: [],
    remoteBranches: [],
    tags: [],
    worktrees: [],
    head: "main",
    operation: null,
    conflicts: []
  };
}
let startConfig: WebviewConfig;
let repoCount = 0;
/** A repository path no other test has visited, so no saved view carries over. */
const unvisited = () => `/elsewhere-${++repoCount}`;

/** Switch Show All to focus with no HEAD known, and say which branch became the target. */
function focusWithoutHead(branches: string[] | undefined) {
  stores.branchDisplay.value = "filter";
  stores.selectedBranch.value = "*";
  stores.headBranch.value = null;
  stores.branchList.value = branches;
  actions.setBranchDisplay("focus");
  return stores.selectedBranch.value;
}

function receive(repo: string, state: Parameters<typeof actions.receiveRepoState>[0]["state"]) {
  actions.receiveRepoState({ command: "repoState", repo, state });
}

/** A button that opens its menu from clicks, the menu key and presses, at a known place. */
function listeningButton(box = { left: 120, bottom: 64 }) {
  const button = document.createElement("button");
  document.body.append(button);
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ ...box } as DOMRect);
  const entries = [null];
  const open = (event: MouseEvent) => actions.openContextMenu(event, "the-button", entries);
  button.addEventListener("click", open);
  button.addEventListener("contextmenu", open);
  button.addEventListener("mousedown", open);
  return { button, entries };
}

function openFromWindow(event: MouseEvent) {
  actions.openContextMenu(event, "window", []);
}

/** Where the open menu was placed, as `[x, y]`. */
function placed() {
  const menu = stores.contextMenu.value;
  return menu === null ? null : [menu.x, menu.y];
}

beforeAll(() => {
  setupWebviewTest();
  startConfig = getWebviewConfig();
});

/** A repository with its branches and one page of rows loaded, showing every branch. */
beforeEach(() => {
  resetGraphRequests();
  resetRepositoryState();
  stores.selectedRepo.value = "/repo";
  stores.branchList.value = ["main", "topic", "remotes/origin/main"];
  stores.headBranch.value = "main";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.focusPaused.value = false;
  stores.focusDimming.value = "subtle";
  stores.showRemoteBranch.value = true;
  stores.repoStates.value = {};
  stores.commitList.value = someRows;
  stores.commitHead.value = "abc";
  stores.moreCommitsAvailable.value = true;
  stores.uncommittedChanges.value = 3;
  stores.maxCommits.value = 600;
  stores.expandedCommit.value = null;
  stores.commitDetails.value = null;
  stores.graphErrors.value = {};
  stores.contextMenu.value = null;
  stores.dialog.value = null;
  historyOffset.value = 0;
  repositoryState.value = null;
  activity.value = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  stores.contextMenu.value = null;
  actions.closeDialog();
  await Promise.resolve();
  document.body.replaceChildren();
});

describe("selectBranch", () => {
  it("does nothing for the branch already chosen", () => {
    stores.selectedBranch.value = "main";
    actions.selectBranch("main");
    expect(posted()).toEqual([]);
    expect(stores.commitList.value).toBe(someRows);
    expect(stores.maxCommits.value).toBe(600);
  });

  it("changes the view but posts nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    actions.selectBranch("topic");
    expect(posted()).toEqual([]);
    expect(stores.selectedBranch.value).toBe("topic");
    expect(stores.commitList.value).toBeUndefined();
    expect(stores.maxCommits.value).toBe(300);
  });

  it("filters to a branch from a first page, keeping the pause and other errors", () => {
    stores.focusPaused.value = true;
    stores.expandedCommit.value = "abc";
    stores.graphErrors.value = { loadBranches: "branches failed", loadCommits: "rows failed" };
    actions.selectBranch("topic");
    expect(postedCommands()).toEqual(["loadCommits", "saveRepoState"]);
    expect(lastPosted("loadCommits")).toEqual({
      command: "loadCommits",
      requestId: expect.stringMatching(/^graph-\d+$/),
      repo: "/repo",
      branchName: "topic",
      maxCommits: 300,
      showRemoteBranches: true,
      hiddenRemotes: [],
      visibilityKey: "[true,[]]",
      hard: true
    });
    expect(stores.commitHead.value).toBeNull();
    expect(stores.moreCommitsAvailable.value).toBe(false);
    expect(stores.uncommittedChanges.value).toBe(0);
    expect(stores.expandedCommit.value).toBeNull();
    expect(stores.graphErrors.value.loadBranches).toBe("branches failed");
    expect(stores.graphErrors.value.loadCommits).toBeUndefined();
    expect(stores.focusPaused.value).toBe(true);

    actions.selectBranch("*");
    expect(stores.focusPaused.value).toBe(false);
    expect(lastPosted("loadCommits").branchName).toBe("");
  });

  it("changes the selection and resets the rows in one notification", () => {
    const runs = notifications(
      () => [
        stores.selectedBranch.value,
        stores.commitList.value,
        stores.maxCommits.value,
        stores.expandedCommit.value
      ],
      () => actions.selectBranch("topic")
    );
    expect(runs).toBe(1);
  });

  it("keeps the rows when choosing another branch to emphasise", () => {
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    actions.selectBranch("topic");
    expect(postedCommands()).toEqual(["saveRepoState"]);
    expect(stores.commitList.value).toBe(someRows);
    expect(stores.maxCommits.value).toBe(600);
  });

  it("reloads without resetting when the chosen remote branch is shown again", () => {
    stores.selectedBranch.value = "remotes/origin/main";
    stores.showRemoteBranch.value = false;
    actions.selectBranch("remotes/origin/main");
    expect(stores.showRemoteBranch.value).toBe(true);
    expect(stores.commitList.value).toBe(someRows);
    expect(postedCommands()).toEqual(["loadBranches", "loadCommits", "saveRepoState"]);
    expect(lastPosted("loadCommits")).toMatchObject({
      branchName: "remotes/origin/main",
      maxCommits: 600,
      showRemoteBranches: true
    });
    expect(lastPosted("saveRepoState").state).toHaveProperty("graphPreferences");
  });

  it("saves what is left of the hidden list before loading a revealed branch", () => {
    stores.repoStates.value = {
      "/repo": { columnWidths: [1, 2, 3, 4], hiddenRemotes: ["origin", "team/mirror"] }
    };
    actions.selectBranch("remotes/origin/main");
    expect(postedCommands()).toEqual([
      "saveRepoState",
      "loadBranches",
      "loadCommits",
      "saveRepoState"
    ]);
    expect(posted()[0]).toEqual({
      command: "saveRepoState",
      repo: "/repo",
      state: { hiddenRemotes: ["team/mirror"] }
    });
    expect(lastPosted("loadBranches")).toMatchObject({
      hiddenRemotes: ["team/mirror"],
      visibilityKey: '[true,["team/mirror"]]'
    });
    expect(stores.repoStates.value["/repo"]).toMatchObject({
      columnWidths: [1, 2, 3, 4],
      hiddenRemotes: ["team/mirror"]
    });

    vi.clearAllMocks();
    actions.selectBranch("remotes/origin/main");
    expect(posted()).toEqual([]);
  });

  it("finds a branch's remote among the longest known names", () => {
    stores.repoStates.value = {
      "/repo": { columnWidths: null, hiddenRemotes: ["team/mirror", "team"] }
    };
    actions.selectBranch("remotes/team/mirror/x");
    expect(posted()[0]).toMatchObject({ state: { hiddenRemotes: ["team"] } });

    vi.clearAllMocks();
    stores.selectedBranch.value = "*";
    repositoryState.value = withRemotes("team/mirror");
    actions.selectBranch("remotes/team/mirror/y");
    // Not revealed: its remote is `team/mirror`, which is not hidden.
    expect(postedCommands()).toEqual(["loadCommits"]);
    expect(stores.hiddenRemotes.value).toEqual(["team"]);
  });

  it("leaves the remotes switch alone for a name without a remote", () => {
    stores.showRemoteBranch.value = false;
    actions.selectBranch("origin/main");
    expect(stores.showRemoteBranch.value).toBe(false);
    expect(postedCommands()).toEqual(["loadCommits", "saveRepoState"]);
  });
});

describe("setBranchDisplay", () => {
  it("does nothing for the current mode", () => {
    actions.setBranchDisplay("filter");
    expect(posted()).toEqual([]);
    expect(stores.selectedBranch.value).toBe("*");
    expect(stores.commitList.value).toBe(someRows);
  });

  it("targets HEAD, then the first branch, then stays on every branch", () => {
    stores.focusPaused.value = true;
    actions.setBranchDisplay("focus");
    expect(stores.selectedBranch.value).toBe("main");
    expect(stores.focusPaused.value).toBe(false);
    expect(stores.commitList.value).toBe(someRows);
    expect(postedCommands()).toEqual(["saveRepoState"]);

    expect(focusWithoutHead(["dev", "main"])).toBe("dev");
    expect(focusWithoutHead([])).toBe("*");
    expect(focusWithoutHead(undefined)).toBe("*");
  });

  it("reloads the whole graph when leaving a filtered branch", () => {
    stores.selectedBranch.value = "main";
    actions.setBranchDisplay("ancestors");
    expect(stores.maxCommits.value).toBe(300);
    expect(postedCommands()).toEqual(["loadCommits", "saveRepoState"]);
    expect(lastPosted("loadCommits")).toMatchObject({ branchName: "", maxCommits: 300 });
    expect(lastPosted("saveRepoState").state).toEqual({
      graphPreferences: {
        branchDisplay: "ancestors",
        focusBranch: "main",
        focusPaused: false,
        focusDimming: "subtle",
        showRemoteBranches: true
      }
    });
  });

  it("asks for nothing before a branch is chosen", () => {
    stores.selectedBranch.value = undefined;
    stores.commitList.value = undefined;
    actions.setBranchDisplay("focus");
    expect(posted()).toEqual([]);
    expect(stores.selectedBranch.value).toBeUndefined();
    expect(stores.branchDisplay.value).toBe("focus");
  });
});

describe("focusBranchInGraph", () => {
  it("resets and reloads the graph when leaving a filtered branch", () => {
    stores.selectedBranch.value = "main";
    stores.expandedCommit.value = "abc";
    actions.focusBranchInGraph("topic");
    expect(stores.branchDisplay.value).toBe("focus");
    expect(stores.branchFocusTarget.value).toBe("topic");
    expect(stores.commitList.value).toBeUndefined();
    expect(stores.maxCommits.value).toBe(300);
    expect(stores.expandedCommit.value).toBeNull();
    expect(postedCommands()).toEqual(["loadCommits", "saveRepoState"]);
    expect(lastPosted("loadCommits")).toMatchObject({ branchName: "", maxCommits: 300 });
  });

  it("keeps the ancestors mode and posts nothing for an unchanged target", () => {
    stores.branchDisplay.value = "ancestors";
    actions.focusBranchInGraph("main");
    expect(stores.branchDisplay.value).toBe("ancestors");
    expect(lastPosted("saveRepoState").state.graphPreferences).toMatchObject({
      branchDisplay: "ancestors",
      focusBranch: "main"
    });
    vi.clearAllMocks();
    actions.focusBranchInGraph("main");
    expect(posted()).toEqual([]);
  });

  it("reveals a hidden remote and keeps the rows", () => {
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenRemotes: ["origin"] } };
    actions.focusBranchInGraph("remotes/origin/main");
    expect(postedCommands()).toEqual([
      "saveRepoState",
      "loadBranches",
      "loadCommits",
      "saveRepoState"
    ]);
    expect(posted()[0]).toMatchObject({ state: { hiddenRemotes: [] } });
    expect(lastPosted("loadCommits")).toMatchObject({ branchName: "", maxCommits: 600 });
    expect(stores.commitList.value).toBe(someRows);
  });

  it("changes the view but posts nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    stores.commitList.value = undefined;
    actions.focusBranchInGraph("topic");
    expect(posted()).toEqual([]);
    expect(stores.branchDisplay.value).toBe("focus");
    expect(stores.selectedBranch.value).toBe("topic");
  });
});

describe("pause and dimming", () => {
  it("pauses only with a target and saves the choice", () => {
    actions.toggleBranchFocus();
    expect(stores.focusPaused.value).toBe(false);
    expect(posted()).toEqual([]);

    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    actions.toggleBranchFocus();
    expect(stores.focusPaused.value).toBe(true);
    expect(lastPosted("saveRepoState").state.graphPreferences).toMatchObject({
      focusBranch: "main",
      focusPaused: true
    });
    expect(stores.commitList.value).toBe(someRows);
  });

  it("saves a new dimming once", () => {
    actions.setFocusDimming("strong");
    expect(lastPosted("saveRepoState").state.graphPreferences?.focusDimming).toBe("strong");
    vi.clearAllMocks();
    actions.setFocusDimming("strong");
    expect(posted()).toEqual([]);
  });

  it("only changes the stores without a repository", () => {
    stores.selectedRepo.value = undefined;
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    actions.toggleBranchFocus();
    actions.setFocusDimming("strong");
    expect(stores.focusPaused.value).toBe(true);
    expect(stores.focusDimming.value).toBe("strong");
    expect(posted()).toEqual([]);
  });
});

describe("column widths", () => {
  it("does nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    const before = stores.repoStates.value;
    actions.setColumnWidths([1]);
    actions.saveColumnWidths([1]);
    expect(stores.repoStates.value).toBe(before);
    expect(posted()).toEqual([]);
  });

  it("stores the given array and leaves other repositories' records alone", () => {
    const other = { columnWidths: [7, 7, 7, 7] };
    stores.repoStates.value = {
      "/repo": { columnWidths: null, hiddenRemotes: ["x"] },
      "/other": other
    };
    const dragged = [10, 20, 30, 40];
    actions.setColumnWidths(dragged);
    expect(stores.repoStates.value["/repo"]?.columnWidths).toBe(dragged);
    expect(stores.repoStates.value["/repo"]?.hiddenRemotes).toEqual(["x"]);
    expect(stores.repoStates.value["/other"]).toBe(other);
    expect(posted()).toEqual([]);

    const released = [1, 2, 3, 4];
    actions.saveColumnWidths(released);
    expect(posted()).toEqual([
      { command: "saveRepoState", repo: "/repo", state: { columnWidths: released } }
    ]);
    expect(lastPosted("saveRepoState").state.columnWidths).toBe(released);
  });

  it("creates a record holding only the widths", () => {
    const widths = [5, 6];
    actions.setColumnWidths(widths);
    expect(stores.repoStates.value).toEqual({ "/repo": { columnWidths: widths } });
    actions.saveColumnWidths([]);
    expect(lastPosted("saveRepoState").state).toEqual({ columnWidths: [] });
  });
});

describe("remote visibility", () => {
  it("ignores the switch's current value", () => {
    actions.setShowRemoteBranch(true);
    expect(posted()).toEqual([]);
  });

  it("moves off a remote branch when remotes are switched off, keeping the rows", () => {
    stores.selectedBranch.value = "remotes/origin/main";
    stores.focusPaused.value = true;
    stores.expandedCommit.value = "abc";
    historyOffset.value = 7;
    actions.setShowRemoteBranch(false);
    expect(stores.selectedBranch.value).toBe("*");
    expect(stores.focusPaused.value).toBe(false);
    expect(historyOffset.value).toBe(0);
    expect(stores.commitList.value).toBe(someRows);
    expect(stores.expandedCommit.value).toBe("abc");
    expect(stores.maxCommits.value).toBe(600);
    expect(postedCommands()).toEqual(["loadBranches", "loadCommits", "saveRepoState"]);
    expect(lastPosted("loadBranches")).toMatchObject({
      showRemoteBranches: false,
      visibilityKey: "[false,[]]"
    });
    expect(lastPosted("loadCommits")).toMatchObject({ branchName: "", showRemoteBranches: false });
  });

  it("only asks for branches while none is chosen", () => {
    stores.selectedBranch.value = undefined;
    actions.setShowRemoteBranch(false);
    expect(postedCommands()).toEqual(["loadBranches"]);
  });

  it("changes the switch but posts nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    stores.showRemoteBranch.value = false;
    stores.selectedBranch.value = "remotes/origin/main";
    historyOffset.value = 3;
    actions.setRemoteVisible("origin", true);
    expect(stores.showRemoteBranch.value).toBe(true);
    expect(stores.repoStates.value).toEqual({});
    actions.setShowRemoteBranch(false);
    expect(stores.selectedBranch.value).toBe("*");
    expect(historyOffset.value).toBe(0);
    expect(posted()).toEqual([]);
  });

  it("keeps the hidden list sorted and free of repeats", () => {
    stores.repoStates.value = { "/repo": { columnWidths: [1, 2, 3, 4] } };
    actions.setRemoteVisible("zeta", false);
    expect(postedCommands()).toEqual([
      "saveRepoState",
      "loadBranches",
      "loadCommits",
      "saveRepoState"
    ]);
    expect(lastPosted("loadBranches")).toMatchObject({
      hiddenRemotes: ["zeta"],
      visibilityKey: '[true,["zeta"]]'
    });
    actions.setRemoteVisible("alpha", false);
    expect(posted().findLast((message) => message.command === "saveRepoState")).toEqual({
      command: "saveRepoState",
      repo: "/repo",
      state: { hiddenRemotes: ["alpha", "zeta"] }
    });
    expect(stores.repoStates.value["/repo"]).toMatchObject({
      columnWidths: [1, 2, 3, 4],
      hiddenRemotes: ["alpha", "zeta"]
    });
  });

  it("sorts by code unit and creates a record when there is none", () => {
    actions.setRemoteVisible("B", false);
    expect(stores.repoStates.value["/repo"]).toMatchObject({
      columnWidths: null,
      hiddenRemotes: ["B"]
    });
    actions.setRemoteVisible("a", false);
    expect(stores.hiddenRemotes.value).toEqual(["B", "a"]);
  });

  it("moves off a branch of a remote that gets hidden", () => {
    stores.selectedBranch.value = "remotes/zeta/x";
    actions.setRemoteVisible("zeta", false);
    expect(stores.selectedBranch.value).toBe("*");
    expect(lastPosted("loadCommits").branchName).toBe("");
  });

  it("writes the list, the switch and the selection in one notification", () => {
    stores.showRemoteBranch.value = false;
    stores.selectedBranch.value = "remotes/origin/main";
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenRemotes: ["origin"] } };
    const runs = notifications(
      () => [
        stores.hiddenRemotes.value,
        stores.showRemoteBranch.value,
        stores.selectedBranch.value,
        historyOffset.value
      ],
      () => actions.setRemoteVisible("origin", true)
    );
    expect(runs).toBe(1);
  });

  // Decision Q4: a request that changes nothing does nothing.
  it("does nothing when hiding a hidden remote", () => {
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenRemotes: ["alpha"] } };
    const before = stores.repoStates.value;
    historyOffset.value = 4;
    actions.setRemoteVisible("alpha", false);
    expect(posted()).toEqual([]);
    expect(stores.repoStates.value).toBe(before);
    expect(historyOffset.value).toBe(4);
  });

  it("does nothing when showing a shown remote while remotes are on", () => {
    const before = stores.repoStates.value;
    actions.setRemoteVisible("origin", true);
    expect(posted()).toEqual([]);
    expect(stores.repoStates.value).toBe(before);
  });

  it("still turns remotes on when showing a remote that was not hidden", () => {
    stores.showRemoteBranch.value = false;
    actions.setRemoteVisible("origin", true);
    expect(stores.showRemoteBranch.value).toBe(true);
    expect(graphCommands()).toEqual(expect.arrayContaining(["loadBranches", "loadCommits"]));
    expect(lastPosted("loadBranches").showRemoteBranches).toBe(true);
  });

  it("leaves remotes off when hiding one", () => {
    stores.showRemoteBranch.value = false;
    actions.setRemoteVisible("alpha", false);
    expect(stores.showRemoteBranch.value).toBe(false);
    expect(stores.hiddenRemotes.value).toEqual(["alpha"]);
  });
});

describe("receiveRepoState", () => {
  it("stores the record and posts nothing when nothing relevant changed", () => {
    stores.selectedBranch.value = "main";
    const kept: GraphPreferences = { ...viewPreferences, branchDisplay: "focus" };
    stores.repoStates.value = {
      "/repo": { columnWidths: null, hiddenRemotes: ["o"], graphPreferences: kept }
    };
    receive("/repo", {
      columnWidths: [9, 9, 9, 9],
      hiddenRemotes: ["o"],
      graphPreferences: viewPreferences
    });
    expect(posted()).toEqual([]);
    expect(stores.repoStates.value["/repo"]?.columnWidths).toBeNull();
    expect(stores.repoStates.value["/repo"]?.graphPreferences).toBe(kept);
  });

  it("keeps widths set on the page and reloads for a new hidden list", () => {
    stores.selectedBranch.value = "main";
    const widths = [1, 2, 3, 4];
    stores.repoStates.value = { "/repo": { columnWidths: widths } };
    receive("/repo", { columnWidths: [9, 9, 9, 9], hiddenRemotes: ["o"] });
    expect(stores.columnWidths.value).toBe(widths);
    expect(stores.hiddenRemotes.value).toEqual(["o"]);
    expect(postedCommands()).toEqual(["loadBranches", "loadCommits", "saveRepoState"]);
    expect(lastPosted("loadCommits")).toMatchObject({ branchName: "main", maxCommits: 600 });

    vi.clearAllMocks();
    receive("/repo", { columnWidths: null });
    expect(stores.hiddenRemotes.value).toEqual([]);
    expect(postedCommands()).toEqual(["loadBranches", "loadCommits"]);
  });

  // Decision Q3: hidden lists are sets.
  it("treats the same remotes in another order as no change", () => {
    stores.selectedBranch.value = "main";
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenRemotes: ["b", "a"] } };
    receive("/repo", { columnWidths: null, hiddenRemotes: ["a", "b", "a"] });
    expect(posted()).toEqual([]);
    expect(stores.hiddenRemotes.value).toEqual(["a", "b"]);
  });

  it("stores any repository's hidden list sorted and without repeats", () => {
    receive("/else", { columnWidths: null, hiddenRemotes: ["z", "m", "z"] });
    expect(stores.repoStates.value["/else"]?.hiddenRemotes).toEqual(["m", "z"]);
  });

  it("applies saved preferences before a branch is chosen", () => {
    stores.selectedBranch.value = undefined;
    stores.commitList.value = undefined;
    receive("/repo", { columnWidths: null, graphPreferences: viewPreferences });
    expect(postedCommands()).toEqual(["loadBranches"]);
    expect(lastPosted("loadBranches")).toMatchObject({
      showRemoteBranches: false,
      hiddenRemotes: [],
      visibilityKey: "[false,[]]"
    });
    expect(stores.branchDisplay.value).toBe("ancestors");
    expect(stores.focusPaused.value).toBe(true);
    expect(stores.focusDimming.value).toBe("strong");
    expect(stores.showRemoteBranch.value).toBe(false);
    expect(stores.repoStates.value["/repo"]).toEqual({
      columnWidths: null,
      graphPreferences: viewPreferences,
      hiddenRemotes: []
    });
  });

  it("moves off a remote branch the record hides", () => {
    stores.selectedBranch.value = "remotes/origin/main";
    stores.focusPaused.value = true;
    stores.repoStates.value = { "/repo": { columnWidths: null } };
    receive("/repo", { columnWidths: null, hiddenRemotes: ["origin"] });
    expect(stores.selectedBranch.value).toBe("*");
    expect(stores.focusPaused.value).toBe(false);
    expect(lastPosted("loadCommits").branchName).toBe("");
  });

  it("only stores another repository's record", () => {
    const own = { columnWidths: [3, 3, 3, 3] };
    stores.repoStates.value = { "/repo": own };
    receive("/else", {
      columnWidths: [4, 4, 4, 4],
      hiddenRemotes: ["q"],
      graphPreferences: viewPreferences
    });
    expect(posted()).toEqual([]);
    expect(stores.repoStates.value["/repo"]).toBe(own);
    expect(stores.repoStates.value["/else"]).toEqual({
      columnWidths: [4, 4, 4, 4],
      hiddenRemotes: ["q"],
      graphPreferences: viewPreferences
    });
    expect(stores.branchDisplay.value).toBe("filter");
  });
});

describe("loading", () => {
  it("asks for another page with the displayed branch", () => {
    stores.graphErrors.value = { loadBranches: "b", loadCommits: "c" };
    actions.loadMoreCommits();
    expect(stores.maxCommits.value).toBe(700);
    expect(posted()).toEqual([
      expect.objectContaining({ command: "loadCommits", branchName: "", maxCommits: 700 })
    ]);
    expect(stores.graphErrors.value.loadBranches).toBe("b");
    expect(stores.graphErrors.value.loadCommits).toBeUndefined();
    expect(stores.commitList.value).toBe(someRows);
  });

  // Decision Q6: no page is added that cannot be asked for.
  it("changes nothing while no branch is chosen", () => {
    stores.selectedBranch.value = undefined;
    actions.loadMoreCommits();
    expect(stores.maxCommits.value).toBe(600);
    expect(posted()).toEqual([]);
  });

  it("changes nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    actions.loadMoreCommits();
    expect(stores.maxCommits.value).toBe(600);
    expect(posted()).toEqual([]);
  });

  it("reloads branches, repository state and rows, keeping what is shown", () => {
    stores.selectedBranch.value = "main";
    stores.expandedCommit.value = "abc";
    stores.graphErrors.value = { loadBranches: "b", loadCommits: "c" };
    const revision = repositoryRevision.value;
    // Buttons pass their click event straight through.
    const onClick: (event: MouseEvent) => void = actions.refresh;
    onClick(new MouseEvent("click"));
    expect(graphCommands()).toEqual(["loadBranches", "repositoryQuery", "loadCommits"]);
    expect(lastPosted("repositoryQuery").query).toEqual({ kind: "state" });
    expect(lastPosted("loadCommits")).toMatchObject({ branchName: "main", maxCommits: 600 });
    expect(repositoryRevision.value).toBe(revision + 1);
    expect(stores.commitList.value).toBe(someRows);
    expect(stores.expandedCommit.value).toBe("abc");
    expect(stores.graphErrors.value).toEqual({});
  });

  it("does nothing on refresh without a repository", () => {
    stores.selectedRepo.value = undefined;
    const revision = repositoryRevision.value;
    actions.refresh();
    expect(posted()).toEqual([]);
    expect(repositoryRevision.value).toBe(revision);
  });

  it("raises the page size for a larger first page and reloads for any change", () => {
    try {
      actions.applyWebviewConfig({ ...startConfig, initialLoadCommits: 500, loadMoreCommits: 50 });
      expect(stores.maxCommits.value).toBe(600);
      expect(graphCommands()).toEqual(["loadBranches", "repositoryQuery", "loadCommits"]);

      const larger = { ...startConfig, initialLoadCommits: 1000, loadMoreCommits: 50 };
      actions.applyWebviewConfig(larger);
      expect(getWebviewConfig()).toBe(larger);
      expect(lastPosted("loadCommits").maxCommits).toBe(1000);
      actions.loadMoreCommits();
      expect(stores.maxCommits.value).toBe(1050);
    } finally {
      actions.applyWebviewConfig(startConfig);
    }
  });
});

describe("commit details", () => {
  it("asks for a commit's details and closes them on a second toggle", () => {
    actions.toggleCommitDetails("h1");
    expect(posted()).toEqual([
      {
        command: "commitDetails",
        requestId: expect.stringMatching(/^graph-\d+$/),
        repo: "/repo",
        commitHash: "h1"
      }
    ]);
    expect(stores.expandedCommit.value).toBe("h1");
    expect(stores.commitDetails.value).toBeNull();
    vi.clearAllMocks();
    actions.toggleCommitDetails("h1");
    expect(posted()).toEqual([]);
    expect(stores.expandedCommit.value).toBeNull();
  });

  it("opens the uncommitted row without asking the extension", () => {
    actions.toggleCommitDetails("*");
    expect(stores.expandedCommit.value).toBe("*");
    expect(posted()).toEqual([]);
  });

  // Decision Q9: without a repository there are no details to show.
  it("does nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    actions.toggleCommitDetails("h");
    expect(stores.expandedCommit.value).toBeNull();
    expect(posted()).toEqual([]);

    stores.expandedCommit.value = "open";
    actions.toggleCommitDetails("open");
    expect(stores.expandedCommit.value).toBe("open");
  });

  it("closes in one notification", () => {
    stores.expandedCommit.value = "h";
    const runs = notifications(
      () => [stores.expandedCommit.value, stores.commitDetails.value],
      () => actions.closeCommitDetails()
    );
    expect(runs).toBe(1);
    expect(stores.expandedCommit.value).toBeNull();
  });
});

describe("viewDiff", () => {
  const change = {
    oldFilePath: "a",
    newFilePath: "b",
    type: "R" as const,
    additions: 1,
    deletions: 2
  };

  it("sends the file's paths and type only", () => {
    actions.viewDiff("c1", change);
    expect(posted()).toEqual([
      {
        command: "viewDiff",
        repo: "/repo",
        commitHash: "c1",
        oldFilePath: "a",
        newFilePath: "b",
        type: "R"
      }
    ]);
    expect(stores.dialog.value).toBeNull();
  });

  it("sends nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    actions.viewDiff("c1", change);
    expect(posted()).toEqual([]);
  });
});

describe("selectRepo", () => {
  it("does nothing for the repository already shown", () => {
    stores.dialog.value = { kind: "error", message: "E", reason: null, token: -1 };
    actions.selectRepo("/repo");
    expect(posted()).toEqual([]);
    expect(stores.dialog.value).not.toBeNull();
    expect(stores.commitList.value).toBe(someRows);
  });

  // Decision Q8: a switch closes an open menu along with the dialog.
  it("starts the new repository from scratch and closes the dialog and the menu", () => {
    stores.selectedBranch.value = "main";
    stores.expandedCommit.value = "abc";
    stores.dialog.value = { kind: "error", message: "E", reason: null, token: -1 };
    stores.contextMenu.value = { x: 1, y: 2, entries: [], source: "somewhere" };
    const next = unvisited();
    actions.selectRepo(next);
    expect(stores.selectedRepo.value).toBe(next);
    expect(stores.dialog.value).toBeNull();
    expect(stores.contextMenu.value).toBeNull();
    expect(stores.branchList.value).toBeUndefined();
    expect(stores.commitList.value).toBeUndefined();
    expect(stores.selectedBranch.value).toBeUndefined();
    expect(stores.headBranch.value).toBeNull();
    expect(stores.commitHead.value).toBeNull();
    expect(stores.expandedCommit.value).toBeNull();
    expect(stores.maxCommits.value).toBe(300);
    expect(posted()[0]).toMatchObject({ command: "saveRepoState", repo: "/repo" });
    const commands = graphCommands();
    expect(commands.slice(-3)).toEqual(["selectRepo", "loadBranches", "repositoryQuery"]);
    expect(commands).not.toContain("loadCommits");
    expect(lastPosted("selectRepo")).toEqual({ command: "selectRepo", repo: next });
    expect(lastPosted("loadBranches")).toEqual({
      command: "loadBranches",
      requestId: expect.stringMatching(/^graph-\d+$/),
      repo: next,
      showRemoteBranches: true,
      hiddenRemotes: [],
      visibilityKey: "[true,[]]",
      hard: true
    });
  });

  it("switches in one notification, menu closing included", () => {
    stores.dialog.value = { kind: "error", message: "E", reason: null, token: -1 };
    stores.contextMenu.value = { x: 0, y: 0, entries: [], source: "somewhere" };
    const runs = notifications(
      () => [
        stores.selectedRepo.value,
        stores.branchList.value,
        stores.commitList.value,
        stores.dialog.value,
        stores.contextMenu.value
      ],
      () => actions.selectRepo(unvisited())
    );
    expect(runs).toBe(1);
  });

  it("clears graph errors and restores the new repository's saved view", () => {
    const next = unvisited();
    stores.graphErrors.value = { loadBranches: "b", loadCommits: "c" };
    stores.repoStates.value = {
      [next]: { columnWidths: null, hiddenRemotes: ["up"], graphPreferences: viewPreferences }
    };
    historyOffset.value = 5;
    actions.selectRepo(next);
    expect(stores.graphErrors.value).toEqual({});
    expect(stores.branchDisplay.value).toBe("ancestors");
    expect(stores.showRemoteBranch.value).toBe(false);
    expect(historyOffset.value).toBe(0);
    expect(lastPosted("loadBranches")).toMatchObject({
      showRemoteBranches: false,
      hiddenRemotes: ["up"],
      visibilityKey: '[false,["up"]]'
    });
  });
});

describe("openContextMenu", () => {
  it("keeps the event to itself", () => {
    const { button, entries } = listeningButton();
    let reachedBody = 0;
    const count = () => (reachedBody += 1);
    document.body.addEventListener("contextmenu", count);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20
    });
    button.dispatchEvent(event);
    document.body.removeEventListener("contextmenu", count);
    expect(event.defaultPrevented).toBe(true);
    expect(reachedBody).toBe(0);
    expect(stores.contextMenu.value).toEqual({ x: 10, y: 20, entries, source: "the-button" });
    expect(stores.contextMenu.value?.entries).toBe(entries);
  });

  it.each([
    ["click", { detail: 0, clientX: 30, clientY: 40 }, [120, 64]],
    ["click", { detail: 1, clientX: 0, clientY: 0 }, [0, 0]],
    ["contextmenu", { clientX: 0, clientY: 0 }, [120, 64]],
    ["contextmenu", { clientX: 0, clientY: 9 }, [0, 9]],
    ["contextmenu", { detail: 0, clientX: 3, clientY: 4 }, [3, 4]],
    ["mousedown", { clientX: 0, clientY: 0 }, [120, 64]]
  ] as const)("places a %s with %o at %o", (type, init, where) => {
    const { button } = listeningButton();
    button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    expect(placed()).toEqual(where);
  });

  it("hangs a keyboard menu below the element that listens", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ left: 1, bottom: 4 } as DOMRect);
    parent.addEventListener("click", (event) => actions.openContextMenu(event, "parent", []));
    child.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0, clientX: 50 }));
    expect(placed()).toEqual([1, 4]);
  });

  it("uses the pointer position when no element listens", () => {
    window.addEventListener("contextmenu", openFromWindow);
    try {
      document.body.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      expect(placed()).toEqual([0, 0]);
    } finally {
      window.removeEventListener("contextmenu", openFromWindow);
    }
    actions.openContextMenu(
      new MouseEvent("click", { detail: 0, clientX: 11, clientY: 12 }),
      "synthetic",
      []
    );
    expect(placed()).toEqual([11, 12]);
  });

  it("leaves an open dialog as it is", () => {
    const { button } = listeningButton();
    actions.openErrorDialog("E");
    const open = stores.dialog.value;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 5 }));
    expect(stores.dialog.value).toBe(open);
    expect(placed()).toEqual([5, 0]);
  });

  it("gives focus back to the opener a microtask after closing", async () => {
    const { button } = listeningButton();
    const other = document.createElement("button");
    document.body.append(other);
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 5 }));
    other.focus();
    actions.closeContextMenu();
    expect(stores.contextMenu.value).toBeNull();
    expect(document.activeElement).toBe(other);
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
  });
});

describe("dialogs", () => {
  it("replaces a menu in one notification", () => {
    stores.contextMenu.value = { x: 0, y: 0, entries: [], source: "menu" };
    const runs = notifications(
      () => [stores.contextMenu.value, stores.dialog.value],
      () => actions.openErrorDialog("E")
    );
    expect(runs).toBe(1);
    expect(stores.contextMenu.value).toBeNull();
    expect(stores.dialog.value).toMatchObject({ kind: "error", message: "E", reason: null });
  });

  it("stores exactly the fields each kind needs, with a new token every time", () => {
    const tokens: number[] = [];
    const open = (show: () => void) => {
      show();
      const shown = stores.dialog.value;
      if (shown === null) {
        throw new Error("no dialog opened");
      }
      tokens.push(shown.token);
      const { token: _token, ...fields } = shown;
      return fields;
    };
    expect(open(() => actions.openRunningDialog("R"))).toStrictEqual({
      kind: "running",
      message: "R"
    });
    const stop = vi.fn();
    expect(
      open(() => actions.openRunningDialog("R", { detail: "d", started: 5, onCancel: stop }))
    ).toStrictEqual({ kind: "running", message: "R", detail: "d", started: 5, onCancel: stop });
    expect(open(() => actions.openRunningDialog("R", { detail: "", started: 0 }))).toStrictEqual({
      kind: "running",
      message: "R",
      detail: "",
      started: 0
    });
    expect(open(() => actions.openContentDialog("T", "body"))).toStrictEqual({
      kind: "content",
      message: "T",
      content: "body",
      wide: false
    });
    expect(open(() => actions.openContentDialog("T", "body", true))).toMatchObject({ wide: true });
    expect(open(() => actions.openErrorDialog("E", undefined))).toStrictEqual({
      kind: "error",
      message: "E",
      reason: null
    });
    expect(open(() => actions.openErrorDialog("E", ""))).toMatchObject({ reason: "" });

    actions.openErrorDialog("same");
    const first = stores.dialog.value;
    actions.openErrorDialog("same");
    expect(stores.dialog.value).not.toBe(first);
    tokens.push(first!.token, stores.dialog.value!.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("copies the form's inputs and defaults to a safe confirmation", () => {
    const inputs: DialogInput[] = [{ kind: "text", value: "x" }];
    actions.openFormDialog({
      message: "M",
      inputs,
      action: "Go",
      source: "src",
      onSubmit: () => {}
    });
    const shown = stores.dialog.value;
    expect(shown?.kind).toBe("form");
    if (shown?.kind !== "form") {
      return;
    }
    expect(shown.inputs).toEqual(inputs);
    expect(shown.inputs).not.toBe(inputs);
    expect(shown.destructive).toBe(false);
    expect(shown.source).toBe("src");
    expect(shown.action).toBe("Go");

    actions.openFormDialog({
      message: "M",
      inputs: [],
      action: "Go",
      source: null,
      destructive: true,
      onSubmit: () => {}
    });
    expect(stores.dialog.value).toMatchObject({ destructive: true, source: null });
  });

  it("hands the values over only while the same repository is selected", () => {
    const submitted = vi.fn();
    const openForm = () => {
      actions.openFormDialog({
        message: "M",
        inputs: [{ kind: "text", value: "" }],
        action: "Go",
        source: null,
        onSubmit: submitted
      });
      const shown = stores.dialog.value;
      if (shown?.kind !== "form") {
        throw new Error("no form opened");
      }
      return shown;
    };

    const values = ["typed"];
    const form = openForm();
    form.onSubmit(values);
    expect(submitted).toHaveBeenCalledWith(values);
    expect(submitted.mock.calls[0]?.[0]).toBe(values);
    expect(stores.dialog.value).toBe(form);

    submitted.mockClear();
    const moved = openForm();
    stores.selectedRepo.value = "/other";
    moved.onSubmit(["typed"]);
    expect(submitted).not.toHaveBeenCalled();
    expect(stores.dialog.value).toBeNull();

    stores.selectedRepo.value = undefined;
    const unbound = openForm();
    stores.selectedRepo.value = "/x";
    unbound.onSubmit([""]);
    expect(submitted).not.toHaveBeenCalled();
    expect(stores.dialog.value).toBeNull();

    stores.selectedRepo.value = "/a";
    const returning = openForm();
    stores.selectedRepo.value = "/b";
    stores.selectedRepo.value = "/a";
    returning.onSubmit(["kept"]);
    expect(submitted).toHaveBeenCalledWith(["kept"]);
  });

  it("gives focus back once the last dialog closes", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    actions.openErrorDialog("E");
    const inside = document.createElement("button");
    inside.setAttribute("role", "dialog");
    document.body.append(inside);
    inside.focus();
    actions.openErrorDialog("E2");
    actions.closeDialog();
    expect(document.activeElement).toBe(inside);
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
  });
});

describe("runAction", () => {
  it("sends each command with a fresh action id and the selected repository", () => {
    actions.runAction({ command: "deleteTag", tagName: "v1" });
    actions.runAction({ command: "pushTag", tagName: "v1", remote: "origin", requestId: "mine" });
    const [first, second] = posted();
    expect(first).toEqual({
      command: "deleteTag",
      tagName: "v1",
      requestId: expect.stringMatching(/^action-\d+$/),
      repo: "/repo"
    });
    expect(second).toMatchObject({ command: "pushTag", repo: "/repo" });
    const ids = [first, second].map((message) => (message as { requestId: string }).requestId);
    expect(ids[1]).toMatch(/^action-\d+$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(stores.dialog.value?.kind).toBe("running");
    expect(new Set(activity.value.map((entry) => entry.id))).toEqual(new Set(ids));
  });

  it("does nothing without a repository", () => {
    stores.selectedRepo.value = undefined;
    const before = activity.value;
    actions.runAction({ command: "deleteTag", tagName: "v1" });
    expect(posted()).toEqual([]);
    expect(stores.dialog.value).toBeNull();
    expect(activity.value).toBe(before);
  });
});
