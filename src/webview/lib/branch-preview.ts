import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { repositoryRevision, requestPanelQuery } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";

// A light, passing version of branch focus: resting the pointer on a branch or tag label, or
// the keyboard on a branch in the Branches pane, shows that ref's history in the graph until
// the pointer or keyboard moves on. It reads the same membership as focus, and never touches the
// focus, the selection, the scroll position or the keyboard focus.

/** A ref whose history a preview shows: a branch spelt as in the branch list, or a tag. */
export type PreviewTarget = Readonly<{ name: string; tag: boolean }>;

/** The commits of the previewed ref, split as branch focus splits them. */
export type Membership = Readonly<{ direct: ReadonlyArray<string>; merged: ReadonlyArray<string> }>;

/** How long the pointer or keyboard rests on a label before its history shows. */
export const PREVIEW_DELAY_MS = 400;

/** The ref whose history is shown, once the delay has passed; `null` while there is none. */
export const previewTarget = signal<PreviewTarget | null>(null);

/** The target waiting for the delay to pass, and its timer. */
let pending: { target: PreviewTarget; timer: ReturnType<typeof setTimeout> } | null = null;

const sameTarget = (a: PreviewTarget | null | undefined, b: PreviewTarget) =>
  a?.name === b.name && a.tag === b.tag;

/** The preview target of a graph label: a branch spelt as the branch list spells it, or a tag. */
export function refPreviewTarget(ref: GitRef): PreviewTarget {
  return {
    name: ref.type === "remote" ? `remotes/${ref.name}` : ref.name,
    tag: ref.type === "tag"
  };
}

/** Escape ends a shown preview and goes no further, as it would close a tooltip. */
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") {
    return;
  }
  if (previewTarget.peek() !== null) {
    event.preventDefault();
    event.stopPropagation();
  }
  endPreview();
}

/** What ends a preview besides the pointer leaving: any scroll, press or click on the page. */
const ENDING_EVENTS = ["scroll", "pointerdown", "click"] as const;

/** Listened to only while a preview is shown or waiting, in the capture phase to see them all. */
function listen(on: boolean) {
  if (on) {
    window.addEventListener("keydown", onKeyDown, true);
    ENDING_EVENTS.forEach((type) => window.addEventListener(type, endPreview, true));
  } else {
    window.removeEventListener("keydown", onKeyDown, true);
    ENDING_EVENTS.forEach((type) => window.removeEventListener(type, endPreview, true));
  }
}

/**
 * Show `target`'s history once the pointer or keyboard has rested on it for the delay. Nothing
 * else happens until then, so passing over labels costs a timer each.
 */
export function schedulePreview(target: PreviewTarget): void {
  if (!getWebviewConfig().branchHoverPreview) {
    return;
  }
  if (sameTarget(previewTarget.peek(), target) || sameTarget(pending?.target, target)) {
    return;
  }
  endPreview();
  pending = {
    target,
    timer: setTimeout(() => {
      pending = null;
      previewTarget.value = target;
    }, PREVIEW_DELAY_MS)
  };
  listen(true);
}

/** End the preview, shown or still waiting; whatever was shown before comes back as it was. */
export function endPreview(): void {
  if (pending !== null) {
    clearTimeout(pending.timer);
    pending = null;
  }
  listen(false);
  if (previewTarget.peek() !== null) {
    previewTarget.value = null;
  }
}

/** End the preview if it is `target`'s, as when its label leaves the page under the pointer. */
export function endPreviewOf(target: PreviewTarget): void {
  if (sameTarget(previewTarget.peek(), target) || sameTarget(pending?.target, target)) {
    endPreview();
  }
}

/**
 * The pointer handlers of a label that previews `target`, ending its preview should the label
 * leave the page while the pointer is still on it.
 */
export function usePreviewHandlers(target: PreviewTarget | undefined) {
  const name = target?.name;
  const tag = target?.tag;
  useEffect(() => {
    if (name === undefined || tag === undefined) {
      return;
    }
    return () => endPreviewOf({ name, tag });
  }, [name, tag]);
  if (target === undefined) {
    return {};
  }
  return { onMouseEnter: () => schedulePreview(target), onMouseLeave: endPreview };
}

/** Answers already read, per list of rows, so passing back over a label asks Git nothing. */
const answers = new WeakMap<ReadonlyArray<GitCommitNode>, Map<string, Membership>>();

function answersFor(rows: ReadonlyArray<GitCommitNode>) {
  let known = answers.get(rows);
  if (known === undefined) {
    known = new Map();
    answers.set(rows, known);
  }
  return known;
}

/**
 * The membership of the previewed ref among `rows`, or `null` while nothing is previewed or its
 * answer has not arrived. A preview of the focused branch reuses the focus's answer, and other
 * answers are kept for as long as the same rows are shown in the same repository revision.
 * Nothing is asked before a preview shows.
 */
export function usePreviewMembership(
  rows: ReadonlyArray<GitCommitNode> | undefined,
  focus: { branch: string | undefined; data: Membership | null }
): Membership | null {
  const target = previewTarget.value;
  const repo = selectedRepo.value;
  const revision = repositoryRevision.value;
  const [, answered] = useState(0);
  const key = target === null ? "" : JSON.stringify([repo, revision, target.name, target.tag]);
  let known: Membership | undefined;
  if (target !== null && rows !== undefined && rows.length > 0) {
    known =
      !target.tag && target.name === focus.branch && focus.data !== null
        ? focus.data
        : answersFor(rows).get(key);
  }
  const ask = target !== null && rows !== undefined && rows.length > 0 && known === undefined;
  useEffect(() => {
    if (!ask || target === null || rows === undefined) {
      return;
    }
    return requestPanelQuery(
      {
        kind: "branchFocus",
        branch: target.name,
        hashes: rows.map((row) => row.hash),
        ...(target.tag ? { tag: true } : {})
      },
      (data) => {
        // A ref that cannot be read, such as one deleted meanwhile, shows no preview.
        if (data?.kind === "branchFocus") {
          answersFor(rows).set(key, { direct: data.direct, merged: data.merged });
          answered((count) => count + 1);
        }
      },
      repo
    );
  }, [ask, key, rows]);
  return known ?? null;
}
