// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryQueryData, RepositoryState } from "@/backend/types";
import { RebaseEditor } from "@/webview/components/repository/RebaseEditor";
import { openRemotes, openTracking } from "@/webview/components/repository/RemoteManager";
import { RepositoryStatus } from "@/webview/components/repository/RepositoryStatus";
import { openStashes } from "@/webview/components/repository/StashManager";
import { Dialog } from "@/webview/components/ui/Dialog";
import { openErrorDialog } from "@/webview/lib/actions";
import { handleLoadRemotes, openRemoteAction } from "@/webview/lib/remote-actions";
import {
  handleRepositoryQuery,
  repositoryRevision,
  repositoryState,
  requestRepositoryState,
  resetRepositoryState
} from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

const mocks = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: mocks.postMessage, getState: vi.fn(), setState: vi.fn() }
}));

let container: HTMLDivElement;
const state: RepositoryState = {
  remotes: [],
  pushDefault: null,
  branches: [
    {
      name: "main",
      hash: "a".repeat(40),
      upstream: "",
      ahead: 0,
      behind: 0,
      gone: false,
      date: 0,
      merged: false
    }
  ],
  remoteBranches: [],
  tags: [],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};
function lastRequest() {
  return mocks.postMessage.mock.lastCall![0];
}
function respond(data: RepositoryQueryData, request = lastRequest()) {
  act(() =>
    handleRepositoryQuery({ repo: request.repo, requestId: request.requestId, data, status: null })
  );
}
function form() {
  const current = dialog.value;
  if (current?.kind !== "form") {
    throw new Error("Expected form");
  }
  return current;
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label
  );
  if (!button) {
    throw new Error(`Missing button ${label}`);
  }
  act(() => button.click());
}

