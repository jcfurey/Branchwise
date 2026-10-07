import { describe, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import { computeGraphLayout } from "@/webview/graph/layout";
import type { GraphLayout, GraphLine, GraphPoint } from "@/webview/graph/types";

import { histories } from "./fixtures";
import { allLines, history, layoutOf, line, notationOf } from "./layoutDrawing";

const crissCross = histories["criss-cross merges"];
const reachedFirst = histories["merge into a parent another branch reached first"];
const orderACB = history("m a c b", "a b", "c r", "b r", "r");
const orderABC = history("m a b c", "a b", "c r", "b r", "r");
const colourEndsThere = history("t a b", "a x", "b x", "x y z", "y r", "z r", "r");
const colourEndsAbove = history("t a b", "a x", "b x", "x y", "m y z", "y r", "z r", "r");

/** The lines of one edge, in the notation of `line`, with the colour of the track holding them. */
function edge(layout: GraphLayout, child: number, parent: number | null) {
  return layout.branches.flatMap(({ colour, lines }) =>
    lines
      .filter((drawn) => drawn.child === child && drawn.parent === parent)
      .map((drawn) => `${colour}: ${notationOf(drawn)}`)
  );
}

const lanesOf = (layout: GraphLayout) => layout.vertices.map((vertex) => vertex.x);
const coloursOf = (layout: GraphLayout) => layout.vertices.map((vertex) => vertex.colour);
const currentRows = (layout: GraphLayout) =>
  layout.vertices.filter((vertex) => vertex.isCurrent).map((vertex) => vertex.y);

describe("where a lane change bends", () => {
  it("bends early on lines moving right and on the last line of a merge link", () => {
    const early = allLines(computeGraphLayout(crissCross, null))
      .filter((drawn) => drawn.lockedFirst)
      .map(notationOf);
    expect(early).toEqual([
      "2>3 1,2>0,3 early",
      "0>2 0,0>1,1 early",
      "1>4 0,1>2,2 early",
      "1>4 2,2>1,3 early"
    ]);
  });

  it("keeps a merge link's straight lines and a track moving left bending late", () => {
    const layout = computeGraphLayout(reachedFirst, null);
    expect(edge(layout, 1, 4)).toEqual([
      "0: 1>4 0,1>2,2 early",
      "0: 1>4 2,2>2,3",
      "0: 1>4 2,3>0,4 early"
    ]);
    expect(edge(layout, 2, 4)).toEqual(["1: 2>4 1,2>1,3", "1: 2>4 1,3>0,4"]);
  });
});

describe("merge links", () => {
  it("are drawn in the colour of the track that placed the parent", () => {
    const layout = computeGraphLayout(crissCross, null);
    expect(coloursOf(layout).slice(1, 3)).toEqual([0, 1]);
    expect(edge(layout, 2, 3)).toEqual(["0: 2>3 1,2>0,3 early"]);
    expect(edge(layout, 1, 4)).toEqual(["1: 1>4 0,1>2,2 early", "1: 1>4 2,2>1,3 early"]);
  });

  it("join the line into their parent above the parent's row", () => {
    expect(edge(computeGraphLayout(orderACB, null), 0, 3)).toEqual([
      "0: 0>3 0,0>2,1 early",
      "0: 0>3 2,1>0,2 early"
    ]);
    const intoRight = allLines(computeGraphLayout(crissCross, null)).filter(
      (drawn) => drawn.child === 1 && drawn.parent === 4
    );
    expect(intoRight.at(-1)!.p2).toStrictEqual({ x: 1, y: 3 });
  });

  it("join an earlier merge link into the same parent", () => {
    const layout = computeGraphLayout(history("m1 m2 base", "m2 a base", "a base", "base"), null);
    expect(layout.lanes).toBe(2);
    expect(layout.branches).toHaveLength(1);
    expect(notationOf(layout.branches[0]!.lines.at(-1)!)).toBe("1>3 0,1>1,2 early");
    expect(edge(layout, 1, 3)).toEqual(["0: 1>3 0,1>1,2 early"]);
  });

  it("never join a line that another track draws into the parent", () => {
    const layout = computeGraphLayout(reachedFirst, null);
    // Track 1 passes 1,3 on its way into row 4; the link keeps its own lane there.
    expect(edge(layout, 2, 4)).toContain("1: 2>4 1,2>1,3");
    expect(edge(layout, 1, 4).at(-1)).toBe("0: 1>4 2,3>0,4 early");
  });
});

describe("the order of extra parents", () => {
  it("places the same dots whichever order the extra parents come in", () => {
    expect(lanesOf(computeGraphLayout(orderACB, null))).toEqual([0, 0, 1, 0, 0]);
    expect(lanesOf(computeGraphLayout(orderABC, null))).toEqual([0, 0, 1, 0, 0]);
  });

  it("lets an earlier parent take the lower lane", () => {
    const acb = computeGraphLayout(orderACB, null);
    expect(edge(acb, 0, 3)).toEqual(["0: 0>3 0,0>2,1 early", "0: 0>3 2,1>0,2 early"]);
    expect(acb.branches[1]!.lines.slice(0, 2).map(notationOf)).toEqual([
      "0>2 0,0>1,1 early",
      "0>2 1,1>1,2"
    ]);

    const abc = computeGraphLayout(orderABC, null);
    expect(edge(abc, 0, 3)).toEqual(["0: 0>3 0,0>1,1 early", "0: 0>3 1,1>0,2 early"]);
    expect(abc.branches[1]!.lines.slice(0, 2).map(notationOf)).toEqual([
      "0>2 0,0>2,1 early",
      "0>2 2,1>1,2"
    ]);
  });
});

describe("colours", () => {
  it("does not reuse a colour in the row where its track ended", () => {
    const layout = computeGraphLayout(colourEndsThere, null);
    expect(coloursOf(layout)).toEqual([0, 0, 1, 0, 0, 2, 0]);
    expect(layout.branches.map((branch) => branch.colour)).toEqual([0, 1, 2]);
  });

  it("reuses a colour from the row below the one where its track ended", () => {
    const layout = computeGraphLayout(colourEndsAbove, null);
    expect(coloursOf(layout)).toEqual([0, 0, 1, 0, 1, 0, 2, 0]);
    expect(layout.branches.map((branch) => branch.colour)).toEqual([0, 1, 1, 2]);
  });

  it("keeps a commit in the colour of the first track that reached it", () => {
    const layout = computeGraphLayout(history("m a b", "a base", "b base", "base"), null);
    expect(coloursOf(layout)).toEqual([0, 0, 1, 0]);
    expect(edge(layout, 2, 3)).toEqual(["1: 2>3 1,2>0,3"]);
  });
});

describe("the order of the result", () => {
  it.each(Object.entries(histories))(
    "keeps the tracks of %s in the order they start",
    (_, rows) => {
      const layout = computeGraphLayout(rows, null);
      checkOrder(rows, layout);
      const starts = layout.branches.map((branch) => branch.lines[0]?.p1.y ?? rows.length - 1);
      expect(starts).toEqual(starts.toSorted((a, b) => a - b));
    }
  );
});

describe("loose ends", () => {
  it("runs a line from a commit without loaded parents to the last row", () => {
    const partial = computeGraphLayout(histories["parents outside the page"], null);
    expect(partial.branches[1]!.lines).toStrictEqual([
      {
        child: 1,
        parent: null,
        p1: { x: 1, y: 1 },
        p2: { x: 1, y: 2 },
        isCommitted: true,
        lockedFirst: false
      }
    ]);
    const shallow = computeGraphLayout(histories["shallow roots"], null);
    expect(notationOf(shallow.branches[1]!.lines.at(-1)!)).toBe("2>none 1,2>1,3");
  });

  it("builds a staircase of loose ends for unrelated search results", () => {
    const layout = computeGraphLayout(history("p x", "q y", "r z"), null);
    expect(layout.lanes).toBe(3);
    expect(layout.branches.map((branch) => branch.lines.length)).toEqual([2, 1, 0]);
    expect(allLines(layout).every((drawn) => drawn.parent === null)).toBe(true);

    const hundred = computeGraphLayout(
      history(...Array.from({ length: 100 }, (_, i) => `found${i} elsewhere${i}`)),
      null
    );
    expect(hundred.lanes).toBe(100);
    expect(allLines(hundred)).toHaveLength(4950);
  });

  it("gives a root on the last row no line, and one above it a loose end", () => {
    const layout = computeGraphLayout(history("x1", "y1"), null);
    expect(layout.branches.map((branch) => branch.lines.map(notationOf))).toEqual([
      ["0>none 0,0>0,1"],
      []
    ]);
  });
});

describe("parents missing from the list", () => {
  it("follows the next loaded parent when the first one is missing", () => {
    const layout = computeGraphLayout(histories["parents outside the page"], null);
    expect(layout.vertices.map((vertex) => `${vertex.x}/${vertex.colour}`)).toEqual([
      "0/0",
      "1/1",
      "0/0"
    ]);
    expect(layout.branches[0]!.lines.map(notationOf)).toEqual(["0>2 0,0>0,1", "0>2 0,1>0,2"]);
  });

  it("draws nothing for a missing extra parent", () => {
    const layout = computeGraphLayout(history("m a zz", "a b", "b"), "zzz");
    expect(layout.lanes).toBe(1);
    expect(allLines(layout)).toHaveLength(2);
  });

  it("runs the uncommitted row's edge to the bottom when HEAD is not loaded", () => {
    const layout = computeGraphLayout(history("* h", "x b", "b"), "h");
    expect(layout.branches[0]!.lines.map(notationOf)).toEqual([
      "0>none 0,0>0,1 uncommitted",
      "0>none 0,1>0,2 uncommitted"
    ]);
  });

  it("pushes a dot right past the tracks that cross its row first", () => {
    const layout = computeGraphLayout(
      [
        ...histories["parents outside the page"],
        ...history("outside-main base", "outside-other base", "outside-topic base", "base")
      ],
      null
    );
    expect(lanesOf(layout)).toEqual([0, 2, 1, 0, 2, 1, 0]);
    expect(coloursOf(layout)).toEqual([0, 2, 1, 0, 2, 1, 0]);
  });
});

describe("the current commit", () => {
  it.each(Object.entries(histories))("marks nothing in %s without a head", (_, rows) => {
    expect(currentRows(computeGraphLayout(rows, null))).toEqual([]);
  });

  it("marks nothing for a head that is not loaded", () => {
    expect(currentRows(computeGraphLayout(history("m a zz", "a b", "b"), "zzz"))).toEqual([]);
  });

  it("marks the last row of a duplicated hash", () => {
    const layout = computeGraphLayout(history("m a", "a b", "a b", "b"), "a");
    expect(currentRows(layout)).toEqual([2]);
    expect(layout.vertices[1]).toMatchObject({ x: 1, colour: 1 });
  });

  it("treats an asterisk below the first row as an ordinary commit", () => {
    const layout = computeGraphLayout(history("a *", "* b", "b"), "*");
    expect(layout.vertices[1]).toStrictEqual({
      x: 0,
      y: 1,
      colour: 0,
      isCommitted: true,
      isCurrent: true,
      isMerge: false
    });
    expect(allLines(layout).every((drawn) => drawn.isCommitted)).toBe(true);
  });

  it("marks only the uncommitted row when there is one, whatever the head", () => {
    for (const head of ["h", "b", "nowhere", null]) {
      expect(currentRows(computeGraphLayout(history("* h", "h b", "b"), head))).toEqual([0]);
    }
  });
});

describe("calls", () => {
  it("keep no state between them and return new objects every time", () => {
    const first = computeGraphLayout(crissCross, null);
    computeGraphLayout(colourEndsThere, null);
    const again = computeGraphLayout(crissCross, null);
    expect(again).toStrictEqual(first);
    expect(again).not.toBe(first);
    expect(again.vertices).not.toBe(first.vertices);
    expect(again.branches).not.toBe(first.branches);
  });

  it("leave the input alone and share no objects with it", () => {
    const rows = history("* h", "h a b", "a c", "b c", "c gone");
    const before = structuredClone(rows);
    const layout = computeGraphLayout(rows, "h");
    expect(rows).toStrictEqual(before);
    const inputs = new Set<object>([rows, ...rows, ...rows.map((row) => row.parentHashes)]);
    const outputs: Array<object> = [layout, layout.branches, layout.vertices, ...layout.vertices];
    for (const branch of layout.branches) {
      outputs.push(branch, branch.lines, ...branch.lines);
    }
    expect(outputs.filter((object) => inputs.has(object))).toEqual([]);
  });

  it("lay out the benchmark history as one track with its merge links", () => {
    const rows = history(
      ...Array.from({ length: 10_000 }, (_, i) =>
        [i, i + 1, i % 20 === 0 && i < 9970 ? i + 20 : null]
          .filter((value) => value !== null && value < 10_000)
          .join(" ")
      )
    );
    const layout = computeGraphLayout(rows, "0");
    expect(layout.lanes).toBe(2);
    expect(layout.branches).toHaveLength(1);
    const lines = layout.branches[0]!.lines;
    expect(lines).toHaveLength(19_979);
    expect(notationOf(lines[9999]!)).toBe("0>20 0,0>1,1 early");
    expect(notationOf(lines[10_018]!)).toBe("0>20 1,19>0,20 early");
  });

  it("handles fifty thousand rows without deep recursion", () => {
    const rows = history(
      ...Array.from({ length: 50_000 }, (_, i) => (i < 49_999 ? `c${i} c${i + 1}` : `c${i}`))
    );
    const layout = computeGraphLayout(rows, "c0");
    expect(layout.lanes).toBe(1);
    expect(layout.branches).toHaveLength(1);
    expect(layout.branches[0]!.lines).toHaveLength(49_999);
  });
});

describe("decisions on the specification's questions", () => {
  it("Q1 draws every line of the uncommitted row's edge as uncommitted", () => {
    for (const rows of [
      history("* h", "a x h", "x", "h"),
      history("* h", "z y", "a b q", "y q", "b q", "h q", "q")
    ]) {
      const lines = allLines(computeGraphLayout(rows, "h"));
      const uncommitted = lines.filter((drawn) => !drawn.isCommitted);
      expect(uncommitted.length).toBeGreaterThan(1);
      expect(lines.filter((drawn) => drawn.child === 0)).toStrictEqual(uncommitted);
    }
  });

  it("Q2 flags exactly the lines of an uncommitted row with several parents", () => {
    const merged = computeGraphLayout(history("* h b", "h b", "x b", "b"), "h");
    expect(merged).toStrictEqual(
      layoutOf({
        lanes: 2,
        dots: ["0/0 current uncommitted merge", "0/0", "1/1", "0/0"],
        tracks: [
          [
            0,
            "0>1 0,0>0,1 uncommitted",
            "1>3 0,1>0,2",
            "1>3 0,2>0,3",
            "0>3 0,0>1,1 early uncommitted",
            "0>3 1,1>0,2 early uncommitted"
          ],
          [1, "2>3 1,2>0,3"]
        ]
      })
    );

    // A side track is uncommitted only until it reaches the parent it was made for.
    const side = computeGraphLayout(history("* h s", "s h", "h"), "h");
    expect(side.branches.map((branch) => branch.lines.map(notationOf))).toEqual([
      ["0>2 0,0>0,1 uncommitted", "0>2 0,1>0,2 uncommitted"],
      ["0>1 0,0>1,1 early uncommitted", "1>2 1,1>0,2"]
    ]);
  });

  // The last column lists the rows that still name two parents, and so keep a merge's dot.
  it.each([
    ["itself", history("a a", "b"), history("a", "b"), []],
    ["an asterisk row above it", history("h b", "* h", "b"), history("h b", "*", "b"), []],
    [
      "an extra parent above it",
      history("x b", "m a x", "a b", "b"),
      history("x b", "m a", "a b", "b"),
      [1]
    ],
    ["itself as an extra parent", history("m a m", "a"), history("m a", "a"), [0]],
    ["a first parent above it", history("x", "m x y", "y"), history("x", "m y", "y"), [1]],
    ["an only parent above it on the last row", history("a", "b a"), history("a", "b"), []]
  ])("Q6 treats a parent that is %s as not loaded", (_, rows, equivalent, merges) => {
    const expected = computeGraphLayout(equivalent, null);
    for (const row of merges) {
      expected.vertices[row]!.isMerge = true;
    }
    expect(computeGraphLayout(rows, null)).toStrictEqual(expected);
  });

  it.each([
    ["the only parent twice", history("m a a", "a b", "b"), history("m a", "a b", "b")],
    [
      "an extra parent twice",
      history("m a b b", "a c", "b c", "c"),
      history("m a b", "a c", "b c", "c")
    ],
    [
      "the first parent again later",
      history("m a b a", "a c", "b c", "c"),
      history("m a b", "a c", "b c", "c")
    ]
  ])("Q8 counts %s once", (_, rows, equivalent) => {
    expect(computeGraphLayout(rows, "m")).toStrictEqual(computeGraphLayout(equivalent, "m"));
  });

  it("marks a merge for two different parents, whether or not they are loaded", () => {
    const layout = computeGraphLayout(
      history("* m", "m a b", "o a gone", "d a a", "a b", "b", "r"),
      "m"
    );
    expect(layout.vertices.map((vertex) => vertex.isMerge)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false
    ]);
  });
});

