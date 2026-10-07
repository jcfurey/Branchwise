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
      ROW_HEIGHT: 24,
      TABLE_HEADER_HEIGHT: 32,
      COMMIT_DETAILS_HEIGHT: 250,
      RESIZABLE_COLUMNS: [0, 2, 3, 4],
      DESCRIPTION_COLUMN: 1
    });
  });

  it("keep the resizable columns read-only", () => {
    expect(addColumn).toThrow(TypeError);
    expect(constants.RESIZABLE_COLUMNS).toEqual([0, 2, 3, 4]);
    expect(constants.RESIZABLE_COLUMNS).not.toContain(constants.DESCRIPTION_COLUMN);
  });
});
