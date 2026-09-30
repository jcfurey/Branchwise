import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { onTestFinished } from "vitest";

import { createGit } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import type { DateType } from "@/backend/types";

/** Every commit a test makes has these people and dates, unless the test says otherwise. */
export const PEOPLE = {
  GIT_AUTHOR_NAME: "Ann Author",
  GIT_AUTHOR_EMAIL: "ann@example.com",
  GIT_AUTHOR_DATE: "1600000100 +0200",
  GIT_COMMITTER_NAME: "Cal Committer",
  GIT_COMMITTER_EMAIL: "cal@example.com",
  GIT_COMMITTER_DATE: "1650000100 -0500"
};

type Content = string | Buffer;

/** A file's content, or a symlink, executable or submodule entry. */
export type Entry =
  | Content
  | { mode: "100755" | "120000"; content: Content }
  | { mode: "160000"; commit: string };

/** Every entry of a commit's tree, by path. */
export type Snapshot = Record<string, Entry>;

/** A directory of its own, removed when the current test finishes. */
export function tempDir() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-details-")));
  onTestFinished(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return dir;
}

export type Repo = ReturnType<typeof tempRepo>;

/**
 * A new repository on `main` for the current test. `commit` builds each commit from a full
 * snapshot in an index of its own, so no file is written to the work tree: symlinks, modes and
 * unusual names work the same on every platform.
 */
export function tempRepo(...initArgs: string[]) {
  const dir = tempDir();
  const run = (args: string[], options: { input?: Content; env?: Record<string, string> } = {}) =>
    cp
      .execFileSync("git", args, {
        cwd: dir,
        stdio: "pipe",
        env: { ...process.env, ...PEOPLE, ...options.env },
        ...(options.input === undefined ? {} : { input: options.input })
      })
      .toString();
  const line = (args: string[], options?: Parameters<typeof run>[1]) =>
    run(args, options).replace(/\n$/, "");
  run(["init", "-q", "-b", "main", ...initArgs]);

  function tree(files: Snapshot) {
    const index = path.join(dir, ".git", "ngg-snapshot-index");
    fs.rmSync(index, { force: true });
    const entries = Object.entries(files).map(([file, entry]) => {
      if (typeof entry === "object" && "commit" in entry) {
        return `${entry.mode} ${entry.commit}\t${file}\0`;
      }
      const [mode, content] =
        typeof entry === "string" || Buffer.isBuffer(entry)
          ? ["100644", entry]
          : [entry.mode, entry.content];
      return `${mode} ${line(["hash-object", "-w", "--stdin"], { input: content })}\t${file}\0`;
    });
    const env = { GIT_INDEX_FILE: index };
    run(["update-index", "-z", "--index-info"], { input: entries.join(""), env });
    return line(["write-tree"], { env });
  }

  return {
    dir,
    git: run,
    /** Git's output without the final newline. */
    line,
    tree,
    /** Commit `files` on top of `parents` and move `main` to the new commit. */
    commit(message: string, files: Snapshot, parents: string[] = [], env?: Record<string, string>) {
      const hash = line(
        ["commit-tree", tree(files), ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
        env === undefined ? {} : { env }
      );
      run(["update-ref", "HEAD", hash]);
      return hash;
    },
    /**
     * Write a commit object byte for byte, for messages `git commit` would clean up. `encoding`
     * turns the headers and a string message into bytes.
     */
    rawCommit(
      files: Snapshot,
      headers: string[],
      message: Content,
      encoding: BufferEncoding = "utf8"
    ) {
      const object = Buffer.concat([
        Buffer.from([`tree ${tree(files)}`, ...headers, "", ""].join("\n"), encoding),
        typeof message === "string" ? Buffer.from(message, encoding) : message
      ]);
      return line(["hash-object", "-t", "commit", "-w", "--stdin"], { input: object });
    },
    write(file: string, content: Content) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), content);
    },
    async details(commitHash: string, dateType: DateType = "Author Date") {
      return commitDetails(createGit(dir, "git"), { commitHash, dateType });
    }
  };
}

/** A file change as the query reports it. */
export function change(
  type: "A" | "M" | "D" | "R",
  oldFilePath: string,
  newFilePath: string,
  additions: number | null,
  deletions: number | null
) {
  return { oldFilePath, newFilePath, type, additions, deletions };
}

/** `count` lines, numbered from `first`. */
export function lines(first: number, count: number, render = (n: number) => String(n)) {
  return Array.from({ length: count }, (_, index) => render(first + index) + "\n").join("");
}
