// @vitest-environment jsdom
import { Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRepoState, OptionalColumn } from "@/types";
import { columnMenu, COLUMNS_MENU } from "@/webview/components/commit/column-choice";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { ContextMenu } from "@/webview/components/ui/ContextMenu";
import { setColumnShown, setHiddenColumns } from "@/webview/lib/actions";
import {
  commitDetails,
  contextMenu,
  expandedCommit,
  hiddenColumns,
  repoStates,
  selectedRepo,
  shownColumns,
  uncommittedChanges
} from "@/webview/lib/stores";

import {
  attachHost,
  entry,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;

const COMMITS = [entry("b", ["a"], { author: "Ann Lee" }), entry("a")];

function drawTable() {
  act(() =>
    render(
      h(
        Fragment,
        null,
        h(CommitTable, { commits: COMMITS, head: null, headBranch: null }),
        h(ContextMenu, {})
      ),
      host
    )
  );
}

const headings = () =>
  [...host.querySelectorAll<HTMLTableCellElement>("thead th")].map((cell) => cell.textContent);
const cellsOf = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tbody tr[data-commit-hash="${hash}"]`)!.cells;
const colWidths = () =>
  [...host.querySelectorAll("colgroup col")].map((col) => col.getAttribute("style"));
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] > [role]')];
const saved = () =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as { command: string; state?: Partial<GitRepoState> })
    .filter((message) => message.command === "saveRepoState")
    .map((message) => message.state);

/** Right-click the table's headings, as the user does to choose the columns. */
function openHeadingMenu() {
  const heading = host.querySelector("thead th")!;
  act(() => {
    heading.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 10 })
    );
  });
}

function choose(title: string) {
  const item = menuItems().find((candidate) => candidate.textContent === title);
  expect(item, `menu entry ${title}`).toBeDefined();
  act(() => item!.click());
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak({ graph: "Graph", description: "Message", date: "Date", author: "Author", commit: "ID" });
  stubResizeObserver();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  selectedRepo.value = "/repo";
  repoStates.value = {};
  expandedCommit.value = null;
  commitDetails.value = null;
  contextMenu.value = null;
  uncommittedChanges.value = 0;
  vscodeApi.postMessage.mockClear();
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  contextMenu.value = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the column headings' menu", () => {
  it("lists the optional columns as checked entries, without the graph or the message", () => {
    drawTable();
    openHeadingMenu();

    expect(contextMenu.value?.source).toBe(COLUMNS_MENU);
    expect(menuItems().map((item) => [item.getAttribute("role"), item.textContent])).toEqual([
      ["menuitemcheckbox", "Date"],
      ["menuitemcheckbox", "Author"],
      ["menuitemcheckbox", "ID"]
    ]);
    expect(menuItems().map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "true",
      "true"
    ]);
  });

  it("hides a column, gives its room to the message, and keeps the choice", () => {
    repoStates.value = { "/repo": { columnWidths: [100, 140, 120, 70] } };
    drawTable();
    openHeadingMenu();
    choose("Author");

    expect(headings()).toEqual(["Graph", "Message", "Date", "ID"]);
    expect(cellsOf("b")).toHaveLength(4);
    expect([...cellsOf("b")].some((cell) => cell.textContent?.includes("Ann Lee"))).toBe(false);
    // The message's <col> has no width, so it takes what the author column left.
    expect(colWidths()).toEqual([
      "width: var(--col-graph);",
      null,
      "width: var(--col-date);",
      "width: var(--col-commit);"
    ]);
    expect(saved()).toEqual([{ hiddenColumns: ["author"] }]);
    expect(repoStates.value["/repo"]).toEqual({
      columnWidths: [100, 140, 120, 70],
      hiddenColumns: ["author"]
    });

    // The menu now shows it unchecked; choosing it again brings it back at its old width.
    openHeadingMenu();
    expect(menuItems().map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "true"
    ]);
    choose("Author");
    expect(headings()).toEqual(["Graph", "Message", "Date", "Author", "ID"]);
    expect(colWidths()).toContain("width: var(--col-author);");
    expect(host.firstElementChild!.getAttribute("style")).toContain("--col-author: 120px");
    expect(saved()).toEqual([{ hiddenColumns: ["author"] }, { hiddenColumns: [] }]);
  });

  it("leaves the row's spoken summary whole: hiding a column only makes room on screen", () => {
    drawTable();
    const label = () =>
      host.querySelector('tbody tr[data-commit-hash="b"]')!.getAttribute("aria-label");
    const whole = label();
    expect(whole).toContain("Ann Lee");

    act(() => setHiddenColumns(["date", "author", "commit"]));
    expect(label()).toBe(whole);
  });

  it("keeps the resize handles between the columns that show", () => {
    drawTable();
    act(() => setHiddenColumns(["date"]));

    const grips = [...host.querySelectorAll("thead th")].map((cell) =>
      [...cell.querySelectorAll("[role=separator]")].map((grip) => grip.getAttribute("aria-label"))
    );
    // Each boundary is named after the column on its left; the message now meets the author.
    expect(grips).toEqual([
      ["resizeColumn"],
      ["resizeColumn", "resizeColumn"],
      ["resizeColumn", "resizeColumn"],
      ["resizeColumn"]
    ]);
  });

  it("stretches open details across the columns that show", () => {
    drawTable();
    act(() => setHiddenColumns(["date", "commit"]));
    act(() => {
      expandedCommit.value = "b";
    });

    const details = host.querySelector<HTMLTableRowElement>("[data-details-row]")!;
    expect([...details.cells].map((cell) => cell.colSpan)).toEqual([1, 2]);
  });
});

describe("the graph and the message", () => {
  it("cannot be hidden, whatever is asked or stored", () => {
    drawTable();
    act(() => setHiddenColumns(["graph", "description"] as unknown as Array<OptionalColumn>));
    expect(saved()).toEqual([]);
    expect(headings()).toEqual(["Graph", "Message", "Date", "Author", "ID"]);

    // A damaged record names columns that cannot be hidden, and some twice.
    act(() => {
      repoStates.value = {
        "/repo": {
          columnWidths: null,
          hiddenColumns: ["description", "author", 0, "graph", "author", "toString"]
        } as unknown as GitRepoState
      };
    });
    expect(hiddenColumns.value).toEqual(["author"]);
    expect(shownColumns.value).toEqual([0, 1, 2, 4]);
    expect(headings()).toEqual(["Graph", "Message", "Date", "ID"]);
  });

  it("stay even with every optional column hidden", () => {
    drawTable();
    act(() => {
      setColumnShown("date", false);
      setColumnShown("author", false);
      setColumnShown("commit", false);
    });

    expect(headings()).toEqual(["Graph", "Message"]);
    expect(cellsOf("a")).toHaveLength(2);
    expect(columnMenu().map((item) => item && [item.title, item.checked])).toEqual([
      ["Date", false],
      ["Author", false],
      ["ID", false]
    ]);
  });
});

describe("the choice", () => {
  it("belongs to the repository it was made in", () => {
    drawTable();
    act(() => setHiddenColumns(["commit"]));
    expect(headings()).toEqual(["Graph", "Message", "Date", "Author"]);

    act(() => {
      selectedRepo.value = "/other";
    });
    expect(headings()).toEqual(["Graph", "Message", "Date", "Author", "ID"]);

    act(() => {
      selectedRepo.value = "/repo";
    });
    expect(headings()).toEqual(["Graph", "Message", "Date", "Author"]);
  });

  it("is saved only when it changes, in table order", () => {
    drawTable();
    act(() => setHiddenColumns(["commit", "date"]));
    act(() => setHiddenColumns(["date", "commit"]));
    expect(saved()).toEqual([{ hiddenColumns: ["date", "commit"] }]);
  });

  it("gives every unchanged choice the same arrays, so rows are not redrawn", () => {
    drawTable();
    const shown = shownColumns.value;
    act(() => {
      repoStates.value = { "/repo": { columnWidths: [90, 90, 90, 90] } };
    });
    expect(shownColumns.value).toBe(shown);
  });
});
