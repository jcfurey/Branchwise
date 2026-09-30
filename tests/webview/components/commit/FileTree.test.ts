// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { GitCommitDetails, GitFileChange } from "@/backend/types";
import { CommitDetails } from "@/webview/components/commit/CommitDetails";

import { setupWebviewTest } from "@tests/webview/test-utils";

const change = (path: string): GitFileChange => ({
  oldFilePath: path,
  newFilePath: path,
  type: "M",
  additions: 1,
  deletions: 0
});

/** A new details object for the same commit on every call, as a fresh reply would give. */
const details = (): GitCommitDetails => ({
  hash: "c".repeat(40),
  parents: [],
  author: "Author",
  email: "a@test",
  date: 0,
  committer: "Author",
  body: "Message",
  fileChanges: [change("src/a.ts"), change("src/b/c.ts")]
});

let rows: HTMLTableSectionElement;
const draw = (value: GitCommitDetails) =>
  act(() => render(h(CommitDetails, { details: value }), rows));

/** The label of each entry in the file tree, folders and files, in order. */
const labels = () =>
  Array.from(
    rows.querySelectorAll("li > button"),
    (button) => button.querySelector("span")?.textContent
  );
const folder = (name: string) =>
  Array.from(rows.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).find(
    (button) => button.textContent === name
  )!;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const table = document.createElement("table");
  rows = document.createElement("tbody");
  table.append(rows);
  document.body.append(table);
});
afterEach(() => {
  act(() => render(null, rows));
  rows.closest("table")?.remove();
  vi.restoreAllMocks();
});

it("hides a folder's files when the folder is closed", () => {
  draw(details());
  expect(labels()).toEqual(["src", "b", "c.ts", "a.ts"]);
  expect(folder("b").getAttribute("aria-expanded")).toBe("true");

  act(() => folder("b").click());

  expect(folder("b").getAttribute("aria-expanded")).toBe("false");
  expect(labels()).toEqual(["src", "b", "a.ts"]);
});

it("keeps a folder closed when the same commit's details arrive again", () => {
  draw(details());
  act(() => folder("b").click());

  draw(details());

  expect(folder("b").getAttribute("aria-expanded")).toBe("false");
  expect(folder("src").getAttribute("aria-expanded")).toBe("true");
  expect(labels()).toEqual(["src", "b", "a.ts"]);
});
