import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach } from "vitest";

/** Settings every repository from `makeRepo` carries in its own config file. */
const REPOSITORY_SETTINGS: ReadonlyArray<readonly [key: string, value: string]> = [
  ["user.name", "T"],
  ["user.email", "t@t.com"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"]
];

/**
 * Starts the `git` on `PATH` in `cwd` and waits for it. Every stream is a pipe, so nothing reaches
 * the test output and Git never waits for a terminal. A failed start or a non-zero exit throws
 * Node's child-process error, which carries the status and what Git printed.
 */
function runGit(args: string[], cwd: string): Buffer {
  return execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

/** Runs Git with exactly `args` in `cwd`. Throws when Git fails. */
export function git(args: string[], cwd: string): void {
  runGit(args, cwd);
}

/** Git's standard output as UTF-8, without surrounding whitespace. Throws when Git fails. */
export function gitOutput(args: string[], cwd: string): string {
  return runGit(args, cwd).toString("utf8").trim();
}

/**
 * The refs whose full name begins with `namespace`, less their first two components, so that
 * `refs/tags/v1.0` gives `v1.0`. Sorted by full ref name, loose and packed refs alike.
 */
export function refNames(namespace: string, cwd: string): string[] {
  return gitOutput(["for-each-ref", "--sort=refname", "--format=%(refname)"], cwd)
    .split("\n")
    .filter((ref) => ref !== "" && ref.startsWith(namespace))
    .map((ref) => ref.split("/").slice(2).join("/"));
}

/**
 * A new repository in a folder of its own under the system temporary folder, returned as the
 * operating system's canonical path. `main` is checked out, with one commit `init` by
 * `T <t@t.com>` that adds `f` holding `x`. The caller deletes it.
 */
export function makeRepo(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-test-")));
  try {
    git(["init", "-q", "--initial-branch=main"], dir);
  } catch {
    // Git before 2.28 has no option for the first branch's name; point the unborn HEAD at it.
    git(["init", "-q"], dir);
    git(["symbolic-ref", "HEAD", "refs/heads/main"], dir);
  }
  for (const [key, value] of REPOSITORY_SETTINGS) {
    git(["config", key, value], dir);
  }
  fs.writeFileSync(path.join(dir, "f"), "x");
  git(["add", "--", "f"], dir);
  git(["commit", "-q", "-m", "init"], dir);
  return dir;
}

/**
 * Gives every test of the calling file or `describe` block a repository from `makeRepo`, passed
 * to `setup` first, and deletes it after the test. Call it while tests are being collected; hooks
 * registered after it can already use the returned getter, which gives the current test's path,
 * or `""` before the first test starts.
 */
export function freshRepo(setup?: (repo: string) => void): () => string {
  let current = "";
  beforeEach(() => {
    current = makeRepo();
    setup?.(current);
  });
  afterEach(() => {
    if (current !== "") {
      // Windows can hold a file for a moment after the Git process using it has exited.
      fs.rmSync(current, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  return () => current;
}
