// @vitest-environment jsdom
import { Fragment, h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SafetyUndo } from "@/backend/types";
import { Dialog } from "@/webview/components/ui/Dialog";
import { MainHeader } from "@/webview/layout/MainHeader";
import { closeContextMenu } from "@/webview/lib/actions";
import { emptyFilter, historyFilter } from "@/webview/lib/navigation";
import { repositoryState, resetRepositoryState } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

import { REPOS, headerButton, mount, resetHeader, unmount } from "./header-harness";

const openers = vi.hoisted(() => ({
  openRemotes: vi.fn(),
  openStashes: vi.fn(),
  openWorktrees: vi.fn(),
  openWorkspaceSync: vi.fn(),
  openFastForward: vi.fn(),
  openCleanup: vi.fn(),
  openBisect: vi.fn(),
  openReflog: vi.fn(),
  openSafetyNet: vi.fn(),
  openActivity: vi.fn()
}));

/** Replace one opener of a module and keep the rest of it. */
function withOpeners<T extends object>(module: T, names: Array<keyof typeof openers>): T {
  return { ...module, ...Object.fromEntries(names.map((name) => [name, openers[name]])) };
}

vi.mock("@/webview/components/repository/RemoteManager", async (original) =>
  withOpeners(await original(), ["openRemotes"])
);
vi.mock("@/webview/components/repository/StashManager", async (original) =>
  withOpeners(await original(), ["openStashes"])
);
vi.mock("@/webview/components/repository/WorktreeManager", async (original) =>
  withOpeners(await original(), ["openWorktrees"])
);
vi.mock("@/webview/components/history/WorkflowTools", async (original) =>
  withOpeners(await original(), ["openWorkspaceSync", "openFastForward", "openCleanup"])
);
vi.mock("@/webview/components/repository/BisectView", async (original) =>
  withOpeners(await original(), ["openBisect"])
);
vi.mock("@/webview/components/history/HistoryTools", async (original) =>
  withOpeners(await original(), ["openReflog"])
);
vi.mock("@/webview/components/history/SafetyNetView", async (original) =>
  withOpeners(await original(), ["openSafetyNet"])
);
vi.mock("@/webview/components/history/ActivityView", async (original) =>
  withOpeners(await original(), ["openActivity"])
);

beforeAll(() => setupWebviewTest());
beforeEach(resetHeader);
afterEach(unmount);

