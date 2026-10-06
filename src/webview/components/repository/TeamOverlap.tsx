import type { ConflictForecastEntry } from "@/backend/types";
import { CONFLICTS_LISTED, lastCommitBy } from "@/webview/components/commit/RefLabel";
import { ConflictIcon, RemoteIcon } from "@/webview/components/ui/Icons";
import { closeDialog, focusBranchInGraph, openContentDialog } from "@/webview/lib/actions";
import { repositoryState } from "@/webview/lib/repository-actions";

const LINK_CLASS =
  "cursor-pointer rounded px-1 text-link hover:underline focus:outline-1 focus:outline-focus";

/**
 * The remote branches that would conflict with HEAD, newest first: whose work each one is, how
 * old, and the files. Choosing one closes the dialog and emphasises that branch in the graph.
 */
function TeamOverlapList({ entries }: { entries: ReadonlyArray<ConflictForecastEntry> }) {
  const l10n = window.l10n;
  return (
    <div class="space-y-2 text-left">
      <p class="text-muted">{l10n.teamOverlapHint}</p>
      <ul class="space-y-1">
        {entries.map((entry) => {
          const more = entry.files.length - CONFLICTS_LISTED;
          return (
            <li key={entry.branch}>
              <button
                type="button"
                data-team-overlap-branch={entry.branch}
                class="w-full cursor-pointer space-y-0.5 rounded px-2 py-1 text-left hover:bg-btn-hover focus:outline-1 focus:outline-focus"
                onClick={() => {
                  closeDialog();
                  focusBranchInGraph(`remotes/${entry.branch}`);
                }}
              >
                <span class="flex items-center gap-1.5 font-semibold">
                  <RemoteIcon class="size-3.5 shrink-0 text-muted" />
                  <span class="break-all">{entry.branch}</span>
                  <span class="flex shrink-0 items-center gap-0.5 font-normal text-git-conflict">
                    <ConflictIcon class="size-3.5" />
                    {entry.files.length}
                  </span>
                </span>
                <span class="block text-xs text-muted">{lastCommitBy(entry)}</span>
                <span class="block text-xs break-all">
                  {entry.files.slice(0, CONFLICTS_LISTED).join(", ")}
                  {more > 0 && ` ${l10n.conflictForecastMore.replace("{0}", String(more))}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function openTeamOverlap(entries: ReadonlyArray<ConflictForecastEntry>) {
  const into = repositoryState.value?.head || "HEAD";
  // A function replacement inserts the name as written, even when it contains `$`.
  const title = window.l10n.teamOverlapTitle.replace("{0}", () => into);
  openContentDialog(title, <TeamOverlapList entries={entries} />);
}

/**
 * A line above the graph saying how many remote branches would conflict with HEAD, which opens
 * the list of them. Nothing while none would. Local branches are left to their own labels: the
 * line is about work the user may not know of yet.
 */
export function TeamOverlapSummary({
  conflicts
}: {
  conflicts: ReadonlyArray<ConflictForecastEntry> | undefined;
}) {
  const l10n = window.l10n;
  const remote = conflicts?.filter((entry) => entry.remote) ?? [];
  if (remote.length === 0) {
    return null;
  }
  const text =
    remote.length === 1
      ? l10n.teamOverlapOne
      : l10n.teamOverlapMany.replace("{0}", String(remote.length));
  return (
    <div
      role="note"
      data-team-overlap={remote.length}
      class="flex flex-wrap items-center gap-x-1 border-b border-line-soft px-3 py-0.5 text-xs"
    >
      <ConflictIcon class="size-3.5 shrink-0 text-git-conflict" />
      <button
        type="button"
        class={LINK_CLASS}
        aria-haspopup="dialog"
        onClick={() => openTeamOverlap(remote)}
      >
        {text}
      </button>
    </div>
  );
}
