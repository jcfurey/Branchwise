import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { viewWorkingTreeFile } from "@/backend/actions/workingTree";
import { createGit } from "@/backend/gitClient";
import { loadWorkingTree } from "@/backend/queries/workingTree";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();

/**
 * Leave `f` unmerged with only the given index stages (1 base, 2 ours, 3 theirs), which is how
 * Git records each kind of conflict, and keep or remove the working-tree file.
 */
function conflict(stages: number[], keepFile: boolean) {
  const blob = gitOutput(["rev-parse", "HEAD:f"], repo());
  git(["rm", "--cached", "--quiet", "f"], repo());
  const info = stages.map((stage) => `100644 ${blob} ${stage}\tf`).join("\n") + "\n";
  execInput(["update-index", "--index-info"], info);
  if (!keepFile) {
    fs.rmSync(path.join(repo(), "f"));
  }
}

function execInput(args: string[], input: string) {
  execFileSync("git", args, { cwd: repo(), input });
}

it.each([
  ["UD", [1, 2], true],
  ["DU", [1, 3], true],
  ["AU", [2], true],
  ["UA", [3], true],
  ["AA", [2, 3], true],
  ["UU", [1, 2, 3], true],
  ["DD", [1], false]
] as const)("opens a %s conflict with its kind", async (status, stages, keepFile) => {
  conflict([...stages], keepFile);
  const client = createGit(repo(), "git");
  expect(await loadWorkingTree(client)).toEqual([
    { path: "f", oldPath: "f", status, group: "conflicts" }
  ]);
  const effect = { kind: "conflict", path: path.join(repo(), "f"), status };
  expect(await viewWorkingTreeFile(client, "f", "conflicts")).toEqual(effect);
  expect(
    await runRepositoryAction(client, { kind: "conflict", path: "f", operation: "open" }, "git")
  ).toEqual(effect);
});
