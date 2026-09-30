import { computed } from "@preact/signals";
import type { TargetedKeyboardEvent } from "preact";
import { useMemo } from "preact/hooks";

import type { GitRef, HistoryEntry } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { RefLabel } from "@/webview/components/commit/RefLabel";
import { fileContextMenu } from "@/webview/components/history/file-menu";
import { KebabIcon } from "@/webview/components/ui/Icons";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { focusColour } from "@/webview/graph/focus";
import type { BranchRelation } from "@/webview/graph/types";
import { closeCommitDetails, openContextMenu } from "@/webview/lib/actions";
import { commitMenu, commitMenuSource, type CommitMessages } from "@/webview/lib/menus";
import {
  focusedCommit,
  historyFilter,
  selectCommitRows,
  selectedCommits
} from "@/webview/lib/navigation";
import { activeSource, uncommittedChanges } from "@/webview/lib/stores";
import type { FocusDimming } from "@/webview/types";
import { getCommitDate } from "@/webview/utils/date";
import { format } from "@/webview/utils/format";

type CommitRowProps = {
  commit: HistoryEntry;
  /** Every row of the table in display order, for arrow keys and range selection. */
  rows?: Array<HistoryEntry>;
  /** Whether Tab enters the table at this row. The table has exactly one such row. */
  tabStop?: boolean;
  isHead: boolean;
  headBranch: string | null;
  messages: CommitMessages;
  /** Colour of the row's lane, or `undefined` when no palette is configured. */
  colour: string | undefined;
  relation?: BranchRelation;
  keepMergedBright?: boolean;
  /** How strongly the graph dims history away from the focused branch; the labels follow it. */
  dimming?: FocusDimming;
  /** Whether the details of this row are open beneath it. */
  expanded: boolean;
  onSelect: (() => void) | undefined;
  /** Asks the table to scroll the graph sideways until this commit's dot shows. */
  onRevealLane?: (hash: string) => void;
};

/** Where a keyboard-opened menu hangs, from the row's left edge, in pixels. */
const MENU_INSET = 80;

/**
 * Keys that move to another row, and where each one lands from row `at`, clamped to the rows
 * there are. A row missing from the list counts as sitting just above the first.
 */
type Move = (at: number, last: number) => number;
const MOVES = new Map<string, Move>([
  ["ArrowUp", (at) => Math.max(at - 1, 0)],
  ["ArrowDown", (at, last) => Math.min(at + 1, last)],
  ["Home", () => 0],
  ["End", (_at, last) => last]
]);

/** Labels in the order they arrive, except that the checked-out branch leads. */
function orderRefs(refs: Array<GitRef>, headBranch: string | null) {
  const current = refs.findIndex((ref) => ref.type === "head" && ref.name === headBranch);
  return current <= 0 ? refs : [refs[current]!, ...refs.filter((_ref, index) => index !== current)];
}

/** The text of the uncommitted-changes row for `count` changed paths, singular for one. */
function uncommittedText(count: number) {
  const l10n = window.l10n;
  return format(count === 1 ? l10n.uncommittedChange : l10n.uncommittedChanges, count).join("");
}

/** A signal that holds whether `test` passes, so a row re-renders only when its answer changes. */
function useWatch(test: () => boolean, key: string) {
  return useMemo(() => computed(test), [key]).value;
}

/** Every cell is one 24px line, which is the grid the graph is drawn on. */
const LINE = "h-6 truncate leading-6";
const CELL = `${LINE} px-1`;

/**
 * One commit of the history table: its graph cell, description, date, author and short hash.
 * The row is also a keyboard stop: arrows move between rows, Enter opens the details, Space
 * toggles the selection, and the menu key opens the commit's actions.
 */
