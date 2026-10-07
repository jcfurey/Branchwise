// @vitest-environment jsdom
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { refresh } from "@/webview/lib/actions";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import { commitMenuHintDismissed } from "@/webview/lib/hints";
import { restoreScroll, selectedCommits } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

import {
  buttonNamed,
  chain,
  click,
  entry,
  hideGraphView,
  lastQuery,
  reply,
  resetGraphView,
  sentQueries,
  showGraphView,
  view,
  withEnglish
} from "./graph-view-harness";

beforeAll(() => setupWebviewTest());
beforeEach(resetGraphView);
afterEach(hideGraphView);

function showRows(hashes: string[]) {
  stores.commitList.value = chain(...hashes);
  stores.commitHead.value = hashes[0] ?? null;
  return showGraphView();
}

/** Wait until the browser has painted, which runs any pending animation frame. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("which view is shown", () => {
  it("waits in placeholder rows until the first rows arrive, posting nothing", () => {
    showGraphView();
    const main = view().querySelector("main")!;
    const statuses = main.querySelectorAll("[role=status]");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]!.hasAttribute("data-graph-skeleton")).toBe(true);
    expect(statuses[0]!.getAttribute("aria-busy")).toBe("true");
    expect(main.textContent).toBe("");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("keeps the rows it has, with no placeholders, while a refresh loads", () => {
    refresh();
    loadPage(3, false);
    showGraphView();
    expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(3);

    refresh();
    expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(3);
    expect(view().querySelector("[data-graph-skeleton]")).toBeNull();
  });

  it("offers to create the first commit in a repository without one", () => {
    // A focused branch asks for nothing either: there are no rows to ask about.
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    showRows([]);
    expect(view().textContent).toContain("noCommits");
    expect(view().querySelector("table")).toBeNull();
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("shows an empty table when there are no rows but HEAD has a commit", () => {
    commitMenuHintDismissed.value = false;
    stores.commitHead.value = "abc";
    stores.commitList.value = [];
    showGraphView();
    const main = view().querySelector("main")!;
    expect([...main.children].map((child) => child.getAttribute("role"))).toContain("note");
    expect(main.querySelector("table")).not.toBeNull();
    expect(main.textContent).not.toContain("noCommits");
  });

  it("lays out a failed graph load as a heading, the message and Retry", () => {
    stores.graphErrors.value = { loadCommits: "" };
    showGraphView();
    const main = view().querySelector("main")!;
    expect(main.getAttribute("data-graph-error")).toBe("true");
    expect([...main.children].map((child) => child.tagName)).toEqual(["H2", "DIV", "BUTTON"]);
    expect(main.querySelector("h2")!.textContent).toBe("unableToLoad");
    expect(main.querySelector("h2")!.hasAttribute("role")).toBe(false);
    expect(main.querySelector("[role=alert]")!.tagName).toBe("P");
    expect(main.querySelector("[role=alert]")!.textContent).toBe("unableToLoad");
    expect(buttonNamed("copyError")).toBeDefined();
    expect(main.lastElementChild!.textContent).toBe("retry");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    [{ loadCommits: "C", loadBranches: "B" }, "B"],
    [{ loadCommits: "C" }, "C"],
    [{ loadBranches: "", loadCommits: "C" }, "unableToLoad"],
    [{ loadBranches: "B" }, "B"]
  ])("shows the failure of %j as %j", (errors, message) => {
    stores.graphErrors.value = errors;
    showGraphView();
    expect(view().querySelector("[role=alert]")?.textContent).toBe(message);
  });

  it("replaces rows already shown when a reload fails", () => {
    showRows(["kept"]);
    expect(view().querySelector("table")).not.toBeNull();
    act(() => {
      stores.graphErrors.value = { loadCommits: "x" };
    });
    expect(view().querySelector("[data-graph-error]")).not.toBeNull();
    expect(view().querySelector("table")).toBeNull();
    click("retry");
    expect(stores.graphErrors.value).toEqual({});
    expect(view().querySelector("table")).not.toBeNull();
  });
});

describe("the selection bar", () => {
  it("compares two commits in the order they were selected", () => {
    const [newer, older] = chain("newer", "older");
    showRows(["newer", "older"]);
    act(() => {
      selectedCommits.value = [older!, newer!];
    });
    for (const name of ["compareSelected", "batchCherryPick", "batchRevert", "clearSelection"]) {
      expect(buttonNamed(name), name).toBeDefined();
    }
    expect(view().textContent).toContain("selectedCount");

    click("compareSelected");
    const dialog = stores.dialog.value;
    expect(dialog?.kind).toBe("content");
    const content = (dialog as { content: VNode<{ left: string; right: string }> }).content;
    expect(content.props).toMatchObject({ left: "older", right: "newer" });
  });

  it("counts larger selections and asks for a plan of the batch", () => {
    withEnglish({ selectedCount: "{0} commits selected" });
    showRows(["c", "b", "a"]);
    act(() => {
      selectedCommits.value = chain("c", "b", "a");
    });
    expect(view().textContent).toContain("3 commits selected");
    expect(buttonNamed("compareSelected")).toBeUndefined();

    click("batchRevert");
    expect(sentQueries("batchPlan")).toHaveLength(1);
  });

  it("disables the batches above 100 commits and clears the selection", () => {
    showRows(["one"]);
    act(() => {
      selectedCommits.value = Array.from({ length: 101 }, (_, index) => entry(`h${index}`));
    });
    expect(buttonNamed("batchCherryPick")?.disabled).toBe(true);
    expect(buttonNamed("batchRevert")?.disabled).toBe(true);
    expect(buttonNamed("clearSelection")?.disabled).toBe(false);

    click("clearSelection");
    expect(selectedCommits.value).toEqual([]);
    expect(buttonNamed("clearSelection")).toBeUndefined();
  });

  it("stays away for a single selected commit", () => {
    showRows(["solo"]);
    act(() => {
      selectedCommits.value = chain("solo");
    });
    expect(buttonNamed("clearSelection")).toBeUndefined();
    expect(buttonNamed("squashSelected")).toBeUndefined();
  });

  it("opens consecutive commits of the current branch in the rebase editor to squash", () => {
    withEnglish({ squashSelected: "Squash {0} Commits…" });
    showRows(["d", "c", "b", "a"]);
    act(() => {
      selectedCommits.value = chain("d", "c", "b", "a").slice(0, 3);
    });
    const squash = buttonNamed("Squash 3 Commits…");
    expect(squash?.disabled).toBe(false);
    expect(squash?.title).toBe("");

    click("Squash 3 Commits…");
    // Only the plan is asked for: the history changes once the editor's plan is started.
    expect(sentQueries("rebasePlan").map(({ query }) => query)).toEqual([
      { kind: "rebasePlan", base: "a", autosquash: false, squash: ["b", "c", "d"] }
    ]);
    expect(sentQueries("rebasePlan")[0]?.repo).toBe("/work/repo");

    // The plan opens in the interactive rebase editor, for the user to review and start.
    const plan = {
      base: "a",
      head: "d",
      branch: "main",
      entries: (["b", "c", "d"] as const).map((hash, index) => ({
        hash,
        message: hash,
        action: index === 0 ? ("pick" as const) : ("squash" as const)
      }))
    };
    reply(lastQuery("rebasePlan"), { data: { kind: "rebasePlan", plan } });
    const dialog = stores.dialog.value as { kind: string; message: string; content: VNode };
    expect(dialog.kind).toBe("content");
    expect(dialog.message).toBe("rebasePlanTitle");
    expect(dialog.content.props).toMatchObject({ plan, repo: "/work/repo" });
  });

  it.each([
    ["the root commit", ["b", "a"], "squashRootSelected"],
    ["a gap", ["d", "b"], "squashNotConsecutive"]
  ])("disables the squash for a selection with %s and says why", (_, hashes, reason) => {
    showRows(["d", "c", "b", "a"]);
    const rows = chain("d", "c", "b", "a");
    act(() => {
      selectedCommits.value = rows.filter((row) => hashes.includes(row.hash));
    });
    const squash = buttonNamed("squashSelected");
    expect(squash?.disabled).toBe(true);
    expect(squash?.title).toBe(reason);
    expect(buttonNamed("batchCherryPick")?.disabled).toBe(false);
  });

  it("disables the squash for commits of another branch", () => {
    // HEAD is `main`; `y` and `x` sit on a branch off `a`.
    stores.commitList.value = [
      entry("y", "x"),
      entry("main", "a"),
      entry("x", "a"),
      entry("a", "root"),
      entry("root")
    ];
    stores.commitHead.value = "main";
    showGraphView();
    act(() => {
      selectedCommits.value = [entry("y", "x"), entry("x", "a")];
    });
    expect(buttonNamed("squashSelected")?.title).toBe("squashOtherBranch");
    expect(buttonNamed("squashSelected")?.disabled).toBe(true);
  });
});

describe("the commit menu hint", () => {
  it("goes when dismissed, and remembers that in the page state", () => {
    vscodeApi.getState.mockReturnValueOnce({ navigation: { repos: {}, workspace: true } });
    commitMenuHintDismissed.value = false;
    showRows(["tip"]);
    const note = view().querySelector("[role=note]")!;
    expect(note.querySelector("span")?.textContent).toBe("commitMenuHint");
    const dismiss = note.querySelector("button")!;
    expect(dismiss.type).toBe("button");
    expect(dismiss.getAttribute("aria-label")).toBe("dialogDismiss");

    act(() => dismiss.click());
    expect(view().querySelector("[role=note]")).toBeNull();
    expect(vscodeApi.setState).toHaveBeenLastCalledWith({
      navigation: { repos: {}, workspace: true },
      hints: { commitMenu: true }
    });
  });

  it("goes once a commit's menu opens", () => {
    commitMenuHintDismissed.value = false;
    showRows(["tip"]);
    act(() => {
      stores.contextMenu.value = { x: 0, y: 0, entries: [], source: "commit:tip" };
    });
    expect(view().querySelector("[role=note]")).toBeNull();
  });
});

/** Answer the latest commit request with a page of this many rows. */
function loadPage(size: number, more: boolean) {
  const hashes = Array.from({ length: size }, (_, index) => `p${index}`);
  act(() =>
    handleLoadCommits({
      ...latestGraphRequest("loadCommits"),
      commits: chain(...hashes),
      head: hashes[0] ?? null,
      moreCommitsAvailable: more,
      uncommittedChanges: 0
    })
  );
}

