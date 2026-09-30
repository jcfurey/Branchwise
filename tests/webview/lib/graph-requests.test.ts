// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { GitCommitDetails, QueryRequest, QueryResponse } from "@/backend/types";
import {
  closeCommitDetails,
  loadMoreCommits,
  refresh,
  selectRepo,
  setRemoteVisible,
  toggleCommitDetails
} from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleCommitDetails } from "@/webview/lib/handler/commit-details";
import { handleLoadBranches } from "@/webview/lib/handler/load-branches";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import * as stores from "@/webview/lib/stores";

import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.branchList.value = ["main"];
  stores.headBranch.value = "main";
  stores.repoStates.value = {};
  stores.showRemoteBranch.value = true;
  stores.commitList.value = [];
  stores.maxCommits.value = 300;
  stores.expandedCommit.value = null;
  stores.commitDetails.value = null;
  stores.dialog.value = null;
  vi.clearAllMocks();
});

function commitsReply(
  request: Extract<QueryRequest, { command: "loadCommits" }>,
  hashes: string[]
): Extract<QueryResponse, { command: "loadCommits" }> {
  return {
    ...request,
    commits: hashes.map((hash) => ({
      hash,
      parentHashes: [],
      refs: [],
      author: "Author",
      email: "author@example.test",
      date: 0,
      message: hash
    })),
    head: hashes[0] ?? null,
    moreCommitsAvailable: true,
    uncommittedChanges: 0
  };
}

function branchesReply(
  request: Extract<QueryRequest, { command: "loadBranches" }>,
  branches: string[]
): Extract<QueryResponse, { command: "loadBranches" }> {
  return { ...request, branches, head: branches[0] ?? null, isRepo: true };
}

function details(hash: string, body: string): GitCommitDetails {
  return {
    hash,
    parents: [],
    author: "Author",
    email: "author@example.test",
    date: 0,
    committer: "Author",
    body,
    fileChanges: []
  };
}

it.each(["load more", "refresh"])("an older reply cannot undo a newer %s", (action) => {
  refresh();
  const previous = latestGraphRequest("loadCommits");
  (action === "load more" ? loadMoreCommits : refresh)();
  const current = latestGraphRequest("loadCommits");
  expect(current.requestId).not.toBe(previous.requestId);
  expect(current.maxCommits).toBe(action === "load more" ? 400 : 300);
  handleLoadCommits(commitsReply(current, ["new", "loaded"]));
  const rows = stores.commitList.value;
  handleLoadCommits({ ...commitsReply(previous, ["old"]), moreCommitsAvailable: false });
  expect(stores.commitList.value).toBe(rows);
  expect(stores.commitHead.value).toBe("new");
  expect(stores.moreCommitsAvailable.value).toBe(true);
});

it("ignores older branch replies even when repository and visibility match", () => {
  refresh();
  const previous = latestGraphRequest("loadBranches");
  refresh();
  handleLoadBranches(branchesReply(latestGraphRequest("loadBranches"), ["main", "new"]));
  handleLoadBranches(branchesReply(previous, ["deleted"]));
  expect(stores.branchList.value).toEqual(["main", "new"]);
  expect(stores.headBranch.value).toBe("main");
});

it("rejects old replies after visibility changes away and back", () => {
  refresh();
  const previous = latestGraphRequest("loadCommits");
  setRemoteVisible("origin", false);
  setRemoteVisible("origin", true);
  const current = latestGraphRequest("loadCommits");
  expect(current.visibilityKey).toBe(previous.visibilityKey);
  handleLoadCommits(commitsReply(previous, ["old"]));
  expect(stores.commitList.value).toEqual([]);
  handleLoadCommits(commitsReply(current, ["current"]));
  expect(stores.commitHead.value).toBe("current");
});

it("rejects previous visits' replies after switching repositories and back", () => {
  refresh();
  const previousBranches = latestGraphRequest("loadBranches");
  const previousCommits = latestGraphRequest("loadCommits");
  selectRepo("/other");
  selectRepo("/repo");
  handleLoadBranches(branchesReply(previousBranches, ["outdated"]));
  handleLoadCommits(commitsReply(previousCommits, ["outdated"]));
  expect(stores.branchList.value).toBeUndefined();
  expect(stores.commitList.value).toBeUndefined();
  handleLoadBranches(branchesReply(latestGraphRequest("loadBranches"), ["main"]));
  handleLoadCommits(commitsReply(latestGraphRequest("loadCommits"), ["current"]));
  handleLoadCommits(commitsReply(previousCommits, ["outdated"]));
  expect(stores.branchList.value).toEqual(["main"]);
  expect(stores.commitHead.value).toBe("current");
});

it("ignores stale details errors while a different commit is loading", () => {
  toggleCommitDetails("first");
  const previous = latestGraphRequest("commitDetails");
  toggleCommitDetails("second");
  const current = latestGraphRequest("commitDetails");
  handleCommitDetails({ ...previous, commitDetails: null });
  expect(stores.expandedCommit.value).toBe("second");
  expect(stores.dialog.value).toBeNull();
  handleCommitDetails({ ...current, commitDetails: details("second", "current details") });
  expect(stores.commitDetails.value?.body).toBe("current details");
});

it("invalidates closed details and an earlier request for the same commit", () => {
  toggleCommitDetails("same");
  const previous = latestGraphRequest("commitDetails");
  closeCommitDetails();
  handleCommitDetails({ ...previous, commitDetails: null });
  expect(stores.dialog.value).toBeNull();
  toggleCommitDetails("same");
  handleCommitDetails({ ...previous, commitDetails: details("same", "outdated") });
  expect(stores.commitDetails.value).toBeNull();
  handleCommitDetails({
    ...latestGraphRequest("commitDetails"),
    commitDetails: details("same", "current")
  });
  expect(stores.commitDetails.value?.body).toBe("current");
});

it("ignores another repository's details for the same hash and reports the current error", () => {
  toggleCommitDetails("shared-hash");
  const previous = latestGraphRequest("commitDetails");
  selectRepo("/other");
  toggleCommitDetails("shared-hash");
  handleCommitDetails({ ...previous, commitDetails: details("shared-hash", "wrong repository") });
  expect(stores.commitDetails.value).toBeNull();
  expect(stores.expandedCommit.value).toBe("shared-hash");
  handleCommitDetails({ ...latestGraphRequest("commitDetails"), commitDetails: null });
  expect(stores.expandedCommit.value).toBeNull();
  expect(stores.dialog.value).toMatchObject({
    kind: "error",
    message: "unableToLoadCommitDetails"
  });
});
