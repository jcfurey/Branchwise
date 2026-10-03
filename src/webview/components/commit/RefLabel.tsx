import { computed } from "@preact/signals";
import { useMemo } from "preact/hooks";

import type { GitRef } from "@/backend/types";
import { BranchFocusBadge } from "@/webview/components/commit/BranchFocusBadge";
import { BranchIcon, RemoteIcon, TagIcon } from "@/webview/components/ui/Icons";
import { openContextMenu } from "@/webview/lib/actions";
import { checkoutBranchAction, refMenu, refMenuSource } from "@/webview/lib/menus";
import { repositoryState } from "@/webview/lib/repository-actions";
import { activeSource } from "@/webview/lib/stores";

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

/**
 * A branch or tag on a commit row. The tooltip starts with the ref's name, then adds what the
 * repository state knows about a local branch: its upstream and the worktree holding it.
 * `remotes` are remote branches of the same name on the same commit, shown as a cloud at the
 * end of the label, with their own tooltip and menu.
 */
export function RefLabel({
  gitRef,
  active,
  remotes = []
}: {
  gitRef: GitRef;
  active: boolean;
  remotes?: Array<GitRef>;
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
