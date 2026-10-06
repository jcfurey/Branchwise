import { h, render } from "preact";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { BranchIcon } from "@/webview/components/ui/Icons";
import { openContextMenu } from "@/webview/lib/actions";
import { commitMenu, type CommitMessages, refMenu, refMenuSource } from "@/webview/lib/menus";
import { headBranch } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import type { ContextMenuEntry } from "@/webview/types";

/**
 * Drag and drop in the graph and the Branches pane. A commit row or a local branch is dragged
 * onto a branch, and the drop offers what that branch's or that commit's own menu would: a
 * cherry-pick, a merge or a rebase. Each action is the menu entry itself, found by its title and
 * clicked, so a drop opens the same confirmation as the menu and nothing runs on the drop alone.
 *
 * The containers listen once for the whole table or pane; rows and labels only carry attributes.
 */

/** The type of the data a drag carries, so that a drop from anywhere else is ignored. */
export const DRAG_TYPE = "application/x-branchwise-ref";

/** What a drag carries: one commit with what its menu needs, or one local branch. */
export type Carried =
  | { kind: "commit"; commit: GitCommitNode; messages: CommitMessages }
  | { kind: "branch"; ref: GitRef };

type Entry = Exclude<ContextMenuEntry, null>;

/**
 * What a drop on a branch would do: the actions to choose from, and the text shown beside the
 * pointer. No actions means the branch refuses the drop, and the hint, if any, says why.
 */
export type DropOffer = { actions: Array<Entry>; hint: string | null };

/** The commits of the table a drag starts in, by full hash, and their subjects. */
export type CommitLookup = {
  commit: (hash: string) => GitCommitNode | undefined;
  messages: CommitMessages;
};

const NOTHING: DropOffer = { actions: [], hint: null };

/** Classes that show a branch accepting the dragged commit or branch under the pointer. */
export const DROP_TARGET_CLASS =
  "data-[drop=valid]:bg-drop data-[drop=valid]:outline-1 data-[drop=valid]:-outline-offset-1 data-[drop=valid]:outline-focus";

export function dragAndDropOn(): boolean {
  return getWebviewConfig().dragAndDrop;
}

/**
 * The attributes that make a branch label or Branches pane row a drop target, and a local
 * branch something to drag. A tag is neither, so dragging its label drags the commit row.
 */
export function refDragAttributes(gitRef: GitRef) {
  if (gitRef.type === "tag") {
    return {};
  }
  return {
    "data-ref": `${gitRef.type}:${gitRef.name}`,
    "data-ref-hash": gitRef.hash,
    draggable: gitRef.type === "head" && dragAndDropOn() ? true : undefined
  };
}

/** The ref an element made with `refDragAttributes` stands for. */
function refOf(element: HTMLElement): GitRef | null {
  const value = element.dataset["ref"] ?? "";
  const colon = value.indexOf(":");
  const type = value.slice(0, colon);
  // A ref name never contains a colon, so the first one ends the type.
  if (type !== "head" && type !== "remote") {
    return null;
  }
  return { type, name: value.slice(colon + 1), hash: element.dataset["refHash"] ?? "" };
}

/** `template` with `{0}`, `{1}` replaced by `values`, written as given even with `$` in them. */
function fill(template: string, ...values: Array<string>) {
  return values.reduce(
    (text, value, index) => text.replaceAll(`{${index}}`, () => value),
    template
  );
}

/** The entry of `entries` titled `title`, with or without the "…" of an entry that asks more. */
function menuEntry(entries: Array<ContextMenuEntry>, title: string): Entry | null {
  return entries.find((entry) => entry?.title === title || entry?.title === title + "…") ?? null;
}

/**
 * What dropping `carried` on `target` offers. Git cherry-picks, merges and rebases only on the
 * checked-out branch, so a commit can go onto that branch alone, a branch can be merged into it,
 * and only it can be rebased onto another; the menus offer the same, under the same conditions.
 */
