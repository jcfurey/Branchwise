import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";
import { loadSplitPlan } from "@/backend/queries/splitCommit";
import type { SplitAssignment, SplitPlan } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

let repo = "";
const AUTHOR = {
  GIT_AUTHOR_NAME: "Ann Author",
  GIT_AUTHOR_EMAIL: "ann@example.invalid",
  GIT_AUTHOR_DATE: "2001-02-03T04:05:06+0100",
  GIT_COMMITTER_DATE: "2001-02-03T04:05:06+0100"
};
const read = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe", env }).toString().trim();
const git = () => createGit(repo, "git");
function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), contents);
}
/** Commit `files` (null deletes one) as Ann Author, at a fixed date, and return its ID. */
function commit(files: Record<string, string | null>, message: string) {
  for (const [file, contents] of Object.entries(files)) {
    if (contents === null) {
      read(["rm", "-q", "--", file]);
    } else {
      write(file, contents);
      read(["add", "--", file]);
    }
  }
  read(["commit", "-q", "--allow-empty", "-m", message], { ...process.env, ...AUTHOR });
  return read(["rev-parse", "HEAD"]);
}
const split = (plan: SplitPlan, messages: string[], assignment: SplitAssignment) =>
  runRepositoryAction(git(), { kind: "splitCommit", plan, messages, assignment });
