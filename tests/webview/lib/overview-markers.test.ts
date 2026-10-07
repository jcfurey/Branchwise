import { describe, expect, it } from "vitest";

import type { GitRef } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import {
  type BodyGeometry,
  collapseMarkers,
  collectMarkers,
  MARKER_PRIORITY,
  markerKinds,
  type OverviewMarker,
  rowAtOffset,
  rowOffset,
  rowToStrip,
  scrollForStripPoint,
  stripToRow,
  visibleBand
} from "@/webview/lib/overview-markers";

import { entry } from "@tests/webview/components/commit/commit-view-fixtures";

const ref = (name: string, type: GitRef["type"]): GitRef => ({ hash: "", name, type });

/** 1 000 rows of 24 pixels, with nothing open. */
const plain: BodyGeometry = { rows: 1000, rowHeight: 24, expandedRow: -1, expansionHeight: 250 };

describe("rowToStrip", () => {
  it("spreads the rows evenly down the strip, each at the centre of its share", () => {
    expect(rowToStrip(0, 100, 100)).toBe(0);
    expect(rowToStrip(50, 100, 100)).toBe(50);
    expect(rowToStrip(99, 100, 100)).toBe(99);
    expect(rowToStrip(0, 4, 100)).toBe(12);
    expect(rowToStrip(3, 4, 100)).toBe(87);
  });

  it("puts 50 000 rows on a few hundred pixels without leaving the strip", () => {
    expect(rowToStrip(0, 50_000, 500)).toBe(0);
    expect(rowToStrip(25_000, 50_000, 500)).toBe(250);
    expect(rowToStrip(49_999, 50_000, 500)).toBe(499);
  });

  it("stays at the top for an empty table or a strip with no height", () => {
    expect(rowToStrip(3, 0, 100)).toBe(0);
    expect(rowToStrip(3, 10, 0)).toBe(0);
  });
});

describe("collectMarkers", () => {
  const commits = [
    entry(UNCOMMITTED_CHANGES),
    entry("a", [], { refs: [ref("main", "head"), ref("origin/main", "remote")] }),
    entry("b", [], { refs: [ref("v1", "tag")] }),
    entry("c", [], { refs: [ref("origin/topic", "remote"), ref("v0", "tag")] }),
    entry("d")
  ];

  it("marks HEAD, branch tips, tags, the selection, the open details and unpushed commits", () => {
    const markers = collectMarkers({
      commits,
      head: "a",
      selected: new Set(["b", UNCOMMITTED_CHANGES]),
      details: "d",
      unpushed: new Set(["a"])
    });
    expect(markers).toEqual([
      { row: 0, kind: "selected" },
      { row: 1, kind: "head" },
      { row: 1, kind: "branch" },
      { row: 1, kind: "unpushed" },
      { row: 2, kind: "selected" },
      { row: 2, kind: "tag" },
      { row: 3, kind: "branch" },
      { row: 3, kind: "tag" },
      { row: 4, kind: "details" }
    ]);
  });
});

