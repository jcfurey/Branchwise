import { computed } from "@preact/signals";
import { useMemo } from "preact/hooks";

import type { ConflictForecastEntry, GitRef } from "@/backend/types";
import { BranchFocusBadge } from "@/webview/components/commit/BranchFocusBadge";
import { BranchIcon, ConflictIcon, RemoteIcon, TagIcon } from "@/webview/components/ui/Icons";
import { openContextMenu } from "@/webview/lib/actions";
import { checkoutBranchAction, refMenu, refMenuSource } from "@/webview/lib/menus";
import { repositoryState } from "@/webview/lib/repository-actions";
import { activeSource } from "@/webview/lib/stores";
import { getRelativeDate } from "@/webview/utils/date";

/** What the repository state says about a local branch: its tracking and where it is checked out. */
function localBranchFacts(gitRef: GitRef) {
  const state = repositoryState.value;
  if (gitRef.type !== "head" || state === null) {
    return { branch: undefined, worktree: undefined };
  }
  return {
    branch: state.branches.find((entry) => entry.name === gitRef.name),
    worktree: state.worktrees.find((entry) => entry.branch === gitRef.name)
  };
}

/** Files listed by name in the tooltip of a conflict forecast; the rest are counted. */
export const CONFLICTS_LISTED = 10;

/** Who made a forecast branch's last commit, and how long ago. */
export function lastCommitBy(entry: ConflictForecastEntry): string {
  // Function replacements insert the name as written, even when it contains `$`.
  return window.l10n.lastCommitBy
    .replace("{0}", () => entry.committer)
    .replace("{1}", () => getRelativeDate(entry.date));
}

/**
 * A warning that merging the branch into HEAD would stop with conflicts in its files, with the
 * number of them. The tooltip names the files and, for a remote branch, whose work it holds:
 * the committer of its last commit and how long ago that was.
 */
export function ConflictBadge({ entry }: { entry: ConflictForecastEntry }) {
  const l10n = window.l10n;
  const { files } = entry;
  const into = repositoryState.value?.head || "HEAD";
  const summary = (entry.remote ? l10n.teamConflictForecast : l10n.conflictForecast).replace(
    "{0}",
    () => into
  );
  const lines = [summary, ...files.slice(0, CONFLICTS_LISTED)];
  if (files.length > CONFLICTS_LISTED) {
    lines.push(l10n.conflictForecastMore.replace("{0}", String(files.length - CONFLICTS_LISTED)));
  }
  if (entry.remote) {
    lines.push(lastCommitBy(entry));
  }
  return (
    <span
      data-conflicts={files.length}
      role="img"
      aria-label={summary}
      class="ml-1 flex shrink-0 items-center gap-0.5 text-git-conflict"
      title={lines.join("\n")}
    >
      <ConflictIcon class="size-3.5" />
      {files.length}
    </span>
  );
}

/**
 * A branch or tag on a commit row. The tooltip starts with the ref's name, then adds what the
 * repository state knows about a local branch: its upstream and the worktree holding it.
 * `remotes` are remote branches of the same name on the same commit, shown as a cloud at the
 * end of the label, with their own tooltip and menu. `conflict` is the forecast of merging the
 * branch into HEAD, when that would leave files in conflict.
 */
export function RefLabel({
  gitRef,
  active,
  remotes = [],
  conflict
}: {
  gitRef: GitRef;
  active: boolean;
  remotes?: Array<GitRef>;
  conflict?: ConflictForecastEntry | undefined;
}) {
  const source = refMenuSource(gitRef);
  // Every label of the ref shares the key, so all of them light up while its menu is open.
  const menuOpen = useMemo(() => computed(() => activeSource.value === source), [source]).value;
  const { branch, worktree } = localBranchFacts(gitRef);
  const l10n = window.l10n;

  const lines = [gitRef.name];
  if (active) {
    lines.push(l10n.tooltipCurrentBranch);
  }
  if (branch !== undefined && branch.upstream !== "") {
    lines.push(branch.upstream);
  }
  if (branch?.gone === true) {
    lines.push(l10n.upstreamGone);
  }
  if (worktree !== undefined) {
    // A function replacement keeps `$` sequences in the path as they are.
    lines.push(l10n.worktreeAt.replace("{0}", () => worktree.path));
  }

  const tracking =
    branch !== undefined &&
    branch.upstream !== "" &&
    !branch.gone &&
    (branch.ahead > 0 || branch.behind > 0);
  const Glyph = gitRef.type === "tag" ? TagIcon : BranchIcon;

  return (
    <span
      class={`mt-0.5 mr-1.25 box-content inline-flex h-4.5 max-w-full items-center overflow-hidden rounded-md border pr-1.25 align-top text-xs ${
        active ? "border-graph" : "border-line"
      } ${menuOpen ? "bg-btn-hover" : "bg-btn"}`}
      title={lines.join("\n")}
      onContextMenu={(event) => openContextMenu(event, source, refMenu(gitRef, active))}
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => {
        event.stopPropagation();
        // The checked-out branch is where it should be already.
        if (!active) {
          checkoutBranchAction(gitRef);
        }
      }}
    >
      <Glyph class="mr-1.25 size-4.5 shrink-0 rounded-l-sm bg-graph p-0.5 text-editor" />
      <span class={`truncate ${active ? "font-bold" : ""}`}>{gitRef.name}</span>
      {gitRef.type !== "tag" && (
        <BranchFocusBadge
          branch={gitRef.type === "remote" ? `remotes/${gitRef.name}` : gitRef.name}
        />
      )}
      {tracking && (
        <span class="ml-1 whitespace-nowrap">{`↑${branch.ahead} ↓${branch.behind}`}</span>
      )}
      {worktree !== undefined && !active && <span class="ml-1">↗</span>}
      {conflict !== undefined && conflict.files.length > 0 && <ConflictBadge entry={conflict} />}
      {remotes.length > 0 && (
        <span
          data-remote-refs={remotes.map((remote) => remote.name).join(" ")}
          class="ml-1 flex shrink-0 items-center gap-0.5 text-muted"
          title={remotes.map((remote) => remote.name).join("\n")}
          onContextMenu={(event) =>
            openContextMenu(event, refMenuSource(remotes[0]!), refMenu(remotes[0]!, false))
          }
        >
          <RemoteIcon class="size-3.5" />
          {remotes.length > 1 && remotes.length}
        </span>
      )}
    </span>
  );
}
