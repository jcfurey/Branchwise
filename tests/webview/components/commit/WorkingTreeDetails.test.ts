// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { HistoryEntry, QueryRequest, WorkingTreeFile } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { handleCommitDetails } from "@/webview/lib/handler/commit-details";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { dialog, expandedCommit, selectedRepo, uncommittedChanges } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const commit: HistoryEntry = {
  hash: "a".repeat(40),
  parentHashes: [],
  author: "Author",
  email: "a@test",
  date: 0,
  message: "First commit",
  refs: []
};
const dirty = { ...commit, hash: "*", author: "*", parentHashes: [commit.hash] };
let container: HTMLDivElement;
const row = (hash = "*") =>
  container.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${hash}"]`)!;
const draw = () =>
  render(
    h(CommitTable, { commits: [dirty, commit], head: commit.hash, headBranch: "main" }),
    container
  );
const request = () =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as QueryRequest)
    .findLast(
      (message) => message.command === "repositoryQuery" && message.query.kind === "workingTree"
    )!;
const reply = (files: WorkingTreeFile[], status: string | null = null) => {
  const message = request();
  if (message.command !== "repositoryQuery") {
    throw new Error("Missing working tree request");
  }
  act(() =>
    handleRepositoryQuery({
      requestId: message.requestId,
      repo: message.repo,
      data: status ? null : { kind: "workingTree", files },
      status
    })
  );
};
const key = (hash: string, value: string, shiftKey = false) =>
  act(() => {
    row(hash).dispatchEvent(
      new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })
    );
  });

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  selectedRepo.value = "/repo";
  expandedCommit.value = null;
  focusedCommit.value = null;
  selectedCommits.value = [];
  uncommittedChanges.value = 2;
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  act(draw);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens grouped changes from the graph and sends the chosen diff without a blocking dialog", () => {
  act(() => row().click());
  expect(expandedCommit.value).toBe("*");
  expect(row().getAttribute("aria-expanded")).toBe("true");
  expect(request()).toMatchObject({ repo: "/repo", query: { kind: "workingTree" } });
  expect(
    vscodeApi.postMessage.mock.calls.some(([message]) => message.command === "commitDetails")
  ).toBe(false);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect([...row().cells].slice(2).map((cell) => cell.textContent)).toEqual(["", "", ""]);
  reply([
    { path: "f", oldPath: "f", status: "M", group: "unstaged" },
    { path: "f", oldPath: "f", status: "M", group: "staged" },
    { path: "new.txt", oldPath: "new.txt", status: "?", group: "untracked" }
  ]);
  expect(container.querySelectorAll("section")).toHaveLength(3);
  act(() =>
    container
      .querySelector<HTMLButtonElement>('section[aria-label="stagedChanges"] button')!
      .click()
  );
  expect(vscodeApi.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      command: "repositoryAction",
      repo: "/repo",
      action: { kind: "viewWorkingTreeFile", path: "f", group: "staged" }
    })
  );
  expect(dialog.value).toBeNull();
  act(() => row().click());
  expect(container.querySelector("[data-working-tree-details]")).toBeNull();
});

it("supports keyboard navigation, Enter, Space and Escape without selecting the synthetic commit", () => {
  expect(row().tabIndex).toBe(0);
  act(() => row(commit.hash).focus());
  key(commit.hash, "ArrowUp");
  expect(document.activeElement).toBe(row());
  key("*", "Enter");
  expect(expandedCommit.value).toBe("*");
  expect(selectedCommits.value).toEqual([]);
  key("*", " ");
  expect(expandedCommit.value).toBeNull();
  key("*", " ");
  const close = container.querySelector<HTMLButtonElement>('[aria-label="close"]')!;
  act(() => {
    close.focus();
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(expandedCommit.value).toBeNull();
  expect(document.activeElement).toBe(row());
  key("*", "ArrowDown", true);
  expect(selectedCommits.value.map((entry) => entry.hash)).toEqual([commit.hash]);
  key(commit.hash, "Home", true);
  expect(selectedCommits.value.every((entry) => entry.hash !== "*")).toBe(true);
});

it("shows errors, retries on refresh and reports an empty working tree", () => {
  act(() => row().click());
  reply([], "Could not read Git status");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not read Git status");
  const previous = request();
  act(() =>
    container.querySelector<HTMLButtonElement>("[data-working-tree-details] button")!.click()
  );
  expect(request()).not.toEqual(previous);
  reply([]);
  expect(container.textContent).toContain("noWorkingTreeChanges");
});

it("ignores a late commit error after switching to working changes and cancels on close", () => {
  act(() => row(commit.hash).click());
  const pending = vscodeApi.postMessage.mock.calls
    .map(([message]) => message as QueryRequest)
    .findLast((message) => message.command === "commitDetails")!;
  act(() => row().click());
  act(() =>
    handleCommitDetails({
      command: "commitDetails",
      repo: pending.repo,
      requestId: pending.requestId,
      commitDetails: null
    })
  );
  expect(expandedCommit.value).toBe("*");
  expect(dialog.value).toBeNull();
  const working = request();
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="close"]')!.click());
  expect(vscodeApi.postMessage).toHaveBeenCalledWith({
    command: "cancelRepositoryQuery",
    repo: "/repo",
    requestId: working.requestId
  });
  expect(document.activeElement).toBe(row());
});

it("labels an untracked nested repository and asks the extension to explain it", () => {
  act(() => row().click());
  reply([
    { path: "nested/", oldPath: "nested/", status: "?", group: "untracked", repository: true },
    { path: "plain.txt", oldPath: "plain.txt", status: "?", group: "untracked" }
  ]);
  const [nested, plain] = [
    ...container.querySelectorAll<HTMLButtonElement>('section[aria-label="untrackedFiles"] button')
  ];
  expect(nested?.textContent).toContain("(nestedRepository)");
  expect(plain?.textContent).not.toContain("nestedRepository");
  act(() => nested!.click());
  expect(vscodeApi.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: { kind: "viewWorkingTreeFile", path: "nested/", group: "untracked" }
    })
  );
});

