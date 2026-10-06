// @vitest-environment jsdom
import { h, render } from "preact";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ConflictForecastEntry,
  GitCommitNode,
  GitRef,
  RepositoryState
} from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import { repositoryState } from "@/webview/lib/repository-actions";
import { uncommittedChanges } from "@/webview/lib/stores";
import { commitRowLabel, describeCommitRow, type RowFacts } from "@/webview/utils/rowDescription";

import { setupWebviewTest } from "@tests/webview/test-utils";

/** English text for the strings the summary reads, with every other key naming itself. */
const ENGLISH: Record<string, string> = {
  rowHead: "checked out",
  rowMergeOf: "merge of {0} parents",
  rowUnpushed: "unpushed",
  rowUnpulled: "unpulled",
  rowConflictsWith: "has conflicts with {0}",
  rowBranch: "branch {0}",
  rowRemote: "remote branch {0}",
  rowTag: "tag {0}",
  uncommittedChanges: "Uncommitted changes in {0} files"
};

/** The clock of the tests: 2023-11-14 22:13:20 UTC. */
const NOW_SECONDS = 1_700_000_000;
const THREE_DAYS = 3 * 86_400;

const PLAIN: RowFacts = {
  subject: "Fix the parser",
  author: "Ann Lee",
  age: "3 days ago",
  parents: 1,
  isHead: false,
  push: undefined,
  conflictsWith: null,
  refs: []
};

const ref = (type: GitRef["type"], name: string): GitRef => ({ type, name, hash: "c" });

/** A conflict forecast from `[key, files]` pairs, keyed as the commit table keys it. */
const forecast = (...entries: Array<[string, Array<string>]>) =>
  new Map<string, ConflictForecastEntry>(
    entries.map(([key, files]) => [
      key,
      {
        branch: key.replace(/^remotes\//, ""),
        remote: key.startsWith("remotes/"),
        files,
        committer: "Ann Lee",
        date: 0
      }
    ])
  );

function commit(overrides: Partial<GitCommitNode> = {}): GitCommitNode {
  return {
    hash: "c",
    parentHashes: ["p"],
    author: "Ann Lee",
    email: "ann@example.org",
    date: NOW_SECONDS - THREE_DAYS,
    message: "Fix the parser",
    refs: [],
    ...overrides
  };
}

let keyNames: LocalizedStrings;

beforeAll(() => {
  setupWebviewTest();
  keyNames = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keyNames, { get: (_target, key) => ENGLISH[String(key)] ?? String(key) }),
    configurable: true
  });
});

afterAll(() => Object.defineProperty(window, "l10n", { value: keyNames, configurable: true }));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW_SECONDS * 1000 });
});

afterEach(() => {
  vi.useRealTimers();
  repositoryState.value = null;
});

describe("describeCommitRow", () => {
  it("starts with the subject, author and age", () => {
    expect(describeCommitRow(PLAIN)).toBe("Fix the parser, Ann Lee, 3 days ago");
  });

  it("adds HEAD, the merge, the push state, the conflict and every label, in that order", () => {
    expect(
      describeCommitRow({
        ...PLAIN,
        isHead: true,
        parents: 2,
        push: "unpushed",
        conflictsWith: "main",
        refs: [ref("head", "main"), ref("remote", "origin/main"), ref("tag", "v1.0")]
      })
    ).toBe(
      "Fix the parser, Ann Lee, 3 days ago, checked out, merge of 2 parents, unpushed, has conflicts with main, branch main, remote branch origin/main, tag v1.0"
    );
    expect(describeCommitRow({ ...PLAIN, parents: 3, push: "unpulled" })).toBe(
      "Fix the parser, Ann Lee, 3 days ago, merge of 3 parents, unpulled"
    );
  });

  it("puts names in exactly as they are written", () => {
    expect(
      describeCommitRow({ ...PLAIN, conflictsWith: "a$&b", refs: [ref("tag", "v$1{0}")] })
    ).toBe("Fix the parser, Ann Lee, 3 days ago, has conflicts with a$&b, tag v$1{0}");
  });

  it("leaves out an empty subject or author rather than reading a lone comma", () => {
    expect(describeCommitRow({ ...PLAIN, subject: "", author: "" })).toBe("3 days ago");
  });
});

