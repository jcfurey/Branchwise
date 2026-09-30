// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ActionResponse } from "@/backend/types";
import type { RequestMessage } from "@/types";
import { openRunningDialog, runAction, selectRepo } from "@/webview/lib/actions";
import { activity } from "@/webview/lib/activity";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleActionResult } from "@/webview/lib/handler/action-result";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";
import { backgroundAction } from "@/webview/lib/workspace-actions";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/r";
  stores.selectedBranch.value = "main";
  stores.branchDisplay.value = "filter";
  stores.repoStates.value = {};
  stores.dialog.value = null;
  stores.contextMenu.value = null;
  activity.value = [];
  vscodeApi.postMessage.mockClear();
});

type Reload = Extract<
  RequestMessage,
  { command: "loadBranches" | "repositoryQuery" | "loadCommits" }
>;

/** The graph reads posted since the test started: a reload asks for all three. */
const reloads = () =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as RequestMessage)
    .filter((message): message is Reload =>
      ["loadBranches", "repositoryQuery", "loadCommits"].includes(message.command)
    );

/** The request that the last action posted, which its answer echoes. */
function lastAction() {
  const request = vscodeApi.postMessage.mock.lastCall![0] as { repo: string; requestId: string };
  return { repo: request.repo, requestId: request.requestId };
}

/** Which repository each graph read since the test started was for. */
const reloadedRepos = () => reloads().map((message) => message.repo);

/** An action sent to a parent repository that changes the submodule shown, `/r`. */
function submoduleUpdate() {
  sendRepositoryAction(
    { kind: "submodule", operation: "update", path: "child", recorded: "a".repeat(40) },
    "/parent"
  );
}

describe("the failure title", () => {
  it.each<[ActionResponse["command"], string]>([
    ["repositoryAction", "unableToRunGitAction"],
    ["addTag", "unableToAddTag"],
    ["checkoutBranch", "unableToCheckoutBranch"],
    ["checkoutCommit", "unableToCheckoutCommit"],
    ["cherrypickCommit", "unableToCherryPick"],
    ["createBranch", "unableToCreateBranch"],
    ["deleteBranch", "unableToDeleteBranch"],
    ["deleteTag", "unableToDeleteTag"],
    ["mergeBranch", "unableToMergeBranch"],
    ["mergeCommit", "unableToMergeCommit"],
    ["pushTag", "unableToPushTag"],
    ["pushBranch", "unableToPushBranch"],
    ["pullBranch", "unableToPullBranch"],
    ["fetchRemote", "unableToFetch"],
    ["renameBranch", "unableToRenameBranch"],
    ["resetToCommit", "unableToReset"],
    ["revertCommit", "unableToRevert"]
  ])("of %s is %s", (command, title) => {
    openRunningDialog("working");
    handleActionResult({ command, status: "why" });
    expect(stores.dialog.value).toMatchObject({ kind: "error", message: title, reason: "why" });
  });
});

describe("a tracked action", () => {
  it("reloads while its running dialog is still shown, then reports the failure", () => {
    runAction({ command: "deleteTag", tagName: "v1" });
    const request = lastAction();
    const running = stores.dialog.value;
    expect(running?.kind).toBe("running");
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "deleteTag", status: "failed!", ...request });

    expect(reloads().map((message) => message.command)).toEqual([
      "loadBranches",
      "repositoryQuery",
      "loadCommits"
    ]);
    expect(stores.dialog.value).toMatchObject({
      kind: "error",
      message: "unableToDeleteTag",
      reason: "failed!"
    });
  });

  it("closes its running dialog when it succeeds", () => {
    runAction({ command: "createBranch", commitHash: "abc", branchName: "topic" });
    handleActionResult({ command: "createBranch", status: null, ...lastAction() });
    expect(stores.dialog.value).toBeNull();
    expect(reloads()).not.toEqual([]);
  });

  it("leaves everything alone for an id that was never sent", () => {
    openRunningDialog("working");
    const running = stores.dialog.value;
    vscodeApi.postMessage.mockClear();

    handleActionResult({
      command: "deleteTag",
      status: null,
      repo: "/r",
      requestId: "action-999"
    });

    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(stores.dialog.value).toBe(running);
  });
});

