// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { endPreview, PREVIEW_DELAY_MS, previewTarget } from "@/webview/lib/branch-preview";
import {
  emptyFilter,
  focusedCommit,
  historyFilter,
  selectedCommits
} from "@/webview/lib/navigation";
import { repositoryRevision } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

import { reconfigure } from "./commit-view-fixtures";
import {
  entry,
  hideGraphView,
  lastQuery,
  relationOf,
  reply,
  replyWithPage,
  resetGraphView,
  sentQueries,
  showGraphView,
  view
} from "./graph-view-harness";

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => endPreview());
  vi.useRealTimers();
  hideGraphView();
});

/**
 * main: tip - base; topic: work - base; v1 tags base. Rows newest first, the checked-out branch
 * on top.
 */
function load() {
  const tip: HistoryEntry = {
    ...entry("tip", "base"),
    refs: [{ type: "head", name: "main", hash: "tip" }]
  };
  const work: HistoryEntry = {
    ...entry("work", "base"),
    refs: [{ type: "head", name: "topic", hash: "work" }]
  };
  const base: HistoryEntry = {
    ...entry("base"),
    refs: [{ type: "tag", name: "v1", hash: "base" }]
  };
  stores.commitList.value = [tip, work, base];
  stores.commitHead.value = "tip";
}

/** The label of `name` on the graph. */
function refLabel(name: string) {
  const found = [...view().querySelectorAll<HTMLElement>("tbody span[title]")].find(
    (span) => span.title.split("\n")[0] === name && span.querySelector("svg") !== null
  );
  expect(found, `label ${name}`).toBeDefined();
  return found!;
}

const enter = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("mouseenter"));
  });
const leave = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("mouseleave"));
  });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

function previewed() {
  return [...view().querySelectorAll<HTMLElement>("tr[data-preview-branch]")].map((row) => [
    row.dataset["commitHash"],
    row.dataset["previewBranch"]
  ]);
}

/** Answer the latest focus-membership query. */
function answer(direct: string[], merged: string[] = []) {
  reply(lastQuery("branchFocus"), {
    data: { kind: "branchFocus", tip: direct[0] ?? "", direct, merged }
  });
}

