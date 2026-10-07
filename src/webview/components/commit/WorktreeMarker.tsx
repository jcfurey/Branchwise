import { computed } from "@preact/signals";
import { useMemo } from "preact/hooks";

import { WorktreeIcon } from "@/webview/components/ui/Icons";
import { openContextMenu } from "@/webview/lib/actions";
import { worktreeEntries, worktreeMenuSource } from "@/webview/lib/menus";
import { activeSource } from "@/webview/lib/stores";
import { type WorktreeMarker, worktreeTooltip } from "@/webview/lib/worktrees";

/** The dot of a worktree with uncommitted changes, which says so in words as well. */
function ChangesDot({ class: position }: { class: string }) {
  return (
    <span
      role="img"
      aria-label={window.l10n.worktreeDirty}
      class={`size-1.5 shrink-0 rounded-full bg-git-modified ${position}`}
    />
  );
}

/**
 * The worktree mark on the label of the branch another worktree has checked out, with a dot when
 * that worktree has uncommitted changes. Its menu is the branch's, which lists the worktree's
 * actions.
 */
export function WorktreeBadge({ marker }: { marker: WorktreeMarker }) {
  const lines = worktreeTooltip(marker);
  const dirty = marker.change === "dirty";
  return (
    <span
      data-worktree={marker.path}
      data-worktree-dirty={dirty ? "" : undefined}
      role="img"
      aria-label={lines.join(", ")}
      title={lines.join("\n")}
      class="relative ml-1 flex shrink-0 items-center text-muted"
    >
      <WorktreeIcon class="size-3.5" />
      {dirty && <ChangesDot class="absolute -top-px -right-0.5" />}
    </span>
  );
}

/**
 * A label of its own for a worktree whose branch has no label on the row, as for one on a
 * detached HEAD, such as "worktree: ../feature-x".
 */
export function WorktreeLabel({ marker }: { marker: WorktreeMarker }) {
  const source = worktreeMenuSource(marker);
  const menuOpen = useMemo(() => computed(() => activeSource.value === source), [source]).value;
  const lines = worktreeTooltip(marker);
  const dirty = marker.change === "dirty";
  const entries = worktreeEntries(marker);
  return (
    <span
      data-worktree={marker.path}
      data-worktree-dirty={dirty ? "" : undefined}
      class={`mt-0.5 mr-1.25 box-content inline-flex h-4.5 max-w-full items-center overflow-hidden rounded-md border border-line pr-1.25 align-top text-xs ${
        menuOpen ? "bg-btn-hover" : "bg-btn"
      }`}
      title={lines.join("\n")}
      onContextMenu={
        entries.length === 0 ? undefined : (event) => openContextMenu(event, source, entries)
      }
      onClick={(event) => event.stopPropagation()}
    >
      <WorktreeIcon class="mr-1.25 size-4.5 shrink-0 rounded-l-sm bg-graph p-0.5 text-editor" />
      <span class="truncate">{window.l10n.worktreeLabel.replace("{0}", () => marker.name)}</span>
      {dirty && <ChangesDot class="ml-1" />}
    </span>
  );
}
