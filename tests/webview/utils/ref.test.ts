import { describe, expect, it } from "vitest";

import { hasInvalidRefChars } from "@/webview/utils/ref";

describe("hasInvalidRefChars", () => {
  it.each([
    ["a name of two components", "bugfix/header-layout"],
    ["dots inside a later component", "hotfix/v2.10.4"],
    ["a character outside the Basic Multilingual Plane at the start", "🍀-lucky"],
    ["a character outside the Basic Multilingual Plane at the end", "ui/🍀"]
  ])("accepts %s", (_what, name) => {
    expect(hasInvalidRefChars(name)).toBe(false);
  });

  it("gives the same answer when asked twice", () => {
    expect(hasInvalidRefChars("develop")).toBe(false);
    expect(hasInvalidRefChars("develop")).toBe(false);

    expect(hasInvalidRefChars("v1..v2")).toBe(true);
    expect(hasInvalidRefChars("v1..v2")).toBe(true);
  });

  // Each name breaks exactly one rule.
  it.each([
    ["a space", "fix header"],
    ["a leading hyphen", "-hotfix"],
    ["a leading slash", "/hotfix"],
    ["two dots in a row", "v1..v2"],
    ["two slashes in a row", "team//feature"],
    ["a later component starting with a dot", "team/.hidden"],
    ["a trailing dot", "release."],
    ["a trailing slash", "release/"],
    ["a .lock suffix", "hotfix.lock"],
    ["an @{ sequence", "topic@{2}"],
    ["the name @ on its own", "@"],
    ["a tilde", "stable~3"],
    ["a caret", "stable^2"],
    ["a colon", "origin:main"],
    ["a question mark", "why?not"],
    ["an asterisk", "feat*x"],
    ["an opening bracket", "list[0"],
    ["a backslash", "win\\path"]
  ])("refuses a name with %s", (_rule, name) => {
    expect(hasInvalidRefChars(name)).toBe(true);
  });
});
