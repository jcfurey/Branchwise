import type { SimpleGit } from "simple-git";

import type { TreeEntry } from "@/backend/types";
import { literalPath } from "@/backend/utils/history";
import { readBlob, readGitRecords } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/**
 * How many entries of a commit's tree are listed at most. The page builds its folders lazily, so
 * the limit is about the size of the answer: a few megabytes of JSON at the most.
 */
export const TREE_LIMIT = 50_000;

/** What each mode `ls-tree` prints stands for. Any other blob mode is an ordinary file. */
const KINDS: Record<string, TreeEntry["kind"]> = {
  "100755": "executable",
  "120000": "symlink",
  "160000": "submodule"
};

/** `<mode> SP <type> SP <object> SP+ <size>` before the tab, as `ls-tree --long` prints it. */
const RECORD = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40,64}) +(\d+|-)$/;

/**
 * One NUL-terminated record of `git ls-tree -z --long`, with the object it names, or null for
 * anything that is not a file, a symbolic link or a submodule. The path is everything after the
 * first tab, taken as it is: with `-z`, Git neither quotes nor escapes it.
 */
export function parseTreeRecord(record: Buffer): { entry: TreeEntry; object: string } | null {
  const tab = record.indexOf(9);
  if (tab === -1) {
    return null;
  }
  const match = RECORD.exec(record.toString("latin1", 0, tab));
  if (match === null) {
    return null;
  }
  const [, mode = "", type, object = "", size = ""] = match;
  const kind = KINDS[mode] ?? "file";
  if (kind === "submodule" ? type !== "commit" : type !== "blob") {
    return null;
  }
  const path = record.toString("utf8", tab + 1);
  const entry: TreeEntry =
    kind === "submodule"
      ? { path, kind, size: null, commit: object }
      : { path, kind, size: Number(size) };
  return { entry, object };
}

/**
 * Every file of the commit `revision` names, in Git's tree order, up to `limit` of them. Paths
 * are relative to the repository's root wherever Git runs, thanks to `--full-tree`.
 */
export async function loadTree(git: SimpleGit, revision: string, limit = TREE_LIMIT) {
  const hash = await resolveCommit(git, revision);
  const { records, more } = await readGitRecords(
    git,
    ["ls-tree", "-r", "-z", "--full-tree", "--long", hash],
    limit
  );
  const entries = records.flatMap((record) => parseTreeRecord(record)?.entry ?? []);
  return { hash, entries, more };
}

/**
 * The bytes of `file` at the commit `revision` names, when it is a regular or executable file
 * there. Above `cap` bytes only its size is read. Null when the commit has no such file, or the
 * path is a symbolic link or a submodule, which hold no contents of their own.
 */
export async function readFileAt(
  git: SimpleGit,
  revision: string,
  file: string,
  cap: number
): Promise<{ size: number; bytes: Buffer | null } | null> {
  const hash = await resolveCommit(git, revision);
  const { records } = await readGitRecords(
    git,
    ["ls-tree", "-z", "--full-tree", "--long", hash, "--", literalPath(file)],
    1
  );
  const found = records[0] === undefined ? null : parseTreeRecord(records[0]);
  const size = found?.entry.size ?? null;
  if (found === null || found.entry.path !== file || found.entry.kind === "symlink") {
    return null;
  }
  if (size === null) {
    return null;
  }
  return { size, bytes: size > cap ? null : await readBlob(git, found.object) };
}