describe("the branch preview", () => {
  it("shows a label's history once the pointer has rested on it, and asks nothing before", () => {
    load();
    showGraphView();
    enter(refLabel("topic"));
    wait(PREVIEW_DELAY_MS - 1);
    expect(sentQueries("branchFocus")).toHaveLength(0);
    expect(previewTarget.value).toBeNull();

    wait(1);
    expect(lastQuery("branchFocus").query).toEqual({
      kind: "branchFocus",
      branch: "topic",
      hashes: ["tip", "work", "base"]
    });
    answer(["work", "base"]);
    expect(previewed()).toEqual([
      ["work", "topic"],
      ["base", "topic"]
    ]);
    expect(relationOf("tip")).toBe("unrelated");
    expect(view().querySelector("[data-branch-preview]")?.getAttribute("data-branch-preview")).toBe(
      "topic"
    );

    leave(refLabel("topic"));
    expect(previewed()).toEqual([]);
    expect(relationOf("tip")).toBe("normal");
    expect(view().querySelector("[data-branch-preview]")).toBeNull();
  });

  it("changes neither the focus, the selection, the keyboard focus nor the scroll position", () => {
    load();
    showGraphView();
    const row = view().querySelector<HTMLElement>('tr[data-commit-hash="tip"]')!;
    act(() => row.focus());
    selectedCommits.value = [stores.commitList.value![0]!];
    const before = () => [
      stores.selectedBranch.value,
      stores.branchDisplay.value,
      stores.focusPaused.value,
      selectedCommits.value.map((commit) => commit.hash),
      focusedCommit.value,
      stores.expandedCommit.value,
      document.activeElement,
      window.scrollY
    ];
    const start = before();
    enter(refLabel("topic"));
    wait(PREVIEW_DELAY_MS);
    answer(["work", "base"]);
    expect(previewed()).toHaveLength(2);
    expect(before()).toEqual(start);
    leave(refLabel("topic"));
    expect(before()).toEqual(start);
  });

  it("shows over a focus and gives the focus back exactly", () => {
    load();
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    showGraphView();
    answer(["tip", "base"]);
    const focused = ["tip", "work", "base"].map(relationOf);
    expect(focused).toEqual(["direct", "unrelated", "direct"]);

    enter(refLabel("topic"));
    wait(PREVIEW_DELAY_MS);
    answer(["work", "base"]);
    expect(["tip", "work", "base"].map(relationOf)).toEqual(["unrelated", "direct", "direct"]);
    expect(stores.selectedBranch.value).toBe("main");

    leave(refLabel("topic"));
    expect(["tip", "work", "base"].map(relationOf)).toEqual(focused);
    expect(previewed()).toEqual([]);
    expect(view().querySelector('[data-focus-branch="main"]')).not.toBeNull();
  });

  it("reuses the focus's answer for the focused branch, and its own answers after that", () => {
    load();
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    showGraphView();
    answer(["tip", "base"]);
    const asked = sentQueries("branchFocus").length;

    enter(refLabel("main"));
    wait(PREVIEW_DELAY_MS);
    expect(sentQueries("branchFocus")).toHaveLength(asked);
    expect(previewed()).toEqual([
      ["tip", "main"],
      ["base", "main"]
    ]);
    leave(refLabel("main"));

    enter(refLabel("v1"));
    wait(PREVIEW_DELAY_MS);
    expect(lastQuery("branchFocus").query).toMatchObject({ branch: "v1", tag: true });
    answer(["base"]);
    expect(previewed()).toEqual([["base", "v1"]]);
    leave(refLabel("v1"));

    enter(refLabel("v1"));
    wait(PREVIEW_DELAY_MS);
    expect(sentQueries("branchFocus")).toHaveLength(asked + 1);
    expect(previewed()).toEqual([["base", "v1"]]);

    // A new revision of the repository may have moved the tag: ask again.
    act(() => {
      repositoryRevision.value++;
    });
    expect(previewed()).toEqual([]);
    expect(sentQueries("branchFocus").length).toBeGreaterThan(asked + 1);
  });

  it("is cancelled by leaving before the delay, and ended by Escape, a scroll or a click", () => {
    load();
    showGraphView();
    enter(refLabel("topic"));
    wait(PREVIEW_DELAY_MS / 2);
    leave(refLabel("topic"));
    wait(PREVIEW_DELAY_MS);
    expect(previewTarget.value).toBeNull();
    expect(sentQueries("branchFocus")).toHaveLength(0);

    const shown = () => {
      enter(refLabel("topic"));
      wait(PREVIEW_DELAY_MS);
      expect(previewTarget.value).toEqual({ name: "topic", tag: false });
    };

    shown();
    const onEscape = vi.fn();
    window.addEventListener("keydown", onEscape);
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    window.removeEventListener("keydown", onEscape);
    expect(previewTarget.value).toBeNull();
    // Escape only closed the preview, as it closes a tooltip.
    expect(onEscape).not.toHaveBeenCalled();
    leave(refLabel("topic"));

    shown();
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(previewTarget.value).toBeNull();
    leave(refLabel("topic"));

    shown();
    act(() => {
      view()
        .querySelector("tbody")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(previewTarget.value).toBeNull();
  });

  it("lets other keys through, and Escape too while nothing is shown yet", () => {
    load();
    showGraphView();
    enter(refLabel("topic"));
    const keys = vi.fn();
    window.addEventListener("keydown", keys);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    window.removeEventListener("keydown", keys);
    expect(keys).toHaveBeenCalledTimes(2);
    wait(PREVIEW_DELAY_MS);
    expect(previewTarget.value).toBeNull();
  });

  it("does nothing while branchwise.branchHoverPreview is off", () => {
    const restore = reconfigure({ branchHoverPreview: false });
    try {
      load();
      showGraphView();
      enter(refLabel("topic"));
      wait(PREVIEW_DELAY_MS * 2);
      expect(previewTarget.value).toBeNull();
      expect(sentQueries("branchFocus")).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe("the nearest branch", () => {
  it("follows the message of each commit without a branch label", () => {
    load();
    showGraphView();
    const nearest = [...view().querySelectorAll<HTMLElement>("[data-nearest-branch]")];
    // `base` carries only a tag; `tip` and `work` carry their own branches.
    expect(nearest.map((element) => element.closest("tr")?.dataset["commitHash"])).toEqual([
      "base"
    ]);
    // The checked-out branch wins the tie with topic, one step above as well.
    expect(nearest[0]!.dataset["nearestBranch"]).toBe("main");
    expect(nearest[0]!.textContent).toBe("nearestBranch");
    expect(nearest[0]!.title).toBe("nearestBranchTitle");
    expect(view().querySelector('tr[data-commit-hash="base"]')?.getAttribute("aria-label")).toMatch(
      /nearestBranch$/
    );
  });

  it("is not shown on the uncommitted row", () => {
    load();
    stores.commitList.value = [{ ...entry("*", "tip"), message: "" }, ...stores.commitList.value!];
    showGraphView();
    expect(view().querySelector('tr[data-commit-hash="*"] [data-nearest-branch]')).toBeNull();
    expect(view().querySelectorAll("[data-nearest-branch]")).toHaveLength(1);
  });

  it("is not shown in search results, whose parents are mostly not loaded", () => {
    historyFilter.value = { ...emptyFilter(), text: "work" };
    showGraphView();
    replyWithPage([
      { ...entry("work", "base"), refs: [{ type: "head", name: "topic", hash: "work" }] },
      entry("base")
    ]);
    expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(2);
    expect(view().querySelectorAll("[data-nearest-branch]")).toHaveLength(0);
  });

  it("is not shown while branchwise.showNearestBranch is off", () => {
    const restore = reconfigure({ showNearestBranch: false });
    try {
      load();
      showGraphView();
      expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(3);
      expect(view().querySelectorAll("[data-nearest-branch]")).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
