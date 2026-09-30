// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry, RepositoryQueryData } from "@/backend/types";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import { openBatch, openRestoreFile } from "@/webview/components/history/HistoryTools";
import { SearchBar } from "@/webview/components/history/SearchBar";
import { RebaseEditor } from "@/webview/components/repository/RebaseEditor";
import { Dialog } from "@/webview/components/ui/Dialog";
import { openContentDialog, openErrorDialog } from "@/webview/lib/actions";
import { activity } from "@/webview/lib/activity";
import { handleActionResult } from "@/webview/lib/handler/action-result";
import {
  emptyFilter,
  enterNavigation,
  focusedCommit,
  historyFilter,
  leaveNavigation,
  savedFilters,
  saveHistoryFilter,
  selectedCommits,
  selectCommitRows,
  selectionInGraphOrder,
  setHistoryFilter
} from "@/webview/lib/navigation";
import {
  handleRepositoryQuery,
  requestPanelQuery,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { contextMenu, dialog, selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let container: HTMLDivElement;
setupWebviewTest();
const row = (digit: string): HistoryEntry => ({
  hash: digit.repeat(40),
  parentHashes: [],
  author: "T",
  email: "t@t",
  date: 1,
  message: "commit " + digit,
  refs: []
});
const rows = [row("c"), row("b"), row("a")];
function lastRequest() {
  return vscodeApi.postMessage.mock.lastCall![0];
}
function respond(data: RepositoryQueryData, request = lastRequest()) {
  act(() =>
    handleRepositoryQuery({ repo: request.repo, requestId: request.requestId, data, status: null })
  );
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  if (!button) {
    throw new Error("Missing " + label);
  }
  act(() => button.click());
}

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  selectedRepo.value = "/history-test";
  enterNavigation("/history-test");
  setHistoryFilter(emptyFilter());
  selectedCommits.value = [];
  dialog.value = null;
  activity.value = [];
  contextMenu.value = null;
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});

