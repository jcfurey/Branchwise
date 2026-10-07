import type { GitCommitNode, GitRef } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";

/**
 * How a branch tip reaches a commit: through how many merges (steps to a second or later
 * parent) and in how many steps altogether. A path with fewer merges is always nearer, so a
 * first-parent walk wins over any path through a merge, however long.
 */
type Reach = { ref: GitRef; merges: number; steps: number };

/** A remote's `HEAD`, such as `origin/HEAD`, only names a branch and is never one itself. */
function isBranch(ref: GitRef) {
  return ref.type === "head" || (ref.type === "remote" && !ref.name.endsWith("/HEAD"));
}

/** The name of `ref` as the branch list spells it: `remotes/<remote>/<branch>` for a remote one. */
function listName(ref: GitRef) {
  return ref.type === "remote" ? `remotes/${ref.name}` : ref.name;
}

/**
 * Whether `a` is nearer than `b`. At the same distance the checked-out branch wins, then a local
 * branch over a remote one, then the name that sorts first.
 */
function nearer(a: Reach, b: Reach | undefined, headBranch: string | null) {
  if (b === undefined) {
    return true;
  }
  if (a.merges !== b.merges) {
    return a.merges < b.merges;
  }
  if (a.steps !== b.steps) {
    return a.steps < b.steps;
  }
  const current = (reach: Reach) => reach.ref.type === "head" && reach.ref.name === headBranch;
  if (current(a) !== current(b)) {
    return current(a);
  }
  if (a.ref.type !== b.ref.type) {
    return a.ref.type === "head";
  }
  return a.ref.name < b.ref.name;
}

/**
 * For each loaded commit that carries no branch label of its own, the name of the nearest branch
 * that contains it, by hash: the tip reached in the fewest first-parent steps going up from the
 * commit, as a remote branch's label spells it (`origin/main`). Commits that no shown branch
 * reaches within the loaded rows are left out, and so are those of branches `isHidden` hides.
 *
 * One pass from the top: the rows are in graph order, children above parents, so each row has
 * heard from all its children when it is reached and hands its nearest branch on to its
 * parents. A parent not below its child, as clock skew can give, is skipped, as the layout
 * skips it. The cost is one step per parent link.
 */
export function nearestBranches(
  commits: ReadonlyArray<GitCommitNode>,
  headBranch: string | null,
  isHidden: (branch: string) => boolean = () => false
): Map<string, string> {
  const rowOf = new Map<string, number>();
  commits.forEach((commit, row) => rowOf.set(commit.hash, row));
  const best: Array<Reach | undefined> = Array.from({ length: commits.length });
  const nearest = new Map<string, string>();
  for (const [row, commit] of commits.entries()) {
    if (commit.hash === UNCOMMITTED_CHANGES) {
      continue;
    }
    let labelled = false;
    for (const ref of commit.refs) {
      if (!isBranch(ref) || isHidden(listName(ref))) {
        continue;
      }
      labelled = true;
      const own: Reach = { ref, merges: 0, steps: 0 };
      if (nearer(own, best[row], headBranch)) {
        best[row] = own;
      }
    }
    const reach = best[row];
    if (reach === undefined) {
      continue;
    }
    if (!labelled) {
      nearest.set(commit.hash, reach.ref.name);
    }
    commit.parentHashes.forEach((hash, index) => {
      const parent = rowOf.get(hash);
      if (parent === undefined || parent <= row) {
        return;
      }
      const onward: Reach = {
        ref: reach.ref,
        merges: reach.merges + (index > 0 ? 1 : 0),
        steps: reach.steps + 1
      };
      if (nearer(onward, best[parent], headBranch)) {
        best[parent] = onward;
      }
    });
  }
  return nearest;
}
