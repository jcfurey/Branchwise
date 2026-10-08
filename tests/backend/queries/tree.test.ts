import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { viewCurrentFile } from "@/backend/actions/workingTree";
import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";
import { loadTree, parseTreeRecord, readFileAt, TREE_LIMIT } from "@/backend/queries/tree";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const client = () => createGit(repo, "git");

/** Store `content` as a blob and return its ID. */
function blob(content: string | Buffer) {
  return execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: content })
    .toString()
    .trim();
}

/**
 * A commit on top of HEAD whose tree holds exactly `entries`, each `[mode, object, path]`, made
 * with a private index so that the work tree and the real index are left as they are. Git for
 * Windows keeps names that Windows cannot store, such as one with a quote, out of an index unless
 * `core.protectNTFS` is off; these entries are never checked out, so it is off here.
 */
function commitTree(entries: Array<[mode: string, object: string, path: string]>) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(repo, ".git", "tree-test-index") };
  const run = (args: string[], input?: string) =>
    execFileSync("git", ["-c", "core.protectNTFS=false", ...args], { cwd: repo, env, input })
      .toString()
      .trim();
  run(["read-tree", "--empty"]);
  run(
    ["update-index", "--add", "-z", "--index-info"],
    entries.map(([mode, object, file]) => `${mode} ${object}\t${file}\0`).join("")
  );
  const tree = run(["write-tree"]);
  rmSync(env.GIT_INDEX_FILE, { force: true });
  return run(["commit-tree", tree, "-p", "HEAD", "-m", "tree"]);
}

/** What a read must leave alone: the work tree's status, every ref, and the index. */
const untouched = () => [
  // Without optional locks, so that this check never refreshes the index itself.
  gitOutput(["--no-optional-locks", "status", "--porcelain", "--ignored"], repo),
  gitOutput(["for-each-ref"], repo),
  gitOutput(["ls-files", "--stage"], repo),
  statSync(path.join(repo, ".git", "index")).mtimeMs
];

describe("the whole tree of a commit", () => {
  it("lists files, executables, symbolic links and submodules with their sizes, paths as they are", async () => {
    const text = blob("hello\n");
    const target = blob("../a b/c.txt");
    const gitlink = "1234567890abcdef1234567890abcdef12345678";
    const commit = commitTree([
      ["100644", text, "a b/c.txt"],
      ["100644", text, "naïve/日本語 ファイル.md"],
      ["100755", text, "bin/run"],
      ["120000", target, "links/to c"],
      ["160000", gitlink, "vendor/lib"],
      ["100644", text, "tab\there"],
      ["100644", text, 'quote"and\\back']
    ]);
    const before = untouched();

    const data = await repositoryQuery(client(), { kind: "tree", hash: commit });

    expect(data).toEqual({
      kind: "tree",
      hash: commit,
      more: false,
      // Git's tree order: by name, each folder as though its name ended in "/".
      entries: [
        { path: "a b/c.txt", kind: "file", size: 6 },
        { path: "bin/run", kind: "executable", size: 6 },
        { path: "links/to c", kind: "symlink", size: 12 },
        { path: "naïve/日本語 ファイル.md", kind: "file", size: 6 },
        { path: 'quote"and\\back', kind: "file", size: 6 },
        { path: "tab\there", kind: "file", size: 6 },
        { path: "vendor/lib", kind: "submodule", size: null, commit: gitlink }
      ]
    });
    expect(untouched()).toEqual(before);
  });

  it("reads a branch name as its commit, and refuses what is not a commit", async () => {
    const head = gitOutput(["rev-parse", "HEAD"], repo);
    const tree = gitOutput(["rev-parse", "HEAD^{tree}"], repo);

    expect(await loadTree(client(), "main")).toEqual({
      hash: head,
      entries: [{ path: "f", kind: "file", size: 1 }],
      more: false
    });
    await expect(loadTree(client(), tree)).rejects.toThrow();
    await expect(loadTree(client(), "--output=gone")).rejects.toThrow();
    await expect(loadTree(client(), "missing")).rejects.toThrow();
    expect(() => statSync(path.join(repo, "gone"))).toThrow();
  });

  it("stops at the limit, and says when there was more", async () => {
    const text = blob("x");
    const commit = commitTree(
      Array.from({ length: 30 }, (_, index) => [
        "100644",
        text,
        `d/${String(index).padStart(2, "0")}`
      ])
    );

    const cut = await loadTree(client(), commit, 10);
    expect(cut.more).toBe(true);
    expect(cut.entries.map((entry) => entry.path)).toEqual(
      Array.from({ length: 10 }, (_, index) => `d/${String(index).padStart(2, "0")}`)
    );
    expect(await loadTree(client(), commit, 30)).toMatchObject({ more: false });
    expect((await loadTree(client(), commit, 30)).entries).toHaveLength(30);
  });

  it("bounds a tree larger than the limit without changing anything", async () => {
    const text = blob("x");
    const commit = commitTree(
      Array.from({ length: TREE_LIMIT + 7 }, (_, index) => [
        "100644",
        text,
        `big/${Math.floor(index / 1000)}/${index}.txt`
      ])
    );
    const before = untouched();

    const data = await repositoryQuery(client(), { kind: "tree", hash: commit });

    expect(data.kind === "tree" && data.more).toBe(true);
    expect(data.kind === "tree" && data.entries.length).toBe(TREE_LIMIT);
    expect(untouched()).toEqual(before);
  }, 60_000);

  it("leaves out records it cannot read", () => {
    const record = (text: string) => Buffer.from(text, "utf8");
    const id = "a".repeat(40);

    expect(parseTreeRecord(record(`100644 blob ${id}      12\tok`))?.entry).toEqual({
      path: "ok",
      kind: "file",
      size: 12
    });
    expect(parseTreeRecord(record(`040000 tree ${id}       -\tdir`))).toBeNull();
    expect(parseTreeRecord(record(`160000 blob ${id}       -\todd`))).toBeNull();
    expect(parseTreeRecord(record(`100644 blob ${id} 12 no tab`))).toBeNull();
    expect(parseTreeRecord(record("garbage\tpath"))).toBeNull();
  });
});

