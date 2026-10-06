// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRef, HistoryEntry, RepositoryState } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { RefsPane } from "@/webview/components/repository/RefsPane";
import { type Carried, DRAG_TYPE, dropOffer } from "@/webview/lib/drag-drop";
import { commitMenuSource, refMenuSource } from "@/webview/lib/menus";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { repositoryState } from "@/webview/lib/repository-actions";
import {
  commitHead,
  contextMenu,
  dialog,
  expandedCommit,
  headBranch,
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
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const E = "e".repeat(40);

const main: GitRef = { type: "head", name: "main", hash: A };
const topic: GitRef = { type: "head", name: "topic", hash: B };
const feature: GitRef = { type: "head", name: "feature", hash: E };
const originDev: GitRef = { type: "remote", name: "origin/dev", hash: C };
const v1: GitRef = { type: "tag", name: "v1", hash: D };

/**
 * The uncommitted changes, then `main` checked out at A, `topic` at B, `origin/dev` at C, the
 * tag `v1` at D and `feature` at E. C merges E into D.
 */
const COMMITS: Array<HistoryEntry> = [
  entry("*", [A]),
  entry(A, [B], { refs: [main] }),
  entry(B, [C], { refs: [topic] }),
  entry(C, [D, E], { refs: [originDev] }),
  entry(D, [], { refs: [v1] }),
  entry(E, [], { refs: [feature] })
];

const STATE: RepositoryState = {
  remotes: [{ name: "origin", fetchUrls: ["https://example.test/repo.git"], pushUrls: [] }],
  pushDefault: null,
  branches: [main, topic, feature].map((ref) => ({
    name: ref.name,
    hash: ref.hash,
    upstream: "",
    ahead: 0,
    behind: 0,
    gone: false,
    date: 0,
    merged: false
  })),
  remoteBranches: [{ name: "origin/dev", hash: C }],
  tags: [{ name: "v1", hash: D }],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};

/** Strings with their placeholders, so that the tests read what the user would. */
const STRINGS = {
  dropCherryPick: "Cherry-pick {0} onto {1}",
  dropMerge: "Merge {0} into {1}",
  dropRebase: "Rebase {0} onto {1}",
  dropCherryPickCheckout: "Check out {0} first",
  dropMergeOrRebaseCheckout: "Check out {0} to merge {1}, or {1} to rebase it",
  dropRebaseCheckout: "Check out {0} to rebase it onto {1}"
};

/** The parts of the browser's `DataTransfer` the page uses, which jsdom lacks. */
class FakeDataTransfer {
  readonly data = new Map<string, string>();
  dropEffect = "none";
  effectAllowed = "uninitialized";
  image: Element | null = null;
  imageText = "";
  get types() {
    return [...this.data.keys()];
  }
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
  setDragImage(image: Element) {
    this.image = image;
    // Read now: the page takes the picture down once the browser has it.
    this.imageText = image.textContent ?? "";
  }
}

let graph: HTMLDivElement;
let pane: HTMLDivElement;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak(STRINGS);
  stubResizeObserver();
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  selectedRepo.value = "/repo";
  repoStates.value = {};
  headBranch.value = "main";
  commitHead.value = A;
  expandedCommit.value = null;
  focusedCommit.value = null;
  selectedCommits.value = [];
  contextMenu.value = null;
  dialog.value = null;
  uncommittedChanges.value = 1;
  repositoryState.value = STATE;
  graph = attachHost();
  pane = attachHost();
  draw();
  vscodeApi.postMessage.mockClear();
});
afterEach(() => {
  for (const host of [graph, pane]) {
    act(() => render(null, host));
    host.remove();
  }
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  // A drag a test left open ends, as Escape ends it in the browser.
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
});

function draw() {
  act(() => {
    render(h(CommitTable, { commits: COMMITS, head: A, headBranch: headBranch.value }), graph);
    render(h(RefsPane, {}), pane);
  });
}

const row = (hash: string) =>
  graph.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${hash}"]`)!;
/** A branch or tag label on a commit row, by its name. */
const label = (name: string) =>
  [...graph.querySelectorAll<HTMLElement>("tr[data-commit-hash] span[title]")].find(
    (span) => span.title.split("\n")[0] === name
  )!;
