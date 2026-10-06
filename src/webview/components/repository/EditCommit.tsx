import { useState } from "preact/hooks";

import type { AmendPlan, EditPlan } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { Button } from "@/webview/components/ui/Button";
import { openContentDialog } from "@/webview/lib/actions";
import {
  repositoryState,
  requestRepositoryQuery,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { commitHead, commitList, headBranch, selectedRepo } from "@/webview/lib/stores";
import { format } from "@/webview/utils/format";

/**
 * Whether `hash` is on the checked-out branch's first-parent line, as far as the loaded rows
 * show. Rows list children before parents, so a loaded commit on that line is reached from
 * HEAD through loaded rows only. The backend checks again before it changes anything.
 */
export function onCheckedOutLine(hash: string): boolean {
  const head = commitHead.value;
  const rows = commitList.value;
  if (headBranch.value === null || head === null || rows === undefined) {
    return false;
  }
  const byHash = new Map(rows.map((row) => [row.hash, row]));
  // Each step leaves a row behind, so the walk ends even on malformed rows.
  let current: string | undefined = head;
  for (let step = 0; current !== undefined && step <= rows.length; step++) {
    if (current === hash) {
      return true;
    }
    current = byHash.get(current)?.parentHashes[0];
  }
  return false;
}

/** Whether the latest repository state counted any staged changes. */
export function hasStagedChanges(): boolean {
  return (repositoryState.value?.staged ?? 0) > 0;
}

/** The target commit as the dialogs name it: its short ID and subject. */
export function Target({ plan }: { plan: EditPlan }) {
  return (
    <>
      <code>{abbrevCommit(plan.target)}</code> <b>{plan.message.split("\n")[0]}</b>
    </>
  );
}

/** What else the edit rewrites, and a warning when the commit was already pushed. */
export function Consequences({ plan }: { plan: EditPlan }) {
  return (
    <>
      {plan.later > 0 && (
        <p>
          {plan.later === 1
            ? window.l10n.rewritesOneLater
            : format(window.l10n.rewritesLater, String(plan.later))}
        </p>
      )}
      {plan.pushed && (
        <p class="rounded border border-line p-2" role="alert">
          {window.l10n.alreadyPushed}
        </p>
      )}
    </>
  );
}

export function RewordEditor({ plan, repo }: { plan: EditPlan; repo: string }) {
  const [message, setMessage] = useState(plan.message);
  // An empty message is refused, and an unchanged one would rewrite history for nothing.
  const blocked = !message.trim() || message.trimEnd() === plan.message;
  return (
    <form
      class="space-y-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) {
          sendRepositoryAction({ kind: "reword", plan, message }, repo);
        }
      }}
    >
      <p class="break-words">{format(window.l10n.editMessageIntro, <Target plan={plan} />)}</p>
      <Consequences plan={plan} />
      <textarea
        rows={8}
        class="w-full rounded bg-input p-2 font-mono text-input-fg outline-1 outline-line focus:outline-focus"
        aria-label={window.l10n.commitMessage}
        value={message}
        onInput={(event) => setMessage(event.currentTarget.value)}
      />
      <Button type="submit" variant="primary" disabled={blocked}>
        {window.l10n.saveMessage}
      </Button>
    </form>
  );
}

/** Load the commit's message, then ask for a new one. */
export function openEditMessage(hash: string) {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "editPlan", target: hash },
    (data) => {
      if (data.kind === "editPlan") {
        openContentDialog(
          window.l10n.editMessage,
          <RewordEditor plan={data.plan} repo={repo} />,
          true
        );
      }
    },
    repo
  );
}

export function AmendPreview({ plan, repo }: { plan: AmendPlan; repo: string }) {
  return (
    <div class="space-y-3 text-left">
      <p class="break-words">{format(window.l10n.addStagedConfirm, <Target plan={plan} />)}</p>
      <ul class="max-h-72 overflow-auto rounded border border-line-soft p-2 font-mono text-xs">
        {plan.staged.files.map((file) => (
          <li key={file} class="break-all py-1">
            {file}
          </li>
        ))}
      </ul>
      <Consequences plan={plan} />
      {plan.later > 0 && <p class="text-xs text-muted">{window.l10n.explainAddStaged}</p>}
      <Button
        variant="primary"
        onClick={() => sendRepositoryAction({ kind: "amendCommit", plan }, repo)}
      >
        {window.l10n.addStagedSubmit}
      </Button>
    </div>
  );
}

/** Load the staged files, then ask before adding them to the commit. */
export function openAddStaged(hash: string) {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "amendPlan", target: hash },
    (data) => {
      if (data.kind === "amendPlan") {
        openContentDialog(
          window.l10n.addStagedToCommit,
          <AmendPreview plan={data.plan} repo={repo} />
        );
      }
    },
    repo
  );
}
