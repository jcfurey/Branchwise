import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";
import { repositoryQuery } from "@/backend/queries/repository";

import { makeRepo } from "@tests/backend/helpers";

let repo: string;
const index = () => {
  const file = path.join(repo, ".git", "index");
  return { bytes: fs.readFileSync(file).toString("base64"), mtime: fs.statSync(file).mtimeMs };
};

beforeEach(() => {
  repo = makeRepo();
  // A new modification time without new contents makes `git status` refresh the index entry.
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(repo, "f"), later, later);
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

it("reads the graph, repository state, and workspace without rewriting the index", async () => {
  const before = index();
  await loadCommits(createGit(repo, "git"), {
    branchName: "",
    maxCommits: 10,
    showRemoteBranches: true,
    hard: false,
    dateType: "Author Date",
    showUncommittedChanges: true
  });
  await repositoryQuery(createGit(repo, "git"), { kind: "state" });
  await repositoryQuery(
    createGit(repo, "git"),
    { kind: "workspace" },
    { repos: [repo], binary: "git" }
  );
  expect(index()).toEqual(before);

  // Plain `git status` takes the optional lock and refreshes the index.
  execFileSync("git", ["status", "--porcelain"], { cwd: repo });
  expect(index()).not.toEqual(before);
});
