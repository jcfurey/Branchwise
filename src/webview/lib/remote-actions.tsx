import type { ActionResponse, QueryResult } from "@/backend/types";
import { remoteForRef } from "@/backend/utils/remoteVisibility";
import { openSync } from "@/webview/components/history/WorkflowTools";
import {
  closeDialog,
  openErrorDialog,
  openFormDialog,
  openRunningDialog
} from "@/webview/lib/actions";
import { beginActivity, finishActivity, reportUnseenFailure } from "@/webview/lib/activity";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import { vscode } from "@/webview/lib/vscode";
import { backgroundAction } from "@/webview/lib/workspace-actions";
import type { ActionCommand, DialogState } from "@/webview/types";
import { format } from "@/webview/utils/format";

type RemoteAction =
  | "push"
  | "pull"
  | "fetch"
  | "checkout"
  | "tagPush"
  | "tagDelete"
  | "branchDelete";
type RemoteCommand = ActionCommand & { requestId: string };
type Pending = {
  requestId: string;
  repo: string;
  dialog: DialogState | null;
  viewRepo?: string;
  background?: boolean;
  mutates?: boolean | undefined;
  onComplete?: ((error: string | null) => void) | undefined;
};

let nextRequest = 0;
/** Called once a push has succeeded, with the remote and the branch name it was pushed to. */
type OnPushed = (remote: string, remoteBranch: string) => void;

let pendingQuery:
  | (Pending & {
      action: RemoteAction;
      branchName: string;
      remoteRef: string | undefined;
      onPushed: OnPushed | undefined;
    })
  | undefined;
const pendingActions = new Map<string, Pending>();

/**
 * Load the remotes, then open the dialog of `action`. A push given `onPushed` starts with
 * "set upstream" ticked, and calls it once the push has succeeded.
 */
export function openRemoteAction(
  action: RemoteAction,
  branchName = "",
  remoteRef?: string,
  onPushed?: OnPushed
) {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  const requestId = `remote-${++nextRequest}`;
  openRunningDialog(window.l10n.loadingRemotes);
  pendingQuery = {
    requestId,
    repo,
    dialog: dialog.value!,
    action,
    branchName,
    remoteRef,
    onPushed
  };
  vscode.postMessage({
    command: "loadRemotes",
    repo,
    requestId,
    branchName: action === "push" || action === "pull" ? branchName : null
  });
}

/** Whether the action talks to a remote, which can stall; local actions always finish. */
function usesNetwork(command: RemoteCommand) {
  switch (command.command) {
    case "pushBranch":
    case "pullBranch":
    case "fetchRemote":
    case "pushTag":
      return true;
    case "checkoutBranch":
      return command.remoteBranch !== null && command.fetch === true;
    case "repositoryAction": {
      const { action } = command;
      return (
        action.kind === "fetch" ||
        action.kind === "deleteRemoteRef" ||
        (action.kind === "addRemote" && action.fetch) ||
        (action.kind === "sync" && action.operation === "push")
      );
    }
    default:
      return false;
  }
}

/**
 * Run `command` through Git Activity. The operation is titled by its own label; `message` is
 * used only where that label is missing or empty.
 */
export function sendRemoteAction(
  command: RemoteCommand,
  repo: string,
  message: string = window.l10n.runningGitAction,
  options: {
    background?: boolean;
    otherRepo?: boolean;
    mutates?: boolean;
    onComplete?: (error: string | null) => void;
  } = {}
) {
  if (selectedRepo.value === undefined || (!options.otherRepo && selectedRepo.value !== repo)) {
    closeDialog();
    options.onComplete?.(window.l10n.unableToRunGitAction);
    return;
  }
  const entry = beginActivity(command, repo, message);
  if (!options.background) {
    openRunningDialog(entry.title, {
      detail: [repo, entry.detail].filter(Boolean).join("\n"),
      started: entry.started,
      ...(usesNetwork(command)
        ? {
            onCancel: () =>
              vscode.postMessage({ command: "cancelAction", repo, requestId: command.requestId })
          }
        : {})
    });
  }
  pendingActions.set(command.requestId, {
    requestId: command.requestId,
    repo,
    dialog: dialog.value,
    viewRepo: selectedRepo.value,
    background: options.background ?? false,
    mutates: options.mutates,
    onComplete: options.onComplete
  });
  vscode.postMessage({ ...command, repo });
}

