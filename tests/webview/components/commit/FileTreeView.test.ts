// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitFileChange, HistoryEntry } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { FileTree } from "@/webview/components/commit/FileTree";
import { handleCommitDetails } from "@/webview/lib/handler/commit-details";
import { historyFilter } from "@/webview/lib/navigation";
import { contextMenu, dialog, expandedCommit, selectedRepo } from "@/webview/lib/stores";
import { buildFileTree } from "@/webview/utils/fileTree";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

/** A change at `path`. Counts default to one line added; pass null for a binary file. */
function changed(
  path: string,
  kind: GitFileChange["type"] = "M",
  counts: [number | null, number | null] = [1, 0],
  from = path
): GitFileChange {
  return {
    newFilePath: path,
    oldFilePath: from,
    type: kind,
    additions: counts[0],
    deletions: counts[1]
  };
}

/** English text for the strings the tree reads, with every other key naming itself. */
const ENGLISH: Record<string, string> = {
  tooltipAddition: "{0} line added",
  tooltipAdditions: "{0} lines added",
  tooltipDeletion: "{0} line deleted",
  tooltipDeletions: "{0} lines deleted",
  tooltipBinaryFile: "Git has no text diff for this file, so there is nothing to open.",
  tooltipRenamedTo: "Renamed from {0} to {1}"
};

/** The key-name strings `setupWebviewTest` installs, put back after a test swaps them. */
let keyNames: LocalizedStrings;

function setStrings(value: LocalizedStrings) {
  Object.defineProperty(window, "l10n", { value, configurable: true });
}

function speakEnglish() {
  setStrings(new Proxy(keyNames, { get: (_target, key) => ENGLISH[String(key)] ?? String(key) }));
}

let host: HTMLDivElement;

/** Draw the tree of `changes` for `hash`, into the same host each time. */
function show(changes: Array<GitFileChange>, hash = "H") {
  act(() => render(h(FileTree, { nodes: buildFileTree(changes), commitHash: hash }), host));
}

const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("li > button")];
const names = () => buttons().map((button) => button.querySelector("span")?.textContent);
const entry = (name: string, nth = 0) =>
  buttons().filter((button) => button.querySelector("span")?.textContent === name)[nth]!;
/** Click `target` the way a pointer does, reporting how many clicks came in a row. */
const clickTimes = (target: Element, ...counts: Array<number>) =>
  act(() => {
    for (const detail of counts) {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
    }
  });
const diffs = () =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as { command: string })
    .filter((message) => message.command === "viewDiff");

/** A right-click at the given point of the window. */
const rightClick = (clientX: number, clientY: number) =>
  new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
const keyDown = (init: KeyboardEventInit) =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

