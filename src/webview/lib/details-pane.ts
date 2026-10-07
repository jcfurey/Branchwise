import { signal } from "@preact/signals";

import type { CommitDetailsPosition } from "@/types";
import { vscode } from "@/webview/lib/vscode";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/** The places a commit's details can be docked, beside the graph rather than inside it. */
export type DockedPosition = Exclude<CommitDetailsPosition, "inline">;

/** Where a commit's details open. A value the page does not know opens them under the row. */
export function detailsPosition(): CommitDetailsPosition {
  const position = getWebviewConfig().commitDetailsPosition;
  return position === "bottom" || position === "right" ? position : "inline";
}

/*
 * The docked pane's size is its share of the window: of the height when it is docked at the
 * bottom, of the width when it is on the right. The bounds leave room for a few rows of the graph
 * and for the commit's facts and a few files.
 */
export const PANE_DEFAULT = 0.4;
export const PANE_MIN = 0.15;
export const PANE_MAX = 0.75;
/** How far one arrow key moves the splitter. */
export const PANE_STEP = 0.05;

type PaneSizes = Readonly<Record<DockedPosition, number>>;

/**
 * `size` within the bounds, to a thousandth, so that steps land on round shares; anything that
 * is not a number gives the default.
 */
export function clampPaneSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return PANE_DEFAULT;
  }
  return Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, size)) * 1000) / 1000;
}

const initial = vscode.getState() as { detailsPane?: Partial<PaneSizes> } | null;

/**
 * The pane's size in each position. It belongs to the page rather than to a repository, and is
 * kept in the page's saved state, so it survives switching repositories and reloading the panel.
 */
export const paneSizes = signal<PaneSizes>({
  bottom: clampPaneSize(initial?.detailsPane?.bottom),
  right: clampPaneSize(initial?.detailsPane?.right)
});

export function savePaneSizes(): void {
  const current = vscode.getState();
  vscode.setState({
    ...(typeof current === "object" && current !== null ? current : {}),
    detailsPane: paneSizes.value
  });
}

/**
 * Resize the pane in `position`, within the bounds. A drag passes `save: false` while it moves
 * and saves once, when it ends.
 */
export function setPaneSize(position: DockedPosition, size: number, save = true): void {
  const clamped = clampPaneSize(size);
  if (paneSizes.value[position] !== clamped) {
    paneSizes.value = { ...paneSizes.value, [position]: clamped };
  }
  if (save) {
    savePaneSizes();
  }
}
