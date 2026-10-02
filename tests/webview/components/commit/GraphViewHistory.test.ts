// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HistoryFilter } from "@/backend/types";
import { commitMenuHintDismissed } from "@/webview/lib/hints";
import {
  emptyFilter,
  historyFilter,
  historyOffset,
  selectedCommits
} from "@/webview/lib/navigation";
import { repositoryRevision } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";
import type { BranchDisplay } from "@/webview/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

import {
  buttonNamed,
  chain,
  click,
  hideGraphView,
  lastQuery,
  reply,
  replyWithPage,
  resetGraphView,
  sentQueries,
  showGraphView,
  view,
  withEnglish
} from "./graph-view-harness";

beforeAll(() => setupWebviewTest());
beforeEach(resetGraphView);
afterEach(hideGraphView);

function search(filter: Partial<HistoryFilter>) {
  historyFilter.value = { ...emptyFilter(), ...filter };
}

/** The text on each side of the filtered-history banner. */
function bannerTexts() {
  const hint = [...view().querySelectorAll("span")].find(
    (span) => span.textContent === "filteredHistoryHint"
  );
  expect(hint).toBeDefined();
  return [...hint!.parentElement!.children].map((child) => child.textContent);
}

const spinnerOnly = () =>
  view().querySelector("main [role=status]") !== null && view().querySelector("table") === null;

