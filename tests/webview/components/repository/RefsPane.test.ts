// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryState } from "@/backend/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

const mocks = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: mocks.postMessage, getState: vi.fn(), setState: vi.fn() }
}));

let RefsPane: typeof import("@/webview/components/repository/RefsPane").RefsPane;
let groupRemoteBranches: typeof import("@/webview/components/repository/RefsPane").groupRemoteBranches;
let actions: typeof import("@/webview/lib/repository-actions");
let stores: typeof import("@/webview/lib/stores");
let navigation: typeof import("@/webview/lib/navigation");
let container: HTMLDivElement;

const state: RepositoryState = {
  remotes: [{ name: "origin", fetchUrls: ["https://example.test/repo.git"], pushUrls: [] }],
  pushDefault: null,
  branches: [
    {
      name: "feature",
      hash: "f".repeat(40),
      upstream: "origin/feature",
      ahead: 2,
      behind: 1,
      gone: false,
      date: 0,
      merged: false
    },
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
  remoteBranches: [
    { name: "origin/feature", hash: "f".repeat(40) },
    { name: "origin/main", hash: "a".repeat(40) }
  ],
  tags: [{ name: "v1", hash: "1".repeat(40) }],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};

/** The label button of a row, by its tooltip. Tooltips hold newlines, so no CSS selector. */
function row(title: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button[title]")].find(
    (element) => element.title === title
  );
  if (button === undefined) {
    throw new Error(`Missing row ${title}`);
  }
  return button;
}
function hasRow(title: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button[title]")].some(
    (element) => element.title === title
  );
}

beforeAll(async () => {
  setupWebviewTest();
  // Row menus are named from a template; the other strings stay their keys.
  const keys = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keys, {
      get: (target, key) => (key === "refActions" ? "Actions for {0}" : Reflect.get(target, key))
    }),
    configurable: true
  });
  ({ RefsPane, groupRemoteBranches } = await import("@/webview/components/repository/RefsPane"));
  actions = await import("@/webview/lib/repository-actions");
  stores = await import("@/webview/lib/stores");
  navigation = await import("@/webview/lib/navigation");
});

