// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitDetails } from "@/backend/types";
import type { CommitDetailsPosition } from "@/types";
import { App } from "@/webview/App";
import { PANE_DEFAULT, PANE_MAX, PANE_MIN, paneSizes } from "@/webview/lib/details-pane";
import { activeTab, pendingReveal, restoreScroll, showTab } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { reconfigure } from "@tests/webview/components/commit/commit-view-fixtures";
import { chain, resetGraphView } from "@tests/webview/components/commit/graph-view-harness";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;
let restoreConfig = () => {};
let restoreWindow = () => {};

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  resetGraphView();
  stores.commitList.value = chain("c", "b", "a");
  stores.commitHead.value = "c";
  stores.commitDetails.value = null;
  paneSizes.value = { bottom: PANE_DEFAULT, right: PANE_DEFAULT };
  // jsdom lays nothing out, so it cannot scroll.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  restoreConfig();
  restoreConfig = () => {};
  restoreWindow();
  restoreWindow = () => {};
  activeTab.value = "graph";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Show the page with the details opening in `position`. */
function showPage(position: CommitDetailsPosition) {
  restoreConfig = reconfigure({ commitDetailsPosition: position });
  act(() => render(h(App, { repos: [{ name: "repo", path: "/work/repo" }] }), host));
}

function setPosition(position: CommitDetailsPosition) {
  act(() => {
    reconfigure({ commitDetailsPosition: position });
  });
}

const row = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${hash}"]`)!;
const pane = () => host.querySelector<HTMLElement>("[data-details-pane]");
const splitter = () => host.querySelector<HTMLElement>("[data-details-splitter]")!;
const scroller = () => host.querySelector<HTMLElement>("[data-graph-scroller]");
const inlineRow = () => host.querySelector("[data-details-row]");

function details(hash: string): GitCommitDetails {
  return {
    hash,
    parents: [],
    author: "Ada",
    email: "ada@branchwise.test",
    date: 1_650_000_000,
    committer: "Ada",
    body: `message of ${hash}`,
    fileChanges: [
      {
        oldFilePath: `${hash}.txt`,
        newFilePath: `${hash}.txt`,
        type: "M",
        additions: 1,
        deletions: 0
      }
    ]
  };
}

/** Click a commit's row, and answer with its details as the extension would. */
function open(hash: string) {
  act(() => row(hash).click());
  act(() => {
    stores.commitDetails.value = details(hash);
  });
}

function key(target: Element, name: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

function mouse(target: EventTarget, type: string, at: { clientX?: number; clientY?: number }) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...at }));
  });
}

/** Give the window this size, which jsdom fixes at 1024 by 768, until the test ends. */
function windowSize(width: number, height: number) {
  const before = {
    innerWidth: Object.getOwnPropertyDescriptor(window, "innerWidth"),
    innerHeight: Object.getOwnPropertyDescriptor(window, "innerHeight")
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  restoreWindow = () => {
    for (const [name, descriptor] of Object.entries(before)) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(window, name);
      } else {
        Object.defineProperty(window, name, descriptor);
      }
    }
  };
}

const valueNow = () => Number(splitter().getAttribute("aria-valuenow"));

/** The pane sizes the page last saved in its state. */
function savedSizes() {
  const calls = vscodeApi.setState.mock.calls.map(([state]) => state as Record<string, unknown>);
  return calls.findLast((state) => "detailsPane" in state)?.["detailsPane"];
}

