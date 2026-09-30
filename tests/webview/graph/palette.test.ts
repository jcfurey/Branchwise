// @vitest-environment jsdom
import { effect } from "@preact/signals";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { branchColour, UNCOMMITTED_COLOUR } from "@/webview/graph/palette";
import { expandedCommit, selectedRepo, uncommittedChanges } from "@/webview/lib/stores";
import { getWebviewConfig, updateWebviewConfig } from "@/webview/lib/webview-config";

import { setupWebviewTest } from "@tests/webview/test-utils";

/** Replace the configured palette, keeping every other setting. */
function usePalette(graphColours: Array<string>) {
  updateWebviewConfig({ ...getWebviewConfig(), graphColours });
}

/** A commit of `parents`, with nothing else the table would show. */
function commitOf(hash: string, parents: Array<string> = []): HistoryEntry {
  return {
    hash,
    parentHashes: parents,
    author: "Palette Test",
    email: "palette@example.test",
    date: 0,
    message: hash,
    refs: []
  };
}

beforeAll(() => setupWebviewTest());

describe("branchColour", () => {
  it("goes round the palette again past its end", () => {
    usePalette(["#a", "#b", "#c"]);

    expect([0, 1, 2, 3, 4, 5, 300].map(branchColour)).toEqual([
      "#a",
      "#b",
      "#c",
      "#a",
      "#b",
      "#c",
      "#a"
    ]);
  });

  it("has no colour to give from an empty palette", () => {
    usePalette([]);

    expect(branchColour(0)).toBeUndefined();
  });

  it("gives each colour exactly as the setting spells it", () => {
    usePalette(["rgb(1, 2, 3)", "  #00ff00  "]);

    expect([branchColour(0), branchColour(1)]).toEqual(["rgb(1, 2, 3)", "  #00ff00  "]);
  });

  it("leaves indexes the layout never produces without a colour", () => {
    usePalette(["#a", "#b", "#c"]);

    expect([-1, 1.5, Number.NaN, Infinity].map(branchColour)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    expect(branchColour(-3)).toBe("#a");
  });

  it("follows the configuration as it changes", () => {
    usePalette(["#a", "#b"]);
    const seen: Array<string | undefined> = [];
    const stop = effect(() => {
      seen.push(branchColour(1));
    });
    try {
      usePalette(["#x", "#y"]);
      usePalette([]);
    } finally {
      stop();
    }

    expect(seen).toEqual(["#b", "#y", undefined]);
  });

  it("cannot answer before the page has its configuration", async () => {
    vi.resetModules();
    const fresh = await import("@/webview/graph/palette");

    expect(() => fresh.branchColour(0)).toThrow("Webview configuration is not initialized");
  });
});

describe("the uncommitted colour", () => {
  let host: HTMLElement;

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    vi.unstubAllGlobals();
  });

  it("paints the working tree's hollow dot and its edge grey, whatever the palette", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    usePalette(["#a", "#b"]);
    selectedRepo.value = "/palette";
    expandedCommit.value = null;
    uncommittedChanges.value = 1;
    host = document.body.appendChild(document.createElement("div"));
    const commits = [commitOf("*", ["base"]), commitOf("base")];
    act(() => render(h(CommitTable, { commits, head: "base", headBranch: null }), host));

    const [workingTree, base] = [...host.querySelectorAll("circle")];
    expect(UNCOMMITTED_COLOUR).toBe("#808080");
    expect(workingTree!.getAttribute("stroke")).toBe("#808080");
    expect(workingTree!.hasAttribute("fill")).toBe(false);
    expect(base!.getAttribute("fill")).toBe("#a");
    const edge = host.querySelector("path[data-branch-relation]")!;
    expect(edge.getAttribute("stroke")).toBe("#808080");
  });
});