export function dropOffer(carried: Carried, target: GitRef): DropOffer {
  const l10n = window.l10n;
  const current = headBranch.peek();
  const isCurrent = (ref: GitRef) => ref.type === "head" && ref.name === current;

  if (carried.kind === "commit") {
    const { commit } = carried;
    if (!isCurrent(target)) {
      return { actions: [], hint: fill(l10n.dropCherryPickCheckout, target.name) };
    }
    // The branch's own tip is already on it.
    const entry =
      commit.hash === target.hash
        ? null
        : menuEntry(commitMenu(commit, carried.messages), l10n.cherryPick);
    if (entry === null) {
      return NOTHING;
    }
    const title = fill(l10n.dropCherryPick, abbrevCommit(commit.hash), target.name);
    return { actions: [{ title, onClick: entry.onClick }], hint: title };
  }

  const source = carried.ref;
  if (source.type !== "head" || (target.type === source.type && target.name === source.name)) {
    return NOTHING;
  }
  const actions: Array<Entry> = [];
  // The branch's menu merges it into the checked-out branch.
  const merge = isCurrent(target) ? menuEntry(refMenu(source, false), l10n.merge) : null;
  if (merge !== null) {
    actions.push({ title: fill(l10n.dropMerge, source.name, target.name), onClick: merge.onClick });
  }
  // The target's menu rebases the checked-out branch onto it.
  const rebase = isCurrent(source) ? menuEntry(refMenu(target, false), l10n.rebaseOnto) : null;
  if (rebase !== null) {
    actions.push({
      title: fill(l10n.dropRebase, source.name, target.name),
      onClick: rebase.onClick
    });
  }
  if (actions.length > 0) {
    return { actions, hint: actions.map((action) => action.title).join("\n") };
  }
  if (isCurrent(source) || isCurrent(target)) {
    return NOTHING;
  }
  return {
    actions: [],
    hint:
      target.type === "head"
        ? fill(l10n.dropMergeOrRebaseCheckout, target.name, source.name)
        : fill(l10n.dropRebaseCheckout, source.name, target.name)
  };
}

/* The drag in progress. One at a time, shared by the table and the pane. */

let carried: Carried | null = null;
/** The branch under the pointer, marked valid or invalid, and what it offers. */
let over: { element: HTMLElement; offer: DropOffer } | null = null;
let hintBox: HTMLElement | null = null;

const PILL_CLASS = [
  "fixed -top-24 left-0 flex max-w-80 items-center gap-1.5 rounded-full border border-focus",
  "bg-menu px-2 py-0.5 text-xs whitespace-nowrap text-menu-fg"
].join(" ");
const HINT_CLASS = [
  "pointer-events-none fixed z-30 max-w-80 rounded-sm border border-line bg-menu px-2 py-1",
  "text-xs whitespace-pre-line text-menu-fg shadow-md"
].join(" ");
/** How far above the pointer the hint sits, in pixels, clear of the drag image below it. */
const HINT_ABOVE = 32;

/** What is being dragged, as a pill: "3a4b5c6 Fix parser", or a branch icon and its name. */
function setDragImage(data: DataTransfer, what: Carried) {
  const pill = document.createElement("div");
  pill.className = PILL_CLASS;
  pill.setAttribute("data-drag-image", "");
  render(
    what.kind === "commit"
      ? [
          h("span", { class: "font-mono" }, abbrevCommit(what.commit.hash)),
          h("span", { class: "truncate" }, what.commit.message.split("\n")[0])
        ]
      : [h(BranchIcon, { class: "size-3.5 shrink-0" }), h("span", null, what.ref.name)],
    pill
  );
  document.body.append(pill);
  data.setDragImage?.(pill, 0, 0);
  // The browser takes its picture before the next task.
  setTimeout(() => {
    render(null, pill);
    pill.remove();
  });
}

function showHint(text: string | null, x: number, y: number) {
  if (text === null) {
    if (hintBox !== null) {
      hintBox.hidden = true;
    }
    return;
  }
  if (hintBox === null) {
    hintBox = document.createElement("div");
    hintBox.className = HINT_CLASS;
    hintBox.setAttribute("data-drop-hint", "");
    document.body.append(hintBox);
  }
  hintBox.hidden = false;
  hintBox.textContent = text;
  const left = Math.min(x + 12, window.innerWidth - hintBox.offsetWidth - 4);
  hintBox.style.left = `${Math.max(left, 4)}px`;
  hintBox.style.top = `${Math.max(y - HINT_ABOVE, 4)}px`;
}

