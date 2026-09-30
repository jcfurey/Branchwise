// @vitest-environment jsdom

import { h, options, render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryState } from "@/backend/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() }
}));

let pane: typeof import("@/webview/components/repository/RefsPane");
let dropdown: typeof import("@/webview/components/ui/Dropdown");
let actions: typeof import("@/webview/lib/repository-actions");
let stores: typeof import("@/webview/lib/stores");
let container: HTMLDivElement;

const REFS = 3000;
const hash = "a".repeat(40);
const state = (count: number): RepositoryState => ({
  remotes: [{ name: "origin", fetchUrls: ["https://example.test/repo.git"], pushUrls: [] }],
  pushDefault: null,
  branches: Array.from({ length: count }, (_, i) => ({
    name: `branch-${i}`,
    hash,
    upstream: "",
    ahead: 0,
    behind: 0,
    gone: false
  })),
  remoteBranches: Array.from({ length: count }, (_, i) => ({ name: `origin/remote-${i}`, hash })),
  tags: Array.from({ length: count }, (_, i) => ({ name: `tag-${i}`, hash })),
  worktrees: [],
  head: "branch-0",
  operation: null,
  conflicts: []
});

/** Count renders of components with this name while `run` runs. */
function renders(name: string, run: () => void) {
  let count = 0;
  const previous = options.diffed;
  options.diffed = (vnode: VNode) => {
    if (typeof vnode.type === "function" && vnode.type.name === name) {
      count++;
    }
    previous?.(vnode);
  };
  try {
    act(run);
  } finally {
    if (previous === undefined) {
      delete options.diffed;
    } else {
      options.diffed = previous;
    }
  }
  return count;
}

const rows = (prefix: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button[title]")].filter((button) =>
    button.title.startsWith(prefix)
  ).length;
const showMore = () =>
  [...container.querySelectorAll("button")].filter(
    (button) => button.textContent === "showMoreRefs"
  );

beforeAll(async () => {
  setupWebviewTest();
  Element.prototype.scrollIntoView = () => {};
  pane = await import("@/webview/components/repository/RefsPane");
  dropdown = await import("@/webview/components/ui/Dropdown");
  actions = await import("@/webview/lib/repository-actions");
  stores = await import("@/webview/lib/stores");
});

beforeEach(() => {
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.showRemoteBranch.value = true;
  stores.contextMenu.value = null;
  stores.dialog.value = null;
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe(`Branches pane with ${REFS} of each ref`, () => {
  beforeEach(() => {
    actions.repositoryState.value = state(REFS);
    act(() => render(h(pane.RefsPane, {}), container));
  });

  it("renders one page of each list and shows more on request", () => {
    expect(rows("branch-")).toBe(pane.REF_PAGE);
    expect(rows("origin/remote-")).toBe(pane.REF_PAGE);
    expect(rows("tag-")).toBe(pane.REF_PAGE);
    expect(showMore()).toHaveLength(3);
    act(() => showMore()[0]!.click());
    expect(rows("branch-")).toBe(2 * pane.REF_PAGE);
  });

  it("re-renders only the rows whose menu opens or closes", () => {
    const open = (source: string | null) =>
      renders("Row", () => {
        stores.contextMenu.value = source === null ? null : { x: 0, y: 0, entries: [], source };
      });
    expect(open("ref:head:branch-3")).toBe(1);
    expect(open("ref:tag:tag-7")).toBe(2);
    expect(open(null)).toBe(1);
  });

  it("keeps a filter keystroke to one page per list", () => {
    const filter = container.querySelector<HTMLInputElement>("input")!;
    act(() => {
      filter.value = "1";
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows("branch-")).toBe(pane.REF_PAGE);
    expect(rows("tag-")).toBe(pane.REF_PAGE);
    act(() => {
      filter.value = "branch-2999";
      filter.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows("branch-")).toBe(1);
    expect(showMore()).toHaveLength(0);
  });
});

describe("branch dropdown with 10,000 branches", () => {
  const branches = Array.from({ length: 10_000 }, (_, i) => ({
    label: `branch-${i}`,
    value: `branch-${i}`
  }));

  it("renders one page of options and pages with the keyboard", () => {
    act(() =>
      render(
        h(dropdown.Dropdown, {
          label: "Branch",
          options: branches,
          value: "branch-0",
          onChange: () => {}
        }),
        container
      )
    );
    act(() => container.querySelector("button")!.click());
    expect(container.querySelectorAll("li")).toHaveLength(dropdown.DROPDOWN_PAGE);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("dropdownPage");

    const combo = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
    act(() => {
      combo.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    const last = container.querySelector<HTMLElement>('li[data-active="true"]');
    expect(last?.textContent).toBe("branch-9999");
    expect(combo.getAttribute("aria-activedescendant")).toBe(last?.id);
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(dropdown.DROPDOWN_PAGE);
  });
});
