// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import type { GitRepoState } from "@/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import type { ColumnResize } from "@/webview/components/commit/useColumnResize";
import { useColumnResize } from "@/webview/components/commit/useColumnResize";
import { receiveRepoState } from "@/webview/lib/actions";
import { columnWidths, repoStates, selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

type HarnessProps = {
  graphColumn?: number;
  cells?: number;
  attachHead?: boolean;
  attachContainer?: boolean;
};

let host: HTMLDivElement;
/** `clientWidth` of each header cell: graph, description, date, author, commit. */
let cellWidths: Array<number>;
let resize: ColumnResize;
let renders: number;

function Harness({
  graphColumn = 77,
  cells = 5,
  attachHead = true,
  attachContainer = true
}: HarnessProps) {
  renders += 1;
  resize = useColumnResize(graphColumn);
  return h(
    "div",
    attachContainer ? { ref: resize.containerRef } : {},
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          attachHead ? { ref: resize.headRef } : {},
          Array.from({ length: cells }, (_, index) => h("th", { key: index }))
        )
      )
    )
  );
}

const mount = (props: HarnessProps = {}) => act(() => render(h(Harness, props), host));
const box = () => host.firstElementChild as HTMLDivElement;
const style = () => box().getAttribute("style");
const shown = () =>
  ["--col-graph", "--col-date", "--col-author", "--col-commit"].map((name) =>
    box().style.getPropertyValue(name)
  );
const px = (...widths: Array<number>) => widths.map((width) => `${width}px`);
const stored = (repo = "/repo") => repoStates.value[repo]?.columnWidths ?? null;
const saves = () =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as { command: string; state?: Partial<GitRepoState> })
    .filter((message) => message.command === "saveRepoState");
const savedWidths = () => saves().map((message) => message.state?.columnWidths);
const listened = (spy: { mock: { calls: Array<Array<unknown>> } }) =>
  spy.mock.calls
    .map(([type]) => type)
    .filter((type) => type === "mousemove" || type === "mouseup" || type === "blur");

const press = (clientX: number, init: MouseEventInit = {}) =>
  new MouseEvent("mousedown", { cancelable: true, clientX, ...init });
const start = (boundary: number, clientX: number, init: MouseEventInit = {}) => {
  const event = press(clientX, init);
  act(() => resize.startResize(boundary, event));
  return event;
};
const move = (clientX: number, buttons = 1) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX, buttons }));
  });
const release = () =>
  act(() => {
    window.dispatchEvent(new MouseEvent("mouseup"));
  });
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key, cancelable: true, ...init });
const nudge = (boundary: number, key: string, init: KeyboardEventInit = {}) => {
  const event = keydown(key, init);
  act(() => resize.nudge(boundary, event));
  return event;
};
const save = (repo: string, widths: Array<number>) => {
  repoStates.value = { ...repoStates.value, [repo]: { columnWidths: widths } };
};

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  selectedRepo.value = "/repo";
  repoStates.value = {};
  vscodeApi.postMessage.mockClear();
  cellWidths = [150, 500, 100, 90, 80];
  renders = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this instanceof HTMLTableCellElement ? (cellWidths[this.cellIndex] ?? 0) : 0;
  });
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

describe("applying stored widths", () => {
  it("suggests only the graph width while the browser sizes the table", () => {
    mount();
    expect(style()).toBe("--col-graph: 77px;");
    expect(resize.resizing).toBe(false);
  });

  it("applies saved widths and ignores the suggested graph width", () => {
    save("/repo", [120, 90, 100, 70]);
    mount();
    expect(shown()).toEqual(px(120, 90, 100, 70));
    mount({ graphColumn: 99 });
    expect(shown()).toEqual(px(120, 90, 100, 70));
    act(() => {
      selectedRepo.value = "/other";
    });
    expect(style()).toBe("--col-graph: 99px;");
  });

  it("treats malformed widths as none and raises widths below the minimum", () => {
    save("/repo", [120, 90, 100]);
    mount();
    expect(style()).toBe("--col-graph: 77px;");
    act(() => save("/repo", [120, 90, 100, 5.5]));
    expect(shown()).toEqual(px(120, 90, 100, 40));
  });

  it("leaves the other properties of the container alone", () => {
    mount();
    box().style.setProperty("--graph-top", "32px");
    act(() => save("/repo", [120, 90, 100, 70]));
    act(() => {
      selectedRepo.value = "/other";
    });
    expect(box().style.getPropertyValue("--graph-top")).toBe("32px");
  });

  it("keeps the same refs for the life of the component", () => {
    mount();
    const { containerRef, headRef } = resize;
    mount({ graphColumn: 90 });
    act(() => {
      selectedRepo.value = "/other";
    });
    expect(resize.containerRef).toBe(containerRef);
    expect(resize.headRef).toBe(headRef);
  });
});