const send = sendRemoteAction;

export function actionMutates(message: ActionResponse) {
  const pending = message.requestId ? pendingActions.get(message.requestId) : undefined;
  return (
    message.requestId === undefined ||
    (pending !== undefined && (pending.mutates ?? !pending.background))
  );
}

/** The repository shown when the action behind an answer was sent, while it is still in flight. */
export function actionViewRepo(message: ActionResponse): string | undefined {
  return message.requestId === undefined
    ? undefined
    : pendingActions.get(message.requestId)?.viewRepo;
}

/** Ignore a late result after the user changes repositories or opens another dialog. */
export function acceptRemoteActionResult(message: ActionResponse): boolean {
  if (message.requestId === undefined) {
    return true;
  }
  const pending = pendingActions.get(message.requestId);
  if (pending && pending.repo !== message.repo) {
    return false;
  }
  pendingActions.delete(message.requestId);
  finishActivity(message);
  pending?.onComplete?.(message.status);
  if (pending?.background) {
    // A caller with its own completion handler shows the result itself.
    if (message.status !== null && !pending.onComplete) {
      if (selectedRepo.value === pending.viewRepo && dialog.value === pending.dialog) {
        openErrorDialog(window.l10n.unableToRunGitAction, message.status);
      } else {
        reportUnseenFailure(message);
      }
    }
    return false;
  }
  // The running dialog was hidden or replaced: a newer dialog stays, and a failure waits in
  // Git Activity.
  if (pending === undefined || dialog.value !== pending.dialog) {
    reportUnseenFailure(message);
    return false;
  }
  if (selectedRepo.value !== (pending.viewRepo ?? pending.repo)) {
    closeDialog();
    reportUnseenFailure(message);
    return false;
  }
  return true;
}

