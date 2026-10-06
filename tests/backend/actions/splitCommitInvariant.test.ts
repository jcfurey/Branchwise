import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadSplitPlan } from "@/backend/queries/splitCommit";

import { makeRepo } from "@tests/backend/helpers";

/** While set, every patch applied to the private index has its added `fixed` lines changed. */
const corrupt = vi.hoisted(() => ({ on: false }));
vi.mock("@/backend/utils/runGit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/backend/utils/runGit")>();
  return {
    ...original,
    runGitWithInput: (...args: Parameters<typeof original.runGitWithInput>) => {
      const [git, command, input, env] = args;
      const patch =
        corrupt.on && command.includes("apply")
          ? Buffer.from(input.toString().replaceAll("fixed", "broken"))
          : input;
      return original.runGitWithInput(git, command, patch, env);
    }
  };
});

let repo = "";
const read = (args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
function write(file: string, text: string) {
  fs.writeFileSync(path.join(repo, file), text);
}

beforeEach(() => {
  repo = makeRepo();
  corrupt.on = false;
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("moves nothing when the parts would not rebuild the commit's tree", async () => {
  write("a", "one\ntwo\nthree\nfour\nfive\n");
  read(["add", "a"]);
  read(["commit", "-q", "-m", "add a"]);
  write("a", "one fixed\ntwo\nthree\nfour\nfive fixed\n");
  read(["add", "a"]);
  read(["commit", "-q", "-m", "fix a"]);
  write("a", "unstaged\n");
  const state = () => [
    read(["for-each-ref"]),
    read(["status", "--porcelain"]),
    read(["ls-files", "--stage", "--debug"]),
    fs.readFileSync(path.join(repo, ".git", "index")).toString("base64"),
    fs.readFileSync(path.join(repo, "a"), "utf8"),
    read(["reflog", "--format=%H %gs"])
  ];
  const before = state();
  const plan = await loadSplitPlan(createGit(repo, "git"), "HEAD");
  expect(plan.files[0]!.hunks).toHaveLength(2);
  corrupt.on = true;
  await expect(
    runRepositoryAction(createGit(repo, "git"), {
      kind: "splitCommit",
      plan,
      messages: ["first fix", "second fix"],
      assignment: [[0, 1]]
    })
  ).rejects.toThrow(/would not add up to the original commit/);
  expect(state()).toEqual(before);
  expect(read(["reflog", "-1", "--format=%gs"])).toMatch(/^commit: fix a/);
});
