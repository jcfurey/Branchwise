// @vitest-environment jsdom
import { type ComponentChildren, Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitRef, HistoryEntry, RepositoryState } from "@/backend/types";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import { openBatch } from "@/webview/components/history/HistoryTools";
import { Announcer } from "@/webview/components/ui/Announcer";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { commitMenu, refMenu } from "@/webview/lib/menus";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { repositoryState } from "@/webview/lib/repository-actions";
import type { RowShortcutId } from "@/webview/lib/shortcuts";
import {
  commitHead,
  commitList,
  contextMenu,
  dialog,
  expandedCommit,
  headBranch,
  selectedRepo
} from "@/webview/lib/stores";
import type { ContextMenuEntry, DialogState } from "@/webview/types";

import {
  attachHost,
  entry,
  reconfigure,
  speak
} from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const REPO = "/work/keys";
const H = "a".repeat(40);
const PARENT = "b".repeat(40);
const OTHER = "c".repeat(40);
const NO_MESSAGES = new Map<string, string>();

const FEATURE: GitRef = { type: "head", name: "feature", hash: H };
const MAIN: GitRef = { type: "head", name: "main", hash: H };
const ORIGIN_FEATURE: GitRef = { type: "remote", name: "origin/feature", hash: H };

/** A repository whose issues and commits live on GitHub. */
const HOSTED: RepositoryState = {
  remotes: [{ name: "origin", fetchUrls: ["https://github.com/owner/repo.git"], pushUrls: [] }],
  pushDefault: null,
  branches: [],
  remoteBranches: [],
  tags: [],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};

let host: HTMLDivElement;
/** How often the row asked for its details to open or close. */
let toggled: number;

/** One commit row in a table, with the page's live region beside it. */
function draw(
  commit: HistoryEntry,
  rows: Array<HistoryEntry> = [commit],
  messages: ReadonlyMap<string, string> = NO_MESSAGES
) {
  act(() =>
    render(
      h(
        Fragment,
        null,
        h(
          "table",
          null,
          h(
            "tbody",
            null,
            h(CommitRow, {
              commit,
              rows,
              isHead: false,
              headBranch: "main",
              messages,
              colour: undefined,
              expanded: false,
              onSelect: () => {
                toggled += 1;
              }
            })
          )
        ),
        h(Announcer, null)
      ),
      host
    )
  );
  const row = host.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${commit.hash}"]`)!;
  row.focus();
  return row;
}

/** Press `key` on `target` and say whether the page claimed it. */
function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const announced = () => host.querySelector("[data-announcer]")?.textContent ?? "";

/** The text a dialog question shows. */
function textOf(children: ComponentChildren) {
  const box = document.createElement("div");
  render(h(Fragment, null, children), box);
  const text = box.textContent;
  render(null, box);
  return text;
}

/** Everything posted to the extension so far, without the ids each request makes up. */
function posted() {
  return vscodeApi.postMessage.mock.calls.map(([message]) => {
    const { id: _id, requestId: _requestId, ...rest } = message as Record<string, unknown>;
    return rest;
  });
}

/**
 * What an action did: the dialog it opened, and what was posted once that dialog, if a form, was
 * submitted with the values it starts with.
 */
function outcome() {
  const shown: DialogState | null = dialog.value;
  let summary: unknown = null;
  if (shown?.kind === "form") {
    summary = {
      kind: shown.kind,
      message: textOf(shown.message),
      inputs: shown.inputs,
      action: shown.action,
      source: shown.source,
      destructive: shown.destructive
    };
    shown.onSubmit(shown.inputs.map((input) => input.value));
  } else if (shown !== null) {
    summary = { ...shown, token: undefined };
  }
  const result = { summary, posted: posted() };
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
  return result;
}

/** Run the menu entry that names `id` as its key. */
function choose(entries: Array<ContextMenuEntry>, id: RowShortcutId) {
  const chosen = entries.find((candidate) => candidate?.shortcut === id);
  expect(chosen, `a menu entry for ${id}`).toBeDefined();
  act(() => chosen!.onClick());
  return outcome();
}

