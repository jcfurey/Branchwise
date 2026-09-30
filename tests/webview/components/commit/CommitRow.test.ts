// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { CommitRow } from "@/webview/components/commit/CommitRow";
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
  "copyCommitHash"
];

let body: HTMLTableSectionElement;

function draw(commit: GitCommitNode, headBranch: string | null = null) {
  render(
    h(CommitRow, {
      commit,
      isHead: headBranch !== null,
      headBranch,
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
