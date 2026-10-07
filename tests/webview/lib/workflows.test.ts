// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryQueryData, SyncPlan, WorkspaceEntry } from "@/backend/types";
import { openSubmodule, SyncReview } from "@/webview/components/history/WorkflowTools";
import { WorkspacePane } from "@/webview/components/history/WorkspacePane";
import { chooseBisectCommit } from "@/webview/components/repository/BisectView";
import { Dialog } from "@/webview/components/ui/Dialog";
import {
  closeContextMenu,
  closeDialog,
  openContentDialog,
  openContextMenu
} from "@/webview/lib/actions";
import { focusedCommit, historyFilter } from "@/webview/lib/navigation";
import { acceptRemoteActionResult } from "@/webview/lib/remote-actions";
import { handleRepositoryQuery, requestPanelQuery } from "@/webview/lib/repository-actions";
import { contextMenu, dialog, selectedRepo } from "@/webview/lib/stores";
import { fetchWorkspace, workspaceBusy, workspaceJobs } from "@/webview/lib/workspace-actions";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();
let container: HTMLDivElement;
beforeEach(() => {
  selectedRepo.value = "/repo";
  dialog.value = null;
  contextMenu.value = null;
  workspaceJobs.value = [];
  vscodeApi.postMessage.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  closeDialog();
});
const requests = () => vscodeApi.postMessage.mock.calls.map(([request]) => request);
const last = () => requests().at(-1);
function respond(data: RepositoryQueryData, request = last()) {
  act(() =>
    handleRepositoryQuery({ repo: request.repo, requestId: request.requestId, data, status: null })
  );
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  expect(button).toBeDefined();
  act(() => button!.click());
}
const moduleEntry: WorkspaceEntry = {
  path: "/repo/module",
  parent: "/repo",
  submodulePath: "module",
  recorded: "b".repeat(40),
  committed: "a".repeat(40),
  head: "b".repeat(40),
  branch: "main",
  dirty: 0,
  ahead: 0,
  behind: 0,
  initialized: true,
  error: null,
  operation: null,
  conflicts: 0,
  stashes: 0,
  detached: false,
  upstream: "origin/main",
  aheadBranches: 0,
  remotes: 1,
  fetched: null
};

