// @vitest-environment jsdom
// Timing report for the uncommitted-changes list. Run with NGG_BENCH_WORKING_TREE=1; the normal
// suite skips it. It prints the medians as JSON. See docs/performance.md.

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, expect, it, vi } from "vitest";

import type { HistoryEntry, QueryRequest, WorkingTreeFile } from "@/backend/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const SAMPLES = 5;

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]! * 10) / 10;
}

function time(run: () => void) {
  const start = performance.now();
  act(run);
  return performance.now() - start;
}

beforeAll(() => {
  setupWebviewTest();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});

/** The webview's type configuration has no Node types; the tests still run in Node. */
const environment = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;

it.runIf(environment?.NGG_BENCH_WORKING_TREE === "1")(
  "measures the uncommitted-changes list with 20,000 untracked files",
  async () => {
    const { CommitTable } = await import("@/webview/components/commit/CommitTable");
    const { handleRepositoryQuery } = await import("@/webview/lib/repository-actions");
    const { refresh } = await import("@/webview/lib/actions");
    const stores = await import("@/webview/lib/stores");
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
    const files: WorkingTreeFile[] = Array.from({ length: 20_000 }, (_, i) => ({
      path: `new/file-${i}.txt`,
      oldPath: `new/file-${i}.txt`,
      status: "?",
      group: "untracked"
    }));
    const reply = () => {
      const message = vscodeApi.postMessage.mock.calls
        .map(([sent]) => sent as QueryRequest)
        .findLast((sent) => sent.command === "repositoryQuery")!;
      if (message.command !== "repositoryQuery") {
        throw new Error("Missing working tree request");
      }
      handleRepositoryQuery({
        requestId: message.requestId,
        repo: message.repo,
        data: { kind: "workingTree", files: [...files] },
        status: null
      });
    };
    stores.selectedRepo.value = "/repo";
    stores.uncommittedChanges.value = files.length;
    const samples = { firstRender: [] as number[], refresh: [] as number[] };
    for (let i = 0; i < SAMPLES; i++) {
      const container = document.createElement("div");
      document.body.append(container);
      stores.expandedCommit.value = null;
      act(() =>
        render(
          h(CommitTable, { commits: [dirty, commit], head: commit.hash, headBranch: "main" }),
          container
        )
      );
      act(() => container.querySelector<HTMLElement>('tr[data-commit-hash="*"]')!.click());
      samples.firstRender.push(time(reply));
      // The refresh request renders once, and its answer renders again.
      samples.refresh.push(time(refresh) + time(reply));
      expect(container.querySelector("[data-working-tree-details]")).not.toBeNull();
      act(() => render(null, container));
      container.remove();
    }
    const report = { firstRender: median(samples.firstRender), refresh: median(samples.refresh) };
    // eslint-disable-next-line no-console
    console.log(`benchmark-working-tree ${JSON.stringify(report)}`);
  },
  120_000
);
