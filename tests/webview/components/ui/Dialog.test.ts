// @vitest-environment jsdom

import { Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BisectState,
  CleanupPlan,
  GitCommitNode,
  GitRef,
  OperationState,
  RemoteDetails,
  RepositoryAction,
  StashDetails
} from "@/backend/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

const mocks = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: mocks.postMessage, getState: vi.fn(), setState: vi.fn() }
}));

let Dialog: typeof import("@/webview/components/ui/Dialog").Dialog;
let ContextMenu: typeof import("@/webview/components/ui/ContextMenu").ContextMenu;
let menus: typeof import("@/webview/lib/menus");
let actions: typeof import("@/webview/lib/actions");
let repositoryActions: typeof import("@/webview/lib/repository-actions");
let stores: typeof import("@/webview/lib/stores");
let container: HTMLDivElement;

const commit: GitCommitNode = {
  hash: "c".repeat(40),
  parentHashes: ["p".repeat(40)],
  author: "Author",
  email: "author@example.com",
  date: 0,
  message: "Message",
  refs: []
};
const tag: GitRef = { type: "tag", name: "v1", hash: commit.hash };
const branch: GitRef = { type: "head", name: "topic", hash: commit.hash };

beforeAll(async () => {
  setupWebviewTest();
  Element.prototype.scrollIntoView = () => {};
  Dialog = (await import("@/webview/components/ui/Dialog")).Dialog;
  ContextMenu = (await import("@/webview/components/ui/ContextMenu")).ContextMenu;
  menus = await import("@/webview/lib/menus");
  actions = await import("@/webview/lib/actions");
  repositoryActions = await import("@/webview/lib/repository-actions");
  stores = await import("@/webview/lib/stores");
});

beforeEach(() => {
  mocks.postMessage.mockClear();
  stores.selectedRepo.value = "/repo";
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(Fragment, null, h(ContextMenu, null), h(Dialog, null)), container));
});

afterEach(() => {
  act(() => {
    stores.dialog.value = null;
    stores.contextMenu.value = null;
  });
  render(null, container);
  container.remove();
});

