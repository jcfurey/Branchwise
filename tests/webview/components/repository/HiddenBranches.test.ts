// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryState } from "@/backend/types";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

let HiddenBranches: typeof import("@/webview/components/repository/HiddenBranches");
let RefsPane: typeof import("@/webview/components/repository/RefsPane").RefsPane;
let Dialog: typeof import("@/webview/components/ui/Dialog").Dialog;
let menus: typeof import("@/webview/lib/menus");
let repositoryState: typeof import("@/webview/lib/repository-actions").repositoryState;
let stores: typeof import("@/webview/lib/stores");
let container: HTMLDivElement;

const HASH = "a".repeat(40);
const branch = (name: string) => ({
  name,
  hash: HASH,
  upstream: "",
  ahead: 0,
  behind: 0,
  gone: false,
  date: 0,
  merged: false
});
const state: RepositoryState = {
  remotes: [{ name: "origin", fetchUrls: [], pushUrls: [] }],
  pushDefault: null,
  branches: ["bot/one", "bot/two", "feature", "main"].map(branch),
  remoteBranches: [
    { name: "origin/bot/three", hash: HASH },
    { name: "origin/main", hash: HASH }
  ],
  tags: [],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: []
};

function show(...children: Parameters<typeof h>[]) {
  act(() =>
    render(
      h(
        "div",
        null,
        children.map((args) => h(...args))
      ),
      container
    )
  );
}

/** The panel of the open dialog. */
function panel() {
  const element = container.querySelector<HTMLElement>('[role="dialog"]');
  if (element === null) {
    throw new Error("No dialog is open");
  }
  return element;
}

function type(text: string) {
  const area = panel().querySelector("textarea")!;
  act(() => {
    area.value = text;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Each previewed pattern with the number of branches it hides. */
function preview() {
  return [...panel().querySelectorAll("[data-hidden-branch-preview] li")].map((item) => [
    item.querySelector("code")!.textContent,
    Number(item.querySelector("[data-hidden-count]")!.textContent)
  ]);
}

/** The outer element of the Branches pane row whose label has this tooltip. */
function paneRow(title: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("nav button[title]")].find(
    (element) => element.title === title
  );
  if (button === undefined) {
    throw new Error(`Missing row ${title}`);
  }
  return button.parentElement!;
}

beforeAll(async () => {
  setupWebviewTest();
  // The hint fills in a template; the other strings stay their keys.
  const keys = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keys, {
      get: (target, key) =>
        key === "branchesHiddenByPatterns" ? "Hidden: {0}" : Reflect.get(target, key)
    }),
    configurable: true
  });
  HiddenBranches = await import("@/webview/components/repository/HiddenBranches");
  ({ RefsPane } = await import("@/webview/components/repository/RefsPane"));
  ({ Dialog } = await import("@/webview/components/ui/Dialog"));
  menus = await import("@/webview/lib/menus");
  ({ repositoryState } = await import("@/webview/lib/repository-actions"));
  stores = await import("@/webview/lib/stores");
});

