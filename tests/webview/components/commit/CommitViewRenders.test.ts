// @vitest-environment jsdom
// How much of the commit view renders again for each kind of change. A row calls
// `getCommitDate` once per render and the graph calls `branchStrokes` once per branch each time
// it builds its paths, so counting those calls counts the work.
import { batch } from "@preact/signals";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { branchStrokes } from "@/webview/graph/strokes";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { contextMenu, dialog, expandedCommit, selectedRepo } from "@/webview/lib/stores";
import { getCommitDate } from "@/webview/utils/date";

import {
  attachHost,
  entry,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/utils/date", async (original) => {
  const actual = await original<typeof import("@/webview/utils/date")>();
  return { ...actual, getCommitDate: vi.fn(actual.getCommitDate) };
});
vi.mock("@/webview/graph/strokes", async (original) => {
  const actual = await original<typeof import("@/webview/graph/strokes")>();
  return { ...actual, branchStrokes: vi.fn(actual.branchStrokes) };
});

/** Twenty commits in two interleaved lines, each dated by its position so a render names its row. */
const ROWS: Array<HistoryEntry> = Array.from({ length: 20 }, (_, index) =>
  entry(`r${index}`, index < 18 ? [`r${index + 2}`] : [], { date: 1_000 + index })
);
const FOCUS = {
  direct: ROWS.filter((_row, index) => index % 2 === 0).map((row) => row.hash),
  merged: []
};

const rowDates = vi.mocked(getCommitDate);
const strokes = vi.mocked(branchStrokes);
let host: HTMLDivElement;

/** Rows that rendered since the last check, by index. */
function renderedRows() {
  const rows = rowDates.mock.calls.map(([date]) => date - 1_000);
  rowDates.mockClear();
  return rows;
}

function pathsRebuilt() {
  const built = strokes.mock.calls.length > 0;
  strokes.mockClear();
  return built;
}

function drawTable(commits = ROWS, focus: typeof FOCUS | null = FOCUS) {
  act(() => render(h(CommitTable, { commits, head: "r0", headBranch: null, focus }), host));
}

const row = (index: number) => host.querySelectorAll<HTMLTableRowElement>("tbody tr")[index]!;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak();
  stubResizeObserver();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  selectedRepo.value = "/repo";
  contextMenu.value = null;
  dialog.value = null;
  expandedCommit.value = null;
  focusedCommit.value = null;
  selectedCommits.value = [];
  host = attachHost();
  drawTable();
  renderedRows();
  pathsRebuilt();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  contextMenu.value = null;
  dialog.value = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renders only the row whose menu opens or closes", () => {
  act(() => {
    contextMenu.value = { x: 0, y: 0, entries: [], source: "commit:r7" };
  });
  expect(renderedRows()).toEqual([7]);

  // The menu hands over to a form dialog of the same row in one step, as `showDialog` does:
  // nothing to show differently.
  act(() =>
    batch(() => {
      contextMenu.value = null;
      dialog.value = {
        kind: "form",
        message: "",
        inputs: [],
        action: "",
        onSubmit: () => {},
        source: "commit:r7",
        token: 1
      };
    })
  );
  expect(renderedRows()).toEqual([]);

  act(() => {
    dialog.value = null;
    contextMenu.value = { x: 0, y: 0, entries: [], source: "ref:head:main" };
  });
  expect(renderedRows()).toEqual([7]);

  act(() => {
    contextMenu.value = null;
  });
  expect(renderedRows()).toEqual([]);
  expect(pathsRebuilt()).toBe(false);
});

it("renders no row and keeps the paths while the pointer moves over rows", () => {
  const fill = (index: number) =>
    host.querySelectorAll("[data-graph-viewport] circle")[index]!.getAttribute("fill");
  const dimmed = fill(5);

  for (const index of [5, 6, 5, 11]) {
    act(() => {
      row(index).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  }
  expect(fill(11)).not.toBe(dimmed);
  expect(fill(5)).toBe(dimmed);

  act(() => {
    host.querySelector("table")!.dispatchEvent(new MouseEvent("mouseleave"));
  });
  expect(renderedRows()).toEqual([]);
  expect(pathsRebuilt()).toBe(false);
});

it("builds the paths again only when they can change", () => {
  act(() => {
    selectedCommits.value = [ROWS[3]!];
    focusedCommit.value = "r3";
  });
  expect(pathsRebuilt()).toBe(false);

  drawTable();
  expect(pathsRebuilt()).toBe(false);

  act(() => {
    expandedCommit.value = "r3";
  });
  expect(pathsRebuilt()).toBe(true);

  drawTable(ROWS, { direct: ["r1"], merged: [] });
  expect(pathsRebuilt()).toBe(true);

  drawTable(structuredClone(ROWS), { direct: ["r1"], merged: [] });
  expect(pathsRebuilt()).toBe(true);
});