/** Point at `element`, or at nothing, marking the branch as accepting the drop or not. */
function hover(element: HTMLElement | null) {
  if (over?.element === element) {
    return over;
  }
  over?.element.removeAttribute("data-drop");
  over = null;
  const target = element === null ? null : refOf(element);
  if (element === null || target === null || carried === null) {
    return null;
  }
  const offer = dropOffer(carried, target);
  element.setAttribute("data-drop", offer.actions.length > 0 ? "valid" : "invalid");
  over = { element, offer };
  return over;
}

function onEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    finish();
  }
}

/** Forget the drag and take its marks down: after a drop, at its end, or on Escape. */
function finish() {
  carried = null;
  hover(null);
  showHint(null, 0, 0);
  window.removeEventListener("keydown", onEscape, true);
}

/** The nearest element around the target of `event` that matches `selector`, if any. */
function closest(event: Event, selector: string): HTMLElement | null {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

/** The commit row or local branch a drag starts on, or `null` to leave the drag to the browser. */
function carriedFrom(event: DragEvent, lookup: CommitLookup | null): Carried | null {
  // The innermost draggable element: a branch label sits inside its commit's row.
  const element = closest(event, "[draggable=true]");
  if (element === null || !(event.currentTarget as Node).contains(element)) {
    return null;
  }
  const ref = element.hasAttribute("data-ref") ? refOf(element) : null;
  if (ref !== null) {
    return ref.type === "head" ? { kind: "branch", ref } : null;
  }
  const hash = element.matches("tr[data-commit-hash]") ? element.dataset["commitHash"] : undefined;
  const commit = hash === undefined ? undefined : lookup?.commit(hash);
  return commit === undefined || lookup === null
    ? null
    : { kind: "commit", commit, messages: lookup.messages };
}

/** The effect a drop of `what` has: a cherry-pick copies a commit, a merge or rebase moves one. */
function effect(what: Carried) {
  return what.kind === "commit" ? "copy" : "move";
}

/**
 * The drag and drop listeners of the history table or the Branches pane. `lookup` finds the
 * commits of the rows, which the pane has none of.
 */
export function dragHandlers(lookup: () => CommitLookup | null) {
  return {
    onDragStart(event: DragEvent) {
      const data = event.dataTransfer;
      if (!dragAndDropOn() || data === null) {
        return;
      }
      const what = carriedFrom(event, lookup());
      if (what === null) {
        return;
      }
      finish();
      carried = what;
      data.effectAllowed = effect(what);
      data.setData(
        DRAG_TYPE,
        JSON.stringify(
          what.kind === "commit"
            ? { kind: "commit", hash: what.commit.hash }
            : { kind: "branch", name: what.ref.name }
        )
      );
      setDragImage(data, what);
      window.addEventListener("keydown", onEscape, true);
    },

    onDragOver(event: DragEvent) {
      if (carried === null) {
        return;
      }
      const target = hover(closest(event, "[data-ref]"));
      const valid = target !== null && target.offer.actions.length > 0;
      if (valid) {
        // Accepting the drop; otherwise the browser shows the not-allowed cursor.
        event.preventDefault();
      }
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = valid ? effect(carried) : "none";
      }
      showHint(target?.offer.hint ?? null, event.clientX, event.clientY);
    },

    onDragLeave(event: DragEvent) {
      const to = event.relatedTarget;
      if (!(to instanceof Node) || !(event.currentTarget as Node).contains(to)) {
        hover(null);
        showHint(null, 0, 0);
      }
    },

    onDrop(event: DragEvent) {
      const what = carried;
      if (what === null) {
        return;
      }
      event.preventDefault();
      const element = closest(event, "[data-ref]");
      const target = hover(element);
      const ref = element === null ? null : refOf(element);
      finish();
      if (target === null || ref === null || target.offer.actions.length === 0) {
        return;
      }
      const { actions } = target.offer;
      if (actions.length === 1) {
        // The hint named the one thing the drop does; its own confirmation follows.
        actions[0]!.onClick();
      } else {
        openContextMenu(event, refMenuSource(ref), actions);
      }
    },

    onDragEnd() {
      finish();
    }
  };
}
