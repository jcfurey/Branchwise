import { computed } from "@preact/signals";

import type { GitRef } from "@/backend/types";
import {
  matchesRemoteBranch,
  patternMatcher,
  suggestedPattern
} from "@/backend/utils/branchPatterns";
import { remoteForRef } from "@/backend/utils/remoteVisibility";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import { repositoryState } from "@/webview/lib/repository-actions";
import {
  branchList,
  headBranch,
  hiddenBranchPatterns,
  hiddenRemotes,
  remoteVisibilityKey,
  selectedBranch,
  showRemoteBranch
} from "@/webview/lib/stores";

// Which branches the hidden-branch patterns hide, as the page shows it. The extension leaves the
// same branches out of the graph; both match names with `branchPatterns.ts`. This module is part
// of an import cycle through the actions, so its top level creates computed values only.

/** A test for a name against the hidden-branch patterns, or `null` while none is set. */
export const hiddenBranchMatcher = computed(() => patternMatcher(hiddenBranchPatterns.value));

/* What the graph is asked for */

/**
 * The chosen branch when the hidden-branch patterns may match it, so the graph has to name it
 * to keep it shown; `undefined` otherwise. A remote branch is tested after each `/` of its name,
 * as the remote's own name may hold one; the extension then decides which part is the remote.
 * The checked-out branch is named too, so that a checkout leaves the key alone.
 */
export function patternShownBranch(): string | undefined {
  const matches = hiddenBranchMatcher.value;
  const branch = selectedBranch.value;
  if (matches === null || branch === undefined || branch === SHOW_ALL_BRANCHES) {
    return undefined;
  }
  if (!branch.startsWith("remotes/")) {
    return matches(branch) ? branch : undefined;
  }
  const parts = branch.slice("remotes/".length).split("/");
  return parts.some((_, at) => at > 0 && matches(parts.slice(at).join("/"))) ? branch : undefined;
}

/**
 * The key the graph rows are requested and answered with: the remote choice's, and while any
 * hidden-branch pattern is set, the patterns and the branch they must not hide. With no pattern
 * it is the remote choice's key unchanged.
 */
export function graphVisibilityKey(): string {
  if (hiddenBranchMatcher.value === null) {
    return remoteVisibilityKey();
  }
  return JSON.stringify([
    showRemoteBranch.value,
    hiddenRemotes.value.toSorted(),
    hiddenBranchPatterns.value,
    patternShownBranch() ?? null
  ]);
}

/**
 * The hidden-branch fields of a graph, history or statistics request. Left out while no pattern
 * is set, so requests read as they did before patterns existed.
 */
export function branchPatternScope(): { hiddenBranchPatterns?: string[]; shownBranch?: string } {
  if (hiddenBranchMatcher.value === null) {
    return {};
  }
  const shown = patternShownBranch();
  return {
    hiddenBranchPatterns: hiddenBranchPatterns.value,
    ...(shown === undefined ? {} : { shownBranch: shown })
  };
}

/* What the page lists */

/**
 * The remotes that can own a remote-tracking branch, as the extension counts them: the configured
 * and hidden ones, and the first segment of a ref whose remote is gone. `known` leaves out the
 * last kind, for `remoteForRef`.
 */
const remoteOwners = computed(() => {
  const state = repositoryState.value;
  const known = [...(state?.remotes.map((remote) => remote.name) ?? []), ...hiddenRemotes.value];
  const owners = new Set(known);
  for (const ref of state?.remoteBranches ?? []) {
    owners.add(remoteForRef(ref.name, known));
  }
  return { known, owners };
});

/**
 * Whether `matches` (by default the stored patterns) matches a branch spelt as in the branch list,
 * `remotes/<remote>/<branch>` for a remote one, whichever branch it is.
 */
export function matchesHiddenPatterns(
  branch: string,
  matches: ((name: string) => boolean) | null = hiddenBranchMatcher.value
): boolean {
  if (matches === null) {
    return false;
  }
  if (!branch.startsWith("remotes/")) {
    return matches(branch);
  }
  const name = branch.slice("remotes/".length);
  const { known, owners } = remoteOwners.value;
  return matchesRemoteBranch(name, [...owners, remoteForRef(name, known)], matches);
}

/** The checked-out branch and the chosen one stay shown whatever the patterns say. */
function alwaysShown(branch: string) {
  return (
    branch === headBranch.value ||
    branch === repositoryState.value?.head ||
    branch === selectedBranch.value
  );
}

/** Whether the patterns keep `branch`, spelt as in the branch list, out of the graph. */
export function isBranchHidden(branch: string): boolean {
  return !alwaysShown(branch) && matchesHiddenPatterns(branch);
}

/** Whether the chosen branch is shown only because it is chosen: a pattern would hide it. */
export const selectionOverridesPatterns = computed(() => {
  const branch = selectedBranch.value;
  return (
    branch !== undefined &&
    branch !== headBranch.value &&
    branch !== repositoryState.value?.head &&
    matchesHiddenPatterns(branch)
  );
});

/** The branch list less the branches the patterns hide, for the pickers. */
export const visibleBranchList = computed(() => {
  const branches = branchList.value;
  if (branches === undefined || hiddenBranchMatcher.value === null) {
    return branches;
  }
  return branches.filter((branch) => !isBranchHidden(branch));
});

/**
 * How many listed branches `matches` would hide: local ones, and remote ones while their remote
 * is shown, less the checked-out and chosen branches.
 */
export function countHiddenBranches(matches: ((name: string) => boolean) | null): number {
  const state = repositoryState.value;
  if (state === null || matches === null) {
    return 0;
  }
  const hides = (branch: string) => !alwaysShown(branch) && matchesHiddenPatterns(branch, matches);
  let count = state.branches.filter((branch) => hides(branch.name)).length;
  if (showRemoteBranch.value) {
    const { known } = remoteOwners.value;
    const hidden = hiddenRemotes.value;
    count += state.remoteBranches.filter(
      (ref) => !hidden.includes(remoteForRef(ref.name, known)) && hides("remotes/" + ref.name)
    ).length;
  }
  return count;
}

/** How many listed branches the stored patterns hide. */
export const hiddenBranchCount = computed(() => countHiddenBranches(hiddenBranchMatcher.value));

/** The pattern offered for hiding branches like a branch label: see `suggestedPattern`. */
export function patternLike(gitRef: GitRef): string {
  if (gitRef.type !== "remote") {
    return suggestedPattern(gitRef.name);
  }
  const remote = remoteForRef(gitRef.name, remoteOwners.value.known);
  return suggestedPattern(gitRef.name.slice(remote.length + 1));
}
