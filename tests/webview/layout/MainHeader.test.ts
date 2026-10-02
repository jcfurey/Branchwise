// @vitest-environment jsdom
import { h, render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { MainHeader } from "@/webview/layout/MainHeader";
import {
  emptyFilter,
  historyFilter,
  refsVisible,
  searchVisible,
  selectedCommits,
  workspaceVisible
} from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

import {
  FakeResizeObserver,
  REPOS,
  choose,
  header,
  headerButton,
  mount,
  picker,
  pickerOptions,
  resetHeader,
  unmount
} from "./header-harness";

beforeAll(() => setupWebviewTest());
beforeEach(resetHeader);
afterEach(unmount);

const HEIGHT = "--main-header-height";

function commit(hash: string): HistoryEntry {
  return {
    hash,
    parentHashes: [],
    author: "Lin",
    email: "lin@branchwise.test",
    date: 9,
    message: hash,
    refs: []
  };
}

describe("the toolbar", () => {
  it("lays out its controls in order, with their names and states", () => {
    mount();
    const buttons = [...header().querySelectorAll("button")].map((button) => ({
      text: button.textContent,
      label: button.getAttribute("aria-label"),
      title: button.getAttribute("title"),
      expanded: button.getAttribute("aria-expanded"),
      popup: button.getAttribute("aria-haspopup")
    }));
    const plain = { label: null, title: null, expanded: null, popup: null };
    const trigger = { label: null, expanded: "false", popup: "listbox" };
    expect(buttons).toEqual([
      { ...plain, text: "branchesPane", expanded: "true" },
      { ...plain, text: "workspaceOverview", expanded: "false" },
      { ...trigger, text: "a", title: "/r/a" },
      { ...trigger, text: "showAll", title: "*" },
      { ...trigger, text: "filterToBranch", title: "filter" },
      { ...plain, text: "", label: "historySearch", title: "historySearch", expanded: "false" },
      { ...plain, text: "", label: "jumpToHead", title: "jumpToHead" },
      { ...plain, text: "refresh" },
      { ...plain, text: "fetch" },
      { ...plain, text: "compareSubmit" },
      { text: "", label: "settingsTools", title: "settingsTools", expanded: "false", popup: "menu" }
    ]);
    expect(picker("repo")).toBe(header().querySelectorAll("button")[2]);
    expect(picker("branch").title).toBe("*");
    expect(picker("branchDisplay").title).toBe("filter");
    expect(headerButton("branchesPane").classList).toContain("bg-row-selected");
    expect(headerButton("workspaceOverview").classList).not.toContain("bg-row-selected");
    expect(document.documentElement.style.getPropertyValue(HEIGHT)).toBe("0px");
  });

  it("offers the scanned repositories and the selected one it did not list", () => {
    stores.selectedRepo.value = "/r/zzz/deep";
    mount();
    expect(picker("repo").title).toBe("/r/zzz/deep");
    expect(picker("repo").textContent).toBe("deep");
    expect(pickerOptions("repo")).toEqual([
      ["a", "/r/a"],
      ["b", "/r/b"],
      ["deep", "/r/zzz/deep"]
    ]);
  });

  it.each([
    ["/r/trailing/", "trailing"],
    ["C:\\repos\\win", "win"],
    ["C:\\repos\\win\\", "win"],
    ["\\\\server\\share\\repo", "repo"],
    ["plain", "plain"],
    ["/", "/"]
  ])("names the unlisted repository %j %j", (path, label) => {
    stores.selectedRepo.value = path;
    mount();
    expect(picker("repo").textContent).toBe(label);
    expect(picker("repo").title).toBe(path);
  });

  it("selects another repository", () => {
    mount();
    pickerOptions("repo");
    choose("b");
    expect(stores.selectedRepo.value).toBe("/r/b");
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({ command: "selectRepo", repo: "/r/b" });
  });

  it("lists branches without their remotes prefix and chooses one", () => {
    stores.selectedBranch.value = "remotes/origin/x";
    stores.branchDisplay.value = "ancestors";
    mount();
    expect(picker("branch").title).toBe("remotes/origin/x");
    expect(picker("branch").textContent).toBe("origin/x");
    expect(picker("branchDisplay").title).toBe("ancestors");
    expect(pickerOptions("branch")).toEqual([
      ["showAll", "*"],
      ["main", null],
      ["origin/x", "remotes/origin/x"]
    ]);

    vscodeApi.postMessage.mockClear();
    choose("origin/x");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();

    pickerOptions("branch");
    choose("main");
    expect(stores.selectedBranch.value).toBe("main");
    expect(picker("branch").title).toBe("main");
  });

  it("switches the view mode", () => {
    mount();
    expect(pickerOptions("branchDisplay")).toEqual([
      ["filterToBranch", "filter"],
      ["focusDirectHistory", "focus"],
      ["focusAllAncestors", "ancestors"]
    ]);
    choose("focusDirectHistory");
    expect(stores.branchDisplay.value).toBe("focus");
    expect(picker("branchDisplay").title).toBe("focus");
  });
});

/** The names of the header's disabled buttons, in order. */
const disabledNames = () =>
  [...header().querySelectorAll("button")]
    .filter((button) => button.disabled)
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);