/** Press `key` on a row of `commit`, and return what it did, which must be something. */
function viaKey(commit: HistoryEntry, key: string, init: KeyboardEventInit = {}) {
  const row = draw(commit);
  expect(press(row, key, init)).toBe(true);
  const result = outcome();
  expect(result.summary !== null || result.posted.length > 0, `key ${key} acted`).toBe(true);
  return result;
}

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  speak({ shortcutUnavailable: "Not available here: {0}" });
  host = attachHost();
  toggled = 0;
  vscodeApi.postMessage.mockClear();
  dialog.value = null;
  contextMenu.value = null;
  expandedCommit.value = null;
  selectedCommits.value = [];
  focusedCommit.value = null;
  selectedRepo.value = REPO;
  headBranch.value = "main";
  commitHead.value = H;
  commitList.value = [entry(H, [PARENT])];
  repositoryState.value = HOSTED;
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  dialog.value = null;
  contextMenu.value = null;
  repositoryState.value = null;
});

describe("each key does what its commit menu entry does", () => {
  const commit = entry(H, [PARENT]);
  it.each<[string, RowShortcutId, KeyboardEventInit?]>([
    ["c", "checkout"],
    ["b", "createBranch"],
    ["t", "addTag"],
    ["p", "cherryPick"],
    ["v", "revert"],
    ["i", "interactiveRebase"],
    ["m", "merge"],
    ["x", "reset"],
    ["e", "editMessage"],
    ["y", "copyShortId"],
    ["Y", "copyFullId", { shiftKey: true }],
    ["o", "openOnHost"]
  ])("%s: %s", (key, id, init) => {
    const pressed = viaKey(commit, key, init);
    expect(pressed).toEqual(choose(commitMenu(commit, NO_MESSAGES), id));
  });

  it("asks for the parent of a merge, as the menu does", () => {
    const merge = entry(H, [PARENT, OTHER]);
    const messages = new Map([[OTHER, "the other side"]]);
    const row = draw(merge, [merge], messages);
    expect(press(row, "v")).toBe(true);
    const pressed = outcome();
    expect(JSON.stringify(pressed)).toContain("the other side");
    expect(pressed).toEqual(choose(commitMenu(merge, messages), "revert"));
  });

  it("keeps the letter out of the field of the dialog it opens", () => {
    const row = draw(commit);
    const event = new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true });
    act(() => {
      row.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(dialog.value?.kind).toBe("form");
  });

  it("acts once for a held key", () => {
    const row = draw(commit);
    expect(press(row, "y", { repeat: true })).toBe(true);
    expect(posted()).toEqual([]);
  });

  it("d opens and closes the details, as Enter does", () => {
    const row = draw(commit);
    press(row, "Enter");
    expect(toggled).toBe(1);
    expect(press(row, "d")).toBe(true);
    expect(toggled).toBe(2);
    expect(dialog.value).toBeNull();
  });
});

describe("keys that a branch on the row decides", () => {
  it("m merges the branch on the row, as its label's menu does", () => {
    const commit = entry(H, [PARENT], { refs: [MAIN, FEATURE] });
    const pressed = viaKey(commit, "m");
    expect(JSON.stringify(pressed.posted)).toContain('"branchName":"feature"');
    expect(pressed).toEqual(choose(refMenu(FEATURE, false), "merge"));
  });

  it("m merges the commit when no branch on the row can be merged", () => {
    const commit = entry(H, [PARENT], { refs: [MAIN] });
    expect(viaKey(commit, "m")).toEqual(choose(commitMenu(commit, NO_MESSAGES), "merge"));
  });

  it("r rebases onto the branch on the row, as its label's menu does", () => {
    const commit = entry(H, [PARENT], { refs: [FEATURE] });
    expect(viaKey(commit, "r")).toEqual(choose(refMenu(FEATURE, false), "rebase"));
  });

  it("r rebases onto a remote branch on the row", () => {
    const commit = entry(H, [PARENT], { refs: [MAIN, ORIGIN_FEATURE] });
    expect(viaKey(commit, "r")).toEqual(choose(refMenu(ORIGIN_FEATURE, false), "rebase"));
  });

  it("p cherry-picks the whole selection, as the selection bar does", () => {
    const commit = entry(H, [PARENT]);
    const second = entry(OTHER, [H]);
    selectedCommits.value = [commit, second];
    const row = draw(commit, [second, commit]);
    selectedCommits.value = [commit, second];
    expect(press(row, "p")).toBe(true);
    const pressed = outcome();
    act(() => openBatch("cherry-pick"));
    expect(pressed).toEqual(outcome());
    expect(JSON.stringify(pressed.posted)).toContain("batchPlan");
  });
});

