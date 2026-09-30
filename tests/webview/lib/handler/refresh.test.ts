// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it } from "vitest";

import type { RequestMessage } from "@/types";
import { handleRefresh } from "@/webview/lib/handler/refresh";
import { commitList, selectedBranch, selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
});

const sent = () => vscodeApi.postMessage.mock.calls.map(([message]) => message as RequestMessage);

it("reloads the selected repository and keeps the rows until answers come", () => {
  const rows = [
    { hash: "c1", parentHashes: [], author: "A", email: "a@a", date: 0, message: "m", refs: [] }
  ];
  selectedRepo.value = "/r";
  selectedBranch.value = "main";
  commitList.value = rows;

  handleRefresh();

  expect(sent().map((message) => message.command)).toEqual([
    "loadBranches",
    "repositoryQuery",
    "loadCommits"
  ]);
  expect(sent()).toEqual([
    expect.objectContaining({ repo: "/r" }),
    expect.objectContaining({ repo: "/r", query: { kind: "state" } }),
    expect.objectContaining({ repo: "/r", branchName: "main" })
  ]);
  expect(commitList.value).toBe(rows);
  expect(handleRefresh).toHaveLength(0);
});

it("does nothing without a repository", () => {
  selectedRepo.value = undefined;
  handleRefresh();
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
});
