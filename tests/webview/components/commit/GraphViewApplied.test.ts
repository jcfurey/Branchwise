// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppliedCommits } from "@/backend/types";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";
import { getWebviewConfig, updateWebviewConfig } from "@/webview/lib/webview-config";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

import {
  chain,
  hideGraphView,
  lastQuery,
  reply,
  resetGraphView,
  sentQueries,
  showGraphView,
  view,
  withEnglish
} from "./graph-view-harness";

/** Two commits of `topic`, newest first, then main's copy of the older one, then their base. */
const TOPIC_NEW = "a".repeat(40);
const TOPIC_OLD = "b".repeat(40);
const COPY = "c0ffee00".padEnd(40, "1");
const BASE = "d".repeat(40);

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphView();
  stores.commitList.value = chain(TOPIC_NEW, TOPIC_OLD, COPY, BASE);
  stores.commitHead.value = COPY;
  // Revealing a commit centres its row.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  hideGraphView();
  updateWebviewConfig({ ...getWebviewConfig(), markAppliedCommits: true });
});

function focusOn(branch: string) {
  act(() => {
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = branch;
  });
}

/** The answer for `topic`, whose older commit main has as `COPY`. */
function answer(equivalent: AppliedCommits["applied"][number]["equivalent"]) {
  reply(lastQuery("appliedCommits"), {
    data: {
      kind: "appliedCommits",
      head: COPY,
      tip: TOPIC_NEW,
      skipped: false,
      applied: [{ hash: TOPIC_OLD, equivalent }]
    }
  });
}

const row = (hash: string) => view().querySelector<HTMLElement>(`tr[data-commit-hash="${hash}"]`)!;
const mark = (hash: string) => row(hash).querySelector<HTMLElement>("[data-applied-as]");

/** The cancellations posted for the read `requestId`. */
const cancels = (requestId: string) =>
  vscodeApi.postMessage.mock.calls.filter(
    ([message]) =>
      (message as { command: string }).command === "cancelRepositoryQuery" &&
      (message as { requestId: string }).requestId === requestId
  );

describe("which branch is compared", () => {
  it("asks only about a focused or filtered branch other than the checked-out one", () => {
    showGraphView();
    expect(sentQueries("appliedCommits")).toEqual([]);

    focusOn("main");
    expect(sentQueries("appliedCommits")).toEqual([]);

    focusOn("topic");
    expect(lastQuery("appliedCommits").query).toEqual({ kind: "appliedCommits", branch: "topic" });

    act(() => {
      stores.branchDisplay.value = "filter";
      stores.selectedBranch.value = "remotes/origin/topic";
    });
    expect(lastQuery("appliedCommits").query).toEqual({
      kind: "appliedCommits",
      branch: "remotes/origin/topic"
    });

    vi.clearAllMocks();
    act(() => {
      stores.selectedBranch.value = "*";
    });
    expect(sentQueries("appliedCommits")).toEqual([]);
  });

  it("cancels the question when the focus moves or pauses, and asks nothing with the setting off", () => {
    showGraphView();
    focusOn("topic");
    const first = lastQuery("appliedCommits");

    focusOn("other");
    expect(cancels(first.requestId)).toHaveLength(1);
    const second = lastQuery("appliedCommits");
    expect(second.query.branch).toBe("other");

    act(() => {
      stores.focusPaused.value = true;
    });
    expect(cancels(second.requestId)).toHaveLength(1);
    expect(lastQuery("appliedCommits")).toBe(second);

    act(() => {
      stores.focusPaused.value = false;
    });
    const third = lastQuery("appliedCommits");
    expect(third.requestId).not.toBe(second.requestId);
    act(() => {
      updateWebviewConfig({ ...getWebviewConfig(), markAppliedCommits: false });
    });
    expect(cancels(third.requestId)).toHaveLength(1);
    expect(lastQuery("appliedCommits")).toBe(third);
    expect(view().querySelector("[data-applied-as]")).toBeNull();
  });
});

describe("the applied mark", () => {
  it("marks only the commits main has, naming main's commit in its tooltip", () => {
    withEnglish({
      appliedMark: "applied",
      appliedAs: "Already in {0} as {1}: {2}",
      rowApplied: "already in {0}"
    });
    showGraphView();
    focusOn("topic");
    expect(view().querySelector("[data-applied-as]")).toBeNull();

    answer({ hash: COPY, subject: "Fix the parser {1}" });
    const applied = mark(TOPIC_OLD)!;
    expect(applied.tagName).toBe("BUTTON");
    expect(applied.dataset.appliedAs).toBe(COPY);
    expect(applied.textContent).toBe("applied");
    // Names in the template are filled in once, so a placeholder in the subject stays as written.
    expect(applied.title).toBe("Already in main as c0ffee00: Fix the parser {1}");
    expect(applied.getAttribute("aria-label")).toBe(applied.title);
    expect(row(TOPIC_OLD).getAttribute("aria-label")).toContain("already in main");

    expect(mark(TOPIC_NEW)).toBeNull();
    expect(mark(COPY)).toBeNull();
    expect(row(TOPIC_NEW).getAttribute("aria-label")).not.toContain("already in");
  });

  it("names the checked-out branch alone when its commit is not known", () => {
    withEnglish({ appliedMark: "applied", appliedSomewhere: "Already in {0}" });
    act(() => {
      stores.headBranch.value = null;
    });
    showGraphView();
    focusOn("topic");
    answer(null);
    const applied = mark(TOPIC_OLD)!;
    expect(applied.tagName).toBe("SPAN");
    expect(applied.dataset.appliedAs).toBe("");
    expect(applied.title).toBe("Already in HEAD");
  });

  it("selects main's commit when clicked, and not the row it sits on", () => {
    showGraphView();
    focusOn("topic");
    answer({ hash: COPY, subject: "work on copy" });

    act(() => mark(TOPIC_OLD)!.click());
    expect(selectedCommits.value.map((commit) => commit.hash)).toEqual([COPY]);
    expect(focusedCommit.value).toBe(COPY);
    expect(stores.expandedCommit.value).toBeNull();
    expect(row(COPY).getAttribute("aria-selected")).toBe("true");
    expect(row(TOPIC_OLD).getAttribute("aria-selected")).toBe("false");
  });
});
