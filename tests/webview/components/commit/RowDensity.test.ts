// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import type { RowDensity, WebviewConfig } from "@/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { applyWebviewConfig } from "@/webview/lib/actions";
import { pendingReveal } from "@/webview/lib/navigation";
import {
  commitDetails,
  expandedCommit,
  repoStates,
  selectedRepo,
  uncommittedChanges
} from "@/webview/lib/stores";
import { getWebviewConfig, rowHeight } from "@/webview/lib/webview-config";

import {
  attachHost,
  entry,
  reconfigure,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

// The `rowDensity` setting sets one height that the rows, the graph drawn behind them and every
// measurement in rows follow.

const DENSITIES: Array<[RowDensity, number]> = [
  ["compact", 20],
  ["default", 24],
  ["comfortable", 30]
];

/** Three commits in one lane, each the parent of the one above. */
const LINE: Array<HistoryEntry> = [entry("c", ["b"]), entry("b", ["a"]), entry("a")];

/** Two branches that meet: `t` leaves lane 0 for lane 1 on its way to `a`. */
const BRANCHED: Array<HistoryEntry> = [entry("m", ["a"]), entry("t", ["a"]), entry("a")];

let host: HTMLDivElement;
let restore: () => void = () => {};

function drawTable(commits: Array<HistoryEntry>) {
  act(() => render(h(CommitTable, { commits, head: null, headBranch: null }), host));
}

const container = () => host.firstElementChild as HTMLDivElement;
const svg = () => host.querySelector("[data-graph-viewport] svg")!;
const dotCentres = () =>
  [...host.querySelectorAll("[data-graph-viewport] circle")].map((dot) => [
    Number(dot.getAttribute("cx")),
    Number(dot.getAttribute("cy"))
  ]);
const row = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tbody tr[data-commit-hash="${hash}"]`)!;
const paths = () =>
  [...host.querySelectorAll("[data-graph-viewport] path[data-branch-relation]")].map(
    (path) => path.getAttribute("d") ?? ""
  );

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak();
  stubResizeObserver();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  selectedRepo.value = "/repo";
  repoStates.value = {};
  expandedCommit.value = null;
  commitDetails.value = null;
  uncommittedChanges.value = 0;
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  act(() => restore());
  restore = () => {};
  pendingReveal.value = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("row height", () => {
  it("is 24 pixels for the default density and for a value the page does not know", () => {
    expect(rowHeight()).toBe(24);
    restore = reconfigure({ rowDensity: "spacious" as RowDensity });
    expect(rowHeight()).toBe(24);
  });

  it.each(DENSITIES)("sizes the rows and the graph for %s rows of %i pixels", (density, height) => {
    restore = reconfigure({ rowDensity: density });
    drawTable(LINE);

    // The cells are as tall as the table says, and so is each line of text in them.
    expect(container().style.getPropertyValue("--row-height")).toBe(`${height}px`);
    for (const cell of row("b").cells) {
      expect(cell.classList).toContain("h-(--row-height)");
      expect(cell.classList).toContain("leading-(--row-height)");
    }
    // The drawing is three rows tall, with a dot in the middle of each row.
    expect(svg().getAttribute("height")).toBe(String(3 * height));
    expect(dotCentres()).toEqual([
      [8, height / 2],
      [8, height * 1.5],
      [8, height * 2.5]
    ]);
    // The lane runs from the first dot to the last.
    expect(paths()).toEqual([`M8,${(height / 2).toFixed(1)}L8,${(height * 2.5).toFixed(1)}`]);
  });

  it.each(DENSITIES)("bends lines within one %s row", (density, height) => {
    restore = reconfigure({ rowDensity: density, graphStyle: "rounded" });
    drawTable(BRANCHED);

    const reach = (0.8 * height).toFixed(1);
    const bend = paths().find((path) => path.includes("C"))!;
    // From the second dot, a curve whose control points reach 0.8 of a row down to the root.
    const from = height * 1.5;
    const to = height * 2.5;
    expect(bend).toBe(
      `M24,${from.toFixed(1)}C24,${(from + Number(reach)).toFixed(1)} 8,${(to - Number(reach)).toFixed(1)} 8,${to.toFixed(1)}`
    );
  });

  it("moves the rows below open details by the details' height alone", () => {
    restore = reconfigure({ rowDensity: "compact" });
    drawTable(LINE);
    act(() => {
      expandedCommit.value = "b";
    });

    expect(svg().getAttribute("height")).toBe(String(3 * 20 + 250));
    expect(dotCentres().map(([, cy]) => cy)).toEqual([10, 30, 50 + 250]);
  });

  it("redraws the open graph when the setting changes, without a reload", () => {
    drawTable(LINE);
    expect(svg().getAttribute("height")).toBe("72");

    const before = getWebviewConfig();
    restore = () => applyWebviewConfig(before);
    act(() => applyWebviewConfig({ ...before, rowDensity: "comfortable" } as WebviewConfig));

    expect(container().style.getPropertyValue("--row-height")).toBe("30px");
    expect(svg().getAttribute("height")).toBe("90");
    expect(dotCentres().map(([, cy]) => cy)).toEqual([15, 45, 75]);
  });
});

describe("scrolling to a row", () => {
  // jsdom lays nothing out, so each row reports where the table's row height puts it.
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  afterEach(() => {
    if (scrollIntoView === undefined) {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    } else {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
    }
  });

  it.each(DENSITIES)("lands on the chosen row with %s rows, beside its dot", (density, height) => {
    restore = reconfigure({ rowDensity: density });
    const commits = Array.from({ length: 40 }, (_, index) =>
      entry(`r${index}`, index < 39 ? [`r${index + 1}`] : [])
    );
    const scrolled = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrolled;
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
      this: HTMLElement
    ) {
      const index = Number(this.dataset["commitHash"]?.slice(1));
      return Number.isNaN(index) ? 0 : index * height;
    });

    pendingReveal.value = "r27";
    drawTable(commits);

    expect(scrolled).toHaveBeenCalledOnce();
    const target = scrolled.mock.contexts[0] as HTMLElement;
    expect(target).toBe(row("r27"));
    expect(document.activeElement).toBe(row("r27"));
    // The dot of the row scrolled to sits in the middle of that row.
    const [, cy] = dotCentres()[27]!;
    expect(cy).toBe(target.offsetTop + height / 2);
  });
});
