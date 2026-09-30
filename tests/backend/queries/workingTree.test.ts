import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";
import { repositoryQuery } from "@/backend/queries/repository";
import type { WorkingTreeGroup } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

let repo: string;
const git = () => createGit(repo, "git");
const run = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
const write = (file: string, text: string | Buffer) =>
  fs.writeFileSync(path.join(repo, file), text);
const query = () => repositoryQuery(git(), { kind: "workingTree" });
const view = (file: string, group: WorkingTreeGroup) =>
  runRepositoryAction(git(), {
    kind: "viewWorkingTreeFile",
    path: file,
    group
  });
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

it("separates both versions of a partially staged file and counts untracked files individually", async () => {
  write("f", "staged\n");
  run("add", "f");
  write("f", "working\n");
  fs.mkdirSync(path.join(repo, "new"));
  write("new/a", "a");
  write("new/b", "b");
  expect(await query()).toEqual({
    kind: "workingTree",
    files: [
      { path: "f", oldPath: "f", status: "M", group: "staged" },
      { path: "f", oldPath: "f", status: "M", group: "unstaged" },
      { path: "new/a", oldPath: "new/a", status: "?", group: "untracked" },
      { path: "new/b", oldPath: "new/b", status: "?", group: "untracked" }
    ]
  });
  const graph = await loadCommits(git(), {
    branchName: "",
    maxCommits: 20,
    showRemoteBranches: false,
    hard: false,
    dateType: "Author Date",
    showUncommittedChanges: true
  });
  expect(graph.uncommittedChanges).toBe(3);
  expect(await view("f", "staged")).toMatchObject({
    kind: "workingTreeDiff",
    left: run("rev-parse", "HEAD:f"),
    right: run("rev-parse", ":f"),
    workingPath: null
  });
  expect(await view("f", "unstaged")).toMatchObject({
    kind: "workingTreeDiff",
    left: run("rev-parse", ":f"),
    right: null,
    workingPath: path.join(repo, "f")
  });
  const first = await view("f", "staged");
  run("add", "f");
  expect(await view("f", "staged")).not.toEqual(first);
});

it("keeps rename paths and special characters intact", async () => {
  const renamed = "renamed # file.txt";
  const unusual = process.platform === "win32" ? "new 空格.txt" : "new\t空格\nfile.txt";
  run("mv", "f", renamed);
  write(renamed, "further changes");
  write(unusual, "new");
  const result = await query();
  expect(result).toMatchObject({
    files: expect.arrayContaining([
      { path: renamed, oldPath: "f", status: "R", group: "staged" },
      { path: renamed, oldPath: renamed, status: "M", group: "unstaged" },
      { path: unusual, oldPath: unusual, status: "?", group: "untracked" }
    ])
  });
  expect(await view(renamed, "staged")).toMatchObject({
    before: "f",
    after: renamed,
    left: run("rev-parse", "HEAD:f")
  });
  expect(await view(renamed, "unstaged")).toMatchObject({
    before: renamed,
    left: run("rev-parse", ":" + renamed)
  });
  expect(await view(unusual, "untracked")).toMatchObject({
    left: null,
    workingPath: path.join(repo, unusual)
  });
});

// Windows does not allow a colon in a file name.
it.skipIf(process.platform === "win32")(
  "reads the index entry of a file named like a stage, not the staged file it names",
  async () => {
    write("foo", "foo");
    write("0:foo", "committed");
    run("add", "--", "foo", "0:foo");
    run("commit", "-m", "stage-like name");
    write("0:foo", "staged");
    run("add", "--", "0:foo");
    write("0:foo", "working");
    expect(await view("0:foo", "staged")).toMatchObject({
      left: run("rev-parse", "HEAD:0:foo"),
      right: run("rev-parse", ":0:0:foo")
    });
    expect(await view("0:foo", "unstaged")).toMatchObject({ left: run("rev-parse", ":0:0:foo") });
    expect(run("rev-parse", ":0:0:foo")).not.toBe(run("rev-parse", ":0:foo"));
  }
);