beforeEach(() => {
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.headBranch.value = "main";
  stores.branchDisplay.value = "filter";
  stores.showRemoteBranch.value = true;
  stores.commitList.value = [];
  stores.repoStates.value = { "/repo": { columnWidths: null } };
  stores.dialog.value = null;
  stores.contextMenu.value = null;
  repositoryState.value = state;
  container = document.createElement("div");
  document.body.append(container);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("the Hidden Branches dialog", () => {
  it("previews how many branches each pattern hides, then saves the patterns", () => {
    show([Dialog, {}]);
    act(() => HiddenBranches.openHiddenBranches());
    expect(panel().querySelector("textarea")!.value).toBe("");
    expect(preview()).toEqual([]);

    type("bot/*\n\n  feature \nmain\nnothing/*");
    // The checked-out branch is never hidden, so `main` hides only `origin/main`.
    expect(preview()).toEqual([
      ["bot/*", 3],
      ["feature", 1],
      ["main", 1],
      ["nothing/*", 0]
    ]);
    // Nothing is saved before the user asks.
    expect(stores.hiddenBranchPatterns.value).toEqual([]);

    const save = [...panel().querySelectorAll("button")].find(
      (button) => button.textContent === "save"
    )!;
    act(() => save.click());
    expect(stores.dialog.value).toBeNull();
    expect(stores.hiddenBranchPatterns.value).toEqual(["bot/*", "feature", "main", "nothing/*"]);
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      command: "saveRepoState",
      repo: "/repo",
      state: { hiddenBranchPatterns: ["bot/*", "feature", "main", "nothing/*"] }
    });
    expect(latestGraphRequest("loadCommits").hiddenBranchPatterns).toEqual([
      "bot/*",
      "feature",
      "main",
      "nothing/*"
    ]);
  });

  it("opens from a branch's menu with a pattern for branches like it added", () => {
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenBranchPatterns: ["wip"] } };
    show([Dialog, {}]);
    const entries = menus.refMenu({ type: "remote", name: "origin/bot/three", hash: HASH }, false);
    const entry = entries.find((candidate) => candidate?.title === "hideBranchesLikeThis…");
    act(() => entry!.onClick());
    expect(panel().querySelector("textarea")!.value).toBe("wip\nbot/*");
    expect(preview()).toEqual([
      ["wip", 0],
      ["bot/*", 3]
    ]);
  });

  it("does not add a pattern that is already there", () => {
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenBranchPatterns: ["bot/*"] } };
    show([Dialog, {}]);
    act(() => HiddenBranches.openHiddenBranches("bot/*"));
    expect(panel().querySelector("textarea")!.value).toBe("bot/*");
  });

  it("closes without saving", () => {
    show([Dialog, {}]);
    act(() => HiddenBranches.openHiddenBranches("bot/*"));
    const close = [...panel().querySelectorAll("button")].find(
      (button) => button.textContent === "close"
    )!;
    act(() => close.click());
    expect(stores.dialog.value).toBeNull();
    expect(stores.hiddenBranchPatterns.value).toEqual([]);
    expect(vscodeApi.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "saveRepoState" })
    );
  });
});

describe("hidden branches in the Branches pane", () => {
  beforeEach(() => {
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenBranchPatterns: ["bot/*"] } };
  });

  it("lists hidden branches dimmed, and the checked-out and chosen ones as usual", () => {
    stores.selectedBranch.value = "bot/two";
    show([RefsPane, {}]);
    expect(paneRow("bot/one").className).toContain("text-muted");
    expect(paneRow("origin/bot/three").className).toContain("text-muted");
    expect(paneRow("bot/two").className).not.toContain("text-muted");
    expect(paneRow("feature").className).not.toContain("text-muted");
    expect(paneRow("main").className).not.toContain("text-muted");
    expect(paneRow("origin/main").className).not.toContain("text-muted");
  });
});

describe("the hint above the graph", () => {
  beforeEach(() => {
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenBranchPatterns: ["bot/*"] } };
  });

  it("says how many branches are hidden, and shows them all again", () => {
    show([HiddenBranches.HiddenBranchesHint, {}], [RefsPane, {}]);
    const hint = container.querySelector("[data-hidden-branches]")!;
    expect(hint.getAttribute("role")).toBe("status");
    expect(hint.textContent).toContain("Hidden: 3");
    const showAll = [...hint.querySelectorAll("button")].find(
      (button) => button.textContent === "showHiddenBranches"
    )!;
    act(() => showAll.click());
    expect(stores.hiddenBranchPatterns.value).toEqual([]);
    expect(container.querySelector("[data-hidden-branches]")).toBeNull();
    expect(paneRow("bot/one").className).not.toContain("text-muted");
  });

  it("opens the patterns from the hint", () => {
    show([HiddenBranches.HiddenBranchesHint, {}], [Dialog, {}]);
    const edit = [...container.querySelectorAll("[data-hidden-branches] button")].find(
      (button) => button.textContent === "editHiddenBranches"
    ) as HTMLButtonElement;
    act(() => edit.click());
    expect(panel().querySelector("textarea")!.value).toBe("bot/*");
  });

  it("shows nothing while nothing is hidden", () => {
    stores.repoStates.value = { "/repo": { columnWidths: null, hiddenBranchPatterns: ["none/*"] } };
    show([HiddenBranches.HiddenBranchesHint, {}]);
    expect(container.querySelector("[data-hidden-branches]")).toBeNull();
  });
});
