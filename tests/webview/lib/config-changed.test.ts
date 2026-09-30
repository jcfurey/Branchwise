// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import type { WebviewConfig } from "@/types";

import { vscodeApi } from "@tests/webview/setup";
import { latestGraphRequest, setupWebviewTest } from "@tests/webview/test-utils";

let CommitRow: typeof import("@/webview/components/commit/CommitRow").CommitRow;
let stores: typeof import("@/webview/lib/stores");

beforeAll(async () => {
  setupWebviewTest();
  ({ CommitRow } = await import("@/webview/components/commit/CommitRow"));
  stores = await import("@/webview/lib/stores");
  const { initRpcHandler } = await import("@/webview/lib/rpc/rpc-handler");
  initRpcHandler(new Map());
});

const changed: WebviewConfig = {
  autoCenterCommitDetailsView: true,
  dateFormat: "Date Only",
  graphColours: ["#ff0000"],
  graphStyle: "angular",
  initialLoadCommits: 500,
  loadMoreCommits: 100,
  locale: "en",
  showCurrentBranchByDefault: false
};

function notifyConfig(config: WebviewConfig) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { kind: "rpc.notify", id: "config", name: "config.changed", message: config }
    })
  );
}

it("redraws an open graph with changed settings and loads it again", async () => {
  const commit: GitCommitNode = {
    hash: "abc123456789",
    parentHashes: [],
    author: "Author",
    email: "author@example.com",
    date: Date.UTC(2024, 0, 2, 12, 34) / 1000,
    message: "message",
    refs: []
  };
  const container = document.createElement("tbody");
  stores.selectedRepo.value = "/repo";
  stores.selectedBranch.value = "main";
  stores.maxCommits.value = 300;
  render(
    h(CommitRow, {
      commit,
      isHead: false,
      headBranch: null,
      messages: new Map(),
      colour: undefined,
      expanded: false,
      onSelect: undefined
    }),
    container
  );
  const dateCell = () => container.querySelector("td[title]");
  expect(dateCell()?.textContent).toMatch(/\d\d:\d\d$/);
  vscodeApi.postMessage.mockClear();

  await act(() => notifyConfig(changed));

  // The date column drops the time, and the larger first page is loaded at once.
  expect(dateCell()?.textContent).not.toMatch(/\d\d:\d\d$/);
  expect(dateCell()?.textContent).toBe(
    dateCell()
      ?.getAttribute("title")
      ?.replace(/ \d\d:\d\d$/, "")
  );
  expect(latestGraphRequest("loadCommits")).toMatchObject({ repo: "/repo", maxCommits: 500 });
  expect(latestGraphRequest("loadBranches")).toMatchObject({ repo: "/repo" });

  // A smaller first page keeps the commits already on screen.
  vscodeApi.postMessage.mockClear();
  await act(() => notifyConfig({ ...changed, initialLoadCommits: 50 }));
  expect(latestGraphRequest("loadCommits")).toMatchObject({ maxCommits: 500 });
  render(null, container);
});