it("opens additions and deletions against an empty side without changing the index", async () => {
  const original = run("rev-parse", "HEAD:f");
  fs.unlinkSync(path.join(repo, "f"));
  expect(await view("f", "unstaged")).toMatchObject({
    left: original,
    right: null,
    workingPath: null
  });
  run("add", "f");
  expect(await view("f", "staged")).toMatchObject({
    left: original,
    right: null,
    workingPath: null
  });
  write("added.bin", Buffer.from([0, 1, 2, 255]));
  expect(await view("added.bin", "untracked")).toMatchObject({
    left: null,
    workingPath: path.join(repo, "added.bin")
  });
  run("add", "added.bin");
  const index = run("write-tree");
  expect(await view("added.bin", "staged")).toMatchObject({
    left: null,
    right: run("rev-parse", ":added.bin"),
    workingPath: null
  });
  expect(run("write-tree")).toBe(index);
});

it("handles intent-to-add files and repositories without a first commit", async () => {
  write("intent", "new\n");
  run("add", "--intent-to-add", "intent");
  expect(await view("intent", "unstaged")).toMatchObject({
    left: null,
    workingPath: path.join(repo, "intent")
  });
  run("checkout", "--orphan", "unborn");
  expect(await view("f", "staged")).toMatchObject({ left: null, right: run("rev-parse", ":f") });
});

it("reports conflicts once and opens their merge editor", async () => {
  run("checkout", "-b", "other");
  write("f", "other\n");
  run("commit", "-am", "other");
  run("checkout", "main");
  write("f", "main\n");
  run("commit", "-am", "main");
  expect(() => run("merge", "other")).toThrow();
  expect(await query()).toEqual({
    kind: "workingTree",
    files: [{ path: "f", oldPath: "f", status: "UU", group: "conflicts" }]
  });
  expect(await view("f", "conflicts")).toEqual({
    kind: "conflict",
    path: path.join(repo, "f"),
    status: "UU"
  });
});

it("uses a patch for a gitlink whose target object is not in the parent repository", async () => {
  const head = run("rev-parse", "HEAD");
  run("update-index", "--add", "--cacheinfo", "160000," + head + ",child");
  run("commit", "-m", "gitlink");
  run("update-index", "--cacheinfo", "160000," + "a".repeat(40) + ",child");
  expect(await view("child", "staged")).toMatchObject({
    kind: "document",
    text: expect.stringContaining("Subproject commit " + "a".repeat(40))
  });
});

it.skipIf(process.platform === "win32")(
  "shows a symlink's target instead of following it",
  async () => {
    fs.symlinkSync("f", path.join(repo, "link"));
    expect(await view("link", "untracked")).toMatchObject({
      kind: "document",
      text: expect.stringContaining("+f\n")
    });
    run("add", "link");
    expect(await view("link", "staged")).toMatchObject({
      kind: "document",
      text: expect.stringContaining("+f\n")
    });
    run("commit", "-m", "link");
    fs.unlinkSync(path.join(repo, "link"));
    fs.symlinkSync("missing", path.join(repo, "link"));
    expect(await view("link", "unstaged")).toMatchObject({
      kind: "document",
      text: expect.stringContaining("+missing\n")
    });
  }
);

it("rejects files that disappeared from their group and reports a clean repository", async () => {
  expect(await query()).toEqual({ kind: "workingTree", files: [] });
  await expect(view("f", "unstaged")).rejects.toThrow("Refresh the graph");
  await expect(view("../outside", "untracked")).rejects.toThrow();
});

it("marks an untracked nested repository and explains it instead of failing", async () => {
  const nested = path.join(repo, "nested");
  fs.mkdirSync(nested);
  execFileSync("git", ["init", "-q"], { cwd: nested });
  fs.writeFileSync(path.join(nested, "inner.txt"), "inner");
  write("plain.txt", "plain");
  expect(await query()).toEqual({
    kind: "workingTree",
    files: [
      { path: "nested/", oldPath: "nested/", status: "?", group: "untracked", repository: true },
      { path: "plain.txt", oldPath: "plain.txt", status: "?", group: "untracked" }
    ]
  });
  expect(await view("nested/", "untracked")).toEqual({ kind: "nestedRepository", path: nested });
});