describe("collapseMarkers", () => {
  it("merges rows that land on one pixel row, the most important kind first", () => {
    const markers: OverviewMarker[] = [
      { row: 0, kind: "branch" },
      { row: 1, kind: "unpushed" },
      { row: 2, kind: "head" },
      { row: 3, kind: "selected" },
      { row: 4, kind: "branch" },
      { row: 5, kind: "tag" },
      { row: 6, kind: "details" }
    ];
    // Ten rows to a pixel: all seven share pixel row 0.
    expect(collapseMarkers(markers, 1000, 100)).toEqual([
      { y: 0, kinds: ["head", "selected", "details", "branch", "tag", "unpushed"] }
    ]);
  });

  it("keeps rows on separate pixel rows apart, from the top down", () => {
    const markers: OverviewMarker[] = [
      { row: 990, kind: "tag" },
      { row: 0, kind: "head" },
      { row: 500, kind: "branch" },
      { row: 501, kind: "selected" }
    ];
    expect(collapseMarkers(markers, 1000, 100)).toEqual([
      { y: 0, kinds: ["head"] },
      { y: 50, kinds: ["selected", "branch"] },
      { y: 99, kinds: ["tag"] }
    ]);
  });

  it("draws one mark per pixel row however many rows carry it", () => {
    const markers = Array.from({ length: 50_000 }, (_, row): OverviewMarker => ({
      row,
      kind: "branch"
    }));
    const marks = collapseMarkers(markers, 50_000, 400);
    expect(marks).toHaveLength(400);
    expect(marks.every((mark) => mark.kinds.length === 1)).toBe(true);
  });

  it("lists the kinds present in priority order", () => {
    expect(
      markerKinds([
        { row: 4, kind: "tag" },
        { row: 1, kind: "head" },
        { row: 2, kind: "tag" }
      ])
    ).toEqual(["head", "tag"]);
    expect(MARKER_PRIORITY).toEqual(["head", "selected", "details", "branch", "tag", "unpushed"]);
  });
});

describe("rows and the body's pixels", () => {
  const open: BodyGeometry = { ...plain, expandedRow: 9 };

  it("finds each row's top, below any details opened above it", () => {
    expect(rowOffset(0, plain)).toBe(0);
    expect(rowOffset(10, plain)).toBe(240);
    expect(rowOffset(9, open)).toBe(216);
    expect(rowOffset(10, open)).toBe(240 + 250);
  });

  it("reads the open details as part of their row", () => {
    expect(rowAtOffset(120, open)).toBe(5);
    expect(rowAtOffset(300, open)).toBe(10);
    expect(rowAtOffset(240 + 250 + 48, open)).toBe(12);
    expect(rowAtOffset(-10, plain)).toBe(0);
    expect(rowAtOffset(1e9, plain)).toBe(1000);
  });

  it("gives the band of the strip that the rows on screen take", () => {
    // Rows 100 to 130 on screen, on a strip of 500 pixels: two rows to a pixel.
    expect(visibleBand(2400, 3120, plain, 500)).toEqual({ top: 50, bottom: 65 });
  });
});

describe("clicking the strip", () => {
  const page = { bodyTop: 100, viewTop: 32, viewBottom: 768, maxScroll: 30_000 };

  it("maps a point back to the row it stands for", () => {
    expect(stripToRow(0, 500, 1000)).toBe(0);
    expect(stripToRow(250, 500, 1000)).toBe(500);
    expect(stripToRow(499.9, 500, 1000)).toBe(999);
    expect(stripToRow(-5, 500, 1000)).toBe(0);
    expect(stripToRow(600, 500, 1000)).toBe(999);
    expect(stripToRow(10, 500, 0)).toBe(0);
  });

  it("centres that row between the sticky headings and the bottom of the window", () => {
    // Row 500 starts 12 000 pixels down a body that starts 100 pixels down the page.
    expect(scrollForStripPoint(250, 500, plain, page)).toEqual({
      row: 500,
      scrollTop: 100 + 12_000 + 12 - (32 + 768) / 2
    });
  });

  it("allows for open details above the row", () => {
    const { scrollTop } = scrollForStripPoint(250, 500, { ...plain, expandedRow: 3 }, page);
    expect(scrollTop).toBe(100 + 12_000 + 250 + 12 - 400);
  });

  it("stays within what the page can scroll", () => {
    expect(scrollForStripPoint(0, 500, plain, page)).toEqual({ row: 0, scrollTop: 0 });
    expect(scrollForStripPoint(499, 500, plain, page)).toEqual({ row: 998, scrollTop: 23_664 });
    expect(scrollForStripPoint(499, 500, plain, { ...page, maxScroll: 20_000 }).scrollTop).toBe(
      20_000
    );
  });
});