describe("disabled controls", () => {
  it("waits for a repository and its branches", () => {
    stores.selectedRepo.value = undefined;
    stores.branchList.value = undefined;
    stores.selectedBranch.value = undefined;
    mount(h(MainHeader, { repos: [] }));
    // The branch picker has no choice to show yet; the view picker shows its mode.
    expect(disabledNames()).toEqual([
      "",
      "filterToBranch",
      "jumpToHead",
      "fetch",
      "compareSubmit",
      "settingsTools"
    ]);
    expect(picker("branch").disabled).toBe(true);
    expect(picker("branchDisplay").disabled).toBe(true);
    expect(picker("repo").disabled).toBe(false);
  });

  it("keeps the view modes back until a branch exists", () => {
    stores.branchList.value = [];
    mount();
    expect(picker("branch").disabled).toBe(false);
    expect(picker("branchDisplay").disabled).toBe(true);
    act(() => {
      stores.branchList.value = ["main"];
    });
    expect(picker("branchDisplay").disabled).toBe(false);
  });

  it("enables everything for a repository with branches", () => {
    mount();
    expect(disabledNames()).toEqual([]);
  });

  it("keeps Jump to HEAD back without a checked-out commit", () => {
    stores.commitHead.value = null;
    mount();
    expect(disabledNames()).toEqual(["jumpToHead"]);
  });
});

describe("Jump to HEAD", () => {
  it("stands out when the loaded graph does not show HEAD's row, and not while it loads", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    mount();
    const jump = headerButton("jumpToHead");
    expect(jump.title).toBe("jumpToHead");
    act(() => {
      stores.commitList.value = [commit("other")];
    });
    expect(jump.title).toBe("jumpToHeadOutOfSight");
    expect(jump.className).toContain("bg-action");
  });
});

describe("the pane toggles", () => {
  it.each([
    ["branchesPane", refsVisible, "refs"],
    ["workspaceOverview", workspaceVisible, "workspace"]
  ] as const)("%s opens and closes its pane and saves the choice", (name, visible, key) => {
    mount();
    const before = visible.value;
    act(() => headerButton(name).click());
    expect(visible.value).toBe(!before);
    expect(headerButton(name).getAttribute("aria-expanded")).toBe(String(!before));
    const saved = vscodeApi.setState.mock.lastCall?.[0] as { navigation: Record<string, unknown> };
    expect(saved.navigation[key]).toBe(!before);
    act(() => headerButton(name).click());
    expect(visible.value).toBe(before);
  });
});

