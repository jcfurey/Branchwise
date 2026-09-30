import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { HistoryEntry, HistoryPage } from "@/backend/types";

export const HISTORY_PAGE_SIZE = 100;
export const HISTORY_FORMAT = "NGG-HISTORY%x00%H%x00%P%x00%an%x00%ae%x00%at%x00%s";

export function pageOffset(offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error(l10n.t("Invalid history page."));
  }
  return offset;
}

/** NUL fields preserve tabs and newlines in file names and commit subjects. */
export function parseHistory(text: string): HistoryEntry[] {
  const fields = text.split("\0");
  const entries: HistoryEntry[] = [];
  for (let index = 0; index < fields.length;) {
    const token = fields[index++]!;
    if (token === "" || token === "\n") {
      continue;
    }
    if (token === "NGG-HISTORY" || token === "\nNGG-HISTORY") {
      const [hash, parents, author, email, date, message] = fields.slice(index, index + 6);
      if (!hash || !/^[0-9a-f]{40,64}$/.test(hash) || message === undefined) {
        throw new Error(l10n.t("Git returned an incomplete history record."));
      }
      entries.push({
        hash,
        parentHashes: parents ? parents.split(" ") : [],
        author: author!,
        email: email!,
        date: Number(date),
        message,
        refs: []
      });
      index += 6;
    } else {
      const status = token.replace(/^\n/, "");
      if (!/^[ACDMRTUXB][0-9]*$/.test(status) || entries.length === 0) {
        throw new Error(l10n.t("Git returned an unexpected history record."));
      }
      const before = fields[index++]!;
      const after = /^[RC]/.test(status) ? fields[index++]! : before;
      Object.assign(entries.at(-1)!, { previousPath: before, filePath: after, change: status });
    }
  }
  return entries;
}

export function historyPage(entries: HistoryEntry[]): HistoryPage {
  return { entries: entries.slice(0, HISTORY_PAGE_SIZE), more: entries.length > HISTORY_PAGE_SIZE };
}

export function repoFile(value: string) {
  const file = path.sep === "\\" ? value.replaceAll("\\", "/") : value;
  if (
    !file ||
    file.includes("\0") ||
    path.isAbsolute(file) ||
    file
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  ) {
    throw new Error(l10n.t("Choose a file path inside the repository."));
  }
  return file;
}

export const literalPath = (value: string) => ":(literal)" + repoFile(value);

/**
 * Refuse traversal through a symlink, a submodule, or a nested repository: the superproject's
 * status cannot see local changes inside another repository. Git may create missing parent
 * directories.
 */
export async function checkedWorktreePath(git: SimpleGit, file: string) {
  const root = (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  const relative = repoFile(file);
  const parents = relative
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  for (const parent of parents) {
    const directory = path.join(root, parent);
    try {
      // Validate each ancestor before inspecting anything below it.
      // eslint-disable-next-line no-await-in-loop
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(l10n.t("A parent of this file is not a normal directory."));
      }
      // eslint-disable-next-line no-await-in-loop
      if (await lstat(path.join(directory, ".git")).then(Boolean, () => false)) {
        throw nestedRepositoryError();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  // An index entry at a parent path is a gitlink, which marks a submodule even before it is
  // checked out, or a file whose directory would replace it.
  const entries = await Promise.all(
    parents.map((parent) =>
      git.raw(["rev-parse", "--verify", "--quiet", `:0:${parent}`]).catch(() => "")
    )
  );
  const entry = parents.find((_, index) => entries[index]!.trim() !== "");
  if (entry !== undefined) {
    const stage = await git.raw(["ls-files", "--stage", "-z", "--", literalPath(entry)]);
    throw stage.startsWith("160000 ")
      ? nestedRepositoryError()
      : new Error(l10n.t("A parent of this file is not a normal directory."));
  }
  return path.join(root, relative);
}

function nestedRepositoryError() {
  return new Error(
    l10n.t("This file is inside a submodule or nested repository. Open that repository instead.")
  );
}

export async function fileSnapshot(git: SimpleGit, file: string) {
  const absolute = await checkedWorktreePath(git, file);
  const digest = createHash("sha256");
  try {
    const stat = await lstat(absolute);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error(l10n.t("Choose a file, not a directory."));
    }
    digest.update(String(stat.mode));
    digest.update(stat.isSymbolicLink() ? await readlink(absolute) : await readFile(absolute));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    digest.update("missing");
  }
  digest.update(await git.raw(["ls-files", "--stage", "-z", "--", literalPath(file)]));
  return digest.digest("hex");
}

/**
 * Whether restoring would replace contents that the file's stage-0 index entry does not hold.
 * `git status` does not report skip-worktree or assume-unchanged files, and a case-insensitive
 * or Unicode-normalizing filesystem can resolve the requested name to a different file.
 */
export async function differsFromIndex(git: SimpleGit, file: string) {
  const absolute = await checkedWorktreePath(git, file);
  const stat = await lstat(absolute).catch(() => null);
  if (stat === null) {
    return false;
  }
  // Compare each on-disk name within the repository with the requested one.
  let current = absolute;
  for (const _ of repoFile(file).split("/")) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await readdir(path.dirname(current))).includes(path.basename(current))) {
      return true;
    }
    current = path.dirname(current);
  }
  const entry = /^(\d{6}) ([0-9a-f]{40,64}) 0\t/.exec(
    await git.raw(["ls-files", "--stage", "-z", "--", literalPath(file)])
  );
  if (!entry) {
    return true;
  }
  const [, mode, blob] = entry;
  if (stat.isSymbolicLink()) {
    return (
      mode !== "120000" ||
      (await readlink(absolute)) !== (await git.raw(["cat-file", "blob", blob!]))
    );
  }
  // Hashing applies the same clean filters and line-ending conversion as `git add`.
  return (await git.raw(["hash-object", "--", absolute])).trim() !== blob;
}
