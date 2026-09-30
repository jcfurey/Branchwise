// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { RequestMessage } from "@/types";
import { openErrorDialog, selectRepo } from "@/webview/lib/actions";
import { initDispatcher } from "@/webview/lib/dispatcher";
import { historyFilter } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => {
  setupWebviewTest();
  initDispatcher();
});

beforeEach(() => {
  stores.dialog.value = null;
  stores.contextMenu.value = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deliver(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

const sent = () => vscodeApi.postMessage.mock.calls.map(([message]) => message as RequestMessage);

it("switches repositories before following a file's history", () => {
  selectRepo("/first");
  openErrorDialog("left open");

  deliver({ command: "fileHistory", repo: "/second", path: "dir/a.txt" });

  expect(stores.selectedRepo.value).toBe("/second");
  expect(stores.dialog.value).toBeNull();
  expect(historyFilter.value).toMatchObject({ path: "dir/a.txt", revision: "", follow: true });

  vscodeApi.postMessage.mockClear();
  deliver({ command: "fileHistory", repo: "/second", path: "b.txt" });
  expect(historyFilter.value).toMatchObject({ path: "b.txt", follow: true });
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
});

it("changes nothing for data that is not a command", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const escaped: Array<unknown> = [];
  const onError = (event: ErrorEvent) => {
    escaped.push(event.error);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  selectRepo("/quiet");
  const before = {
    repo: stores.selectedRepo.value,
    branches: stores.branchList.value,
    rows: stores.commitList.value,
    dialog: stores.dialog.value,
    states: stores.repoStates.value
  };
  vscodeApi.postMessage.mockClear();

  for (const data of [null, undefined, "refresh", 3, [], { command: 5 }]) {
    deliver(data);
  }
  deliver({ kind: "rpc.response", id: "x", success: true, result: 1 });
  window.removeEventListener("error", onError);

  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(escaped).toEqual([]);
  expect({
    repo: stores.selectedRepo.value,
    branches: stores.branchList.value,
    rows: stores.commitList.value,
    dialog: stores.dialog.value,
    states: stores.repoStates.value
  }).toEqual(before);
});

it("only warns about an unknown command", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vscodeApi.postMessage.mockClear();
  deliver({ command: "bogus" });
  expect(warn).toHaveBeenCalledWith("no handler for", "bogus");
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
});

it("shows a failed diff before dispatchEvent returns", () => {
  deliver({ command: "viewDiff", success: false });
  expect(stores.dialog.value).toMatchObject({
    kind: "error",
    message: "unableToViewDiff",
    reason: null
  });
});

it("reloads the selected repository when the extension asks", () => {
  selectRepo("/reload");
  stores.selectedBranch.value = "main";
  vscodeApi.postMessage.mockClear();

  deliver({ command: "refresh" });

  const commands = sent().map((message) => message.command);
  expect(commands.filter((command) => command !== "cancelRepositoryQuery")).toEqual([
    "loadBranches",
    "repositoryQuery",
    "loadCommits"
  ]);
  expect(sent().find((message) => message.command === "loadCommits")).toMatchObject({
    repo: "/reload",
    branchName: "main"
  });
});