/* Invariants that every layout within the input contract keeps (§3.12). */

const samePoint = (a: GraphPoint, b: GraphPoint) => a.x === b.x && a.y === b.y;

/** A small deterministic generator, so a failure can be replayed from its seed. */
function randomSource(seed: number) {
  let state = seed >>> 0;
  return (below: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor((state / 2 ** 32) * below);
  };
}

/** A history in which every parent lies below its child, with some parents missing. */
function randomHistory(seed: number): { rows: Array<GitCommitNode>; head: string | null } {
  const random = randomSource(seed);
  const size = 1 + random(40);
  const specs = Array.from({ length: size }, (_, row) => {
    const parents: Array<string> = [];
    const count = random(10) < 2 ? 0 : 1 + (random(10) < 3 ? 1 + random(3) : 0);
    for (let n = 0; n < count; n++) {
      const below = row + 1 + random(Math.min(12, size + 3 - row));
      parents.push(below < size ? `c${below}` : `gone${below}`);
    }
    return [`c${row}`, ...parents].join(" ");
  });
  const withUncommitted = random(4) === 0 && size > 1;
  const rows = history(...(withUncommitted ? [`* c${random(size)}`] : []), ...specs);
  const heads = [null, "c0", `c${random(size)}`, "missing"];
  return { rows, head: heads[random(heads.length)] ?? null };
}