export function handleLoadRemotes(message: QueryResult<"loadRemotes">) {
  const pending = pendingQuery;
  if (
    pending === undefined ||
    message.requestId !== pending.requestId ||
    message.repo !== pending.repo
  ) {
    return;
  }
  pendingQuery = undefined;
  if (dialog.value !== pending.dialog) {
    return;
  }
  if (selectedRepo.value !== pending.repo) {
    closeDialog();
    return;
  }
  if (message.status !== null) {
    openErrorDialog(window.l10n.unableToLoadRemotes, message.status);
    return;
  }
  const { repo, branchName, requestId, action } = pending;
  // Checking out a remote-tracking ref needs no remote, even one that was removed.
  if (message.remotes.length === 0 && action !== "checkout") {
    openErrorDialog(window.l10n.noRemotesConfigured);
    return;
  }

  const upstream = message.upstream;
  const preferred =
    action === "push" || action === "tagPush" ? message.pushRemote : upstream?.remote;
  const refRemote = message.remotes
    .filter((remote) => pending.remoteRef?.startsWith(remote + "/"))
    .toSorted((a, b) => b.length - a.length)[0];
  // Another remote's name would cut the wrong prefix from the ref.
  if (action === "branchDelete" && refRemote === undefined) {
    openErrorDialog(window.l10n.remoteNotConfigured.replace("{0}", pending.remoteRef ?? ""));
    return;
  }
  const remote =
    refRemote ??
    message.remotes.find((name) => name === preferred) ??
    message.remotes.find((name) => name === "origin") ??
    message.remotes[0] ??
    "";
  const remoteBranch = upstream?.remote === remote ? upstream.branchName : branchName;
  const options = message.remotes.map((name) => ({ label: name, value: name }));
  const source = branchName === "" ? null : `ref:head:${branchName}`;

  if (action === "checkout") {
    const remoteRef = pending.remoteRef!;
    // The part after the ref's own remote; for a removed remote, after its first segment.
    const suggestion = remoteRef.slice(remoteForRef(remoteRef, message.remotes).length + 1);
    openFormDialog({
      message: format(window.l10n.dialogCheckoutRemoteTitle, <b>{remoteRef}</b>),
      inputs: [
        { kind: "ref", value: suggestion },
        {
          kind: "checkbox",
          label: window.l10n.fetchBeforeCheckout,
          value: refRemote !== undefined
        }
      ],
      action: window.l10n.checkoutBranch,
      source: `ref:remote:${remoteRef}`,
      onSubmit: ([localBranch, fetch]) =>
        send(
          {
            command: "checkoutBranch",
            requestId,
            branchName: localBranch,
            remoteBranch: remoteRef,
            fetch
          },
          repo,
          window.l10n.runningGitAction
        )
    });
  } else if (action === "tagPush" || action === "tagDelete" || action === "branchDelete") {
    const name =
      action === "branchDelete" ? pending.remoteRef!.slice(remote.length + 1) : branchName;
    const label =
      action === "tagPush"
        ? window.l10n.pushTag
        : action === "tagDelete"
          ? window.l10n.deleteRemoteTag
          : window.l10n.deleteRemoteBranch;
    openFormDialog({
      message: (
        <>
          {label}: <b>{name}</b>
        </>
      ),
      inputs: [{ kind: "select", label: window.l10n.remote, value: remote, options }],
      action: label,
      source: null,
      onSubmit: ([destination]) => {
        if (action === "tagPush") {
          send({ command: "pushTag", requestId, remote: destination, tagName: name }, repo);
        } else {
          openFormDialog({
            message: format(
              window.l10n.deleteRemoteRefConfirm,
              <b>{name}</b>,
              <b>{destination}</b>
            ),
            inputs: [],
            action: label,
            source: null,
            destructive: true,
            onSubmit: () =>
              sendRepositoryAction(
                {
                  kind: "deleteRemoteRef",
                  remote: destination,
                  name,
                  refType: action === "tagDelete" ? "tag" : "branch"
                },
                repo
              )
          });
        }
      }
    });
  } else if (action === "fetch") {
    openFormDialog({
      message: window.l10n.dialogFetchTitle,
      inputs: [
        {
          kind: "select",
          label: window.l10n.remote,
          value: refRemote ?? "",
          options: [{ label: window.l10n.allRemotes, value: "" }, ...options]
        },
        { kind: "checkbox", label: window.l10n.pruneRemoteBranches, value: false }
      ],
      action: window.l10n.fetch,
      source,
      onSubmit: ([selectedRemote, prune]) =>
        send(
          { command: "fetchRemote", requestId, remote: selectedRemote || null, prune },
          repo,
          window.l10n.fetching
        )
    });
  } else if (action === "push") {
    openFormDialog({
      message: format(window.l10n.dialogPushBranchTitle, <b>{branchName}</b>),
      inputs: [
        { kind: "select", label: window.l10n.remote, value: remote, options },
        { kind: "ref", label: window.l10n.remoteBranch, value: remoteBranch },
        {
          kind: "checkbox",
          label: window.l10n.setUpstream,
          value: upstream === null || pending.onPushed !== undefined
        },
        { kind: "checkbox", label: window.l10n.forceWithLease, value: false }
      ],
      action: window.l10n.previewPush,
      source,
      onSubmit: ([selectedRemote, destination, setUpstream, force]) => {
        const { onPushed } = pending;
        openSync(
          repo,
          branchName,
          selectedRemote,
          destination,
          { operation: "push", setUpstream, force },
          onPushed && (() => onPushed(selectedRemote, destination))
        );
      }
    });
  } else {
    openFormDialog({
      message: format(window.l10n.dialogPullBranchTitle, <b>{branchName}</b>),
      inputs: [
        { kind: "select", label: window.l10n.remote, value: remote, options },
        { kind: "ref", label: window.l10n.remoteBranch, value: remoteBranch }
      ],
      action: window.l10n.previewPull,
      source,
      onSubmit: async ([selectedRemote, destination]) => {
        openRunningDialog(window.l10n.fetching);
        const owner = dialog.value;
        const error = await backgroundAction(repo, { kind: "fetch", remote: selectedRemote });
        if (selectedRepo.value !== repo || dialog.value !== owner) {
          return;
        }
        if (error) {
          openErrorDialog(window.l10n.unableToRunGitAction, error);
          return;
        }
        openSync(repo, branchName, selectedRemote, destination, {
          operation: "pull",
          setUpstream: false,
          force: false
        });
      }
    });
  }
}