/** A Branches pane row, by the name its label button shows. */
const paneRow = (name: string) =>
  [...pane.querySelectorAll<HTMLElement>("button[title]")]
    .find((button) => button.textContent === name)!
    .closest<HTMLElement>("div")!;
const hint = () => document.querySelector<HTMLElement>("[data-drop-hint]");
const hintText = () => (hint()?.hidden === false ? hint()!.textContent : null);
/** The subject line of a commit row, away from its labels. */
const subject = (element: Element) => element.querySelector("span.flex-1.truncate")!;

/** Send a drag event of `type` to `target`, carrying `data`, and return it. */
function drag(type: string, target: Element, data: FakeDataTransfer, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 80,
    ...init
  });
  Object.defineProperty(event, "dataTransfer", { value: data });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Drag from `from` over `to` and drop there, as the browser would; returns the drag's data. */
function dragAndDrop(from: Element, to: Element) {
  const data = new FakeDataTransfer();
  drag("dragstart", from, data);
  drag("dragover", to, data);
  drag("drop", to, data);
  drag("dragend", from, data);
  return data;
}

function carriedOf(data: FakeDataTransfer) {
  return JSON.parse(data.getData(DRAG_TYPE)) as unknown;
}

describe("what a drag carries", () => {
  it("carries a commit from anywhere on its row, pictured by its short ID and subject", () => {
    const data = new FakeDataTransfer();
    const start = drag("dragstart", subject(row(B)), data);
    expect(start.defaultPrevented).toBe(false);
    expect(carriedOf(data)).toEqual({ kind: "commit", hash: B });
    expect(data.effectAllowed).toBe("copy");
    expect(data.imageText).toBe(`${abbrevCommit(B)}subject of ${B}`);
    expect(data.image?.className).toContain("border-focus");
  });

  it("carries a local branch from its label, pictured by its name", () => {
    const data = new FakeDataTransfer();
    drag("dragstart", label("topic"), data);
    expect(carriedOf(data)).toEqual({ kind: "branch", name: "topic" });
    expect(data.effectAllowed).toBe("move");
    expect(data.imageText).toBe("topic");
    expect(data.image?.querySelector("svg")).not.toBeNull();
  });

  it("carries the commit when a remote branch or tag label is dragged, which are never moved", () => {
    const remote = new FakeDataTransfer();
    drag("dragstart", label("origin/dev"), remote);
    expect(carriedOf(remote)).toEqual({ kind: "commit", hash: C });
    const tag = new FakeDataTransfer();
    drag("dragstart", label("v1"), tag);
    expect(carriedOf(tag)).toEqual({ kind: "commit", hash: D });
  });

  it("carries a local branch from the Branches pane, and nothing from a remote or tag row", () => {
    const data = new FakeDataTransfer();
    drag("dragstart", paneRow("topic").querySelector("button")!, data);
    expect(carriedOf(data)).toEqual({ kind: "branch", name: "topic" });
    expect(paneRow("topic").getAttribute("draggable")).toBe("true");
    expect(paneRow("dev").hasAttribute("draggable")).toBe(false);
    expect(paneRow("v1").hasAttribute("data-ref")).toBe(false);
  });

  it("makes commit rows and local labels draggable, but not the uncommitted changes", () => {
    expect(row(B).getAttribute("draggable")).toBe("true");
    expect(row("*").hasAttribute("draggable")).toBe(false);
    expect(label("main").getAttribute("draggable")).toBe("true");
    expect(label("origin/dev").hasAttribute("draggable")).toBe(false);
    expect(label("v1").hasAttribute("draggable")).toBe(false);
  });

  it("leaves a drag that starts in the details panel to the browser", () => {
    act(() => {
      expandedCommit.value = B;
    });
    draw();
    const details = row(B).nextElementSibling!;
    expect(details.hasAttribute("data-commit-hash")).toBe(false);
    const data = new FakeDataTransfer();
    drag("dragstart", details.querySelector("td") ?? details, data);
    expect(data.types).toEqual([]);
    expect(data.image).toBeNull();
    // Nothing is carried, so no branch takes a drop.
    expect(drag("dragover", label("main"), data).defaultPrevented).toBe(false);
  });
});

