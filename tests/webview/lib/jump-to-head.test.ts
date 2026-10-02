// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setupWebviewTest } from "@tests/webview/test-utils";

let jump: typeof import("@/webview/lib/jump-to-head");
let navigation: typeof import("@/webview/lib/navigation");
let stores: typeof import("@/webview/lib/stores");

const commit = (hash: string) => ({
  hash,
  parentHashes: [],
  author: "A",
  email: "a@b",
  date: 1,
  message: hash,
  refs: []
});

beforeAll(async () => {
  setupWebviewTest();
  jump = await import("@/webview/lib/jump-to-head");
  navigation = await import("@/webview/lib/navigation");
  stores = await import("@/webview/lib/stores");
});

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  navigation.setHistoryFilter(navigation.emptyFilter());
  navigation.focusedCommit.value = null;
  stores.commitHead.value = "head";
  stores.commitList.value = [commit("new"), commit("head"), commit("old")];
  // jsdom does not scroll.
  HTMLElement.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML =
    '<main><table><tr data-commit-hash="new" tabindex="0"></tr><tr data-commit-hash="head" tabindex="-1"></tr></table></main>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Jump to HEAD", () => {
  it("brings the checked-out commit's row into view and focuses it", () => {
    const row = document.querySelector<HTMLElement>('[data-commit-hash="head"]')!;
    row.scrollIntoView = vi.fn();
    jump.jumpToHead();
    expect(navigation.focusedCommit.value).toBe("head");
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(row);
  });

  it("leaves a search for the graph first", () => {
    navigation.setHistoryFilter({ ...navigation.emptyFilter(), text: "needle" });
    jump.jumpToHead();
    expect(navigation.historyActive.value).toBe(false);
    expect(navigation.focusedCommit.value).toBe("head");
  });

  it("comes back from another view to the graph", () => {
    navigation.showTab("reflog");
    jump.jumpToHead();
    expect(navigation.activeTab.value).toBe("graph");
    expect(navigation.focusedCommit.value).toBe("head");
  });

  it("opens the history at HEAD when the graph has not loaded it", () => {
    stores.commitList.value = [commit("new")];
    jump.jumpToHead();
    expect(navigation.historyFilter.value.revision).toBe("head");
  });

  it("does nothing without a HEAD", () => {
    stores.commitHead.value = null;
    jump.jumpToHead();
    expect(navigation.focusedCommit.value).toBeNull();
    expect(navigation.historyActive.value).toBe(false);
  });
});