export function CommitRow({
  commit,
  rows = [commit],
  tabStop = true,
  isHead,
  headBranch,
  messages,
  colour,
  relation = "normal",
  keepMergedBright = false,
  dimming = "subtle",
  expanded,
  onSelect,
  onRevealLane
}: CommitRowProps) {
  const { hash } = commit;
  const uncommitted = hash === UNCOMMITTED_CHANGES;
  const source = commitMenuSource(hash);
  const menuOpen = useWatch(() => activeSource.value === source, source);
  const selected = useWatch(() => selectedCommits.value.some((entry) => entry.hash === hash), hash);
  const l10n = window.l10n;

  const message = uncommitted ? uncommittedText(uncommittedChanges.value) : commit.message;
  const date = uncommitted ? null : getCommitDate(commit.date);
  const emphasized = isHead || uncommitted || expanded || selected || menuOpen;
  const background =
    expanded || selected
      ? "bg-row-selected hover:bg-row-selected-hover"
      : menuOpen
        ? "bg-row-hover"
        : isHead
          ? "bg-row-head hover:bg-row-hover"
          : "hover:bg-row-hover";

  /** The user arrived at this row: remember it and bring its dot into view. */
  function arrive(target: string) {
    focusedCommit.value = target;
    onRevealLane?.(target);
  }

  function menuEntries() {
    const entries = commitMenu(commit, messages);
    if (commit.filePath) {
      entries.push(
        null,
        ...fileContextMenu(
          hash,
          commit.filePath,
          commit.previousPath ?? commit.filePath,
          commit.change?.startsWith("D") ?? false,
          historyFilter.value.path
        )
      );
    }
    return entries;
  }

  /** Open the details of this row, or of the uncommitted changes, which are never selected. */
  function activate() {
    if (uncommitted) {
      selectedCommits.value = [];
    }
    onSelect?.();
  }

  function move(event: KeyboardEvent, row: HTMLTableRowElement, to: Move) {
    const at = rows.findIndex((entry) => entry.hash === hash);
    const target = rows[to(at, rows.length - 1)];
    if (target === undefined) {
      return;
    }
    arrive(target.hash);
    if (target.hash !== UNCOMMITTED_CHANGES) {
      selectCommitRows(target, rows, false, event.shiftKey);
    } else if (!event.shiftKey) {
      selectedCommits.value = [];
    }
    // Without `preventScroll`: the browser scrolls the row clear of the sticky headings.
    row
      .closest("table")
      ?.querySelector<HTMLElement>(`tr[data-commit-hash=${JSON.stringify(target.hash)}]`)
      ?.focus();
  }

  function onKeyDown(event: TargetedKeyboardEvent<HTMLTableRowElement>) {
    // Keys pressed on something inside the row, such as a label, are not the row's to handle.
    if (event.target !== event.currentTarget) {
      return;
    }
    const { key } = event;
    const to = MOVES.get(key);
    if (to !== undefined) {
      event.preventDefault();
      move(event, event.currentTarget, to);
    } else if (key === "Enter" || (key === " " && uncommitted)) {
      event.preventDefault();
      activate();
    } else if (key === " ") {
      event.preventDefault();
      selectCommitRows(commit, rows, true, event.shiftKey);
    } else if (key === "Escape" && expanded) {
      // Focus stays on this row, as it would after Escape inside the details.
      event.preventDefault();
      event.stopPropagation();
      closeCommitDetails();
    } else if (!uncommitted && (key === "ContextMenu" || (key === "F10" && event.shiftKey))) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      const at = new MouseEvent("contextmenu", {
        clientX: box.left + MENU_INSET,
        clientY: box.bottom
      });
      openContextMenu(at, source, menuEntries());
    }
  }

  return (
    <tr
      class={`branch-focus-row group focus:outline-1 focus:-outline-offset-1 focus:outline-focus ${background} ${
        onSelect === undefined ? "" : "cursor-pointer"
      }`}
      style={{
        "--branch-colour": focusColour(colour, "normal"),
        "--branch-display-colour": focusColour(colour, relation, keepMergedBright, dimming)
      }}
      data-commit-hash={hash}
      data-branch-relation={relation === "merged" && keepMergedBright ? "direct" : relation}
      data-emphasized={String(emphasized)}
      tabIndex={tabStop ? 0 : -1}
      aria-selected={uncommitted ? expanded : selected}
      aria-expanded={expanded}
      title={uncommitted ? l10n.viewWorkingTreeChanges : l10n.selectCommitsHint}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          arrive(hash);
        }
      }}
      onClick={(event) => {
        arrive(hash);
        event.currentTarget.focus({ preventScroll: true });
        if (uncommitted) {
          activate();
          return;
        }
        const toggle = event.ctrlKey || event.metaKey;
        selectCommitRows(commit, rows, toggle, event.shiftKey);
        if (!toggle && !event.shiftKey) {
          onSelect?.();
        }
      }}
      onContextMenu={
        uncommitted ? undefined : (event) => openContextMenu(event, source, menuEntries())
      }
      onKeyDown={onKeyDown}
    >
      <td class={CELL} />
      <td class={`${LINE} w-full max-w-0 pr-1 pl-2.5 ${isHead ? "shadow-head" : ""}`}>
        <div class="flex min-w-0 items-center">
          {isHead && <span class="mr-1.25 size-2.5 shrink-0 rounded-full border-2 border-graph" />}
          {commit.refs.length > 0 && (
            <span class="flex max-w-1/2 shrink-0 overflow-hidden">
              {orderRefs(commit.refs, headBranch).map((ref) => (
                <RefLabel
                  key={`${ref.type}:${ref.name}`}
                  gitRef={ref}
                  active={ref.type === "head" && ref.name === headBranch}
                />
              ))}
            </span>
          )}
          <span class="min-w-0 flex-1 truncate" title={message}>
            {isHead || uncommitted ? <b>{message}</b> : message}
          </span>
          {!uncommitted && (
            <button
              type="button"
              tabIndex={-1}
              aria-haspopup="menu"
              aria-label={l10n.commitActions.replace("{0}", () => abbrevCommit(hash))}
              class={`ml-1 flex h-5 shrink-0 cursor-pointer items-center rounded-sm px-1 hover:bg-btn-hover ${
                menuOpen ? "" : "invisible group-hover:visible"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                openContextMenu(event, source, menuEntries());
              }}
            >
              <KebabIcon class="size-3.5" />
            </button>
          )}
        </div>
      </td>
      <td class={CELL} title={date?.title}>
        {date?.value}
      </td>
      <td
        class={`${CELL} max-w-31`}
        title={uncommitted ? undefined : `${commit.author} <${commit.email}>`}
      >
        {uncommitted ? null : commit.author}
      </td>
      <td class={`${CELL} font-mono`} title={uncommitted ? undefined : hash}>
        {uncommitted ? null : abbrevCommit(hash)}
      </td>
    </tr>
  );
}
