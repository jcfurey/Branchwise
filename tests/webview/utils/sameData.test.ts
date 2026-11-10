import { describe, expect, it } from "vitest";

import { reuseRows, sameData } from "@/webview/utils/sameData";

describe("sameData", () => {
  it("compares primitives by value, with NaN equal to itself", () => {
    expect(sameData(1, 1)).toBe(true);
    expect(sameData("a", "a")).toBe(true);
    expect(sameData(null, null)).toBe(true);
    expect(sameData(Number.NaN, Number.NaN)).toBe(true);
    expect(sameData(1, "1")).toBe(false);
    expect(sameData(0, null)).toBe(false);
    expect(sameData(null, {})).toBe(false);
    expect(sameData(undefined, null)).toBe(false);
  });

  it("compares arrays item by item, in order", () => {
    expect(sameData([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(sameData([1, 2], [2, 1])).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
    expect(sameData([], {})).toBe(false);
    expect(sameData({ 0: "a", length: 1 }, ["a"])).toBe(false);
  });

  it("compares objects by their keys and values, whatever the order of the keys", () => {
    expect(sameData({ a: 1, b: { c: [true] } }, { b: { c: [true] }, a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameData({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it("counts a key set to undefined as missing, as it is once sent", () => {
    expect(sameData({ a: 1, signed: undefined }, { a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 1, signed: undefined })).toBe(true);
    expect(sameData({ a: undefined }, { b: undefined })).toBe(true);
    expect(sameData({ a: null }, {})).toBe(false);
  });
});

describe("reuseRows", () => {
  const row = (hash: string, message = hash) => ({ hash, message, refs: [] as string[] });

  it("is the previous list itself when a reload brings the same rows", () => {
    const previous = [row("c"), row("b"), row("a")];
    expect(reuseRows(previous, [row("c"), row("b"), row("a")])).toBe(previous);
  });

  it("is the new list when there was none", () => {
    const next = [row("a")];
    expect(reuseRows(undefined, next)).toBe(next);
  });

  it("keeps the objects of unchanged rows, and takes the new ones of the others", () => {
    const previous = [row("c"), row("b"), row("a")];
    const next = [row("d"), row("c"), { ...row("b"), refs: ["main"] }, row("a")];
    const rows = reuseRows(previous, next);
    expect(rows).not.toBe(previous);
    expect(rows).toStrictEqual(next);
    expect(rows[0]).toBe(next[0]);
    expect(rows[1]).toBe(previous[0]);
    expect(rows[2]).toBe(next[2]);
    expect(rows[3]).toBe(previous[2]);
  });

  it("is a new list when the same rows come in another order, or fewer of them", () => {
    const previous = [row("c"), row("b"), row("a")];
    const reordered = reuseRows(previous, [row("b"), row("c"), row("a")]);
    expect(reordered).not.toBe(previous);
    expect(reordered).toStrictEqual([previous[1], previous[0], previous[2]]);
    const fewer = reuseRows(previous, [row("c"), row("b")]);
    expect(fewer).not.toBe(previous);
    expect(fewer).toStrictEqual([previous[0], previous[1]]);
  });

  it("lets the caller say what makes a row the same", () => {
    const previous = [row("*", "at 10:00"), row("a")];
    const next = [row("*", "at 10:05"), row("a")];
    expect(reuseRows(previous, next)).not.toBe(previous);
    expect(reuseRows(previous, next, (a, b) => a.hash === b.hash)).toBe(previous);
  });
});
