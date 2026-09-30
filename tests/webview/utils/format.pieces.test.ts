// @vitest-environment jsdom
import { h, render } from "preact";
import { describe, expect, it } from "vitest";

import { format } from "@/webview/utils/format";

describe("format pieces", () => {
  it("gives nothing for an empty template, whatever the parts", () => {
    expect(format("")).toEqual([]);
    expect(format("", "unused")).toEqual([]);
  });

  it("leaves out the empty text around and between placeholders", () => {
    expect(format("{0}{1}", "A", "B")).toEqual(["A", "B"]);
    expect(format("{0}", "X")).toEqual(["X"]);
  });

  it("puts the very same part at every placeholder that names it", () => {
    const bold = h("b", null, "x");
    const pieces = format("{0}-{0}", bold);

    expect(pieces).toHaveLength(3);
    expect(pieces[0]).toBe(bold);
    expect(pieces[2]).toBe(bold);
  });

  it("reads placeholder numbers of several digits, leading zeros included", () => {
    const parts = Array.from({ length: 11 }, (_, index) => `part ${index}`);

    expect(format("{10}", ...parts)).toEqual(["part 10"]);
    expect(format("{01}", "zero", "one")).toEqual(["one"]);
    expect(format("{99999999999999999999}", "X")).toEqual([undefined]);
  });

  it("keeps anything else in braces as text", () => {
    expect(format("{a} { 0} {}", "X")).toEqual(["{a} { 0} {}"]);
    expect(format("{0 } {-1} {٣}", "X")).toEqual(["{0 } {-1} {٣}"]);
    expect(format("{{0}}", "X")).toEqual(["{", "X", "}"]);
  });

  it("ignores parts that no placeholder names", () => {
    expect(format("x {0}", "A", "B")).toEqual(["x ", "A"]);
  });

  it("keeps falsy parts as they are", () => {
    expect(format("{0}{1}{2}", null, false, 0)).toEqual([null, false, 0]);
    expect(format("{0}|{1}", "", ["a", "b"])).toEqual(["", "|", ["a", "b"]]);
  });

  it("treats replacement patterns and line breaks as plain text", () => {
    expect(format("$& {0} $1", "$`")).toEqual(["$& ", "$`", " $1"]);
    expect(format("a\n{0}\nb", "X")).toEqual(["a\n", "X", "\nb"]);
  });

  it("renders markup in the template and the parts as text", () => {
    const host = document.createElement("div");
    render(h("p", null, format("<b>{0}</b>", "<i>x</i>")), host);
    const shown = host.firstElementChild!;

    expect(shown.textContent).toBe("<b><i>x</i></b>");
    expect(shown.children).toHaveLength(0);
  });

  it("joins into plain text, a missing part adding nothing", () => {
    expect(format("{0} was renamed to {1}", "a").join("")).toBe("a was renamed to ");
  });

  it("returns a new list each time and leaves the parts alone", () => {
    const parts = ["one", "two"];
    const first = format("{0} {1}", ...parts);
    const second = format("{0} {1}", ...parts);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(parts).toEqual(["one", "two"]);
  });
});
