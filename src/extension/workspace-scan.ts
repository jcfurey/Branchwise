import { access, stat } from "node:fs/promises";
import path from "node:path";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { logger } from "@/extension/util/logger";
import { workspaceFolderPaths } from "@/extension/workspace-folders";

let cache: { key: string; repos: Promise<string[]> } | undefined;
/** Repositories outside the scan that this session opened from Source Control or File History. */
const sessionRepos = new Set<string>();

/**
 * Repositories under the workspace folders. Walking the folders is expensive,
 * so the result is reused until the folders, Git path or search depth change,
 * or `invalidateWorkspaceScan` reports a repository that appeared or vanished.
 */
export function scanWorkspaceRepos(gitPath: string, maxDepth: number): Promise<string[]> {
  const folders = workspaceFolderPaths();
  const key = JSON.stringify([folders, gitPath, maxDepth]);
  if (cache?.key !== key) {
    folders.forEach(warnIfUnreadable);
    const entry = { key, repos: findGitRepos(folders, gitPath, maxDepth) };
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
}

/** Offer `repo` for the rest of the session, even when the workspace scan does not find it. */
export function addSessionRepo(repo: string): void {
  sessionRepos.add(repo);
}

/**
 * The repositories the picker and the Workspace pane offer: the workspace scan and this
 * session's other repositories that still exist.
 */
export async function listRepos(gitPath: string, maxDepth: number): Promise<string[]> {
  const scanned = await scanWorkspaceRepos(gitPath, maxDepth);
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
  return [...scanned, ...extra.filter((repo): repo is string => repo !== null)].toSorted((a, b) =>
    a.localeCompare(b)
  );
}