describe("which drops are valid", () => {
  const commit = (hash: string): Carried => ({
    kind: "commit",
    commit: COMMITS.find((item) => item.hash === hash)!,
    messages: new Map()
  });
  const branch = (ref: GitRef): Carried => ({ kind: "branch", ref });
  const offer = (carried: Carried, target: GitRef) => {
    const { actions, hint: text } = dropOffer(carried, target);
    return { actions: actions.map((action) => action.title), hint: text };
  };

  it("takes a commit onto the checked-out branch only", () => {
    expect(offer(commit(B), main)).toEqual({
      actions: [`Cherry-pick ${abbrevCommit(B)} onto main`],
      hint: `Cherry-pick ${abbrevCommit(B)} onto main`
    });
    expect(offer(commit(A), topic)).toEqual({ actions: [], hint: "Check out topic first" });
    expect(offer(commit(A), originDev)).toEqual({
      actions: [],
      hint: "Check out origin/dev first"
    });
    // The branch's own tip is on it already.
    expect(offer(commit(A), main)).toEqual({ actions: [], hint: null });
  });

  it("merges a branch into the checked-out branch, and rebases only the checked-out branch", () => {
    expect(offer(branch(topic), main).actions).toEqual(["Merge topic into main"]);
    expect(offer(branch(main), topic).actions).toEqual(["Rebase main onto topic"]);
    expect(offer(branch(main), originDev).actions).toEqual(["Rebase main onto origin/dev"]);
  });

  it("explains which branch to check out when neither is", () => {
    expect(offer(branch(topic), feature)).toEqual({
      actions: [],
      hint: "Check out feature to merge topic, or topic to rebase it"
    });
    expect(offer(branch(topic), originDev)).toEqual({
      actions: [],
      hint: "Check out topic to rebase it onto origin/dev"
    });
  });

  it("offers nothing for a branch onto itself or a tag, nor a remote branch dragged anywhere", () => {
    expect(offer(branch(main), main)).toEqual({ actions: [], hint: null });
    expect(offer(branch(originDev), main)).toEqual({ actions: [], hint: null });
    expect(offer(commit(B), v1).actions).toEqual([]);
    expect(offer(branch(topic), v1).actions).toEqual([]);
  });

  it("offers nothing on a detached HEAD, where no branch is checked out", () => {
    headBranch.value = null;
    expect(offer(commit(B), main).actions).toEqual([]);
    expect(offer(branch(topic), main).actions).toEqual([]);
    expect(offer(branch(main), topic).actions).toEqual([]);
  });

  it("outlines a branch that takes the drop and refuses one that does not, saying why", () => {
    const data = new FakeDataTransfer();
    drag("dragstart", row(B), data);

    const accepted = drag("dragover", label("main"), data, { clientX: 100, clientY: 200 });
    expect(accepted.defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe("copy");
    expect(label("main").dataset["drop"]).toBe("valid");
    expect(label("main").className).toContain("data-[drop=valid]:outline-focus");
    expect(hintText()).toBe(`Cherry-pick ${abbrevCommit(B)} onto main`);
    expect(hint()!.style.top).toBe("168px");

    const refused = drag("dragover", label("topic"), data);
    expect(refused.defaultPrevented).toBe(false);
    expect(data.dropEffect).toBe("none");
    expect(label("main").hasAttribute("data-drop")).toBe(false);
    expect(label("topic").dataset["drop"]).toBe("invalid");
    expect(hintText()).toBe("Check out topic first");

    // A commit row is no target: no outline, no hint.
    const elsewhere = drag("dragover", row(C), data);
    expect(elsewhere.defaultPrevented).toBe(false);
    expect(data.dropEffect).toBe("none");
    expect(graph.querySelector("[data-drop]")).toBeNull();
    expect(hintText()).toBeNull();

    // Leaving the table takes the marks down; the drag goes on.
    drag("dragover", paneRow("main"), data);
    expect(paneRow("main").dataset["drop"]).toBe("valid");
    drag("dragleave", pane.querySelector("nav")!, data, { relatedTarget: null });
    expect(pane.querySelector("[data-drop]")).toBeNull();
    expect(hintText()).toBeNull();
  });
});

describe("what a drop opens", () => {
  it("opens the cherry-pick confirmation of the commit's menu, and runs nothing yet", () => {
    dragAndDrop(row(B), label("main"));
    expect(dialog.value).toMatchObject({
      kind: "form",
      action: "dialogYesCherryPick",
      source: commitMenuSource(B),
      inputs: []
    });
    expect(contextMenu.value).toBeNull();
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(graph.querySelector("[data-drop]")).toBeNull();
    expect(hintText()).toBeNull();
  });

  it("asks which parent of a merge commit to cherry-pick against, as the menu does", () => {
    dragAndDrop(row(C), paneRow("main"));
    expect(dialog.value).toMatchObject({ kind: "form", action: "dialogYesCherryPick" });
    expect(dialog.value?.kind === "form" && dialog.value.inputs[0]?.kind).toBe("select");
  });

  it("opens the merge confirmation for a branch dropped on the checked-out one", () => {
    dragAndDrop(label("topic"), label("main"));
    expect(contextMenu.value).toBeNull();
    expect(dialog.value).toMatchObject({
      kind: "form",
      action: "dialogYesMerge",
      source: refMenuSource(topic)
    });
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("opens the rebase confirmation for the checked-out branch dropped on another", () => {
    dragAndDrop(paneRow("main"), label("origin/dev"));
    expect(contextMenu.value).toBeNull();
    expect(dialog.value).toMatchObject({ kind: "form", action: "startRebase", inputs: [] });
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("does nothing for a refused drop, or a commit dropped on another commit", () => {
    dragAndDrop(row(A), label("topic"));
    dragAndDrop(label("topic"), label("feature"));
    dragAndDrop(row(B), row(C));
    dragAndDrop(label("topic"), label("v1"));
    expect(dialog.value).toBeNull();
    expect(contextMenu.value).toBeNull();
  });
});

describe("cancelling and turning off", () => {
  it("cancels the drag on Escape: the marks go and a later drop does nothing", () => {
    const data = new FakeDataTransfer();
    drag("dragstart", row(B), data);
    drag("dragover", label("main"), data);
    expect(label("main").dataset["drop"]).toBe("valid");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(label("main").hasAttribute("data-drop")).toBe(false);
    expect(hintText()).toBeNull();
    expect(drag("dragover", label("main"), data).defaultPrevented).toBe(false);
    drag("drop", label("main"), data);
    expect(dialog.value).toBeNull();
    // The next drag starts afresh.
    dragAndDrop(row(B), label("main"));
    expect(dialog.value).toMatchObject({ action: "dialogYesCherryPick" });
  });

  it("ends the drag when the browser does, without a drop", () => {
    const data = new FakeDataTransfer();
    drag("dragstart", label("topic"), data);
    drag("dragover", label("main"), data);
    drag("dragend", label("topic"), data);
    expect(label("main").hasAttribute("data-drop")).toBe(false);
    drag("drop", label("main"), data);
    expect(contextMenu.value).toBeNull();
  });

  it("starts no drag while the setting is off", () => {
    const restore = reconfigure({ dragAndDrop: false });
    try {
      draw();
      // Preact writes the property back, which leaves `draggable="false"` behind.
      expect(row(B).getAttribute("draggable")).not.toBe("true");
      expect(label("main").getAttribute("draggable")).not.toBe("true");
      expect(paneRow("topic").getAttribute("draggable")).not.toBe("true");
      const data = dragAndDrop(row(B), label("main"));
      expect(data.types).toEqual([]);
      expect(dialog.value).toBeNull();
      expect(contextMenu.value).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("other uses of the mouse", () => {
  it("keeps click, Ctrl+click and Shift+click selection on draggable rows", () => {
    const click = (hash: string, init: MouseEventInit = {}) =>
      act(() => {
        subject(row(hash)).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, ...init })
        );
      });
    click(A);
    expect(selectedCommits.value.map((item) => item.hash)).toEqual([A]);
    expect(expandedCommit.value).toBe(A);
    click(C, { ctrlKey: true });
    expect(selectedCommits.value.map((item) => item.hash)).toEqual([A, C]);
    // A drag that is dropped nowhere leaves the selection as it was.
    dragAndDrop(row(B), row(B));
    expect(selectedCommits.value.map((item) => item.hash)).toEqual([A, C]);
    click(E, { shiftKey: true });
    expect(selectedCommits.value.map((item) => item.hash)).toEqual([C, D, E]);
  });

  it("keeps a label's menu and double-click checkout", () => {
    act(() => {
      label("topic").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
      );
    });
    expect(contextMenu.value?.source).toBe(refMenuSource(topic));
    act(() => {
      label("topic").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "checkoutBranch", branchName: "topic" })
    );
  });
});
