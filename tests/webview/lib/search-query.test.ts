import { describe, expect, it } from "vitest";

import type { HistoryFilter } from "@/backend/types";
import { applySearchPrefixes, hasFieldFilters } from "@/webview/lib/search-query";

const EMPTY: HistoryFilter = {
  text: "",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false,
  committer: "",
  branch: "",
  tag: "",
  regex: false
};

const typed = (text: string) => applySearchPrefixes({ ...EMPTY, text });

describe("search text prefixes", () => {
  it("moves each named field out of the text, leaving the rest as the message search", () => {
    expect(
      typed("fix crash author:ann committer:cid branch:main tag:v1.2 path:src/a.ts")
    ).toStrictEqual({
      ...EMPTY,
      text: "fix crash",
      author: "ann",
      committer: "cid",
      branch: "main",
      tag: "v1.2",
      path: "src/a.ts"
    });
  });

  it("takes a quoted value with spaces, names in any case, and dates", () => {
    expect(typed('Author:"Ann Lee" SINCE:2026-01-02 until:2026-02-03')).toStrictEqual({
      ...EMPTY,
      author: "Ann Lee",
      since: "2026-01-02",
      until: "2026-02-03"
    });
  });

  it("keeps the last value of a field named twice", () => {
    expect(typed("tag:v1 tag:v2").tag).toBe("v2");
  });

  it("leaves words that only look like prefixes in the text", () => {
    const filter = { ...EMPTY, text: "fix: typo in docs:readme" };
    expect(applySearchPrefixes(filter)).toBe(filter);
    expect(typed("re:author:x").text).toBe("re:author:x");
  });

  it("keeps the fields it does not name", () => {
    expect(
      applySearchPrefixes({ ...EMPTY, text: "tag:v1", author: "bob", regex: true })
    ).toStrictEqual({ ...EMPTY, tag: "v1", author: "bob", regex: true });
  });
});

describe("whether the Filters button marks set fields", () => {
  it.each<[Partial<HistoryFilter>, boolean]>([
    [{}, false],
    [{ text: "only text" }, false],
    [{ follow: true }, false],
    [{ committer: "cid" }, true],
    [{ tag: "v1" }, true],
    [{ branch: "main" }, true],
    [{ regex: true }, true],
    [{ since: "2026-01-01" }, true]
  ])("%o → %s", (patch, marked) => {
    expect(hasFieldFilters({ ...EMPTY, ...patch })).toBe(marked);
  });
});