const files = (group: WorkingTreeFile["group"], names: string[]): WorkingTreeFile[] =>
  names.map((path) => ({ path, oldPath: path, status: group === "untracked" ? "?" : "M", group }));
const numbered = (count: number) => Array.from({ length: count }, (_, i) => `file-${i}.txt`);
const fileButton = (group: string, path: string) =>
  container.querySelector<HTMLButtonElement>(
    `button[data-file-group="${group}"][data-file-path="${path}"]`
  );
const refreshList = () =>
  act(() =>
    container.querySelector<HTMLButtonElement>("[data-working-tree-details] button")!.click()
  );

it("keeps the list and focus on screen while a refresh reloads it", () => {
  act(() => row().click());
  reply(files("unstaged", numbered(50)));
  const list = container.querySelector<HTMLElement>("[aria-busy]")!;
  const target = fileButton("unstaged", "file-29.txt")!;
  act(() => target.focus());

  const previous = request();
  refreshList();
  expect(request()).not.toEqual(previous);
  // The old list stays, marked busy, instead of a loading indicator.
  expect(container.querySelector("[aria-busy]")).toBe(list);
  expect(list.getAttribute("aria-busy")).toBe("true");
  expect(list.querySelector('[role="status"]')).toBeNull();
  expect(list.querySelectorAll("button[data-file-path]")).toHaveLength(50);
  expect(document.activeElement).toBe(target);

  reply(files("unstaged", numbered(50)));
  expect(list.getAttribute("aria-busy")).toBe("false");
  expect(document.activeElement).toBe(target);
});

it("keeps focus on a file that moved to another group, or on its neighbour", () => {
  act(() => row().click());
  reply(files("unstaged", numbered(50)));
  act(() => fileButton("unstaged", "file-29.txt")!.focus());

  // Staging the focused file moves it to Staged Changes.
  refreshList();
  const unstaged = numbered(50).filter((name) => name !== "file-29.txt");
  reply([...files("unstaged", unstaged), ...files("staged", ["file-29.txt"])]);
  expect(document.activeElement).toBe(fileButton("staged", "file-29.txt"));

  // A file that is gone hands focus to the one that took its place.
  act(() => fileButton("unstaged", "file-5.txt")!.focus());
  refreshList();
  reply(
    files(
      "unstaged",
      unstaged.filter((name) => name !== "file-5.txt")
    )
  );
  expect(document.activeElement).toBe(fileButton("unstaged", "file-6.txt"));

  // Focus that the user moved elsewhere stays there.
  const outside = container.querySelector<HTMLButtonElement>('[aria-label="close"]')!;
  act(() => fileButton("unstaged", "file-6.txt")!.focus());
  act(() => outside.focus());
  refreshList();
  reply(files("unstaged", ["file-7.txt"]));
  expect(document.activeElement).toBe(outside);
});

it("shows 200 files of a large group at a time", () => {
  act(() => row().click());
  reply([...files("untracked", numbered(20_000)), ...files("staged", ["staged.txt"])]);
  const untracked = () =>
    container.querySelectorAll('section[aria-label="untrackedFiles"] button[data-file-path]');
  expect(untracked()).toHaveLength(200);
  expect(container.textContent).toContain("untrackedFiles (20000)");
  const more = [
    ...container.querySelectorAll<HTMLButtonElement>('section[aria-label="untrackedFiles"] button')
  ].at(-1)!;
  expect(more.dataset["filePath"]).toBeUndefined();
  act(() => more.click());
  expect(untracked()).toHaveLength(400);
  expect(fileButton("staged", "staged.txt")).not.toBeNull();
});
