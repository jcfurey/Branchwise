import { access, stat } from "node:fs/promises";
import path from "node:path";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { searchDirectoryForRepos } from "@/backend/utils/repoSearch";
import { logger } from "@/extension/util/logger";
import { workspaceFolderPaths } from "@/extension/workspace-folders";

let cache: { key: string; repos: Promise<string[]> } | undefined;
/** Repositories outside the scan that this session opened from Source Control or File History. */
const sessionRepos = new Set<string>();
/** The repositories cloned inside each session repository, searched once per Git path and depth. */
const sessionNested = new Map<string, { key: string; repos: Promise<string[]> }>();

/**
 * Repositories under the workspace folders. Walking the folders is expensive,
 * so the result is reused until the folders, Git path or search depths change,
 * or `invalidateWorkspaceScan` reports a repository that appeared or vanished.
 */
export function scanWorkspaceRepos(
  gitPath: string,
  maxDepth: number,
  nestedDepth = 0
): Promise<string[]> {
  const folders = workspaceFolderPaths();
  const key = JSON.stringify([folders, gitPath, maxDepth, nestedDepth]);
  if (cache?.key !== key) {
    folders.forEach(warnIfUnreadable);
    const entry = { key, repos: findGitRepos(folders, gitPath, maxDepth, nestedDepth) };
    entry.repos.catch(() => {
      if (cache === entry) {
        cache = undefined;
      }
    });
    cache = entry;
  }
  return cache.repos;
}

/** The scan finds nothing in such a folder, without hiding the repositories of the others. */
function warnIfUnreadable(folder: string) {
  void stat(folder)
    .then((entry) => entry.isDirectory())
    .catch(() => false)
    .then((isDirectory) => {
      if (!isDirectory) {
        logger.warn(`Skipping workspace folder that is not a readable directory: ${folder}`);
      }
    });
}

export function invalidateWorkspaceScan(): void {
  cache = undefined;
  sessionNested.clear();
}

/** Offer `repo` for the rest of the session, even when the workspace scan does not find it. */
export function addSessionRepo(repo: string): void {
  sessionRepos.add(repo);
}

/**
 * The repositories the picker and the Workspace pane offer: the workspace scan, and this
 * session's other repositories that still exist with the repositories cloned inside them.
 */
export async function listRepos(
  gitPath: string,
  maxDepth: number,
  nestedDepth = 0
): Promise<string[]> {
  const scanned = await scanWorkspaceRepos(gitPath, maxDepth, nestedDepth);
  const extra = await Promise.all(
    [...sessionRepos]
      .filter((repo) => !scanned.includes(repo))
      .map((repo) =>
        // Worktrees and submodules have a .git file instead of a directory.
        access(path.join(repo, ".git")).then(
          () => repo,
          () => {
            sessionRepos.delete(repo);
            return null;
          }
        )
      )
  );
  const opened = extra.filter((repo): repo is string => repo !== null);
  const nested = await Promise.all(
    opened.map((repo) => nestedIn(repo, gitPath, nestedDepth).catch(() => []))
  );
  return [...new Set([...scanned, ...opened, ...nested.flat()])].toSorted((a, b) =>
    a.localeCompare(b)
  );
}

/**
 * The repositories cloned inside the session repository `repo`, and its submodules, as the scan
 * would list them.
 */
function nestedIn(repo: string, gitPath: string, nestedDepth: number): Promise<string[]> {
  if (nestedDepth <= 0) {
    return Promise.resolve([]);
  }
  const key = JSON.stringify([gitPath, nestedDepth]);
  let entry = sessionNested.get(repo);
  if (entry?.key !== key) {
    // The first one found is `repo` itself, or the work tree holding it.
    const found = searchDirectoryForRepos(repo, 0, gitPath, [], nestedDepth);
    entry = { key, repos: found.then((repos) => repos.slice(1)) };
    sessionNested.set(repo, entry);
  }
  return entry.repos;
}
