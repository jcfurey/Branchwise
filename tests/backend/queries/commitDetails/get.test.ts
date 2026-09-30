import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import type { DateType, GitFileChange } from "@/backend/types";

import { freshRepo, git, gitOutput, makeRepo } from "@tests/backend/helpers";

function details(repo: string, commitHash: string, dateType: DateType = "Author Date") {
  return commitDetails(createGit(repo, "git"), { commitHash, dateType });
}

function change(
  type: GitFileChange["type"],
  oldFilePath: string,
  newFilePath: string,
  additions: number | null,
  deletions: number | null
): GitFileChange {
  return { oldFilePath, newFilePath, type, additions, deletions };
}

const byNewPath = (a: GitFileChange, b: GitFileChange) =>
  a.newFilePath < b.newFilePath ? -1 : a.newFilePath > b.newFilePath ? 1 : 0;

const AUTHORED = 1_600_000_000;
const COMMITTED = 1_650_000_000;
const MESSAGE = "mod\n\nRewrites f in full.\nSecond line of the body.";

/**
 * Only read: `init` (from `makeRepo`), then `mod`, which rewrites `f` as `modified content`, with
 * a committer of its own and author and committer times that differ.
 */
describe("a root commit and a commit with a message body", () => {
  let repo = "";
  const ids = { init: "", mod: "" };

  beforeAll(() => {
    repo = makeRepo();
    ids.init = gitOutput(["rev-parse", "HEAD"], repo);
    fs.writeFileSync(path.join(repo, "f"), "modified content");
    git(["add", "-A"], repo);
    execFileSync("git", ["commit", "-q", "-F", "-"], {
      cwd: repo,
      input: MESSAGE,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_COMMITTER_NAME: "Committer",
        GIT_AUTHOR_DATE: `${AUTHORED} +0000`,
        GIT_COMMITTER_DATE: `${COMMITTED} +0000`
      }
    });
    ids.mod = gitOutput(["rev-parse", "HEAD"], repo);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("describes a root commit against the empty tree", async () => {
    const result = await details(repo, ids.init);
    expect(result).toStrictEqual({
      commitDetails: {
        hash: ids.init,
        parents: [],
        author: "T",
        email: "t@t.com",
        date: expect.any(Number),
        committer: "T",
        body: "init",
        fileChanges: [change("A", "f", "f", 1, 0)]
      }
    });
    expect(result.commitDetails!.date).toBeGreaterThan(0);
  });

  it.each([
    { dateType: "Author Date" as const, date: AUTHORED },
    { dateType: "Commit Date" as const, date: COMMITTED }
  ])("gives the whole message, and the time that $dateType names", async ({ dateType, date }) => {
    expect(await details(repo, ids.mod, dateType)).toStrictEqual({
      commitDetails: {
        hash: ids.mod,
        parents: [ids.init],
        author: "T",
        email: "t@t.com",
        date,
        committer: "Committer",
        body: MESSAGE,
        fileChanges: [change("M", "f", "f", 1, 1)]
      }
    });
  });

  it("resolves to null for an ID that names no object", async () => {
    await expect(details(repo, "deadbeef1234")).resolves.toStrictEqual({ commitDetails: null });
  });

  it("resolves to null for a range, which names more than one commit", async () => {
    await expect(details(repo, `${ids.init}..${ids.mod}`)).resolves.toStrictEqual({
      commitDetails: null
    });
  });
});

describe("a merge", () => {
  /** `side` adds the file `side`; `main` adds `main`; then `main` merges `side`. */
  const repo = freshRepo((dir) => {
    git(["checkout", "-q", "-b", "side"], dir);
    fs.writeFileSync(path.join(dir, "side"), "side\n");
    git(["add", "--", "side"], dir);
    git(["commit", "-q", "-m", "side"], dir);
    git(["checkout", "-q", "main"], dir);
    fs.writeFileSync(path.join(dir, "main"), "main\n");
    git(["add", "--", "main"], dir);
    git(["commit", "-q", "-m", "main"], dir);
    git(["merge", "-q", "--no-edit", "-m", "join side", "side"], dir);
  });

  it("lists what it brought in against its first parent, and an empty commit lists nothing", async () => {
    const [onMain, onSide] = [
      gitOutput(["rev-parse", "HEAD^1"], repo()),
      gitOutput(["rev-parse", "HEAD^2"], repo())
    ];
    const merge = await details(repo(), "HEAD");
    expect(merge.commitDetails).toMatchObject({
      hash: gitOutput(["rev-parse", "HEAD"], repo()),
      parents: [onMain, onSide],
      body: "join side"
    });
    expect(merge.commitDetails!.fileChanges).toStrictEqual([change("A", "side", "side", 1, 0)]);

    git(["commit", "-q", "--allow-empty", "-m", "empty"], repo());
    const empty = await details(repo(), "HEAD");
    expect(empty.commitDetails).toMatchObject({
      parents: [merge.commitDetails!.hash],
      body: "empty"
    });
    expect(empty.commitDetails!.fileChanges).toStrictEqual([]);
  });
});

/** Names that Windows file systems cannot hold. */
const POSIX_ONLY = ["tab\tname", 'quote"name', "new\nline", "back\\slash", "0:foo"];

describe("file names that Git quotes or escapes", () => {
  const textNames = ["中文.txt", "café.md", ...(process.platform === "win32" ? [] : POSIX_ONLY)];

  /**
   * `before` adds `old.txt`; the next commit adds a text file under each name and three bytes
   * in `binary.dat`, and moves `old.txt` to `目录/新.txt`.
   */
  const repo = freshRepo((dir) => {
    fs.writeFileSync(path.join(dir, "old.txt"), "moved\n");
    git(["add", "--", "old.txt"], dir);
    git(["commit", "-q", "-m", "before"], dir);
    for (const name of textNames) {
      fs.writeFileSync(path.join(dir, name), "one\ntwo\n");
    }
    fs.writeFileSync(path.join(dir, "binary.dat"), Buffer.from([0, 1, 2]));
    fs.mkdirSync(path.join(dir, "目录"));
    git(["mv", "old.txt", "目录/新.txt"], dir);
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "hard names"], dir);
  });

  it("come back unquoted, with renames found and binary counts left out", async () => {
    const result = await details(repo(), gitOutput(["rev-parse", "HEAD"], repo()));
    const expected = [
      ...textNames.map((name) => change("A", name, name, 2, 0)),
      change("A", "binary.dat", "binary.dat", null, null),
      change("R", "old.txt", "目录/新.txt", 0, 0)
    ];
    expect(result.commitDetails!.fileChanges.toSorted(byNewPath)).toStrictEqual(
      expected.toSorted(byNewPath)
    );
  });
});
