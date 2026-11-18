import { lstat } from "node:fs/promises";
import path from "node:path";

import type { SimpleGit } from "simple-git";

/** How many paths one `git ls-files` is asked about, which keeps its command line short. */
const CHUNK = 100;

/** `values` in runs of at most `size`. */
function chunks<T>(values: T[], size: number) {
  const runs: T[][] = [];
  for (let at = 0; at < values.length; at += size) {
    runs.push(values.slice(at, at + size));
  }
  return runs;
}

/**
 * What is on disk where `file` would be written: `file` itself when anything is there, a parent
 * that is a file where a folder is needed, or `null` when the way is free.
 */
async function standsAt(root: string, file: string) {
  const parts = file.split("/");
  for (let depth = parts.length; depth > 0; depth--) {
    const candidate = parts.slice(0, depth).join("/");
    try {
      // eslint-disable-next-line no-await-in-loop
      const found = await lstat(path.join(root, candidate));
      // A folder above the file is no obstacle; anything else there is.
      return depth === parts.length || !found.isDirectory() ? candidate : null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Nothing here. A parent may still be a file on some systems, which report it so.
        continue;
      }
      if (code !== "ENOTDIR") {
        throw error;
      }
    }
  }
  return null;
}

/**
 * The untracked files, ignored ones included, that writing `target`'s files into the work tree
 * would replace: at most `limit` of them, as paths from the repository's root. A hard reset
 * writes over such files without a word, and since no commit or stash ever held them, nothing
 * could bring them back.
 *
 * Git lists obstructions to the current index directly. Paths that are new in the target
 * need a separate check, since the index cannot tell what will be written there.
 */
export async function untrackedInTheWay(git: SimpleGit, target: string, limit = 20) {
  const [diff, killed] = await Promise.all([
    git.raw(["diff", "--cached", "--raw", "--no-renames", "--diff-filter=DT", "-z", target, "--"]),
    git.raw(["ls-files", "--killed", "--directory", "--no-empty-directory", "-z"])
  ]);
  const fields = diff.split("\0");
  const written: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    // A submodule is a folder Git leaves alone, whatever it holds.
    if (!fields[index]!.startsWith(":160000 ")) {
      written.push(fields[index + 1]!);
    }
  }
  // A file still in the index can have been replaced on disk by a directory of untracked
  // files, or an untracked file can block an indexed directory. --killed also sees paths
  // marked assume-unchanged. Check whether the reset's target still needs that location.
  const obstacles = killed.split("\0").filter(Boolean);
  for (const run of chunks(obstacles, CHUNK)) {
    const names = run.map((file) => ":(literal)" + file.replace(/\/$/, ""));
    // eslint-disable-next-line no-await-in-loop
    const entries = await git.raw(["ls-tree", "-z", target, "--", ...names]);
    const directories = new Set(
      run.filter((file) => file.endsWith("/")).map((file) => file.slice(0, -1))
    );
    for (const entry of entries.split("\0").filter(Boolean)) {
      const tab = entry.indexOf("\t");
      const file = entry.slice(tab + 1);
      if (!entry.startsWith("160000 ") && !(entry.startsWith("040000 ") && directories.has(file))) {
        written.push(file);
      }
    }
  }
  if (written.length === 0) {
    return [];
  }
  const root = (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  const standing = new Set<string>();
  for (const run of chunks(written, CHUNK)) {
    // eslint-disable-next-line no-await-in-loop
    for (const found of await Promise.all(run.map((file) => standsAt(root, file)))) {
      if (found !== null) {
        standing.add(found);
      }
    }
  }
  // What stands there may be a tracked file after all, as when a file system that ignores case
  // has it under another spelling. Git says which of them it does not track.
  const inTheWay: string[] = [];
  for (const run of chunks([...standing], CHUNK)) {
    if (inTheWay.length >= limit) {
      break;
    }
    const literal = run.map((file) => ":(literal)" + file);
    // eslint-disable-next-line no-await-in-loop
    const listed = await git.raw(["ls-files", "--others", "-z", "--", ...literal]);
    const others = listed.split("\0").filter(Boolean);
    for (const file of run) {
      if (others.some((other) => other === file || other.startsWith(file + "/"))) {
        inTheWay.push(file);
      }
    }
  }
  return inTheWay.slice(0, limit);
}