/**
 * A track's own lines come first, as one chain down from where it starts.
 * The merge links stored in it follow, one chain per link, each from its
 * child's dot and in the order of the rows they start from.
 */
function checkOrder(rows: Array<GitCommitNode>, layout: GraphLayout) {
  for (const branch of layout.branches) {
    let own = 0;
    while (
      own + 1 < branch.lines.length &&
      samePoint(branch.lines[own]!.p2, branch.lines[own + 1]!.p1)
    ) {
      own++;
    }
    const links: Array<Array<GraphLine>> = [];
    for (const drawn of branch.lines.slice(own + 1)) {
      const link = links.at(-1);
      const previous = link?.at(-1);
      if (
        previous !== undefined &&
        previous.child === drawn.child &&
        previous.parent === drawn.parent &&
        samePoint(previous.p2, drawn.p1)
      ) {
        link!.push(drawn);
      } else {
        links.push([drawn]);
      }
    }
    const start = branch.lines[0]?.p1.y ?? rows.length - 1;
    const linkStarts = links.map((link) => link[0]!.child);
    expect(linkStarts).toEqual(linkStarts.toSorted((a, b) => a - b));
    for (const link of links) {
      expect(link[0]!.child).toBeGreaterThanOrEqual(start);
      expect(link[0]!.p1).toStrictEqual({
        x: layout.vertices[link[0]!.child]!.x,
        y: link[0]!.child
      });
      expect(link.at(-1)!.lockedFirst).toBe(true);
    }
  }
}

