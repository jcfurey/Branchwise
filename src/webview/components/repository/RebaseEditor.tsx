import { useState } from "preact/hooks";

import type { RebaseEntry, RebasePlan } from "@/backend/types";
import { autosquashPlan } from "@/backend/utils/autosquash";
import { Button } from "@/webview/components/ui/Button";
import { Select } from "@/webview/components/ui/Select";
import { openContentDialog, openErrorDialog } from "@/webview/lib/actions";
import {
  confirmRepositoryAction,
  requestRepositoryQuery,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { commitHead, headBranch, selectedRepo } from "@/webview/lib/stores";
import { moveButton, useListMove } from "@/webview/lib/use-list-move";
import { format } from "@/webview/utils/format";

export function RebaseEditor({ plan, repo }: { plan: RebasePlan; repo: string }) {
  const [entries, setEntries] = useState(plan.entries);
  const retained = entries.filter((entry) => entry.action !== "drop");
  const invalid =
    retained.length === 0 ||
    retained[0]?.action === "squash" ||
    retained[0]?.action === "fixup" ||
    entries.some((entry) => entry.action === "reword" && !entry.message.trim());
  function update(index: number, patch: Partial<RebaseEntry>) {
    setEntries((current) =>
      current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    );
  }
  const { root, move, status } = useListMove(entries, setEntries);
  return (
    <form
      ref={root}
      class="space-y-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) {
          sendRepositoryAction({ kind: "interactiveRebase", plan: { ...plan, entries } }, repo);
        }
      }}
    >
      <p>
        <b>{plan.branch}</b> · {plan.base.slice(0, 12)} → {plan.head.slice(0, 12)}
      </p>
      <p>{window.l10n.rebasePlanDescription}</p>
      <p class="text-xs text-muted">{window.l10n.explainInteractiveRebase}</p>
      <Button
        onClick={() => setEntries(autosquashPlan({ ...plan, entries }, plan.entries).entries)}
      >
        {window.l10n.arrangeAutosquash}
      </Button>
      {entries.map((entry, index) => (
        <div
          key={entry.hash}
          data-entry={entry.hash}
          class="space-y-2 rounded border border-line p-2"
        >
          <p class="break-words">
            <code>{entry.hash.slice(0, 8)}</code> {entry.message.split("\n")[0]}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Select
              aria-label={`${entry.hash.slice(0, 8)} ${window.l10n.rebasePlanTitle}`}
              value={entry.action}
              onChange={(action) => update(index, { action: action as RebaseEntry["action"] })}
              options={[
                { label: window.l10n.pickCommit, value: "pick" },
                { label: window.l10n.rewordCommit, value: "reword" },
                { label: window.l10n.squashCommit, value: "squash" },
                { label: window.l10n.fixupCommit, value: "fixup" },
                { label: window.l10n.dropCommit, value: "drop" }
              ]}
            />
            <Button
              {...moveButton(entry.hash, "earlier")}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              {window.l10n.moveEarlier}
            </Button>
            <Button
              {...moveButton(entry.hash, "later")}
              disabled={index === entries.length - 1}
              onClick={() => move(index, 1)}
            >
              {window.l10n.moveLater}
            </Button>
          </div>
          {entry.action === "reword" && (
            <textarea
              rows={4}
              class="w-full rounded bg-input p-2 text-input-fg outline-1 outline-line focus:outline-focus"
              aria-label={window.l10n.dialogAddTagMessage}
              value={entry.message}
              onInput={(event) => update(index, { message: event.currentTarget.value })}
            />
          )}
        </div>
      ))}
      {status}
      {invalid && <p role="alert">{window.l10n.firstCannotCombine}</p>}
      <Button type="submit" disabled={invalid}>
        {window.l10n.startRebase}
      </Button>
    </form>
  );
}

export function openInteractiveRebase(base: string, autosquash = false) {
  const repo = selectedRepo.value;
  if (repo === undefined) {
    return;
  }
  requestRepositoryQuery(
    { kind: "rebasePlan", base, autosquash },
    (data) => {
      if (data.kind === "rebasePlan") {
        openContentDialog(
          window.l10n.rebasePlanTitle,
          <RebaseEditor plan={data.plan} repo={repo} />
        );
      }
    },
    repo
  );
}

export function openRebase(onto: string) {
  const repo = selectedRepo.value;
  const branch = headBranch.value;
  const expectedHead = commitHead.value;
  if (repo === undefined) {
    return;
  }
  if (branch === null || expectedHead === null) {
    openErrorDialog(window.l10n.unableToRunGitAction, window.l10n.detachedHead);
    return;
  }
  confirmRepositoryAction(
    format(window.l10n.rebaseConfirm, <b>{branch}</b>, <b>{onto}</b>),
    window.l10n.startRebase,
    { kind: "rebase", branch, onto, expectedHead },
    repo
  );
}
