// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { focusedCommit, pendingReveal, selectedCommits } from "@/webview/lib/navigation";
import {
  commitDetails,
  contextMenu,
  dialog,
  expandedCommit,
  repoStates,
  selectedRepo,
  uncommittedChanges
} from "@/webview/lib/stores";
import type { FocusDimming } from "@/webview/types";

import {
  attachHost,
  entry,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

const GREY = "var(--vscode-descriptionForeground, #808080)";
const STRONG_GREY = `color-mix(in srgb, ${GREY} 45%, var(--vscode-editor-background))`;
/** A dot in full colour when no palette is configured. */
const FULL = "var(--vscode-focusBorder)";

type TableProps = {
  commits: Array<HistoryEntry>;
  head?: string | null;
  headBranch?: string | null;
  focus?: { direct: Array<string>; merged: Array<string> } | null;
  keepMergedBright?: boolean;
  dimming?: FocusDimming;
};

let host: HTMLDivElement;

function drawTable({ commits, head = null, headBranch = null, ...rest }: TableProps) {
  act(() => render(h(CommitTable, { commits, head, headBranch, ...rest }), host));
}

/** `count` commits grown from one root, which the graph draws in `count` lanes. */
function fan(count: number) {
  const children = Array.from({ length: count }, (_, index) => entry(`tip${index}`, ["root"]));
  return [...children, entry("root")];
}

const outer = () => host.firstElementChild as HTMLDivElement;
const tableRows = () => [...host.querySelectorAll<HTMLTableRowElement>("tbody > tr")];
const row = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tbody tr[data-commit-hash="${hash}"]`)!;
const graphDots = () => [...host.querySelectorAll("[data-graph-viewport] circle")];
const fillOf = (index: number) => graphDots()[index]!.getAttribute("fill");
const hover = (target: Element) =>
  act(() => {
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak();
  stubResizeObserver();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  selectedRepo.value = "/repo";
  repoStates.value = {};
  expandedCommit.value = null;
  commitDetails.value = null;
  focusedCommit.value = null;
  selectedCommits.value = [];
  contextMenu.value = null;
  dialog.value = null;
  uncommittedChanges.value = 2;
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  contextMenu.value = null;
  dialog.value = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("layout", () => {
  it("suggests a graph column between 64 and 240 pixels wide", () => {
    const suggested = () => outer().style.getPropertyValue("--col-graph");

    drawTable({ commits: [entry("a", ["b"]), entry("b")] });
    expect(suggested()).toBe("64px");
    drawTable({ commits: fan(20) });
    expect(suggested()).toBe("240px");
    // 8 + 11 × 16 + 8 for twelve lanes, and 16 to spare.
    drawTable({ commits: fan(12) });
    expect(suggested()).toBe("208px");
  });

  it("draws the header and an empty graph for an empty history", () => {
    drawTable({ commits: [] });

    expect(outer().style.getPropertyValue("--col-graph")).toBe("64px");
    const svg = host.querySelector("svg[aria-hidden]")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["0", "0"]);
    expect(svg.childNodes).toHaveLength(0);
    expect(host.querySelector("tbody")!.children).toHaveLength(0);
    expect(host.querySelectorAll("thead th")).toHaveLength(5);
  });

  it("puts the clipped graph before the table and names each part", () => {
    speak({
      graph: "Graph",
      description: "Message",
      date: "Date",
      author: "Author",
      commit: "ID",
      resizeColumn: "Resize {0} column"
    });
    const rows = [
      entry("*", ["a"]),
      entry("a", ["b"], { refs: [{ hash: "a", name: "main", type: "head" }] }),
      entry("b")
    ];
    drawTable({ commits: rows, head: "a", headBranch: "main" });

    const viewport = outer().firstElementChild as HTMLElement;
    expect(viewport.getAttribute("data-graph-viewport")).toBe("true");
    expect(viewport.style.getPropertyValue("width")).toBe("var(--graph-viewport-width, 0px)");
    expect(viewport.style.getPropertyValue("top")).toBe("var(--graph-top, 32px)");
    expect((viewport.firstElementChild as HTMLElement).style.width).toBe("32px");
    const svg = viewport.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["16", "72"]);
    expect(viewport.nextElementSibling?.tagName).toBe("TABLE");

    const table = host.querySelector("table")!;
    expect(table.getAttribute("aria-label")).toBe("graphKeyboardHint");
    expect(table.classList.contains("table-fixed")).toBe(false);
    expect(
      [...table.querySelectorAll("col")].map((col) => col.style.getPropertyValue("width"))
    ).toEqual([
      "var(--col-graph)",
      "",
      "var(--col-date)",
      "var(--col-author)",
      "var(--col-commit)"
    ]);
    expect(table.tHead!.style.getPropertyValue("top")).toBe("var(--main-header-height, 0px)");
    const header = table.tHead!.rows[0]!;
    expect(header.className).toBe("");
    expect([...header.cells].map((cell) => cell.textContent)).toEqual([
      "Graph",
      "Message",
      "Date",
      "Author",
      "ID"
    ]);
    const grips = [...header.querySelectorAll<HTMLElement>('[role="separator"]')].map(
      (grip) =>
        `${(grip.parentElement as HTMLTableCellElement).cellIndex}:${grip.getAttribute("aria-label")}:${grip.getAttribute("tabindex") ?? "none"}`
    );
    expect(grips).toEqual([
      "0:Resize Graph column:none",
      "1:Resize Graph column:0",
      "1:Resize Message column:none",
      "2:Resize Message column:0",
      "2:Resize Date column:none",
      "3:Resize Date column:0",
      "3:Resize Author column:none",
      "4:Resize Author column:0"
    ]);
    for (const grip of header.querySelectorAll('[role="separator"]')) {
      expect(grip.getAttribute("aria-orientation")).toBe("vertical");
    }
    const scroll = header.cells[0]!.querySelector<HTMLElement>("[data-graph-scroll]")!;
    expect(scroll.getAttribute("role")).toBe("region");
    expect(scroll.getAttribute("aria-label")).toBe("scrollGraphHorizontally");
    expect(scroll.classList.contains("graph-scrollbar")).toBe(true);
    expect((scroll.firstElementChild as HTMLElement).style.width).toBe("32px");

    expect(tableRows().map((tr) => [tr.dataset["commitHash"], tr.tabIndex])).toEqual([
      ["*", 0],
      ["a", -1],
      ["b", -1]
    ]);
    expect(row("*").textContent).toContain("uncommittedChanges");
    expect(row("a").querySelector("b")?.textContent).toBe("subject of a");
    const label = row("a").querySelector<HTMLElement>('span[title^="main"]');
    expect(label?.title).toBe("main\ntooltipCurrentBranch");
    // The head marker comes first in the description.
    expect(row("a").cells[1]!.firstElementChild!.firstElementChild!.childNodes).toHaveLength(0);
    expect(row("b").querySelector("b")).toBeNull();
  });

  it("keeps the same row elements when a refresh brings the same commits", () => {
    const rows = fan(6);
    drawTable({ commits: rows });
    act(() => {
      expandedCommit.value = "tip3";
    });
    const before = tableRows();

    drawTable({ commits: structuredClone(rows) });

    expect(tableRows()).toHaveLength(before.length);
    tableRows().forEach((tr, index) => expect(tr).toBe(before[index]));
  });
});

describe("the reveal button", () => {
  const button = () =>
    host.querySelector<HTMLButtonElement>('thead button[aria-label="revealSelectedLane"]');

  it("reveals only a commit that is loaded, while the graph overflows", () => {
    drawTable({ commits: fan(4) });
    expect(button()?.disabled).toBe(true);
    expect(button()?.title).toBe("revealSelectedLane");
    expect(host.querySelector("[data-graph-scroll]")!.getAttribute("tabindex")).toBe("0");

    act(() => {
      focusedCommit.value = "tip2";
    });
    expect(button()?.disabled).toBe(false);
    act(() => {
      focusedCommit.value = "elsewhere";
    });
    expect(button()?.disabled).toBe(true);
  });

  it("is absent while the whole graph fits", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 500,
      height: 32
    } as DOMRect);
    drawTable({ commits: fan(4) });

    expect(button()).toBeNull();
    const scroll = host.querySelector("[data-graph-scroll]")!;
    expect(scroll.hasAttribute("tabindex")).toBe(false);
    expect(scroll.classList.contains("invisible")).toBe(true);
  });
});

describe("a commit chosen in Go to", () => {
  // jsdom does not scroll, so each test puts a recorder in place of the method.
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  afterEach(() => {
    pendingReveal.value = null;
    if (scrollIntoView === undefined) {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    } else {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
    }
  });

  it("is centred, focused and selected once its row is drawn", () => {
    const scrolled = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrolled;
    const commits = [entry("c"), entry("b", ["a"]), entry("a")];
    pendingReveal.value = "b";
    drawTable({ commits });
    expect(document.activeElement).toBe(row("b"));
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled.mock.contexts[0]).toBe(row("b"));
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
    expect(selectedCommits.value.map((commit) => commit.hash)).toEqual(["b"]);
    expect(focusedCommit.value).toBe("b");
    expect(row("b").getAttribute("aria-selected")).toBe("true");
    expect(pendingReveal.value).toBeNull();
  });

  it("waits while the rows on screen do not include it", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    pendingReveal.value = "b";
    drawTable({ commits: [entry("c"), entry("a")] });
    expect(pendingReveal.value).toBe("b");
    expect(selectedCommits.value).toEqual([]);
    drawTable({ commits: [entry("b"), entry("a")] });
    expect(pendingReveal.value).toBeNull();
    expect(document.activeElement).toBe(row("b"));
  });

  it("takes the keyboard back for its row when the page regains focus", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    pendingReveal.value = "b";
    drawTable({ commits: [entry("c"), entry("b", ["a"]), entry("a")] });
    // The workbench hands the panel the keyboard with nothing focused in it.
    row("b").blur();
    expect(document.activeElement).toBe(document.body);
    window.dispatchEvent(new FocusEvent("focus"));
    expect(document.activeElement).toBe(row("b"));
  });

  describe("while the workbench settles", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      HTMLElement.prototype.scrollIntoView = vi.fn();
      pendingReveal.value = "b";
      drawTable({ commits: [entry("c"), entry("b", ["a"]), entry("a")] });
    });
    afterEach(() => {
      // Let go of the row, so that later tests start without it held.
      window.dispatchEvent(new PointerEvent("pointerdown"));
      vi.useRealTimers();
    });

    it("takes the keyboard back each time the row loses it to nothing", () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        row("b").blur();
        expect(document.activeElement).toBe(document.body);
        vi.advanceTimersByTime(0);
        expect(document.activeElement).toBe(row("b"));
      }
    });

    it("never takes the keyboard while the page does not have it", () => {
      const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
      try {
        // Another picker opens in the workbench and the panel's document drops its focus.
        row("b").blur();
        vi.advanceTimersByTime(0);
        expect(document.activeElement).toBe(document.body);
      } finally {
        hasFocus.mockRestore();
      }
      window.dispatchEvent(new FocusEvent("focus"));
      expect(document.activeElement).toBe(row("b"));
    });

    it("never takes it from a control the keyboard moved to", () => {
      const control = document.createElement("button");
      document.body.append(control);
      try {
        control.focus();
        vi.advanceTimersByTime(0);
        window.dispatchEvent(new FocusEvent("focus"));
        expect(document.activeElement).toBe(control);
      } finally {
        control.remove();
      }
    });

    it.each([
      ["a click", () => window.dispatchEvent(new PointerEvent("pointerdown"))],
      ["a key", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }))],
      ["the settling time passing", () => vi.advanceTimersByTime(5000)]
    ])("lets go after %s", (_, letGo) => {
      letGo();
      row("b").blur();
      vi.advanceTimersByTime(0);
      window.dispatchEvent(new FocusEvent("focus"));
      expect(document.activeElement).toBe(document.body);
    });
  });
});

describe("details", () => {
  const rows = [entry("*", ["a"]), entry("a", ["b"]), entry("b")];

  it("opens under the commit they belong to, or the working tree panel under its row", () => {
    drawTable({ commits: rows });
    act(() => {
      expandedCommit.value = "b";
    });
    const details = row("b").nextElementSibling!;
    expect(details.hasAttribute("data-details-row")).toBe(true);
    expect(details.querySelector('[role="status"]')).not.toBeNull();
    const height = () => host.querySelector("svg[aria-hidden]")!.getAttribute("height");
    expect(height()).toBe(String(3 * 24 + 250));

    act(() => {
      expandedCommit.value = "a";
    });
    expect(row("a").nextElementSibling!.hasAttribute("data-details-row")).toBe(true);
    // The dot of `b` moves below the details.
    expect(graphDots()[2]!.getAttribute("cy")).toBe(String(2.5 * 24 + 250));
    expect(height()).toBe(String(3 * 24 + 250));

    act(() => {
      expandedCommit.value = "*";
    });
    expect(
      row("*").nextElementSibling!.querySelector("[data-working-tree-details]")
    ).not.toBeNull();
    expect(host.querySelectorAll("[data-details-row]")).toHaveLength(1);
  });

  it("shows nothing for a commit that is not loaded", () => {
    drawTable({ commits: rows });
    act(() => {
      expandedCommit.value = "missing";
    });

    expect(host.querySelector("[data-details-row]")).toBeNull();
    expect(host.querySelector("svg[aria-hidden]")!.getAttribute("height")).toBe("72");
  });

  it("closes with Escape on the commit's own row", () => {
    drawTable({ commits: rows });
    act(() => row("a").click());
    expect(host.querySelector("[data-details-row]")).not.toBeNull();

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      row("a").dispatchEvent(escape);
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(expandedCommit.value).toBeNull();
    expect(host.querySelector("[data-details-row]")).toBeNull();
    expect(document.activeElement).toBe(row("a"));
  });
});

describe("branch focus", () => {
  /** `a` on the focused branch, `b` merged into it, `c` unrelated. */
  const rows = [entry("a", ["b"]), entry("b", ["c"]), entry("c")];
  const focus = { direct: ["a"], merged: ["b"] };

  it("marks each row's relation, reporting merged rows as direct when they stay bright", () => {
    drawTable({ commits: rows, head: "a", focus });
    expect(tableRows().map((tr) => tr.dataset["branchRelation"])).toEqual([
      "direct",
      "merged",
      "unrelated"
    ]);

    drawTable({ commits: rows, head: "a", focus, keepMergedBright: true });
    expect(row("b").dataset["branchRelation"]).toBe("direct");
    expect(graphDots()[1]!.getAttribute("data-branch-relation")).toBe("merged");
  });

  it("dims rows' labels as far as their dots, but leaves the text colour alone", () => {
    const display = (hash: string) => row(hash).style.getPropertyValue("--branch-display-colour");
    drawTable({ commits: rows, head: "a", focus });
    expect([display("c"), fillOf(2)]).toEqual([GREY, GREY]);

    drawTable({ commits: rows, head: "a", focus, dimming: "strong" });
    expect([display("c"), fillOf(2)]).toEqual([STRONG_GREY, STRONG_GREY]);
    expect(display("b")).toBe(`color-mix(in srgb, ${FULL} 25%, ${STRONG_GREY})`);
    expect(tableRows().every((tr) => tr.style.color === "")).toBe(true);
  });

  it("brightens the hovered dot until the pointer reaches the header", () => {
    drawTable({ commits: rows, head: "a", focus });
    hover(row("c").cells[1]!);
    expect(fillOf(2)).toBe(FULL);

    hover(host.querySelector("thead th")!);
    expect(fillOf(2)).toBe(GREY);

    hover(row("c"));
    act(() => {
      host.querySelector("table")!.dispatchEvent(new MouseEvent("mouseleave"));
    });
    expect(fillOf(2)).toBe(GREY);
  });

  describe("dots the user is looking at", () => {
    /** The working tree over `s`, which HEAD points at; `s` and `t` are away from the focus. */
    const view = [entry("*", ["s"]), entry("s", ["t"]), entry("t", ["d"]), entry("d")];
    const draw = () =>
      drawTable({ commits: view, head: "s", focus: { direct: ["d"], merged: [] } });

    it("shows HEAD and the open, focused and selected commits in full colour", () => {
      draw();
      expect([fillOf(1), fillOf(2)]).toEqual([FULL, GREY]);

      for (const reveal of [
        () => (expandedCommit.value = "t"),
        () => (focusedCommit.value = "t"),
        () => (selectedCommits.value = [view[2]!])
      ]) {
        act(() => {
          expandedCommit.value = null;
          focusedCommit.value = null;
          selectedCommits.value = [];
        });
        expect(fillOf(2)).toBe(GREY);
        act(() => {
          reveal();
        });
        expect(fillOf(2)).toBe(FULL);
      }
    });

    it("shows the commit whose menu or dialog is open in full colour", () => {
      draw();
      const menuClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      act(() => {
        row("t").dispatchEvent(menuClick);
      });
      expect(contextMenu.value?.source).toBe("commit:t");
      expect(fillOf(2)).toBe(FULL);

      act(() => {
        contextMenu.value = null;
      });
      expect(fillOf(2)).toBe(GREY);

      act(() => {
        dialog.value = {
          kind: "form",
          message: "",
          inputs: [],
          action: "",
          onSubmit: () => {},
          source: "commit:t",
          token: 1
        };
      });
      expect(fillOf(2)).toBe(FULL);

      act(() => {
        contextMenu.value = { x: 0, y: 0, entries: [], source: "ref:head:main" };
      });
      expect(fillOf(2)).toBe(GREY);
    });
  });
});
