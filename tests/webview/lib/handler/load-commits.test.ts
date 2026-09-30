// @vitest-environment jsdom
import { effect } from "@preact/signals";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitCommitDetails, GitCommitNode, QueryResponse } from "@/backend/types";
import { refresh, setBranchDisplay, toggleCommitDetails } from "@/webview/lib/actions";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { handleCommitDetails } from "@/webview/lib/handler/commit-details";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import * as stores from "@/webview/lib/stores";

import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

type RowsAnswer = Extract<QueryResponse, { command: "loadCommits" }>;

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  resetGraphRequests();
  stores.selectedRepo.value = "/r";
  stores.selectedBranch.value = "main";
  stores.branchDisplay.value = "filter";
  stores.showRemoteBranch.value = true;
  stores.repoStates.value = {};
  stores.commitList.value = undefined;
  stores.commitHead.value = null;
  stores.moreCommitsAvailable.value = false;
  stores.uncommittedChanges.value = 0;
  stores.expandedCommit.value = null;
  stores.commitDetails.value = null;
});

const node = (hash: string): GitCommitNode => ({
  hash,
  parentHashes: [],
  author: "Grace",
  email: "grace@example.test",
  date: 1_600_000_000,
  message: `row ${hash}`,
  refs: []
});

/** Ask for the rows again, and build the answer to that request. */
function rowsFor(hashes: Array<string>, changes: Partial<RowsAnswer> = {}): RowsAnswer {
  refresh();
  const request = latestGraphRequest("loadCommits");
  const uncommitted = hashes[0] === "*" ? 2 : 0;
  return {
    ...request,
    commits: hashes.map(node),
    head: hashes.find((hash) => hash !== "*") ?? null,
    moreCommitsAvailable: true,
    uncommittedChanges: uncommitted,
    ...changes
  };
}

const detailsOf = (hash: string): GitCommitDetails => ({
  hash,
  parents: [],
  author: "Grace",
  email: "grace@example.test",
  date: 1_600_000_000,
  committer: "Grace",
  body: `about ${hash}`,
  fileChanges: []
});

describe("an accepted page", () => {
  it("replaces the rows and what came with them", () => {
    const answer = rowsFor(["*", "c1", "c2"]);
    handleLoadCommits(answer);

    expect(stores.commitList.value).toBe(answer.commits);
    expect(stores.commitHead.value).toBe("c1");
    expect(stores.moreCommitsAvailable.value).toBe(true);
    expect(stores.uncommittedChanges.value).toBe(2);
  });

  it("is taken once", () => {
    const answer = rowsFor(["c1"]);
    handleLoadCommits(answer);
    handleLoadCommits({ ...answer, commits: [node("c9")] });
    expect(stores.commitList.value).toBe(answer.commits);
  });

  it("changes everything in one notification, closing details whose row is gone", () => {
    toggleCommitDetails("gone");
    let runs = 0;
    const stop = effect(() => {
      void stores.commitList.value;
      void stores.commitHead.value;
      void stores.moreCommitsAvailable.value;
      void stores.uncommittedChanges.value;
      void stores.expandedCommit.value;
      void stores.commitDetails.value;
      runs += 1;
    });
    const answer = rowsFor(["*", "c1"]);

    handleLoadCommits(answer);
    stop();

    expect(runs).toBe(2);
    expect(stores.commitList.value).toBe(answer.commits);
    expect(stores.expandedCommit.value).toBeNull();
  });
});

describe("open details", () => {
  it("stay open while their row is on the page", () => {
    toggleCommitDetails("c2");
    const details = detailsOf("c2");
    stores.commitDetails.value = details;

    handleLoadCommits(rowsFor(["c1", "c2"]));

    expect(stores.expandedCommit.value).toBe("c2");
    expect(stores.commitDetails.value).toBe(details);
  });

  it("close when their row is gone, and their late answer is then refused", () => {
    toggleCommitDetails("c2");
    const detailsRequest = latestGraphRequest("commitDetails");

    handleLoadCommits(rowsFor(["c3"]));
    expect(stores.expandedCommit.value).toBeNull();
    expect(stores.commitDetails.value).toBeNull();

    handleCommitDetails({ ...detailsRequest, commitDetails: detailsOf("c2") });
    expect(stores.commitDetails.value).toBeNull();
  });

  it("close for uncommitted changes that are no longer there", () => {
    toggleCommitDetails("*");

    handleLoadCommits(rowsFor(["c1"], { uncommittedChanges: 0 }));

    expect(stores.expandedCommit.value).toBeNull();
  });
});

describe("a page that is refused", () => {
  it.each<[string, Partial<RowsAnswer>]>([
    ["for all branches while one is shown", { branchName: "" }],
    ["for another repository", { repo: "/x" }],
    ["for an older remote choice", { visibilityKey: "stale" }]
  ])("%s leaves the request for the right answer", (_label, changes) => {
    const answer = rowsFor(["c1"]);
    handleLoadCommits({ ...answer, ...changes });
    expect(stores.commitList.value).toBeUndefined();

    handleLoadCommits(answer);
    expect(stores.commitList.value).toBe(answer.commits);
  });

  it("comes in again once its repository is selected again", () => {
    const answer = rowsFor(["c1"]);
    stores.selectedRepo.value = undefined;
    handleLoadCommits(answer);
    expect(stores.commitList.value).toBeUndefined();

    stores.selectedRepo.value = "/r";
    handleLoadCommits(answer);
    expect(stores.commitList.value).toBe(answer.commits);
  });

  it("belongs to a filter left for a focus mode", () => {
    setBranchDisplay("focus");
    const request = latestGraphRequest("loadCommits");
    const answer: RowsAnswer = {
      ...request,
      commits: [node("c1")],
      head: "c1",
      moreCommitsAvailable: false,
      uncommittedChanges: 0
    };

    handleLoadCommits({ ...answer, branchName: "main" });
    expect(stores.commitList.value).toBeUndefined();

    handleLoadCommits(answer);
    expect(stores.commitList.value).toBe(answer.commits);
  });
});
