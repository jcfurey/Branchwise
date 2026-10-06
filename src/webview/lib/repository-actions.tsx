import { batch, effect, signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

import type {
  QueryResult,
  RepositoryAction,
  RepositoryQuery,
  RepositoryQueryData,
  RepositoryState
} from "@/backend/types";
import {
  closeDialog,
  openContentDialog,
  openErrorDialog,
  openFormDialog,
  openRunningDialog
} from "@/webview/lib/actions";
import { sendRemoteAction } from "@/webview/lib/remote-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import { vscode } from "@/webview/lib/vscode";
import type { DialogState } from "@/webview/types";

// Every `repositoryQuery` the page makes starts and ends here. There are three kinds of read:
// panel reads, owned by a component that disposes them; the one read of the repository state
// shown around the graph; and the one read a loading dialog waits for. This module is in import
// cycles with `actions.ts` and `remote-actions.tsx`, so its top level only creates stores and
// watches two stores of `stores.ts`; nothing imported from the cycle runs before a call.

/** The selected repository's refs, remotes and operation, or `null` while none is loaded. */
export const repositoryState = signal<RepositoryState | null>(null);
/** Why the last load of `repositoryState` failed, or `null`. */
export const repositoryStateError = signal<string | null>(null);
/** Bumped by whoever changed the repository, so panels read their data again. */
export const repositoryRevision = signal(0);

type Answer = QueryResult<"repositoryQuery">;

type PanelRead = {
  repo: string;
  /** Delivered even after the user moves to another repository. */
  detached: boolean;
  /** The repository on screen when the read was made, which may not be `repo`. */
  shownRepo: string | undefined;
  receive: (data: RepositoryQueryData | null, error: string | null) => void;
};

type OpenRead = { repo: string; requestId: string };

type DialogRead = OpenRead & {
  /** The loading dialog; the read is abandoned once anything else is showing. */
  owner: DialogState | null;
  callback: (data: RepositoryQueryData) => void;
};

/** One sequence for every prefix, so no number is used twice. */
let requestCount = 0;
const panelReads = new Map<string, PanelRead>();
let stateRead: OpenRead | undefined;
let dialogRead: DialogRead | undefined;

function newRequestId(kind: "panel" | "state" | "query" | "action") {
  requestCount += 1;
  return `repository-${kind}-${requestCount}`;
}

function postRead(repo: string, requestId: string, query: RepositoryQuery) {
  vscode.postMessage({ command: "repositoryQuery", repo, requestId, query });
}

function postCancel({ repo, requestId }: OpenRead) {
  vscode.postMessage({ command: "cancelRepositoryQuery", repo, requestId });
}

function cancelStateRead() {
  if (stateRead !== undefined) {
    postCancel(stateRead);
    stateRead = undefined;
  }
}

function cancelDialogRead() {
  if (dialogRead !== undefined) {
    postCancel(dialogRead);
    dialogRead = undefined;
  }
}

// Closing or replacing the loading dialog, or moving to another repository, gives up its read.
// Both stores are read on every run so the watch never loses them.
effect(() => {
  const shown = dialog.value;
  const repo = selectedRepo.value;
  if (dialogRead !== undefined && (dialogRead.owner !== shown || dialogRead.repo !== repo)) {
    cancelDialogRead();
  }
});

/** Actions that open nothing: the result shows in an editor, or only a failure is reported. */
function runsInBackground(action: RepositoryAction) {
  switch (action.kind) {
    case "viewWorkingTreeFile":
    case "previewFileRestore":
    case "viewRangeFile":
    case "viewHistoricalFile":
    case "viewCommitChanges":
    case "viewRangeChanges":
      return true;
    default:
      return false;
  }
}

/** Actions that may run in a repository other than the one shown, such as a submodule's parent. */
function reachesOtherRepo(action: RepositoryAction) {
  switch (action.kind) {
    case "viewRangeFile":
    case "viewRangeChanges":
    case "viewHistoricalFile":
    case "submodule":
    case "submodulePointer":
      return true;
    default:
      return false;
  }
}

/** Confirmations for these start on Cancel, since the action discards or rewrites something. */
function isDestructive(action: RepositoryAction) {
  switch (action.kind) {
    case "removeRemote":
    case "removeWorktree":
    case "deleteRemoteRef":
    case "cleanup":
    case "rebase":
      return true;
    case "stash":
      return action.operation === "drop";
    case "recover":
      return action.resolution !== "continue";
    case "bisectMark":
      return action.mark === "reset";
    default:
      return false;
  }
}

/**
 * Read repository details for a component that stays on screen. `receive` hears the answer
 * once, unless the user has moved to another repository by then and the read is not
 * `detached`. The returned function gives the read up while it is still waiting.
 */
export function requestPanelQuery(
  query: RepositoryQuery,
  receive: (data: RepositoryQueryData | null, error: string | null) => void,
  repo = selectedRepo.value,
  detached = false
): () => void {
  if (repo === undefined) {
    return () => {};
  }
  const requestId = newRequestId("panel");
  panelReads.set(requestId, { repo, detached, shownRepo: selectedRepo.value, receive });
  postRead(repo, requestId, query);
  return () => {
    if (panelReads.delete(requestId)) {
      postCancel({ repo, requestId });
    }
  };
}

/** Forget the loaded state, as when another repository is selected. */
export function resetRepositoryState(): void {
  cancelStateRead();
  batch(() => {
    repositoryStateError.value = null;
    repositoryState.value = null;
  });
}

/** Load the selected repository's state again. What is shown stays until the answer. */
export function requestRepositoryState(): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  cancelStateRead();
  stateRead = { repo, requestId: newRequestId("state") };
  postRead(repo, stateRead.requestId, { kind: "state" });
}

