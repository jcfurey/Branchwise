// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry, RebasePlan, ReplayForecast } from "@/backend/types";
import { BatchEditor } from "@/webview/components/history/HistoryTools";
import { openRebase, RebaseEditor } from "@/webview/components/repository/RebaseEditor";
import { Dialog } from "@/webview/components/ui/Dialog";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { commitHead, dialog, headBranch, selectedRepo } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

const mocks = vi.hoisted(() => ({ postMessage: vi.fn() }));
vi.mock("@/webview/lib/vscode", () => ({
  vscode: { postMessage: mocks.postMessage, getState: vi.fn(), setState: vi.fn() }
}));

/** The English text of the strings these tests read, so that the sentences can be checked. */
const ENGLISH: Record<string, string> = {
  forecastChecking: "Checking for conflicts…",
  forecastRebaseStop: "Rebase would stop at {0}: conflicts in {1}",
  forecastCherryPickStop: "Cherry-pick would stop at {0}: conflicts in {1}",
  forecastRevertStop: "Revert would stop at {0}: conflicts in {1}",
  forecastStopsHere: "Would stop here: conflicts in {0}",
  forecastReplaysOne: "Replays 1 commit cleanly",
  forecastReplays: "Replays {0} commits cleanly",
  forecastRevertsOne: "Reverts 1 commit cleanly",
  forecastReverts: "Reverts {0} commits cleanly",
  forecastSkippedLimit: "Conflict forecast skipped: too many commits",
  forecastNeedsGit: "Conflict forecast needs Git 2.40 or later",
  conflictForecastMore: "and {0} more files"
};

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

let container: HTMLDivElement;
beforeAll(() => {
  setupWebviewTest();
  const keys = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keys, {
      get: (target, key) => (typeof key === "string" && ENGLISH[key]) || Reflect.get(target, key)
    }),
    configurable: true
  });
});
beforeEach(() => {
  mocks.postMessage.mockClear();
  selectedRepo.value = "/repo";
  headBranch.value = "topic";
  commitHead.value = C;
  dialog.value = null;
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.useRealTimers();
});

type Posted = { command: string; repo: string; requestId: string; query?: { kind: string } };
const posted = (): Posted[] => mocks.postMessage.mock.calls.map((call) => call[0] as Posted);
const forecastRequests = () =>
  posted().filter(
    (message) => message.command === "repositoryQuery" && message.query?.kind === "replayForecast"
  );
const answer = (request: Posted, forecast: ReplayForecast | null, status: string | null = null) =>
  act(() =>
    handleRepositoryQuery({
      repo: request.repo,
      requestId: request.requestId,
      data: forecast === null ? null : { kind: "replayForecast", forecast },
      status
    })
  );
const line = () => container.querySelector<HTMLElement>("[data-replay-forecast]")!;

describe("the rebase confirmation", () => {
  const open = () => {
    openRebase("main");
    act(() => render(h(Dialog, {}), container));
  };

  it("says Checking while the forecast runs, then names the commit and files it stops at", () => {
    open();
    const [request] = forecastRequests();
    expect(request?.query).toEqual({ kind: "replayForecast", mode: "rebase", onto: "main" });
    expect(line().textContent).toBe("Checking for conflicts…");
    expect(line().getAttribute("role")).toBe("status");

    answer(request!, {
      stop: { hash: B, subject: "second", files: ["a.ts", "b.ts", "c.ts"] },
      replayed: 1
    });
    expect(line().dataset["replayForecast"]).toBe("stop");
    expect(line().textContent).toBe(
      `Rebase would stop at ${B.slice(0, 8)} second: conflicts in a.ts, b.ts, c.ts`
    );
    expect(line().querySelector("svg")).not.toBeNull();
    // The forecast only informs: the rebase can still be started.
    const start = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "startRebase"
    );
    expect(start?.disabled).toBe(false);
  });

  it("counts the files past the first five", () => {
    open();
    answer(forecastRequests()[0]!, {
      stop: { hash: B, subject: "big", files: ["1", "2", "3", "4", "5", "6", "7"] },
      replayed: 0
    });
    expect(line().textContent).toBe(
      `Rebase would stop at ${B.slice(0, 8)} big: conflicts in 1, 2, 3, 4, 5 and 2 more files`
    );
  });

  it.each([
    [{ stop: null, replayed: 3 }, "clean", "Replays 3 commits cleanly"],
    [{ stop: null, replayed: 1 }, "clean", "Replays 1 commit cleanly"],
    [{ stop: null, replayed: 0 }, "none", ""],
    [
      { stop: null, replayed: 0, skipped: "limit" as const },
      "skipped",
      "Conflict forecast skipped: too many commits"
    ],
    [
      { stop: null, replayed: 0, skipped: "unsupported" as const },
      "skipped",
      "Conflict forecast needs Git 2.40 or later"
    ]
  ])("reads %j as %s: %s", (forecast, kind, text) => {
    open();
    answer(forecastRequests()[0]!, forecast);
    expect(line().dataset["replayForecast"]).toBe(kind);
    expect(line().textContent).toBe(text);
  });

  it("shows nothing when the forecast fails", () => {
    open();
    answer(forecastRequests()[0]!, null, "fatal: bad revision");
    expect(line().dataset["replayForecast"]).toBe("none");
    expect(line().textContent).toBe("");
  });
});

