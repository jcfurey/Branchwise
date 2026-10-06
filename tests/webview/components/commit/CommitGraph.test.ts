// @vitest-environment jsdom
import { signal } from "@preact/signals";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitGraph } from "@/webview/components/commit/CommitGraph";
import { commitRelations, lineRelation } from "@/webview/graph/focus";
import { computeGraphLayout } from "@/webview/graph/layout";
import type { GraphExpansion, GraphLine } from "@/webview/graph/types";
import type { FocusDimming } from "@/webview/types";

import {
  attachHost,
  entry,
  reconfigure
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

const GREY = "var(--vscode-descriptionForeground, #808080)";
const STRONG_GREY = `color-mix(in srgb, ${GREY} 45%, var(--vscode-editor-background))`;

/**
 * The specification's example: the uncommitted changes on `m`, a merge of `a` and `t`; `s`,
 * `t` and `a` all grow from the root `b`.
 */
const ROWS: Array<HistoryEntry> = [
  entry("*", ["m"]),
  entry("m", ["a", "t"]),
  entry("s", ["b"]),
  entry("t", ["b"]),
  entry("a", ["b"]),
  entry("b")
];
const FOCUS = { direct: ["m", "a", "b"], merged: ["t"] };

type Options = {
  rows?: Array<HistoryEntry>;
  head?: string | null;
  focus?: { direct: Array<string>; merged: Array<string> } | null;
  expansion?: GraphExpansion | null;
  keepMergedBright?: boolean;
  dimming?: FocusDimming;
  revealed?: ReadonlySet<number>;
};

let host: HTMLDivElement;
let restorePalette: () => void;
const hovered = signal<string | null>(null);

function drawGraph({
  rows = ROWS,
  head = "m",
  focus = FOCUS,
  expansion = null,
  keepMergedBright = false,
  dimming = "subtle",
  revealed = new Set()
}: Options = {}) {
  const layout = computeGraphLayout(rows, head);
  const relations = commitRelations(rows, focus);
  act(() =>
    render(
      h(CommitGraph, {
        layout,
        expansion,
        relations,
        relationForLine: (line: GraphLine) => lineRelation(line, rows, relations),
        keepMergedBright,
        dimming,
        revealed,
        hovered,
        commitRows: new Map(rows.map((row, index) => [row.hash, index]))
      }),
      host
    )
  );
  return layout;
}

const svg = () => host.querySelector("svg")!;
const dots = () => [...host.querySelectorAll("circle")];
const lines = () => [...host.querySelectorAll("path[data-branch-relation]")];
const dot = (index: number) => {
  const circle = dots()[index]!;
  return {
    at: `${circle.getAttribute("cx")},${circle.getAttribute("cy")}`,
    relation: circle.getAttribute("data-branch-relation"),
    fill: circle.getAttribute("fill"),
    stroke: circle.getAttribute("stroke")
  };
};

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  restorePalette = reconfigure({ graphColours: ["#ff0000", "#00ff00", "#0000ff"] });
  hovered.value = null;
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  restorePalette();
});

