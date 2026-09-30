import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadHistory, loadRestorePlan, sourceFile } from "@/backend/queries/history";
import type { HistoryFilter } from "@/backend/types";

import { freshRepo, git, gitOutput, makeRepo } from "@tests/backend/helpers";

/** No search text, dates, author or revision: every branch, as the history view starts. */
const ANY: HistoryFilter = {
  text: "",
  author: "",
  since: "",
  until: "",
  path: "",
  revision: "",
  follow: false
};

/** Names that Windows file systems cannot hold. */
const POSIX_ONLY = ["tab\tname", 'quote"name', "new\nline", "back\\slash", "0:foo"];
const ADDED = ["中文.txt", "café.md", ...(process.platform === "win32" ? [] : POSIX_ONLY)];
const MOVED = "目录/新.txt";
const PATHS = [...ADDED, MOVED];

const contentOf = (file: string) => (file === MOVED ? "moved\n" : "one\ntwo\n");

/**
 * Only read: `before` adds `old.txt`; the commit after it adds `one`, `two` under each name that
 * Git's default output quotes or escapes, and moves `old.txt` to `目录/新.txt`. `0:foo` holds the
 * colon of Git's `<revision>:<path>` notation.
 */
describe("paths that Git quotes or escapes", () => {
  let repo = "";
  const ids = { before: "", names: "" };

  beforeAll(() => {
    repo = makeRepo();
    fs.writeFileSync(path.join(repo, "old.txt"), "moved\n");
    git(["add", "--", "old.txt"], repo);
    git(["commit", "-q", "-m", "before"], repo);
    ids.before = gitOutput(["rev-parse", "HEAD"], repo);
    for (const name of ADDED) {
      fs.writeFileSync(path.join(repo, name), "one\ntwo\n");
    }
    fs.mkdirSync(path.join(repo, "目录"));
    git(["mv", "old.txt", MOVED], repo);
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "hard names"], repo);
    ids.names = gitOutput(["rev-parse", "HEAD"], repo);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("address each file at the revision through the client's show", async () => {
    const client = createGit(repo, "git");
    const shown = await Promise.all(
      PATHS.map((file) => client.show(["--end-of-options", `${ids.names}:${file}`]))
    );
    expect(shown).toStrictEqual(PATHS.map(contentOf));
  });

  it("find each file's blob in the revision's tree", async () => {
    const client = createGit(repo, "git");
    const found = await Promise.all(PATHS.map((file) => sourceFile(client, ids.names, file)));
    expect(found).toStrictEqual(
      PATHS.map((file) => ({
        hash: ids.names,
        mode: "100644",
        blob: gitOutput(["hash-object", "--", file], repo)
      }))
    );
  });

  it("find the revision in each file's history, and nothing else", async () => {
    const client = createGit(repo, "git");
    const pages = await Promise.all(
      PATHS.map((file) => loadHistory(client, { ...ANY, path: file }, 0))
    );
    const page = {
      entries: [
        {
          hash: ids.names,
          parentHashes: [ids.before],
          author: "T",
          email: "t@t.com",
          date: expect.any(Number),
          message: "hard names",
          refs: []
        }
      ],
      more: false
    };
    expect(pages).toStrictEqual(PATHS.map(() => page));
  });

  it("plan each file's restore onto the same path, which has no local changes", async () => {
    const client = createGit(repo, "git");
    const plans = await Promise.all(
      PATHS.map((file) => loadRestorePlan(client, ids.names, file, file))
    );
    expect(plans).toStrictEqual(
      PATHS.map((file) => ({
        source: ids.names,
        sourcePath: file,
        destination: file,
        snapshot: expect.stringMatching(/^[0-9a-f]{64}$/),
        dirty: false
      }))
    );
  });
});

describe("a restore plan", () => {
  const repo = freshRepo();

  it("marks a destination with local changes as dirty", async () => {
    const client = createGit(repo(), "git");
    const clean = await loadRestorePlan(client, "HEAD", "f", "f");
    fs.writeFileSync(path.join(repo(), "f"), "edited");
    const edited = await loadRestorePlan(client, "HEAD", "f", "f");
    expect([clean.dirty, edited.dirty]).toStrictEqual([false, true]);
    expect(edited.snapshot).not.toBe(clean.snapshot);
  });
});