describe("one file's bytes at a commit", () => {
  // Every byte value, as a binary file such as an image holds them.
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

  it("reads them exactly, at the commit or its first parent, and only the size above the cap", async () => {
    writeFileSync(path.join(repo, "pic.png"), bytes);
    git(["add", "pic.png"], repo);
    git(["commit", "-q", "-m", "picture"], repo);
    writeFileSync(path.join(repo, "pic.png"), bytes.subarray(0, 10));
    git(["commit", "-q", "-am", "smaller"], repo);
    const before = untouched();

    expect(await readFileAt(client(), "HEAD^", "pic.png", 1000)).toEqual({ size: 256, bytes });
    expect(await readFileAt(client(), "HEAD", "pic.png", 1000)).toEqual({
      size: 10,
      bytes: bytes.subarray(0, 10)
    });
    expect(await readFileAt(client(), "HEAD^", "pic.png", 255)).toEqual({
      size: 256,
      bytes: null
    });
    expect(untouched()).toEqual(before);
  });

  it("has nothing for a missing path, a symbolic link, a submodule or a folder", async () => {
    const commit = commitTree([
      ["120000", blob("f"), "link.png"],
      ["160000", "1234567890abcdef1234567890abcdef12345678", "sub.png"],
      ["100644", blob("x"), "dir.png/inner"]
    ]);

    const found = await Promise.all(
      ["missing.png", "link.png", "sub.png", "dir.png"].map((file) =>
        readFileAt(client(), commit, file, 1000)
      )
    );
    expect(found).toEqual([null, null, null, null]);
    await expect(readFileAt(client(), commit, "../outside.png", 1000)).rejects.toThrow();
  });
});

describe("the current version of a file", () => {
  it("opens the work tree's copy by its absolute path", async () => {
    writeFileSync(path.join(repo, "f"), "edited");

    expect(await viewCurrentFile(client(), "f")).toEqual({
      kind: "workingFile",
      path: path.join(repo, "f")
    });
    expect(readFileSync(path.join(repo, "f"), "utf8")).toBe("edited");
  });

  it("refuses a file that is gone, a folder, and a path outside the repository", async () => {
    rmSync(path.join(repo, "f"));
    await expect(viewCurrentFile(client(), "f")).rejects.toThrow(
      "f is not in the working tree any more."
    );
    await expect(viewCurrentFile(client(), ".git")).rejects.toThrow();
    await expect(viewCurrentFile(client(), "../elsewhere")).rejects.toThrow();
  });
});
