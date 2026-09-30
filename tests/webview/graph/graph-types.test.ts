import { describe, expect, expectTypeOf, it } from "vitest";

import type { BranchRelation, GraphLine, GraphStroke } from "@/webview/graph/types";

// Checked by `tsc -p tests/webview`: every line under `@ts-expect-error` must fail to compile.

/** Hands `sample` back unchanged, once the compiler agrees that it is a `Shape`. */
function shaped<Shape>(sample: Shape): Shape {
  return sample;
}

describe("graph shapes", () => {
  it("know exactly four relations, the ones the stylesheet and UI tests select", () => {
    expectTypeOf<BranchRelation>().toEqualTypeOf<"normal" | "direct" | "merged" | "unrelated">();
    const drawn = { path: "M8,12L8,36", colour: 0, isCommitted: true } as const;
    const merged = shaped<GraphStroke>({ ...drawn, relation: "merged" });
    // @ts-expect-error: fading is a relation's effect, not a relation.
    shaped<GraphStroke>({ ...drawn, relation: "dimmed" });

    expect(merged.relation).toBe("merged");
  });

  it("need a line to say whether its parent is loaded", () => {
    const ends = { p1: { x: 0, y: 3 }, p2: { x: 0, y: 4 } };
    const segment = { child: 3, ...ends, isCommitted: true, lockedFirst: false };
    const trailing = shaped<GraphLine>({ ...segment, parent: null });
    // @ts-expect-error: an unloaded parent is null, not missing.
    shaped<GraphLine>(segment);

    expect(trailing.parent).toBeNull();
  });
});
