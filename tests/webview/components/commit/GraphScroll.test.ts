// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { expandedCommit, repoStates, selectedRepo } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

const commits: HistoryEntry[] = Array.from({ length: 14 }, (_, index) => ({
  hash: `commit${index}`,
  parentHashes: index < 13 ? ["commit13"] : [],
  author: "Author",
  email: "a@test",
  date: 0,
  message: `Commit ${index}`,
  refs: []
}));
let container: HTMLDivElement;
let width: number;
let measure: () => void;
const draw = (entries = commits) =>
  render(h(CommitTable, { commits: entries, head: null, headBranch: null }), container);
const scrollbar = () => container.querySelector<HTMLElement>("[data-graph-scroll]")!;
const viewport = () => container.querySelector<HTMLElement>("[data-graph-viewport]")!;
const rows = () => [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")];
const lane = (index: number) =>
  Number(container.querySelectorAll("circle")[index]!.getAttribute("cx"));
const click = (index: number) =>
  act(() => {
    rows()[index]!.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
  });
const pan = (left: number) => {
  scrollbar().scrollLeft = left;
  scrollbar().dispatchEvent(new Event("scroll"));
};

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  selectedRepo.value = "/repo";
  repoStates.value = {};
  expandedCommit.value = null;
  focusedCommit.value = null;
  selectedCommits.value = [];
  width = 64;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width, height: 32 }) as DOMRect
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  container = document.createElement("div");
  document.body.append(container);
  act(() => draw());
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reveals clipped lanes with the smallest movement and leaves visible lanes in place", () => {
  click(10);
  expect(scrollbar().scrollLeft).toBe(lane(10) + 8 - width);
  expect(viewport().scrollLeft).toBe(scrollbar().scrollLeft);
  const before = scrollbar().scrollLeft;
  click(9);
  expect(scrollbar().scrollLeft).toBe(before);
  click(2);
  expect(scrollbar().scrollLeft).toBe(lane(2) - 8);
  expect(viewport().scrollLeft).toBe(scrollbar().scrollLeft);
});

it("preserves manual panning across refreshes and resizing until explicitly revealed", () => {
  click(10);
  act(() => pan(0));
  act(() => draw(structuredClone(commits)));
  width = 80;
  act(() => measure());
  expect(scrollbar().scrollLeft).toBe(0);
  expect(viewport().scrollLeft).toBe(0);
  act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="revealSelectedLane"]')!.click()
  );
  expect(scrollbar().scrollLeft).toBe(lane(10) + 8 - width);
  expect(focusedCommit.value).toBe("commit10");
  act(() => {
    selectedRepo.value = "/another";
  });
  expect(scrollbar().scrollLeft).toBe(0);
  expect(viewport().scrollLeft).toBe(0);
});

it("reveals keyboard row navigation and does not consume ordinary vertical wheel events", () => {
  act(() => rows()[9]!.focus());
  expect(scrollbar().scrollLeft).toBe(lane(9) + 8 - width);
  act(() => {
    rows()[9]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(focusedCommit.value).toBe("commit10");
  expect(document.activeElement).toBe(rows()[10]);
  expect(scrollbar().scrollLeft).toBe(lane(10) + 8 - width);
  const before = scrollbar().scrollLeft;
  const wheel = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
  rows()[10]!.cells[0]!.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(scrollbar().scrollLeft).toBe(before);
});

it("resets temporary horizontal panning when returning to a repository or recreating its table", () => {
  act(() => pan(120));
  act(() => {
    selectedRepo.value = "/another";
  });
  act(() => {
    selectedRepo.value = "/repo";
  });
  expect(scrollbar().scrollLeft).toBe(0);
  expect(viewport().scrollLeft).toBe(0);
  act(() => pan(120));
  act(() => render(null, container));
  act(() => draw());
  expect(scrollbar().scrollLeft).toBe(0);
  expect(viewport().scrollLeft).toBe(0);
});

it("keeps one keyboard entry point when focus changes or its commit leaves the loaded page", () => {
  const tabStops = () =>
    rows()
      .filter((row) => row.tabIndex === 0)
      .map((row) => row.dataset.commitHash);
  const dirty = { ...commits[0]!, hash: "*", parentHashes: [commits[0]!.hash] };
  act(() => draw([dirty, ...commits]));
  expect(tabStops()).toEqual(["*"]);
  act(() => {
    focusedCommit.value = commits[8]!.hash;
  });
  expect(tabStops()).toEqual([commits[8]!.hash]);
  act(() => draw([dirty, ...commits.slice(0, 5)]));
  expect(tabStops()).toEqual(["*"]);
  act(() => draw([dirty]));
  expect(tabStops()).toEqual(["*"]);
});

it("emphasizes only the hovered graph dot and keeps selection emphasized after leaving", () => {
  act(() =>
    render(
      h(CommitTable, {
        commits,
        head: null,
        headBranch: null,
        focus: { direct: [commits[0]!.hash], merged: [] }
      }),
      container
    )
  );
  const dots = () => [...container.querySelectorAll("circle")];
  const muted = dots()[8]!.getAttribute("fill");
  const lines = [...container.querySelectorAll("path")].map((path) => path.getAttribute("stroke"));
  act(() => {
    rows()[8]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  const highlighted = dots()[8]!.getAttribute("fill");
  expect(highlighted).not.toBe(muted);
  expect(dots()[7]!.getAttribute("fill")).toBe(muted);
  expect(
    [...container.querySelectorAll("path")].map((path) => path.getAttribute("stroke"))
  ).toEqual(lines);
  act(() => {
    rows()[7]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  expect(dots()[8]!.getAttribute("fill")).toBe(muted);
  expect(dots()[7]!.getAttribute("fill")).not.toBe(muted);
  click(8);
  act(() => {
    container.querySelector("table")!.dispatchEvent(new MouseEvent("mouseleave"));
  });
  expect(dots()[8]!.getAttribute("fill")).toBe(highlighted);
  expect(dots()[7]!.getAttribute("fill")).toBe(muted);
});
