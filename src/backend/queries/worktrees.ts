import { stat } from "node:fs/promises";

import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";
import { loadWorktrees } from "@/backend/queries/repository";
import type { WorktreeChange, WorktreeDetails } from "@/backend/types";
import { evalPromises } from "@/backend/utils/promise";
import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { readDirectory, readGitWithTimeout } from "@/backend/utils/runGit";

/** At most this many worktrees are checked for changes; the rest are reported unchecked. */
export const WORKTREE_CHECK_LIMIT = 20;
/** How many worktrees are checked at once. */
const PARALLEL_CHECKS = 4;
/** How long one worktree may take, in milliseconds, before it counts as unchecked. */
export const WORKTREE_CHECK_TIMEOUT = 3000;

/**
 * Whether `folder` is there, or `null` when the file system has not answered within `timeout`,
 * as a network drive that is not responding may not. The question cannot be withdrawn, so a
 * late answer is dropped.
 */
async function folderExists(folder: string, timeout: number): Promise<boolean | null> {
  const { promise: late, resolve } = Promise.withResolvers<null>();
  const timer = setTimeout(() => resolve(null), timeout);
  try {
    return await Promise.race([
      stat(folder).then(
        (entry) => entry.isDirectory(),
        () => false
      ),
      late
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the worktree at `folder` has uncommitted changes to tracked files. Untracked files are
 * left out, which spares Git the walk through every folder that dominates `git status` in a
 * large tree. Like every read, it runs with `--no-optional-locks`, so Git does not write the
 * refreshed index back.
 */
async function hasChanges(git: SimpleGit, folder: string, timeout: number) {
  try {
    const output = await readGitWithTimeout(
      git,
      ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
      folder,
      timeout
    );
    return output === null ? null : output.stdout !== "";
  } catch {
    // Cancelling the read stops everything; a worktree Git cannot read is only left unchecked.
    gitProcessOf(git)?.abort?.throwIfAborted();
    return null;
  }
}

/**
 * Whether each worktree other than the one `git` runs in has uncommitted changes. A worktree
 * whose folder is gone is reported missing and never visited, a bare repository has no work tree
 * to check, and only the first `limit` worktrees that are there are checked, a few at a time,
 * each for at most `timeout` milliseconds in all; the rest are reported unchecked. Nothing on
 * disk changes.
 */
export async function loadWorktreeChanges(
  git: SimpleGit,
  limit = WORKTREE_CHECK_LIMIT,
  timeout = WORKTREE_CHECK_TIMEOUT
): Promise<WorktreeChange[]> {
  const [worktrees, shown] = await Promise.all([loadWorktrees(git), readDirectory(git)]);
  const current = normalizeRepoPath(shown);
  const others = worktrees.filter((worktree) => !worktree.bare && worktree.path !== current);
  let checked = 0;
  return evalPromises(others, PARALLEL_CHECKS, async (worktree: WorktreeDetails) => {
    const { path } = worktree;
    const started = Date.now();
    const exists = worktree.prunable ? false : await folderExists(path, timeout);
    if (exists === false) {
      return { path, state: "missing" as const };
    }
    if (exists === null || checked >= limit) {
      return { path, state: "unchecked" as const };
    }
    checked++;
    const changed = await hasChanges(git, path, Math.max(timeout - (Date.now() - started), 1));
    return { path, state: changed === null ? "unchecked" : changed ? "dirty" : "clean" };
  });
}
