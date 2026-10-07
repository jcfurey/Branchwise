import { computed, signal } from "@preact/signals";

import type { RepositoryState, WorktreeChange, WorktreeDetails } from "@/backend/types";
import { repositoryState, requestPanelQuery } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/** A worktree other than the one shown, as the graph marks it on the commit it has checked out. */
export type WorktreeMarker = WorktreeDetails & {
  /** Its folder as labels name it; see `worktreeName`. */
  name: string;
  /** What the last check found there; `unchecked` until a check answers. */
  change: WorktreeChange["state"];
};

/** The last check's findings by worktree path, and the repository they belong to. */
const checked = signal<{ repo: string; changes: ReadonlyMap<string, WorktreeChange["state"]> }>({
  repo: "",
  changes: new Map()
});

let cancelCheck = () => {};

/** Whether `branchwise.showWorktrees` is on. Before the page has its settings, it is off. */
function markersShown() {
  try {
    return getWebviewConfig().showWorktrees;
  } catch {
    return false;
  }
}

/** The worktrees the graph marks: every one but a bare repository and the one shown. */
function otherWorktrees(state: RepositoryState, repo: string) {
  return state.worktrees.filter(
    (worktree) => !worktree.bare && worktree.head !== "" && worktree.path !== repo
  );
}

/**
 * Check the other worktrees for uncommitted changes again, now that the repository state was
 * loaded. What the last check found stays shown until the answer.
 */
export function requestWorktreeChanges(state: RepositoryState | null): void {
  cancelCheck();
  cancelCheck = () => {};
  const repo = selectedRepo.peek();
  if (
    state === null ||
    repo === undefined ||
    !markersShown() ||
    otherWorktrees(state, repo).length === 0
  ) {
    return;
  }
  cancelCheck = requestPanelQuery({ kind: "worktreeChanges" }, (data) => {
    cancelCheck = () => {};
    if (data?.kind === "worktreeChanges") {
      checked.value = {
        repo,
        changes: new Map(data.worktrees.map((entry) => [entry.path, entry.state]))
      };
    }
  });
}

/**
 * How labels name the folder `path`: relative to the main worktree `main` when both sit in the
 * same parent folder, such as `../feature-x` beside it or `wt/feature-x` inside it; otherwise in
 * full. Paths use `/` between folders, as the extension sends them.
 */
export function worktreeName(path: string, main: string): string {
  const parent = main.slice(0, main.lastIndexOf("/"));
  if (path === main || parent === "" || !path.startsWith(parent + "/")) {
    return path;
  }
  return path.startsWith(main + "/")
    ? path.slice(main.length + 1)
    : "../" + path.slice(parent.length + 1);
}

/** The markers by the commit each worktree has checked out; none while the setting is off. */
export const worktreeMarkers = computed(() => {
  const byCommit = new Map<string, Array<WorktreeMarker>>();
  const state = repositoryState.value;
  const repo = selectedRepo.value;
  if (state === null || repo === undefined || !markersShown()) {
    return byCommit;
  }
  const { changes } = checked.value.repo === repo ? checked.value : { changes: undefined };
  const main = state.worktrees[0]?.path ?? repo;
  for (const worktree of otherWorktrees(state, repo)) {
    const marker: WorktreeMarker = {
      ...worktree,
      name: worktreeName(worktree.path, main),
      change: worktree.prunable ? "missing" : (changes?.get(worktree.path) ?? "unchecked")
    };
    byCommit.set(worktree.head, [...(byCommit.get(worktree.head) ?? []), marker]);
  }
  return byCommit;
});

/** The marker of the other worktree that has the local branch `branch` checked out, if any. */
export function branchWorktree(branch: string): WorktreeMarker | undefined {
  for (const markers of worktreeMarkers.value.values()) {
    const found = markers.find((marker) => marker.branch === branch);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * The tooltip of a marker, one fact a line: the folder, the branch or a detached HEAD, whether
 * Git has it locked or finds it missing, and whether it has uncommitted changes.
 */
export function worktreeTooltip(marker: WorktreeMarker): Array<string> {
  const l10n = window.l10n;
  const lines = [
    l10n.worktreeTitle.replace("{0}", () => marker.name),
    marker.branch || l10n.detachedHead
  ];
  if (marker.locked) {
    lines.push(l10n.lockedWorktree);
  }
  if (marker.change === "missing") {
    lines.push(l10n.prunableWorktree);
  }
  if (marker.change === "dirty") {
    lines.push(l10n.worktreeDirty);
  }
  return lines;
}
