import type { Dirent } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";

import { getSubmodulePaths, workTreeRoot } from "@/backend/utils/git";
import { evalPromises } from "@/backend/utils/promise";
import { isRepoWithinPath, normalizeRepoPath } from "@/backend/utils/repoPath";

/** Sibling folders searched at once below each directory. */
const SIBLINGS_IN_FLIGHT = 2;

/**
 * Folders inside a work tree that the search for nested repositories never enters: dependency
 * stores, and hidden folders such as `.git`, `.venv` or `.cache`.
 */
const NOT_NESTED = new Set(["node_modules", "bower_components"]);

type Search = { gitPath: string; known: string[]; nestedDepth: number };

/**
 * The repositories at or below `directory`, looking `maxDepth` levels down. A directory inside a
 * work tree yields that work tree's top level and its initialised submodules, and the search
 * stops there. Otherwise its subdirectories are searched in listing order, following symlinks and
 * skipping `.git`. Directories at or inside a known repository are skipped without running Git,
 * and results equal to a known repository are dropped. Each path is listed once, where it is
 * first found. Git and file-system failures only mean fewer results.
 *
 * With `nestedDepth` above 0, each work tree found is also searched `nestedDepth` levels down for
 * standalone repositories cloned inside it, which are listed after it with their own submodules
 * and nested repositories. Only folders holding a `.git` folder count, so worktrees and
 * submodules, which hold a `.git` file, are not found this way. That search runs no Git process
 * for the folders it passes, does not follow symlinks, and skips hidden folders and `NOT_NESTED`.
 */
export async function searchDirectoryForRepos(
  directory: string,
  maxDepth: number,
  gitPath: string,
  knownRepoPaths: string[],
  nestedDepth = 0
): Promise<string[]> {
  const known = knownRepoPaths.map(normalizeRepoPath);
  const found = await searchFrom(directory, maxDepth, { gitPath, known, nestedDepth });
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
    return workTree(normalizeRepoPath(root), search);
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

/** The work tree `top`, its submodules and the repositories nested in it, except known ones. */
async function workTree(top: string, search: Search): Promise<string[]> {
  const [submodules, nested] = await Promise.all([
    getSubmodulePaths(top, search.gitPath),
    searchNested(top, search.nestedDepth, search)
  ]);
  return [top, ...submodules.map(normalizeRepoPath), ...nested].filter(
    (repo) => !search.known.includes(repo)
  );
}

/** The repositories cloned inside the work tree folder `folder`, `depth` levels down. */
async function searchNested(folder: string, depth: number, search: Search): Promise<string[]> {
  if (depth <= 0) {
    return [];
  }
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const children = entries
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(".") && !NOT_NESTED.has(entry.name)
    )
    .map((entry) => `${folder}/${entry.name}`);
  const results = await evalPromises(children, SIBLINGS_IN_FLIGHT, async (child) =>
    (await isOwnWorkTree(child, search.gitPath))
      ? workTree(normalizeRepoPath(child), search)
      : searchNested(child, depth - 1, search)
  );
  return results.flat();
}

/**
 * Whether `folder` holds a `.git` folder that Git takes for its own repository. A stray or broken
 * `.git` folder leads Git to an enclosing work tree instead, and the search carries on below it.
 */
async function isOwnWorkTree(folder: string, gitPath: string): Promise<boolean> {
  const holdsGitFolder = await lstat(`${folder}/.git`).then(
    (entry) => entry.isDirectory(),
    () => false
  );
  if (!holdsGitFolder) {
    return false;
  }
  const root = await workTreeRoot(folder, gitPath);
  return root !== null && normalizeRepoPath(root) === normalizeRepoPath(folder);
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