describe("an action the row does not offer", () => {
  function expectAnnounced(commit: HistoryEntry, key: string, message: string) {
    const row = draw(commit);
    expect(press(row, key)).toBe(true);
    expect(dialog.value).toBeNull();
    expect(posted()).toEqual([]);
    expect(announced()).toBe(message);
    expect(host.querySelector("[data-announcer]")?.getAttribute("aria-live")).toBe("polite");
  }

  it("is announced politely, without a dialog", () => {
    speak({ shortcutUnavailable: "Not available here: {0}", rebaseOnto: "Rebase" });
    expectAnnounced(entry(H, [PARENT]), "r", "Not available here: Rebase");
  });

  it("covers Edit Message off the checked-out branch", () => {
    commitHead.value = OTHER;
    commitList.value = [entry(OTHER, [PARENT]), entry(H, [PARENT])];
    speak({ shortcutUnavailable: "Not available here: {0}", editMessage: "Edit Message" });
    expectAnnounced(entry(H, [PARENT]), "e", "Not available here: Edit Message");
  });

  it("covers opening a commit on an unknown host", () => {
    repositoryState.value = null;
    speak({ shortcutUnavailable: "Not available here: {0}", shortcutOpenOnHost: "Open" });
    expectAnnounced(entry(H, [PARENT]), "o", "Not available here: Open");
  });

  it("covers a selection too large to cherry-pick", () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      entry(index.toString(16).padStart(40, "0"))
    );
    const commit = many[0]!;
    const row = draw(commit, many);
    selectedCommits.value = many;
    speak({ shortcutUnavailable: "Not available here: {0}", cherryPick: "Cherry-pick" });
    expect(press(row, "p")).toBe(true);
    expect(dialog.value).toBeNull();
    expect(announced()).toBe("Not available here: Cherry-pick");
  });

  it("covers every commit action on the uncommitted changes, which still open with d", () => {
    speak({ shortcutUnavailable: "Not available here: {0}", createBranch: "Create Branch" });
    expectAnnounced(entry(UNCOMMITTED_CHANGES), "b", "Not available here: Create Branch");
    const row = host.querySelector("tr")!;
    press(row, "d");
    expect(toggled).toBe(1);
  });

  it("announces the same words again when the key is pressed again", () => {
    speak({ shortcutUnavailable: "Not available here: {0}", rebaseOnto: "Rebase" });
    const row = draw(entry(H, [PARENT]));
    press(row, "r");
    const first = host.querySelector("[data-announcer] span");
    press(row, "r");
    const second = host.querySelector("[data-announcer] span");
    expect(second?.textContent).toBe("Not available here: Rebase");
    expect(second).not.toBe(first);
  });
});

describe("keys left alone", () => {
  const commit = entry(H, [PARENT]);

  function expectIgnored(target: Element, key: string, init: KeyboardEventInit = {}) {
    const before = dialog.value;
    // The live region keeps its last message from earlier tests; nothing may replace it.
    const message = host.querySelector("[data-announcer] span");
    expect(press(target, key, init)).toBe(false);
    expect(dialog.value).toBe(before);
    expect(posted()).toEqual([]);
    expect(host.querySelector("[data-announcer] span")).toBe(message);
  }

  it("while a dialog is open", () => {
    const row = draw(commit);
    dialog.value = { kind: "error", message: "x", reason: null, token: 1 };
    expectIgnored(row, "b");
  });

  it("while a menu is open", () => {
    const row = draw(commit);
    contextMenu.value = { x: 0, y: 0, entries: [], source: "other" };
    expectIgnored(row, "b");
  });

  it("while an input method is composing", () => {
    const row = draw(commit);
    expectIgnored(row, "b", { isComposing: true });
    expectIgnored(row, "b", { keyCode: 229 });
  });

  it("when single keys are turned off", () => {
    const restore = reconfigure({ singleKeyShortcuts: false });
    try {
      const row = draw(commit);
      for (const key of ["c", "b", "t", "p", "v", "r", "i", "m", "x", "e", "y", "o", "d"]) {
        expectIgnored(row, key);
      }
      expect(toggled).toBe(0);
    } finally {
      restore();
    }
  });

  it("with a modifier, which belongs to VS Code or the browser", () => {
    const row = draw(commit);
    expectIgnored(row, "b", { ctrlKey: true });
    expectIgnored(row, "b", { metaKey: true });
    expectIgnored(row, "b", { altKey: true });
    expectIgnored(row, "B", { shiftKey: true });
  });

  it("when pressed on something inside the row", () => {
    const row = draw(entry(H, [PARENT], { refs: [FEATURE] }));
    const inner = row.querySelector("button")!;
    expectIgnored(inner, "b");
  });

  it("that the table does not name", () => {
    const row = draw(commit);
    expectIgnored(row, "q");
    expectIgnored(row, "z");
  });
});