/**
 * Read repository details behind a loading dialog, then close it and hand the data to
 * `callback`, which usually opens the next dialog. Only the selected repository can be read.
 */
export function requestRepositoryQuery(
  query: RepositoryQuery,
  callback: (data: RepositoryQueryData) => void,
  repo = selectedRepo.value
): void {
  if (repo === undefined || repo !== selectedRepo.value) {
    return;
  }
  // Only one loading dialog can show, so an earlier read is over. Cancelling it here, and not
  // only through the watch, keeps the cancel even when the caller is inside a batch.
  cancelDialogRead();
  openRunningDialog(window.l10n.loadingRepository);
  const requestId = newRequestId("query");
  dialogRead = { repo, requestId, owner: dialog.value, callback };
  postRead(repo, requestId, query);
}

function answerPanel(read: PanelRead, message: Answer) {
  // An answer naming another repository is not this read's; keep waiting for the real one.
  if (message.repo !== read.repo) {
    return;
  }
  panelReads.delete(message.requestId);
  if (read.detached || selectedRepo.value === read.shownRepo) {
    read.receive(message.data, message.status);
  }
}

function answerState(message: Answer) {
  stateRead = undefined;
  if (message.repo !== selectedRepo.value) {
    return;
  }
  const { data, status } = message;
  batch(() => {
    repositoryStateError.value = status;
    repositoryState.value = data?.kind === "state" ? data.state : null;
  });
}

function answerDialog(read: DialogRead, message: Answer) {
  if (message.repo !== selectedRepo.value) {
    dialogRead = undefined;
    return;
  }
  if (message.repo !== read.repo || dialog.value !== read.owner) {
    return;
  }
  dialogRead = undefined;
  if (message.status !== null || message.data === null) {
    openErrorDialog(window.l10n.unableToLoadRepository, message.status);
    return;
  }
  closeDialog();
  read.callback(message.data);
}

/** Route an answer from the extension to the read that asked for it. */
export function handleRepositoryQuery(message: Answer): void {
  const { requestId } = message;
  const panel = panelReads.get(requestId);
  if (panel !== undefined) {
    answerPanel(panel, message);
  } else if (stateRead?.requestId === requestId) {
    answerState(message);
  } else if (dialogRead?.requestId === requestId) {
    answerDialog(dialogRead, message);
  }
}

/**
 * Run a Git action through Git Activity, in the selected repository unless `repo` says.
 * `onComplete` hears how it ended before the running dialog closes; a dialog it opens stays.
 */
export function sendRepositoryAction(
  action: RepositoryAction,
  repo = selectedRepo.value,
  onComplete?: (error: string | null) => void
): void {
  if (repo === undefined) {
    return;
  }
  sendRemoteAction(
    { command: "repositoryAction", requestId: newRequestId("action"), action },
    repo,
    window.l10n.runningGitAction,
    {
      background: runsInBackground(action),
      otherRepo: reachesOtherRepo(action),
      ...(onComplete === undefined ? {} : { onComplete })
    }
  );
}

/** Ask before running `action`. The repository is fixed now, not when the user confirms. */
export function confirmRepositoryAction(
  message: ComponentChildren,
  actionLabel: string,
  action: RepositoryAction,
  repo = selectedRepo.value
): void {
  openFormDialog({
    message,
    inputs: [],
    action: actionLabel,
    source: null,
    destructive: isDestructive(action),
    onSubmit: () => {
      if (repo !== undefined) {
        sendRepositoryAction(action, repo);
      }
    }
  });
}

/** Load the selected repository's state, then show what `render` makes of it in a dialog. */
export function openRepositoryManager(
  title: string,
  render: (state: RepositoryState, repo: string) => ComponentChildren
): void {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "state" },
    (data) => {
      if (data.kind === "state") {
        openContentDialog(title, render(data.state, repo));
      }
    },
    repo
  );
}
