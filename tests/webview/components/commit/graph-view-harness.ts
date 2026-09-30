import { h, render } from "preact";
import { act } from "preact/test-utils";
import { expect, vi } from "vitest";

import type { HistoryEntry, RepositoryQuery, RepositoryQueryData } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { RequestMessage } from "@/types";
import { GraphView } from "@/webview/layout/GraphView";
import { resetGraphRequests } from "@/webview/lib/graph-requests";
import { commitMenuHintDismissed } from "@/webview/lib/hints";
import {
  emptyFilter,
  historyFilter,
  historyOffset,
  restoreScroll,
  selectedCommits
} from "@/webview/lib/navigation";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";

/** A commit the table can draw. Subjects are unique, so tests can find rows by text. */
export function entry(hash: string, ...parents: string[]): HistoryEntry {
  const message = `work on ${hash}`;
  return {
    hash,
    parentHashes: parents,
    author: "Ada",
    email: "ada@branchwise.test",
    date: 1_650_000_000,
    message,
    refs: []
  };
}

/** A straight line of commits, newest first: `chain("c", "b", "a")` has `a` as its root. */
export function chain(...hashes: string[]) {
  return hashes.map((hash, index) => {
    const parent = hashes[index + 1];
    return parent === undefined ? entry(hash) : entry(hash, parent);
  });
}

let host: HTMLDivElement | undefined;
let keyNames: LocalizedStrings | undefined;

/** A repository with nothing loaded, all branches shown, no search and nothing selected. */
export function resetGraphView() {
  resetGraphRequests();
  stores.selectedRepo.value = "/work/repo";
  stores.selectedBranch.value = "*";
  stores.branchDisplay.value = "filter";
  stores.focusPaused.value = false;
  stores.focusDimming.value = "subtle";
  stores.branchList.value = ["main"];
  stores.headBranch.value = "main";
  stores.commitList.value = undefined;
  stores.commitHead.value = null;
  stores.moreCommitsAvailable.value = false;
  stores.maxCommits.value = 300;
  stores.graphErrors.value = {};
  stores.showRemoteBranch.value = true;
  stores.repoStates.value = {};
  stores.expandedCommit.value = null;
  stores.contextMenu.value = null;
  stores.dialog.value = null;
  historyFilter.value = emptyFilter();
  historyOffset.value = 0;
  selectedCommits.value = [];
  restoreScroll.value = null;
  commitMenuHintDismissed.value = true;
  // The commit table measures its graph column.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.clearAllMocks();
}

/** Render the view into a fresh element of the document. */
export function showGraphView() {
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(GraphView, {}), host!));
  return host;
}

export function hideGraphView() {
  if (host !== undefined) {
    act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
  if (keyNames !== undefined) {
    Object.defineProperty(window, "l10n", { value: keyNames, configurable: true });
    keyNames = undefined;
  }
  vi.unstubAllGlobals();
}

/** Show these English templates; every other string stays its key name. */
export function withEnglish(strings: Partial<Record<keyof LocalizedStrings, string>>) {
  keyNames ??= window.l10n;
  const fallback = keyNames;
  const english = new Proxy(fallback, {
    get: (target, key) =>
      (strings as Record<string | symbol, string | undefined>)[key] ?? Reflect.get(target, key)
  });
  Object.defineProperty(window, "l10n", { value: english, configurable: true });
}

/** The element currently rendered by `showGraphView`. */
export function view() {
  if (host === undefined) {
    throw new Error("The graph view is not shown");
  }
  return host;
}

/** A button of the view by its whole text, or `undefined`. */
export function buttonNamed(text: string) {
  return [...view().querySelectorAll("button")].find((button) => button.textContent === text);
}

export function click(text: string) {
  const button = buttonNamed(text);
  expect(button, `button ${text}`).toBeDefined();
  act(() => button!.click());
}

type Sent<K extends RepositoryQuery["kind"]> = {
  repo: string;
  requestId: string;
  query: Extract<RepositoryQuery, { kind: K }>;
};

/** Every repository query of this kind the page has posted since the mocks were cleared. */
export function sentQueries<K extends RepositoryQuery["kind"]>(kind: K): Array<Sent<K>> {
  return vscodeApi.postMessage.mock.calls
    .map(([message]) => message as RequestMessage)
    .flatMap((message) =>
      message.command === "repositoryQuery" && message.query.kind === kind
        ? [message as unknown as Sent<K>]
        : []
    );
}

export function lastQuery<K extends RepositoryQuery["kind"]>(kind: K): Sent<K> {
  const sent = sentQueries(kind).at(-1);
  expect(sent, `a ${kind} query`).toBeDefined();
  return sent!;
}

/** Answer a posted query, as the extension would. */
export function reply(
  request: { repo: string; requestId: string },
  answer: { data: RepositoryQueryData } | { error: string }
) {
  act(() =>
    handleRepositoryQuery({
      repo: request.repo,
      requestId: request.requestId,
      data: "data" in answer ? answer.data : null,
      status: "error" in answer ? answer.error : null
    })
  );
}

/** Answer the latest history query with one page. */
export function replyWithPage(entries: HistoryEntry[], more = false) {
  reply(lastQuery("history"), { data: { kind: "history", page: { entries, more } } });
}

/** The relation the table gives a row, which follows the focus data. */
export function relationOf(hash: string) {
  return view()
    .querySelector(`tr[data-commit-hash="${hash}"]`)
    ?.getAttribute("data-branch-relation");
}