/** Dispatch a cancelable event and report whether the tree cancelled it. */
function cancelled(target: Element, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeAll(() => {
  setupWebviewTest();
  keyNames = window.l10n;
});
beforeEach(() => {
  setStrings(keyNames);
  selectedRepo.value = "/repo";
  contextMenu.value = null;
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("folders", () => {
  const sources = [changed("src/a.ts"), changed("src/b/c.ts")];

  it("opens a closed folder again with its files in place", () => {
    show(sources);
    act(() => entry("b").click());
    act(() => entry("b").click());

    expect(entry("b").getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["src", "b", "c.ts", "a.ts"]);
  });

  it("keeps a subfolder closed while its parent is closed and opened", () => {
    show(sources);
    act(() => entry("b").click());
    act(() => entry("src").click());
    expect(names()).toEqual(["src"]);
    expect(entry("src").getAttribute("aria-expanded")).toBe("false");

    act(() => entry("src").click());

    expect(names()).toEqual(["src", "b", "a.ts"]);
    expect(entry("b").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens every folder when mounted again", () => {
    show(sources);
    act(() => entry("src").click());
    act(() => render(null, host));

    show(sources);

    const folders = host.querySelectorAll("button[aria-expanded]");
    expect(folders).toHaveLength(2);
    expect([...folders].every((folder) => folder.getAttribute("aria-expanded") === "true")).toBe(
      true
    );
  });

  it("opens every folder again when it is given another commit (Q6)", () => {
    show([changed("src/a"), changed("lib/b")], "h1");
    act(() => entry("src").click());
    expect(names()).toEqual(["lib", "b", "src"]);

    show([changed("src/z"), changed("other/q")], "h2");
    expect(names()).toEqual(["other", "q", "src", "z"]);
    expect(entry("src").getAttribute("aria-expanded")).toBe("true");

    // Coming back to the first commit does not bring back what was closed there.
    show([changed("src/a"), changed("lib/b")], "h1");
    expect(names()).toEqual(["lib", "b", "src", "a"]);
  });

  it("keeps closed folders for a new tree of the same commit, even one that lacks them", () => {
    show([changed("src/a"), changed("lib/b")], "h1");
    act(() => entry("src").click());

    show([changed("x/q")], "h1");
    expect(names()).toEqual(["x", "q"]);

    show([changed("src/a")], "h1");
    expect(names()).toEqual(["src"]);
  });

  it("has no menu and leaves the right button and menu key alone", () => {
    show(sources);
    const folder = entry("src");

    expect(cancelled(folder, rightClick(5, 5))).toBe(false);
    for (const key of ["ContextMenu", "Enter", " ", "ArrowRight", "ArrowLeft"]) {
      expect(cancelled(folder, keyDown({ key }))).toBe(false);
    }
    expect(cancelled(folder, keyDown({ key: "F10", shiftKey: true }))).toBe(false);

    expect(contextMenu.value).toBeNull();
    expect(folder.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps focus on a folder it toggles", () => {
    show(sources);
    entry("b").focus();

    act(() => entry("b").click());

    expect(document.activeElement).toBe(entry("b"));
  });
});

describe("files", () => {
  it("asks for the diff of a renamed file with both of its paths", () => {
    show([changed("lib/new.ts", "R", [2, 3], "old.ts")]);

    act(() => entry("new.ts").click());

    expect(vscodeApi.postMessage.mock.calls).toEqual([
      [
        {
          command: "viewDiff",
          repo: "/repo",
          commitHash: "H",
          oldFilePath: "old.ts",
          newFilePath: "lib/new.ts",
          type: "R"
        }
      ]
    ]);
  });

  it("sends nothing while no repository is selected", () => {
    selectedRepo.value = undefined;
    show([changed("a.ts")]);

    act(() => entry("a.ts").click());

    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("asks for one diff per double-click, and one per keyboard activation (Q2)", () => {
    show([changed("a.ts")]);
    const file = entry("a.ts");

    clickTimes(file, 1, 2);
    act(() => {
      file.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    });
    expect(diffs()).toHaveLength(1);

    // Enter and Space click the button with no pointer, which counts no clicks.
    clickTimes(file, 0);
    expect(diffs()).toHaveLength(2);

    clickTimes(file, 1);
    expect(diffs()).toHaveLength(3);
  });

  it("still toggles a folder on each click of a double-click", () => {
    show([changed("src/a.ts")]);
    const folder = entry("src");

    clickTimes(folder, 1, 2);

    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(names()).toEqual(["src", "a.ts"]);
  });

  it.each([
    ["both counts are missing", [null, null] as [null, null]],
    ["one count is missing", [5, null] as [number, null]]
  ])("marks a binary file unavailable when %s (Q3)", (_case, counts) => {
    show([changed("data.bin", "M", counts), changed("text.ts")]);
    const binary = entry("data.bin");

    expect(binary.title).toBe("tooltipBinaryFile");
    expect(binary.textContent).toBe("data.binM");
    expect(binary.getAttribute("aria-disabled")).toBe("true");
    expect(binary.disabled).toBe(false);
    expect(binary.hasAttribute("disabled")).toBe(false);
    expect(entry("text.ts").hasAttribute("aria-disabled")).toBe(false);
    expect(entry("text.ts").hasAttribute("title")).toBe(false);

    binary.focus();
    expect(document.activeElement).toBe(binary);
    act(() => binary.click());
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();

    // Its menu is still there.
    expect(cancelled(binary, rightClick(1, 1))).toBe(true);
    expect(contextMenu.value?.source).toBe("file:data.bin");
  });

  it("opens a binary image's diff, which shows its two versions side by side", () => {
    show([
      changed("pics/logo.PNG", "M", [null, null]),
      changed("gone.gif", "D", [null, null]),
      changed("new.webp", "R", [null, null], "old.data")
    ]);

    for (const name of ["logo.PNG", "gone.gif", "new.webp"]) {
      expect(entry(name).hasAttribute("aria-disabled")).toBe(false);
      expect(entry(name).hasAttribute("title")).toBe(false);
      act(() => entry(name).click());
    }

    expect(diffs()).toEqual([
      expect.objectContaining({ newFilePath: "pics/logo.PNG", type: "M" }),
      expect.objectContaining({ newFilePath: "gone.gif", type: "D" }),
      expect.objectContaining({ newFilePath: "new.webp", oldFilePath: "old.data", type: "R" })
    ]);
  });

  it("shows line counts for modified and renamed files only", () => {
    show([
      changed("added.ts", "A", [10, 0]),
      changed("deleted.ts", "D", [0, 5]),
      changed("modified.ts", "M", [3, 1]),
      changed("moved.ts", "R", [0, 0], "was.ts")
    ]);

    expect(entry("added.ts").textContent).toBe("added.tsA");
    expect(entry("deleted.ts").textContent).toBe("deleted.tsD");
    expect(entry("modified.ts").textContent).toBe("modified.ts(+3|-1)M");
    expect(entry("moved.ts").textContent).toBe("moved.ts(+0|-0)R");

    const titles = [...entry("modified.ts").querySelectorAll("[title]")].map((node) => [
      node.textContent,
      node.getAttribute("title")
    ]);
    expect(titles).toEqual([
      ["+3", "tooltipAdditions"],
      ["-1", "tooltipDeletion"],
      ["M", "changeModified"]
    ]);
  });

  it("picks the singular or plural count text", () => {
    speakEnglish();
    show([
      changed("one", "M", [1, 1]),
      changed("zero", "M", [0, 0]),
      changed("many", "M", [1234, 2]),
      changed("single", "M", [1, 0])
    ]);
    const tooltips = (name: string) =>
      [...entry(name).querySelectorAll("[title]:not([data-change])")].map((node) =>
        node.getAttribute("title")
      );

    expect(tooltips("one")).toEqual(["1 line added", "1 line deleted"]);
    expect(tooltips("zero")).toEqual(["0 lines added", "0 lines deleted"]);
    expect(tooltips("many")).toEqual(["1234 lines added", "2 lines deleted"]);
    expect(tooltips("single")).toEqual(["1 line added", "0 lines deleted"]);
  });

  it("marks every change with its status letter, named for tooltips and screen readers", () => {
    show([
      changed("added.ts", "A"),
      changed("modified.ts", "M"),
      changed("deleted.ts", "D"),
      changed("moved.ts", "R", [1, 0], "was.ts"),
      changed("data.bin", "A", [null, null])
    ]);
    const status = (name: string) => {
      const cell = entry(name).querySelector<HTMLElement>("[data-change]")!;
      return {
        letter: cell.textContent,
        role: cell.getAttribute("role"),
        label: cell.getAttribute("aria-label"),
        last: cell === entry(name).lastElementChild,
        muted: cell.classList.contains("text-muted"),
        fixed: cell.classList.contains("w-6") && cell.classList.contains("shrink-0")
      };
    };

    const common = { role: "img", last: true, muted: true, fixed: true };
    expect(status("added.ts")).toEqual({ ...common, letter: "A", label: "changeAdded" });
    expect(status("modified.ts")).toEqual({ ...common, letter: "M", label: "changeModified" });
    expect(status("deleted.ts")).toEqual({ ...common, letter: "D", label: "changeDeleted" });
    expect(status("moved.ts")).toEqual({ ...common, letter: "R", label: "changeRenamed" });
    // A binary file has no line counts, but still says what happened to it.
    expect(status("data.bin")).toEqual({ ...common, letter: "A", label: "changeAdded" });
    // The colour stays as well.
    expect(entry("added.ts").classList.contains("text-git-added")).toBe(true);
    expect(entry("deleted.ts").classList.contains("text-git-deleted")).toBe(true);
    expect(entry("added.ts").querySelector("[data-change]")!.getAttribute("title")).toBe(
      "changeAdded"
    );
  });

  it("marks a rename with its change letter and both paths", () => {
    speakEnglish();
    show([
      changed("new/path.ts", "R", [2, 3], "old/path.ts"),
      changed("rb.bin", "R", [null, null], "ra.bin"),
      changed("m.ts", "M"),
      changed("a.ts", "A"),
      changed("d.ts", "D")
    ]);
    const marker = (name: string) =>
      [...entry(name).querySelectorAll("span")].find((span) => span.textContent === "R");

    expect(marker("path.ts")?.title).toBe("Renamed from old/path.ts to new/path.ts");
    expect(entry("path.ts").textContent).toBe("path.ts(+2|-3)R");
    expect(marker("rb.bin")?.title).toBe("Renamed from ra.bin to rb.bin");
    expect(entry("rb.bin").textContent).toBe("rb.binR");
    expect(entry("rb.bin").title).toBe(
      "Git has no text diff for this file, so there is nothing to open."
    );
    for (const name of ["m.ts", "a.ts", "d.ts"]) {
      expect(marker(name)).toBeUndefined();
    }
    expect(marker("path.ts")?.getAttribute("aria-label")).toBe("changeRenamed");
  });

  it("puts paths into the rename text exactly as they are (Q1)", () => {
    speakEnglish();
    show([
      changed("c.txt", "R", [1, 0], "a$$b.txt"),
      changed("r", "R", [1, 0], "p$&q"),
      changed("n$'ew.ts", "R", [1, 0], "o.ts"),
      changed("y.txt", "R", [1, 0], "x{1}.txt"),
      changed("z.txt", "R", [1, 0], "$`{0}")
    ]);
    const renameTitle = (name: string) =>
      [...entry(name).querySelectorAll("span")].find((span) => span.textContent === "R")?.title;

    expect(renameTitle("c.txt")).toBe("Renamed from a$$b.txt to c.txt");
    expect(renameTitle("r")).toBe("Renamed from p$&q to r");
    expect(renameTitle("n$'ew.ts")).toBe("Renamed from o.ts to n$'ew.ts");
    expect(renameTitle("y.txt")).toBe("Renamed from x{1}.txt to y.txt");
    expect(renameTitle("z.txt")).toBe("Renamed from $`{0} to z.txt");
  });

  it("shows names as text, never as markup", () => {
    show([changed("dir<b>/<img src=x>.ts")]);

    expect(names()).toEqual(["dir<b>", "<img src=x>.ts"]);
    expect(host.querySelector("img, b")).toBeNull();
  });
});

describe("file menu", () => {
  it("opens at the pointer on a right-click and keeps the event to itself", () => {
    show([changed("src/a.ts")]);
    const outside = vi.fn();
    host.addEventListener("contextmenu", outside);
    expect(cancelled(entry("a.ts"), rightClick(50, 60))).toBe(true);

    expect(outside).not.toHaveBeenCalled();
    expect(contextMenu.value).toMatchObject({ x: 50, y: 60, source: "file:src/a.ts" });
    expect(contextMenu.value?.entries.map((item) => item?.title)).toEqual([
      "fileHistory",
      "openHistoricalFile",
      "restoreHistoricalFile"
    ]);
  });

  it("uses the parent revision and the old path for a deleted file", () => {
    show([changed("gone.txt", "D", [0, 5])]);
    const open = () => cancelled(entry("gone.txt"), rightClick(9, 9));

    open();
    act(() => contextMenu.value!.entries[0]!.onClick());
    expect(historyFilter.value).toMatchObject({ path: "gone.txt", revision: "H^", follow: true });

    open();
    act(() => contextMenu.value!.entries[1]!.onClick());
    expect(vscodeApi.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: "repositoryAction",
        repo: "/repo",
        action: { kind: "viewHistoricalFile", hash: "H^", path: "gone.txt" }
      })
    );
  });

  it("offers to restore a renamed file to its new path", () => {
    show([changed("lib/new.ts", "R", [1, 1], "old.ts")]);
    cancelled(entry("new.ts"), rightClick(3, 4));

    act(() => contextMenu.value!.entries[2]!.onClick());

    expect(dialog.value).toMatchObject({
      message: "restoreHistoricalFile",
      inputs: [{ value: "lib/new.ts" }]
    });
  });

  it("opens below the entry from the menu key or Shift+F10, but not from F10", () => {
    show([changed("docs/guide.md")]);
    const file = entry("guide.md");
    vi.spyOn(file, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 20 })
    );
    const outside = vi.fn();
    host.addEventListener("keydown", outside);

    expect(cancelled(file, keyDown({ key: "ContextMenu" }))).toBe(true);
    expect(contextMenu.value).toMatchObject({ x: 40, y: 120, source: "file:docs/guide.md" });
    expect(outside).toHaveBeenCalledTimes(1);

    contextMenu.value = null;
    expect(cancelled(file, keyDown({ key: "F10", shiftKey: true }))).toBe(true);
    expect(contextMenu.value).toMatchObject({ x: 40, y: 120, source: "file:docs/guide.md" });

    contextMenu.value = null;
    expect(cancelled(file, keyDown({ key: "F10" }))).toBe(false);
    expect(contextMenu.value).toBeNull();
  });
});

describe("structure", () => {
  it("renders folders and files to the agreed shape", () => {
    show([changed("src/a.ts"), changed("src/b/c.ts"), changed("top.md", "A")]);

    const all = buttons();
    expect(all).toHaveLength(5);
    expect(all.every((button) => button.type === "button")).toBe(true);
    expect(host.querySelectorAll("button")).toHaveLength(5);

    const folders = all.filter((button) => button.hasAttribute("aria-expanded"));
    expect(folders.map((button) => button.textContent)).toEqual(["src", "b"]);

    const svgs = [...host.querySelectorAll("svg")];
    expect(svgs).toHaveLength(5);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
      expect(svg.textContent).toBe("");
    }
    expect(host.querySelector("[id]")).toBeNull();
    // Only the status letters take a role, so that their names are read in place of the letters.
    const roles = [...host.querySelectorAll("[role]")];
    expect(roles.map((node) => [node.getAttribute("role"), node.textContent])).toEqual([
      ["img", "M"],
      ["img", "M"],
      ["img", "A"]
    ]);
  });

  it("changes the folder glyph when the folder closes", () => {
    show([changed("src/a.ts")]);
    const glyph = () => entry("src").querySelector("svg")!.innerHTML;
    const open = glyph();

    act(() => entry("src").click());

    expect(glyph()).not.toBe(open);
    act(() => entry("src").click());
    expect(glyph()).toBe(open);
  });

  it("indents each entry by its depth", () => {
    show([changed("a/b/c.ts"), changed("d.ts")]);

    const padding = [...host.querySelectorAll("li")].map((item) => item.style.paddingLeft);

    expect(padding).toEqual(["10px", "40px", "70px", "10px"]);
  });

  it("renders an empty list for a commit without changes", () => {
    show([]);

    expect(host.querySelectorAll("ul")).toHaveLength(1);
    expect(buttons()).toHaveLength(0);
    expect(host.textContent).toBe("");
  });

  it("keeps a file and a folder of the same name apart", () => {
    show([changed("a", "D", [0, 1]), changed("a/b", "A", [1, 0])]);
    expect(names()).toEqual(["a", "b", "a"]);
    expect(buttons()[0]!.hasAttribute("aria-expanded")).toBe(true);
    expect(buttons()[2]!.hasAttribute("aria-expanded")).toBe(false);

    act(() => buttons()[0]!.click());
    expect(names()).toEqual(["a", "a"]);

    act(() => buttons()[0]!.click());
    expect(names()).toEqual(["a", "b", "a"]);

    act(() => buttons()[2]!.click());
    expect(diffs()).toEqual([expect.objectContaining({ newFilePath: "a", type: "D" })]);
  });

  it("keeps two changes of the same path apart", () => {
    const changes = [
      changed("d/x", "R", [1, 0], "p"),
      changed("d/x", "A", [1, 0]),
      changed("d/y", "M", [1, 0])
    ];
    show(changes);
    act(() => entry("d").click());
    act(() => entry("d").click());
    // Copies, as a second reply for the same commit would bring.
    show(structuredClone(changes));

    expect(names()).toEqual(["d", "x", "x", "y"]);
    act(() => entry("x", 0).click());
    act(() => entry("x", 1).click());
    expect(diffs()).toEqual([
      expect.objectContaining({ type: "R", oldFilePath: "p", newFilePath: "d/x" }),
      expect.objectContaining({ type: "A", oldFilePath: "d/x", newFilePath: "d/x" })
    ]);
  });

  it("shows a file with no name by its counts alone", () => {
    show([changed(""), changed("/a//b/")]);

    expect(names()).toEqual(["a", "b", ""]);
    expect(buttons()[2]!.textContent).toBe("(+1|-0)M");
  });

  it("leaves focus on a file when the same commit's tree arrives again", () => {
    const changes = () => [changed("src/a.ts"), changed("src/b/c.ts")];
    show(changes());
    const file = entry("c.ts");
    file.focus();

    show(changes());

    expect(document.activeElement).toBe(file);
    expect(file.isConnected).toBe(true);
  });

  it("renders a path two thousand folders deep (Q11)", () => {
    const deep = `${"f/".repeat(2000)}leaf.ts`;

    show([changed(deep)]);

    expect(buttons()).toHaveLength(2001);
    expect(entry("leaf.ts").textContent).toBe("leaf.ts(+1|-0)M");
    const last = host.querySelectorAll("li")[2000]!;
    expect(last.style.paddingLeft).toBe(`${10 + 30 * 2000}px`);

    // Closing the outermost folder removes the whole chain.
    act(() => buttons()[0]!.click());
    expect(buttons()).toHaveLength(1);
  });

  // Thousands of rows take a few seconds under coverage instrumentation on a busy runner.
  it("renders a large commit and toggles one of its folders", () => {
    const changes = Array.from({ length: 5000 }, (_, index) =>
      changed(`top${index % 50}/sub${index % 400}/file${index}.ts`)
    );

    show(changes);
    expect(buttons()).toHaveLength(5450);

    act(() => entry("top0").click());
    expect(buttons()).toHaveLength(5450 - 108);
  }, 30_000);
});

describe("inside the commit table", () => {
  const commit: HistoryEntry = {
    hash: "e".repeat(40),
    parentHashes: [],
    author: "Someone",
    email: "someone@test",
    date: 0,
    message: "Change things",
    refs: []
  };

  it("lets Escape close the details and return focus to the commit", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expandedCommit.value = null;
    act(() =>
      render(h(CommitTable, { commits: [commit], head: commit.hash, headBranch: "main" }), host)
    );
    const commitRow = () =>
      host.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${commit.hash}"]`)!;

    act(() => commitRow().click());
    const pending = latestGraphRequest("commitDetails");
    act(() =>
      handleCommitDetails({
        command: "commitDetails",
        repo: pending.repo,
        requestId: pending.requestId,
        commitDetails: {
          hash: commit.hash,
          parents: [],
          author: "Someone",
          email: "someone@test",
          date: 0,
          committer: "Someone",
          body: "Change things",
          fileChanges: [changed("docs/readme.md")]
        }
      })
    );
    const file = entry("readme.md");
    file.focus();

    act(() => {
      file.dispatchEvent(keyDown({ key: "Escape" }));
    });

    expect(expandedCommit.value).toBeNull();
    expect(document.activeElement).toBe(commitRow());
  });
});
