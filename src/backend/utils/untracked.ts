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
 * Only paths that `target` has and the index has not are looked at, so the cost follows the
 * size of the change and not the number of untracked files, such as a dependencies folder.
 */
export async function untrackedInTheWay(git: SimpleGit, target: string, limit = 20) {
  // From the commit to the index, a path only the commit has reads as deleted. Each record is
  // `:<mode in the commit> <mode in the index> <id> <id> D`, then the path.
  const fields = (
    await git.raw([
      "diff",
      "--cached",
      "--raw",
      "--no-renames",
      "--no-abbrev",
      "--diff-filter=D",
      "-z",
      target,
      "--"
    ])
  ).split("\0");
  const written: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    // A submodule is a folder Git leaves alone, whatever it holds.
    if (!fields[index]!.startsWith(":160000 ")) {
      written.push(fields[index + 1]!);
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