describe("where the details open", () => {
  it("opens them under the row by default, with no pane and the window scrolling", () => {
    showPage("inline");
    open("b");
    expect(inlineRow()).not.toBeNull();
    expect(row("b").nextElementSibling).toBe(inlineRow());
    expect(inlineRow()!.textContent).toContain("message of b");
    expect(pane()).toBeNull();
    expect(scroller()).toBeNull();
    expect(host.querySelector("[data-details-splitter]")).toBeNull();
  });

  it("docks them below the graph, which scrolls in its own element above them", () => {
    showPage("bottom");
    expect(scroller()).not.toBeNull();
    expect(pane()).toBeNull();
    open("b");

    expect(inlineRow()).toBeNull();
    expect(pane()!.dataset["detailsPane"]).toBe("bottom");
    expect(pane()!.textContent).toContain("message of b");
    expect(pane()!.textContent).toContain("b.txt");
    // Graph, splitter and pane, top to bottom, across the whole width below the header.
    const dock = pane()!.parentElement!;
    expect([...dock.children]).toEqual([scroller(), splitter(), pane()]);
    expect(dock.className).toContain("flex-col");
    expect(dock.previousElementSibling?.tagName).toBe("HEADER");
    expect(row("b").closest("[data-graph-scroller]")).toBe(scroller());
    expect(splitter().getAttribute("aria-orientation")).toBe("horizontal");
    expect(pane()!.style.height).toBe("40vh");
    // The rows below the open one keep their places: nothing opens between them.
    expect(row("b").nextElementSibling).toBe(row("a"));
  });

  it("docks them to the right of the graph, facts above the files", () => {
    showPage("right");
    open("b");

    expect(inlineRow()).toBeNull();
    expect(pane()!.dataset["detailsPane"]).toBe("right");
    const dock = pane()!.parentElement!;
    expect([...dock.children]).toEqual([scroller(), splitter(), pane()]);
    expect(dock.className).toContain("flex-row");
    expect(splitter().getAttribute("aria-orientation")).toBe("vertical");
    expect(pane()!.style.width).toBe("40vw");
    expect(pane()!.querySelector(".flex-col")).not.toBeNull();
  });

  it("shows the uncommitted changes in the pane", () => {
    stores.commitList.value = [{ ...chain("*")[0]!, message: "" }, ...chain("c", "b", "a")];
    stores.uncommittedChanges.value = 1;
    showPage("bottom");
    act(() => row("*").click());
    expect(pane()!.querySelector("[data-working-tree-details]")).not.toBeNull();
    expect(inlineRow()).toBeNull();
  });

  it("leaves the pane out of the other views", () => {
    showPage("bottom");
    open("b");
    act(() => showTab("statistics"));
    expect(pane()).toBeNull();
    act(() => showTab("graph"));
    expect(pane()!.textContent).toContain("message of b");
  });

  it("moves open details to a new position, keeping the commit", () => {
    showPage("bottom");
    open("b");
    expect(pane()!.dataset["detailsPane"]).toBe("bottom");

    setPosition("right");
    expect(pane()!.dataset["detailsPane"]).toBe("right");
    expect(pane()!.textContent).toContain("message of b");

    setPosition("inline");
    expect(pane()).toBeNull();
    expect(scroller()).toBeNull();
    expect(row("b").nextElementSibling).toBe(inlineRow());
    expect(inlineRow()!.textContent).toContain("message of b");

    setPosition("bottom");
    expect(inlineRow()).toBeNull();
    expect(pane()!.textContent).toContain("message of b");
    expect(stores.expandedCommit.value).toBe("b");
  });

  it("reads a position it does not know as under the row", () => {
    showPage("sideways" as CommitDetailsPosition);
    open("b");
    expect(inlineRow()).not.toBeNull();
    expect(pane()).toBeNull();
  });
});

describe("the docked pane", () => {
  it("replaces its content when another commit is chosen, without closing", () => {
    showPage("bottom");
    open("b");
    const before = pane();
    act(() => row("a").click());
    expect(pane()).toBe(before);
    expect(pane()!.textContent).not.toContain("message of b");
    act(() => {
      stores.commitDetails.value = details("a");
    });
    expect(pane()!.textContent).toContain("message of a");
    expect(stores.expandedCommit.value).toBe("a");
  });

  it("keeps the chosen commit's row in sight above the pane", () => {
    showPage("bottom");
    open("b");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts.at(-1)).toBe(row("b"));
  });

  it("closes on Escape and gives the keyboard back to the row", () => {
    showPage("bottom");
    open("b");
    const button = pane()!.querySelector<HTMLButtonElement>("button")!;
    button.focus();
    key(button, "Escape");
    expect(pane()).toBeNull();
    expect(stores.expandedCommit.value).toBeNull();
    expect(document.activeElement).toBe(row("b"));
  });

  it("closes on Escape from the splitter, and with its close button", () => {
    showPage("right");
    open("b");
    key(splitter(), "Escape");
    expect(pane()).toBeNull();

    open("a");
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[data-details-pane] button[aria-label="close"]')!
        .click()
    );
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(row("a"));
  });

  it("closes when its row is chosen again", () => {
    showPage("bottom");
    open("b");
    act(() => row("b").click());
    expect(pane()).toBeNull();
  });
});

