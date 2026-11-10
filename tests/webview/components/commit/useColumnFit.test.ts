// @vitest-environment jsdom
import { h, render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useColumnFit } from "@/webview/components/commit/useColumnFit";
import { setColumnShown } from "@/webview/lib/actions";
import { crowdedColumns, hiddenColumns, selectedRepo, shownColumns } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();

// Cells by index: 0 graph, 1 description, 2 date, 3 author, 4 commit ID.
const NATURAL: Record<number, number> = { 0: 60, 2: 130, 3: 90, 4: 70 };
/** The description's narrowest: its heading. */
const NARROWEST = 110;

/** The container's width, which the fake layout below divides among the cells. */
let width = 0;
let resized: () => void = () => {};

/** What a browser would give each heading: the others their own width, the description the rest. */
function cellWidth(cell: HTMLElement) {
  const shown = shownColumns.peek();
  const others = shown.reduce((sum, index) => sum + (NATURAL[index] ?? 0), 0);
  const index = Number(cell.dataset.cell);
  return index === 1 ? Math.max(NARROWEST, width - others) : (NATURAL[index] ?? 0);
}

function Table() {
  const containerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableRowElement>(null);
  useColumnFit(containerRef, headRef);
  return h(
    "div",
    { ref: containerRef, "data-container": "" },
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          { ref: headRef },
          shownColumns.value.map((cell) => h("th", { key: cell, "data-cell": cell }))
        )
      )
    )
  );
}

let container: HTMLDivElement;
beforeEach(() => {
  selectedRepo.value = "/repo";
  crowdedColumns.value = [];
  width = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.hasAttribute("data-container") ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const cells = this instanceof HTMLTableRowElement ? [...this.cells] : [this];
    const total = cells.reduce((sum, cell) => sum + cellWidth(cell), 0);
    return { width: total, height: 0, top: 0, left: 0, right: total, bottom: 0 } as DOMRect;
  });
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  crowdedColumns.value = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Give the container this width, as dragging the editor's edge would. */
function resize(to: number) {
  width = to;
  act(() => resized());
}
const mount = () => act(() => render(h(Table, null), container));
const cells = () => [...container.querySelectorAll("th")].map((cell) => Number(cell.dataset.cell));

describe("fitting the columns to the table", () => {
  it("does nothing before the table has a width", () => {
    mount();
    expect(cells()).toStrictEqual([0, 1, 2, 3, 4]);
    expect(crowdedColumns.value).toStrictEqual([]);
  });

  it("leaves out the ID, the author and the date as the table narrows, and returns them", () => {
    width = 900;
    mount();
    expect(cells()).toStrictEqual([0, 1, 2, 3, 4]);

    // 60 + 130 + 90 + 70 leave the description 190 of 540.
    resize(540);
    expect(cells()).toStrictEqual([0, 1, 2, 3]);
    resize(450);
    expect(cells()).toStrictEqual([0, 1, 2]);
    // Narrower than every column's own width: the table overflows, and the date goes as well.
    resize(300);
    expect(cells()).toStrictEqual([0, 1]);

    resize(450);
    expect(cells()).toStrictEqual([0, 1, 2]);
    resize(900);
    expect(cells()).toStrictEqual([0, 1, 2, 3, 4]);
  });

  it("fits a table that starts out narrow before it is shown", () => {
    width = 300;
    mount();
    expect(cells()).toStrictEqual([0, 1]);
  });

  it("leaves the user's choice of columns alone, and fits a new choice at once", () => {
    width = 540;
    mount();
    expect(cells()).toStrictEqual([0, 1, 2, 3]);
    expect(hiddenColumns.value).toStrictEqual([]);

    // Without the author there is room for the ID again.
    act(() => setColumnShown("author", false));
    expect(hiddenColumns.value).toStrictEqual(["author"]);
    expect(cells()).toStrictEqual([0, 1, 2, 4]);
    act(() => setColumnShown("author", true));
    expect(cells()).toStrictEqual([0, 1, 2, 3]);
  });
});