describe("the search button", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    vi.useFakeTimers();
    input = document.createElement("input");
    input.dataset.historySearch = "";
    input.value = "earlier words";
    document.body.append(input);
  });

  afterEach(() => {
    input.remove();
    vi.useRealTimers();
  });

  it("opens the search row with its text selected, and closes it again", () => {
    mount();
    act(() => headerButton("historySearch").click());
    expect(searchVisible.value).toBe(true);
    expect(headerButton("historySearch").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).not.toBe(input);

    vi.runAllTimers();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);

    act(() => headerButton("historySearch").click());
    expect(searchVisible.value).toBe(false);
    expect(headerButton("historySearch").getAttribute("aria-expanded")).toBe("false");
  });

  it("reports the row open while a filter keeps it open, and focuses it instead of closing", () => {
    historyFilter.value = { ...emptyFilter(), text: "x" };
    mount();
    const search = headerButton("historySearch");
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(search.classList).toContain("bg-row-selected");

    act(() => search.click());
    vi.runAllTimers();
    expect(document.activeElement).toBe(input);
    expect(searchVisible.value).toBe(true);

    input.blur();
    act(() => search.click());
    vi.runAllTimers();
    expect(searchVisible.value).toBe(true);
    expect(document.activeElement).toBe(input);

    act(() => {
      historyFilter.value = emptyFilter();
    });
    act(() => search.click());
    expect(searchVisible.value).toBe(false);
    expect(search.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Refresh, Fetch and Compare", () => {
  it("reloads the repository", () => {
    mount();
    act(() => headerButton("refresh").click());
    const sent = vscodeApi.postMessage.mock.calls.map(([message]) => message.command);
    expect(sent).toEqual(expect.arrayContaining(["loadBranches", "repositoryQuery"]));
  });

  it("fetches through the remotes dialog", () => {
    mount();
    act(() => headerButton("fetch").click());
    expect(stores.dialog.value).toMatchObject({ kind: "running", message: "loadingRemotes" });
    expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({
      command: "loadRemotes",
      repo: "/r/a",
      requestId: expect.stringMatching(/^remote-\d+$/),
      branchName: null
    });
  });

  it.each([
    [[], ["HEAD", "HEAD"]],
    [["h1"], ["h1", "HEAD"]],
    [
      ["h2", "h1", "h3"],
      ["h2", "h1"]
    ]
  ])("compares the selection %j as %j", (hashes, [left, right]) => {
    selectedCommits.value = hashes.map(commit);
    mount();
    act(() => headerButton("compareSubmit").click());
    const dialog = stores.dialog.value as { kind: string; content: VNode };
    expect(dialog.kind).toBe("content");
    expect(dialog.content.props).toMatchObject({ left, right });
  });
});

/** Give the header, and only the header, the height `height` returns at each measurement. */
function stubHeight(height: () => number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const tall = this.tagName === "HEADER" ? height() : 0;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      width: 0,
      bottom: tall,
      height: tall
    } as DOMRect;
  });
}

describe("the header height", () => {
  it("publishes the height before paint, follows it as the header wraps, and removes it", () => {
    let height = 48;
    stubHeight(() => height);
    mount();
    const style = document.documentElement.style;
    expect(style.getPropertyValue(HEIGHT)).toBe("48px");
    const observer = FakeResizeObserver.latest!;
    expect(observer.targets).toEqual([header()]);

    height = 70;
    observer.report();
    expect(style.getPropertyValue(HEIGHT)).toBe("70px");
    height = 61.5;
    observer.report();
    expect(style.getPropertyValue(HEIGHT)).toBe("61.5px");

    unmount();
    expect(style.getPropertyValue(HEIGHT)).toBe("");
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("needs a ResizeObserver", () => {
    vi.unstubAllGlobals();
    const host = document.createElement("div");
    expect(() => act(() => render(h(MainHeader, { repos: REPOS }), host))).toThrow(
      /ResizeObserver/
    );
  });
});