describe("the history status view", () => {
  it("waits for the first page, then shows the failure with Retry instead of the graph", () => {
    stores.commitList.value = chain("tip", "root");
    stores.commitHead.value = "tip";
    search({ text: "x" });
    showGraphView();

    expect(spinnerOnly()).toBe(true);
    expect(sentQueries("history")).toHaveLength(1);
    expect(lastQuery("history").query.filter.text).toBe("x");
    // Nothing to retry while the page is still on its way.
    expect(buttonNamed("retry")).toBeUndefined();

    reply(lastQuery("history"), { error: "boom" });
    expect(view().querySelector("main [role=alert]")?.textContent).toBe("boom");
    expect(view().querySelector("[data-graph-error]")).toBeNull();
    const main = view().querySelector("main")!;
    const retry = buttonNamed("retry")!;
    expect(retry.parentElement).toBe(main);
    expect(main.querySelector("[role=alert]")!.compareDocumentPosition(retry)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    click("retry");
    expect(repositoryRevision.value).toBeGreaterThan(0);
    expect(sentQueries("history")).toHaveLength(2);
    expect(spinnerOnly()).toBe(true);
    expect(buttonNamed("retry")).toBeUndefined();

    replyWithPage(chain("found"));
    expect(view().textContent).toContain("work on found");
  });

  it("keeps the rows of an unchanged search while it reloads, and replaces them on failure", () => {
    search({ author: "ada" });
    showGraphView();
    replyWithPage(chain("one", "two"));
    expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(2);

    act(() => {
      repositoryRevision.value++;
    });
    expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(2);
    expect(buttonNamed("retry")).toBeUndefined();

    reply(lastQuery("history"), { error: "bad revision" });
    expect(view().querySelector("table")).toBeNull();
    expect(view().querySelector("[role=alert]")?.textContent).toBe("bad revision");
  });

  it("ignores graph errors while a search is shown", () => {
    search({ text: "needle" });
    stores.graphErrors.value = { loadCommits: "graph broke" };
    showGraphView();
    replyWithPage(chain("hit"));
    expect(view().querySelector("[data-graph-error]")).toBeNull();
    expect(view().textContent).toContain("work on hit");
  });

  it("does not ask for history in graph mode", () => {
    stores.commitList.value = chain("only");
    stores.commitHead.value = "only";
    // `follow` alone is no search.
    historyFilter.value = { ...emptyFilter(), follow: true };
    showGraphView();
    expect(sentQueries("history")).toHaveLength(0);
  });
});

describe("the history query", () => {
  it("sends the view's remote choices, the filter and the page", () => {
    stores.selectedBranch.value = "feature";
    search({ text: "needle" });
    showGraphView();
    expect(lastQuery("history").query).toEqual({
      kind: "history",
      showRemoteBranches: true,
      hiddenRemotes: [],
      filter: { ...emptyFilter(), text: "needle", revision: "refs/heads/feature" },
      offset: 0
    });
  });

  it.each<[BranchDisplay, string, string, string]>([
    ["filter", "remotes/origin/x", "", "refs/remotes/origin/x"],
    ["filter", "*", "", ""],
    ["focus", "remotes/origin/x", "", ""],
    ["ancestors", "main", "", ""],
    ["filter", "remotes/origin/x", "v1", "v1"]
  ])("in %s mode on %s with revision %j searches at %j", (display, branch, revision, expected) => {
    stores.branchDisplay.value = display;
    stores.selectedBranch.value = branch;
    search({ text: "t", revision });
    showGraphView();
    expect(lastQuery("history").query.filter.revision).toBe(expected);
  });
});

describe("the filtered-history banner", () => {
  it.each<[Partial<HistoryFilter>, string]>([
    [{ path: "p" }, "p"],
    // A file history opened at a revision still names the file.
    [{ path: "dir/f.txt", revision: "abc" }, "dir/f.txt"],
    [{ author: "a" }, "filteredHistory"],
    [{ since: "2020-01-01" }, "filteredHistory"]
  ])("describes %j as %j", (filter, text) => {
    search(filter);
    showGraphView();
    replyWithPage(chain("match"));
    expect(bannerTexts()).toEqual([text, "filteredHistoryHint"]);
  });

  it.each([
    ["0123456789abcdef0123456789abcdef01234567", "History at 0123456789ab"],
    ["0123456789abcdef".repeat(4), "History at 0123456789ab"],
    ["0123456789abcdef", "History at 0123456789abcdef"],
    ["refs/heads/feature-x", "History at refs/heads/feature-x"],
    ["HEAD~3", "History at HEAD~3"],
    ["v$&1$$", "History at v$&1$$"]
  ])("names the revision %s in full unless it is a whole object name", (revision, text) => {
    withEnglish({ historyAt: "History at {0}", filteredHistoryHint: "hint" });
    search({ revision });
    showGraphView();
    replyWithPage(chain("match"));
    const scope = [...view().querySelectorAll("span")].find((span) =>
      span.textContent?.startsWith("History at")
    );
    expect(scope?.textContent).toBe(text);
  });
});

describe("history pages", () => {
  it("moves to the next page, clearing the selection and waiting for it", () => {
    search({ text: "paged" });
    showGraphView();
    const rows = chain("first", "second");
    replyWithPage(rows, true);
    act(() => {
      selectedCommits.value = [rows[0]!];
    });

    click("nextPage");
    expect(historyOffset.value).toBe(100);
    expect(selectedCommits.value).toEqual([]);
    expect(lastQuery("history").query.offset).toBe(100);
    expect(spinnerOnly()).toBe(true);

    replyWithPage(chain("third"));
    expect(buttonNamed("previousPage")?.disabled).toBe(false);
    expect(buttonNamed("nextPage")?.disabled).toBe(true);
  });

  it("says when nothing matches, above an empty table and without the commit hint", () => {
    stores.commitList.value = chain("graph-row");
    stores.commitHead.value = "graph-row";
    commitMenuHintDismissed.value = false;
    search({ text: "nothing" });
    showGraphView();
    replyWithPage([]);
    const message = [...view().querySelectorAll("p")].find(
      (p) => p.textContent === "noHistoryMatches"
    );
    expect(message).toBeDefined();
    const table = view().querySelector("table")!;
    expect(message!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view().querySelectorAll("tr[data-commit-hash]")).toHaveLength(0);
    expect(view().querySelector("[role=note]")).toBeNull();
  });
});

describe("branches and tags matching the search", () => {
  it("lists them above the results, each opening the history at it", () => {
    search({ text: "rel", author: "ann" });
    showGraphView();
    reply(lastQuery("history"), {
      data: {
        kind: "history",
        page: {
          entries: chain("found"),
          more: false,
          refs: ["refs/tags/release-1", "refs/remotes/origin/release"]
        }
      }
    });
    const chips = [...view().querySelectorAll<HTMLButtonElement>("button[title^='refs/']")];
    expect(chips.map((chip) => [chip.textContent, chip.title])).toStrictEqual([
      ["release-1", "refs/tags/release-1"],
      ["origin/release", "refs/remotes/origin/release"]
    ]);
    act(() => chips[0]!.click());
    expect(historyFilter.value).toStrictEqual({
      ...emptyFilter(),
      revision: "refs/tags/release-1"
    });
  });

  it("shows nothing when no names match", () => {
    search({ text: "rel" });
    showGraphView();
    replyWithPage(chain("found"));
    expect(view().querySelector("button[title^='refs/']")).toBeNull();
    expect(view().textContent).not.toContain("matchingRefs");
  });
});
