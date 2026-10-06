// @vitest-environment jsdom
import { Fragment, h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "@/webview/components/ui/Dialog";
import { MainHeader } from "@/webview/layout/MainHeader";
import { closeContextMenu } from "@/webview/lib/actions";
import { emptyFilter, historyFilter } from "@/webview/lib/navigation";
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
      "reflog",
      "fileHistory",
      "operationActivity",
      null,
      "✓ showRemoteBranches",
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

    expect(openTools().entries[12]?.title).toBe("showRemoteBranches");
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