function openTools() {
  const gear = headerButton("settingsTools");
  act(() => {
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  const menu = stores.contextMenu.value;
  expect(menu).not.toBeNull();
  return menu!;
}

function runEntry(title: string) {
  const entry = openTools().entries.find((candidate) => candidate?.title === title);
  expect(entry, `menu entry ${title}`).toBeDefined();
  act(() => {
    closeContextMenu();
    entry!.onClick();
  });
}

describe("the Settings & Tools menu", () => {
  it("lists the repository tools in groups, marking remote branches as shown", () => {
    mount();
    const menu = openTools();
    expect(menu.source).toBe("repository-tools");
    expect(menu.entries.map((entry) => entry?.title ?? null)).toEqual([
      "manageRemotes",
      "stashes",
      "worktrees",
      "workspaceSync",
      "fastForwardTitle",
      "cleanupBranches",
      "bisectTitle",
      null,
      "goTo",
      "reflog",
      "safetyNet…",
      "fileHistory",
      "operationActivity",
      null,
      "✓ showRemoteBranches",
      "hiddenBranches…",
      "gettingStarted",
      "learnMore",
      "openSettings"
    ]);
  });

  it("reports whether its own menu is open", () => {
    mount();
    const gear = headerButton("settingsTools");
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    openTools();
    expect(gear.getAttribute("aria-expanded")).toBe("true");
    act(() => closeContextMenu());
    expect(gear.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      stores.contextMenu.value = { x: 1, y: 1, entries: [], source: "commit:abc" };
    });
    expect(gear.getAttribute("aria-expanded")).toBe("false");
  });

  it("places a menu opened from the keyboard under the button", () => {
    mount();
    const gear = headerButton("settingsTools");
    vi.spyOn(gear, "getBoundingClientRect").mockReturnValue({
      left: 300,
      bottom: 40
    } as DOMRect);
    act(() => gear.click());
    expect(stores.contextMenu.value).toMatchObject({ x: 300, y: 40 });
  });

  it.each([
    ["manageRemotes", "openRemotes"],
    ["stashes", "openStashes"],
    ["worktrees", "openWorktrees"],
    ["workspaceSync", "openWorkspaceSync"],
    ["fastForwardTitle", "openFastForward"],
    ["cleanupBranches", "openCleanup"],
    ["bisectTitle", "openBisect"],
    ["reflog", "openReflog"],
    ["safetyNet…", "openSafetyNet"],
    ["operationActivity", "openActivity"]
  ] as const)("opens %s with %s", (title, opener) => {
    mount();
    runEntry(title);
    expect(openers[opener]).toHaveBeenCalledTimes(1);
    for (const [name, other] of Object.entries(openers)) {
      if (name !== opener) {
        expect(other, name).not.toHaveBeenCalled();
      }
    }
  });

  it("hides and shows remote branches, reloading the graph", () => {
    mount();
    runEntry("✓ showRemoteBranches");
    expect(stores.showRemoteBranch.value).toBe(false);
    const sent = vscodeApi.postMessage.mock.calls.map(([message]) => message.command);
    expect(sent).toEqual(expect.arrayContaining(["loadBranches", "saveRepoState"]));

    expect(openTools().entries.map((entry) => entry?.title)).toContain("showRemoteBranches");
    runEntry("showRemoteBranches");
    expect(stores.showRemoteBranch.value).toBe(true);
  });

  it.each([
    ["gettingStarted", "walkthrough.open"],
    ["learnMore", "docs.open"],
    ["openSettings", "settings.open"]
  ])("asks the extension to open %s", (title, method) => {
    mount();
    runEntry(title);
    expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({
      kind: "rpc.request",
      method,
      params: null,
      id: expect.any(String)
    });
  });
});

describe("Undo", () => {
  afterEach(() => resetRepositoryState());

  function withUndo(undo: SafetyUndo | null) {
    act(() => {
      repositoryState.value = {
        remotes: [],
        pushDefault: null,
        branches: [],
        remoteBranches: [],
        tags: [],
        worktrees: [],
        head: "main",
        operation: null,
        conflicts: [],
        staged: 0,
        undo
      };
    });
  }

  it("leads the menu while an action can be undone, and undoes it in one click", () => {
    withUndo({ id: "1700000000000-0", title: "Hard Reset of main" });
    mount();
    const [first, separator] = openTools().entries;
    expect(first?.title).toBe("undoAction");
    expect(separator).toBeNull();
    act(() => {
      closeContextMenu();
      first!.onClick();
    });
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "repositoryAction",
        repo: "/r/a",
        action: { kind: "undoSafetyNet", id: "1700000000000-0" }
      })
    );
  });

  it("names the action it would undo", () => {
    const strings = Object.getOwnPropertyDescriptor(window, "l10n")!;
    Object.defineProperty(window, "l10n", {
      value: new Proxy({}, { get: (_target, key) => (key === "undoAction" ? "Undo {0}" : key) }),
      configurable: true
    });
    try {
      withUndo({ id: "1-0", title: "Deletion of Branch topic" });
      mount();
      expect(openTools().entries[0]?.title).toBe("Undo Deletion of Branch topic");
    } finally {
      Object.defineProperty(window, "l10n", strings);
    }
  });

  it("is left out when nothing can be undone", () => {
    withUndo(null);
    mount();
    expect(openTools().entries[0]?.title).toBe("manageRemotes");
  });
});

describe("Go to", () => {
  it("asks the extension for the picker of the selected repository", () => {
    mount();
    runEntry("goTo");
    expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({
      kind: "rpc.request",
      method: "goTo.show",
      params: { repo: stores.selectedRepo.value },
      id: expect.any(String)
    });
  });
});

describe("File History", () => {
  function submitPath(path: string) {
    mount(h(Fragment, null, h(MainHeader, { repos: REPOS }), h(Dialog, {})));
    runEntry("fileHistory");
    const dialog = stores.dialog.value;
    expect(dialog).toMatchObject({
      kind: "form",
      message: "fileHistory",
      action: "fileHistory",
      source: null,
      inputs: [{ kind: "text", label: "historyPath", value: "" }]
    });
    const field = document.querySelector<HTMLInputElement>("[role=dialog] input[type=text]")!;
    act(() => {
      field.value = path;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      field.form!.requestSubmit();
    });
  }

  it("shows the history of the path entered", () => {
    submitPath("src/x.ts");
    expect(historyFilter.value).toEqual({ ...emptyFilter(), path: "src/x.ts", follow: true });
    expect(stores.dialog.value).toBeNull();
  });

  it("keeps a path's surrounding spaces, which may belong to the name", () => {
    submitPath(" notes .txt");
    expect(historyFilter.value.path).toBe(" notes .txt");
  });

  it("leaves the current search alone when no path is given", () => {
    const search = { ...emptyFilter(), text: "keep me" };
    historyFilter.value = search;
    submitPath("   ");
    expect(historyFilter.value).toBe(search);
    expect(stores.dialog.value).toBeNull();
  });
});
