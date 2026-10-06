import { batch } from "@preact/signals";
import type { ComponentChildren } from "preact";

import type { GitFileChange, GraphQueryCommand } from "@/backend/types";
import { cleanPatterns } from "@/backend/utils/branchPatterns";
import { remoteForRef } from "@/backend/utils/remoteVisibility";
import type { BranchSort, GitRepoState, ResponseMessage, WebviewConfig } from "@/types";
import { SHOW_ALL_BRANCHES, UNCOMMITTED_CHANGES } from "@/webview/constants";
import { captureFocus, restoreFocus } from "@/webview/lib/focus";
import {
  invalidateGraphRequest,
  resetGraphRequests,
  startGraphRequest
} from "@/webview/lib/graph-requests";
import {
  enterNavigation,
  historyOffset,
  leaveNavigation,
  restoreGraphPreferences
} from "@/webview/lib/navigation";
import { sendRemoteAction } from "@/webview/lib/remote-actions";
import {
  repositoryRevision,
  repositoryState,
  requestRepositoryState,
  resetRepositoryState
} from "@/webview/lib/repository-actions";
import {
  branchDisplay,
  branchFocusTarget,
  branchList,
  commitDetails,
  commitHead,
  commitList,
  contextMenu,
  dialog,
  displayedBranch,
  expandedCommit,
  focusDimming,
  focusPaused,
  graphErrors,
  headBranch,
  hiddenBranchPatterns,
  hiddenRemotes,
  maxCommits,
  moreCommitsAvailable,
  pinnedBranches,
  remoteVisibilityKey,
  repoStates,
  selectedBranch,
  selectedRepo,
  showRemoteBranch,
  uncommittedChanges
} from "@/webview/lib/stores";
import { branchPatternScope, graphVisibilityKey } from "@/webview/lib/stores/hidden-branches.store";
import { vscode } from "@/webview/lib/vscode";
import { getWebviewConfig, updateWebviewConfig } from "@/webview/lib/webview-config";
import type {
  ActionCommand,
  BranchDisplay,
  CommitBranchType,
  ContextMenuEntry,
  DialogBody,
  DialogInput,
  DialogValues,
  FocusDimming
} from "@/webview/types";

// This module sits in import cycles with the panels that call it back, so its top level holds
// plain counters only. Every imported binding is used inside the functions below.

/** Last token handed to a dialog. The Dialog keys its panel by it, so each opening is fresh. */
let dialogCount = 0;
/** Last number used in an `action-<n>` request id. */
let actionCount = 0;

/* Graph requests */

function clearGraphError(query: Exclude<GraphQueryCommand, "commitDetails">) {
  if (graphErrors.value[query] !== undefined) {
    graphErrors.value = { ...graphErrors.value, [query]: undefined };
  }
}

function requestBranches(repo: string) {
  clearGraphError("loadBranches");
  vscode.postMessage({
    command: "loadBranches",
    requestId: startGraphRequest("loadBranches", repo),
    repo,
    showRemoteBranches: showRemoteBranch.value,
    hiddenRemotes: hiddenRemotes.value,
    visibilityKey: remoteVisibilityKey(),
    hard: true
  });
}

/** Ask for the rows of the displayed branch, as many as `maxCommits` allows. */
function requestCommits(repo: string) {
  clearGraphError("loadCommits");
  vscode.postMessage({
    command: "loadCommits",
    requestId: startGraphRequest("loadCommits", repo),
    repo,
    branchName: displayedBranch(),
    maxCommits: maxCommits.value,
    showRemoteBranches: showRemoteBranch.value,
    hiddenRemotes: hiddenRemotes.value,
    ...branchPatternScope(),
    visibilityKey: graphVisibilityKey(),
    hard: true
  });
}

/** Drop the loaded rows and anything waiting for them, back to a first page. */
function forgetHistory() {
  invalidateGraphRequest("loadCommits");
  batch(() => {
    clearGraphError("loadCommits");
    commitList.value = undefined;
    commitHead.value = null;
    moreCommitsAvailable.value = false;
    uncommittedChanges.value = 0;
    maxCommits.value = getWebviewConfig().initialLoadCommits;
    closeCommitDetails();
  });
}

