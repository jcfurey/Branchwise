// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import {
  commitDetails,
  expandedCommit,
  repoStates,
  selectedRepo,
  uncommittedChanges
} from "@/webview/lib/stores";

import {
  attachHost,
  entry,
  reconfigure,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

/** Noon UTC on a day of October 2026, which is the same day in every zone within 11 hours. */
const noon = (day: number, minutes = 0) => Date.UTC(2026, 9, day, 12, minutes) / 1000;

/** The uncommitted changes, then two commits on 6 October, three on 5 October and one on the 1st. */
const ROWS: Array<HistoryEntry> = [
  entry(UNCOMMITTED_CHANGES, ["a"], { date: noon(7) }),
  entry("a", ["b"], { date: noon(6, 30) }),
  entry("b", ["c"], { date: noon(6) }),
  entry("c", ["d"], { date: noon(5, 40) }),
  entry("d", ["e"], { date: noon(5, 20) }),
  entry("e", ["f"], { date: noon(5) }),
  entry("f", [], { date: noon(1) })
];

const ROW = 24;
const HEADINGS = 32;

let host: HTMLDivElement;
/** How far the page is scrolled, which the stand-in geometry below reads. */
let scrolled = 0;

function drawTable(commits = ROWS) {
  act(() => render(h(CommitTable, { commits, head: null, headBranch: null }), host));
}

function scrollTo(top: number) {
  scrolled = top;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
}

const row = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tbody tr[data-commit-hash="${hash}"]`)!;
const marked = () =>
  [...host.querySelectorAll<HTMLElement>("tbody tr[data-day-start]")].map(
    (tr) => tr.dataset["commitHash"]
  );
const pill = () => host.querySelector<HTMLElement>("[data-day-pill]");

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak();
  stubResizeObserver();
  selectedRepo.value = "/repo";
  repoStates.value = {};
  expandedCommit.value = null;
  commitDetails.value = null;
  focusedCommit.value = null;
  selectedCommits.value = [];
  uncommittedChanges.value = 2;
  scrolled = 0;
  host = attachHost();
  // jsdom lays nothing out: the headings stay stuck at the top, and the rows pass under them.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    let top = 0;
    let height = 0;
    if (this.tagName === "THEAD") {
      height = HEADINGS;
    } else if (this.tagName === "TBODY") {
      top = HEADINGS - scrolled;
    } else if (this instanceof HTMLTableRowElement && this.parentElement?.tagName === "TBODY") {
      top = HEADINGS + this.sectionRowIndex * ROW - scrolled;
      height = ROW;
    }
    return { top, bottom: top + height, height, left: 0, right: 0, width: 0 } as DOMRect;
  });
  // Frames run as soon as they are asked for, so each scroll is read at once.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("day boundaries", () => {
  it("mark the first commit of each day, but not the first commit under the uncommitted row", () => {
    drawTable();
    expect(marked()).toEqual(["c", "f"]);
    expect(row("a").hasAttribute("data-day-start")).toBe(false);
  });

  it("add no rows, so the graph keeps its grid", () => {
    drawTable();
    expect(host.querySelectorAll("tbody > tr")).toHaveLength(ROWS.length);
  });

  it("follow the rows when a new list arrives", () => {
    drawTable();
    drawTable([entry("x", ["f"], { date: noon(2) }), ...ROWS.slice(-1)]);
    expect(marked()).toEqual(["f"]);
  });

  it("are left out while the setting is off", () => {
    const restore = reconfigure({ dateSeparators: false });
    try {
      drawTable();
      expect(marked()).toEqual([]);
      scrollTo(4 * ROW);
      expect(pill()).toBeNull();
    } finally {
      act(restore);
    }
  });

  it("appear when the setting is turned back on", () => {
    const restore = reconfigure({ dateSeparators: false });
    drawTable();
    act(restore);
    expect(marked()).toEqual(["c", "f"]);
  });
});

describe("the day label", () => {
  it("stays away until the first row passes under the headings", () => {
    drawTable();
    expect(pill()).toBeNull();
    scrollTo(0);
    expect(pill()).toBeNull();
  });

  it("names the day of the topmost row as the table scrolls", () => {
    drawTable();
    // Half of `a` is under the headings: it is still the topmost row.
    scrollTo(1.5 * ROW);
    expect(pill()?.textContent).toBe("Tuesday, October 6, 2026");
    // `c` is the topmost row.
    scrollTo(3 * ROW + 2);
    expect(pill()?.textContent).toBe("Monday, October 5, 2026");
    scrollTo(6 * ROW);
    expect(pill()?.textContent).toBe("Thursday, October 1, 2026");
    scrollTo(0);
    expect(pill()).toBeNull();
  });

  it("shows nothing over the uncommitted changes, nor once the table has scrolled by", () => {
    drawTable();
    scrollTo(ROW / 2);
    expect(pill()).toBeNull();
    scrollTo(ROWS.length * ROW);
    expect(pill()).toBeNull();
  });

  it("names the day of the commit whose details are open at the top", () => {
    drawTable();
    act(() => {
      expandedCommit.value = "d";
    });
    // Rows: *, a, b, c, d, details of d, e, f. The details are the topmost row.
    scrollTo(5 * ROW + 2);
    expect(pill()?.textContent).toBe("Monday, October 5, 2026");
  });

  it("is hidden from screen readers and lets clicks through", () => {
    drawTable();
    scrollTo(3 * ROW);
    const strip = pill()!.parentElement!;
    expect(strip.getAttribute("aria-hidden")).toBe("true");
    expect(strip.classList.contains("pointer-events-none")).toBe(true);
  });

  it("reads the page at most once a frame however often it scrolls", () => {
    const frames: Array<FrameRequestCallback> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    drawTable();
    frames.splice(0).forEach((callback) => act(() => callback(0)));
    for (const top of [ROW, 2 * ROW, 3 * ROW + 2]) {
      scrollTo(top);
    }
    expect(frames).toHaveLength(1);
    act(() => frames[0]!(0));
    expect(pill()?.textContent).toBe("Monday, October 5, 2026");
  });
});
