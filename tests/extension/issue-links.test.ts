import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: Array<string | number>) =>
      values.reduce<string>(
        (sentence, value, index) => sentence.replace(`{${index}}`, String(value)),
        message
      )
  }
}));
vi.mock("@/extension/util/logger", () => ({ logger: { warn } }));

/** The module afresh, with no problem reported yet. */
async function load() {
  vi.resetModules();
  return import("@/extension/issue-links");
}

const JIRA = { pattern: "\\b[A-Z][A-Z0-9]+-\\d+\\b", url: "https://jira.example.com/browse/$0" };
const LINEAR = { pattern: "\\bENG-(\\d+)\\b", url: "https://linear.app/acme/issue/ENG-$1" };

beforeEach(() => {
  warn.mockClear();
});

describe("reading branchwise.issueLinks", () => {
  it("keeps valid entries in order, with only their pattern and url", async () => {
    const { readIssueLinks } = await load();
    expect(readIssueLinks([JIRA, { ...LINEAR, note: "ignored" }])).toEqual([JIRA, LINEAR]);
    expect(readIssueLinks([{ pattern: "#(\\d+)", url: "HTTP://tracker.example/$1" }])).toHaveLength(
      1
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses none for a missing setting, and warns about one that is not a list", async () => {
    const { readIssueLinks } = await load();
    expect(readIssueLinks(undefined)).toEqual([]);
    expect(readIssueLinks(null)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(readIssueLinks({ pattern: "x", url: "https://x.example" })).toEqual([]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("must be a list of entries")
    );
  });

  it.each([
    ["a string entry", "ABC-1", "it must be an object with a pattern and a url."],
    ["an entry without a url", { pattern: "x" }, "it must be an object with a pattern and a url."],
    ["a pattern that is not text", { pattern: 7, url: "https://x.example" }, "an object"],
    ["an empty pattern", { pattern: "", url: "https://x.example" }, "its pattern is empty."],
    ["an invalid pattern", { pattern: "(", url: "https://x.example" }, "not a valid regular"],
    ["a pattern matching empty text", { pattern: "x*", url: "https://x.example" }, "empty text"],
    ["a word boundary alone", { pattern: "\\b", url: "https://x.example" }, "empty text"],
    ["a lookahead alone", { pattern: "(?=ABC)", url: "https://x.example" }, "empty text"],
    ["an optional group", { pattern: "(ENG-\\d+)?", url: "https://x.example" }, "empty text"],
    ["a javascript: url", { pattern: "x", url: "javascript:alert($0)" }, "http: or https:"],
    ["a file: url", { pattern: "x", url: "file:///etc/$0" }, "http: or https:"],
    ["a url whose scheme is a placeholder", { pattern: "x", url: "$1://host/$0" }, "http:"],
    ["a relative url", { pattern: "x", url: "/browse/$0" }, "http: or https:"],
    ["a url without a host", { pattern: "x", url: "https:///$0" }, "http: or https:"]
  ])("skips %s and says why in the log", async (_name, entry, reason) => {
    const { readIssueLinks } = await load();
    expect(readIssueLinks([JIRA, entry])).toEqual([JIRA]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Skipped entry 2 of branchwise\.issueLinks: /)
    );
    expect(warn.mock.calls[0]![0]).toContain(reason);
  });

  it("refuses a pattern over 200 characters, and takes one of exactly 200", async () => {
    const { ISSUE_LINK_PATTERN_LIMIT, readIssueLinks } = await load();
    expect(ISSUE_LINK_PATTERN_LIMIT).toBe(200);
    const exact = { pattern: "A".repeat(200), url: "https://x.example/$0" };
    expect(exact.pattern).toHaveLength(200);
    const over = { pattern: "A".repeat(201), url: "https://x.example/$0" };
    expect(readIssueLinks([exact, over])).toEqual([exact]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Skipped entry 2 of branchwise.issueLinks: its pattern is longer than 200 characters."
    );
  });

  it("warns about each problem once, however often the setting is read", async () => {
    const { readIssueLinks } = await load();
    const setting = [
      { pattern: "(", url: "https://x.example" },
      { pattern: "", url: "" }
    ];
    for (let read = 0; read < 3; read++) {
      readIssueLinks(setting);
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
