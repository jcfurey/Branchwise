import { describe, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";
import { computeGraphLayout } from "@/webview/graph/layout";
import type { GraphBranch, GraphLayout } from "@/webview/graph/types";

import { histories } from "./fixtures";
import { history, layoutOf, line, type LayoutDrawing, type TrackDrawing } from "./layoutDrawing";

/*
 * The worked examples of the layout specification (§4), each compared as a
 * whole result. E16 and E19a follow the maintainer's decisions (§8, Q1 and
 * Q8) rather than the behaviour the examples first recorded.
 */

type Example = {
  name: string;
  commits: Array<GitCommitNode>;
  head: string | null;
  drawing: LayoutDrawing;
};

const examples: Array<Example> = [
  {
    name: "E3 a straight history",
    commits: history("c b", "b a", "a"),
    head: "b",
    drawing: {
      lanes: 1,
      dots: ["0/0", "0/0 current", "0/0"],
      tracks: [[0, "0>1 0,0>0,1", "1>2 0,1>0,2"]]
    }
  },
  {
    name: "E4 a simple merge",
    commits: history("m a b", "a base", "b base", "base"),
    head: "m",
    drawing: {
      lanes: 2,
      dots: ["0/0 current", "0/0", "1/1", "0/0"],
      tracks: [
        [0, "0>1 0,0>0,1", "1>3 0,1>0,2", "1>3 0,2>0,3"],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>3 1,2>0,3"]
      ]
    }
  },
  {
    name: "E5 the reused lanes fixture",
    commits: histories["reused lanes"],
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "0/0", "1/1", "0/0", "0/0", "0/0", "1/1", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>4 0,3>0,4",
          "4>5 0,4>0,5",
          "5>7 0,5>0,6",
          "5>7 0,6>0,7"
        ],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>3 1,2>0,3"],
        [1, "4>6 0,4>1,5 early", "4>6 1,5>1,6", "6>7 1,6>0,7"]
      ]
    }
  },
  {
    name: "E6 the octopus merge fixture",
    commits: histories["octopus merge"],
    head: null,
    drawing: {
      lanes: 4,
      dots: ["0/0", "0/0", "1/1", "2/2", "3/3", "0/0"],
      tracks: [
        [0, "0>1 0,0>0,1", "1>5 0,1>0,2", "1>5 0,2>0,3", "1>5 0,3>0,4", "1>5 0,4>0,5"],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>5 1,2>1,3", "2>5 1,3>1,4", "2>5 1,4>0,5"],
        [2, "0>3 0,0>2,1 early", "0>3 2,1>2,2", "0>3 2,2>2,3", "3>5 2,3>2,4", "3>5 2,4>0,5"],
        [3, "0>4 0,0>3,1 early", "0>4 3,1>3,2", "0>4 3,2>3,3", "0>4 3,3>3,4", "4>5 3,4>0,5"]
      ]
    }
  },
  {
    name: "E7 the criss-cross merges fixture",
    commits: histories["criss-cross merges"],
    head: null,
    drawing: {
      lanes: 3,
      dots: ["0/0", "0/0", "1/1", "0/0", "1/1", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>5 0,3>0,4",
          "3>5 0,4>0,5",
          "2>3 1,2>0,3 early"
        ],
        [
          1,
          "0>2 0,0>1,1 early",
          "0>2 1,1>1,2",
          "2>4 1,2>1,3",
          "2>4 1,3>1,4",
          "4>5 1,4>0,5",
          "1>4 0,1>2,2 early",
          "1>4 2,2>1,3 early"
        ]
      ]
    }
  },
  {
    name: "E8 a merge into a parent another branch reached first",
    commits: histories["merge into a parent another branch reached first"],
    head: "tip",
    drawing: {
      lanes: 3,
      dots: ["0/0 current", "0/0", "1/1", "0/0", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>4 0,3>0,4",
          "1>4 0,1>2,2 early",
          "1>4 2,2>2,3",
          "1>4 2,3>0,4 early"
        ],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>4 1,2>1,3", "2>4 1,3>0,4"]
      ]
    }
  },
  {
    name: "E9 the shallow roots fixture",
    commits: histories["shallow roots"],
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "0/0", "1/1", "0/0"],
      tracks: [
        [0, "0>1 0,0>0,1", "1>3 0,1>0,2", "1>3 0,2>0,3"],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>none 1,2>1,3"]
      ]
    }
  },
  {
    name: "E10a the parents outside the page fixture",
    commits: histories["parents outside the page"],
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "1/1", "0/0"],
      tracks: [
        [0, "0>2 0,0>0,1", "0>2 0,1>0,2"],
        [1, "1>none 1,1>1,2"]
      ]
    }
  },
  {
    name: "E10b the same page with older commits appended",
    commits: [
      ...histories["parents outside the page"],
      ...history("outside-main base", "outside-other base", "outside-topic base", "base")
    ],
    head: null,
    drawing: {
      lanes: 3,
      dots: ["0/0", "2/2", "1/1", "0/0", "2/2", "1/1", "0/0"],
      tracks: [
        [
          0,
          "0>3 0,0>0,1",
          "0>3 0,1>0,2",
          "0>3 0,2>0,3",
          "3>6 0,3>0,4",
          "3>6 0,4>0,5",
          "3>6 0,5>0,6"
        ],
        [
          1,
          "0>2 0,0>1,1 early",
          "0>2 1,1>1,2",
          "2>5 1,2>1,3",
          "2>5 1,3>1,4",
          "2>5 1,4>1,5",
          "5>6 1,5>0,6"
        ],
        [2, "1>4 2,1>2,2", "1>4 2,2>2,3", "1>4 2,3>2,4", "4>6 2,4>2,5", "4>6 2,5>0,6"]
      ]
    }
  },
  {
    name: "E11 a merge link joining an earlier merge link",
    commits: history("m1 m2 base", "m2 a base", "a base", "base"),
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "0/0", "0/0", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>2 0,1>0,2",
          "2>3 0,2>0,3",
          "0>3 0,0>1,1 early",
          "0>3 1,1>1,2",
          "0>3 1,2>0,3 early",
          "1>3 0,1>1,2 early"
        ]
      ]
    }
  },
  {
    name: "E12a extra parents in the order a, c, b",
    commits: history("m a c b", "a b", "c r", "b r", "r"),
    head: null,
    drawing: {
      lanes: 3,
      dots: ["0/0", "0/0", "1/1", "0/0", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>4 0,3>0,4",
          "0>3 0,0>2,1 early",
          "0>3 2,1>0,2 early"
        ],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>4 1,2>1,3", "2>4 1,3>0,4"]
      ]
    }
  },
  {
    name: "E12b the same rows with the parents in the order a, b, c",
    commits: history("m a b c", "a b", "c r", "b r", "r"),
    head: null,
    drawing: {
      lanes: 3,
      dots: ["0/0", "0/0", "1/1", "0/0", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>4 0,3>0,4",
          "0>3 0,0>1,1 early",
          "0>3 1,1>0,2 early"
        ],
        [1, "0>2 0,0>2,1 early", "0>2 2,1>1,2", "2>4 1,2>1,3", "2>4 1,3>0,4"]
      ]
    }
  },
  {
    name: "E13a a colour is not reused in the row where its track ended",
    commits: history("t a b", "a x", "b x", "x y z", "y r", "z r", "r"),
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "0/0", "1/1", "0/0", "0/0", "1/2", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>4 0,3>0,4",
          "4>6 0,4>0,5",
          "4>6 0,5>0,6"
        ],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>3 1,2>0,3"],
        [2, "3>5 0,3>1,4 early", "3>5 1,4>1,5", "5>6 1,5>0,6"]
      ]
    }
  },
  {
    name: "E13b a colour is reused in the row after",
    commits: history("t a b", "a x", "b x", "x y", "m y z", "y r", "z r", "r"),
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "0/0", "1/1", "0/0", "1/1", "0/0", "1/2", "0/0"],
      tracks: [
        [
          0,
          "0>1 0,0>0,1",
          "1>3 0,1>0,2",
          "1>3 0,2>0,3",
          "3>5 0,3>0,4",
          "3>5 0,4>0,5",
          "5>7 0,5>0,6",
          "5>7 0,6>0,7"
        ],
        [1, "0>2 0,0>1,1 early", "0>2 1,1>1,2", "2>3 1,2>0,3"],
        [1, "4>5 1,4>0,5"],
        [2, "4>6 1,4>1,5", "4>6 1,5>1,6", "6>7 1,6>0,7"]
      ]
    }
  },
  {
    name: "E14a two independent histories",
    commits: history("x2 x1", "y2 y1", "x1", "y1"),
    head: null,
    drawing: {
      lanes: 2,
      dots: ["0/0", "1/1", "0/0", "1/1"],
      tracks: [
        [0, "0>2 0,0>0,1", "0>2 0,1>0,2", "2>none 0,2>0,3"],
        [1, "1>3 1,1>1,2", "1>3 1,2>1,3"]
      ]
    }
  },
  {
    name: "E14b two roots only",
    commits: history("x1", "y1"),
    head: null,
    drawing: { lanes: 2, dots: ["0/0", "1/1"], tracks: [[0, "0>none 0,0>0,1"], [1]] }
  },
  {
    name: "E15a the uncommitted row directly above HEAD",
    commits: history("* head", "head base", "base"),
    head: "head",
    drawing: {
      lanes: 1,
      dots: ["0/0 current uncommitted", "0/0", "0/0"],
      tracks: [[0, "0>1 0,0>0,1 uncommitted", "1>2 0,1>0,2"]]
    }
  },
  {
    name: "E15a with the head naming another loaded commit",
    commits: history("* head", "head base", "base"),
    head: "base",
    drawing: {
      lanes: 1,
      dots: ["0/0 current uncommitted", "0/0", "0/0"],
      tracks: [[0, "0>1 0,0>0,1 uncommitted", "1>2 0,1>0,2"]]
    }
  },
  {
    name: "E15b the uncommitted row above newer commits of another branch",
    commits: history("* h", "f2 f1", "f1 b", "h b", "b"),
    head: "h",
    drawing: {
      lanes: 2,
      dots: ["0/0 current uncommitted", "1/1", "1/1", "0/0", "0/0"],
      tracks: [
        [
          0,
          "0>3 0,0>0,1 uncommitted",
          "0>3 0,1>0,2 uncommitted",
          "0>3 0,2>0,3 uncommitted",
          "3>4 0,3>0,4"
        ],
        [1, "1>2 1,1>1,2", "2>4 1,2>1,3", "2>4 1,3>0,4"]
      ]
    }
  },
  {
    name: "E15c the uncommitted row whose parent is not loaded",
    commits: history("* h", "x b", "b"),
    head: "h",
    drawing: {
      lanes: 2,
      dots: ["0/0 current uncommitted", "1/1", "1/1"],
      tracks: [
        [0, "0>none 0,0>0,1 uncommitted", "0>none 0,1>0,2 uncommitted"],
        [1, "1>2 1,1>1,2"]
      ]
    }
  },
  {
    // Q1: the piece leaving row 2 stays uncommitted, although a merge link joins it there.
    name: "E16a a merge link into HEAD below the uncommitted row",
    commits: history("* h", "a x h", "x", "h"),
    head: "h",
    drawing: {
      lanes: 2,
      dots: ["0/0 current uncommitted", "1/1", "1/1", "0/0"],
      tracks: [
        [
          0,
          "0>3 0,0>0,1 uncommitted",
          "0>3 0,1>0,2 uncommitted",
          "0>3 0,2>0,3 uncommitted",
          "1>3 1,1>0,2 early"
        ],
        [1, "1>2 1,1>1,2", "2>none 1,2>1,3"]
      ]
    }
  },
  {
    // Q1: the whole edge from the uncommitted row to HEAD stays uncommitted.
    name: "E16b a merge link into a commit below HEAD",
    commits: history("* h", "z y", "a b q", "y q", "b q", "h q", "q"),
    head: "h",
    drawing: {
      lanes: 4,
      dots: ["0/0 current uncommitted", "1/1", "2/2", "1/1", "2/2", "0/0", "0/0"],
      tracks: [
        [
          0,
          "0>5 0,0>0,1 uncommitted",
          "0>5 0,1>0,2 uncommitted",
          "0>5 0,2>0,3 uncommitted",
          "0>5 0,3>0,4 uncommitted",
          "0>5 0,4>0,5 uncommitted",
          "5>6 0,5>0,6",
          "2>6 2,2>3,3 early",
          "2>6 3,3>3,4",
          "2>6 3,4>3,5",
          "2>6 3,5>0,6 early"
        ],
        [1, "1>3 1,1>1,2", "1>3 1,2>1,3", "3>6 1,3>1,4", "3>6 1,4>1,5", "3>6 1,5>0,6"],
        [2, "2>4 2,2>2,3", "2>4 2,3>2,4", "4>6 2,4>2,5", "4>6 2,5>0,6"]
      ]
    }
  },
  {
    name: "E17 search results whose parents are all missing",
    commits: history("p x", "q y", "r z"),
    head: null,
    drawing: {
      lanes: 3,
      dots: ["0/0", "1/1", "2/2"],
      tracks: [[0, "0>none 0,0>0,1", "0>none 0,1>0,2"], [1, "1>none 1,1>1,2"], [2]]
    }
  },
  {
    // Q8: the repeated parent adds no second line.
    name: "E19a a duplicated parent entry",
    commits: history("m a a", "a b", "b"),
    head: null,
    drawing: {
      lanes: 1,
      dots: ["0/0", "0/0", "0/0"],
      tracks: [[0, "0>1 0,0>0,1", "1>2 0,1>0,2"]]
    }
  },
  {
    name: "E19b a duplicated hash",
    commits: history("m a", "a b", "a b", "b"),
    head: "a",
    drawing: {
      lanes: 2,
      dots: ["0/0", "1/1", "0/0 current", "0/0"],
      tracks: [
        [0, "0>2 0,0>0,1", "0>2 0,1>0,2", "2>3 0,2>0,3"],
        [1, "1>3 1,1>1,2", "1>3 1,2>0,3"]
      ]
    }
  },
  {
    name: "E19c a missing extra parent and a head that is not loaded",
    commits: history("m a zz", "a b", "b"),
    head: "zzz",
    drawing: {
      lanes: 1,
      dots: ["0/0", "0/0", "0/0"],
      tracks: [[0, "0>1 0,0>0,1", "1>2 0,1>0,2"]]
    }
  },
  {
    name: "E20 the history of the focus test",
    commits: history("other base", "merge main topic", "topic base", "main base", "base"),
    head: "merge",
    drawing: {
      lanes: 3,
      dots: ["0/0", "1/1 current", "2/2", "1/1", "0/0"],
      tracks: [
        [0, "0>4 0,0>0,1", "0>4 0,1>0,2", "0>4 0,2>0,3", "0>4 0,3>0,4"],
        [1, "1>3 1,1>1,2", "1>3 1,2>1,3", "3>4 1,3>0,4"],
        [2, "1>2 1,1>2,2 early", "2>4 2,2>2,3", "2>4 2,3>0,4"]
      ]
    }
  },
  {
    name: "E21 an asterisk outside the first row is an ordinary commit",
    commits: history("a *", "* b", "b"),
    head: "*",
    drawing: {
      lanes: 1,
      dots: ["0/0", "0/0 current", "0/0"],
      tracks: [[0, "0>1 0,0>0,1", "1>2 0,1>0,2"]]
    }
  }
];

