import type { GitCommitNode, GitRef } from "@/backend/types";
import { openBatch } from "@/webview/components/history/HistoryTools";
import { announce } from "@/webview/components/ui/Announcer";
import { BATCH_LIMIT, UNCOMMITTED_CHANGES } from "@/webview/constants";
import { commitMenu, type CommitMessages, refMenu } from "@/webview/lib/menus";
import { selectedCommits } from "@/webview/lib/navigation";
import { type RowShortcutId, shortcutFor } from "@/webview/lib/shortcuts";
import type { ContextMenuEntry } from "@/webview/types";

/** What a commit row tells its single keys about itself. */
export type ShortcutRow = {
  commit: GitCommitNode;
  headBranch: string | null;
  messages: CommitMessages;
  /** Open or close the row's details, as Enter does. */
  toggleDetails: () => void;
};

type Action = () => void;

/** The entry of `entries` that the key `id` stands for, if the menu offers it. */
function entryFor(entries: Array<ContextMenuEntry>, id: RowShortcutId): Action | null {
  return entries.find((entry) => entry?.shortcut === id)?.onClick ?? null;
}

/** A remote's `HEAD`, such as `origin/HEAD`, which only names another branch. */
function remoteHead(ref: GitRef) {
  return ref.type === "remote" && ref.name.endsWith("/HEAD");
}

/**
 * The action of the first label on the row whose own menu offers `id`, as merging and rebasing
 * onto a branch are offered from a branch's menu. A remote's `HEAD` comes last, as it only names
 * another branch.
 */
function labelAction({ commit, headBranch }: ShortcutRow, id: RowShortcutId): Action | null {
  const refs = commit.refs.toSorted((a, b) => Number(remoteHead(a)) - Number(remoteHead(b)));
  for (const ref of refs) {
    const action = entryFor(refMenu(ref, ref.type === "head" && ref.name === headBranch), id);
    if (action !== null) {
      return action;
    }
  }
  return null;
}

/** Whether the row is one of several selected commits, which act together. */
function inSelection(commit: GitCommitNode) {
  const selected = selectedCommits.value;
  return selected.length > 1 && selected.some((entry) => entry.hash === commit.hash);
}

/**
 * What the key `id` does on `row`, taken from the menu that offers it, or `null` when that menu
 * does not offer it there.
 */
function actionFor(row: ShortcutRow, id: RowShortcutId): Action | null {
  const { commit, messages } = row;
  if (id === "toggleDetails") {
    return row.toggleDetails;
  }
  // The uncommitted changes have no menu, so nothing else applies to them.
  if (commit.hash === UNCOMMITTED_CHANGES) {
    return null;
  }
  // A selection is cherry-picked together, as from the selection bar, within the same limit.
  if (id === "cherryPick" && inSelection(commit)) {
    return selectedCommits.value.length > BATCH_LIMIT ? null : () => openBatch("cherry-pick");
  }
  // Only a branch's menu offers rebasing onto it. A commit can merge on its own, but a branch on
  // the row is merged by name, as its label's menu would.
  if (id === "rebase" || id === "merge") {
    const action = labelAction(row, id);
    if (action !== null || id === "rebase") {
      return action;
    }
  }
  return entryFor(commitMenu(commit, messages), id);
}

/**
 * Run the single key that `event` presses on the focused commit row. Returns whether it was one
 * of the row's keys, which the row then leaves alone. An action the row's menus do not offer is
 * not run, and a screen reader is told so instead.
 */
export function runRowShortcut(event: KeyboardEvent, row: ShortcutRow): boolean {
  const entry = shortcutFor(event, "row");
  if (entry === null) {
    return false;
  }
  // Without this, the letter would also be typed into the dialog that the key opens.
  event.preventDefault();
  // A held key acts once.
  if (event.repeat) {
    return true;
  }
  const action = actionFor(row, entry.id);
  if (action === null) {
    const name = entry.label(window.l10n).replace(/…$/u, "");
    announce(window.l10n.shortcutUnavailable.replaceAll("{0}", () => name));
  } else {
    action();
  }
  return true;
}