describe("the splitter", () => {
  it("is a focusable separator that names its range in percent", () => {
    showPage("bottom");
    open("b");
    expect(splitter().getAttribute("role")).toBe("separator");
    expect(splitter().tabIndex).toBe(0);
    expect(splitter().getAttribute("aria-label")).toBe("resizeDetailsPane");
    expect(splitter().getAttribute("aria-controls")).toBe(pane()!.id);
    expect(valueNow()).toBe(40);
    expect(splitter().getAttribute("aria-valuemin")).toBe(String(PANE_MIN * 100));
    expect(splitter().getAttribute("aria-valuemax")).toBe(String(PANE_MAX * 100));
    // Its focus is drawn in the theme's focus colour, which high contrast themes set too.
    expect(splitter().className).toContain("focus:bg-focus");
    expect(splitter().className).toContain("focus:outline-focus");
  });

  it("resizes a bottom pane with the up and down arrows, within its bounds", () => {
    showPage("bottom");
    open("b");
    vscodeApi.setState.mockClear();
    key(splitter(), "ArrowUp");
    expect(valueNow()).toBe(45);
    expect(pane()!.style.height).toBe("45vh");
    expect(savedSizes()).toEqual({ bottom: 0.45, right: PANE_DEFAULT });
    key(splitter(), "ArrowDown");
    key(splitter(), "ArrowDown");
    expect(valueNow()).toBe(35);
    // Sideways arrows belong to a pane on the right.
    key(splitter(), "ArrowLeft");
    expect(valueNow()).toBe(35);

    key(splitter(), "End");
    expect(valueNow()).toBe(75);
    key(splitter(), "ArrowUp");
    expect(valueNow()).toBe(75);
    key(splitter(), "Home");
    expect(valueNow()).toBe(15);
    key(splitter(), "ArrowDown");
    expect(valueNow()).toBe(15);
    expect(savedSizes()).toEqual({ bottom: PANE_MIN, right: PANE_DEFAULT });
  });

  it("resizes a right pane with the left and right arrows", () => {
    showPage("right");
    open("b");
    key(splitter(), "ArrowLeft");
    expect(valueNow()).toBe(45);
    expect(pane()!.style.width).toBe("45vw");
    key(splitter(), "ArrowRight");
    key(splitter(), "ArrowRight");
    expect(valueNow()).toBe(35);
    key(splitter(), "ArrowUp");
    expect(valueNow()).toBe(35);
    // Each position keeps its own size.
    expect(paneSizes.value).toEqual({ bottom: PANE_DEFAULT, right: 0.35 });
  });

  it("follows a drag, within its bounds, and saves the size when the drag ends", () => {
    windowSize(1000, 1000);
    showPage("bottom");
    open("b");
    vscodeApi.setState.mockClear();
    mouse(splitter(), "mousedown", { clientY: 600 });
    mouse(window, "mousemove", { clientY: 500 });
    expect(valueNow()).toBe(50);
    expect(pane()!.style.height).toBe("50vh");
    expect(savedSizes()).toBeUndefined();
    mouse(window, "mousemove", { clientY: 0 });
    expect(valueNow()).toBe(75);
    mouse(window, "mousemove", { clientY: 1000 });
    expect(valueNow()).toBe(15);
    mouse(window, "mousemove", { clientY: 650 });
    mouse(window, "mouseup", { clientY: 650 });
    expect(valueNow()).toBe(35);
    expect(savedSizes()).toEqual({ bottom: 0.35, right: PANE_DEFAULT });
    // Once let go, the pointer moves nothing.
    mouse(window, "mousemove", { clientY: 100 });
    expect(valueNow()).toBe(35);
  });

  it("follows a sideways drag on the right", () => {
    windowSize(1000, 1000);
    showPage("right");
    open("b");
    mouse(splitter(), "mousedown", { clientX: 600 });
    mouse(window, "mousemove", { clientX: 500 });
    mouse(window, "mouseup", { clientX: 500 });
    expect(valueNow()).toBe(50);
    expect(pane()!.style.width).toBe("50vw");
  });

  it("goes back to its usual size on a double click", () => {
    showPage("bottom");
    open("b");
    key(splitter(), "End");
    act(() => {
      splitter().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(valueNow()).toBe(PANE_DEFAULT * 100);
    expect(savedSizes()).toEqual({ bottom: PANE_DEFAULT, right: PANE_DEFAULT });
  });

  it("keeps its size when the pane closes and opens again", () => {
    showPage("bottom");
    open("b");
    key(splitter(), "ArrowUp");
    act(() => row("b").click());
    expect(pane()).toBeNull();
    open("a");
    expect(valueNow()).toBe(45);
  });

  it("starts from the size saved in the page's state, within its bounds", async () => {
    vi.resetModules();
    vscodeApi.getState.mockReturnValueOnce({ detailsPane: { bottom: 0.6, right: 2 } });
    const fresh = await import("@/webview/lib/details-pane");
    expect(fresh.paneSizes.value).toEqual({ bottom: 0.6, right: PANE_MAX });

    vi.resetModules();
    vscodeApi.getState.mockReturnValueOnce({ detailsPane: { bottom: "tall" } });
    const unreadable = await import("@/webview/lib/details-pane");
    expect(unreadable.paneSizes.value).toEqual({ bottom: PANE_DEFAULT, right: PANE_DEFAULT });
  });
});

describe("the graph's own scroller", () => {
  it("lands Go to on the row inside it", () => {
    showPage("bottom");
    open("b");
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    act(() => {
      pendingReveal.value = "a";
    });
    const calls = vi.mocked(HTMLElement.prototype.scrollIntoView).mock;
    expect(calls.calls[0]).toEqual([{ block: "center" }]);
    expect(calls.contexts[0]).toBe(row("a"));
    expect(row("a").closest("[data-graph-scroller]")).toBe(scroller());
    expect(document.activeElement).toBe(row("a"));
    // Go to selects the commit; the pane keeps showing the one opened.
    expect(stores.expandedCommit.value).toBe("b");
  });

  it("counts HEAD's row as out of sight once the pane covers it", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const box = (top: number, height: number) =>
      DOMRect.fromRect({ x: 0, y: top, width: 900, height });
    showPage("bottom");
    vi.spyOn(scroller()!, "getBoundingClientRect").mockReturnValue(box(40, 400));
    vi.spyOn(row("c"), "getBoundingClientRect").mockReturnValue(box(420, 24));
    const jump = host.querySelector<HTMLButtonElement>('header button[aria-label="jumpToHead"]')!;
    // Part of the row still shows above the bottom of the scroller.
    open("b");
    expect(jump.title).toBe("jumpToHead");
    vi.spyOn(scroller()!, "getBoundingClientRect").mockReturnValue(box(40, 300));
    key(splitter(), "ArrowUp");
    expect(jump.title).toBe("jumpToHeadOutOfSight");
  });

  it("restores a saved position into it rather than the window", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    showPage("right");
    let top = 0;
    Object.defineProperty(scroller()!, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      }
    });
    act(() => {
      restoreScroll.value = 420;
      stores.commitList.value = chain("d", "c", "b", "a");
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(top).toBe(420);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("saves its position, not the window's, when the graph scrolls", async () => {
    showPage("bottom");
    Object.defineProperty(scroller()!, "scrollTop", { configurable: true, get: () => 240 });
    vscodeApi.setState.mockClear();
    scroller()!.dispatchEvent(new Event("scroll"));
    type Saved = { navigation?: { repos: Record<string, { scroll: number }> } };
    const saved = () =>
      vscodeApi.setState.mock.calls
        .map(([state]) => state as Saved)
        .findLast((state) => state.navigation !== undefined);
    await vi.waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.navigation!.repos["/work/repo"]?.scroll).toBe(240);
  });
});
