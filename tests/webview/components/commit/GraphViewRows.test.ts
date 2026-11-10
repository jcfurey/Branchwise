// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { refresh, toggleCommitDetails } from "@/webview/lib/actions";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import { emptyFilter, selectedCommits, setHistoryFilter } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

import {
  chain,
  hideGraphView,
  lastQuery,
  reply,
  resetGraphView,
  showGraphView,
  view
} from "./graph-view-harness";

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  stores.commitList.value = chain("c3", "c2", "c1", "base");
  stores.commitHead.value = "c3";
});
afterEach(() => hideGraphView());

const shownRows = () =>
  [...view().querySelectorAll<HTMLElement>("tr[data-commit-hash]")].map(
    (row) => row.dataset.commitHash
  );

/** The graph's rows after a reload, as the extension answers a refresh. */
function reload(...hashes: string[]) {
  act(() => refresh());
  const request = latestGraphRequest("loadCommits");
  act(() =>
    handleLoadCommits({
      ...request,
      commits: chain(...hashes),
      head: hashes[0]!,
      moreCommitsAvailable: false,
      uncommittedChanges: 0
    } as Parameters<typeof handleLoadCommits>[0])
  );
}

describe("a selection", () => {
  it("lets go of commits a reload no longer shows, as after squashing them", () => {
    showGraphView();
    act(() => {
      selectedCommits.value = stores.commitList.value!.slice(0, 3);
    });
    expect(view().textContent).toContain("selectedCount");

    reload("squashed", "base");
    expect(shownRows()).toStrictEqual(["squashed", "base"]);
    expect(selectedCommits.value).toStrictEqual([]);
    expect(view().textContent).not.toContain("selectedCount");
  });

  it("keeps the commits that are still shown", () => {
    showGraphView();
    act(() => {
      selectedCommits.value = stores.commitList.value!.slice(1, 4);
    });
    reload("new", "c1", "base");
    expect(selectedCommits.value.map((commit) => commit.hash)).toStrictEqual(["c1", "base"]);
  });
});

describe("open details of a search result", () => {
  it("stay open through a refresh of the graph behind the results", () => {
    showGraphView();
    act(() => setHistoryFilter({ ...emptyFilter(), text: "old" }));
    reply(lastQuery("history"), {
      data: {
        kind: "history",
        page: { entries: chain("old2", "old1"), more: false, refs: [] }
      }
    });
    expect(shownRows()).toStrictEqual(["old2", "old1"]);
    act(() => toggleCommitDetails("old1"));
    expect(stores.expandedCommit.value).toBe("old1");

    // A file save refreshes the graph, whose rows do not hold the result.
    reload("c3", "c2", "c1", "base");
    expect(shownRows()).toStrictEqual(["old2", "old1"]);
    expect(stores.expandedCommit.value).toBe("old1");
  });

  it("close when the results no longer hold the commit", () => {
    showGraphView();
    act(() => setHistoryFilter({ ...emptyFilter(), text: "old" }));
    reply(lastQuery("history"), {
      data: { kind: "history", page: { entries: chain("old2", "old1"), more: false, refs: [] } }
    });
    act(() => toggleCommitDetails("old1"));

    // Back to the graph, which does not show that commit.
    act(() => setHistoryFilter(emptyFilter()));
    expect(shownRows()).toStrictEqual(["c3", "c2", "c1", "base"]);
    expect(stores.expandedCommit.value).toBeNull();
  });
});
