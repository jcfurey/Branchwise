// @vitest-environment jsdom
import { effect } from "@preact/signals";
import { beforeAll, beforeEach, expect, it } from "vitest";

import type { GitCommitDetails } from "@/backend/types";
import { selectRepo, toggleCommitDetails } from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleCommitDetails } from "@/webview/lib/handler/commit-details";
import * as stores from "@/webview/lib/stores";

import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/r";
  stores.expandedCommit.value = null;
  stores.commitDetails.value = null;
  stores.contextMenu.value = null;
  stores.dialog.value = null;
});

function detailsOf(hash: string): GitCommitDetails {
  return {
    hash,
    parents: ["p".repeat(40)],
    author: "Lin",
    email: "lin@example.test",
    date: 1_650_000_000,
    committer: "Lin",
    body: "Subject\n\nBody",
    fileChanges: []
  };
}

/** Open a row's details, and return the identity its answer must echo. */
function open(hash: string) {
  toggleCommitDetails(hash);
  const { command, repo, requestId } = latestGraphRequest("commitDetails");
  return { command, repo, requestId };
}

it("shows the answer's own object, in one notification, leaving the dialog alone", () => {
  const request = open("abc");
  const details = detailsOf("abc");
  let runs = 0;
  const stop = effect(() => {
    void stores.commitDetails.value;
    void stores.expandedCommit.value;
    runs += 1;
  });

  handleCommitDetails({ ...request, commitDetails: details });
  stop();

  expect(stores.commitDetails.value).toBe(details);
  expect(runs).toBe(2);
  expect(stores.dialog.value).toBeNull();
});

it("shows the answer to the row's request even when it names the commit differently", () => {
  const request = open("abc");
  const details = detailsOf("abcdef");

  handleCommitDetails({ ...request, commitDetails: details });

  expect(stores.commitDetails.value).toBe(details);
  expect(stores.expandedCommit.value).toBe("abc");
  expect(stores.dialog.value).toBeNull();
});

it("closes the details and reports a failure without a reason", () => {
  const request = open("abc");
  stores.contextMenu.value = { x: 3, y: 4, entries: [], source: "row:abc" };

  handleCommitDetails({ ...request, commitDetails: null });

  expect(stores.expandedCommit.value).toBeNull();
  expect(stores.commitDetails.value).toBeNull();
  expect(stores.contextMenu.value).toBeNull();
  expect(stores.dialog.value).toEqual({
    kind: "error",
    message: "unableToLoadCommitDetails",
    reason: null,
    token: expect.any(Number)
  });
});

it("ignores an answer for a row left for another", () => {
  const earlier = open("first");
  open("second");

  handleCommitDetails({ ...earlier, commitDetails: null });
  handleCommitDetails({ ...earlier, commitDetails: detailsOf("first") });

  expect(stores.expandedCommit.value).toBe("second");
  expect(stores.commitDetails.value).toBeNull();
  expect(stores.dialog.value).toBeNull();
});

it("ignores an answer from the repository shown before", () => {
  const earlier = open("abc");
  selectRepo("/other");
  const current = open("abc");

  handleCommitDetails({ ...earlier, commitDetails: detailsOf("abc") });
  expect(stores.commitDetails.value).toBeNull();

  handleCommitDetails({ ...current, commitDetails: null });
  expect(stores.expandedCommit.value).toBeNull();
  expect(stores.dialog.value).toMatchObject({ message: "unableToLoadCommitDetails" });
});

it("takes an answer once", () => {
  const request = open("abc");
  const first = detailsOf("abc");
  handleCommitDetails({ ...request, commitDetails: first });
  handleCommitDetails({ ...request, commitDetails: null });

  expect(stores.commitDetails.value).toBe(first);
  expect(stores.dialog.value).toBeNull();
});
