// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, beforeEach, expect, it } from "vitest";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let remote: typeof import("@/webview/lib/remote-actions");
let stores: typeof import("@/webview/lib/stores");
let Dialog: typeof import("@/webview/components/ui/Dialog").Dialog;

beforeAll(async () => {
  setupWebviewTest();
  remote = await import("@/webview/lib/remote-actions");
  stores = await import("@/webview/lib/stores");
  Dialog = (await import("@/webview/components/ui/Dialog")).Dialog;
});

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  stores.dialog.value = null;
  stores.selectedRepo.value = "/repo";
});

function running() {
  const state = stores.dialog.value;
  if (state?.kind !== "running") {
    throw new Error("no running dialog");
  }
  return state;
}

it.each([
  {
    command: "pushBranch",
    branchName: "main",
    remote: "origin",
    remoteBranch: "main",
    setUpstream: false
  },
  { command: "fetchRemote", remote: null, prune: false },
  {
    command: "repositoryAction",
    action: { kind: "deleteRemoteRef", remote: "origin", name: "x", refType: "branch" }
  }
] as const)("offers to stop the network action $command", (command) => {
  remote.sendRemoteAction({ ...command, requestId: "network" } as never, "/repo", "Running");
  running().onCancel!();
  expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({
    command: "cancelAction",
    repo: "/repo",
    requestId: "network"
  });
});

it("does not offer to stop a local action", () => {
  remote.sendRemoteAction(
    { command: "resetToCommit", commitHash: "c".repeat(40), resetMode: "hard", requestId: "local" },
    "/repo",
    "Running"
  );
  expect(running().onCancel).toBeUndefined();
});

it("shows Stop Git beside Hide only while a network action runs", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const buttons = () =>
    [...container.querySelectorAll("button")].map((button) => button.textContent);
  remote.sendRemoteAction(
    { command: "fetchRemote", remote: "origin", prune: false, requestId: "fetch" },
    "/repo",
    "Running"
  );
  act(() => render(h(Dialog, null), container));
  expect(buttons()).toEqual(["cancelOperation", "hideOperation"]);
  act(() => {
    remote.sendRemoteAction(
      { command: "deleteTag", tagName: "v1", requestId: "tag" },
      "/repo",
      "Running"
    );
  });
  expect(buttons()).toEqual(["hideOperation"]);
  act(() => render(null, container));
  container.remove();
});

it.each([
  ["viewWorkingTreeFile", "openFileChanges"],
  ["viewRangeFile", "compareRevisions"],
  ["viewHistoricalFile", "openHistoricalFile"],
  ["previewFileRestore", "restorePreview"]
])("logs %s under its own activity title", async (kind, title) => {
  const { activity } = await import("@/webview/lib/activity");
  remote.sendRemoteAction(
    { command: "repositoryAction", requestId: kind, action: { kind } } as never,
    "/repo",
    "Running",
    { background: true }
  );
  expect(activity.value[0]).toMatchObject({ id: kind, title });
});