describe("commitRowLabel", () => {
  const label = (row: GitCommitNode, options: Partial<Parameters<typeof commitRowLabel>[0]> = {}) =>
    commitRowLabel({
      commit: row,
      message: row.message,
      isHead: false,
      headBranch: null,
      push: undefined,
      conflicts: undefined,
      ...options
    });

  it("reads the age relative to now, whatever the date setting shows", () => {
    expect(label(commit())).toBe("Fix the parser, Ann Lee, 3 days ago");
  });

  it("counts different parents only, so a parent named twice is no merge", () => {
    expect(label(commit({ parentHashes: ["a", "b"] }))).toContain("merge of 2 parents");
    expect(label(commit({ parentHashes: ["a", "a"] }))).not.toContain("merge");
    expect(label(commit({ parentHashes: [] }))).not.toContain("merge");
  });

  it("leads with the checked-out branch and leaves out a remote's HEAD", () => {
    const row = commit({
      refs: [ref("tag", "v1.0"), ref("remote", "origin/HEAD"), ref("head", "main")]
    });
    expect(label(row, { isHead: true, headBranch: "main" })).toBe(
      "Fix the parser, Ann Lee, 3 days ago, checked out, branch main, tag v1.0"
    );
  });

  it("names what a marked branch would conflict with, and only when the forecast marks one", () => {
    repositoryState.value = { head: "develop" } as RepositoryState;
    const row = commit({ refs: [ref("head", "topic"), ref("tag", "topic")] });
    expect(label(row, { conflicts: forecast(["topic", ["a.ts"]]) })).toBe(
      "Fix the parser, Ann Lee, 3 days ago, has conflicts with develop, branch topic, tag topic"
    );
    expect(label(row, { conflicts: forecast(["topic", []]) })).not.toContain("conflicts");
    expect(label(row, { conflicts: forecast(["other", ["a.ts"]]) })).not.toContain("conflicts");

    // A remote branch is forecast under `remotes/`; a tag never is.
    const remote = commit({ refs: [ref("remote", "origin/alice"), ref("tag", "v1")] });
    expect(label(remote, { conflicts: forecast(["remotes/origin/alice", ["a.ts"]]) })).toBe(
      "Fix the parser, Ann Lee, 3 days ago, has conflicts with develop, remote branch origin/alice, tag v1"
    );
    expect(label(remote, { conflicts: forecast(["v1", ["a.ts"]]) })).not.toContain("conflicts");

    // A detached HEAD has no branch to name.
    repositoryState.value = { head: "" } as RepositoryState;
    expect(label(row, { conflicts: forecast(["topic", ["a.ts"]]) })).toContain(
      "has conflicts with HEAD"
    );
  });

  it("reads the uncommitted changes as the row's own text", () => {
    expect(label(commit({ hash: "*" }), { message: "Uncommitted changes in 3 files" })).toBe(
      "Uncommitted changes in 3 files"
    );
  });
});

describe("the commit row", () => {
  let body: HTMLTableSectionElement;

  beforeEach(() => {
    body = document.createElement("tbody");
  });

  afterEach(() => render(null, body));

  const draw = (row: GitCommitNode, push?: "unpushed") =>
    render(
      h(CommitRow, {
        commit: row,
        isHead: false,
        headBranch: null,
        push,
        messages: new Map(),
        colour: undefined,
        expanded: false,
        onSelect: undefined
      }),
      body
    );

  it("carries its summary as its accessible name, and shows the same text as before", () => {
    draw(commit({ parentHashes: ["a", "b"], refs: [ref("head", "main")] }), "unpushed");
    const row = body.querySelector("tr")!;
    expect(row.getAttribute("aria-label")).toBe(
      "Fix the parser, Ann Lee, 3 days ago, merge of 2 parents, unpushed, branch main"
    );
    // Nothing visible changes: the cells hold what they held, and the summary is no text.
    expect(row.textContent).not.toContain("merge of");
    expect(row.textContent).toContain("Fix the parser");
  });

  it("names the uncommitted row by its text", () => {
    uncommittedChanges.value = 3;
    draw(commit({ hash: "*", parentHashes: ["c"] }));
    expect(body.querySelector("tr")!.getAttribute("aria-label")).toBe(
      "Uncommitted changes in 3 files"
    );
  });
});
