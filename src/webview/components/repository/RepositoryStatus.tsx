import type { OperationKind, OperationState, RepositoryState } from "@/backend/types";
import { BisectStatus } from "@/webview/components/repository/BisectView";
import { openTracking } from "@/webview/components/repository/RemoteManager";
import { Button } from "@/webview/components/ui/Button";
import { BranchIcon } from "@/webview/components/ui/Icons";
import { openRemoteAction } from "@/webview/lib/remote-actions";
import {
  confirmRepositoryAction,
  repositoryState,
  repositoryStateError,
  requestRepositoryState,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { format } from "@/webview/utils/format";

function operationLabel(kind: OperationKind) {
  return {
    merge: window.l10n.mergeOperation,
    rebase: window.l10n.rebaseOperation,
    "cherry-pick": window.l10n.cherryPickOperation,
    revert: window.l10n.revertOperation
  }[kind];
}

function recover(operation: OperationState, resolution: "continue" | "abort" | "skip") {
  const label = {
    continue: window.l10n.continueOperation,
    abort: window.l10n.abortOperation,
    skip: window.l10n.skipOperation
  }[resolution];
  confirmRepositoryAction(
    format(window.l10n.recoveryConfirm, label, operationLabel(operation.kind)),
    label,
    { kind: "recover", operation, resolution }
  );
}

type Tracking = RepositoryState["branches"][number];

/** The look of an action in the strip: a link, as small as the text around it. */
const STRIP_ACTION = "py-0.5 text-xs text-link";

/** Whether the branch's upstream has commits to pull. */
function behind(tracking: Tracking) {
  return Boolean(tracking.upstream) && !tracking.gone && tracking.behind > 0;
}

/**
 * Whether the branch has something to push: commits its upstream lacks, or, with a remote to
 * push to, no upstream yet or one that was deleted.
 */
function unpushed(tracking: Tracking, state: RepositoryState) {
  return tracking.upstream && !tracking.gone ? tracking.ahead > 0 : state.remotes.length > 0;
}

export function RepositoryStatus() {
  const state = repositoryState.value;
  const error = repositoryStateError.value;
  // The failure and what Git said, above whatever an earlier read left on show.
  const failure = error !== null && (
    <div
      class="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2 text-ui"
      role="status"
    >
      <span>{window.l10n.unableToLoadRepository}</span>
      <span class="min-w-0 flex-1 truncate text-muted select-text" title={error}>
        {error}
      </span>
      <Button onClick={requestRepositoryState}>{window.l10n.refresh}</Button>
    </div>
  );
  if (state === null) {
    return failure || null;
  }
  return (
    <>
      {failure}
      <StatusStrip state={state} />
    </>
  );
}

function StatusStrip({ state }: { state: RepositoryState }) {
  const tracking = state.branches.find((branch) => branch.name === state.head);
  const operation = state.operation;
  const repo = selectedRepo.value;
  return (
    <div class="space-y-2 border-b border-line-soft px-3 py-0.5 text-ui">
      <BisectStatus />
      <div class="flex flex-wrap items-center gap-x-2 text-xs" role="status">
        <BranchIcon class="size-3.5 shrink-0 text-muted" />
        <b>{state.head || window.l10n.detachedHead}</b>
        <span class="text-muted">
          {tracking?.upstream
            ? tracking.gone
              ? `${tracking.upstream} · ${window.l10n.upstreamGone}`
              : format(
                  window.l10n.trackingStatus,
                  tracking.upstream,
                  String(tracking.ahead),
                  String(tracking.behind)
                )
            : window.l10n.noUpstream}
        </span>
        {/* What the counts beside them call for, each opening the review its menu entry opens. */}
        {tracking && operation === null && behind(tracking) && (
          <Button
            variant="ghost"
            class={STRIP_ACTION}
            onClick={() => openRemoteAction("pull", tracking.name)}
          >
            {`${window.l10n.pullBranch}…`}
          </Button>
        )}
        {tracking && operation === null && unpushed(tracking, state) && (
          <Button
            variant="ghost"
            class={STRIP_ACTION}
            onClick={() => openRemoteAction("push", tracking.name)}
          >
            {`${window.l10n.pushBranch}…`}
          </Button>
        )}
        {tracking && (
          <Button variant="ghost" class={STRIP_ACTION} onClick={() => openTracking(tracking.name)}>
            {window.l10n.configureUpstream}
          </Button>
        )}
      </div>
      {operation !== null && (
        <div class="flex flex-wrap items-center gap-2" role="status">
          <b>{format(window.l10n.operationInProgress, operationLabel(operation.kind))}</b>
          <Button
            disabled={state.conflicts.length > 0}
            onClick={() => recover(operation, "continue")}
          >
            {window.l10n.continueOperation}
          </Button>
          <Button onClick={() => recover(operation, "abort")}>{window.l10n.abortOperation}</Button>
          {operation.kind !== "merge" && (
            <Button onClick={() => recover(operation, "skip")}>{window.l10n.skipOperation}</Button>
          )}
        </div>
      )}
      {state.conflicts.length > 0 && (
        <div class="space-y-2">
          <b>{window.l10n.conflictedFiles}</b>
          {state.conflicts.map((file) => (
            <div key={file} class="flex flex-wrap items-center gap-2">
              <span class="break-all">{file}</span>
              <Button
                onClick={() =>
                  sendRepositoryAction({ kind: "conflict", path: file, operation: "open" }, repo)
                }
              >
                {window.l10n.openConflict}
              </Button>
              <Button
                onClick={() =>
                  confirmRepositoryAction(
                    format(window.l10n.stageResolutionConfirm, <b>{file}</b>),
                    window.l10n.stageResolution,
                    { kind: "conflict", path: file, operation: "stage" },
                    repo
                  )
                }
              >
                {window.l10n.stageResolution}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
