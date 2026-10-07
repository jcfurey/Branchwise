import type { WorkspaceEntry } from "@/backend/types";

/** The totals of the Workspace overview, each of which can narrow the tree to its repositories. */
export type WorkspaceFilter = "attention" | "conflicted" | "behind" | "unpushed" | "changes";
export type WorkspaceOrder = "name" | "attention";

export const WORKSPACE_FILTERS: readonly WorkspaceFilter[] = [
  "attention",
  "unpushed",
  "behind",
  "conflicted",
  "changes"
];

/** A fetch older than this is worth mentioning on the row. */
export const STALE_FETCH_SECONDS = 24 * 60 * 60;

/** A merge, rebase, pick, revert or bisect stopped partway, or files left unmerged. */
export function isConflicted(entry: WorkspaceEntry) {
  return entry.operation !== null || entry.conflicts > 0;
}

/**
 * The checked-out branch has commits but no upstream, in a repository that has somewhere to
 * publish it. A repository without remotes is local by choice, and a detached HEAD has no branch.
 */
export function isUnpublished(entry: WorkspaceEntry) {
  return (
    entry.initialized &&
    entry.branch !== "" &&
    entry.head !== null &&
    entry.upstream === null &&
    entry.remotes > 0
  );
}

/** Commits that no remote has yet, on the checked-out branch or on another one. */
export function isUnpushed(entry: WorkspaceEntry) {
  return entry.ahead > 0 || entry.aheadBranches > 0 || isUnpublished(entry);
}

/** The rank of a repository with nothing to attend to. */
const CLEAN = 5;

/**
 * How urgent a repository is, lowest first: work stopped partway, then commits to pull, then
 * commits to push, then uncommitted changes, then a repository that could not be read.
 */
export function attentionRank(entry: WorkspaceEntry): number {
  if (isConflicted(entry)) {
    return 0;
  }
  if (entry.behind > 0) {
    return 1;
  }
  if (isUnpushed(entry)) {
    return 2;
  }
  if (entry.dirty > 0) {
    return 3;
  }
  return entry.error === null ? CLEAN : 4;
}

export function matchesFilter(entry: WorkspaceEntry, filter: WorkspaceFilter): boolean {
  switch (filter) {
    case "conflicted":
      return isConflicted(entry);
    case "behind":
      return entry.behind > 0;
    case "unpushed":
      return isUnpushed(entry);
    case "changes":
      return entry.dirty > 0;
    case "attention":
      return attentionRank(entry) < CLEAN;
  }
}

/** How many repositories each total of the overview counts. */
export function workspaceTotals(entries: readonly WorkspaceEntry[]) {
  return Object.fromEntries(
    WORKSPACE_FILTERS.map((filter) => [
      filter,
      entries.filter((entry) => matchesFilter(entry, filter)).length
    ])
  ) as Record<WorkspaceFilter, number>;
}

/**
 * Siblings in the order asked for. By urgency, a row takes the most urgent rank of itself and the
 * rows below it, so a clean superproject with a conflicted submodule still comes first. Ties keep
 * the order by path.
 */
export function sortSiblings(
  siblings: readonly WorkspaceEntry[],
  order: WorkspaceOrder,
  childrenOf: (entry: WorkspaceEntry) => readonly WorkspaceEntry[]
): WorkspaceEntry[] {
  if (order === "name") {
    return [...siblings];
  }
  const ranks = new Map<string, number>();
  const rank = (entry: WorkspaceEntry): number => {
    let value = ranks.get(entry.path);
    if (value === undefined) {
      value = Math.min(attentionRank(entry), ...childrenOf(entry).map(rank));
      ranks.set(entry.path, value);
    }
    return value;
  };
  return siblings.toSorted((a, b) => rank(a) - rank(b));
}