describe("worked examples of the graph layout", () => {
  it("E1 lays out an empty list as nothing at all", () => {
    expect(computeGraphLayout([], null)).toStrictEqual({ branches: [], vertices: [], lanes: 0 });
    expect(computeGraphLayout([], "anything")).toStrictEqual({
      branches: [],
      vertices: [],
      lanes: 0
    });
  });

  it("E2 lays out one commit as one dot and a track without lines", () => {
    const single: GraphLayout = {
      branches: [{ colour: 0, lines: [] }],
      vertices: [{ x: 0, y: 0, colour: 0, isCommitted: true, isCurrent: true }],
      lanes: 1
    };
    expect(computeGraphLayout(history("a"), "a")).toStrictEqual(single);
    expect(computeGraphLayout(history("a gone"), "a")).toStrictEqual(single);
  });

  it.each(examples)("$name", ({ commits, head, drawing }) => {
    expect(computeGraphLayout(commits, head)).toStrictEqual(layoutOf(drawing));
  });

  it("E8 with no head marks no dot", () => {
    const layout = computeGraphLayout(
      histories["merge into a parent another branch reached first"],
      null
    );
    expect(layout.vertices.map((vertex) => vertex.isCurrent)).toEqual([
      false,
      false,
      false,
      false,
      false
    ]);
    expect(layout.vertices.map((vertex) => [vertex.x, vertex.colour])).toEqual([
      [0, 0],
      [0, 0],
      [1, 1],
      [0, 0],
      [0, 0]
    ]);
  });
});

