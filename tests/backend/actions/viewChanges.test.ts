import { renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();

const run = (action: Parameters<typeof runRepositoryAction>[1]) =>
  runRepositoryAction(createGit(repo(), "git"), action);

const head = () => gitOutput(["rev-parse", "HEAD"], repo());
const snapshot = () => [
  gitOutput(["status", "--porcelain"], repo()),
  gitOutput(["for-each-ref", "--format=%(refname) %(objectname)"], repo())
];

/** Commit what `change` does to the work tree, and return the new commit's ID. */
function commit(message: string, change: (dir: string) => void) {
  change(repo());
  git(["add", "-A"], repo());
  git(["commit", "-q", "-m", message], repo());
  return head();
}

it("lists a commit's added, modified, renamed and deleted files as single diffs show them", async () => {
  commit("setup", (dir) => {
    writeFileSync(path.join(dir, "gone.txt"), "bye\n");
    writeFileSync(path.join(dir, "old name.txt"), "a long enough line to be found as a rename\n");
  });
  const hash = commit("changes", (dir) => {
    writeFileSync(path.join(dir, "f"), "changed\n");
    writeFileSync(path.join(dir, "added.txt"), "new\n");
    rmSync(path.join(dir, "gone.txt"));
    renameSync(path.join(dir, "old name.txt"), path.join(dir, "new name.txt"));
  });
  const before = snapshot();

  const effect = await run({ kind: "viewCommitChanges", hash: "HEAD" });
  const side = (from: string, to: string) => ({
    left: `${hash}^`,
    right: hash,
    before: from,
    after: to
  });
  expect(effect).toEqual({
    kind: "changes",
    title: `Changes in ${hash.slice(0, 8)}`,
    files: [
      side("added.txt", "added.txt"),
      side("f", "f"),
      side("gone.txt", "gone.txt"),
      side("old name.txt", "new name.txt")
    ]
  });
  // Nothing on disk or among the refs changed.
  expect(snapshot()).toEqual(before);
});

it("compares the first commit with nothing, and opens nothing for a commit without changes", async () => {
  const root = head();
  expect(await run({ kind: "viewCommitChanges", hash: root })).toMatchObject({
    files: [{ left: `${root}^`, right: root, before: "f", after: "f" }]
  });
  git(["commit", "-q", "--allow-empty", "-m", "empty"], repo());
  expect(await run({ kind: "viewCommitChanges", hash: head() })).toMatchObject({ files: [] });
});

it("refuses a revision that is not a commit", async () => {
  await expect(run({ kind: "viewCommitChanges", hash: "no-such-ref" })).rejects.toThrow();
  await expect(run({ kind: "viewCommitChanges", hash: "--all" })).rejects.toThrow();
});

it("gives a comparison's added files no left side and its deleted files no right side", async () => {
  const base = head();
  const right = commit("range", (dir) => {
    writeFileSync(path.join(dir, "added.txt"), "new\n");
    rmSync(path.join(dir, "f"));
  });
  const before = snapshot();

  expect(
    await run({
      kind: "viewRangeChanges",
      base: "HEAD^",
      right: "HEAD",
      files: [
        { status: "A", before: "added.txt", after: "added.txt" },
        { status: "D", before: "f", after: "f" },
        { status: "R090", before: "a.txt", after: "b.txt" }
      ]
    })
  ).toEqual({
    kind: "changes",
    title: `${base.slice(0, 8)} ↔ ${right.slice(0, 8)}`,
    files: [
      { left: null, right, before: "added.txt", after: "added.txt" },
      { left: base, right: null, before: "f", after: "f" },
      { left: base, right, before: "a.txt", after: "b.txt" }
    ]
  });
  expect(snapshot()).toEqual(before);
});

it("refuses compared paths outside the repository", async () => {
  await expect(
    run({
      kind: "viewRangeChanges",
      base: "HEAD",
      right: "HEAD",
      files: [{ status: "M", before: "../outside", after: "../outside" }]
    })
  ).rejects.toThrow("Choose a file path inside the repository.");
});
