import { effect } from "@preact/signals";
import { beforeEach, expect, it, vi } from "vitest";

import type { WebviewConfig } from "@/types";

let holder: typeof import("@/webview/lib/webview-config");

const settings = (overrides: Partial<WebviewConfig> = {}): WebviewConfig => ({
  autoCenterCommitDetailsView: false,
  branchHoverPreview: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Date Only",
  dragAndDrop: true,
  graphColours: ["#123456"],
  graphStyle: "angular",
  initialLoadCommits: 50,
  issueLinks: [],
  loadMoreCommits: 25,
  locale: "fr",
  showCurrentBranchByDefault: true,
  showNearestBranch: true,
  singleKeyShortcuts: true,
  ...overrides
});

beforeEach(async () => {
  vi.resetModules();
  holder = await import("@/webview/lib/webview-config");
});

/** Count how often an effect that reads the settings runs, the first run included. */
function countReads() {
  const count = { runs: 0, seen: undefined as WebviewConfig | undefined };
  const stop = effect(() => {
    count.runs += 1;
    try {
      count.seen = holder.getWebviewConfig();
    } catch {
      count.seen = undefined;
    }
  });
  return { count, stop };
}

it("tells readers nothing when the stored object is stored again, but does for a copy", () => {
  const first = settings();
  holder.initializeWebviewConfig(first);
  const { count, stop } = countReads();

  expect(holder.updateWebviewConfig(first)).toBe(true);
  expect(count.runs).toBe(1);

  const copy = { ...first };
  expect(holder.updateWebviewConfig(copy)).toBe(true);
  expect(count.runs).toBe(2);
  expect(count.seen).toBe(copy);
  stop();
});

it("wakes a reader that asked too early once the settings arrive", () => {
  const { count, stop } = countReads();
  expect(count.seen).toBeUndefined();

  const first = settings({ locale: "de" });
  holder.initializeWebviewConfig(first);
  expect(count.runs).toBe(2);
  expect(count.seen).toBe(first);
  stop();
});

it("throws real errors", () => {
  const missing = (() => {
    try {
      holder.getWebviewConfig();
    } catch (error: unknown) {
      return error;
    }
    return undefined;
  })();
  expect(missing).toBeInstanceOf(Error);

  holder.initializeWebviewConfig(settings());
  expect(() => holder.initializeWebviewConfig(settings())).toThrow(Error);
});

it("keeps the caller's object as it is, open to changes in place", () => {
  const first = settings();
  holder.initializeWebviewConfig(first);
  expect(Object.isFrozen(holder.getWebviewConfig())).toBe(false);

  Object.assign(holder.getWebviewConfig(), { locale: "de" });
  expect(holder.getWebviewConfig().locale).toBe("de");
  expect(holder.getWebviewConfig()).toBe(first);
});

it("does not make an updater depend on the settings", () => {
  holder.initializeWebviewConfig(settings());
  let runs = 0;
  const stop = effect(() => {
    runs += 1;
    holder.updateWebviewConfig(settings({ locale: String(runs) }));
  });
  holder.updateWebviewConfig(settings());
  stop();
  expect(runs).toBe(1);
});
