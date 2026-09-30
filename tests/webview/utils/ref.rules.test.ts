import { describe, expect, it } from "vitest";

import { hasInvalidRefChars } from "@/webview/utils/ref";

/** Built from its code point, since the formatter turns the escape into a lookalike of a space. */
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

describe("ref name rules", () => {
  it.each(["", "a.b", "x-", "a@b", "@@", "a]b", "a{b", "a}b", "ü-branch", "refs/heads/x"])(
    "accepts %j",
    (name) => {
      expect(hasInvalidRefChars(name)).toBe(false);
    }
  );

  it.each(['a"b', "a<b", "a>b"])(
    "refuses %j, which Git would accept, to keep names quotable",
    (name) => {
      expect(hasInvalidRefChars(name)).toBe(true);
    }
  );

  it.each(["-", "/", ".", ".lock", "..", "a..", "x/", "a/"])(
    "judges %j by the start and end of the whole name",
    (name) => {
      expect(hasInvalidRefChars(name)).toBe(true);
    }
  );

  it("answers the same however often and in whatever order it is asked", () => {
    const answers = Array.from({ length: 10 }, (_, turn) =>
      turn % 2 === 0 ? hasInvalidRefChars("a..b") : hasInvalidRefChars("main")
    );

    expect(answers).toEqual([true, false, true, false, true, false, true, false, true, false]);
  });
});

describe("ref name rules that Git also enforces", () => {
  it.each([
    ["a tab", "a\tb"],
    ["a line break", "a\nb"],
    ["a line break before a dash", "a\n-b"],
    ["a NUL", "a\u0000b"],
    ["the last C0 control", "a\u001fb"],
    ["DEL", "a\u007fb"]
  ])("refuses %s anywhere in the name", (_what, name) => {
    expect(hasInvalidRefChars(name)).toBe(true);
  });

  it.each([".hidden", ".x/y"])("refuses %j, which starts with a dot", (name) => {
    expect(hasInvalidRefChars(name)).toBe(true);
  });

  it.each(["a.lock/b", "x/y.lock/z", "a/b.lock"])(
    "refuses %j, where a component ends in .lock",
    (name) => {
      expect(hasInvalidRefChars(name)).toBe(true);
    }
  );

  it("refuses HEAD itself, but not names that merely contain it", () => {
    expect(hasInvalidRefChars("HEAD")).toBe(true);
    expect(["HEADS", "head", "feature/HEAD-fix", "a/HEAD"].map(hasInvalidRefChars)).toEqual([
      false,
      false,
      false,
      false
    ]);
  });

  it.each(["a./b", "a.lockx", "lock/b", "ü-ß", `a${NO_BREAK_SPACE}b`, "a\u0080b"])(
    "still accepts %j",
    (name) => {
      expect(hasInvalidRefChars(name)).toBe(false);
    }
  );

  it("still refuses the plain space", () => {
    expect(hasInvalidRefChars("a b")).toBe(true);
  });
});
