import type { SafetyNetEntry, SafetyRefChange } from "@/backend/types";
import { recoverCommit } from "@/webview/components/history/ReflogView";
import { Button } from "@/webview/components/ui/Button";
import { openContentDialog } from "@/webview/lib/actions";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { getCommitDate } from "@/webview/utils/date";
import { format } from "@/webview/utils/format";

import { QueryStatus } from "./QueryControls";

/** A ref as the graph names it: `HEAD`, a branch, a tag or a remote branch. */
function refName(ref: string) {
  return ref.replace(/^refs\/(?:heads|tags|remotes)\//, "");
}

/** A short object ID, or "none" for a ref that did not exist on that side. */
function Side({ hash }: { hash: string | null }) {
  return hash === null ? (
    <span class="text-muted">{window.l10n.safetyNetNone}</span>
  ) : (
    <code title={hash}>{hash.slice(0, 8)}</code>
  );
}

function Change({ change }: { change: SafetyRefChange }) {
  return (
    <li data-safety-change={change.ref}>
      <span class="font-medium">{refName(change.ref)}</span> <Side hash={change.old} /> →{" "}
      <Side hash={change.new} />
    </li>
  );
}

/** Why Restore is not offered, or nothing when it is. */
function stateBadge(entry: SafetyNetEntry) {
  const l10n = window.l10n;
  if (entry.state === "undone") {
    return l10n.safetyNetUndone;
  }
  if (entry.state === "pending") {
    return l10n.safetyNetPending;
  }
  if (entry.state === "unfinished") {
    return l10n.safetyNetUnfinished;
  }
  return entry.undoable ? null : l10n.safetyNetRecordedOnly;
}

function Entry({ entry }: { entry: SafetyNetEntry }) {
  const l10n = window.l10n;
  const date = getCommitDate(entry.date);
  const badge = stateBadge(entry);
  return (
    <section data-safety-entry={entry.id} class="space-y-2 rounded border border-line p-2">
      <div class="flex flex-wrap items-center gap-2">
        <b class="break-words">{entry.title}</b>
        <span class="text-muted" title={date.title}>
          {date.value}
        </span>
        {badge !== null && (
          <span class="rounded border border-line px-1.5 text-xs text-muted">{badge}</span>
        )}
        {entry.restorable && (
          <Button
            class="ml-auto"
            onClick={() => sendRepositoryAction({ kind: "undoSafetyNet", id: entry.id })}
          >
            {l10n.safetyNetRestore}
          </Button>
        )}
      </div>
      <ul class="space-y-0.5">
        {entry.changes.map((change) => (
          <Change key={change.ref} change={change} />
        ))}
        {entry.saved !== null && (
          <li>{format(l10n.safetyNetSaved, <code>{entry.saved.slice(0, 8)}</code>)}</li>
        )}
        {entry.stash !== null && (
          <li>{format(l10n.safetyNetStash, <code>{entry.stash.hash.slice(0, 8)}</code>)}</li>
        )}
      </ul>
      {entry.lost.length > 0 && (
        <div class="space-y-1">
          <p class="text-muted">{l10n.safetyNetLost}</p>
          <ul class="space-y-1">
            {entry.lost.map((commit) => (
              <li
                key={commit.hash}
                data-lost-commit={commit.hash}
                class="flex flex-wrap items-center gap-2"
              >
                <code title={commit.hash}>{commit.hash.slice(0, 8)}</code>
                <span class="min-w-0 flex-1 break-words">{commit.subject}</span>
                <Button onClick={() => recoverCommit(commit.hash)}>
                  {l10n.recoverBranch + "…"}
                </Button>
              </li>
            ))}
          </ul>
          {entry.moreLost && <p class="text-muted">{l10n.safetyNetMoreLost}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * The destructive actions the Safety Net recorded, newest first: what each one changed, the
 * commits it left without a branch, and a way to put its refs back while nothing has moved them.
 */
export function SafetyNetView() {
  const l10n = window.l10n;
  const query = useRepositoryQuery<"safetyNet">({ kind: "safetyNet" });
  const data = query.data;
  return (
    <div data-safety-net class="space-y-3 text-left">
      <p class="text-muted">{l10n.safetyNetHint}</p>
      <QueryStatus loading={query.loading && data === null} error={query.error} />
      {data !== null && data.entries.length === 0 && <p>{l10n.safetyNetEmpty}</p>}
      {data?.entries.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

export function openSafetyNet() {
  openContentDialog(window.l10n.safetyNet, <SafetyNetView />, true);
}
