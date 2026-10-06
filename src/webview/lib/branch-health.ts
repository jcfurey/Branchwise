import type { BranchDetails } from "@/backend/types";
import type { BranchSort } from "@/types";

/** A branch whose last commit is older than this many days counts as stale. */
export const STALE_DAYS = 90;

const DAY_SECONDS = 24 * 60 * 60;

/** What the Branches pane flags about a local branch, each on its own. */
export type BranchHealth = {
  /**
   * HEAD already contains it, so deleting it loses no commits. Never true for HEAD's branch, nor
   * for a branch still at HEAD's commit, such as one just created to start new work.
   */
  merged: boolean;
  /** Its upstream was deleted on the remote. */
  gone: boolean;
  /** It and its upstream each have commits the other lacks. */
  diverged: boolean;
  /** Whole days since its last commit, when that is at least `STALE_DAYS`; otherwise `null`. */
  staleDays: number | null;
};

/**
 * The flags of `branch`, with `head` the checked-out branch and `headHash` its commit, or HEAD's
 * commit when it is detached, and `now` in seconds since 1970.
 */
export function branchHealth(
  branch: BranchDetails,
  head: string,
  headHash: string | null,
  now: number
): BranchHealth {
  const days = branch.date > 0 ? Math.floor((now - branch.date) / DAY_SECONDS) : 0;
  return {
    merged: branch.merged && branch.name !== head && branch.hash !== headHash,
    gone: branch.gone,
    diverged: !branch.gone && branch.upstream !== "" && branch.ahead > 0 && branch.behind > 0,
    staleDays: days >= STALE_DAYS ? days : null
  };
}

/** Byte order of the names, as Git lists refs. */
function byName(a: BranchDetails, b: BranchDetails) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * `branches` in the order the pane lists them: pinned branches first, in the order they were
 * pinned, then the rest by name, or by most recent commit with names breaking ties. Pins of
 * branches that no longer exist are passed over.
 */
export function orderBranches(
  branches: ReadonlyArray<BranchDetails>,
  sort: BranchSort,
  pinned: ReadonlyArray<string>
): BranchDetails[] {
  const named = new Map(branches.map((branch) => [branch.name, branch]));
  const first = pinned.flatMap((name) => named.get(name) ?? []);
  const pinnedNames = new Set(first.map((branch) => branch.name));
  const rest = branches.filter((branch) => !pinnedNames.has(branch.name));
  return [
    ...first,
    ...rest.toSorted(sort === "recent" ? (a, b) => b.date - a.date || byName(a, b) : byName)
  ];
}