function checkInvariants(rows: Array<GitCommitNode>, head: string | null, layout: GraphLayout) {
  const rowOf = new Map(rows.map((row, index) => [row.hash, index]));
  const lines = allLines(layout);
  const uncommitted = rows[0]?.hash === "*";

  expect(layout.vertices.map((vertex) => vertex.y)).toEqual(rows.map((_, index) => index));
  const current = uncommitted ? 0 : head === null ? undefined : rowOf.get(head);
  expect(currentRows(layout)).toEqual(current === undefined ? [] : [current]);

  // Lanes: every row uses exactly lanes 0 … k − 1, and none reaches `lanes`.
  const used = rows.map(() => new Set<number>());
  for (const vertex of layout.vertices) {
    used[vertex.y]!.add(vertex.x);
  }
  for (const drawn of lines) {
    expect(drawn.p2.y).toBe(drawn.p1.y + 1);
    used[drawn.p1.y]!.add(drawn.p1.x);
    used[drawn.p2.y]!.add(drawn.p2.x);
  }
  for (const lanes of used) {
    expect([...lanes].toSorted((a, b) => a - b)).toEqual([...lanes].map((_, index) => index));
  }
  expect(layout.lanes).toBe(Math.max(0, ...used.map((lanes) => lanes.size)));

  for (const drawn of lines) {
    expect(drawn.child).toBeLessThanOrEqual(drawn.p1.y);
    expect(drawn.isCommitted).toBe(!(uncommitted && drawn.child === 0));
    if (drawn.parent !== null) {
      expect(rows[drawn.child]!.parentHashes).toContain(rows[drawn.parent]!.hash);
      expect(drawn.p2.y).toBeLessThanOrEqual(drawn.parent);
    }
    expect(drawn.lockedFirst || drawn.p2.x <= drawn.p1.x).toBe(true);
    for (const end of [drawn.p1, drawn.p2]) {
      if (samePoint(end, layout.vertices[end.y]!)) {
        expect([drawn.child, drawn.parent]).toContain(end.y);
      }
    }
  }

  // Each edge can be followed from the child's dot to the parent's along its own lines.
  const into = Map.groupBy(lines, (drawn) => drawn.parent);
  for (const [child, row] of rows.entries()) {
    for (const hash of row.parentHashes) {
      const parent = rowOf.get(hash);
      if (parent === undefined || parent <= child) {
        continue;
      }
      const candidates = into.get(parent) ?? [];
      let at: Array<GraphPoint> = [layout.vertices[child]!];
      for (let y = child; y < parent; y++) {
        at = candidates
          .filter((drawn) => at.some((point) => samePoint(point, drawn.p1)))
          .map((drawn) => drawn.p2);
      }
      expect(at.some((point) => samePoint(point, layout.vertices[parent]!))).toBe(true);
    }
  }

  checkOrder(rows, layout);

  // Colours are 0 … k − 1, and two tracks of one colour never share a row.
  const colours = new Set(layout.branches.map((branch) => branch.colour));
  expect([...colours].toSorted((a, b) => a - b)).toEqual([...colours].map((_, index) => index));
  const rowsByColour = new Map<number, Set<number>>();
  for (const branch of layout.branches) {
    const own = new Set(branch.lines.flatMap((drawn) => [drawn.p1.y, drawn.p2.y]));
    const taken = rowsByColour.get(branch.colour) ?? new Set<number>();
    const trackRows = own.size > 0 ? own : new Set([rows.length - 1]);
    const span = [...trackRows];
    const low = Math.min(...span);
    const high = Math.max(...span);
    for (let y = low; y <= high; y++) {
      expect(taken.has(y), `colour ${branch.colour} used twice in row ${y}`).toBe(false);
      taken.add(y);
    }
    rowsByColour.set(branch.colour, taken);
  }
}

describe("layout invariants", () => {
  it("hold for every example history", () => {
    for (const rows of Object.values(histories)) {
      checkInvariants(rows, rows[0]!.hash, computeGraphLayout(rows, rows[0]!.hash));
    }
  });

  it("hold for generated histories", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { rows, head } = randomHistory(seed);
      const before = structuredClone(rows);
      const layout = computeGraphLayout(rows, head);
      checkInvariants(rows, head, layout);
      expect(rows).toStrictEqual(before);
      expect(computeGraphLayout(rows, head)).toStrictEqual(layout);
    }
  });

  it("follow the drawing notation both ways", () => {
    const sample = line("3>none 2,3>0,4 early uncommitted");
    expect(notationOf(sample)).toBe("3>none 2,3>0,4 early uncommitted");
    expect(() => line("3>4 2,3>0,4 sideways")).toThrow();
  });
});
