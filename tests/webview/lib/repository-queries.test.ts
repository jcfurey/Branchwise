// @vitest-environment jsdom

import { batch, effect } from "@preact/signals";
import { Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BisectState,
  RepositoryAction,
  RepositoryQueryData,
  RepositoryState,
  StashDetails
} from "@/backend/types";
import { Dialog } from "@/webview/components/ui/Dialog";
import { closeDialog, openErrorDialog } from "@/webview/lib/actions";
import {
  confirmRepositoryAction,
  handleRepositoryQuery,
  openRepositoryManager,
  repositoryState,
  repositoryStateError,
  requestPanelQuery,
  requestRepositoryQuery,
  requestRepositoryState,
  resetRepositoryState,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

/** A message the page posted, loosely typed so each test reads only the fields it needs. */
type Posted = { command: string; repo?: string; requestId?: string; [field: string]: unknown };

const outbox = (): Array<Posted> => vscodeApi.postMessage.mock.calls.map(([sent]) => sent);
const newest = () => outbox().at(-1)!;
const cancels = () => outbox().filter(({ command }) => command === "cancelRepositoryQuery");

/** Play the extension's reply to `request`: data on success, or `null` and a reason. */
function reply(request: Posted, data: RepositoryQueryData | null, status: string | null = null) {
  act(() =>
    handleRepositoryQuery({ repo: request.repo!, requestId: request.requestId!, data, status })
  );
}

const loaded: RepositoryState = {
  head: "trunk",
  branches: [],
  remoteBranches: [],
  remotes: [{ name: "upstream", fetchUrls: ["/srv/upstream"], pushUrls: [] }],
  pushDefault: null,
  tags: [],
  worktrees: [],
  operation: null,
  conflicts: [],
  staged: 0
};
const stateOf = (state: RepositoryState): RepositoryQueryData => ({ kind: "state", state });
const noStashes: RepositoryQueryData = { kind: "stashes", stashes: [] };

let host: HTMLDivElement;

beforeAll(() => {
  setupWebviewTest();
});
beforeEach(() => {
  selectedRepo.value = "/work";
  // Settle whatever an earlier test left waiting before counting messages.
  dialog.value = null;
  resetRepositoryState();
  vscodeApi.postMessage.mockClear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe("the repository state", () => {
  it("shows a loaded state without an error", () => {
    requestRepositoryState();
    expect(newest()).toEqual({
      command: "repositoryQuery",
      repo: "/work",
      requestId: expect.stringMatching(/^repository-state-\d+$/),
      query: { kind: "state" }
    });
    reply(newest(), stateOf(loaded));
    expect(repositoryState.value).toBe(loaded);
    expect(repositoryStateError.value).toBeNull();
  });

  it("replaces a shown state with the failure", () => {
    repositoryState.value = loaded;
    requestRepositoryState();
    reply(newest(), null, "not a repository");
    expect(repositoryState.value).toBeNull();
    expect(repositoryStateError.value).toBe("not a repository");
  });

  it("keeps the shown state on screen until the reload answers", () => {
    repositoryState.value = loaded;
    requestRepositoryState();
    expect(repositoryState.value).toBe(loaded);
  });

  it("treats a successful answer of another kind as nothing loaded", () => {
    repositoryStateError.value = "earlier";
    requestRepositoryState();
    reply(newest(), noStashes);
    expect(repositoryState.value).toBeNull();
    expect(repositoryStateError.value).toBeNull();
  });

  it("cancels the read it supersedes before asking again", () => {
    requestRepositoryState();
    const first = newest();
    requestRepositoryState();
    const [cancel, read] = outbox().slice(-2);
    expect(cancel).toEqual({
      command: "cancelRepositoryQuery",
      repo: "/work",
      requestId: first.requestId
    });
    expect(read).toMatchObject({ command: "repositoryQuery", query: { kind: "state" } });
    expect(read!.requestId).not.toBe(first.requestId);
    reply(first, stateOf(loaded));
    expect(repositoryState.value).toBeNull();
  });

  it("does not cancel a read that has already been answered", () => {
    requestRepositoryState();
    reply(newest(), null, "failed once");
    requestRepositoryState();
    resetRepositoryState();
    requestRepositoryState();
    expect(cancels()).toHaveLength(1);
  });

  it("forgets the state, cancelling a pending read once", () => {
    requestRepositoryState();
    const pending = newest();
    repositoryState.value = loaded;
    repositoryStateError.value = "stale";
    resetRepositoryState();
    expect(cancels()).toEqual([
      { command: "cancelRepositoryQuery", repo: "/work", requestId: pending.requestId }
    ]);
    expect(repositoryState.value).toBeNull();
    expect(repositoryStateError.value).toBeNull();
    resetRepositoryState();
    expect(cancels()).toHaveLength(1);
  });

  it("ignores its arguments when used as a click handler", () => {
    const onClick: (event: MouseEvent) => void = requestRepositoryState;
    onClick(new MouseEvent("click"));
    expect(newest()).toMatchObject({ repo: "/work", query: { kind: "state" } });
  });

  it("ends the read on an answer for a repository no longer shown, without showing it", () => {
    requestRepositoryState();
    const pending = newest();
    selectedRepo.value = "/elsewhere";
    reply(pending, stateOf(loaded));
    expect(repositoryState.value).toBeNull();
    selectedRepo.value = "/work";
    vscodeApi.postMessage.mockClear();
    requestRepositoryState();
    resetRepositoryState();
    expect(outbox().map(({ command }) => command)).toEqual([
      "repositoryQuery",
      "cancelRepositoryQuery"
    ]);
  });

  it("updates the state and its error in one notification", () => {
    repositoryState.value = loaded;
    const seen: Array<[RepositoryState | null, string | null]> = [];
    const stop = effect(() => {
      seen.push([repositoryState.value, repositoryStateError.value]);
    });
    requestRepositoryState();
    reply(newest(), null, "gone");
    requestRepositoryState();
    reply(newest(), stateOf(loaded));
    stop();
    expect(seen).toEqual([
      [loaded, null],
      [null, "gone"],
      [loaded, null]
    ]);
  });
});

describe("reads behind a loading dialog", () => {
  it("shows the loading dialog and asks for the data", () => {
    const received = vi.fn();
    requestRepositoryQuery({ kind: "stashes" }, received);
    expect(dialog.value).toMatchObject({ kind: "running", message: "loadingRepository" });
    expect(dialog.value).not.toHaveProperty("onCancel");
    expect(newest()).toEqual({
      command: "repositoryQuery",
      repo: "/work",
      requestId: expect.stringMatching(/^repository-query-\d+$/),
      query: { kind: "stashes" }
    });
  });

  it("closes the loading dialog, then hands over the data", () => {
    let shownDuringCallback: unknown = "unset";
    requestRepositoryQuery({ kind: "stashes" }, (data) => {
      shownDuringCallback = dialog.value;
      expect(data).toEqual(noStashes);
    });
    reply(newest(), noStashes);
    expect(shownDuringCallback).toBeNull();
    expect(dialog.value).toBeNull();
  });

  it("cancels the read as soon as its dialog is closed", () => {
    const received = vi.fn();
    requestRepositoryQuery({ kind: "stashes" }, received);
    const read = newest();
    closeDialog();
    expect(newest()).toEqual({
      command: "cancelRepositoryQuery",
      repo: "/work",
      requestId: read.requestId
    });
    reply(read, noStashes);
    expect(received).not.toHaveBeenCalled();
    expect(dialog.value).toBeNull();
  });

  it("cancels the read when another repository is selected under the same dialog", () => {
    requestRepositoryQuery({ kind: "stashes" }, vi.fn());
    const read = newest();
    selectedRepo.value = "/other";
    expect(cancels()).toEqual([
      { command: "cancelRepositoryQuery", repo: "/work", requestId: read.requestId }
    ]);
  });

  it("cancels an earlier read before posting the next, even inside a batch", () => {
    const first = vi.fn();
    const second = vi.fn();
    requestRepositoryQuery({ kind: "stashes" }, first);
    const earlier = newest();
    batch(() => requestRepositoryQuery({ kind: "state" }, second));
    const [cancel, read] = outbox().slice(-2);
    expect(cancel).toEqual({
      command: "cancelRepositoryQuery",
      repo: "/work",
      requestId: earlier.requestId
    });
    expect(read).toMatchObject({ command: "repositoryQuery", query: { kind: "state" } });
    expect(cancels()).toHaveLength(1);
    reply(read!, stateOf(loaded));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(stateOf(loaded));
  });

  it("turns a failure into an error dialog, with or without a reason", () => {
    const received = vi.fn();
    requestRepositoryQuery({ kind: "stashes" }, received);
    reply(newest(), null, "boom");
    expect(dialog.value).toMatchObject({
      kind: "error",
      message: "unableToLoadRepository",
      reason: "boom"
    });
    requestRepositoryQuery({ kind: "stashes" }, received);
    reply(newest(), null, null);
    expect(dialog.value).toMatchObject({ kind: "error", reason: null });
    expect(received).not.toHaveBeenCalled();
  });

  it("reads only the selected repository", () => {
    requestRepositoryQuery({ kind: "stashes" }, vi.fn(), "/elsewhere");
    expect(outbox()).toEqual([]);
    expect(dialog.value).toBeNull();
  });

  it("leaves a dialog opened meanwhile in place when a late answer comes", () => {
    const received = vi.fn();
    requestRepositoryQuery({ kind: "stashes" }, received);
    const read = newest();
    openErrorDialog("something else");
    const newer = dialog.value;
    reply(read, noStashes);
    expect(dialog.value).toBe(newer);
    expect(received).not.toHaveBeenCalled();
  });
});

describe("panel reads", () => {
  it("delivers one answer and has nothing left to cancel afterwards", () => {
    const receive = vi.fn();
    const dispose = requestPanelQuery({ kind: "stashes" }, receive);
    const read = newest();
    expect(read.requestId).toMatch(/^repository-panel-\d+$/);
    reply(read, null, "err");
    reply(read, noStashes);
    dispose();
    dispose();
    expect(receive).toHaveBeenCalledOnce();
    expect(receive).toHaveBeenCalledWith(null, "err");
    expect(cancels()).toEqual([]);
  });

  it("cancels once when disposed while waiting, and drops the late answer", () => {
    const receive = vi.fn();
    const dispose = requestPanelQuery({ kind: "workingTree" }, receive);
    const read = newest();
    dispose();
    dispose();
    expect(cancels()).toEqual([
      { command: "cancelRepositoryQuery", repo: "/work", requestId: read.requestId }
    ]);
    reply(read, { kind: "workingTree", files: [] });
    expect(receive).not.toHaveBeenCalled();
  });

  it("is not affected by dialogs opening and closing", () => {
    const receive = vi.fn();
    requestPanelQuery({ kind: "stashes" }, receive);
    const read = newest();
    openErrorDialog("x");
    closeDialog();
    reply(read, noStashes);
    expect(cancels()).toEqual([]);
    expect(receive).toHaveBeenCalledOnce();
  });

  it("keeps waiting when an answer names another repository", () => {
    const receive = vi.fn();
    const dispose = requestPanelQuery({ kind: "stashes" }, receive);
    const read = newest();
    reply({ ...read, repo: "/impostor" }, noStashes);
    expect(receive).not.toHaveBeenCalled();
    dispose();
    expect(cancels()).toEqual([
      { command: "cancelRepositoryQuery", repo: "/work", requestId: read.requestId }
    ]);
    const again = requestPanelQuery({ kind: "stashes" }, receive);
    const second = newest();
    reply({ ...second, repo: "/impostor" }, noStashes);
    reply(second, noStashes);
    expect(receive).toHaveBeenCalledExactlyOnceWith(noStashes, null);
    again();
  });

  it("reads another repository for the one shown, until the view moves", () => {
    const receive = vi.fn();
    requestPanelQuery({ kind: "cleanupPlan" }, receive, "/parent");
    reply(newest(), noStashes);
    expect(receive).toHaveBeenCalledOnce();
    requestPanelQuery({ kind: "cleanupPlan" }, receive, "/parent");
    const read = newest();
    selectedRepo.value = "/elsewhere";
    reply(read, noStashes);
    expect(receive).toHaveBeenCalledOnce();
  });

  it("delivers a detached read whatever is shown by then", () => {
    const receive = vi.fn();
    requestPanelQuery({ kind: "cleanupPlan" }, receive, "/parent", true);
    const read = newest();
    selectedRepo.value = "/elsewhere";
    reply(read, noStashes);
    expect(receive).toHaveBeenCalledOnce();
  });

  it("with nothing shown, delivers only while nothing is still shown", () => {
    selectedRepo.value = undefined;
    const receive = vi.fn();
    requestPanelQuery({ kind: "stashes" }, receive, "/parent");
    reply(newest(), noStashes);
    expect(receive).toHaveBeenCalledOnce();
    requestPanelQuery({ kind: "stashes" }, receive, "/parent");
    const read = newest();
    selectedRepo.value = "/work";
    reply(read, noStashes);
    expect(receive).toHaveBeenCalledOnce();
  });
});

describe("without a selected repository", () => {
  it("posts nothing and opens nothing", () => {
    selectedRepo.value = undefined;
    const draw = vi.fn();
    requestRepositoryState();
    requestPanelQuery({ kind: "stashes" }, vi.fn())();
    sendRepositoryAction({ kind: "fetch", remote: null });
    openRepositoryManager("title", draw);
    requestRepositoryQuery({ kind: "stashes" }, vi.fn());
    expect(outbox()).toEqual([]);
    expect(dialog.value).toBeNull();
    expect(draw).not.toHaveBeenCalled();
  });
});

describe("request ids", () => {
  it("name their kind and are never reused", () => {
    requestPanelQuery({ kind: "stashes" }, vi.fn());
    requestRepositoryState();
    requestRepositoryQuery({ kind: "stashes" }, vi.fn());
    sendRepositoryAction({ kind: "viewWorkingTreeFile", path: "a.txt", group: "unstaged" });
    const ids = outbox()
      .filter(({ command }) => command !== "cancelRepositoryQuery")
      .map(({ requestId }) => requestId);
    expect(ids).toEqual([
      expect.stringMatching(/^repository-panel-\d+$/),
      expect.stringMatching(/^repository-state-\d+$/),
      expect.stringMatching(/^repository-query-\d+$/),
      expect.stringMatching(/^repository-action-\d+$/)
    ]);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("managers", () => {
  it("renders the loaded state for the repository it was opened in", () => {
    const draw = vi.fn((_state: RepositoryState, _repo: string) => "drawn");
    openRepositoryManager("Remotes", draw);
    reply(newest(), stateOf(loaded));
    expect(draw).toHaveBeenCalledWith(loaded, "/work");
    expect(dialog.value).toMatchObject({
      kind: "content",
      message: "Remotes",
      content: "drawn",
      wide: false
    });
    expect(repositoryState.value).toBeNull();
  });

  it("opens nothing for data of another kind", () => {
    const draw = vi.fn();
    openRepositoryManager("t", draw);
    reply(newest(), noStashes);
    expect(draw).not.toHaveBeenCalled();
    expect(dialog.value).toBeNull();
  });
});

describe("actions", () => {
  it("shows progress for a network action, with a way to stop it", () => {
    sendRepositoryAction({ kind: "fetch", remote: null });
    expect(newest()).toEqual({
      command: "repositoryAction",
      requestId: expect.stringMatching(/^repository-action-\d+$/),
      action: { kind: "fetch", remote: null },
      repo: "/work"
    });
    const shown = dialog.value;
    expect(shown).toMatchObject({ kind: "running", message: "fetch", detail: "/work" });
    expect(shown?.kind === "running" && typeof shown.onCancel).toBe("function");
  });

  it("runs a file view in another repository without touching the dialog", () => {
    sendRepositoryAction({ kind: "viewHistoricalFile", hash: "h", path: "p" }, "/other");
    expect(newest()).toMatchObject({
      command: "repositoryAction",
      action: { kind: "viewHistoricalFile", hash: "h", path: "p" },
      repo: "/other"
    });
    expect(dialog.value).toBeNull();
  });

  it("keeps the open dialog while a background action runs", () => {
    openErrorDialog("keep me");
    const open = dialog.value;
    sendRepositoryAction({ kind: "viewWorkingTreeFile", path: "a.txt", group: "staged" });
    expect(newest()).toMatchObject({ command: "repositoryAction", repo: "/work" });
    expect(dialog.value).toBe(open);
  });

  it("refuses an action meant for the shown repository when another is named", () => {
    openErrorDialog("for /work");
    sendRepositoryAction({ kind: "removeRemote", name: "x" }, "/other");
    expect(outbox()).toEqual([]);
    expect(dialog.value).toBeNull();
  });
});

describe("confirmations", () => {
  const stash = { ref: "stash@{0}", hash: "f".repeat(40), message: "wip" } as StashDetails;
  const bisect = {} as BisectState;

  it.each<[string, RepositoryAction, boolean]>([
    ["apply stash", { kind: "stash", operation: "apply", stash, reinstateIndex: true }, false],
    ["inspect stash", { kind: "stash", operation: "inspect", stash, reinstateIndex: false }, false],
    ["mark bad", { kind: "bisectMark", state: bisect, mark: "bad" }, false],
    ["mark skip", { kind: "bisectMark", state: bisect, mark: "skip" }, false],
    ["rebase", { kind: "rebase", branch: "b", onto: "refs/heads/o", expectedHead: "e" }, true],
    [
      "submodule",
      { kind: "submodule", operation: "update", path: "m", recorded: "r".repeat(40) },
      false
    ]
  ])("%s starts on Cancel: %s", (label, action, destructive) => {
    act(() => {
      render(h(Dialog, null), host);
      confirmRepositoryAction(label, label, action);
    });
    expect(dialog.value).toMatchObject({ kind: "form", inputs: [], source: null, destructive });
    const cancelButton = host.querySelector("[data-dialog-cancel]");
    expect(cancelButton !== null && document.activeElement === cancelButton).toBe(destructive);
  });

  it("asks with the given message and sends the action for the repository it was opened in", () => {
    const question = h(Fragment, null, "Remove ", h("b", null, "origin"), "?");
    confirmRepositoryAction(
      question,
      "Remove Remote",
      { kind: "removeRemote", name: "origin" },
      "/work"
    );
    const form = dialog.value;
    if (form?.kind !== "form") {
      throw new Error("no confirmation");
    }
    expect(form).toMatchObject({ message: question, action: "Remove Remote", destructive: true });
    form.onSubmit([]);
    expect(newest()).toMatchObject({
      command: "repositoryAction",
      action: { kind: "removeRemote", name: "origin" },
      repo: "/work"
    });
  });

  it("opens without a repository, and then sends nothing", () => {
    selectedRepo.value = undefined;
    confirmRepositoryAction("Sure?", "Yes", { kind: "fetch", remote: null });
    const form = dialog.value;
    expect(form?.kind).toBe("form");
    if (form?.kind === "form") {
      form.onSubmit([]);
    }
    expect(outbox()).toEqual([]);
  });
});
