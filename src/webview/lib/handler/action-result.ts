import type { ActionResponse } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { closeDialog, openErrorDialog, refresh } from "@/webview/lib/actions";
import {
  acceptRemoteActionResult,
  actionMutates,
  actionViewRepo
} from "@/webview/lib/remote-actions";
import { selectedRepo } from "@/webview/lib/stores";

/** The string that titles the error dialog when each action fails. */
const failureTitles: Record<ActionResponse["command"], keyof LocalizedStrings> = {
  repositoryAction: "unableToRunGitAction",
  addTag: "unableToAddTag",
  checkoutBranch: "unableToCheckoutBranch",
  checkoutCommit: "unableToCheckoutCommit",
  cherrypickCommit: "unableToCherryPick",
  createBranch: "unableToCreateBranch",
  deleteBranch: "unableToDeleteBranch",
  deleteTag: "unableToDeleteTag",
  mergeBranch: "unableToMergeBranch",
  mergeCommit: "unableToMergeCommit",
  pushTag: "unableToPushTag",
  pushBranch: "unableToPushBranch",
  pullBranch: "unableToPullBranch",
  fetchRemote: "unableToFetch",
  renameBranch: "unableToRenameBranch",
  resetToCommit: "unableToReset",
  revertCommit: "unableToRevert"
};

/**
 * Settle the extension's answer to a Git action. The graph is reloaded when the action may have
 * changed things, failed or not, and the repository shown when it was sent is still the one
 * shown. Then the running dialog closes, or shows the failure, unless the answer is outdated or
 * its sender reports the outcome itself.
 */
export function handleActionResult(msg: ActionResponse): void {
  // Asked before the answer is accepted, which forgets the action and what was known about it.
  // An action sent to another repository, such as a submodule's parent, can change the one shown
  // too, so it is the view that counts. Without a record of it, the view is assumed unchanged.
  const shownWhenSent = actionViewRepo(msg);
  const reload =
    actionMutates(msg) && (shownWhenSent === undefined || shownWhenSent === selectedRepo.value);
  if (reload) {
    refresh();
  }

  if (!acceptRemoteActionResult(msg)) {
    return;
  }
  if (msg.status === null) {
    closeDialog();
  } else {
    openErrorDialog(window.l10n[failureTitles[msg.command]], msg.status);
  }
}