describe("CommitGraph", () => {
  it("sizes the drawing to the lanes and rows and hides it from assistive technology", () => {
    drawGraph();
    expect(svg().getAttribute("width")).toBe("48");
    expect(svg().getAttribute("height")).toBe("144");
    expect(svg().getAttribute("aria-hidden")).toBe("true");

    drawGraph({ expansion: { row: 3, height: 250 } });
    expect(svg().getAttribute("height")).toBe("394");

    drawGraph({ rows: [], head: null, focus: null });
    expect(svg().getAttribute("width")).toBe("0");
    expect(svg().getAttribute("height")).toBe("0");
    expect(svg().childNodes).toHaveLength(0);
  });

  it("draws one dot per row, coloured by the row's relation", () => {
    drawGraph();

    expect(dots()).toHaveLength(ROWS.length);
    expect(dots().map((_circle, index) => dot(index))).toEqual([
      { at: "8,12", relation: "normal", fill: null, stroke: "#808080" },
      // The merge's ring takes the colour; its centre dot is not a circle.
      { at: "8,36", relation: "direct", fill: null, stroke: "#ff0000" },
      { at: "40,60", relation: "unrelated", fill: GREY, stroke: null },
      {
        at: "24,84",
        relation: "merged",
        fill: `color-mix(in srgb, #00ff00 40%, ${GREY})`,
        stroke: null
      },
      { at: "8,108", relation: "direct", fill: "#ff0000", stroke: null },
      { at: "8,132", relation: "direct", fill: "#ff0000", stroke: null }
    ]);
  });

  it("pairs every line with a background band and paints lines before dots", () => {
    drawGraph();

    const groups = [...svg().children].filter((child) => child.tagName === "g");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const [band, line] = [...group.children];
      expect(group.children).toHaveLength(2);
      expect(band!.getAttribute("d")).toBe(line!.getAttribute("d"));
      expect(band!.hasAttribute("data-branch-relation")).toBe(false);
      expect(band!.hasAttribute("stroke")).toBe(false);
      expect(line!.hasAttribute("data-branch-relation")).toBe(true);
      expect(line!.hasAttribute("stroke")).toBe(true);
    }
    const tags = [...svg().children].map((child) => child.tagName);
    expect(tags.lastIndexOf("g")).toBeLessThan(tags.indexOf("circle"));
  });

  it("draws the example's lines with their relations and colours", () => {
    drawGraph();

    expect(
      lines().map((path) => [
        path.getAttribute("d"),
        path.getAttribute("data-branch-relation"),
        path.getAttribute("stroke")
      ])
    ).toEqual([
      ["M8,12.0L8,36.0", "normal", "#808080"],
      ["M8,36.0L8,132.0", "direct", "#ff0000"],
      [
        "M8,36.0C8,55.2 24,40.8 24,60.0L24,108.0C24,127.2 8,112.8 8,132.0",
        "merged",
        `color-mix(in srgb, #00ff00 40%, ${GREY})`
      ],
      ["M40,60.0L40,108.0C40,127.2 8,112.8 8,132.0", "unrelated", GREY]
    ]);
  });

  it("follows the configured line style", () => {
    const restore = reconfigure({ graphStyle: "angular" });
    try {
      drawGraph();
      expect(lines()[2]!.getAttribute("d")).toBe(
        "M8,36.0L24,50.9L24,60.0L24,108.0L24,117.1L8,132.0"
      );
      expect(lines().some((path) => path.getAttribute("d")!.includes("C"))).toBe(false);
    } finally {
      restore();
    }
  });

  it("keeps the uncommitted line and dot grey whatever the focus", () => {
    drawGraph({ dimming: "strong", focus: { direct: [], merged: [] } });

    expect(lines()[0]!.getAttribute("stroke")).toBe("#808080");
    expect(dot(0).stroke).toBe("#808080");
  });

  it("dims strongly, or keeps merged history bright, without changing relations", () => {
    drawGraph({ dimming: "strong", keepMergedBright: true });

    expect(dot(2)).toMatchObject({ relation: "unrelated", fill: STRONG_GREY });
    expect(dot(3)).toMatchObject({ relation: "merged", fill: "#00ff00" });
    const [, , merged, unrelated] = lines();
    expect(merged!.getAttribute("stroke")).toBe("#00ff00");
    expect(merged!.getAttribute("data-branch-relation")).toBe("merged");
    expect(unrelated!.getAttribute("stroke")).toBe(STRONG_GREY);
  });

  it("draws a committed HEAD as an open ring in full colour", () => {
    const rows = ROWS.slice(1);
    const layout = drawGraph({ rows, focus: { direct: ["s"], merged: [] } });

    const head = dots()[0]!;
    expect(layout.vertices[0]!.isCurrent).toBe(true);
    expect(head.getAttribute("data-branch-relation")).toBe("unrelated");
    expect(head.hasAttribute("fill")).toBe(false);
    expect(head.getAttribute("stroke")).toBe(
      ["#ff0000", "#00ff00", "#0000ff"][layout.vertices[0]!.colour % 3]
    );
  });

  it("tells merges, HEAD and the uncommitted changes apart by shape as well as colour", () => {
    drawGraph({ focus: null });
    const shape = (index: number) => {
      const circle = dots()[index]!;
      return {
        kind: circle.getAttribute("data-dot"),
        r: circle.getAttribute("r"),
        filled: circle.hasAttribute("fill"),
        dashed: circle.hasAttribute("stroke-dasharray")
      };
    };

    expect([0, 1, 2].map(shape)).toEqual([
      { kind: "uncommitted", r: "4", filled: false, dashed: true },
      { kind: "merge", r: "5", filled: false, dashed: false },
      { kind: "commit", r: "4", filled: true, dashed: false }
    ]);
    // Twelve dashes and gaps go exactly round the ring.
    const dashes = Number(dots()[0]!.getAttribute("stroke-dasharray"));
    expect(dashes * 12).toBeCloseTo(2 * Math.PI * 4);
    // The merge's centre dot, in the ring's colour and well inside the row.
    const centres = [...svg().querySelectorAll("rect")];
    expect(centres).toHaveLength(1);
    expect(centres[0]!.previousElementSibling).toBe(dots()[1]);
    expect(
      ["x", "y", "width", "height", "rx", "fill"].map((name) => centres[0]!.getAttribute(name))
    ).toEqual(["6", "34", "4", "4", "2", "#ff0000"]);

    // Without the uncommitted row, the merge is HEAD, which keeps HEAD's ring.
    drawGraph({ rows: ROWS.slice(1), focus: null });
    expect(shape(0)).toEqual({ kind: "head", r: "4", filled: false, dashed: false });
    expect(svg().querySelector("rect")).toBeNull();

    // Every row still has exactly one circle, in row order.
    drawGraph({ rows: ROWS.slice(1), head: "s", focus: null });
    expect(dots().map((circle) => circle.getAttribute("data-dot"))).toEqual([
      "merge",
      "head",
      "commit",
      "commit",
      "commit"
    ]);
  });

  it("shows revealed and hovered dots in full colour, and only while they are", () => {
    drawGraph({ revealed: new Set([2]) });
    const paths = lines().map((path) => path.getAttribute("stroke"));
    expect(dot(2)).toMatchObject({ relation: "unrelated", fill: "#0000ff" });

    act(() => {
      hovered.value = "t";
    });
    expect(dot(3)).toMatchObject({ relation: "merged", fill: "#00ff00" });
    expect(lines().map((path) => path.getAttribute("stroke"))).toEqual(paths);

    act(() => {
      hovered.value = null;
    });
    expect(dot(3).fill).toBe(`color-mix(in srgb, #00ff00 40%, ${GREY})`);
  });

  it("moves the rows after open details down by their height", () => {
    drawGraph({ expansion: { row: 3, height: 250 } });

    expect(dots().map((circle) => circle.getAttribute("cy"))).toEqual([
      "12",
      "36",
      "60",
      "84",
      "358",
      "382"
    ]);
  });
});
