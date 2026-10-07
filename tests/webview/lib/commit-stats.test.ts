// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommitStats, RepositoryQuery } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { ROW_HEIGHT, UNCOMMITTED_CHANGES } from "@/webview/constants";
import {
  commitStatsOf,
  requestCommitStats,
  rowsInSight,
  STATS_MARGIN,
  STATS_SETTLE_MS
} from "@/webview/lib/commit-stats";
import { handleRepositoryQuery, repositoryRevision } from "@/webview/lib/repository-actions";
import { expandedCommit, repoStates, selectedRepo } from "@/webview/lib/stores";

import {
  attachHost,
  entry,
  reconfigure,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

type Posted = { command: string; repo: string; requestId: string; query?: RepositoryQuery };

const outbox = (): Posted[] => vscodeApi.postMessage.mock.calls.map(([sent]) => sent as Posted);
const reads = () =>
  outbox().filter(
    (message) => message.command === "repositoryQuery" && message.query?.kind === "commitStats"
  );
const askedFor = (read: Posted | undefined) =>
  read?.query?.kind === "commitStats" ? read.query.hashes : [];
const cancels = () => outbox().filter(({ command }) => command === "cancelRepositoryQuery");

const stats = (additions: number, deletions = 0, files = 1): CommitStats => ({
  files,
  additions,
  deletions,
  body: "",
  bodyCut: false
});

/** Answer `read` with counts for each hash it asked for, or with a failure for `null`. */
function answer(read: Posted, make: ((hash: string) => CommitStats | undefined) | null) {
  const result: Record<string, CommitStats> = {};
  for (const hash of askedFor(read)) {
    const each = make?.(hash);
    if (each !== undefined) {
      result[hash] = each;
    }
  }
  act(() =>
    handleRepositoryQuery({
      repo: read.repo,
      requestId: read.requestId,
      data: make === null ? null : { kind: "commitStats", stats: result },
      status: make === null ? "failed" : null
    })
  );
}

/** A repository name of its own for each test, as answers are kept for the session. */
let repo = "";
let count = 0;
let host: HTMLDivElement;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak();
  stubResizeObserver();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  count += 1;
  repo = `/repo-${count}`;
  selectedRepo.value = repo;
  repoStates.value = {};
  expandedCommit.value = null;
  vscodeApi.postMessage.mockClear();
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("rowsInSight", () => {
  it("covers the rows in the window and a margin either side", () => {
    // The body starts 100 rows above the window, which is 20 rows tall.
    const top = -100 * ROW_HEIGHT;
    expect(rowsInSight(top, 20 * ROW_HEIGHT, 1000, false)).toEqual([
      100 - STATS_MARGIN,
      120 + STATS_MARGIN
    ]);
  });

  it("stays within the rows there are", () => {
    expect(rowsInSight(200, 480, 10, false)).toEqual([0, 10]);
    expect(rowsInSight(-10_000 * ROW_HEIGHT, 480, 50, false)).toEqual([50, 50]);
  });

  it("reaches further up while details push the rows below them down", () => {
    const [plain] = rowsInSight(-100 * ROW_HEIGHT, 480, 1000, false);
    const [open] = rowsInSight(-100 * ROW_HEIGHT, 480, 1000, true);
    expect(open).toBeLessThan(plain);
  });
});

describe("requestCommitStats", () => {
  it("asks once for each unknown commit, and never for the uncommitted changes", () => {
    const stop = requestCommitStats(repo, ["a", "b", "a", UNCOMMITTED_CHANGES]);
    requestCommitStats(repo, ["b", "c"]);
    expect(reads().map(askedFor)).toEqual([["a", "b"], ["c"]]);

    answer(reads()[0]!, (hash) => stats(hash === "a" ? 1 : 2));
    expect(commitStatsOf(repo, "a")?.additions).toBe(1);
    expect(commitStatsOf(repo, "b")?.additions).toBe(2);
    // Answered already: stopping now sends nothing.
    stop();
    expect(cancels()).toHaveLength(0);

    vscodeApi.postMessage.mockClear();
    requestCommitStats(repo, ["a", "b"]);
    expect(reads()).toHaveLength(0);
  });

  it("keeps answers apart by repository", () => {
    requestCommitStats(repo, ["a"]);
    answer(reads()[0]!, () => stats(7));
    expect(commitStatsOf(repo, "a")?.additions).toBe(7);
    expect(commitStatsOf(`${repo}-other`, "a")).toBeUndefined();
  });

  it("asks again for a commit whose read was stopped", () => {
    const stop = requestCommitStats(repo, ["a"]);
    stop();
    expect(cancels()).toHaveLength(1);
    requestCommitStats(repo, ["a"]);
    expect(reads().map(askedFor)).toEqual([["a"], ["a"]]);
  });

  it("asks again for a commit it could not count only once the repository changes", () => {
    requestCommitStats(repo, ["a", "b"]);
    answer(reads()[0]!, (hash) => (hash === "a" ? stats(1) : undefined));
    requestCommitStats(repo, ["a", "b"]);
    expect(reads()).toHaveLength(1);

    repositoryRevision.value += 1;
    requestCommitStats(repo, ["a", "b"]);
    expect(reads().map(askedFor)).toEqual([["a", "b"], ["b"]]);
    answer(reads()[1]!, null);
    expect(commitStatsOf(repo, "b")).toBeUndefined();
  });
});

describe("the Changes column", () => {
  const ROWS = 100;
  const commits = [
    entry(UNCOMMITTED_CHANGES),
    ...Array.from({ length: ROWS }, (_, at) => entry(`c${at}`, at + 1 < ROWS ? [`c${at + 1}`] : []))
  ];
  const draw = () =>
    act(() => render(h(CommitTable, { commits, head: "c0", headBranch: "main" }), host));
  const cell = (hash: string) =>
    host.querySelector<HTMLElement>(`tr[data-commit-hash="${hash}"] [data-changes]`);
  /** Make the table's body start `rows` rows above the top of the window. */
  const scrollTo = (rows: number) => {
    const body = host.querySelector("tbody")!;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      top: -rows * ROW_HEIGHT
    } as DOMRect);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
  };

  it("is off by default, and then reads no counts", () => {
    draw();
    expect(host.querySelectorAll("thead th")).toHaveLength(5);
    expect(host.querySelector("[data-changes]")).toBeNull();
    expect(reads()).toHaveLength(0);
  });

  it("asks for the rows in sight, shows nothing until they come, then +N −M", () => {
    const restore = reconfigure({ showChangesColumn: true });
    speak({
      changesColumn: "Changes",
      changesSummary: "{0}, {1}, {2}",
      filesChangedPlural: "{0} files changed",
      insertionsPlural: "{0} insertions",
      deletionsPlural: "{0} deletions"
    });
    try {
      draw();
      const headings = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
      expect(headings.at(-1)).toBe("Changes");
      expect(host.querySelectorAll("col")).toHaveLength(6);
      // The uncommitted changes have a cell, which stays empty.
      expect(cell(UNCOMMITTED_CHANGES)?.textContent).toBe("");
      expect(cell("c0")?.textContent).toBe("");

      // jsdom's window is 768 pixels tall: 32 rows, and the margin below them.
      const [start, end] = rowsInSight(0, window.innerHeight, commits.length, false);
      expect(reads()).toHaveLength(1);
      expect(askedFor(reads()[0])).toEqual(
        commits
          .slice(start, end)
          .map(({ hash }) => hash)
          .filter((hash) => hash !== UNCOMMITTED_CHANGES)
      );
      expect(askedFor(reads()[0])).not.toContain("c99");

      answer(reads()[0]!, (hash) => (hash === "c0" ? stats(12, 3, 4) : stats(1, 1, 1)));
      expect(cell("c0")?.textContent).toBe("+12 −3");
      expect(cell("c0")?.title).toBe("4 files changed, 12 insertions, 3 deletions");
      expect(cell("c0")?.querySelector(".text-git-added")?.textContent).toBe("+12");
      expect(cell("c0")?.querySelector(".text-git-deleted")?.textContent).toBe("−3");
      expect(cell("c99")?.textContent).toBe("");
    } finally {
      restore();
    }
  });

  it("asks for the rows that scroll into sight once scrolling pauses", () => {
    const restore = reconfigure({ showChangesColumn: true });
    vi.useFakeTimers();
    try {
      draw();
      answer(reads()[0]!, () => stats(1));
      const first = askedFor(reads()[0]);

      scrollTo(60);
      vi.advanceTimersByTime(STATS_SETTLE_MS - 1);
      expect(reads()).toHaveLength(1);
      // Scrolling again starts the pause again.
      scrollTo(70);
      vi.advanceTimersByTime(STATS_SETTLE_MS - 1);
      expect(reads()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(reads()).toHaveLength(2);

      const [start, end] = rowsInSight(-70 * ROW_HEIGHT, window.innerHeight, commits.length, false);
      const inSight = commits.slice(start, end).map(({ hash }) => hash);
      expect(askedFor(reads()[1])).toEqual(inSight.filter((hash) => !first.includes(hash)));
      expect(askedFor(reads()[1])).toContain("c99");
    } finally {
      restore();
    }
  });

  it("stops a read still waiting when the table goes, and reads nothing once turned off", () => {
    const restore = reconfigure({ showChangesColumn: true });
    vi.useFakeTimers();
    try {
      draw();
      expect(reads()).toHaveLength(1);
      act(() => render(null, host));
      expect(cancels().map(({ requestId }) => requestId)).toEqual([reads()[0]!.requestId]);

      draw();
      expect(reads()).toHaveLength(2);
      act(() => {
        reconfigure({ showChangesColumn: false });
      });
      expect(cancels()).toHaveLength(2);
      expect(host.querySelector("[data-changes]")).toBeNull();
      scrollTo(80);
      vi.advanceTimersByTime(STATS_SETTLE_MS);
      expect(reads()).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it("stops a read still waiting when another repository is shown", () => {
    const restore = reconfigure({ showChangesColumn: true });
    try {
      draw();
      act(() => {
        selectedRepo.value = `${repo}-next`;
      });
      expect(cancels().map(({ requestId }) => requestId)).toEqual([reads()[0]!.requestId]);
      expect(reads().at(-1)?.repo).toBe(`${repo}-next`);
    } finally {
      restore();
    }
  });
});
