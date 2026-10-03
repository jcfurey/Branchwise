// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRef, HistoryEntry } from "@/backend/types";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import type { BranchRelation } from "@/webview/graph/types";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { contextMenu, expandedCommit, uncommittedChanges } from "@/webview/lib/stores";
import type { FocusDimming } from "@/webview/types";

import {
  attachHost,
  entry,
  plainText,
  speak
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

const GREY = "var(--vscode-descriptionForeground, #808080)";
const STRONG_GREY = `color-mix(in srgb, ${GREY} 45%, var(--vscode-editor-background))`;

/** The uncommitted changes over `a`, which HEAD points at, then two older commits. */
const ROWS: Array<HistoryEntry> = [
  entry("*", ["a"]),
  entry("a", ["b"]),
  entry("b", ["c"]),
  entry("c")
];

let host: HTMLDivElement;
/** Hashes passed to `onSelect` and `onRevealLane`, in call order. */
let chosen: Array<string>;
let revealed: Array<string>;

/** The four rows in a table, as the commit table lays them out. */
function drawTable({ expanded = "" } = {}) {
  act(() =>
    render(
      h(
        "table",
        null,
        h(
          "tbody",
          null,
          ROWS.map((commit, index) =>
            h(CommitRow, {
              key: commit.hash,
              commit,
              rows: ROWS,
              tabStop: index === 0,
              isHead: commit.hash === "a",
              headBranch: "main",
              messages: new Map(),
              colour: undefined,
              expanded: commit.hash === expanded,
              onSelect: () => chosen.push(commit.hash),
              onRevealLane: (hash: string) => revealed.push(hash)
            })
          )
        )
      ),
      host
    )
  );
}

type Single = {
  commit?: HistoryEntry;
  isHead?: boolean;
  headBranch?: string | null;
  colour?: string | undefined;
  relation?: BranchRelation;
  keepMergedBright?: boolean;
  dimming?: FocusDimming;
  expanded?: boolean;
  tabStop?: boolean;
  onSelect?: (() => void) | undefined;
};

/** One row on its own in a table body, with only the props the caller gives. */
function drawOne({ commit = ROWS[2]!, onSelect, ...rest }: Single = {}) {
  const body = document.createElement("tbody");
  host.append(body);
  act(() =>
    render(
      h(CommitRow, {
        commit,
        isHead: false,
        headBranch: null,
        messages: new Map(),
        colour: "#123456",
        expanded: false,
        onSelect,
        ...rest
      }),
      body
    )
  );
  return body.querySelector("tr")!;
}

const row = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${hash}"]`)!;
const selection = () => selectedCommits.value.map((commit) => commit.hash).join("");
const focused = () => (document.activeElement as HTMLElement | null)?.dataset["commitHash"];

function click(hash: string, init: MouseEventInit = {}) {
  act(() => {
    row(hash).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
}

/** Press `key` with the given target, and say whether the row claimed the key. */
function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** The attributes other code and assistive technology read from a row. */
function attributes(tr: HTMLTableRowElement) {
  const names = [
    "data-branch-relation",
    "data-emphasized",
    "tabindex",
    "aria-selected",
    "aria-expanded",
    "title"
  ];
  return Object.fromEntries(names.map((name) => [name, tr.getAttribute(name)]));
}

/** The lane colour, and the colour the row's labels and head marker are drawn in. */
function colours(tr: HTMLTableRowElement) {
  return ["--branch-colour", "--branch-display-colour"].map((name) =>
    tr.style.getPropertyValue(name)
  );
}

/** The ref labels of a row, each named by the first line of its tooltip. */
function labels(tr: HTMLTableRowElement) {
  return [...tr.cells[1]!.querySelectorAll<HTMLElement>("span[title]")]
    .filter((span) => span.querySelector("svg") !== null)
    .map((span) => span.title.split("\n")[0]);
}

beforeAll(() => {
  vi.stubEnv("TZ", "UTC");
  setupWebviewTest();
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  speak();
  chosen = [];
  revealed = [];
  selectedCommits.value = [];
  focusedCommit.value = null;
  contextMenu.value = null;
  expandedCommit.value = null;
  uncommittedChanges.value = 3;
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  contextMenu.value = null;
  vi.restoreAllMocks();
});

describe("pointer", () => {
  it("opens details on a plain click and only selects on modified clicks", () => {
    drawTable();

    click("b");
    expect([selection(), chosen, focused()]).toEqual(["b", ["b"], "b"]);
    click("c", { ctrlKey: true });
    expect([selection(), chosen, focused()]).toEqual(["bc", ["b"], "c"]);
    click("a", { shiftKey: true });
    expect([selection(), chosen, focused()]).toEqual(["abc", ["b"], "a"]);
    click("*");
    expect([selection(), chosen, focused()]).toEqual(["", ["b", "*"], "*"]);
    selectedCommits.value = [ROWS[2]!];
    click("*", { ctrlKey: true, shiftKey: true });
    expect([selection(), chosen, focused()]).toEqual(["", ["b", "*", "*"], "*"]);
  });

  it("toggles a commit with Cmd-click as with Ctrl-click", () => {
    drawTable();
    click("b", { metaKey: true });
    click("b", { metaKey: true });

    expect(selection()).toBe("");
    expect(chosen).toEqual([]);
  });

  it("reveals the lane when the row is clicked and again when it takes focus", () => {
    drawTable();
    click("c");
    expect(revealed).toEqual(["c", "c"]);
    expect(focusedCommit.value).toBe("c");

    act(() => row("b").focus());
    expect(revealed).toEqual(["c", "c", "b"]);
    expect(focusedCommit.value).toBe("b");
  });

  it("opens the commit menu from the row and from its button, never selecting", () => {
    drawTable();
    const menuClick = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 15,
      clientY: 25
    });
    act(() => {
      row("b").dispatchEvent(menuClick);
    });
    expect(menuClick.defaultPrevented).toBe(true);
    expect(contextMenu.value).toMatchObject({ source: "commit:b", x: 15, y: 25 });

    contextMenu.value = null;
    act(() => row("c").querySelector("button")!.click());
    expect(contextMenu.peek()?.source).toBe("commit:c");
    expect([selection(), chosen]).toEqual(["", []]);
  });

  it("leaves a right-click on the uncommitted row to the webview", () => {
    drawTable();
    const menuClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      row("*").dispatchEvent(menuClick);
    });

    expect(menuClick.defaultPrevented).toBe(false);
    expect(contextMenu.value).toBeNull();
    expect(row("*").querySelector("button")).toBeNull();
  });

  it("adds the file entries to the menu of a file-history row", () => {
    const commit = entry("f".repeat(40), [], {
      filePath: "new.txt",
      previousPath: "old.txt",
      change: "D"
    });
    const tr = drawOne({ commit });
    act(() => {
      tr.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });

    expect(contextMenu.value!.entries.map((item) => item?.title ?? "—")).toEqual([
      "addTag…",
      "createBranch…",
      "—",
      "checkout…",
      "cherryPick…",
      "revert…",
      "—",
      "merge…",
      "reset…",
      "—",
      "interactiveRebase…",
      "createFixupMenu…",
      "compareWith",
      "bisectChooseGood",
      "bisectChooseBad",
      "copyCommitHash",
      "copyShortCommitHash",
      "—",
      "fileHistory",
      "openHistoricalFile",
      "restoreHistoricalFile"
    ]);
  });
});

