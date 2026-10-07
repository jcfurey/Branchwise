// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import type { CommitStats } from "@/backend/types";
import { changeCounts, changeSummary, filesChanged } from "@/webview/utils/changes";

import { speak } from "@tests/webview/components/commit/commit-view-fixtures";

const ENGLISH = {
  changesSummary: "{0}, {1}, {2}",
  filesChanged: "{0} file changed",
  filesChangedPlural: "{0} files changed",
  insertions: "{0} insertion",
  insertionsPlural: "{0} insertions",
  deletions: "{0} deletion",
  deletionsPlural: "{0} deletions"
};

const stats = (files: number, additions: number, deletions: number): CommitStats => ({
  files,
  additions,
  deletions,
  body: "",
  bodyCut: false
});

beforeEach(() => speak(ENGLISH));

describe("the Changes column's text", () => {
  it("shows added and deleted lines with a plus and a minus sign", () => {
    expect(changeCounts(stats(4, 12, 3))).toEqual({ added: "+12", deleted: "−3" });
    expect(changeCounts(stats(0, 0, 0))).toEqual({ added: "+0", deleted: "−0" });
  });

  it("names the files and the lines in its tooltip", () => {
    expect(changeSummary(stats(4, 12, 3))).toBe("4 files changed, 12 insertions, 3 deletions");
  });

  it("uses the singular for exactly one, and the plural for none", () => {
    expect(changeSummary(stats(1, 1, 1))).toBe("1 file changed, 1 insertion, 1 deletion");
    expect(changeSummary(stats(0, 0, 0))).toBe("0 files changed, 0 insertions, 0 deletions");
    expect(filesChanged(stats(1, 0, 0))).toBe("1 file changed");
  });

  it("follows a translation that orders and punctuates the phrases its own way", () => {
    speak({ ...ENGLISH, changesSummary: "{2}; {1} ({0})" });
    expect(changeSummary(stats(2, 5, 1))).toBe("1 deletion; 5 insertions (2 files changed)");
  });
});