// Running dialogs format their elapsed time in the configured locale.
beforeAll(() => setupWebviewTest());
beforeEach(() => {
  mocks.postMessage.mockClear();
  selectedRepo.value = "/repo";
  dialog.value = null;
  resetRepositoryState();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("repository dialogs", () => {
  it("allows adding the first remote from the empty remote manager", () => {
    openRemotes();
    respond({ kind: "state", state });
    act(() => render(h(Dialog, {}), container));
    click("addRemote");
    form().onSubmit(["upstream", "https://example.com/project.git", false]);
    expect(lastRequest()).toMatchObject({
      command: "repositoryAction",
      repo: "/repo",
      action: {
        kind: "addRemote",
        name: "upstream",
        url: "https://example.com/project.git",
        fetch: false
      }
    });
  });

  it("offers tracking refs even if remote branches are hidden in the graph", () => {
    openTracking("main");
    respond({
      kind: "state",
      state: { ...state, remoteBranches: [{ name: "team/origin/release", hash: "b".repeat(40) }] }
    });
    expect(form().inputs[0]).toMatchObject({
      options: [
        { label: "none", value: "" },
        { label: "team/origin/release", value: "refs/remotes/team/origin/release" }
      ]
    });
    form().onSubmit(["refs/remotes/team/origin/release"]);
    expect(lastRequest().action).toEqual({
      kind: "setTracking",
      branch: "main",
      upstream: "refs/remotes/team/origin/release"
    });
  });

  it("pushes a tag to a chosen remote when origin does not exist", () => {
    openRemoteAction("tagPush", "v2");
    const request = lastRequest();
    handleLoadRemotes({
      ...request,
      remotes: ["backup", "upstream"],
      upstream: null,
      pushRemote: "upstream",
      status: null
    });
    expect(form().inputs[0]?.value).toBe("upstream");
    form().onSubmit(["backup"]);
    expect(lastRequest()).toMatchObject({
      command: "pushTag",
      repo: "/repo",
      remote: "backup",
      tagName: "v2"
    });
    // The push is titled by its own label; no separate running text is passed for it.
    expect(dialog.value).toMatchObject({ kind: "running", message: "pushTag" });
  });

  it("requires confirmation after resolving a remote branch with a slash-containing remote name", () => {
    openRemoteAction("branchDelete", "", "team/origin/feature/nav");
    const request = lastRequest();
    handleLoadRemotes({
      ...request,
      remotes: ["team", "team/origin"],
      upstream: null,
      pushRemote: null,
      status: null
    });
    form().onSubmit(["team/origin"]);
    expect(lastRequest().command).toBe("loadRemotes");
    form().onSubmit([]);
    expect(lastRequest().action).toEqual({
      kind: "deleteRemoteRef",
      remote: "team/origin",
      name: "feature/nav",
      refType: "branch"
    });
  });

  it("reviews a lease and sends only the accepted history-rewrite plan", () => {
    openRemoteAction("push", "feature");
    handleLoadRemotes({
      ...lastRequest(),
      remotes: ["backup"],
      upstream: null,
      pushRemote: null,
      status: null
    });
    act(() => {
      form().onSubmit(["backup", "review", false, true]);
      render(h(Dialog, {}), container);
    });
    expect(lastRequest().query).toEqual({
      kind: "syncPlan",
      branch: "feature",
      remote: "backup",
      remoteBranch: "review"
    });
    const plan = {
      branch: "feature",
      remote: "backup",
      remoteBranch: "review",
      local: "b".repeat(40),
      remoteHead: "a".repeat(40),
      incoming: { entries: [], more: false },
      outgoing: { entries: [], more: false },
      ahead: 1,
      behind: 1,
      canFastForward: false
    };
    respond({ kind: "syncPlan", plan });
    expect(lastRequest().command).toBe("repositoryQuery");
    click("pushBranch");
    expect(lastRequest()).toMatchObject({
      command: "repositoryAction",
      repo: "/repo",
      action: { kind: "sync", operation: "push", force: true, setUpstream: false, plan }
    });
  });

  it("keeps the sync review and its focus through background refreshes", () => {
    openRemoteAction("push", "feature");
    handleLoadRemotes({
      ...lastRequest(),
      remotes: ["origin"],
      upstream: null,
      pushRemote: null,
      status: null
    });
    act(() => {
      form().onSubmit(["origin", "feature", false, false]);
      render(h(Dialog, {}), container);
    });
    const planRequest = () =>
      mocks.postMessage.mock.calls
        .map(([message]) => message)
        .findLast((message) => message.query?.kind === "syncPlan");
    const plan = {
      branch: "feature",
      remote: "origin",
      remoteBranch: "feature",
      local: "b".repeat(40),
      remoteHead: "a".repeat(40),
      incoming: { entries: [], more: false },
      outgoing: { entries: [], more: false },
      ahead: 1,
      behind: 0,
      canFastForward: true
    };
    respond({ kind: "syncPlan", plan }, planRequest());
    const push = () =>
      [...container.querySelectorAll("button")].find(
        (element) => element.textContent === "pushBranch"
      )!;
    const first = push();
    act(() => first.focus());

    // The watcher refreshes the repository while the review is open.
    const before = planRequest();
    act(() => {
      repositoryRevision.value++;
    });
    expect(planRequest()).not.toBe(before);
    expect(push()).toBe(first);
    expect(first.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(first);
    respond({ kind: "syncPlan", plan }, planRequest());
    expect(push()).toBe(first);
    expect(document.activeElement).toBe(first);

    // A new commit is a new plan to review; focus moves into it instead of to the page.
    act(() => {
      repositoryRevision.value++;
    });
    respond(
      { kind: "syncPlan", plan: { ...plan, local: "c".repeat(40), ahead: 2 } },
      planRequest()
    );
    expect(push()).not.toBe(first);
    expect(document.activeElement).not.toBe(document.body);
    expect(push().closest("[aria-busy]")?.contains(document.activeElement)).toBe(true);
  });

  it("keeps a newer dialog when a repository query completes late", () => {
    openRemotes();
    const request = lastRequest();
    openErrorDialog("newer dialog");
    const current = dialog.value;
    respond({ kind: "state", state }, request);
    expect(dialog.value).toBe(current);
  });

  it("ignores status responses for a previous selection and superseded refreshes", () => {
    requestRepositoryState();
    const first = lastRequest();
    requestRepositoryState();
    respond({ kind: "state", state }, first);
    expect(repositoryState.value).toBeNull();
    selectedRepo.value = "/other";
    respond({ kind: "state", state });
    expect(repositoryState.value).toBeNull();
  });

  it("keeps stash identity through the drop confirmation", () => {
    const stash = { ref: "stash@{2}", hash: "a".repeat(40), message: "saved work" };
    openStashes();
    respond({ kind: "stashes", stashes: [stash] });
    act(() => render(h(Dialog, {}), container));
    click("dropStash");
    expect(lastRequest().command).toBe("repositoryQuery");
    form().onSubmit([]);
    expect(lastRequest().action).toEqual({
      kind: "stash",
      operation: "drop",
      stash,
      reinstateIndex: false
    });
  });

  it("does not submit a manager form after switching repositories", () => {
    openRemotes();
    respond({ kind: "state", state });
    act(() => render(h(Dialog, {}), container));
    click("addRemote");
    const pending = form();
    selectedRepo.value = "/other";
    mocks.postMessage.mockClear();
    pending.onSubmit(["backup", "/bare", true]);
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });
});

describe("operation and rebase UI", () => {
  it("disables continue while conflicts remain and binds abort to the displayed operation", () => {
    repositoryState.value = {
      ...state,
      operation: { kind: "merge", id: "operation-1" },
      conflicts: ["f"]
    };
    act(() => render(h(RepositoryStatus, {}), container));
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "continueOperation"
      )?.disabled
    ).toBe(true);
    click("abortOperation");
    form().onSubmit([]);
    expect(lastRequest().action).toEqual({
      kind: "recover",
      operation: { kind: "merge", id: "operation-1" },
      resolution: "abort"
    });
  });

  it("edits and reorders an interactive plan while preserving its original branch and revision", () => {
    const plan = {
      base: "base",
      head: "original",
      branch: "main",
      entries: [
        { hash: "a", message: "first", action: "pick" as const },
        { hash: "b", message: "second", action: "pick" as const }
      ]
    };
    act(() => render(h(RebaseEditor, { plan, repo: "/repo" }), container));
    click("moveLater");
    const select = container.querySelector("select")!;
    act(() => {
      select.value = "reword";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const textarea = container.querySelector("textarea")!;
    act(() => {
      textarea.value = "new message";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(lastRequest().action).toEqual({
      kind: "interactiveRebase",
      plan: {
        ...plan,
        entries: [{ hash: "b", message: "new message", action: "reword" }, plan.entries[0]]
      }
    });
  });

  it("prevents squashing the first retained commit", () => {
    const plan = {
      base: "base",
      head: "head",
      branch: "main",
      entries: [{ hash: "a", message: "first", action: "squash" as const }]
    };
    act(() => render(h(RebaseEditor, { plan, repo: "/repo" }), container));
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
      true
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("firstCannotCombine");
  });
});