it("keeps a clean submodule with a staged pointer in the changed-only view", () => {
  act(() => render(h(WorkspacePane, {}), container));
  respond({ kind: "workspace", entries: [moduleEntry] });
  act(() => {
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  expect(container.textContent).toContain("submoduleStaged");
  expect(container.querySelector('button[title="/repo/module"]')).not.toBeNull();
});

it("stages a reviewed gitlink in its parent while the child graph is selected", () => {
  selectedRepo.value = "/repo/module";
  act(() => {
    openSubmodule(moduleEntry, true);
    render(h(Dialog, {}), container);
  });
  expect(last()).toMatchObject({
    repo: "/repo",
    query: { kind: "submodulePlan", path: "module", staged: true }
  });
  const plan = {
    path: "module",
    child: "/repo/module",
    parentHead: "c".repeat(40),
    recorded: moduleEntry.recorded!,
    committed: moduleEntry.committed,
    head: "d".repeat(40)
  };
  respond({ kind: "submodulePlan", plan, comparison: null });
  click("stagePointer");
  expect(last()).toMatchObject({
    command: "repositoryAction",
    repo: "/repo",
    action: { kind: "submodulePointer", operation: "stage", plan }
  });
});

it("cancels abandoned queries and accepts a bound parent query without switching graphs", () => {
  const receive = vi.fn();
  const cancel = requestPanelQuery({ kind: "cleanupPlan" }, receive, "/parent");
  const request = last();
  cancel();
  expect(last()).toEqual({
    command: "cancelRepositoryQuery",
    repo: "/parent",
    requestId: request.requestId
  });
  respond({ kind: "cleanupPlan", plan: { base: "a", branches: [] } }, request);
  expect(receive).not.toHaveBeenCalled();
  requestPanelQuery({ kind: "cleanupPlan" }, receive, "/parent");
  respond({ kind: "cleanupPlan", plan: { base: "a", branches: [] } });
  expect(receive).toHaveBeenCalledOnce();
  expect(selectedRepo.value).toBe("/repo");
});

it("bounds workspace fetch concurrency and keeps results after repository switching and individual failures", async () => {
  const task = fetchWorkspace(["/one", "/two", "/three"]);
  const initial = requests().filter((request) => request.command === "repositoryAction");
  expect(initial).toHaveLength(2);
  expect(workspaceBusy.value).toBe(true);
  selectedRepo.value = "/another";
  acceptRemoteActionResult({ ...initial[0], status: "network failure" });
  await Promise.resolve();
  await Promise.resolve();
  const third = requests().find(
    (request) => request.command === "repositoryAction" && request.repo === "/three"
  );
  expect(third).toBeDefined();
  acceptRemoteActionResult({ ...initial[1], status: null });
  acceptRemoteActionResult({ ...third, status: null });
  await Promise.resolve();
  await Promise.resolve();
  const queries = requests().filter((request) => request.query?.kind === "upstreamPlan");
  expect(queries).toHaveLength(2);
  for (const query of queries) {
    handleRepositoryQuery({
      repo: query.repo,
      requestId: query.requestId,
      data: null,
      status: "No upstream"
    });
  }
  await task;
  expect(workspaceBusy.value).toBe(false);
  expect(workspaceJobs.value.map((job) => [job.repo, job.state])).toEqual([
    ["/one", "error"],
    ["/two", "done"],
    ["/three", "done"]
  ]);
  expect(workspaceJobs.value[0]?.error).toBe("network failure");
  expect(workspaceJobs.value[1]?.planError).toBe("No upstream");
  expect(dialog.value).toBeNull();
});

it("preserves selected bisect endpoints per repository and requires Start before checkout", () => {
  act(() => {
    chooseBisectCommit("good", "a".repeat(40));
    render(h(Dialog, {}), container);
  });
  respond({ kind: "bisect", state: null, head: "c".repeat(40) });
  act(() => chooseBisectCommit("bad", "b".repeat(40)));
  respond({ kind: "bisect", state: null, head: "c".repeat(40) });
  expect([...container.querySelectorAll("input")].map((input) => input.value)).toEqual([
    "a".repeat(40),
    "b".repeat(40)
  ]);
  expect(requests().some((request) => request.action?.kind === "bisectStart")).toBe(false);
  click("bisectStart");
  expect(last()).toMatchObject({
    repo: "/repo",
    action: {
      kind: "bisectStart",
      good: "a".repeat(40),
      bad: "b".repeat(40),
      expectedHead: "c".repeat(40)
    }
  });
});

it("sends a push review with more outgoing commits than it lists to the branch's history", () => {
  const local = "c".repeat(40);
  const plan: SyncPlan = {
    branch: "main",
    remote: "origin",
    remoteBranch: "main",
    local,
    remoteHead: null,
    incoming: { entries: [], more: false },
    outgoing: { entries: [], more: true },
    ahead: 150,
    behind: 0,
    canFastForward: false
  };
  openContentDialog("syncPreview", h("p", {}, "review"));
  const options = { operation: "push", setUpstream: false, force: false } as const;
  act(() => render(h(SyncReview, { plan, repo: "/repo", options }), container));

  const labels = [...container.querySelectorAll("button")].map((button) => button.textContent);
  expect(labels).not.toContain("loadMore");
  click("showBranchHistory");
  expect(dialog.value).toBeNull();
  expect(historyFilter.value.revision).toBe(local);
  expect(focusedCommit.value).toBe(local);
});

it("tells the caller of a push review that the push succeeded, and only then", () => {
  const plan: SyncPlan = {
    branch: "topic",
    remote: "origin",
    remoteBranch: "topic",
    local: "c".repeat(40),
    remoteHead: null,
    incoming: { entries: [], more: false },
    outgoing: { entries: [], more: false },
    ahead: 1,
    behind: 0,
    canFastForward: false
  };
  const options = { operation: "push", setUpstream: true, force: false } as const;
  for (const status of ["rejected", null]) {
    const onDone = vi.fn();
    openContentDialog("syncPreview", h("p", {}, "review"));
    act(() => render(h(SyncReview, { plan, repo: "/repo", options, onDone }), container));
    click("pushBranch");
    const push = requests().at(-1) as { requestId: string; action: { kind: string } };
    expect(push.action).toMatchObject({ kind: "sync", operation: "push", setUpstream: true });
    expect(onDone).not.toHaveBeenCalled();
    acceptRemoteActionResult({
      command: "repositoryAction",
      repo: "/repo",
      requestId: push.requestId,
      status
    });
    expect(onDone).toHaveBeenCalledTimes(status === null ? 1 : 0);
    act(() => render(null, container));
  }
});

it("returns keyboard focus to the original control across menu and dialog transitions", async () => {
  const anchor = document.createElement("button");
  container.append(anchor);
  anchor.focus();
  openContextMenu(new MouseEvent("contextmenu"), "test", []);
  closeContextMenu();
  openContentDialog("test", h("p", {}, "test"));
  await Promise.resolve();
  expect(dialog.value).not.toBeNull();
  closeDialog();
  await Promise.resolve();
  expect(document.activeElement).toBe(anchor);
});

describe("the Workspace tree", () => {
  const repo = (path: string, parent: string | null, patch: Partial<WorkspaceEntry> = {}) => ({
    ...moduleEntry,
    path,
    parent,
    submodulePath: null,
    recorded: null,
    committed: null,
    ...patch
  });
  const entries = [
    repo("/repo", null),
    repo("/repo/module", "/repo", { submodulePath: "module" }),
    repo("/repo/tools/cli", "/repo", { dirty: 2 }),
    repo("/repo/tools/cli/vendor", "/repo/tools/cli"),
    repo("/other", null)
  ];
  const labels = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button[title]")].map((row) => [
      row.textContent,
      row.closest<HTMLElement>("[style]")!.style.paddingLeft
    ]);

  it("lists nested repositories under their parent by their path in it, and collapses them", () => {
    act(() => render(h(WorkspacePane, {}), container));
    respond({ kind: "workspace", entries });
    expect(labels()).toStrictEqual([
      ["repo", "4px"],
      ["module", "20px"],
      ["tools/cli", "20px"],
      ["vendor", "36px"],
      ["other", "4px"]
    ]);
    expect(container.textContent).toContain("submoduleTag");
    expect(container.textContent).toContain("nestedRepoTag");
    const toggles = container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]");
    // Only rows with repositories below them can collapse.
    expect([...toggles].map((toggle) => toggle.getAttribute("aria-label"))).toStrictEqual([
      "collapseRepository",
      "collapseRepository"
    ]);
    act(() => toggles[0]!.click());
    expect(labels().map(([label]) => label)).toStrictEqual(["repo", "other"]);
    expect(toggles[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(toggles[0]!.getAttribute("aria-label")).toBe("expandRepository");
    // While filtering, a match inside a collapsed repository still shows, under its parents.
    act(() => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(labels().map(([label]) => label)).toStrictEqual(["repo", "tools/cli"]);
    act(() => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    expect(labels()).toHaveLength(5);
  });
});