describe("loading more commits", () => {
  it("asks for another page and waits for it in place of the button", () => {
    stores.maxCommits.value = 2;
    refresh();
    loadPage(2, true);
    showGraphView();
    const button = buttonNamed("loadMore")!;
    expect(button.parentElement!.parentElement!.tagName).toBe("MAIN");

    vscodeApi.postMessage.mockClear();
    click("loadMore");
    expect(stores.maxCommits.value).toBe(102);
    expect(latestGraphRequest("loadCommits").maxCommits).toBe(102);
    expect(buttonNamed("loadMore")).toBeUndefined();
    expect(view().querySelector("main > [role=status]")).not.toBeNull();

    loadPage(102, true);
    expect(buttonNamed("loadMore")).toBeDefined();
    refresh();
    loadPage(40, false);
    expect(buttonNamed("loadMore")).toBeUndefined();
    expect(view().querySelector("main > [role=status]")).toBeNull();
  });
});

describe("restoring the scroll position", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scrolls once the rows are there, and only once", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    restoreScroll.value = 420;
    showGraphView();
    await nextFrame();
    await nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => {
      stores.commitList.value = chain("top");
      stores.commitHead.value = "top";
    });
    await nextFrame();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
    expect(restoreScroll.value).toBeNull();

    act(() => {
      stores.commitList.value = chain("newer", "top");
    });
    await nextFrame();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls nowhere once the view is gone", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    restoreScroll.value = 99;
    showRows(["top"]);
    hideGraphView();
    await nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(restoreScroll.value).toBe(99);
  });

  it("starts over when another repository's rows replace the pending ones", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    restoreScroll.value = 10;
    showRows(["first"]);
    act(() => {
      restoreScroll.value = 20;
      stores.selectedRepo.value = "/work/other";
      stores.commitList.value = chain("second");
    });
    await nextFrame();
    expect(scrollTo.mock.calls).toEqual([[0, 20]]);
  });
});