describe("dragging a boundary", () => {
  it("follows the pointer without rendering the table, then saves once on release", () => {
    mount();
    const event = start(0, 200);
    expect(event.defaultPrevented).toBe(true);
    expect(resize.resizing).toBe(true);
    // Nothing changes before the pointer moves.
    expect(style()).toBe("--col-graph: 77px;");
    expect(repoStates.value).toEqual({});

    move(230);
    expect(shown()).toEqual(px(180, 100, 90, 80));
    // The first change fixes the table layout, in memory only.
    expect(stored()).toEqual([180, 100, 90, 80]);
    const before = renders;
    const states = repoStates.value;
    move(-500);
    expect(shown()).toEqual(px(40, 100, 90, 80));
    move(50);
    expect(shown()).toEqual(px(40, 100, 90, 80));
    move(100);
    expect(shown()).toEqual(px(50, 100, 90, 80));
    expect(renders).toBe(before);
    expect(repoStates.value).toBe(states);
    expect(saves()).toEqual([]);

    const removed = vi.spyOn(window, "removeEventListener");
    release();
    expect(resize.resizing).toBe(false);
    expect(saves()).toEqual([
      { command: "saveRepoState", repo: "/repo", state: { columnWidths: [50, 100, 90, 80] } }
    ]);
    expect(listened(removed).toSorted()).toEqual(["blur", "mousemove", "mouseup"]);
    move(300);
    release();
    expect(saves()).toHaveLength(1);
    expect(shown()).toEqual(px(50, 100, 90, 80));
  });

  it("ends the drag when the window loses focus", () => {
    mount();
    start(1, 10);
    move(30);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(resize.resizing).toBe(false);
    expect(savedWidths()).toEqual([[150, 80, 90, 80]]);
  });

  it("leaves the table as it was after a click", () => {
    mount();
    start(1, 10);
    release();
    expect(resize.resizing).toBe(false);
    expect(saves()).toEqual([]);
    expect(repoStates.value).toEqual({});
    expect(style()).toBe("--col-graph: 77px;");
  });

  it("saves nothing when the pointer returns to where it started", () => {
    mount();
    start(0, 10);
    move(40);
    expect(stored()).toEqual([180, 100, 90, 80]);
    move(10);
    release();
    expect(saves()).toEqual([]);
    expect(columnWidths.value).toBeNull();
    expect(style()).toBe("--col-graph: 77px;");
  });

  it("stores whole pixels and raises narrow measured columns to the minimum", () => {
    cellWidths = [10, 500, 30, 90, 0];
    mount();
    start(2, 10.5);
    move(13.25);
    expect(shown()).toEqual(px(40, 43, 87, 40));
    release();
    expect(savedWidths()).toEqual([[40, 43, 87, 40]]);
  });

  it("starts from the saved widths rather than the measured ones", () => {
    save("/repo", [111, 122, 133, 144]);
    cellWidths = [999, 500, 999, 999, 999];
    mount();
    start(3, 10);
    move(20);
    expect(shown()).toEqual(px(111, 122, 143, 134));
    release();
    expect(savedWidths()).toEqual([[111, 122, 143, 134]]);
  });

  it("measures the description on every move and never moves against the pointer", () => {
    cellWidths = [150, 100, 100, 90, 80];
    mount();
    start(0, 0);
    move(100);
    expect(shown()[0]).toBe("186px");
    // The description is now under its minimum, yet the graph column does not shrink.
    cellWidths = [150, 50, 100, 90, 80];
    move(200);
    expect(shown()[0]).toBe("186px");
    release();
    expect(savedWidths()).toEqual([[186, 100, 90, 80]]);
  });

  it("changes nothing where the limits only allow moving against the pointer", () => {
    save("/repo", [100, 120, 120, 90]);
    cellWidths = [100, 50, 120, 120, 90];
    mount();
    start(0, 10);
    move(30);
    expect(shown()).toEqual(px(100, 120, 120, 90));
    release();
    expect(saves()).toEqual([]);
  });

  it("moves nothing and saves nothing for an unknown boundary", () => {
    mount();
    const event = start(7, 10);
    expect(event.defaultPrevented).toBe(true);
    expect(resize.resizing).toBe(true);
    move(60);
    expect(style()).toBe("--col-graph: 77px;");
    release();
    expect(saves()).toEqual([]);
    expect(repoStates.value).toEqual({});
  });

  it("starts only for the primary button", () => {
    mount();
    const added = vi.spyOn(window, "addEventListener");
    for (const button of [1, 2]) {
      const event = start(0, 10, { button });
      expect(event.defaultPrevented).toBe(false);
      expect(resize.resizing).toBe(false);
    }
    expect(listened(added)).toEqual([]);
    move(30);
    release();
    expect(style()).toBe("--col-graph: 77px;");
    expect(saves()).toEqual([]);
  });

  it("ignores a press while a drag is active and leaves no listener behind", () => {
    mount();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    start(0, 10);
    const second = start(2, 10);
    expect(second.defaultPrevented).toBe(false);
    move(30);
    expect(shown()).toEqual(px(170, 100, 90, 80));
    release();
    expect(savedWidths()).toEqual([[170, 100, 90, 80]]);
    expect(listened(added)).toHaveLength(3);
    expect(listened(removed).toSorted()).toEqual(listened(added).toSorted());
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
      window.dispatchEvent(new Event("blur"));
    });
    expect(saves()).toHaveLength(1);
  });

  it("ends a drag whose release happened where the webview could not see it", () => {
    mount();
    start(0, 10);
    move(30);
    expect(resize.resizing).toBe(true);
    // A move without the primary button takes the boundary there and ends the drag.
    move(40, 0);
    expect(shown()).toEqual(px(180, 100, 90, 80));
    expect(resize.resizing).toBe(false);
    expect(savedWidths()).toEqual([[180, 100, 90, 80]]);
    move(60);
    release();
    expect(shown()).toEqual(px(180, 100, 90, 80));
    expect(saves()).toHaveLength(1);
  });

  it("keeps the drag's widths on screen when the table renders again", () => {
    mount();
    start(0, 10);
    move(40);
    mount({ graphColumn: 120 });
    expect(shown()).toEqual(px(180, 100, 90, 80));
    act(() =>
      receiveRepoState({
        command: "repoState",
        repo: "/repo",
        state: { columnWidths: [60, 60, 60, 60] }
      })
    );
    expect(shown()).toEqual(px(180, 100, 90, 80));
    move(41);
    expect(shown()).toEqual(px(181, 100, 90, 80));
    release();
    expect(savedWidths()).toEqual([[181, 100, 90, 80]]);
  });

  it("keeps moves handled before the render that follows the press", async () => {
    mount();
    resize.startResize(0, press(10));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, buttons: 1 }));
    expect(shown()).toEqual(px(180, 100, 90, 80));
    await new Promise((resolve) => setTimeout(resolve));
    expect(resize.resizing).toBe(true);
    expect(shown()).toEqual(px(180, 100, 90, 80));
    release();
    expect(savedWidths()).toEqual([[180, 100, 90, 80]]);
  });

  it("ignores arrow keys during a drag", () => {
    mount();
    start(0, 10);
    move(30);
    const event = nudge(2, "ArrowRight");
    expect(event.defaultPrevented).toBe(false);
    expect(saves()).toEqual([]);
    release();
    expect(savedWidths()).toEqual([[170, 100, 90, 80]]);
  });

  it("cancels the drag when another repository is selected", () => {
    save("/repo", [111, 122, 133, 144]);
    save("/b", [50, 50, 50, 50]);
    const repoWidths = stored("/repo");
    mount();
    start(0, 10);
    move(20);
    expect(shown()).toEqual(px(121, 122, 133, 144));
    const removed = vi.spyOn(window, "removeEventListener");
    act(() => {
      selectedRepo.value = "/b";
    });
    expect(resize.resizing).toBe(false);
    expect(shown()).toEqual(px(50, 50, 50, 50));
    expect(listened(removed).toSorted()).toEqual(["blur", "mousemove", "mouseup"]);
    move(60);
    release();
    expect(saves()).toEqual([]);
    expect(stored("/repo")).toBe(repoWidths);
    expect(stored("/b")).toEqual([50, 50, 50, 50]);
  });

  it("puts back the widths of the repository a cancelled drag started in", () => {
    mount();
    start(0, 10);
    move(30);
    expect(stored()).toEqual([170, 100, 90, 80]);
    act(() => {
      selectedRepo.value = "/other";
    });
    expect(stored()).toBeNull();
    expect(style()).toBe("--col-graph: 77px;");
    act(() => {
      selectedRepo.value = "/repo";
    });
    expect(style()).toBe("--col-graph: 77px;");
    expect(saves()).toEqual([]);
  });

  it("saves nothing when the repository changes just before the release", () => {
    mount();
    start(0, 10);
    move(30);
    act(() => {
      selectedRepo.value = "/b";
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(saves()).toEqual([]);
    expect(stored("/b")).toBeNull();
    expect(stored()).toBeNull();
  });

  it("does nothing without a selected repository", () => {
    selectedRepo.value = undefined;
    mount();
    const added = vi.spyOn(window, "addEventListener");
    expect(start(0, 10).defaultPrevented).toBe(false);
    expect(resize.resizing).toBe(false);
    move(30);
    release();
    expect(nudge(0, "ArrowLeft").defaultPrevented).toBe(false);
    expect(listened(added)).toEqual([]);
    expect(style()).toBe("--col-graph: 77px;");
    expect(repoStates.value).toEqual({});
    expect(saves()).toEqual([]);
  });

  it("discards the drag when the table unmounts", () => {
    mount();
    start(0, 10);
    move(30);
    expect(stored()).toEqual([170, 100, 90, 80]);
    const removed = vi.spyOn(window, "removeEventListener");
    act(() => render(null, host));
    expect(listened(removed).toSorted()).toEqual(["blur", "mousemove", "mouseup"]);
    expect(stored()).toBeNull();
    release();
    expect(saves()).toEqual([]);
  });

  it("keeps saved widths when the table unmounts during a drag", () => {
    save("/repo", [111, 122, 133, 144]);
    const widths = stored();
    mount();
    start(0, 10);
    move(30);
    act(() => render(null, host));
    expect(stored()).toBe(widths);
    expect(saves()).toEqual([]);
  });

  it("does nothing before the header row is attached", () => {
    mount({ attachHead: false });
    const added = vi.spyOn(window, "addEventListener");
    expect(start(0, 10).defaultPrevented).toBe(false);
    expect(nudge(0, "ArrowLeft").defaultPrevented).toBe(false);
    expect(listened(added)).toEqual([]);
    expect(resize.resizing).toBe(false);
    expect(saves()).toEqual([]);
  });

  it("still resizes without a container to write to", () => {
    cellWidths = [100, 100, 100, 100, 100];
    mount({ attachContainer: false });
    start(0, 0);
    move(20);
    release();
    expect(savedWidths()).toEqual([[120, 100, 100, 100]]);
  });

  it("throws when the header lacks the cells it measures", () => {
    mount({ cells: 3 });
    const added = vi.spyOn(window, "addEventListener");
    expect(() => resize.startResize(0, press(10))).toThrow(Error);
    expect(() => resize.nudge(0, keydown("ArrowLeft"))).toThrow(Error);
    expect(listened(added)).toEqual([]);
  });
});