describe("keyboard", () => {
  it("moves between rows with arrows, Home and End, selecting what it lands on", () => {
    drawTable();
    const steps: Array<[string, string, KeyboardEventInit, string, string]> = [
      ["a", "ArrowDown", {}, "b", "b"],
      ["b", "ArrowDown", { shiftKey: true }, "bc", "c"],
      ["c", "ArrowDown", {}, "c", "c"],
      ["c", "Home", {}, "", "*"],
      ["*", "End", {}, "c", "c"],
      ["*", "ArrowUp", {}, "", "*"]
    ];
    for (const [from, key, init, selected, landed] of steps) {
      act(() => row(from).focus());
      expect(press(row(from), key, init)).toBe(true);
      expect([selection(), focused(), focusedCommit.value]).toEqual([selected, landed, landed]);
    }
    expect(chosen).toEqual([]);
  });

  it("keeps the selection when Shift+arrow lands on the uncommitted row", () => {
    drawTable();
    selectedCommits.value = [ROWS[2]!];
    act(() => row("a").focus());

    expect(press(row("a"), "ArrowUp", { shiftKey: true })).toBe(true);
    expect([selection(), focused()]).toEqual(["b", "*"]);
  });

  it("opens details with Enter, and toggles the selection of a commit with Space", () => {
    drawTable();
    selectedCommits.value = [ROWS[3]!];

    expect(press(row("a"), "Enter")).toBe(true);
    expect([selection(), chosen]).toEqual(["c", ["a"]]);
    expect(press(row("a"), " ")).toBe(true);
    expect(selection()).toBe("ca");
    expect(press(row("a"), " ")).toBe(true);
    expect([selection(), chosen]).toEqual(["c", ["a"]]);
  });

  it("opens the uncommitted changes with Enter or Space and clears the selection", () => {
    drawTable();
    for (const key of ["Enter", " "]) {
      selectedCommits.value = [ROWS[2]!];
      expect(press(row("*"), key)).toBe(true);
      expect(selection()).toBe("");
    }
    expect(chosen).toEqual(["*", "*"]);
  });

  it("opens the commit menu under the row with the menu key or Shift+F10", () => {
    drawTable();
    vi.spyOn(row("b"), "getBoundingClientRect").mockReturnValue({
      left: 30,
      top: 96,
      bottom: 120
    } as DOMRect);

    expect(press(row("b"), "F10")).toBe(false);
    expect(contextMenu.value).toBeNull();

    for (const [key, init] of [
      ["ContextMenu", {}],
      ["F10", { shiftKey: true }]
    ] as const) {
      contextMenu.value = null;
      expect(press(row("b"), key, init)).toBe(true);
      expect(contextMenu.value).toMatchObject({ source: "commit:b", x: 110, y: 120 });
      expect(contextMenu.value!.entries).toHaveLength(17);
    }
  });

  it("has no menu on the uncommitted row", () => {
    drawTable();

    expect(press(row("*"), "ContextMenu")).toBe(false);
    expect(press(row("*"), "F10", { shiftKey: true })).toBe(false);
    expect(contextMenu.value).toBeNull();
  });

  it("ignores keys pressed on something inside the row", () => {
    drawTable();
    act(() => row("b").focus());

    expect(press(row("b").querySelector("button")!, "ArrowDown")).toBe(false);
    expect([selection(), focused(), focusedCommit.value]).toEqual(["", "b", "b"]);
  });

  it("changes state but moves no focus outside a table", () => {
    const tr = drawOne({ commit: ROWS[1]! });
    act(() => tr.focus());

    expect(press(tr, "ArrowDown")).toBe(true);
    expect([selection(), focusedCommit.value, document.activeElement]).toEqual(["a", "a", tr]);
  });

  it("closes the details open under the row with Escape, and only then", () => {
    drawTable({ expanded: "b" });
    expandedCommit.value = "b";
    const heard = vi.fn();
    document.addEventListener("keydown", heard);
    try {
      expect(press(row("c"), "Escape")).toBe(false);
      expect(expandedCommit.value).toBe("b");
      expect(heard).toHaveBeenCalledOnce();

      act(() => row("b").focus());
      expect(press(row("b"), "Escape")).toBe(true);
      expect(expandedCommit.value).toBeNull();
      expect(heard).toHaveBeenCalledOnce();
      expect(focused()).toBe("b");
    } finally {
      document.removeEventListener("keydown", heard);
    }
  });

  it("closes the uncommitted changes' panel with Escape on their row", () => {
    drawTable({ expanded: "*" });
    expandedCommit.value = "*";

    expect(press(row("*"), "Escape")).toBe(true);
    expect(expandedCommit.value).toBeNull();
  });
});

