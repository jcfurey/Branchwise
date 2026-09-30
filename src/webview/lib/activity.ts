import { signal } from "@preact/signals";

import type { ActionResponse } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { ActionCommand } from "@/webview/types";

export type ActivityEntry = {
  id: string;
  repo: string;
  title: string;
  detail: string;
  started: number;
  finished: number | null;
  error: string | null;
  /** Failed while its dialog was hidden or replaced, so the user has not seen the error. */
  unseen?: boolean;
};
export const activity = signal<ActivityEntry[]>([]);

const titles: Record<string, keyof LocalizedStrings> = {
  addTag: "addTag",
  deleteTag: "deleteTag",
  pushTag: "pushTag",
  createBranch: "createBranch",
  deleteBranch: "deleteBranch",
  renameBranch: "renameBranch",
  checkoutBranch: "checkoutBranch",
  checkoutCommit: "checkout",
  cherrypickCommit: "cherryPick",
  revertCommit: "revert",
  resetToCommit: "reset",
  mergeBranch: "merge",
  mergeCommit: "merge",
  pushBranch: "pushBranch",
  pullBranch: "pullBranch",
  fetchRemote: "fetch",
  addRemote: "addRemote",
  editRemote: "editRemote",
  renameRemote: "renameRemote",
  removeRemote: "removeRemote",
  pushDefault: "defaultPushRemote",
  setTracking: "configureUpstream",
  deleteRemoteRef: "deleteRemoteBranch",
  saveStash: "saveStash",
  stash: "stashes",
  rebase: "startRebase",
  interactiveRebase: "startRebase",
  recover: "continueOperation",
  conflict: "stageResolution",
  addWorktree: "addWorktree",
  removeWorktree: "removeWorktree",
  openWorktree: "openWorktree",
  submodule: "updateSubmodule",
  restoreFile: "restoreHistoricalFile",
  fixup: "createFixup",
  batch: "batchCherryPick",
  recoverBranch: "recoverBranch",
  viewWorkingTreeFile: "openFileChanges",
  viewRangeFile: "compareRevisions",
  viewHistoricalFile: "openHistoricalFile",
  previewFileRestore: "restorePreview",
  submodulePointer: "stagePointer",
  fetch: "fetch",
  sync: "syncPreview",
  cleanup: "cleanupBranches",
  bisectStart: "bisectStart",
  bisectMark: "bisectTitle"
};

export function beginActivity(
  command: ActionCommand & { requestId: string },
  repo: string,
  fallback: string
) {
  const payload = command.command === "repositoryAction" ? command.action : command;
  const kind = "kind" in payload ? payload.kind : command.command;
  const details = ["branchName", "remote", "remoteBranch", "commitHash", "path", "name", "tagName"]
    .flatMap((key) =>
      key in payload ? [String((payload as unknown as Record<string, unknown>)[key] ?? "")] : []
    )
    .filter(Boolean)
    .join(" · ");
  let title = window.l10n[titles[kind] ?? "runningGitAction"] || fallback;
  if (command.command === "repositoryAction") {
    const action = command.action;
    if (action.kind === "batch") {
      title = action.operation === "revert" ? window.l10n.batchRevert : window.l10n.batchCherryPick;
    }
    if (action.kind === "submodule") {
      title =
        window.l10n[
          action.operation === "sync"
            ? "syncSubmodule"
            : action.operation === "initialize"
              ? "initializeSubmodule"
              : "updateSubmodule"
        ];
    }
    if (action.kind === "recover") {
      title =
        window.l10n[
          action.resolution === "abort"
            ? "abortOperation"
            : action.resolution === "skip"
              ? "skipOperation"
              : "continueOperation"
        ];
    }
  }
  const entry: ActivityEntry = {
    id: command.requestId,
    repo,
    title,
    detail: details,
    started: Date.now(),
    finished: null,
    error: null
  };
  activity.value = [entry, ...activity.value].slice(0, 100);
  return entry;
}

/** Keep a failure that no dialog showed visible until the user opens Git Activity. */
export function reportUnseenFailure(message: ActionResponse) {
  if (message.status === null) {
    return;
  }
  activity.value = activity.value.map((entry) =>
    entry.id === message.requestId && entry.repo === message.repo
      ? Object.assign({}, entry, { unseen: true })
      : entry
  );
}

export function markFailuresSeen() {
  if (activity.value.some((entry) => entry.unseen)) {
    activity.value = activity.value.map((entry) =>
      entry.unseen ? Object.assign({}, entry, { unseen: false }) : entry
    );
  }
}

export function finishActivity(message: ActionResponse) {
  activity.value = activity.value.map((entry) =>
    entry.id === message.requestId && entry.repo === message.repo
      ? Object.assign({}, entry, { finished: Date.now(), error: message.status })
      : entry
  );
}
