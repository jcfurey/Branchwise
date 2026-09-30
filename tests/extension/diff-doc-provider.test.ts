import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeEach, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { normalizeRepoPath } from "@/backend/utils/repoPath";
import {
  DiffDocProvider,
  encodeDiffBlobUri,
  encodeDiffDocUri
} from "@/old-extension/diffDocProvider";

import { git, makeRepo } from "@tests/backend/helpers";

vi.mock("vscode", () => {
  class Uri {
    scheme: string;
    path: string;
    query: string;
    constructor(parts: { scheme: string; path: string; query?: string }) {
      this.scheme = parts.scheme;
      this.path = parts.path;
      this.query = parts.query ?? "";
    }
    static from(parts: { scheme: string; path: string; query?: string }) {
      return new Uri(parts);
    }
    with(change: { query?: string }) {
      return new Uri({ ...this, query: change.query ?? this.query });
    }
    toString() {
      return `${this.scheme}:${this.path}?${this.query}`;
    }
  }
  return {
    Uri,
    EventEmitter: class {
      event = () => ({ dispose: () => {} });
      dispose() {}
    },
    workspace: { onDidCloseTextDocument: () => ({ dispose: () => {} }) }
  };
});

const repo = makeRepo();
const other = makeRepo();
const head = createGit(repo, "git").revparse(["HEAD"]);
const victim = path.join(repo, "victim.txt");
const opened: string[] = [];

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

beforeEach(() => {
  opened.length = 0;
  fs.writeFileSync(victim, "keep");
});

function provider(saved: (repo: string) => boolean = () => false) {
  return new DiffDocProvider((dir) => {
    opened.push(dir);
    return createGit(dir, "git");
  }, saved);
}

function uri(query: string, file = "f") {
  return { scheme: DiffDocProvider.scheme, path: file, query, toString: () => query } as never;
}

it("shows files at a commit, its parent, and blob IDs", async () => {
  fs.writeFileSync(path.join(repo, "f"), "second");
  git(["commit", "-am", "second"], repo);
  const commit = (await createGit(repo, "git").revparse(["HEAD"])).trim();
  const blob = (await createGit(repo, "git").revparse([`${commit}:f`])).trim();
  const docs = provider();

  expect(await docs.provideTextDocumentContent(encodeDiffDocUri(repo, "f", commit))).toBe("second");
  expect(await docs.provideTextDocumentContent(encodeDiffDocUri(repo, "f", commit + "^"))).toBe(
    "x"
  );
  expect(await docs.provideTextDocumentContent(encodeDiffBlobUri(repo, "f", blob))).toBe("second");
});

it("shows an empty document for the empty object without running Git", async () => {
  const docs = provider();
  expect(await docs.provideTextDocumentContent(encodeDiffDocUri(repo, "f", "0".repeat(40)))).toBe(
    ""
  );
  expect(await docs.provideTextDocumentContent(encodeDiffBlobUri(repo, "f", null))).toBe("");
  expect(opened).toEqual([]);
});

it.each([
  ["--output", `commit=${encodeURIComponent(`--output=${victim}`)}`],
  ["-O", `commit=${encodeURIComponent(`-O${victim}`)}`],
  ["--ext-diff", "commit=--ext-diff"],
  ["a symbolic ref", "commit=HEAD"],
  ["an abbreviated hash", "commit=abc1234"],
  ["a blob with a parent suffix", `commit=${"a".repeat(40)}^&blob=1`]
])("rejects %s without running Git", async (_name, commit) => {
  const content = await provider(() => true).provideTextDocumentContent(
    uri(`${commit}&repo=${encodeURIComponent(repo)}`)
  );
  expect(content).toBe("");
  expect(opened).toEqual([]);
  expect(fs.readFileSync(victim, "utf8")).toBe("keep");
});

it("rejects relative and unknown repositories without running Git", async () => {
  const commit = (await head).trim();
  const relative = path.relative(process.cwd(), other);
  const docs = provider((dir) => dir === relative || dir === ".");

  const contents = await Promise.all(
    [relative, ".", other].map((dir) =>
      docs.provideTextDocumentContent(uri(`commit=${commit}&repo=${encodeURIComponent(dir)}`))
    )
  );
  expect(contents).toEqual(["", "", ""]);
  expect(opened).toEqual([]);
});

it("reopens documents for repositories with saved state", async () => {
  const commit = (await createGit(other, "git").revparse(["HEAD"])).trim();
  // Saved state is keyed by normalized paths, as the repository manager stores them.
  const content = await provider(
    (dir) => dir === normalizeRepoPath(other)
  ).provideTextDocumentContent(uri(`commit=${commit}&repo=${encodeURIComponent(other)}`));
  expect(content).toBe("x");
});

it("returns an empty document for a malformed escape", async () => {
  const content = await provider(() => true).provideTextDocumentContent(
    uri(`commit=%E0%A4%A&repo=${encodeURIComponent(repo)}`)
  );
  expect(content).toBe("");
  expect(opened).toEqual([]);
});