/**
 * After a selection or mode change: reload what a revealed remote or missing rows call for,
 * and the rows when the change lets a pattern-hidden branch in or out (`graphKey` is the
 * rows' key before it), then keep the view preferences in step.
 */
function reloadForChoice(revealed: boolean, graphKey: string) {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  if (revealed) {
    requestBranches(repo);
  }
  if (revealed || commitList.value === undefined || graphVisibilityKey() !== graphKey) {
    requestCommits(repo);
  }
  leaveNavigation(repo);
}

/* Remote visibility */

/** Hidden remotes form a set: kept sorted and without repeats, whoever wrote them. */
function asRemoteSet(names: ReadonlyArray<string>) {
  return [...new Set(names)].toSorted();
}

/** The remote a branch belongs to, or `undefined` for a local branch or `*`. */
function remoteOfBranch(branch: string) {
  const prefix = "remotes/";
  if (!branch.startsWith(prefix)) {
    return undefined;
  }
  const known = repositoryState.value?.remotes.map((remote) => remote.name) ?? [];
  return remoteForRef(branch.slice(prefix.length), [...known, ...hiddenRemotes.value]);
}

/** Write fields of one repository's record, leaving the other records as they are. */
function patchRepoState(repo: string, fields: Partial<GitRepoState>) {
  const states = repoStates.value;
  repoStates.value = { ...states, [repo]: { columnWidths: null, ...states[repo], ...fields } };
}

function saveHiddenRemotes(repo: string, names: ReadonlyArray<string>) {
  const hidden = asRemoteSet(names);
  patchRepoState(repo, { hiddenRemotes: hidden });
  vscode.postMessage({ command: "saveRepoState", repo, state: { hiddenRemotes: hidden } });
}

/**
 * Make a remote branch visible before it is chosen: remotes on, and its own remote off the
 * hidden list. Says whether anything had to change.
 */
function revealBranch(branch: string) {
  const remote = remoteOfBranch(branch);
  if (remote === undefined) {
    return false;
  }
  const hidden = hiddenRemotes.value;
  const wasHidden = hidden.includes(remote);
  if (!wasHidden && showRemoteBranch.value) {
    return false;
  }
  const repo = selectedRepo.value;
  batch(() => {
    showRemoteBranch.value = true;
    if (wasHidden && repo !== undefined) {
      saveHiddenRemotes(
        repo,
        hidden.filter((name) => name !== remote)
      );
    }
  });
  return true;
}

/**
 * The store half of a visibility change, for the caller's batch: back to the first history
 * page, and away from a remote branch that can no longer be shown. Rows stay until the reply.
 */
function applyVisibility() {
  historyOffset.value = 0;
  const branch = selectedBranch.value;
  const remote = branch === undefined ? undefined : remoteOfBranch(branch);
  if (remote !== undefined && (!showRemoteBranch.value || hiddenRemotes.value.includes(remote))) {
    selectedBranch.value = SHOW_ALL_BRANCHES;
    focusPaused.value = false;
  }
}

/** The message half of a visibility change: reload both lists and save the preferences. */
function reloadForVisibility() {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestBranches(repo);
  if (selectedBranch.value !== undefined) {
    requestCommits(repo);
  }
  leaveNavigation(repo);
}

/* Dialogs */

function showDialog(body: DialogBody) {
  // Remember the control in use before the dialog takes focus.
  captureFocus();
  batch(() => {
    contextMenu.value = null;
    dialog.value = { ...body, token: ++dialogCount };
  });
}

/* Exports */

