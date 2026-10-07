// Runs without a DOM on purpose: loading the page logic below must not need `window`.
import { describe, expect, it, vi } from "vitest";

import type { WebviewConfig } from "@/types";

const first: WebviewConfig = {
  autoCenterCommitDetailsView: false,
  commitHoverCards: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Date Only",
  dragAndDrop: true,
  graphColours: ["#1f77b4", "#ff7f0e", "#2ca02c"],
  graphStyle: "angular",
  initialLoadCommits: 250,
  issueLinks: [],
  loadMoreCommits: 75,
  locale: "de",
  showChangesColumn: false,
  showCurrentBranchByDefault: true,
  singleKeyShortcuts: true
};

const later: WebviewConfig = { ...first, dateFormat: "Relative", initialLoadCommits: 1200 };

const NOT_INITIALIZED = /^Webview configuration is not initialized$/;
const ALREADY_INITIALIZED = /^Webview configuration is already initialized$/;

/** A settings holder that nothing has touched yet. */
async function freshHolder() {
  vi.resetModules();
  return import("@/webview/lib/webview-config");
}

describe("the settings holder", () => {
  it("holds nothing until it is given settings, and then the very object it was given", async () => {
    const holder = await freshHolder();

    expect(() => holder.getWebviewConfig()).toThrowError(NOT_INITIALIZED);

    holder.initializeWebviewConfig(first);
    expect(holder.getWebviewConfig()).toBe(first);
  });

  it("accepts its first settings only once, keeping them", async () => {
    const holder = await freshHolder();
    holder.initializeWebviewConfig(first);

    expect(() => holder.initializeWebviewConfig(first)).toThrowError(ALREADY_INITIALIZED);
    expect(() => holder.initializeWebviewConfig(later)).toThrowError(ALREADY_INITIALIZED);
    expect(holder.getWebviewConfig()).toBe(first);
  });

  it("drops a change that comes before the first settings, and takes one after", async () => {
    const holder = await freshHolder();

    expect(holder.updateWebviewConfig(later)).toBe(false);
    expect(() => holder.getWebviewConfig()).toThrowError(NOT_INITIALIZED);

    holder.initializeWebviewConfig(first);
    expect(holder.getWebviewConfig()).toBe(first);

    expect(holder.updateWebviewConfig(later)).toBe(true);
    expect(holder.getWebviewConfig()).toBe(later);
  });
});

describe("a config.changed notification before the page is initialized", () => {
  it("is discarded without raising the row count or taking the place of the first settings", async () => {
    vi.resetModules();
    const holder = await import("@/webview/lib/webview-config");
    const { applyWebviewConfig } = await import("@/webview/lib/actions");
    const { maxCommits } = await import("@/webview/lib/stores");
    const rowsBefore = maxCommits.peek();
    expect(rowsBefore).toBeLessThan(later.initialLoadCommits);

    expect(() => applyWebviewConfig(later)).not.toThrow();
    expect(maxCommits.peek()).toBe(rowsBefore);

    expect(() => holder.initializeWebviewConfig(first)).not.toThrow();
    expect(holder.getWebviewConfig()).toBe(first);
  });
});
