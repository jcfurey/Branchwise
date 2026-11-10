import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadHistory } from "@/backend/queries/history";
import { lineChanges } from "@/backend/queries/lineHistory";
import type { HistoryFilter } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

// Text a person searches for, and the names of their files, can hold the names of Git options.
// Each is given to Git where it cannot be read as one; nothing before Git may read it so either.

const ANY: HistoryFilter = {
  text: "",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false
};
/** A file whose name holds an option's, in a folder, as documentation of that option might. */
const FILE = "docs/--template.md";

let repo = "";
let added = "";
let edited = "";
const client = () => createGit(repo, "git");
const found = async (filter: Partial<HistoryFilter>) =>
  (await loadHistory(client(), { ...ANY, ...filter }, 0)).entries.map((entry) => entry.hash);

beforeAll(() => {
  repo = makeRepo();
  fs.mkdirSync(path.join(repo, "docs"));
  fs.writeFileSync(path.join(repo, FILE), "git init --template=x\ngit fetch --upload-pack=y\n");
  git(["add", "--", FILE], repo);
  git(["commit", "-q", "-m", "document two options"], repo);
  added = gitOutput(["rev-parse", "HEAD"], repo);
  fs.writeFileSync(path.join(repo, FILE), "git init --template=x\ngit push --receive-pack=z\n");
  git(["commit", "-q", "-am", "document another"], repo);
  edited = gitOutput(["rev-parse", "HEAD"], repo);
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe("a search for changes to text that names a Git option", () => {
  it.each([
    ["--template", () => [added]],
    ["--upload-pack", () => [edited, added]],
    ["--receive-pack", () => [edited]]
  ])("finds the commits that added or removed %s", async (changes, commits) => {
    expect(await found({ changes })).toEqual(commits());
  });

  it("matches it as an expression too", async () => {
    expect(await found({ changes: "--(upload|receive)-pack", regex: true })).toEqual([
      edited,
      added
    ]);
  });
});

it("reports what Git said when a search fails, without the commits printed before", async () => {
  // An expression Git cannot compile fails the search; nothing but the reason is passed on.
  const failure = await loadHistory(client(), { ...ANY, changes: "(", regex: true }, 0).then(
    () => null,
    (error: unknown) => String(error)
  );
  expect(failure).not.toBeNull();
  expect(failure).not.toContain(added);
  expect(failure).not.toContain(edited);
});

describe("a file whose name holds a Git option's", () => {
  it("has a history, with and without following renames", async () => {
    expect(await found({ path: FILE })).toEqual([edited, added]);
    expect(await found({ path: FILE, follow: true })).toEqual([edited, added]);
  });

  it("has a history of its lines, and shows what a commit changed in them", async () => {
    expect(await found({ path: FILE, lines: "2,2" })).toEqual([edited, added]);
    const patch = await lineChanges(client(), edited, FILE, { start: 2, end: 2 });
    expect(patch).toContain("-git fetch --upload-pack=y");
    expect(patch).toContain("+git push --receive-pack=z");
  });
});
