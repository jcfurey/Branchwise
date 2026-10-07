// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { CommitRow, type PushState, shownRefs } from "@/webview/components/commit/CommitRow";
import { conflictsByBranch } from "@/webview/lib/conflict-forecast";
import { contextMenu } from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

const HASH = "9f8e7d6c5b4a";
const BRANCH = "improve/the-rather-long-name-of-this-branch";

function commitWith(message: string, refs: Array<GitRef>): GitCommitNode {
  return {
    hash: HASH,
    parentHashes: [],
    author: "Dana Reviewer",
    email: "dana@example.org",
    date: 0,
    message,
    refs
  };
}

/** A commit with one local branch that is not checked out. */
const LABELLED = commitWith("Explain the retry limits in the guide", [
  { type: "head", name: BRANCH, hash: HASH }
]);
/** A commit with no branch or tag. */
const BARE = commitWith("Drop the unused helper", []);

/** The titles of the commit menu, with `null` for each separator. */
const COMMIT_MENU = [
  "addTag…",
  "createBranch…",
  null,
  "checkout…",
  "cherryPick…",
  "revert…",
  null,
  "merge…",
  "reset…",
  null,
  "interactiveRebase…",
  "createFixupMenu…",
  "compareWith",
  "bisectChooseGood",
  "bisectChooseBad",
  "copyCommitHash",
  "copyShortCommitHash"
];

let body: HTMLTableSectionElement;

function draw(commit: GitCommitNode, headBranch: string | null = null, push?: PushState) {
  render(
    h(CommitRow, {
      commit,
      isHead: headBranch !== null,
      headBranch,
      push,
      messages: new Map(),
      colour: undefined,
      expanded: false,
      onSelect: undefined
    }),
    body
  );
}

/** The outermost `<span>` of the row whose whole text is `text`. */
function spanWithText(text: string) {
  const span = [...body.querySelectorAll("span")].find((element) => element.textContent === text);
  expect(span, `a span reading ${text}`).toBeDefined();
  return span!;
}

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  body = document.createElement("tbody");
});

afterEach(() => {
  render(null, body);
  body.remove();
  contextMenu.value = null;
});

describe("the description cell", () => {
  it("keeps the labels to half its width, ahead of a message that fills the rest", () => {
    draw(LABELLED);
    const labels = spanWithText(BRANCH);
    const message = spanWithText(LABELLED.message);
    const cell = message.closest("td")!;

    expect(cell.querySelector("span")).toBe(labels);
    expect(labels.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(labels.classList.contains("max-w-1/2")).toBe(true);
    // No repository state and not checked out: the label's tooltip is the name alone.
    expect(labels.querySelector("[title]")?.getAttribute("title")).toBe(BRANCH);

    expect(message.classList.contains("flex-1")).toBe(true);
    expect(message.getAttribute("title")).toBe(LABELLED.message);
    expect(message.textContent).toBe(LABELLED.message);
  });

  it("leads with the checked-out branch, whose label says that it is current", () => {
    const head = commitWith("Publish the release notes", [
      { type: "tag", name: "v1.4", hash: HASH },
      { type: "head", name: "trunk", hash: HASH }
    ]);
    draw(head, "trunk");
    const cell = spanWithText(head.message).closest("td")!;
    const tooltips = [...cell.querySelectorAll("[title]")].map((element) =>
      element.getAttribute("title")
    );
    expect(tooltips).toEqual(["trunk\ntooltipCurrentBranch", "v1.4", head.message]);
  });

  it("has no label region when the commit has no refs: the message comes first", () => {
    draw(BARE);
    const message = spanWithText(BARE.message);
    expect(message.closest("td")!.querySelector("span")).toBe(message);
    expect(message.getAttribute("title")).toBe(BARE.message);
  });
});

describe("the push status", () => {
  it("marks a commit not pushed with a filled dot and one not pulled with a ring, by name", () => {
    draw(LABELLED);
    expect(body.querySelector("[data-push]")).toBeNull();

    draw(LABELLED, null, "unpushed");
    const dot = body.querySelector<HTMLElement>("[data-push]")!;
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("aria-label")).toBe("commitUnpushed");
    expect(dot.title).toBe("commitUnpushed");
    expect(dot.classList.contains("bg-git-modified")).toBe(true);
    // The dot leads the cell, ahead of the labels.
    expect(
      dot.compareDocumentPosition(spanWithText(BRANCH)) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);

    draw(LABELLED, null, "unpulled");
    const ring = body.querySelector<HTMLElement>("[data-push]")!;
    expect(ring.getAttribute("aria-label")).toBe("commitUnpulled");
    expect(ring.classList.contains("border-git-added")).toBe(true);
    expect(ring.classList.contains("bg-git-modified")).toBe(false);
  });
});