/** The files of a commit's tree with their modes and contents' IDs. */
const files = (rev: string) => read(["ls-tree", "-r", rev]);
const changed = (rev: string) =>
  read(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", rev]);
const subjects = (range = "HEAD") => read(["log", "--format=%s", range]);
const lines = (count: number, change: (line: number) => string = String) =>
  Array.from({ length: count }, (_, index) => change(index + 1) + "\n").join("");
/** Everything a split may not change until it succeeds, and a read-only query never does. */
const snapshot = () => [
  read(["for-each-ref"]),
  read(["status", "--porcelain=v1", "--untracked-files=all"]),
  read(["ls-files", "--stage", "--debug"]),
  fs.readFileSync(path.join(repo, ".git", "index")).toString("base64"),
  read(["count-objects", "-v"]),
  read(["reflog", "--format=%H %gs"])
];

beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("splitting HEAD", () => {
  it("makes two commits with the author and date of the original and its exact tree", async () => {
    const base = read(["rev-parse", "HEAD"]);
    const target = commit({ a: "a\n", b: "b\n", "dir/c": "c\n" }, "three files\n\nbody");
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    const plan = await loadSplitPlan(git(), "HEAD");
    expect(plan).toMatchObject({ branch: "main", head: target, target, later: 0 });
    expect(plan.files.map((file) => [file.status, file.path, file.hunks])).toEqual([
      ["A", "a", null],
      ["A", "b", null],
      ["A", "dir/c", null]
    ]);
    await split(plan, ["first part\n\nbody", "  second part  \n\n"], [0, 1, 0]);

    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
    expect(read(["rev-parse", "HEAD~2"])).toBe(base);
    expect(subjects()).toBe("second part\nfirst part\ninit");
    expect(read(["log", "-1", "--format=%B", "HEAD^"])).toBe("first part\n\nbody");
    expect(read(["log", "-1", "--format=%B"])).toBe("second part");
    expect(changed("HEAD^")).toBe("A\ta\nA\tdir/c");
    expect(changed("HEAD")).toBe("A\tb");
    const authors = read(["log", "-3", "--format=%an|%ae|%ad", "--date=raw"]).split("\n");
    expect(authors).toEqual([
      "Ann Author|ann@example.invalid|981169506 +0100",
      "Ann Author|ann@example.invalid|981169506 +0100",
      "T|t@t.com|" + read(["log", "-1", "--format=%ad", "--date=raw", base])
    ]);
    // The committer is whoever splits it, now.
    expect(Number(read(["log", "-1", "--format=%ct"]))).toBeGreaterThan(981169506);
    expect(read(["reflog", "-1", "--format=%gs", "main"])).toMatch(/^split: /);
    expect(read(["status", "--porcelain"])).toBe("");
  });

  it("makes three commits in the order of the parts", async () => {
    commit({ a: "a\n", b: "b\n", c: "c\n", d: "d\n" }, "four files");
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    const plan = await loadSplitPlan(git(), "HEAD");
    await split(plan, ["one", "two", "three"], [2, 0, 1, 0]);
    expect(subjects()).toBe("three\ntwo\none\ninit");
    expect([changed("HEAD~2"), changed("HEAD^"), changed("HEAD")]).toEqual([
      "A\tb\nA\td",
      "A\tc",
      "A\ta"
    ]);
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
  });

  it("leaves the work tree, the index and untracked files alone", async () => {
    commit({ a: "a\n", b: "b\n" }, "two files");
    write("a", "a unstaged\n");
    write("b", "b staged\n");
    read(["add", "b"]);
    write("untracked", "new\n");
    const before = [
      read(["status", "--porcelain=v1", "--untracked-files=all"]),
      read(["ls-files", "--stage", "--debug"]),
      fs.readFileSync(path.join(repo, ".git", "index")).toString("base64"),
      ["a", "b", "untracked"].map((file) => fs.readFileSync(path.join(repo, file), "utf8"))
    ];
    await split(await loadSplitPlan(git(), "HEAD"), ["a", "b"], [0, 1]);
    expect(subjects()).toBe("b\na\ninit");
    expect([
      read(["status", "--porcelain=v1", "--untracked-files=all"]),
      read(["ls-files", "--stage", "--debug"]),
      fs.readFileSync(path.join(repo, ".git", "index")).toString("base64"),
      ["a", "b", "untracked"].map((file) => fs.readFileSync(path.join(repo, file), "utf8"))
    ]).toEqual(before);
  });

  it("splits the first commit, with no parent for the first part", async () => {
    write("g", "g\n");
    read(["add", "g"]);
    read(["commit", "-q", "--amend", "-m", "root"]);
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    await split(await loadSplitPlan(git(), "HEAD"), ["f", "g"], [0, 1]);
    expect(subjects()).toBe("g\nf");
    expect(read(["rev-list", "--max-parents=0", "HEAD"])).toBe(read(["rev-parse", "HEAD^"]));
    expect(changed("HEAD^")).toBe("A\tf");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
  });
});

describe("splitting an older commit", () => {
  it("makes the later commits again on the last part with the same trees and messages", async () => {
    const base = read(["rev-parse", "HEAD"]);
    const target = commit({ a: "a\n", b: "b\n" }, "a and b");
    commit({ c: "c\n" }, "c");
    commit({ a: "a changed\n" }, "change a\n\n# kept");
    // A commit that changes nothing stays, as it was.
    commit({}, "empty");
    const trees = (range: string) => read(["log", "--format=%T|%an|%ae|%ad|%B", range]);
    const after = trees(`${target}..HEAD`);
    write("a", "unstaged\n");
    const plan = await loadSplitPlan(git(), target);
    expect(plan).toMatchObject({ target, later: 3 });
    await split(plan, ["a", "b"], [0, 1]);

    expect(subjects()).toBe("empty\nchange a\nc\nb\na\ninit");
    expect(read(["rev-parse", "HEAD~5"])).toBe(base);
    expect(trees("HEAD~3..HEAD")).toBe(after);
    expect(read(["rev-parse", "HEAD~3^{tree}"])).toBe(read(["rev-parse", `${target}^{tree}`]));
    expect(changed("HEAD~4")).toBe("A\ta");
    expect(read(["status", "--porcelain"])).toBe("M a");
  });

  it("splits a first commit that is no longer the latest", async () => {
    read(["commit", "-q", "--allow-empty", "-m", "later"]);
    write("g", "g\n");
    read(["add", "g"]);
    read(["commit", "-q", "-m", "more"]);
    const root = read(["rev-list", "--max-parents=0", "HEAD"]);
    read(["checkout", "-q", "-b", "rooted", root]);
    write("h", "h\n");
    read(["add", "h"]);
    read(["commit", "-q", "--amend", "-m", "root"]);
    commit({ i: "i\n" }, "after root");
    const plan = await loadSplitPlan(git(), "HEAD^");
    await split(plan, ["f", "h"], [0, 1]);
    expect(subjects()).toBe("after root\nh\nf");
    expect(changed("HEAD~2")).toBe("A\tf");
  });
});

describe("files that are deleted, renamed or change mode", () => {
  it("keeps each change whole in its part", async () => {
    commit({ old: lines(20), x: "x\n", gone: "gone\n" }, "setup");
    read(["mv", "old", "new"]);
    read(["update-index", "--chmod=+x", "x"]);
    commit({ gone: null, added: "added\n" }, "mixed");
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    const plan = await loadSplitPlan(git(), "HEAD");
    expect(plan.files.map((file) => [file.status, file.from, file.path, file.hunks])).toEqual([
      ["A", "added", "added", null],
      ["D", "gone", "gone", null],
      ["R", "old", "new", null],
      ["M", "x", "x", null]
    ]);
    await split(plan, ["delete and mode", "rename", "add"], [2, 0, 1, 0]);
    expect(changed("HEAD~2")).toBe("D\tgone\nM\tx");
    expect(read(["diff-tree", "-M", "--no-commit-id", "--name-status", "-r", "HEAD^"])).toBe(
      "R100\told\tnew"
    );
    expect(changed("HEAD")).toBe("A\tadded");
    expect(files("HEAD~2")).toContain("100755 blob");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
  });
});

describe("splitting by hunk", () => {
  it("puts the hunks of one file in different parts", async () => {
    const original = lines(30);
    commit({ text: original, other: "o\n" }, "setup");
    const edited = lines(30, (line) =>
      line === 3 ? "three" : line === 15 ? "fifteen\nextra" : line === 28 ? "" : String(line)
    ).replace("\n\n", "\n");
    commit({ text: edited, other: "o changed\n" }, "two changes");
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    const plan = await loadSplitPlan(git(), "HEAD");
    const text = plan.files.find((file) => file.path === "text")!;
    expect(text.hunks!.map((hunk) => hunk.lines)).toEqual([
      ["-3", "+three"],
      ["-15", "+fifteen", "+extra"],
      ["-28"]
    ]);
    expect(plan.files.find((file) => file.path === "other")!.hunks).toBeNull();
    const at = plan.files.indexOf(text);
    const assignment: SplitAssignment = plan.files.map((_, index) =>
      index === at ? [1, 0, 1] : 0
    );
    await split(plan, ["middle and other", "ends"], assignment);
    expect(read(["show", "HEAD^:text"]) + "\n").toBe(
      lines(30, (line) => (line === 15 ? "fifteen\nextra" : String(line)))
    );
    expect(read(["show", "HEAD^:other"])).toBe("o changed");
    expect(read(["show", "HEAD:text"]) + "\n").toBe(edited);
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
  });

  it("handles insertions, the end of a file without a newline, and three parts", async () => {
    commit({ text: "1\n2\n3\n4\n5\n6\n7\n8\n9\nlast" }, "setup");
    commit({ text: "0\n1\n2\n3\n4\nnew\n5\n6\n7\n8\n9\nlast changed" }, "three hunks");
    const tree = read(["rev-parse", "HEAD^{tree}"]);
    const plan = await loadSplitPlan(git(), "HEAD");
    expect(plan.files[0]!.hunks).toHaveLength(3);
    await split(plan, ["end", "start", "middle"], [[1, 2, 0]]);
    expect(read(["show", "HEAD~2:text"])).toBe("1\n2\n3\n4\n5\n6\n7\n8\n9\nlast changed");
    expect(read(["show", "HEAD^:text"])).toBe("0\n1\n2\n3\n4\n5\n6\n7\n8\n9\nlast changed");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(tree);
  });

  it("sends a file with one hunk, or a binary one, whole", async () => {
    commit({ text: lines(5), bin: "a\0b" }, "setup");
    commit({ text: lines(5, (line) => (line === 2 ? "two" : String(line))), bin: "a\0c" }, "x");
    const plan = await loadSplitPlan(git(), "HEAD");
    expect(plan.files.map((file) => file.hunks)).toEqual([null, null]);
  });
});

describe("refusals", () => {
  it("refuses commits that cannot be split, before anything changes", async () => {
    commit({ a: "a\n" }, "one file");
    await expect(loadSplitPlan(git(), "HEAD")).rejects.toThrow(/only one change/);
    read(["checkout", "-q", "-b", "side"]);
    const side = commit({ s: "s\n", t: "t\n" }, "side");
    read(["checkout", "-q", "main"]);
    commit({ m: "m\n", n: "n\n" }, "main");
    read(["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    await expect(loadSplitPlan(git(), "HEAD")).rejects.toThrow(/merge commit cannot be split/);
    await expect(loadSplitPlan(git(), side)).rejects.toThrow(/checked-out branch/);
    await expect(loadSplitPlan(git(), "HEAD^")).rejects.toThrow(/merge/);
    read(["checkout", "-q", "--detach"]);
    await expect(loadSplitPlan(git(), "HEAD^")).rejects.toThrow(/Check out a branch/);
  });

  it("checks the parts, the messages and the branch before it changes anything", async () => {
    const target = commit({ a: "a\n", b: "b\n" }, "two files");
    commit({ c: "c\n" }, "later");
    const plan = await loadSplitPlan(git(), target);
    const before = snapshot();
    await expect(split(plan, ["only"], [0, 0])).rejects.toThrow(/at least two parts/);
    await expect(split(plan, ["a", "b"], [0, 0])).rejects.toThrow(/at least one change/);
    await expect(split(plan, ["a", " \n "], [0, 1])).rejects.toThrow(/needs a message/);
    await expect(split(plan, ["a", "b"], [0, 2])).rejects.toThrow(/no longer match/);
    await expect(split(plan, ["a", "b"], [0, [1]])).rejects.toThrow(/no longer match/);
    await expect(split(plan, ["a", "b"], [0])).rejects.toThrow(/no longer match/);
    await expect(
      split({ ...plan, files: plan.files.toReversed() }, ["a", "b"], [0, 1])
    ).rejects.toThrow(/no longer match/);
    expect(snapshot()).toEqual(before);
    commit({ d: "d\n" }, "moved on");
    await expect(split(plan, ["a", "b"], [0, 1])).rejects.toThrow(/branch changed/);
    expect(subjects()).toBe("moved on\nlater\ntwo files\ninit");
  });

  it("refuses while another operation is in progress", async () => {
    commit({ f: "main\n", a: "a\n" }, "main");
    read(["checkout", "-q", "-b", "other", "HEAD^"]);
    commit({ f: "other\n" }, "other");
    read(["checkout", "-q", "main"]);
    const plan = await loadSplitPlan(git(), "HEAD");
    expect(() => read(["merge", "-q", "other"])).toThrow();
    await expect(split(plan, ["a", "f"], [1, 0])).rejects.toThrow(/in progress/);
    read(["merge", "--abort"]);
    expect(subjects()).toBe("main\ninit");
  });

  it("changes nothing when a part cannot be committed", async () => {
    commit({ a: "a\n", b: "b\n" }, "two files");
    const plan = await loadSplitPlan(git(), "HEAD");
    read(["config", "commit.gpgSign", "true"]);
    read(["config", "gpg.program", path.join(repo, "no-such-signer")]);
    const before = snapshot();
    await expect(split(plan, ["a", "b"], [0, 1])).rejects.toThrow(/sign/);
    // The parts made before the failure are unreachable objects; nothing points to them.
    expect(snapshot().filter((_, index) => index !== 4)).toEqual(
      before.filter((_, index) => index !== 4)
    );
  });
});

it("finds the plan without changing anything on disk", async () => {
  const target = commit({ a: lines(10), b: "b\n" }, "setup");
  commit({ a: lines(10, (line) => (line % 4 === 0 ? "x" : String(line))), b: null }, "edit");
  write("untracked", "u\n");
  write("b", "back as untracked\n");
  const before = snapshot();
  const data = await repositoryQuery(git(), { kind: "splitPlan", target: "HEAD" });
  expect(data.kind === "splitPlan" && data.plan.files.map((file) => file.hunks?.length)).toEqual([
    2,
    undefined
  ]);
  await loadSplitPlan(git(), target);
  expect(snapshot()).toEqual(before);
});
