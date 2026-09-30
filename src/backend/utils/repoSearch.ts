import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";

import { getSubmodulePaths, workTreeRoot } from "@/backend/utils/git";
import { evalPromises } from "@/backend/utils/promise";
import { isRepoWithinPath, normalizeRepoPath } from "@/backend/utils/repoPath";

/** Sibling folders searched at once below each directory. */
const SIBLINGS_IN_FLIGHT = 2;

type Search = { gitPath: string; known: string[] };

/**
 * The repositories at or below `directory`, looking `maxDepth` levels down. A directory inside a
 * work tree yields that work tree's top level and its initialised submodules, and the search
 * stops there. Otherwise its subdirectories are searched in listing order, following symlinks and
 * skipping `.git`. Directories at or inside a known repository are skipped without running Git,
 * and results equal to a known repository are dropped. Each path is listed once, where it is
 * first found. Git and file-system failures only mean fewer results.
 */
export async function searchDirectoryForRepos(
  directory: string,
  maxDepth: number,
  gitPath: string,
  knownRepoPaths: string[]
): Promise<string[]> {
  const known = knownRepoPaths.map(normalizeRepoPath);
  const found = await searchFrom(directory, maxDepth, { gitPath, known });
  // A symlink, or a loop of them, can reach the same repository more than once.
  return [...new Set(found)];
}

async function searchFrom(directory: string, depth: number, search: Search): Promise<string[]> {
  const folder = normalizeRepoPath(directory);
  if (search.known.some((repo) => isRepoWithinPath(folder, repo))) {
    return [];
  }
  const root = await workTreeRoot(folder, search.gitPath);
  if (root !== null) {
    const top = normalizeRepoPath(root);
    const submodules = (await getSubmodulePaths(top, search.gitPath)).map(normalizeRepoPath);
    return [top, ...submodules].filter((repo) => !search.known.includes(repo));
  }
  if (depth <= 0) {
    return [];
  }
  const children = await subfolders(folder);
  const results = await evalPromises(children, SIBLINGS_IN_FLIGHT, (child) =>
    searchFrom(child, depth - 1, search)
  );
  return results.flat();
}

/** The directories inside `folder` in listing order, symlinks resolved, or none if unreadable. */
async function subfolders(folder: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries.filter((entry) => entry.name !== ".git");
  const isFolder = await Promise.all(
    candidates.map((entry) => leadsToFolder(entry, `${folder}/${entry.name}`))
  );
  return candidates.filter((_, index) => isFolder[index]).map((entry) => `${folder}/${entry.name}`);
}

async function leadsToFolder(entry: Dirent, location: string): Promise<boolean> {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  // `stat` follows the link; a broken one fails and is skipped.
  return stat(location).then(
    (target) => target.isDirectory(),
    () => false
  );
}