describe("what the row shows", () => {
  const hash = "abcdef0123456789abcdef0123456789abcdef01";
  const refs: Array<GitRef> = [
    { hash, name: "v1", type: "tag" },
    { hash, name: "origin/main", type: "remote" },
    { hash, name: "main", type: "head" }
  ];
  const commit = entry(hash, [], {
    refs,
    message: "Fix <b>it</b>",
    author: "Ann",
    email: "ann@x",
    date: 1_700_000_000
  });

  it("describes a plain commit", () => {
    const tr = drawOne({ commit });

    expect(tr.classList.contains("branch-focus-row")).toBe(true);
    expect(tr.getAttribute("data-commit-hash")).toBe(hash);
    expect(attributes(tr)).toEqual({
      "data-branch-relation": "normal",
      "data-emphasized": "false",
      tabindex: "0",
      "aria-selected": "false",
      "aria-expanded": "false",
      title: "selectCommitsHint"
    });
    expect(colours(tr)).toEqual(["#123456", "#123456"]);
    // `origin/main` joins the label of `main`, as the cloud at its end.
    expect(labels(tr)).toEqual(["v1", "main", "origin/main"]);
    expect(tr.querySelector("[data-remote-refs]")?.closest("span[title^='main']")).not.toBeNull();
    const message = tr.cells[1]!.querySelector<HTMLElement>(".flex-1")!;
    expect([message.textContent, message.title]).toEqual(["Fix <b>it</b>", "Fix <b>it</b>"]);
    expect(message.querySelector("b")).toBeNull();
    const button = tr.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("commitActions");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(tr.cells[0]!.hasAttribute("title")).toBe(false);
    expect(tr.cells[1]!.hasAttribute("title")).toBe(false);
  });

  it("puts the short hash into the menu button's label", () => {
    speak({ commitActions: "Actions for commit {0} ({0})" });
    const tr = drawOne({ commit });

    expect(tr.querySelector("button")!.getAttribute("aria-label")).toBe(
      "Actions for commit abcdef01 ({0})"
    );
  });

  it("shows the date, author and short hash with their full forms as tooltips", () => {
    const tr = drawOne({ commit });
    const [, , date, author, short] = [...tr.cells];

    expect(tr.cells).toHaveLength(5);
    expect(plainText(date!.textContent)).toBe("Nov 14, 2023 22:13");
    expect(plainText(date!.title)).toBe("Nov 14, 2023 22:13");
    // The initials beside the name are hidden from screen readers.
    const [avatar, name] = author!.querySelectorAll("span > span");
    expect([avatar!.textContent, avatar!.getAttribute("aria-hidden")]).toEqual(["A", "true"]);
    expect([name!.textContent, author!.title]).toEqual(["Ann", "Ann <ann@x>"]);
    expect([short!.textContent, short!.title]).toEqual(["abcdef01", hash]);
  });

  it("marks the head commit and leads with the checked-out branch", () => {
    const tr = drawOne({ commit, isHead: true, headBranch: "main" });

    expect(tr.getAttribute("data-emphasized")).toBe("true");
    expect(labels(tr)).toEqual(["main", "origin/main", "v1"]);
    const line = tr.cells[1]!.firstElementChild!;
    expect(line.firstElementChild!.childNodes).toHaveLength(0);
    expect(line.querySelector(".flex-1 > b")?.textContent).toBe("Fix <b>it</b>");
    expect(tr.cells[1]!.querySelector('span[title^="main"]')!.getAttribute("title")).toBe(
      "main\ntooltipCurrentBranch"
    );
  });

  it("reports merged history as direct when it is kept bright", () => {
    const tr = drawOne({ commit, expanded: true, relation: "merged", keepMergedBright: true });

    expect(attributes(tr)).toMatchObject({
      "data-branch-relation": "direct",
      "data-emphasized": "true",
      "aria-selected": "false",
      "aria-expanded": "true"
    });
  });

  it("uses the theme colour without a palette, and the dimming it is given", () => {
    expect(colours(drawOne({ colour: undefined, relation: "unrelated" }))).toEqual([
      "var(--vscode-focusBorder)",
      GREY
    ]);
    act(() => render(null, host.querySelector("tbody")!));
    host.replaceChildren();
    expect(colours(drawOne({ relation: "unrelated", dimming: "strong" }))).toEqual([
      "#123456",
      STRONG_GREY
    ]);
    act(() => render(null, host.querySelector("tbody")!));
    host.replaceChildren();
    expect(colours(drawOne({ relation: "merged", dimming: "strong" }))).toEqual([
      "#123456",
      `color-mix(in srgb, #123456 25%, ${STRONG_GREY})`
    ]);
  });

  it("describes the uncommitted changes", () => {
    speak({
      uncommittedChange: "Uncommitted changes in {0} file",
      uncommittedChanges: "Uncommitted changes in {0} files",
      viewWorkingTreeChanges: "Click or press Enter to view uncommitted changes."
    });
    const tr = drawOne({ commit: ROWS[0]!, expanded: true });

    expect(tr.title).toBe("Click or press Enter to view uncommitted changes.");
    expect(tr.getAttribute("data-emphasized")).toBe("true");
    expect(tr.getAttribute("aria-selected")).toBe("true");
    const message = tr.cells[1]!.querySelector<HTMLElement>(".flex-1")!;
    expect(message.querySelector("b")?.textContent).toBe("Uncommitted changes in 3 files");
    expect(message.title).toBe("Uncommitted changes in 3 files");
    expect(tr.querySelector("button")).toBeNull();
    expect(
      [...tr.cells].slice(2).map((cell) => [cell.textContent, cell.hasAttribute("title")])
    ).toEqual([
      ["", false],
      ["", false],
      ["", false]
    ]);
  });

  it("uses the singular for a single changed path", () => {
    speak({
      uncommittedChange: "Uncommitted changes in {0} file",
      uncommittedChanges: "Uncommitted changes in {0} files"
    });
    uncommittedChanges.value = 1;
    const tr = drawOne({ commit: ROWS[0]! });

    const message = tr.cells[1]!.querySelector<HTMLElement>(".flex-1")!;
    expect(message.querySelector("b")?.textContent).toBe("Uncommitted changes in 1 file");
    expect(message.title).toBe("Uncommitted changes in 1 file");
  });

  it("shows a selected row that is not the tab stop", () => {
    selectedCommits.value = [commit];
    const tr = drawOne({ commit, tabStop: false });

    expect(attributes(tr)).toMatchObject({
      tabindex: "-1",
      "aria-selected": "true",
      "data-emphasized": "true"
    });
  });

  it("stays emphasized with its button shown while its menu is open", () => {
    const tr = drawOne({ commit });
    const button = tr.querySelector("button")!;
    expect(tr.classList.contains("cursor-pointer")).toBe(false);
    expect(button.classList.contains("invisible")).toBe(true);

    act(() => {
      contextMenu.value = { x: 0, y: 0, entries: [], source: `commit:${hash}` };
    });
    expect(tr.getAttribute("data-emphasized")).toBe("true");
    expect(button.classList.contains("invisible")).toBe(false);

    act(() => {
      contextMenu.value = { x: 0, y: 0, entries: [], source: "commit:another" };
    });
    expect(tr.getAttribute("data-emphasized")).toBe("false");
  });

  it("offers a pointer only when the row can be opened", () => {
    expect(drawOne({ onSelect: () => {} }).classList.contains("cursor-pointer")).toBe(true);
  });
});
