import { describe, expect, it } from "vitest";

import type { HistoryFilter } from "@/backend/types";
import { activeFilterCount, noMatchSuggestions } from "@/webview/components/history/NoMatches";

const filter = (fields: Partial<HistoryFilter> = {}): HistoryFilter => ({
  text: "",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false,
  ...fields
});

describe("activeFilterCount", () => {
  it("counts the filled-in Filters fields, not the search text, the regex box or renames", () => {
    expect(activeFilterCount(filter())).toBe(0);
    expect(activeFilterCount(filter({ text: "x", regex: true, follow: true }))).toBe(0);
    expect(
      activeFilterCount(
        filter({
          author: "a",
          committer: "c",
          branch: "b",
          tag: "t",
          path: "p",
          changes: "x",
          since: "2024-01-01",
          until: "2024-02-01"
        })
      )
    ).toBe(8);
  });

  it("reads a field a saved filter lacks as empty", () => {
    const saved = filter({ tag: "v1" });
    delete saved.committer;
    expect(activeFilterCount(saved)).toBe(1);
  });
});

describe("noMatchSuggestions", () => {
  it("offers nothing for a search with nothing to widen", () => {
    expect(noMatchSuggestions(filter(), "")).toEqual([]);
    // The history of one commit, which no branch choice narrows.
    expect(noMatchSuggestions(filter({ revision: "abc123" }), "main")).toEqual([]);
  });

  it("offers every branch only while the graph is filtered to one and no commit is chosen", () => {
    expect(noMatchSuggestions(filter({ changes: "x" }), "main")).toEqual([
      "allBranches",
      "clearFilters"
    ]);
    expect(noMatchSuggestions(filter({ path: "a", revision: "abc123" }), "main")).toEqual([
      "clearFilters"
    ]);
  });

  it("offers literal text only while regular expressions are on", () => {
    expect(noMatchSuggestions(filter({ changes: "a.b", regex: true }), "")).toEqual([
      "clearFilters",
      "noRegex"
    ]);
    expect(noMatchSuggestions(filter({ changes: "a.b", regex: false }), "")).toEqual([
      "clearFilters"
    ]);
  });

  it("offers the changes only when messages alone were searched", () => {
    expect(noMatchSuggestions(filter({ text: "parser" }), "")).toEqual(["changes"]);
    expect(noMatchSuggestions(filter({ text: "   " }), "")).toEqual([]);
    expect(noMatchSuggestions(filter({ text: "parser", changes: "parse(" }), "")).toEqual([
      "clearFilters"
    ]);
  });
});
