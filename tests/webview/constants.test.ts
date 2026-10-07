import { describe, expect, it } from "vitest";

import * as constants from "@/webview/constants";

/** Tries to add a sixth resizable column, which neither the type nor the array allows. */
function addColumn() {
  // @ts-expect-error: the stored widths depend on this exact list.
  constants.RESIZABLE_COLUMNS.push(5);
}

describe("webview constants", () => {
  it("hold the markers, sizes and column indexes the page is laid out with", () => {
    expect({ ...constants }).toEqual({
      SHOW_ALL_BRANCHES: "*",
      UNCOMMITTED_CHANGES: "*",
      BATCH_LIMIT: 100,
      ROW_HEIGHTS: { compact: 20, default: 24, comfortable: 30 },
      ROW_HEIGHT: 24,
      TABLE_HEADER_HEIGHT: 32,
      COMMIT_DETAILS_HEIGHT: 250,
      RESIZABLE_COLUMNS: [0, 2, 3, 4],
      DESCRIPTION_COLUMN: 1,
      ALL_COLUMNS: [0, 1, 2, 3, 4],
      OPTIONAL_COLUMNS: { date: 2, author: 3, commit: 4 }
    });
  });

  it("never let the graph or the description be hidden", () => {
    const optional = Object.values(constants.OPTIONAL_COLUMNS);
    expect(optional).not.toContain(0);
    expect(optional).not.toContain(constants.DESCRIPTION_COLUMN);
    expect(Object.isFrozen(constants.OPTIONAL_COLUMNS)).toBe(true);
  });

  it("give every density a row tall enough for a branch label", () => {
    expect(Object.isFrozen(constants.ROW_HEIGHTS)).toBe(true);
    // A label shrinks to fit a short row but never under the 16 pixels of its text, and it keeps
    // a 1-pixel border above and below and a 2-pixel top margin.
    for (const height of Object.values(constants.ROW_HEIGHTS)) {
      expect(height).toBeGreaterThanOrEqual(16 + 2 + 2);
    }
  });

  it("keep the resizable columns read-only", () => {
    expect(addColumn).toThrow(TypeError);
    expect(constants.RESIZABLE_COLUMNS).toEqual([0, 2, 3, 4]);
    expect(constants.RESIZABLE_COLUMNS).not.toContain(constants.DESCRIPTION_COLUMN);
  });
});
