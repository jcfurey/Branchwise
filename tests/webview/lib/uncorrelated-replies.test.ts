// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryResponse } from "@/backend/types";
import type { RequestMessage } from "@/types";
import { openRunningDialog, refresh } from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleActionResult } from "@/webview/lib/handler/action-result";
import { handleLoadBranches } from "@/webview/lib/handler/load-branches";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "main";
  stores.branchDisplay.value = "filter";
  stores.branchList.value = ["main"];
  stores.headBranch.value = "main";
  stores.repoStates.value = {};
  stores.showRemoteBranch.value = true;
  stores.dialog.value = null;
  vi.clearAllMocks();
});

/** Everything the webview posted since the test started. */
const posted = () => vscodeApi.postMessage.mock.calls.map(([message]) => message as RequestMessage);

describe("an action answer without a request id", () => {
  it("reloads the graph and closes whatever dialog is open", () => {
    openRunningDialog("deleting");
    handleActionResult({ command: "deleteTag", status: null });

    expect(posted()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "loadBranches", repo: "/repo" }),
        expect.objectContaining({ command: "repositoryQuery", query: { kind: "state" } }),
        expect.objectContaining({ command: "loadCommits", repo: "/repo", branchName: "main" })
      ])
    );
    expect(stores.dialog.value).toBeNull();
  });

  it("reports a failure under the command's own title", () => {
    openRunningDialog("deleting");
    handleActionResult({ command: "deleteTag", status: "boom" });

    expect(stores.dialog.value).toMatchObject({
      kind: "error",
      message: "unableToDeleteTag",
      reason: "boom"
    });
  });
});

describe("a branch list answer without a visibility key", () => {
  it("is accepted although the remote choice changed since the request", () => {
    stores.selectedBranch.value = "*";
    refresh();
    const request = latestGraphRequest("loadBranches");
    // The choice changes without a new request, so the pending key goes stale.
    stores.showRemoteBranch.value = false;
    const answer: Extract<QueryResponse, { command: "loadBranches" }> = {
      command: "loadBranches",
      repo: "/repo",
      requestId: request.requestId,
      branches: ["main", "topic"],
      head: "main",
      hard: true,
      isRepo: true
    };

    handleLoadBranches({ ...answer, visibilityKey: request.visibilityKey });
    expect(stores.branchList.value).toEqual(["main"]);

    handleLoadBranches(answer);
    expect(stores.branchList.value).toEqual(["main", "topic"]);
  });
});