beforeEach(() => {
  mocks.postMessage.mockClear();
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.showRemoteBranch.value = true;
  stores.commitHead.value = "a".repeat(40);
  stores.contextMenu.value = null;
  actions.repositoryState.value = state;
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(RefsPane, {}), container));
  const request = mocks.postMessage.mock.calls
    .map((call) => call[0] as { command: string; requestId: string; query?: { kind: string } })
    .find((message) => message.command === "repositoryQuery" && message.query?.kind === "stashes");
  act(() =>
    actions.handleRepositoryQuery({
      repo: "/repo",
      requestId: request!.requestId,
      data: {
        kind: "stashes",
        stashes: [{ ref: "stash@{0}", hash: "5".repeat(40), message: "WIP on main: work" }]
      },
      status: null
    })
  );
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("RefsPane", () => {
  it("names each row's controls with its full ref, so same-named branches stay distinct", () => {
    const names = (selector: string) =>
      [...container.querySelectorAll(selector)].map((button) => button.getAttribute("aria-label"));
    const menus = names('button[aria-haspopup="menu"]').filter((name) =>
      name?.startsWith("Actions for ")
    );
    expect(menus).toEqual(
      expect.arrayContaining([
        "Actions for refs/heads/main",
        "Actions for refs/remotes/origin/main",
        "Actions for refs/tags/v1",
        "Actions for stash@{0}"
      ])
    );
    expect(new Set(menus).size).toBe(menus.length);
    const rowActions = names("button[aria-label]").filter((name) =>
      /^(checkout|showInGraph|applyShort|popShort) /.test(name ?? "")
    );
    expect(rowActions).toEqual(
      expect.arrayContaining([
        "checkout refs/heads/feature",
        "checkout refs/remotes/origin/feature",
        "checkout refs/remotes/origin/main",
        "showInGraph refs/tags/v1",
        "applyShort stash@{0}",
        "popShort stash@{0}"
      ])
    );
    expect(new Set(rowActions).size).toBe(rowActions.length);
  });

  it("lists local branches, remotes, tags and stashes", () => {
    const text = container.textContent ?? "";
    expect(row("main").querySelector("span.font-bold")).not.toBeNull();
    expect(row("feature\norigin/feature").textContent).toContain("↑2 ↓1");
    expect(row("origin/feature").textContent).toBe("feature");
    expect(text).toContain("v1");
    expect(text).toContain("WIP on main: work");
    expect(text).toContain("stash@{0}");
  });

  it("pins a branch above the others and saves the pin for the repository", () => {
    const localRows = () =>
      [...container.querySelectorAll("section")][0]!.querySelectorAll<HTMLButtonElement>(
        "button[aria-current], button[title]:not([aria-label])"
      );
    const labels = () =>
      [...localRows()].map((button) => button.querySelector("span.truncate")?.textContent);
    expect(labels()).toEqual(["showAll", "feature", "main"]);

    const pin =
      row("main").parentElement!.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    act(() => pin.click());
    expect(mocks.postMessage).toHaveBeenCalledWith({
      command: "saveRepoState",
      repo: "/repo",
      state: { pinnedBranches: ["main"] }
    });
    expect(labels()).toEqual(["showAll", "main", "feature"]);
    expect(row("main").querySelector('[aria-label="pinnedBranch"]')).not.toBeNull();

    act(() =>
      row("main").parentElement!.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click()
    );
    expect(labels()).toEqual(["showAll", "feature", "main"]);
    expect(stores.pinnedBranches.value).toEqual([]);
  });

  it("sorts local branches by their last commit when asked, and saves the choice", () => {
    const sortButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="sortBranchesByRecent"]'
    )!;
    expect(sortButton.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      actions.repositoryState.value = {
        ...state,
        branches: [
          { ...state.branches[0]!, date: 100 },
          { ...state.branches[1]!, date: 200 }
        ]
      };
    });
    act(() => sortButton.click());
    expect(mocks.postMessage).toHaveBeenCalledWith({
      command: "saveRepoState",
      repo: "/repo",
      state: { branchSort: "recent" }
    });
    expect(sortButton.getAttribute("aria-pressed")).toBe("true");
    const order = [...container.querySelectorAll("section")][0]!.textContent!;
    expect(order.indexOf("main")).toBeLessThan(order.indexOf("feature"));
    act(() => sortButton.click());
    expect(stores.branchSort.value).toBe("name");
  });

  it("flags merged, gone, stale and diverged branches beside their names, never the checked-out one", () => {
    const now = Date.now() / 1000;
    act(() => {
      actions.repositoryState.value = {
        ...state,
        branches: [
          { ...state.branches[0]!, merged: true, date: now - 200 * 24 * 60 * 60 },
          { ...state.branches[1]!, merged: true, date: now },
          {
            name: "old",
            hash: "b".repeat(40),
            upstream: "origin/old",
            ahead: 0,
            behind: 0,
            gone: true,
            date: now,
            merged: false
          }
        ]
      };
    });
    const flags = (title: string) =>
      [...row(title).parentElement!.querySelectorAll<HTMLElement>("[data-branch-flag]")].map(
        (flag) => [flag.dataset.branchFlag, flag.title]
      );
    expect(flags("feature\norigin/feature")).toEqual([
      ["merged", "branchMergedTitle"],
      ["stale", "branchStaleTitle"]
    ]);
    expect(flags("main")).toEqual([]);
    expect(flags("old\norigin/old\nupstreamGone")).toEqual([["gone", "upstreamGone"]]);
    // The row's own button still reads as the branch's name.
    expect(row("feature\norigin/feature").querySelector("[data-branch-flag]")).toBeNull();
    // Ahead of and behind its upstream at once.
    const tracking = [...row("feature\norigin/feature").querySelectorAll("span")].find(
      (span) => span.textContent === "↑2 ↓1"
    )!;
    expect(tracking.classList.contains("text-git-modified")).toBe(true);
    expect(tracking.title).toBe("branchDiverged");
  });

  it("limits the graph to a clicked branch", () => {
    act(() => row("feature\norigin/feature").click());
    expect(stores.selectedBranch.value).toBe("feature");
    expect(mocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "loadCommits", branchName: "feature" })
    );
  });

  it("shows rows only once the repository state arrives, and keeps them while the rest loads", () => {
    // A reopened graph can show its rows before the Branches pane has the repository state.
    act(() => {
      actions.repositoryState.value = null;
    });
    expect(hasRow("feature\norigin/feature")).toBe(false);
    expect(container.querySelector('nav [role="status"]')).not.toBeNull();
    act(() => {
      actions.repositoryState.value = state;
    });
    const button = row("feature\norigin/feature");

    // The forecast, a new HEAD, the saved pins and a fresh state all arrive after the rows.
    const forecast = mocks.postMessage.mock.calls
      .map((call) => call[0] as { command: string; requestId: string; query?: { kind: string } })
      .findLast(
        (message) =>
          message.command === "repositoryQuery" && message.query?.kind === "conflictForecast"
      );
    act(() =>
      actions.handleRepositoryQuery({
        repo: "/repo",
        requestId: forecast!.requestId,
        data: { kind: "conflictForecast", conflicts: [{ branch: "feature", files: ["a.ts"] }] },
        status: null
      })
    );
    act(() => {
      stores.commitHead.value = "f".repeat(40);
      stores.repoStates.value = {
        "/repo": { columnWidths: null, pinnedBranches: ["main"], branchSort: "recent" }
      };
      actions.repositoryState.value = { ...state, branches: [...state.branches] };
    });
    expect(row("feature\norigin/feature")).toBe(button);
    act(() => button.click());
    expect(stores.selectedBranch.value).toBe("feature");
    act(() => {
      stores.repoStates.value = {};
    });
  });

  it("dims remote branches hidden from the graph and shows them again when one is selected", () => {
    act(() => {
      stores.showRemoteBranch.value = false;
    });
    const remote = row("origin/feature").parentElement!;
    expect(remote.classList.contains("text-muted")).toBe(true);
    act(() => row("origin/feature").click());
    expect(stores.showRemoteBranch.value).toBe(true);
    expect(stores.selectedBranch.value).toBe("remotes/origin/feature");
    expect(row("origin/feature").parentElement!.classList.contains("text-muted")).toBe(false);
  });

  it("opens the graph at a tag and offers the tag menu", () => {
    act(() => row(`v1\n${"1".repeat(40)}`).click());
    expect(navigation.historyFilter.value.revision).toBe("1".repeat(40));
    act(() => {
      row("main").parentElement!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })
      );
    });
    expect(stores.contextMenu.value?.source).toBe("ref:head:main");
  });

  it("narrows every section with the filter", () => {
    const input = container.querySelector("input")!;
    input.value = "v1";
    act(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(hasRow("main")).toBe(false);
    expect(hasRow(`v1\n${"1".repeat(40)}`)).toBe(true);
    expect(container.textContent).not.toContain("origin");
  });

  it("collapses a section and remembers it", () => {
    const toggle = [...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
      (button) => button.textContent?.includes("tags")
    )!;
    act(() => toggle.click());
    expect(hasRow(`v1\n${"1".repeat(40)}`)).toBe(false);
    expect(navigation.collapsedSections.value.has("tags")).toBe(true);
    act(() => toggle.click());
    expect(hasRow(`v1\n${"1".repeat(40)}`)).toBe(true);
  });

  it("groups remote refs under the longest matching remote name", () => {
    const groups = groupRemoteBranches(
      [
        { name: "team", fetchUrls: [], pushUrls: [] },
        { name: "team/origin", fetchUrls: [], pushUrls: [] }
      ],
      [
        { name: "team/origin/main", hash: "a" },
        { name: "team/dev", hash: "b" },
        { name: "gone/main", hash: "c" }
      ]
    );
    expect(groups.map((group) => [group.remote, group.branches.map((ref) => ref.name)])).toEqual([
      ["team", ["team/dev"]],
      ["team/origin", ["team/origin/main"]],
      ["gone", ["gone/main"]]
    ]);
  });
});
