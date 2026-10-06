import { rmSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanPatterns,
  matchesPattern,
  matchesRemoteBranch,
  patternMatcher,
  suggestedPattern
} from "@/backend/utils/branchPatterns";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

describe("cleanPatterns", () => {
  it("trims each pattern and drops blank lines and repeats, keeping the order", () => {
    expect(cleanPatterns(["  bot/*", "", "   ", "renovate/*", "bot/*  ", "a"])).toEqual([
      "bot/*",
      "renovate/*",
      "a"
    ]);
    expect(cleanPatterns([])).toEqual([]);
  });
});

describe("matchesPattern", () => {
  it.each<[string, string, boolean]>([
    // `*` crosses `/`, as Git's --exclude does, and matches nothing as well.
    ["dependabot/*", "dependabot/npm/foo", true],
    ["dependabot/*", "dependabot/", true],
    ["dependabot/*", "dependabot", false],
    ["dependabot/*", "a/dependabot/npm", false],
    ["*bot*", "a/dependabot/y", true],
    ["*", "anything/at/all", true],
    ["**/fix", "team/a/fix", true],
    // The whole name must match, and case counts.
    ["main", "main", true],
    ["main", "mainline", false],
    ["Main", "main", false],
    // `?` is one character, `/` included.
    ["v?", "v1", true],
    ["v?", "v12", false],
    ["a?b", "a/b", true],
    // Sets, negated sets, ranges and classes.
    ["[cd]ependabot*", "dependabot/x", true],
    ["[!d]*", "dependabot/x", false],
    ["[^d]*", "feature", true],
    ["release-[0-9]*", "release-2/x", true],
    ["release-[0-9]*", "release-x", false],
    ["[]]x", "]x", true],
    ["[a-]x", "-x", true],
    ["v[[:digit:]]", "v7", true],
    ["v[[:digit:]]", "vx", false],
    ["[[:upper:]]*", "WIP", true],
    // A backward range matches nothing, but the rest of the set still counts.
    ["[z-ab]", "b", true],
    ["[z-a]", "m", false],
    // `\` takes the next character literally.
    ["wip\\*", "wip*", true],
    ["wip\\*", "wip-1", false],
    ["a\\?", "a?", true],
    // Characters special to regular expressions are plain here.
    ["fix.(1)+", "fix.(1)+", true],
    ["fix.(1)+", "fixx(1)", false],
    ["a$|b", "a$|b", true],
    // What Git cannot read matches nothing.
    ["[abc", "[abc", false],
    ["a\\", "a\\", false],
    ["[[:nope:]]", "n", false]
  ])("%s against %s: %s", (pattern, name, expected) => {
    expect(matchesPattern(pattern, name)).toBe(expected);
  });
});

describe("patternMatcher", () => {
  it("is null without a pattern that takes part", () => {
    expect(patternMatcher([])).toBeNull();
    expect(patternMatcher(["", "  "])).toBeNull();
  });

  it("matches a name that any pattern matches", () => {
    const matches = patternMatcher(["bot/*", " renovate/* "])!;
    expect(matches("bot/a")).toBe(true);
    expect(matches("renovate/b")).toBe(true);
    expect(matches("feature")).toBe(false);
  });
});

describe("matchesRemoteBranch", () => {
  const matches = patternMatcher(["dependabot/*"])!;

  it("matches the name after the remote, never the remote's own part", () => {
    expect(matchesRemoteBranch("origin/dependabot/npm/foo", ["origin"], matches)).toBe(true);
    expect(matchesRemoteBranch("origin/feature", ["origin"], matches)).toBe(false);
    expect(matchesRemoteBranch("dependabot/x", ["origin"], matches)).toBe(false);
    expect(matchesRemoteBranch("origin/dependabot/x", [], matches)).toBe(false);
  });

  it("tries each remote the name starts with, including remotes with slashes", () => {
    const nested = ["team", "team/upstream"];
    expect(matchesRemoteBranch("team/upstream/dependabot/x", nested, matches)).toBe(true);
    expect(matchesRemoteBranch("team/dependabot/x", nested, matches)).toBe(true);
    expect(matchesRemoteBranch("teams/dependabot/x", nested, matches)).toBe(false);
  });
});

describe("suggestedPattern", () => {
  it.each([
    ["dependabot/npm/foo", "dependabot/*"],
    ["renovate/lodash", "renovate/*"],
    ["feature", "feature"],
    ["/odd", "/odd"],
    ["wip*/x", "wip\\*/*"],
    ["v[1]", "v\\[1]"]
  ])("offers %s as %s", (name, pattern) => {
    expect(suggestedPattern(name)).toBe(pattern);
    // Whatever it offers hides the branch it was offered for.
    expect(matchesPattern(pattern, name)).toBe(true);
  });
});

describe("agreement with Git", () => {
  const names = [
    "dependabot/npm/foo",
    "dependabot-x",
    "a/dependabot/y",
    "bot/q",
    "release-2",
    "release-x",
    "Wip",
    "v1",
    "v12",
    "fix.1",
    "fixx1",
    "x-y"
  ];
  const patterns = [
    "dependabot/*",
    "*bot*",
    "?ependabot*",
    "[cd]ependabot*",
    "[!d]*",
    "release-[0-9]*",
    "[[:upper:]]*",
    "v?",
    "fix.1",
    "[a-]*",
    "*/*/*",
    "[z-ab]*",
    "[abc"
  ];
  let repo = "";

  beforeAll(() => {
    repo = makeRepo();
    for (const name of names) {
      git(["branch", "--", name], repo);
    }
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it.each(patterns)("hides the branches Git leaves out for --exclude=%s", (pattern) => {
    const all = gitOutput(["for-each-ref", "--format=%(refname)", "refs/heads/"], repo).split("\n");
    const listed = new Set(
      gitOutput(["rev-parse", "--symbolic-full-name", `--exclude=${pattern}`, "--branches"], repo)
        .split("\n")
        .filter(Boolean)
    );
    const excludedByGit = all
      .filter((ref) => !listed.has(ref))
      .map((ref) => ref.slice("refs/heads/".length));
    const excludedHere = [...names, "main"].filter((name) => matchesPattern(pattern, name));
    expect(excludedHere.toSorted()).toEqual(excludedByGit.toSorted());
  });
});
