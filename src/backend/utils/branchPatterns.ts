// Hiding branches by name. A pattern is a glob as `git log --exclude` reads it: Git's wildmatch
// without its path mode. `*` matches any run of characters, `/` included, `?` any one character,
// `[...]` one character of a set (`[!...]` or `[^...]` one outside it, with ranges such as `a-z`
// and classes such as `[:digit:]`), and `\` takes the next character literally. A pattern covers
// the whole name and is case-sensitive. The graph hands the patterns to Git itself, so the page
// and the extension match names here the same way Git does, apart from `?` and sets, which take
// one UTF-16 unit where Git takes one byte.

/** The patterns that take part: trimmed, without blank lines or repeats, in the order given. */
export function cleanPatterns(patterns: ReadonlyArray<string>): string[] {
  return [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
}

/** Characters with a meaning of their own in a regular expression, outside a set. */
const SPECIAL = /[$()*+.?[\\\]^{|}/]/g;

/** Characters with a meaning of their own inside a regular expression set. */
const SET_SPECIAL = /[\\\]^[-]/g;

/** wildmatch's character classes, which it reads in the C locale. */
const CLASSES: Record<string, string> = {
  alnum: "a-zA-Z0-9",
  alpha: "a-zA-Z",
  blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f",
  digit: "0-9",
  graph: "\\x21-\\x7e",
  lower: "a-z",
  print: "\\x20-\\x7e",
  punct: "!-\\/:-@\\[-`{-~",
  space: " \\t\\n\\r\\f\\v",
  upper: "A-Z",
  xdigit: "0-9A-Fa-f"
};

/** Matches nothing: what wildmatch gives a pattern it cannot read. */
const NOTHING = "(?!)";

/**
 * The set that starts at `pattern[start]`, an opening `[`, as a regular expression, and the index
 * after its closing `]`; `null` when the set never closes or names an unknown class.
 */
function readSet(pattern: string, start: number): { source: string; end: number } | null {
  let at = start + 1;
  const negated = pattern[at] === "!" || pattern[at] === "^";
  if (negated) {
    at++;
  }
  let body = "";
  // A `]` straight after the opening belongs to the set.
  let first = true;
  while (at < pattern.length) {
    let char = pattern[at]!;
    if (char === "]" && !first) {
      return { source: `[${negated ? "^" : ""}${body}]`, end: at + 1 };
    }
    first = false;
    if (char === "[" && pattern[at + 1] === ":") {
      const close = pattern.indexOf(":]", at + 2);
      const name = close < 0 ? undefined : CLASSES[pattern.slice(at + 2, close)];
      if (name === undefined) {
        return null;
      }
      body += name;
      at = close + 2;
      continue;
    }
    if (char === "\\") {
      at++;
      if (at >= pattern.length) {
        return null;
      }
      char = pattern[at]!;
    }
    // A range runs to the next character unless the set closes first.
    if (pattern[at + 1] === "-" && at + 2 < pattern.length && pattern[at + 2] !== "]") {
      let last = pattern[at + 2]!;
      at += 3;
      if (last === "\\") {
        if (at >= pattern.length) {
          return null;
        }
        last = pattern[at++]!;
      }
      // Git skips a range that runs backwards; a regular expression would refuse it.
      if (char <= last) {
        body += `${char.replace(SET_SPECIAL, "\\$&")}-${last.replace(SET_SPECIAL, "\\$&")}`;
      }
      continue;
    }
    body += char.replace(SET_SPECIAL, "\\$&");
    at++;
  }
  return null;
}

/** One pattern as the source of a regular expression that matches whole names. */
function patternSource(pattern: string): string {
  let source = "";
  for (let at = 0; at < pattern.length;) {
    const char = pattern[at]!;
    if (char === "*") {
      source += "[\\s\\S]*";
      while (pattern[at] === "*") {
        at++;
      }
    } else if (char === "?") {
      source += "[\\s\\S]";
      at++;
    } else if (char === "[") {
      const set = readSet(pattern, at);
      if (set === null) {
        return NOTHING;
      }
      source += set.source;
      at = set.end;
    } else if (char === "\\") {
      // A lone `\` at the end escapes nothing, and Git then matches nothing.
      if (at + 1 >= pattern.length) {
        return NOTHING;
      }
      source += pattern[at + 1]!.replace(SPECIAL, "\\$&");
      at += 2;
    } else {
      source += char.replace(SPECIAL, "\\$&");
      at++;
    }
  }
  return `^${source}$`;
}

/** Whether `name` matches the one pattern. */
export function matchesPattern(pattern: string, name: string): boolean {
  return new RegExp(patternSource(pattern)).test(name);
}

/** A test for any of `patterns`, or `null` when none takes part. */
export function patternMatcher(
  patterns: ReadonlyArray<string>
): ((name: string) => boolean) | null {
  const clean = cleanPatterns(patterns);
  if (clean.length === 0) {
    return null;
  }
  const expressions = clean.map((pattern) => new RegExp(patternSource(pattern)));
  return (name) => expressions.some((expression) => expression.test(name));
}

/**
 * Whether a remote-tracking branch, named as `origin/topic`, matches: its name after any of
 * `remotes` that it starts with is tested. Git is given one exclusion per remote and pattern, so
 * with remotes nested in each other, such as `team` and `team/upstream`, either remote's part of
 * the name may match.
 */
export function matchesRemoteBranch(
  name: string,
  remotes: Iterable<string>,
  matches: (name: string) => boolean
): boolean {
  for (const remote of remotes) {
    if (name.startsWith(remote + "/") && matches(name.slice(remote.length + 1))) {
      return true;
    }
  }
  return false;
}

/**
 * The pattern offered for hiding branches like `name`: its first path segment and `/*`, so that
 * `dependabot/npm/foo` gives `dependabot/*`, or the name itself, taken literally, when it has no
 * slash.
 */
export function suggestedPattern(name: string): string {
  const slash = name.indexOf("/");
  const stem = slash > 0 ? name.slice(0, slash) : name;
  const literal = stem.replace(/[\\*?[]/g, "\\$&");
  return slash > 0 ? `${literal}/*` : literal;
}
