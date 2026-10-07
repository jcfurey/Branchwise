import { describe, expect, it } from "vitest";

import {
  hiddenColumnsOf,
  isColumnWidths,
  MIN_COLUMN,
  MIN_DESCRIPTION,
  moveBoundary,
  shownCells
} from "@/webview/utils/columns";

// Stored widths, in slot order: graph, date, author, commit. The description column has no
// stored width; its measured width is passed on its own. Boundary n is the right edge of header
// cell n: 0 is graph | description, 1 description | date, 2 date | author, 3 author | commit.
const layout = [150, 110, 130, 80];
const description = 360;

/** A value the parameter type would refuse, passed on as if it were allowed. */
function unchecked(value: unknown): Array<number> {
  return value as Array<number>;
}

/** Four slots, the last of them never assigned. */
function withHoleAtEnd(): Array<number> {
  const widths = [150, 110, 130];
  widths.length = 4;
  return widths;
}

/** Four slots, none of them assigned. */
function allHoles(): Array<number> {
  const widths: Array<number> = [];
  widths.length = 4;
  return widths;
}

function frozenLayout(): Array<number> {
  return Object.freeze([150, 110, 130, 80]) as Array<number>;
}

describe("the minimums", () => {
  it("are 40 pixels for a stored column and 64 for the description", () => {
    expect(MIN_COLUMN).toBe(40);
    expect(MIN_DESCRIPTION).toBe(64);
  });
});

