// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import {
  commitDetails,
  expandedCommit,
  repoStates,
  selectedRepo,
  uncommittedChanges
} from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

// The table's sizes as rendered: row pitch, header offset, details height, dot radius and the
// graph column's width all come from the webview's constants.

/** Commits named `c0`, `c1`, ... in a single line, each the parent of the one before. */
function line(length: number): Array<HistoryEntry> {
  return Array.from({ length }, (_, index) => ({
    hash: `c${index}`,
    parentHashes: index + 1 < length ? [`c${index + 1}`] : [],
    author: "Geometry",
    email: "geometry@example.test",
    date: 0,
    message: `line ${index}`,
    refs: []
  }));
}

/** `tips` commits whose only parent is one shared root, drawn side by side in `tips` lanes. */
function brush(tips: number): Array<HistoryEntry> {
  const root = line(1)[0]!;
  const children = Array.from({ length: tips }, (_, index) => ({
    ...root,
    hash: `tip${index}`,
    parentHashes: [root.hash],
    message: `tip ${index}`
  }));
  return [...children, root];
}

let host: HTMLElement;

function show(commits: Array<HistoryEntry>) {
  act(() => render(h(CommitTable, { commits, head: null, headBranch: null }), host));
}

const container = () => host.firstElementChild as HTMLElement;
const graph = () => host.querySelector("[data-graph-viewport] svg")!;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  selectedRepo.value = "/geometry";
  repoStates.value = {};
  expandedCommit.value = null;
  commitDetails.value = null;
  uncommittedChanges.value = 0;
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("table geometry", () => {
  it("adds the details height to the graph and gives it to the details row", () => {
    const commits = line(21);
    show(commits);
    expect(graph().getAttribute("height")).toBe(String(21 * 24));

    act(() => {
      expandedCommit.value = commits[1]!.hash;
    });

    expect(graph().getAttribute("height")).toBe("754");
    const details = host.querySelector("[data-details-row]")!;
    expect(details.getAttribute("style")).toBe("height: 250px;");
  });

  it("starts the graph below the header unless the page says otherwise", () => {
    show(line(3));

    const viewport = host.querySelector("[data-graph-viewport]")!;
    expect(viewport.getAttribute("style")).toContain("top: var(--graph-top, 32px)");
  });

  it("draws every dot with a radius of 4", () => {
    show(brush(3));

    const dots = host.querySelectorAll("[data-graph-viewport] circle");
    const radii = [...dots].map((dot) => dot.getAttribute("r"));
    expect(radii).toEqual(["4", "4", "4", "4"]);
  });

  it("sizes the graph column from the drawing and its padding, between 64 and 240 pixels", () => {
    show(brush(13));
    expect(graph().getAttribute("width")).toBe("208");
    expect(container().getAttribute("style")).toContain("--col-graph: 224px");

    show(brush(20));
    expect(graph().getAttribute("width")).toBe("320");
    expect(container().getAttribute("style")).toContain("--col-graph: 240px");

    show(line(2));
    expect(graph().getAttribute("width")).toBe("16");
    expect(container().getAttribute("style")).toContain("--col-graph: 64px");
  });
});