describe("moving a boundary with the keyboard", () => {
  beforeEach(() => {
    cellWidths = [100, 400, 120, 120, 90];
  });

  it("moves a boundary 8 pixels per arrow key and saves each press", () => {
    save("/repo", [100, 120, 120, 90]);
    mount();
    const event = keydown("ArrowRight");
    act(() => {
      resize.nudge(0, event);
      // The widths reach the container with the next render.
      expect(shown()).toEqual(px(100, 120, 120, 90));
    });
    expect(event.defaultPrevented).toBe(true);
    expect(stored()).toEqual([108, 120, 120, 90]);
    expect(shown()).toEqual(px(108, 120, 120, 90));
    expect(nudge(3, "ArrowLeft", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(stored()).toEqual([108, 120, 112, 98]);
    nudge(1, "ArrowRight");
    expect(stored()).toEqual([108, 112, 112, 98]);
    nudge(2, "ArrowRight");
    expect(stored()).toEqual([108, 120, 104, 98]);
    expect(savedWidths()).toEqual([
      [108, 120, 120, 90],
      [108, 120, 112, 98],
      [108, 112, 112, 98],
      [108, 120, 104, 98]
    ]);
    expect(resize.resizing).toBe(false);
  });

  it("ignores other keys", () => {
    save("/repo", [100, 120, 120, 90]);
    mount();
    for (const key of ["a", "ArrowUp", "Left", "Right", "Home"]) {
      expect(nudge(0, key).defaultPrevented).toBe(false);
    }
    expect(saves()).toEqual([]);
  });

  it("saves nothing when a key changes no width, but still keeps the page from scrolling", () => {
    save("/repo", [40, 120, 120, 90]);
    const widths = stored();
    mount();
    expect(nudge(0, "ArrowLeft").defaultPrevented).toBe(true);
    expect(nudge(-1, "ArrowLeft").defaultPrevented).toBe(true);
    expect(saves()).toEqual([]);
    expect(stored()).toBe(widths);
  });

  it("raises saved widths below the minimum before moving them", () => {
    save("/repo", [10, 120, 120, 90]);
    mount();
    nudge(0, "ArrowLeft");
    expect(saves()).toEqual([]);
    nudge(0, "ArrowRight");
    expect(savedWidths()).toEqual([[48, 120, 120, 90]]);
  });

  it("never moves a boundary against the key", () => {
    save("/repo", [100, 120, 120, 90]);
    cellWidths = [100, 50, 120, 120, 90];
    mount();
    nudge(0, "ArrowRight");
    nudge(1, "ArrowLeft");
    expect(saves()).toEqual([]);
    // Moving the way the key asks may go further, to give the description its minimum back.
    nudge(0, "ArrowLeft");
    expect(savedWidths()).toEqual([[86, 120, 120, 90]]);
  });

  it("stops at the description's minimum", () => {
    save("/repo", [300, 120, 120, 90]);
    cellWidths = [300, 70, 120, 120, 90];
    mount();
    nudge(0, "ArrowRight");
    expect(savedWidths()).toEqual([[306, 120, 120, 90]]);
  });

  it("starts from the measured widths when none are saved", () => {
    cellWidths = [150, 500, 100, 90, 80];
    mount();
    nudge(2, "ArrowLeft");
    expect(savedWidths()).toEqual([[150, 92, 98, 80]]);
    expect(shown()).toEqual(px(150, 92, 98, 80));
  });

  it("saves whole pixels", () => {
    save("/repo", [120.4, 90, 100, 70.6]);
    mount();
    nudge(0, "ArrowRight");
    expect(savedWidths()).toEqual([[128, 90, 100, 71]]);
  });
});

describe("in the commit table", () => {
  const commits: HistoryEntry[] = Array.from({ length: 14 }, (_, index) => ({
    hash: `commit${index}`,
    parentHashes: index < 13 ? ["commit13"] : [],
    author: "Author",
    email: "a@test",
    date: 0,
    message: `Commit ${index}`,
    refs: []
  }));
  const table = () => host.querySelector("table")!;
  const headRow = () => host.querySelector("thead tr")!;
  const handle = (selector: string) => host.querySelector<HTMLElement>(`thead ${selector}`)!;

  beforeEach(() => {
    cellWidths = [120, 600, 110, 100, 90];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width: 120, height: 32 }) as DOMRect
    );
    act(() => render(h(CommitTable, { commits, head: null, headBranch: null }), host));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fixes the layout from the first move and marks the header while dragging", () => {
    expect(shown()).toEqual(["224px", "", "", ""]);
    expect(table().classList.contains("table-fixed")).toBe(false);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 120 });
    act(() => {
      handle("th:first-child [role=separator]").dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(headRow().className).toBe("cursor-col-resize");
    expect(table().classList.contains("table-fixed")).toBe(false);
    move(60);
    expect(table().classList.contains("table-fixed")).toBe(true);
    expect(shown()).toEqual(px(60, 110, 100, 90));
    expect(saves()).toEqual([]);
    release();
    expect(headRow().className).toBe("");
    expect(savedWidths()).toEqual([[60, 110, 100, 90]]);
  });

  it("follows a drag dispatched in one go, as the VS Code tests do", () => {
    act(() => {
      handle("th:first-child [role=separator]").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, clientX: 120 })
      );
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 60 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(savedWidths()).toEqual([[60, 110, 100, 90]]);
    expect(shown()).toEqual(px(60, 110, 100, 90));
    expect(table().classList.contains("table-fixed")).toBe(true);
  });

  it("moves the boundary of a focused handle with the arrow keys", () => {
    const event = keydown("ArrowLeft", { bubbles: true });
    act(() => {
      handle('th:nth-child(2) [role=separator][tabindex="0"]').dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(shown()).toEqual(px(112, 110, 100, 90));
    act(() => {
      handle('th:nth-child(4) [role=separator][tabindex="0"]').dispatchEvent(
        keydown("ArrowRight", { bubbles: true })
      );
    });
    expect(shown()).toEqual(px(112, 118, 92, 90));
    expect(savedWidths()).toEqual([
      [112, 110, 100, 90],
      [112, 118, 92, 90]
    ]);
  });
});
