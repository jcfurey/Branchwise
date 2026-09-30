import { computed, signal } from "@preact/signals";

import type { GitCommitDetails, GitCommitNode } from "@/backend/types";
import type { GitRepoSet } from "@/types";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import type {
  BranchDisplay,
  CommitBranchType,
  ContextMenuState,
  DialogState,
  FocusDimming
} from "@/webview/types";
import { isColumnWidths } from "@/webview/utils/columns";

// The page's shared state. Loading this module only creates the signals: many tests load it
// before there is a DOM, a configuration or any strings, and they reload it for a fresh page.

/* The repository and what has been loaded for it */

/** Path of the repository the graph shows, or `undefined` when there is none. */
export const selectedRepo = signal<string | undefined>(undefined);

/**
 * The branch names of the latest accepted branch list: the checked-out branch, the other local
 * branches, then `remotes/<remote>/<branch>`. `undefined` until one arrives for this repository.
 */
export const branchList = signal<Array<string> | undefined>(undefined);

/** The checked-out branch, or `null` when HEAD is detached or unborn, or nothing has arrived. */
export const headBranch = signal<string | null>(null);

/** The graph rows of the displayed branch, or `undefined` while none are loaded. */
export const commitList = signal<Array<GitCommitNode> | undefined>(undefined);

/** Full ID of HEAD's commit from the latest rows, or `null` (no rows yet, or no commits). */
export const commitHead = signal<string | null>(null);

/** Whether a larger page would show more rows. */
export const moreCommitsAvailable = signal(false);

/** The Git error of the latest failed list read. An absent or `undefined` entry is no error. */
export const graphErrors = signal<
  Partial<Record<"loadBranches" | "loadCommits", string | undefined>>
>({});

/** Working-tree entries; above zero exactly when the rows open with the uncommitted row `*`. */
export const uncommittedChanges = signal(0);

/** How many rows the next row request asks for. */
export const maxCommits = signal(0);

/* The details panel, the menu and the dialog */

/** Hash of the row whose details are open (`*` for uncommitted changes), or `null`. */
export const expandedCommit = signal<string | null>(null);

/** The details of the open row, `null` until they arrive and while no row is open. */
export const commitDetails = signal<GitCommitDetails | null>(null);

/** The one context menu shown, or `null`. */
export const contextMenu = signal<ContextMenuState | null>(null);

/** The one dialog shown, or `null`. */
export const dialog = signal<DialogState | null>(null);

/* Choices, per repository and for the view */

/** The extension's stored record of each repository, by path, as last received or saved. */
export const repoStates = signal<GitRepoSet>({});

/** The chosen branch, `*` for every branch, or `undefined` before the branch list arrives. */
export const selectedBranch = signal<CommitBranchType | undefined>(undefined);

/** Whether the graph is limited to the chosen branch or shows it emphasised among all others. */
export const branchDisplay = signal<BranchDisplay>("filter");

/** Emphasis is paused; its target is kept. */
export const focusPaused = signal(false);

export const focusDimming = signal<FocusDimming>("subtle");

/** The global "Show Remote Branches in Graph" switch. */
export const showRemoteBranch = signal(true);

/* Derived values */

/** Stands for "no hidden remotes", so that readers are not told of a change each time. */
const NO_REMOTES: Array<string> = [];

/**
 * The key of the element the open menu belongs to, or else of the open form dialog, so that
 * element can draw itself as active. `null` when neither names one.
 */
export const activeSource = computed<string | null>(() => {
  const menu = contextMenu.value;
  if (menu !== null) {
    return menu.source;
  }
  const open = dialog.value;
  return open?.kind === "form" ? open.source : null;
});

/**
 * The selected repository's stored column widths, the stored array itself, when they can size
 * the table; otherwise `null`.
 */
export const columnWidths = computed<Array<number> | null>(() => {
  const repo = selectedRepo.value;
  const stored = repo === undefined ? null : (repoStates.value[repo]?.columnWidths ?? null);
  return isColumnWidths(stored) ? stored : null;
});

/** The branch a focus mode emphasises, whether or not the emphasis is paused. */
export const branchFocusTarget = computed<
  Exclude<CommitBranchType, typeof SHOW_ALL_BRANCHES> | undefined
>(() => {
  const branch = selectedBranch.value;
  if (branchDisplay.value === "filter" || branch === SHOW_ALL_BRANCHES) {
    return undefined;
  }
  return branch;
});

/** The selected repository's hidden remotes, as stored: neither sorted nor de-duplicated. */
export const hiddenRemotes = computed<Array<string>>(() => {
  const repo = selectedRepo.value;
  return (repo === undefined ? undefined : repoStates.value[repo]?.hiddenRemotes) ?? NO_REMOTES;
});

/**
 * The branch the graph rows belong to for `branch` (by default the current choice): the branch
 * itself when filtering to it, and `""`, meaning every branch, otherwise.
 */
export function displayedBranch(
  branch: CommitBranchType | undefined = selectedBranch.value
): string {
  if (branchDisplay.value !== "filter" || branch === undefined || branch === SHOW_ALL_BRANCHES) {
    return "";
  }
  return branch;
}

/**
 * A text that changes whenever the remote choice shaping the lists does. List requests carry it
 * and answers echo it, so that an answer to an older choice can be told apart. Sorting a copy
 * keeps the order of the stored list out of it.
 */
export function remoteVisibilityKey(): string {
  return JSON.stringify([showRemoteBranch.value, hiddenRemotes.value.toSorted()]);
}

/** Take the configured size of a first page of rows. */
export function initializeStores(initialLoadCommits: number): void {
  maxCommits.value = initialLoadCommits;
}