describe("the interactive rebase editor", () => {
  const plan: RebasePlan = {
    base: "0".repeat(40),
    head: C,
    branch: "topic",
    entries: [A, B, C].map((hash) => ({ hash, message: `commit ${hash[0]}`, action: "pick" }))
  };
  const moveLater = (hash: string) =>
    act(() =>
      container
        .querySelector<HTMLButtonElement>(`button[aria-label="moveLater ${hash.slice(0, 8)}"]`)!
        .click()
    );

  it("waits for the order to settle, marks the stop, and cancels a stale forecast", () => {
    vi.useFakeTimers();
    act(() => render(h(RebaseEditor, { plan, repo: "/repo" }), container));
    expect(forecastRequests()).toHaveLength(0);
    expect(line().textContent).toBe("Checking for conflicts…");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const [first] = forecastRequests();
    expect(first?.query).toMatchObject({ mode: "pick", onto: plan.base, commits: [A, B, C] });

    answer(first!, { stop: { hash: B, subject: "commit b", files: ["f"] }, replayed: 1 });
    const marked = container.querySelectorAll("[data-forecast-stop]");
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest("[data-entry]")?.getAttribute("data-entry")).toBe(B);
    expect(marked[0]!.textContent).toBe("Would stop here: conflicts in f");
    expect(line().textContent).toBe(
      `Rebase would stop at ${B.slice(0, 8)} commit b: conflicts in f`
    );

    // Reordering asks again; a request still running for an older order is given up at once.
    moveLater(A);
    expect(container.querySelectorAll("[data-forecast-stop]")).toHaveLength(0);
    moveLater(A);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(forecastRequests()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const [, second] = forecastRequests();
    expect(second?.query).toMatchObject({ commits: [B, C, A] });

    moveLater(B);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(posted()).toContainEqual({
      command: "cancelRepositoryQuery",
      repo: "/repo",
      requestId: second!.requestId
    });
    expect(forecastRequests().at(-1)?.query).toMatchObject({ commits: [C, B, A] });
  });

  it("leaves dropped commits out of the forecast", () => {
    vi.useFakeTimers();
    act(() => render(h(RebaseEditor, { plan, repo: "/repo" }), container));
    const select = container.querySelectorAll("select")[1]!;
    act(() => {
      select.value = "drop";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(forecastRequests().at(-1)?.query).toMatchObject({ commits: [A, C] });
  });
});

describe("the cherry-pick and revert editors", () => {
  const entry = (hash: string): HistoryEntry => ({
    hash,
    parentHashes: ["0".repeat(40)],
    author: "T",
    email: "t@t",
    date: 1,
    message: `commit ${hash[0]}`,
    refs: []
  });
  const batch = { head: C, branch: "topic", entries: [A, B].map(entry) };

  it.each([
    [
      "cherry-pick" as const,
      "pick",
      `Cherry-pick would stop at ${A.slice(0, 8)} commit a: conflicts in g`
    ],
    ["revert" as const, "revert", `Revert would stop at ${A.slice(0, 8)} commit a: conflicts in g`]
  ])("forecast a %s onto HEAD in the order shown", (operation, mode, text) => {
    vi.useFakeTimers();
    act(() => render(h(BatchEditor, { plan: batch, operation, repo: "/repo" }), container));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const [request] = forecastRequests();
    expect(request?.query).toEqual({ kind: "replayForecast", mode, onto: C, commits: [A, B] });
    answer(request!, { stop: { hash: A, subject: "commit a", files: ["g"] }, replayed: 0 });
    expect(line().textContent).toBe(text);
    expect(
      container
        .querySelector("[data-forecast-stop]")
        ?.closest("[data-entry]")
        ?.getAttribute("data-entry")
    ).toBe(A);
  });

  it("says how many commits a revert undoes cleanly", () => {
    vi.useFakeTimers();
    act(() =>
      render(h(BatchEditor, { plan: batch, operation: "revert", repo: "/repo" }), container)
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    answer(forecastRequests()[0]!, { stop: null, replayed: 2 });
    expect(line().textContent).toBe("Reverts 2 commits cleanly");
  });
});
