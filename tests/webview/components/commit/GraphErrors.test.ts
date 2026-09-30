// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { GraphView } from "@/webview/layout/GraphView";
import { refresh, selectRepo, toggleCommitDetails } from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleGraphQueryError } from "@/webview/lib/handler/graph-query-error";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import { emptyFilter, historyFilter, restoreScroll } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

let container: HTMLDivElement;
beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphRequests();
  stores.graphErrors.value = {};
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.commitList.value = undefined;
  stores.commitHead.value = null;
  stores.expandedCommit.value = null;
  stores.dialog.value = null;
  stores.repoStates.value = {};
  historyFilter.value = emptyFilter();
  restoreScroll.value = null;
  container = document.createElement("div");
  document.body.append(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

it("shows Git failures with Retry, then recovers to the normal empty-repository view", () => {
  refresh();
  act(() => {
    handleGraphQueryError({
      command: "graphQueryError",
      query: "loadCommits",
      repo: "/repo",
      requestId: latestGraphRequest("loadCommits").requestId,
      message: "fatal: repository unavailable"
    });
    render(h(GraphView, {}), container);
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "fatal: repository unavailable"
  );
  expect(container.textContent).not.toContain("noCommits");
  const failedId = latestGraphRequest("loadCommits").requestId;
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "retry"
  );
  expect(retry).toBeDefined();
  act(() => retry!.click());
  const request = latestGraphRequest("loadCommits");
  expect(request.requestId).not.toBe(failedId);
  expect(stores.graphErrors.value.loadCommits).toBeUndefined();
  act(() =>
    handleLoadCommits({
      ...request,
      commits: [],
      head: null,
      moreCommitsAvailable: false,
      uncommittedChanges: 0
    })
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("noCommits");
});

it("shows branch-loading errors even when no commit request could be made", () => {
  stores.selectedBranch.value = undefined;
  refresh();
  act(() => {
    handleGraphQueryError({
      command: "graphQueryError",
      query: "loadBranches",
      repo: "/repo",
      requestId: latestGraphRequest("loadBranches").requestId,
      message: "Git executable not found"
    });
    render(h(GraphView, {}), container);
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Git executable not found");
  act(() => selectRepo("/other"));
  expect(stores.graphErrors.value).toEqual({});
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("ignores stale graph errors and keeps independent branch and commit failures", () => {
  refresh();
  const previous = latestGraphRequest("loadCommits");
  refresh();
  handleGraphQueryError({
    command: "graphQueryError",
    query: "loadCommits",
    repo: "/repo",
    requestId: previous.requestId,
    message: "outdated"
  });
  expect(stores.graphErrors.value.loadCommits).toBeUndefined();
  for (const query of ["loadCommits", "loadBranches"] as const) {
    handleGraphQueryError({
      command: "graphQueryError",
      query,
      repo: "/repo",
      requestId: latestGraphRequest(query).requestId,
      message: query + " failed"
    });
  }
  expect(stores.graphErrors.value).toEqual({
    loadBranches: "loadBranches failed",
    loadCommits: "loadCommits failed"
  });
});

it("does not let a stale details exception close a newer selection", () => {
  toggleCommitDetails("first");
  const previous = latestGraphRequest("commitDetails");
  toggleCommitDetails("second");
  handleGraphQueryError({
    command: "graphQueryError",
    query: "commitDetails",
    repo: "/repo",
    requestId: previous.requestId,
    message: "old error"
  });
  expect(stores.expandedCommit.value).toBe("second");
  expect(stores.dialog.value).toBeNull();
  handleGraphQueryError({
    command: "graphQueryError",
    query: "commitDetails",
    repo: "/repo",
    requestId: latestGraphRequest("commitDetails").requestId,
    message: "current error"
  });
  expect(stores.expandedCommit.value).toBeNull();
  expect(stores.dialog.value).toMatchObject({ kind: "error", reason: "current error" });
});
