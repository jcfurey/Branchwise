import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";
import { readGitCode } from "@/backend/utils/runGit";

/** Branches checked at most, those with the newest commits first. */
export const CONFLICT_FORECAST_LIMIT = 50;

/** Merges run at once. */
const PARALLEL = 4;

/** Results remembered at most, oldest dropped first. */
const CACHE_SIZE = 1000;

/**
 * Files in conflict by the pair of commits merged, or `null` for a merge Git could not try, such
 * as one between unrelated histories. Both commits are fixed, so the answer never goes stale.
 */
const cache = new Map<string, string[] | null>();

/** Whether each Git executable has `merge-tree --write-tree`, which came in Git 2.38. */
const support = new Map<string, Promise<boolean>>();

async function supportsWriteTree(git: SimpleGit) {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const pending = support.get(binary);
  if (pending !== undefined) {
    try {
      return await pending;
    } catch {
      // Another request's check failed, perhaps because that request was cancelled.
    }
  }
  const supported = git.raw(["--version"]).then((output) => {
    const [major = 0, minor = 0] = (output.match(/(\d+)\.(\d+)/)?.slice(1) ?? []).map(Number);
    return major > 2 || (major === 2 && minor >= 38);
  });
  support.set(binary, supported);
  // A check that failed is tried again next time.
  supported.catch(() => {
    if (support.get(binary) === supported) {
      support.delete(binary);
    }
  });
  return supported;
}

/**
 * The files that merging `tip` into `head` would leave in conflict, from a merge Git runs
 * entirely in memory: the work tree, the index and every ref stay as they are.
 */
async function conflictedFiles(git: SimpleGit, head: string, tip: string) {
  const key = `${head}:${tip}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  let files: string[] | null;
  try {
    const { stdout, code } = await readGitCode(
      git,
      ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", head, tip],
      [0, 1]
    );
    // The new tree's ID, then each conflicted path, all ending in NUL.
    files = code === 0 ? [] : stdout.split("\0").slice(1).filter(Boolean);
  } catch (error) {
    // A merge stopped because its request was cancelled says nothing about the commits.
    if (gitProcessOf(git)?.abort?.aborted === true) {
      throw error;
    }
    files = null;
  }
  if (cache.size >= CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, files);
  return files;
}

/**
 * The local branches that would not merge cleanly into HEAD, each with its conflicted files.
 * Only branches HEAD does not contain yet are tried, so HEAD's own branch never is. Empty when
 * HEAD has no commit yet, or when Git is older than 2.38.
 */
export async function loadConflictForecast(
  git: SimpleGit
): Promise<Array<{ branch: string; files: string[] }>> {
  if (!(await supportsWriteTree(git))) {
    return [];
  }
  const head = (
    await git.raw(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch(() => "")
  ).trim();
  if (head === "") {
    return [];
  }
  const listed = await git.raw([
    "for-each-ref",
    `--no-merged=${head}`,
    "--sort=-committerdate",
    `--count=${CONFLICT_FORECAST_LIMIT}`,
    "--format=%(refname:lstrip=2)%00%(objectname)",
    "refs/heads/"
  ]);
  const branches = listed
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [branch = "", tip = ""] = line.split("\0");
      return { branch, tip };
    });
  const conflicts: Array<{ branch: string; files: string[] }> = [];
  for (let start = 0; start < branches.length; start += PARALLEL) {
    // A few merges at a time, so that a repository with many branches stays responsive.
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      branches
        .slice(start, start + PARALLEL)
        .map(async ({ branch, tip }) => ({ branch, files: await conflictedFiles(git, head, tip) }))
    );
    for (const { branch, files } of results) {
      if (files !== null && files.length > 0) {
        conflicts.push({ branch, files });
      }
    }
  }
  return conflicts;
}