/** Show another repository, starting from its own saved view. */
export function selectRepo(repo: string): void {
  const previous = selectedRepo.value;
  if (repo === previous) {
    return;
  }
  leaveNavigation(previous);
  batch(() => {
    resetGraphRequests();
    selectedRepo.value = repo;
    enterNavigation(repo);
    branchList.value = undefined;
    headBranch.value = null;
    selectedBranch.value = undefined;
    forgetHistory();
    resetRepositoryState();
    graphErrors.value = {};
    contextMenu.value = null;
    dialog.value = null;
  });
  restoreFocus();
  vscode.postMessage({ command: "selectRepo", repo });
  requestBranches(repo);
  requestRepositoryState();
}

/** Choose the branch the graph filters to or emphasises, or `*` for all of them. */
export function selectBranch(branch: CommitBranchType): void {
  const graphKey = graphVisibilityKey();
  const revealed = revealBranch(branch);
  if (!revealed && branch === selectedBranch.value) {
    return;
  }
  const shownBefore = displayedBranch();
  batch(() => {
    selectedBranch.value = branch;
    if (branch === SHOW_ALL_BRANCHES) {
      focusPaused.value = false;
    }
    if (displayedBranch() !== shownBefore) {
      forgetHistory();
    }
  });
  reloadForChoice(revealed, graphKey);
}

/** Switch between filtering to the branch and emphasising it in the whole graph. */
export function setBranchDisplay(value: BranchDisplay): void {
  if (value === branchDisplay.value) {
    return;
  }
  const graphKey = graphVisibilityKey();
  const shownBefore = displayedBranch();
  batch(() => {
    branchDisplay.value = value;
    focusPaused.value = false;
    // Emphasis needs a branch: fall back to HEAD, then to the first branch listed.
    if (value !== "filter" && selectedBranch.value === SHOW_ALL_BRANCHES) {
      selectedBranch.value = headBranch.value ?? branchList.value?.[0] ?? SHOW_ALL_BRANCHES;
    }
    if (displayedBranch() !== shownBefore) {
      forgetHistory();
    }
  });
  const repo = selectedRepo.value;
  if (
    repo !== undefined &&
    selectedBranch.value !== undefined &&
    (commitList.value === undefined || graphVisibilityKey() !== graphKey)
  ) {
    requestCommits(repo);
  }
  leaveNavigation(repo);
}

/** Emphasise a branch in the full graph. Git is not asked to do anything. */
export function focusBranchInGraph(branch: string): void {
  const graphKey = graphVisibilityKey();
  const revealed = revealBranch(branch);
  const shownBefore = displayedBranch();
  batch(() => {
    if (branchDisplay.value === "filter") {
      branchDisplay.value = "focus";
    }
    selectedBranch.value = branch;
    focusPaused.value = false;
    if (displayedBranch() !== shownBefore) {
      forgetHistory();
    }
  });
  reloadForChoice(revealed, graphKey);
}

/** Pause or resume the emphasis, keeping its target. */
export function toggleBranchFocus(): void {
  if (branchFocusTarget.value === undefined) {
    return;
  }
  focusPaused.value = !focusPaused.value;
  leaveNavigation(selectedRepo.value);
}

export function setFocusDimming(value: FocusDimming): void {
  focusDimming.value = value;
  leaveNavigation(selectedRepo.value);
}

/** Keep widths in memory while a boundary moves. The array itself is stored. */
export function setColumnWidths(widths: Array<number>): void {
  const repo = selectedRepo.value;
  if (repo !== undefined) {
    patchRepoState(repo, { columnWidths: widths });
  }
}

/** Keep widths in memory and have the extension store them. */
export function saveColumnWidths(widths: Array<number>): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  patchRepoState(repo, { columnWidths: widths });
  vscode.postMessage({ command: "saveRepoState", repo, state: { columnWidths: widths } });
}

/** The global remotes switch. Each remote's own choice is kept while it is off. */
export function setShowRemoteBranch(value: boolean): void {
  if (value === showRemoteBranch.value) {
    return;
  }
  batch(() => {
    showRemoteBranch.value = value;
    applyVisibility();
  });
  reloadForVisibility();
}

/**
 * Take the extension's stored record for a repository. Choices made on the page since it was
 * sent win, apart from the hidden remotes. Stored hidden-branch patterns apply when the page has
 * set none of its own.
 */
