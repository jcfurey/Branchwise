// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeTab,
  emptyFilter,
  enterNavigation,
  focusHistory,
  historyFilter,
  leaveNavigation,
  restoreScroll,
  setHistoryFilter,
  showTab
} from "@/webview/lib/navigation";
import { selectedRepo } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();

/** Where the window is scrolled to, which jsdom never moves by itself. */
let scrollY = 0;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollY = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  selectedRepo.value = "/repo";
  enterNavigation("/repo");
  showTab("graph");
  // What an earlier test searched for is saved with the repository; start without it.
  setHistoryFilter(emptyFilter());
  restoreScroll.value = null;
  scrollTo.mockClear();
});
afterEach(() => {
  showTab("graph");
  restoreScroll.value = null;
  vi.restoreAllMocks();
});

describe("the graph's scroll position and the other tabs", () => {
  it("is kept on the way to another tab and asked for again on the way back", () => {
    scrollY = 4200;
    showTab("reflog");
    expect(activeTab.value).toBe("reflog");
    // The reflog is a short page: the window is at its top now.
    scrollY = 0;

    showTab("graph");
    expect(restoreScroll.value).toBe(4200);
  });

  it("is not replaced by where another tab was scrolled to", () => {
    scrollY = 4200;
    showTab("statistics");
    scrollY = 35;
    showTab("reflog");
    scrollY = 0;
    showTab("graph");
    expect(restoreScroll.value).toBe(4200);
  });

  it("stays as saved while a restore of it is still pending", () => {
    scrollY = 900;
    leaveNavigation("/repo");
    // The rows have not arrived, so the window is still at the top.
    scrollY = 0;
    restoreScroll.value = 900;
    showTab("reflog");
    showTab("graph");
    expect(restoreScroll.value).toBe(900);
  });
});

describe("showing the history at a commit", () => {
  const HASH = "a".repeat(40);

  it("starts at the top once the rows of a new search arrive", () => {
    focusHistory(HASH);
    expect(historyFilter.value.revision).toBe(HASH);
    expect(restoreScroll.value).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls at once when that history is already shown, leaving nothing for a later reload", () => {
    focusHistory(HASH);
    // The rows arrived and the view scrolled to them.
    restoreScroll.value = null;

    focusHistory(HASH);
    expect(restoreScroll.value).toBeNull();
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0);
  });
});