describe("isColumnWidths", () => {
  it("accepts one positive, finite number per stored column", () => {
    expect(isColumnWidths(layout)).toBe(true);
    expect(isColumnWidths(frozenLayout())).toBe(true);
  });

  it.each([
    [[150, 110, 130, 7.25]],
    [[150.6, 110, 129.4, 80]],
    [[0.002, 7.25, 39.5, 5e8]],
    [[Number.MAX_VALUE, 110, 130, 80]],
    [[Number.MIN_VALUE, 110, 130, 80]]
  ])("accepts fractions, and widths under the minimum or very large: %j", (widths) => {
    expect(isColumnWidths(widths)).toBe(true);
  });

  it.each([
    ["three", [150, 110, 130]],
    ["none", []],
    ["five, as stored before the description lost its width", [150, 360, 110, 130, 80]]
  ])("refuses %s widths", (_count, widths) => {
    expect(isColumnWidths(widths)).toBe(false);
  });

  it.each([
    ["0", 0],
    ["-0", -0],
    ["-3", -3],
    ["NaN", Number.NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity]
  ])("refuses a width of %s in the last slot", (_label, width) => {
    expect(isColumnWidths([150, 110, 130, width])).toBe(false);
  });

  it.each(["150", null, undefined, false, [150]])(
    "refuses %j in the first slot, without coercing it",
    (width) => {
      expect(isColumnWidths(unchecked([width, 110, 130, 80]))).toBe(false);
    }
  );

  it("refuses null", () => {
    expect(isColumnWidths(null)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["a four-character string", "wxyz"],
    ["a three-character string", "xyz"],
    ["a number", 7],
    ["an empty object", {}],
    ["an object with only a length", { length: 4 }],
    ["an array-like object", { 0: 150, 1: 110, 2: 130, 3: 80, length: 4 }],
    ["a typed array", new Float64Array([150, 110, 130, 80])]
  ])("refuses %s without throwing", (_kind, value) => {
    expect(() => isColumnWidths(unchecked(value))).not.toThrow();
    expect(isColumnWidths(unchecked(value))).toBe(false);
  });

  it("refuses an array with a hole, like one with a bad width", () => {
    expect(isColumnWidths(withHoleAtEnd())).toBe(false);
    expect(isColumnWidths(allHoles())).toBe(false);
  });

  it("leaves its argument as it was", () => {
    const widths = [150, 110, 130, 80];

    isColumnWidths(widths);

    expect(widths).toEqual([150, 110, 130, 80]);
  });
});

describe("moveBoundary", () => {
  describe("within the limits", () => {
    it.each([
      ["graph | description, rightwards", 0, 25, [175, 110, 130, 80]],
      ["description | date, rightwards", 1, 15, [150, 95, 130, 80]],
      ["description | date, leftwards", 1, -35, [150, 145, 130, 80]],
      ["date | author, rightwards", 2, 30, [150, 140, 100, 80]],
      ["author | commit, leftwards", 3, -20, [150, 110, 110, 100]]
    ])("moves %s by the full request", (_boundary, boundary, delta, widths) => {
      expect(moveBoundary(layout, boundary, delta, description)).toEqual({ widths, moved: delta });
    });

    it("takes a boundary of -0 as boundary 0", () => {
      expect(moveBoundary(layout, -0, 12, description)).toEqual({
        widths: [162, 110, 130, 80],
        moved: 12
      });
    });

    it("ignores an unusable width that is not beside the boundary", () => {
      expect(moveBoundary([150, 110, Infinity, 80], 0, 12, description)).toEqual({
        widths: [162, 110, Infinity, 80],
        moved: 12
      });
    });

    it("works on frozen widths, since it never writes to them", () => {
      expect(moveBoundary(frozenLayout(), 2, 18, description)).toEqual({
        widths: [150, 128, 112, 80],
        moved: 18
      });
      expect(moveBoundary(frozenLayout(), 0, 18, description)).toEqual({
        widths: [168, 110, 130, 80],
        moved: 18
      });
    });

    it.each([Number.NaN, Infinity, -Infinity, 0])(
      "ignores the description, here %d, between two stored columns",
      (unusable) => {
        expect(moveBoundary(layout, 2, 14, unusable)).toEqual({
          widths: [150, 124, 116, 80],
          moved: 14
        });
        expect(moveBoundary(layout, 3, 40, unusable)).toEqual({
          widths: [150, 110, 170, 40],
          moved: 40
        });
      }
    );
  });

  describe("at a minimum", () => {
    it.each([
      ["graph, past its minimum", 0, -300, description, [40, 110, 130, 80], -110],
      ["graph, exactly to its minimum", 0, -110, description, [40, 110, 130, 80], -110],
      ["the description, exactly to its minimum", 0, 296, description, [446, 110, 130, 80], 296],
      ["a narrower description, past its minimum", 0, 400, 120, [206, 110, 130, 80], 56],
      ["date, from the description side", 1, 250, description, [150, 40, 130, 80], 70],
      ["the description, from the date side", 1, -450, description, [150, 406, 130, 80], -296],
      ["date, one pixel past it", 2, -71, description, [150, 40, 200, 80], -70],
      ["date, exactly", 2, -70, description, [150, 40, 200, 80], -70],
      ["author, one pixel past it", 2, 91, description, [150, 200, 40, 80], 90],
      ["author, exactly", 2, 90, description, [150, 200, 40, 80], 90],
      ["commit", 3, 200, description, [150, 110, 170, 40], 40],
      ["author, from the commit side", 3, -250, description, [150, 110, 40, 170], -90]
    ])("stops at %s", (_what, boundary, delta, measured, widths, moved) => {
      expect(moveBoundary(layout, boundary, delta, measured)).toEqual({ widths, moved });
    });

    it("lets a description of exactly 64 grow, but not shrink", () => {
      expect(moveBoundary(layout, 0, 7, 64)).toEqual({ widths: [150, 110, 130, 80], moved: 0 });
      expect(moveBoundary(layout, 0, -7, 64)).toEqual({ widths: [143, 110, 130, 80], moved: -7 });
      expect(moveBoundary(layout, 1, -7, 64)).toEqual({ widths: [150, 110, 130, 80], moved: 0 });
      expect(moveBoundary(layout, 1, 7, 64)).toEqual({ widths: [150, 103, 130, 80], moved: 7 });
    });
  });

  describe("beside a column under its minimum", () => {
    it.each([-20, 0])("widens a narrow graph back to 40 when asked for %d", (delta) => {
      expect(moveBoundary([25, 110, 130, 80], 0, delta, description)).toEqual({
        widths: [40, 110, 130, 80],
        moved: 15
      });
    });

    it("widens a narrow date back to 40 against a request from either side", () => {
      expect(moveBoundary([150, 22, 130, 80], 2, -45, description)).toEqual({
        widths: [150, 40, 112, 80],
        moved: 18
      });
      expect(moveBoundary([150, 28, 130, 80], 1, 25, description)).toEqual({
        widths: [150, 40, 130, 80],
        moved: -12
      });
    });

    it("widens a narrow description back to 64 against the request", () => {
      expect(moveBoundary(layout, 0, 12, 52)).toEqual({ widths: [138, 110, 130, 80], moved: -12 });
      expect(moveBoundary(layout, 1, -8, 52)).toEqual({ widths: [150, 98, 130, 80], moved: 12 });
    });

    it("goes further than asked when the request falls short of the minimum", () => {
      expect(moveBoundary(layout, 0, -5, 52)).toEqual({ widths: [138, 110, 130, 80], moved: -12 });
    });

    it("restores a negative description from either side", () => {
      expect(moveBoundary(layout, 0, 12, -4)).toEqual({ widths: [82, 110, 130, 80], moved: -68 });
      expect(moveBoundary(layout, 1, 12, -4)).toEqual({ widths: [150, 42, 130, 80], moved: 68 });
    });

    it("restores a stored width of zero or below like any narrow one", () => {
      expect(moveBoundary([0, 110, 130, 80], 0, 0, description)).toEqual({
        widths: [40, 110, 130, 80],
        moved: 40
      });
      expect(moveBoundary([-15, 110, 130, 80], 0, 5, description)).toEqual({
        widths: [40, 110, 130, 80],
        moved: 55
      });
      expect(moveBoundary([150, 110, 130, -8], 3, 0, description)).toEqual({
        widths: [150, 110, 82, 40],
        moved: -48
      });
    });

    it("finds the one position that suits both minimums", () => {
      // Graph 25 + 15 = 40 and description 79 - 15 = 64.
      expect(moveBoundary([25, 110, 130, 80], 0, 40, 79)).toEqual({
        widths: [40, 110, 130, 80],
        moved: 15
      });
    });
  });

  describe("when both minimums cannot be met", () => {
    it.each([
      ["graph at its minimum, description far under it", [40, 55, 60, 40], 0, 20, 5],
      ["graph and description both short, one pixel apart", [25, 110, 130, 80], 0, 40, 75],
      ["a request of 0", [55, 110, 130, 80], 0, 0, 45],
      ["date and author both short", [150, 33, 44, 80], 2, 0, description],
      ["description and date both short", [150, 28, 130, 80], 1, -90, 58],
      ["a negative description", layout, 0, 12, -60]
    ])("leaves everything in place: %s", (_case, widths, boundary, delta, measured) => {
      expect(moveBoundary(widths, boundary, delta, measured)).toEqual({
        widths: [...widths],
        moved: 0
      });
    });
  });

  describe("with an unusable input", () => {
    it.each([4, 6, -1, -3, 0.5, 2.5, Number.NaN, Infinity, -Infinity])(
      "leaves everything in place for boundary %s",
      (boundary) => {
        expect(moveBoundary(layout, boundary, 12, description)).toEqual({
          widths: [150, 110, 130, 80],
          moved: 0
        });
      }
    );

    it("does not convert a boundary given as a string", () => {
      const boundary = "1" as unknown as number;

      expect(moveBoundary(layout, boundary, 12, description)).toEqual({
        widths: [150, 110, 130, 80],
        moved: 0
      });
    });

    it.each([Number.NaN, Infinity, -Infinity])(
      "leaves every boundary in place for a request of %d",
      (delta) => {
        for (const boundary of [0, 1, 2, 3]) {
          expect(moveBoundary(layout, boundary, delta, description)).toEqual({
            widths: [150, 110, 130, 80],
            moved: 0
          });
        }
      }
    );

    it.each([Number.NaN, Infinity, -Infinity])(
      "leaves the description's boundaries in place for a description of %d",
      (measured) => {
        for (const boundary of [0, 1]) {
          expect(moveBoundary(layout, boundary, 9, measured)).toEqual({
            widths: [150, 110, 130, 80],
            moved: 0
          });
        }
      }
    );

    it("does not take an infinite description as room for an infinite request", () => {
      expect(moveBoundary(layout, 1, -Infinity, Infinity)).toEqual({
        widths: [150, 110, 130, 80],
        moved: 0
      });
    });

    it.each([Number.NaN, Infinity, -Infinity])(
      "leaves a boundary in place beside a stored width of %d",
      (bad) => {
        const cases: Array<[Array<number>, number, number]> = [
          [[bad, 110, 130, 80], 0, 12],
          [[150, bad, 130, 80], 1, 12],
          [[150, bad, 130, 80], 2, 12],
          [[150, 110, bad, 80], 2, -12],
          [[150, 110, bad, 80], 3, 12],
          [[150, 110, 130, bad], 3, -12]
        ];
        for (const [widths, boundary, delta] of cases) {
          expect(moveBoundary(widths, boundary, delta, description)).toEqual({
            widths: [...widths],
            moved: 0
          });
        }
      }
    );

    it("leaves a boundary in place beside a hole", () => {
      expect(moveBoundary(withHoleAtEnd(), 3, 12, description)).toEqual({
        widths: [150, 110, 130, undefined],
        moved: 0
      });
    });
  });

  describe("with widths of another length", () => {
    it.each([
      [[], [0]],
      [[150], [0]],
      [
        [150, 110],
        [1, 2]
      ],
      [
        [150, 110, 130],
        [0, 2]
      ],
      [
        [150, 110, 130, 80, 70],
        [0, 4]
      ]
    ])("leaves %j in place", (widths, boundaries) => {
      for (const boundary of boundaries) {
        expect(moveBoundary(widths, boundary, 12, description)).toEqual({
          widths: [...widths],
          moved: 0
        });
      }
    });
  });

  describe("with fractions", () => {
    it("adds and takes exactly the fraction asked for", () => {
      expect(moveBoundary([150.25, 110, 130, 80], 0, 12.5, description)).toEqual({
        widths: [162.75, 110, 130, 80],
        moved: 12.5
      });
      // The doubles nearest 110 + 0.7 and 130 - 0.7, which print as written.
      expect(moveBoundary(layout, 2, 0.7, description)).toEqual({
        widths: [150, 110.7, 129.3, 80],
        moved: 0.7
      });
    });

    it("stops a fraction of a pixel short when that reaches the minimum", () => {
      expect(moveBoundary([150, 40.75, 130, 80], 1, 12, description)).toEqual({
        widths: [150, 40, 130, 80],
        moved: 0.75
      });
    });
  });

  describe("the sign of a zero move", () => {
    it.each([
      ["a boundary pinned at a minimum", [40, 110, 130, 80], 0, -6],
      ["a request stopped by a minimum on the right", [150, 110, 130, 40], 3, 5],
      ["a boundary out of range", layout, 4, 12],
      ["a request that is not a number", layout, 0, Number.NaN]
    ])("is positive for %s", (_case, widths, boundary, delta) => {
      expect(Object.is(moveBoundary(widths, boundary, delta, description).moved, 0)).toBe(true);
    });

    it.each([0, 1, 2, 3])("is positive for a request of -0 at boundary %i", (boundary) => {
      const result = moveBoundary(layout, boundary, -0, description);

      expect(result).toEqual({ widths: [150, 110, 130, 80], moved: 0 });
      expect(Object.is(result.moved, 0)).toBe(true);
    });
  });

  describe("the caller's array", () => {
    it("is left as it was after a real move", () => {
      expect(moveBoundary(layout, 2, 30, description).moved).toBe(30);

      expect(layout).toEqual([150, 110, 130, 80]);
    });

    it("never comes back as the result, moved or not", () => {
      for (const boundary of [0, 1, 2, 3, 9]) {
        for (const delta of [20, 0]) {
          const widths = [150, 110, 130, 80];

          const result = moveBoundary(widths, boundary, delta, description);

          expect(result.widths).not.toBe(widths);
          expect(widths).toEqual([150, 110, 130, 80]);
        }
      }
    });

    it("never comes back as the result when the widths are unusable", () => {
      for (const widths of [[], [Number.NaN, 110, 130, 80]]) {
        expect(moveBoundary(widths, 0, 12, description).widths).not.toBe(widths);
      }
    });
  });
});

describe("hidden columns", () => {
  it("are read from a record in table order, each once, and only the optional ones", () => {
    expect(hiddenColumnsOf(["commit", "date", "commit"])).toEqual(["date", "commit"]);
    expect(hiddenColumnsOf(["graph", "description", "author", "constructor", 3, null])).toEqual([
      "author"
    ]);
    for (const damaged of [undefined, null, "author", { author: true }, 3]) {
      expect(hiddenColumnsOf(damaged)).toEqual([]);
    }
  });

  it("leave the graph and the description shown whatever they name", () => {
    expect(shownCells([])).toEqual([0, 1, 2, 3, 4]);
    expect(shownCells(["author"])).toEqual([0, 1, 2, 4]);
    expect(shownCells(["date", "author", "commit"])).toEqual([0, 1]);
    expect(shownCells(["graph", "description", "toString"])).toEqual([0, 1, 2, 3, 4]);
  });

  describe("and the boundaries", () => {
    it("move against the next column shown, leaving hidden widths alone", () => {
      // Date hidden: boundary 1 is description | author.
      expect(moveBoundary(layout, 1, 20, description, [0, 1, 3, 4])).toEqual({
        widths: [150, 110, 110, 80],
        moved: 20
      });
      // Author hidden: boundary 2 is date | commit.
      expect(moveBoundary(layout, 2, -30, description, [0, 1, 2, 4])).toEqual({
        widths: [150, 80, 130, 110],
        moved: -30
      });
    });

    it("do not exist for a hidden column or after the last column shown", () => {
      for (const boundary of [2, 3, 4]) {
        expect(moveBoundary(layout, boundary, 20, description, [0, 1, 3])).toEqual({
          widths: layout,
          moved: 0
        });
      }
      // With every optional column hidden, only graph | description is left.
      expect(moveBoundary(layout, 0, 20, description, [0, 1]).moved).toBe(20);
      expect(moveBoundary(layout, 1, 20, description, [0, 1]).moved).toBe(0);
    });
  });
});