function key(target: Element, repeat: boolean) {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    repeat,
    bubbles: true,
    cancelable: true
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Choose a menu entry with the keyboard, as a user holding Enter on it would. */
function holdEnterOn(entries: ReturnType<typeof menus.commitMenu>, title: string) {
  act(() => {
    stores.contextMenu.value = { x: 0, y: 0, entries, source: "source" };
  });
  const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
  const index = entries
    .filter((entry) => entry !== null)
    .findIndex((entry) => entry.title === title);
  expect(index).toBeGreaterThanOrEqual(0);
  for (let step = 0; step <= index; step++) {
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
  }
  // The first keydown activates the item. Holding the key repeats it on whatever has focus.
  key(menu, true);
  expect(stores.dialog.value).toBeNull();
  key(menu, false);
  const repeats = [1, 2, 3].map(() => key(document.activeElement!, true));
  return repeats;
}

describe("accessible names", () => {
  const mergeCommit: GitCommitNode = { ...commit, parentHashes: ["a".repeat(40), "b".repeat(40)] };

  it.each([
    ["reset…", () => menus.commitMenu(commit, new Map())],
    ["cherryPick…", () => menus.commitMenu(mergeCommit, new Map())],
    ["revert…", () => menus.commitMenu(mergeCommit, new Map())]
  ])("names the unlabelled choice of %s by the dialog's question", (title, entries) => {
    act(() =>
      entries()
        .find((entry) => entry?.title === title)!
        .onClick()
    );
    const select = container.querySelector("select")!;
    const name = document.getElementById(select.getAttribute("aria-labelledby") ?? "");
    expect(name?.textContent?.trim()).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(name!.textContent);
  });
});

describe("held Enter", () => {
  it.each([
    ["deleteTag…", () => menus.refMenu(tag, false)],
    ["deleteBranch…", () => menus.refMenu(branch, false)],
    ["reset…", () => menus.commitMenu(commit, new Map())]
  ])("does not confirm %s", (title, entries) => {
    const repeats = holdEnterOn(entries(), title);

    expect(stores.dialog.value).toMatchObject({ kind: "form", destructive: true });
    expect(document.activeElement?.hasAttribute("data-dialog-cancel")).toBe(true);
    expect(repeats.every((event) => event.defaultPrevented)).toBe(true);
    expect(mocks.postMessage).not.toHaveBeenCalled();

    // A fresh press still reaches the dialog's controls.
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submit.focus();
    expect(key(submit, false).defaultPrevented).toBe(false);
    act(() => submit.click());
    expect(mocks.postMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps a repeated Enter from running a menu item", () => {
    const onClick = vi.fn();
    act(() => {
      stores.contextMenu.value = {
        x: 0,
        y: 0,
        entries: [{ title: "Run", onClick }],
        source: "source"
      };
    });
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(key(menu, true).defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    key(menu, false);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets a held Enter add lines in a text area", () => {
    act(() =>
      actions.openFormDialog({
        message: "Message",
        inputs: [{ kind: "textarea", value: "" }],
        action: "Save",
        source: null,
        onSubmit: () => {}
      })
    );
    expect(key(container.querySelector("textarea")!, true).defaultPrevented).toBe(false);
  });

  it("focuses the first field or button of other dialogs", () => {
    act(() =>
      actions.openFormDialog({
        message: "Merge",
        inputs: [{ kind: "checkbox", label: "No fast-forward", value: true }],
        action: "Merge",
        source: null,
        onSubmit: () => {}
      })
    );
    expect(document.activeElement?.textContent).toBe("Merge");
    act(() =>
      actions.openFormDialog({
        message: "Name",
        inputs: [{ kind: "ref", value: "" }],
        action: "Create",
        source: null,
        onSubmit: () => {}
      })
    );
    expect(document.activeElement?.tagName).toBe("INPUT");
  });
});

describe("destructive repository confirmations", () => {
  const stash = { index: 0, hash: "s".repeat(40), message: "WIP" } as unknown as StashDetails;
  const operation = { kind: "rebase" } as unknown as OperationState;
  const bisect = {} as BisectState;
  const plan = { branches: [] } as unknown as CleanupPlan;
  const remote: RemoteDetails = { name: "origin", fetchUrls: [], pushUrls: [] };

  it.each<{ label: string; action: RepositoryAction; destructive: boolean }>([
    {
      label: "drop stash",
      action: { kind: "stash", operation: "drop", stash, reinstateIndex: false },
      destructive: true
    },
    {
      label: "pop stash",
      action: { kind: "stash", operation: "pop", stash, reinstateIndex: false },
      destructive: false
    },
    {
      label: "remove remote",
      action: { kind: "removeRemote", name: remote.name },
      destructive: true
    },
    {
      label: "remove worktree",
      action: { kind: "removeWorktree", path: "/w", expectedHead: commit.hash },
      destructive: true
    },
    {
      label: "delete a remote branch",
      action: { kind: "deleteRemoteRef", remote: "origin", name: "topic", refType: "branch" },
      destructive: true
    },
    {
      label: "abort",
      action: { kind: "recover", operation, resolution: "abort" },
      destructive: true
    },
    {
      label: "skip",
      action: { kind: "recover", operation, resolution: "skip" },
      destructive: true
    },
    {
      label: "continue",
      action: { kind: "recover", operation, resolution: "continue" },
      destructive: false
    },
    {
      label: "reset bisect",
      action: { kind: "bisectMark", state: bisect, mark: "reset" },
      destructive: true
    },
    {
      label: "mark bisect good",
      action: { kind: "bisectMark", state: bisect, mark: "good" },
      destructive: false
    },
    { label: "clean up branches", action: { kind: "cleanup", plan }, destructive: true }
  ])("focuses Cancel to $label: $destructive", ({ label, action, destructive }) => {
    act(() => repositoryActions.confirmRepositoryAction(label, label, action));
    expect(stores.dialog.value).toMatchObject({ kind: "form", destructive });
    expect(document.activeElement?.hasAttribute("data-dialog-cancel")).toBe(destructive);
  });
});
