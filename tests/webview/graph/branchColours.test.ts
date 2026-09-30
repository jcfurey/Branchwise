import { describe, expect, it } from "vitest";

import { createBranchColours } from "@/webview/graph/branchColours";

describe("createBranchColours", () => {
  it("numbers new colours from 0 while none is free", () => {
    const colours = createBranchColours();

    expect([colours.claim(0), colours.claim(0)]).toEqual([0, 1]);
  });

  it("frees a colour only below the row where its track ended", () => {
    const colours = createBranchColours();
    colours.claim(0);
    colours.release(0, 3);

    expect(colours.claim(3)).toBe(1);
    expect(colours.claim(4)).toBe(0);
  });

  it("hands out the lowest free colour first", () => {
    const colours = createBranchColours();
    colours.claim(0);
    colours.release(0, 2);
    colours.claim(1);
    colours.release(1, 1);

    expect(colours.claim(3)).toBe(0);
  });

  it("goes by the latest release of a colour, even when it ended higher up", () => {
    const colours = createBranchColours();
    colours.claim(0);
    colours.release(0, 3);
    colours.release(0, 1);

    expect(colours.claim(2)).toBe(0);
  });

  it("keeps its colours apart from those of another allocator", () => {
    const first = createBranchColours();
    const second = createBranchColours();
    first.claim(0);

    expect(second.claim(0)).toBe(0);
  });

  it("works through claim and release taken off the allocator", () => {
    const { claim, release } = createBranchColours();
    const colour = claim(0);
    release(colour, 0);

    expect(claim(1)).toBe(colour);
  });

  // The layout never does the following; they are kept as they are (see the spec's decisions).

  it("does not reserve a colour that was claimed but not released", () => {
    const colours = createBranchColours();

    expect([colours.claim(0), colours.claim(0), colours.claim(5)]).toEqual([0, 1, 0]);
  });

  it("records a release of a colour it never handed out", () => {
    const colours = createBranchColours();
    colours.release(3, 0);

    expect([colours.claim(1), colours.claim(1)]).toEqual([3, 3]);
    // The indexes below it stay unused, and the next new colour follows it.
    expect(colours.claim(0)).toBe(4);
  });

  it("finds nothing free for a start row that is negative or not a number", () => {
    const negative = createBranchColours();
    const unknown = createBranchColours();

    expect([negative.claim(-1), negative.claim(-5)]).toEqual([0, 1]);
    expect([unknown.claim(Number.NaN), unknown.claim(Number.NaN)]).toEqual([0, 1]);
  });
});
