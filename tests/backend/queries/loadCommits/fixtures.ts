import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach } from "vitest";

import { PARSED_OUTPUT_ARGS } from "@/backend/gitClient";
import type { loadCommits } from "@/backend/queries/loadCommits";

export type GraphInput = Parameters<typeof loadCommits>[1];

/**
 * Every branch, a 300-commit page, remote branches and the uncommitted row. Frozen, so a call
 * that changed its input would throw.
 */
export const defaults: Readonly<GraphInput> = Object.freeze({
  branchName: "",
  maxCommits: 300,
  showRemoteBranches: true,
  hard: false,
  dateType: "Author Date",
  showUncommittedChanges: true
});

/**
 * Temporary directories for the running test, removed when it ends. Each test makes its own, so
 * the tests of a file can run in any order.
 */
export function useTempDirs() {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  return () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-graph-")));
    made.push(dir);
    return dir;
  };
}

/** Git's trimmed output. `dates`, in Unix seconds, become the author and committer dates. */
export function git(cwd: string, args: string[], dates?: { author: number; committer?: number }) {
  const env = dates
    ? {
        ...process.env,
        GIT_AUTHOR_DATE: `@${dates.author} +0000`,
        GIT_COMMITTER_DATE: `@${dates.committer ?? dates.author} +0000`
      }
    : process.env;
  return cp.execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString().trim();
}

/** The test identity, without signing. */
export function identify(repo: string) {
  git(repo, ["config", "user.name", "T"]);
  git(repo, ["config", "user.email", "t@t.com"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["config", "tag.gpgsign", "false"]);
}

/** An empty commit on the checked-out branch; returns its hash. */
export function commit(repo: string, message: string, author: number, committer = author) {
  git(repo, ["commit", "--allow-empty", "-m", message], { author, committer });
  return git(repo, ["rev-parse", "HEAD"]);
}

/** `I`: "init" at 1700000000 on `main`, adding the file `f`. */
export function repoI(dir: string) {
  git(dir, ["init", "-q", "-b", "main"]);
  identify(dir);
  fs.writeFileSync(path.join(dir, "f"), "x");
  git(dir, ["add", "."]);
  return { repo: dir, I: commit(dir, "init", 1_700_000_000) };
}

/** Repository A: `I` and `S` on `main`, a lightweight `v1` on `S` and an annotated `v0` on `I`. */
export function repoA(dir: string) {
  const { I } = repoI(dir);
  const S = commit(dir, "second", 1_700_000_100);
  git(dir, ["tag", "v1"]);
  git(dir, ["tag", "-a", "v0", "-m", "ann", "HEAD~1"]);
  return { repo: dir, I, S };
}

/**
 * Repository B: `main` has `M2` (authored after its commit date) and `feature` has `F1`
 * (authored before it), both on `I`. `main` is checked out, with an untracked file.
 */
export function repoB(dir: string) {
  const { I } = repoI(dir);
  const M2 = commit(dir, "main-2", 1_800_000_000, 1_700_000_100);
  git(dir, ["checkout", "-q", "-b", "feature", "HEAD~1"]);
  const F1 = commit(dir, "feat-1", 1_600_000_000, 1_700_000_200);
  git(dir, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(dir, "dirty"), "");
  return { repo: dir, I, M2, F1 };
}

/**
 * Repository C: a clone of repository A, so `origin/main` and the symbolic `origin/HEAD` are on
 * `S`, with `L` committed on top of `main`.
 */
export function repoC(source: string, dir: string) {
  git(dir, ["clone", "-q", source, "."]);
  identify(dir);
  return { repo: dir, L: commit(dir, "local", 1_700_000_300) };
}

/**
 * A Git executable that records the arguments of every process it runs, one line each, without
 * the client's own prefix. It is a shell script, so it runs only on POSIX systems.
 */
export function recordingGit(dir: string) {
  const log = path.join(dir, "runs.log");
  const executable = path.join(dir, "git");
  const real = cp.execFileSync("sh", ["-c", "command -v git"]).toString().trim();
  const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${real}' "$@"\n`;
  fs.writeFileSync(executable, script, { mode: 0o755 });
  const prefix = PARSED_OUTPUT_ARGS.join(" ") + " ";
  return {
    gitPath: executable,
    /** Each run's arguments after the client's prefix, or the whole line if it lacked one. */
    runs: () =>
      (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : []).map(
        (line) => (line.startsWith(prefix) ? line.slice(prefix.length) : `unprefixed: ${line}`)
      )
  };
}
