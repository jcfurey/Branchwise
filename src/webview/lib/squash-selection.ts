import type { GitCommitNode } from "@/backend/types";

/**
 * What squashing the selected commits would rebase: the parent of the oldest selected commit and
 * the selected commits, oldest first. Otherwise, why they cannot be squashed.
 */
export type SquashSelection = { base: string; hashes: string[] } | { reason: string };

/**
 * Whether the selected commits can be squashed into one with an interactive rebase, judged from
 * the loaded graph. They must run without a gap down the current branch's first-parent line from
 * HEAD, so the rebase moves nothing the user did not choose, and they and the commits after them
 * must be free of merges, which an interactive plan refuses. The backend checks the same again
 * against the repository when it builds the plan.
 */
export function squashSelection(
  selected: ReadonlyArray<GitCommitNode>,
  rows: ReadonlyArray<GitCommitNode>,
  head: string | null,
  branch: string | null
): SquashSelection {
  const l10n = window.l10n;
  if (selected.length < 2) {
    return { reason: l10n.squashNeedsTwo };
  }
  if (head === null || branch === null) {
    return { reason: l10n.squashNeedsBranch };
  }
  if (selected.some((commit) => commit.parentHashes.length > 1)) {
    return { reason: l10n.squashMergeSelected };
  }
  if (selected.some((commit) => commit.parentHashes.length === 0)) {
    return { reason: l10n.squashRootSelected };
  }
  // Graph rows win over the selection's own copies: a history search may report simplified
  // parents.
  const commits = new Map(selected.map((commit) => [commit.hash, commit]));
  for (const row of rows) {
    commits.set(row.hash, row);
  }
  const wanted = new Set(selected.map((commit) => commit.hash));
  // The selected commits as met walking down from HEAD, newest first.
  const found: GitCommitNode[] = [];
  let gap = false;
  let mergeAfter = false;
  let at: string | undefined = head;
  while (at !== undefined && found.length < wanted.size) {
    const commit = commits.get(at);
    if (commit === undefined) {
      break;
    }
    if (wanted.has(at)) {
      found.push(commit);
    } else if (found.length > 0) {
      gap = true;
    } else if (commit.parentHashes.length > 1) {
      mergeAfter = true;
    }
    at = commit.parentHashes[0];
  }
  if (found.length < wanted.size) {
    return { reason: l10n.squashOtherBranch };
  }
  if (gap) {
    return { reason: l10n.squashNotConsecutive };
  }
  if (mergeAfter) {
    return { reason: l10n.squashMergeAfter };
  }
  const oldest = found.at(-1)!;
  return { base: oldest.parentHashes[0]!, hashes: found.map((commit) => commit.hash).toReversed() };
}