export function receiveRepoState(
  message: Extract<ResponseMessage, { command: "repoState" }>
): void {
  const { repo, state } = message;
  const current = repoStates.value[repo];
  const hidden = asRemoteSet(state.hiddenRemotes ?? []);
  const newPreferences =
    current?.graphPreferences === undefined && state.graphPreferences !== undefined;
  const hiddenChanged =
    JSON.stringify(asRemoteSet(current?.hiddenRemotes ?? [])) !== JSON.stringify(hidden);
  const record = { ...state, ...current, hiddenRemotes: hidden };
  const patternsChanged =
    JSON.stringify(current?.hiddenBranchPatterns ?? []) !==
    JSON.stringify(record.hiddenBranchPatterns ?? []);
  const affectsView =
    repo === selectedRepo.value && (newPreferences || hiddenChanged || patternsChanged);

  batch(() => {
    repoStates.value = { ...repoStates.value, [repo]: record };
    if (!affectsView) {
      return;
    }
    // Before the branch list arrives nothing has been chosen yet, so the saved view applies.
    if (newPreferences && selectedBranch.value === undefined) {
      restoreGraphPreferences(repo);
    }
    applyVisibility();
  });
  if (affectsView) {
    reloadForVisibility();
  }
}

/** Show or hide one remote's branches in the selected repository. */
/** Pin a local branch to the top of the Branches pane, or unpin it. */
export function setBranchPinned(branch: string, pinned: boolean): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  const others = pinnedBranches.value.filter((name) => name !== branch);
  const names = pinned ? [...others, branch] : others;
  patchRepoState(repo, { pinnedBranches: names });
  vscode.postMessage({ command: "saveRepoState", repo, state: { pinnedBranches: names } });
}

/** Order the Branches pane's local branches by name or by most recent commit. */
export function setBranchSort(sort: BranchSort): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  patchRepoState(repo, { branchSort: sort });
  vscode.postMessage({ command: "saveRepoState", repo, state: { branchSort: sort } });
}

export function setRemoteVisible(remote: string, visible: boolean): void {
  const hidden = hiddenRemotes.value;
  const isHidden = hidden.includes(remote);
  if (visible ? !isHidden && showRemoteBranch.value : isHidden) {
    return;
  }
  const repo = selectedRepo.value;
  batch(() => {
    if (repo !== undefined) {
      saveHiddenRemotes(
        repo,
        visible ? hidden.filter((name) => name !== remote) : [...hidden, remote]
      );
    }
    if (visible) {
      showRemoteBranch.value = true;
    }
    applyVisibility();
  });
  reloadForVisibility();
}

/**
 * Hide the selected repository's branches whose names match `patterns`, one glob each, in place
 * of those hidden so far. Blank and repeated patterns are dropped; none shows every branch.
 * The chosen branch stays chosen, and shown.
 */
export function setHiddenBranchPatterns(patterns: ReadonlyArray<string>): void {
  const repo = selectedRepo.value;
  const clean = cleanPatterns(patterns);
  if (repo === undefined || JSON.stringify(clean) === JSON.stringify(hiddenBranchPatterns.value)) {
    return;
  }
  batch(() => {
    patchRepoState(repo, { hiddenBranchPatterns: clean });
    historyOffset.value = 0;
  });
  vscode.postMessage({ command: "saveRepoState", repo, state: { hiddenBranchPatterns: clean } });
  if (selectedBranch.value !== undefined) {
    requestCommits(repo);
  }
}

/** Ask for one more page of rows. Nothing happens while no rows can be asked for. */
export function loadMoreCommits(): void {
  const repo = selectedRepo.value;
  if (repo === undefined || selectedBranch.value === undefined) {
    return;
  }
  maxCommits.value += getWebviewConfig().loadMoreCommits;
  requestCommits(repo);
}

/** Take settings changed while the page is open, then reload with them. */
export function applyWebviewConfig(config: WebviewConfig): void {
  if (!updateWebviewConfig(config)) {
    return;
  }
  maxCommits.value = Math.max(maxCommits.value, config.initialLoadCommits);
  refresh();
}