describe("a view that changes nothing", () => {
  it("does not reload the graph, and keeps the dialog", () => {
    openRunningDialog("comparing");
    const shown = stores.dialog.value;
    sendRepositoryAction({ kind: "viewRangeFile", left: "a", right: "b", before: "f", after: "f" });
    const request = lastAction();
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "repositoryAction", status: null, ...request });

    expect(reloads()).toEqual([]);
    expect(stores.dialog.value).toBe(shown);
  });
});

describe("the reload after a mutating action", () => {
  it("happens for an action sent to another repository while this one is shown", () => {
    submoduleUpdate();
    const request = lastAction();
    expect(request.repo).toBe("/parent");
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "repositoryAction", status: null, ...request });

    expect(reloadedRepos()).toEqual(["/r", "/r", "/r"]);
    expect(stores.dialog.value).toBeNull();
  });

  it("is skipped for that action once another repository is shown", () => {
    submoduleUpdate();
    const request = lastAction();
    selectRepo("/other");
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "repositoryAction", status: null, ...request });

    expect(reloads()).toEqual([]);
  });

  it("is skipped for an action in this repository once another is shown", () => {
    runAction({ command: "deleteTag", tagName: "v1" });
    const request = lastAction();
    selectRepo("/other");
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "deleteTag", status: "failed!", ...request });

    expect(reloads()).toEqual([]);
    // The rest is settled as before: the activity entry finishes, marked as not seen.
    expect(activity.value[0]).toMatchObject({ error: "failed!", unseen: true });
    expect(stores.dialog.value).toBeNull();
  });

  it("happens when that repository is shown again by the time the answer comes", () => {
    runAction({ command: "deleteTag", tagName: "v1" });
    const request = lastAction();
    selectRepo("/other");
    selectRepo("/r");
    stores.selectedBranch.value = "main";
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "deleteTag", status: null, ...request });

    expect(reloadedRepos()).toEqual(["/r", "/r", "/r"]);
  });

  it("happens for an answer without a request id", () => {
    handleActionResult({ command: "fetchRemote", status: null });
    expect(reloadedRepos()).toEqual(["/r", "/r", "/r"]);
  });

  it("happens for a background action in another repository while this one is shown", async () => {
    const done = backgroundAction("/elsewhere", { kind: "fetch", remote: null });
    const request = lastAction();
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "repositoryAction", status: "offline", ...request });

    await expect(done).resolves.toBe("offline");
    expect(reloadedRepos()).toEqual(["/r", "/r", "/r"]);
    expect(stores.dialog.value).toBeNull();
  });

  it("is skipped for a background action once another repository is shown", async () => {
    const done = backgroundAction("/elsewhere", { kind: "fetch", remote: null });
    const request = lastAction();
    selectRepo("/other");
    vscodeApi.postMessage.mockClear();

    handleActionResult({ command: "repositoryAction", status: null, ...request });

    await expect(done).resolves.toBeNull();
    expect(reloads()).toEqual([]);
  });
});

it("reads the title from the strings in place when the failure is shown", () => {
  const standard = window.l10n;
  const strings = new Proxy({} as typeof window.l10n, {
    get: (_target, key) => (key === "unableToFetch" ? "Fetch failed" : String(key))
  });
  Object.defineProperty(window, "l10n", { value: strings, configurable: true });
  try {
    openRunningDialog("working");
    handleActionResult({ command: "fetchRemote", status: "offline" });
    expect(stores.dialog.value).toMatchObject({ message: "Fetch failed", reason: "offline" });
  } finally {
    Object.defineProperty(window, "l10n", { value: standard, configurable: true });
  }
});