/** Thirteen tips, one per row, each with the root on the last row as parent. */
function fanIn(withUncommitted: boolean): Array<GitCommitNode> {
  const tips = Array.from({ length: 13 }, (_, k) => `commit${k} commit13`);
  return history(...(withUncommitted ? ["* commit0"] : []), ...tips, "commit13");
}

/** Track `k` of the fan-in, whose tip is on row `k + shift`. */
function fanInTrack(k: number, shift: number): TrackDrawing {
  const tip = k + shift;
  const root = 13 + shift;
  const lines: Array<string> = [];
  for (let row = tip; row < root - 1; row++) {
    lines.push(`${tip}>${root} ${k},${row}>${k},${row + 1}`);
  }
  lines.push(`${tip}>${root} ${k},${root - 1}>0,${root}`);
  return [k, ...lines];
}

describe("E18 a fan-in of thirteen tips", () => {
  it("gives every tip its own lane and colour", () => {
    const dots = [...Array.from({ length: 13 }, (_, k) => `${k}/${k}`), "0/0"];
    const tracks = Array.from({ length: 13 }, (_, k) => fanInTrack(k, 0));
    expect(computeGraphLayout(fanIn(false), null)).toStrictEqual(
      layoutOf({ lanes: 13, dots, tracks })
    );
  });

  it("moves everything down a row under the uncommitted row", () => {
    const dots = [
      "0/0 current uncommitted",
      ...Array.from({ length: 13 }, (_, k) => `${k}/${k}`),
      "0/0"
    ];
    const [, ...rootward] = fanInTrack(0, 1);
    const tracks: Array<TrackDrawing> = [
      [0, "0>1 0,0>0,1 uncommitted", ...rootward],
      ...Array.from({ length: 12 }, (_, k) => fanInTrack(k + 1, 1))
    ];
    expect(computeGraphLayout(fanIn(true), null)).toStrictEqual(
      layoutOf({ lanes: 13, dots, tracks })
    );
  });
});