/** Reload everything shown for the selected repository, keeping the rows until replies come. */
export function refresh(): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  repositoryRevision.value++;
  requestBranches(repo);
  requestRepositoryState();
  if (selectedBranch.value !== undefined) {
    requestCommits(repo);
  }
}

export function closeCommitDetails(): void {
  invalidateGraphRequest("commitDetails");
  batch(() => {
    expandedCommit.value = null;
    commitDetails.value = null;
  });
}

/** Open a row's details, or close them when that row is the one open. */
export function toggleCommitDetails(hash: string): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  if (hash === expandedCommit.value) {
    closeCommitDetails();
    return;
  }
  invalidateGraphRequest("commitDetails");
  batch(() => {
    expandedCommit.value = hash;
    commitDetails.value = null;
  });
  // The uncommitted row's panel loads its own data.
  if (hash !== UNCOMMITTED_CHANGES) {
    vscode.postMessage({
      command: "commitDetails",
      requestId: startGraphRequest("commitDetails", repo),
      repo,
      commitHash: hash
    });
  }
}

/**
 * Open a menu for the element that handled `event`. A menu opened from the keyboard hangs
 * below that element; one opened with the pointer appears at the pointer.
 */
export function openContextMenu(
  event: MouseEvent,
  source: string,
  entries: Array<ContextMenuEntry>
): void {
  event.preventDefault();
  event.stopPropagation();
  captureFocus(event.target);

  // Enter or Space clicks with a count of 0; the menu key reports the viewport origin.
  const fromKeyboard =
    event.type === "click" ? event.detail === 0 : event.clientX === 0 && event.clientY === 0;
  const owner = event.currentTarget;
  let x = event.clientX;
  let y = event.clientY;
  if (fromKeyboard && owner instanceof Element) {
    const box = owner.getBoundingClientRect();
    x = box.left;
    y = box.bottom;
  }
  contextMenu.value = { x, y, entries, source };
}

export function closeContextMenu(): void {
  contextMenu.value = null;
  restoreFocus();
}

export function closeDialog(): void {
  dialog.value = null;
  restoreFocus();
}

export function openContentDialog(
  message: string,
  content: ComponentChildren,
  wide: boolean = false
): void {
  showDialog({ kind: "content", message, content, wide });
}

/**
 * Ask for values, or for a yes or no when `inputs` is empty. The answer is dropped, and the
 * dialog closed, when another repository was selected in the meantime.
 */
export function openFormDialog<const T extends ReadonlyArray<DialogInput>>(options: {
  message: ComponentChildren;
  inputs: T;
  action: string;
  source: string | null;
  onSubmit: (values: DialogValues<T>) => void;
  destructive?: boolean;
}): void {
  const repo = selectedRepo.value;
  const { onSubmit } = options;
  showDialog({
    kind: "form",
    message: options.message,
    inputs: [...options.inputs],
    action: options.action,
    destructive: options.destructive ?? false,
    onSubmit: (values) => {
      if (selectedRepo.value !== repo) {
        closeDialog();
        return;
      }
      onSubmit(values as unknown as DialogValues<T>);
    },
    source: options.source
  });
}

export function openErrorDialog(message: string, reason: string | null = null): void {
  showDialog({ kind: "error", message, reason });
}

export function openRunningDialog(
  message: string,
  context?: { detail: string; started: number; onCancel?: () => void } | undefined
): void {
  showDialog({ kind: "running", message, ...context });
}

/** Have the extension run a Git command in the selected repository. */
export function runAction(command: ActionCommand): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  sendRemoteAction(
    { ...command, requestId: `action-${++actionCount}` },
    repo,
    window.l10n.runningGitAction
  );
}

export function viewDiff(commitHash: string, file: GitFileChange): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  vscode.postMessage({
    command: "viewDiff",
    repo,
    commitHash,
    oldFilePath: file.oldFilePath,
    newFilePath: file.newFilePath,
    type: file.type
  });
}