describe("the conflict forecast", () => {
  /** A forecast entry for a local branch, or a remote one when `branch` names its remote. */
  const conflictOf = (branch: string, files: Array<string>, remote = false) => ({
    branch,
    remote,
    files,
    committer: "Alice",
    date: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60
  });
  let keyNames: typeof window.l10n;
  beforeAll(() => {
    keyNames = window.l10n;
  });
  /** Show these English templates; every other string stays its key name. */
  const withStrings = (strings: Partial<Record<keyof typeof window.l10n, string>>) =>
    Object.defineProperty(window, "l10n", {
      value: new Proxy(keyNames, {
        get: (target, key) =>
          (strings as Record<string | symbol, string | undefined>)[key] ?? Reflect.get(target, key)
      }),
      configurable: true
    });
  afterEach(() => Object.defineProperty(window, "l10n", { value: keyNames, configurable: true }));
  /** The forecast keyed as the table keys it. */
  const forecastOf = (...entries: Array<ReturnType<typeof conflictOf>>) =>
    conflictsByBranch(entries);
  const drawWith = (commit: GitCommitNode, conflicts: ReturnType<typeof forecastOf>) =>
    render(
      h(CommitRow, {
        commit,
        isHead: false,
        headBranch: null,
        conflicts,
        messages: new Map(),
        colour: undefined,
        expanded: false,
        onSelect: undefined
      }),
      body
    );

  it("marks a local branch that would conflict, with the number of files and their names", () => {
    drawWith(LABELLED, forecastOf(conflictOf("other", ["a"])));
    expect(body.querySelector("[data-conflicts]")).toBeNull();

    const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`);
    drawWith(LABELLED, forecastOf(conflictOf(BRANCH, files)));
    const badge = body.querySelector<HTMLElement>("[data-conflicts]")!;
    expect(badge.textContent).toBe("12");
    expect(badge.getAttribute("role")).toBe("img");
    expect(badge.getAttribute("aria-label")).toBe("conflictForecast");
    // Ten files by name, then a count of the rest.
    expect(badge.title.split("\n")).toEqual([
      "conflictForecast",
      ...files.slice(0, 10),
      "conflictForecastMore"
    ]);
    expect(badge.classList.contains("text-git-conflict")).toBe(true);
  });

  it("leaves tags and remote branches of the same name alone", () => {
    const refs: Array<GitRef> = [
      { type: "tag", name: "v1", hash: HASH },
      { type: "remote", name: "origin/v1", hash: HASH }
    ];
    drawWith(commitWith("Tagged", refs), forecastOf(conflictOf("v1", ["a"])));
    expect(body.querySelector("[data-conflicts]")).toBeNull();
    // A local branch named like the remote one does not mark it either.
    drawWith(commitWith("Tagged", refs), forecastOf(conflictOf("origin/v1", ["a"])));
    expect(body.querySelector("[data-conflicts]")).toBeNull();
  });

  it("marks a teammate's remote branch, and says whose work it is and how recent", () => {
    const refs: Array<GitRef> = [{ type: "remote", name: "origin/alice/payments", hash: HASH }];
    withStrings({
      teamConflictForecast: "Would conflict with your branch {0} in:",
      lastCommitBy: "Last commit by {0}, {1}"
    });
    drawWith(
      commitWith("Payments", refs),
      forecastOf(conflictOf("origin/alice/payments", ["api.ts", "db.ts", "ui.ts"], true))
    );
    const badge = body.querySelector<HTMLElement>("[data-conflicts]")!;
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-label")).toBe("Would conflict with your branch HEAD in:");
    expect(badge.title.split("\n")).toEqual([
      "Would conflict with your branch HEAD in:",
      "api.ts",
      "db.ts",
      "ui.ts",
      "Last commit by Alice, 2 days ago"
    ]);
  });
});

describe("the actions button", () => {
  it("is named for the commit's actions and opens the commit menu for the row", () => {
    document.body.append(body);
    contextMenu.value = null;
    draw(BARE);

    const button = body.querySelector<HTMLButtonElement>("button[aria-haspopup]");
    expect(button?.getAttribute("aria-label")).toBe("commitActions");

    button!.click();
    const menu = contextMenu.peek();
    expect(menu?.source).toBe(`commit:${HASH}`);
    expect(menu?.entries.map((entry) => (entry === null ? null : entry.title))).toEqual(
      COMMIT_MENU
    );
  });
});

describe("busy rows", () => {
  const ref = (type: GitRef["type"], name: string): GitRef => ({ type, name, hash: HASH });

  it("joins a remote branch to the local branch of the same name", () => {
    expect(
      shownRefs(
        [
          ref("remote", "origin/main"),
          ref("tag", "v1"),
          ref("head", "main"),
          ref("remote", "fork/main"),
          ref("remote", "origin/HEAD"),
          ref("remote", "origin/other")
        ],
        null
      ).map(({ ref: shown, remotes }) => [shown.name, remotes.map((remote) => remote.name)])
    ).toEqual([
      ["v1", []],
      // A remote's HEAD only names its default branch, so it joins the first branch label.
      ["main", ["origin/main", "fork/main", "origin/HEAD"]],
      ["origin/other", []]
    ]);
    // With no branch on the commit, it keeps a label of its own.
    expect(
      shownRefs([ref("tag", "v1"), ref("remote", "origin/HEAD")], null).map(
        ({ ref: shown }) => shown.name
      )
    ).toEqual(["v1", "origin/HEAD"]);
  });

  it("shows the first label and folds the rest into a +N button whose menu reaches each", () => {
    draw(
      commitWith("Busy", [
        ref("head", "main"),
        ref("remote", "origin/main"),
        ref("head", "feature"),
        ref("tag", "v2"),
        ref("tag", "v2.1")
      ]),
      "main"
    );
    const more = body.querySelector<HTMLButtonElement>("[data-more-refs]")!;
    expect(more.textContent).toBe("+3");
    expect(more.title).toBe("feature\nv2\nv2.1");
    expect(spanWithText("main")).toBeDefined();
    expect(body.querySelector("[data-remote-refs]")?.getAttribute("data-remote-refs")).toBe(
      "origin/main"
    );

    act(() => more.click());
    expect(contextMenu.value?.entries.map((entry) => entry?.title)).toEqual([
      "feature",
      "v2",
      "v2.1"
    ]);
    act(() => contextMenu.value!.entries[1]!.onClick());
    expect(contextMenu.value?.source).toBe("ref:tag:v2");
  });

  it("shows two labels in full without a +N button", () => {
    draw(commitWith("Pair", [ref("head", "main"), ref("tag", "v2")]), "main");
    expect(body.querySelector("[data-more-refs]")).toBeNull();
    expect(spanWithText("v2")).toBeDefined();
  });
});