describe("history navigation and query lifetime", () => {
  it("keeps independent queries separate and discards cancelled and previous-repository replies", () => {
    const first = vi.fn();
    const second = vi.fn();
    const cancel = requestPanelQuery({ kind: "reflog", offset: 0 }, first);
    const old = lastRequest();
    requestPanelQuery({ kind: "workspace" }, second);
    const current = lastRequest();
    cancel();
    respond({ kind: "reflog", entries: [], more: false }, old);
    respond({ kind: "workspace", entries: [] }, current);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    requestPanelQuery({ kind: "workspace" }, first);
    const stale = lastRequest();
    selectedRepo.value = "/elsewhere";
    respond({ kind: "workspace", entries: [] }, stale);
    expect(first).not.toHaveBeenCalled();
  });

  it("saves filters and scroll separately for each repository", () => {
    setHistoryFilter({ ...emptyFilter(), text: "specific message", path: "src/file.ts" });
    saveHistoryFilter("My changes");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 480 });
    leaveNavigation("/history-test");
    selectedRepo.value = "/second";
    enterNavigation("/second");
    expect(historyFilter.value.text).toBe("");
    setHistoryFilter({ ...emptyFilter(), author: "Other" });
    leaveNavigation("/second");
    selectedRepo.value = "/history-test";
    enterNavigation("/history-test");
    expect(historyFilter.value.text).toBe("specific message");
    expect(savedFilters.value.find((item) => item.name === "My changes")?.filter.path).toBe(
      "src/file.ts"
    );
    expect(vscodeApi.setState).toHaveBeenCalledWith(
      expect.objectContaining({
        navigation: expect.objectContaining({
          repos: expect.objectContaining({
            "/history-test": expect.objectContaining({ scroll: 480 })
          })
        })
      })
    );
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  it("applies the search form instead of limiting matches to loaded rows", () => {
    act(() => render(h(SearchBar, {}), container));
    const input = container.querySelector<HTMLInputElement>("[data-history-search]")!;
    act(() => {
      input.value = "old commit outside graph";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(historyFilter.value.text).toBe("old commit outside graph");
  });

  it("extends a range from a stable anchor and defaults cherry-pick order to graph ancestry", () => {
    selectCommitRows(rows[0]!, rows, false, false);
    selectCommitRows(rows[1]!, rows, false, true);
    selectCommitRows(rows[2]!, rows, false, true);
    expect(selectionInGraphOrder().map((entry) => entry.hash)).toEqual(
      rows.map((entry) => entry.hash)
    );
    openBatch("cherry-pick");
    expect(lastRequest().query.hashes).toEqual(rows.toReversed().map((entry) => entry.hash));
  });

  it("supports keyboard selection, details, and the context menu", () => {
    const select = vi.fn();
    act(() =>
      render(
        h(
          "table",
          {},
          h(
            "tbody",
            {},
            rows.map((entry, index) =>
              h(CommitRow, {
                commit: entry,
                rows,
                tabStop: index === 0,
                isHead: false,
                headBranch: null,
                messages: new Map(),
                colour: undefined,
                expanded: false,
                onSelect: select
              })
            )
          )
        ),
        container
      )
    );
    const elements = container.querySelectorAll<HTMLTableRowElement>("tr");
    elements[0]!.focus();
    act(() => {
      elements[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(elements[1]);
    expect(focusedCommit.value).toBe(rows[1]!.hash);
    act(() => {
      elements[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(select).toHaveBeenCalledOnce();
    act(() => {
      elements[1]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true })
      );
    });
    expect(contextMenu.value?.entries.some((entry) => entry?.title === "compareWith")).toBe(true);
  });
});

describe("previews, background actions and progress", () => {
  it("waits for the native restore preview to finish before accepting another action", () => {
    const plan = {
      source: "a".repeat(40),
      sourcePath: "old.txt",
      destination: "current.txt",
      snapshot: "snapshot",
      dirty: false
    };
    openRestoreFile(plan.source, plan.sourcePath, plan.destination);
    const form = dialog.value;
    if (form?.kind !== "form") {
      throw new Error("Expected restore form");
    }
    form.onSubmit([plan.destination]);
    respond({ kind: "restorePlan", plan });
    act(() => render(h(Dialog, {}), container));
    const original = dialog.value;
    const controls = () =>
      [...container.querySelectorAll("button")].filter((button) =>
        ["restorePreview", "restoreHistoricalFile"].includes(button.textContent!)
      );
    expect(controls()).toHaveLength(2);
    expect(controls().every((button) => !button.disabled)).toBe(true);
    click("restorePreview");
    expect(lastRequest().query).toEqual({
      kind: "restorePlan",
      source: plan.source,
      sourcePath: plan.sourcePath,
      destination: plan.destination
    });
    respond({ kind: "restorePlan", plan });
    const preview = lastRequest();
    expect(preview.action).toEqual({ kind: "previewFileRestore", plan });
    expect(dialog.value).toBe(original);
    expect(controls().every((button) => button.disabled)).toBe(true);
    vscodeApi.postMessage.mockClear();
    click("restorePreview");
    click("restoreHistoricalFile");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    act(() =>
      handleActionResult({
        command: "repositoryAction",
        requestId: preview.requestId,
        repo: preview.repo,
        status: null
      })
    );
    expect(dialog.value).toBe(original);
    expect(controls().every((button) => !button.disabled)).toBe(true);
    click("restoreHistoricalFile");
    respond({ kind: "restorePlan", plan });
    expect(lastRequest().action).toEqual({ kind: "restoreFile", plan });
  });

  it("plans again when the file changed after its preview, and restores only after review", () => {
    const plan = {
      source: "a".repeat(40),
      sourcePath: "old.txt",
      destination: "current.txt",
      snapshot: "before",
      dirty: false
    };
    const edited = { ...plan, snapshot: "after", dirty: true };
    openRestoreFile(plan.source, plan.sourcePath, plan.destination);
    const form = dialog.value;
    if (form?.kind !== "form") {
      throw new Error("Expected restore form");
    }
    form.onSubmit([plan.destination]);
    respond({ kind: "restorePlan", plan });
    act(() => render(h(Dialog, {}), container));
    expect(container.textContent).not.toContain("restoreDirty");

    // The file was edited, perhaps in the preview: Restore shows the new state instead.
    click("restoreHistoricalFile");
    respond({ kind: "restorePlan", plan: edited });
    expect(
      vscodeApi.postMessage.mock.calls.some(([message]) => message.action?.kind === "restoreFile")
    ).toBe(false);
    expect(container.textContent).toContain("restorePlanChanged");
    expect(container.textContent).toContain("restoreDirty");

    click("restorePreview");
    respond({ kind: "restorePlan", plan: edited });
    expect(lastRequest().action).toEqual({ kind: "previewFileRestore", plan: edited });
    act(() =>
      handleActionResult({
        command: "repositoryAction",
        requestId: lastRequest().requestId,
        repo: lastRequest().repo,
        status: null
      })
    );
    click("restoreHistoricalFile");
    respond({ kind: "restorePlan", plan: edited });
    expect(lastRequest().action).toEqual({ kind: "restoreFile", plan: edited });
  });

  it("keeps comparison open when a native diff finishes", () => {
    openContentDialog("Comparison", "files");
    const original = dialog.value;
    sendRepositoryAction({
      kind: "viewRangeFile",
      left: "a",
      right: "b",
      before: "file",
      after: "file"
    });
    const request = lastRequest();
    expect(dialog.value).toBe(original);
    handleActionResult({
      command: "repositoryAction",
      requestId: request.requestId,
      repo: request.repo,
      status: null
    });
    expect(dialog.value).toBe(original);
  });

  it("runs a submodule action in its parent while retaining the viewed repository", () => {
    selectedRepo.value = "/parent/child";
    sendRepositoryAction(
      { kind: "submodule", operation: "update", path: "child", recorded: "a".repeat(40) },
      "/parent"
    );
    const request = lastRequest();
    expect(request.repo).toBe("/parent");
    expect(selectedRepo.value).toBe("/parent/child");
    handleActionResult({
      command: "repositoryAction",
      requestId: request.requestId,
      repo: request.repo,
      status: null
    });
    expect(dialog.value).toBeNull();
    expect(activity.value[0]?.finished).not.toBeNull();
  });

  it("records completion after a dialog is hidden without replacing a newer form", () => {
    sendRepositoryAction({ kind: "recoverBranch", name: "recovered", hash: "a".repeat(40) });
    const request = lastRequest();
    openErrorDialog("newer");
    const original = dialog.value;
    handleActionResult({
      command: "repositoryAction",
      requestId: request.requestId,
      repo: request.repo,
      status: "Git failed"
    });
    expect(dialog.value).toBe(original);
    expect(activity.value[0]?.error).toBe("Git failed");
    expect(
      vscodeApi.postMessage.mock.calls.some(([message]) => message.command === "loadBranches")
    ).toBe(true);
  });

  it("preserves reword edits when arranging fixup commits", () => {
    const plan = {
      base: "base",
      head: "head",
      branch: "main",
      entries: [
        { hash: "a", message: "target", action: "pick" as const },
        { hash: "b", message: "other", action: "pick" as const },
        { hash: "c", message: "fixup! target", action: "pick" as const }
      ]
    };
    act(() => render(h(RebaseEditor, { plan, repo: "/history-test" }), container));
    const choice = container.querySelector("select")!;
    act(() => {
      choice.value = "reword";
      choice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const message = container.querySelector("textarea")!;
    act(() => {
      message.value = "edited title";
      message.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click("arrangeAutosquash");
    act(() => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(lastRequest().action.plan.entries).toEqual([
      { hash: "a", message: "edited title", action: "reword" },
      { hash: "c", message: "fixup! target", action: "fixup" },
      plan.entries[1]
    ]);
  });

  it("shows errors with selectable text and a copy action", () => {
    openErrorDialog("Operation failed", "useful git details");
    act(() => render(h(Dialog, {}), container));
    expect(container.textContent).toContain("useful git details");
    expect(
      [...container.querySelectorAll("button")].some((button) => button.textContent === "copyError")
    ).toBe(true);
  });
});