/** The history `scripts/benchmark.mjs` lays out: a chain with a merge every 20 rows. */
function benchmarkHistory(): Array<GitCommitNode> {
  return history(
    ...Array.from({ length: 10_000 }, (_, i) => {
      if (i === 9999) {
        return "9999";
      }
      const merged = i % 20 === 0 && i < 9970 ? ` ${i + 20}` : "";
      return `${i} ${i + 1}${merged}`;
    })
  );
}

describe("E22 the benchmark input", () => {
  it("draws the chain and then every merge link, twenty lines each", () => {
    const layout = computeGraphLayout(benchmarkHistory(), "0");
    const chain = Array.from({ length: 9999 }, (_, i) => line(`${i}>${i + 1} 0,${i}>0,${i + 1}`));
    const links = Array.from({ length: 499 }, (_unused, n) => {
      const from = n * 20;
      const to = from + 20;
      return [
        line(`${from}>${to} 0,${from}>1,${from + 1} early`),
        ...Array.from({ length: 18 }, (_, j) =>
          line(`${from}>${to} 1,${from + j + 1}>1,${from + j + 2}`)
        ),
        line(`${from}>${to} 1,${to - 1}>0,${to} early`)
      ];
    }).flat();
    const expected: GraphBranch = { colour: 0, lines: [...chain, ...links] };
    expect(layout.lanes).toBe(2);
    expect(layout.branches).toHaveLength(1);
    expect(layout.branches[0]!.lines).toHaveLength(19_979);
    expect(layout.branches[0]).toStrictEqual(expected);
    expect(layout.vertices.every((vertex) => vertex.x === 0 && vertex.colour === 0)).toBe(true);
    expect(layout.vertices.filter((vertex) => vertex.isCurrent).map((vertex) => vertex.y)).toEqual([
      0
    ]);
  });
});
