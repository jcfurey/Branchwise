import { useComputed, useSignal } from "@preact/signals";
import { type ComponentProps, Fragment } from "preact";
import { useCallback, useMemo, useRef } from "preact/hooks";

import type { HistoryEntry } from "@/backend/types";
import { CommitDetails } from "@/webview/components/commit/CommitDetails";
import { CommitGraph } from "@/webview/components/commit/CommitGraph";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import { type ColumnResize, useColumnResize } from "@/webview/components/commit/useColumnResize";
import { useGraphScroll } from "@/webview/components/commit/useGraphScroll";
import { WorkingTreeDetails } from "@/webview/components/commit/WorkingTreeDetails";
import { RevealIcon } from "@/webview/components/ui/Icons";
import {
  COMMIT_DETAILS_HEIGHT,
  TABLE_HEADER_HEIGHT,
  UNCOMMITTED_CHANGES
} from "@/webview/constants";
import { GRAPH_PADDING } from "@/webview/graph/constants";
import { commitRelations, lineRelation } from "@/webview/graph/focus";
import { computeGraphLayout } from "@/webview/graph/layout";
import { branchColour } from "@/webview/graph/palette";
import type { GraphExpansion, GraphLine } from "@/webview/graph/types";
import { graphWidth, laneX } from "@/webview/graph/utils";
import { toggleCommitDetails } from "@/webview/lib/actions";
import { commitMenuSource } from "@/webview/lib/menus";
import { focusedCommit, selectedCommits } from "@/webview/lib/navigation";
import { activeSource, columnWidths, commitDetails, expandedCommit } from "@/webview/lib/stores";
import type { FocusDimming } from "@/webview/types";

type CommitTableProps = {
  /** The rows in graph order. An uncommitted-changes row, when present, comes first. */
  commits: Array<HistoryEntry>;
  head: string | null;
  headBranch: string | null;
  /** The focused branch's history, split into its first-parent line and what was merged in. */
  focus?: { direct: Array<string>; merged: Array<string> } | null;
  keepMergedBright?: boolean;
  dimming?: FocusDimming;
};

/** Bounds of the graph column's width while the browser sizes the table, in pixels. */
const NARROWEST_GRAPH = 64;
const WIDEST_GRAPH = 240;

/** Index of each row by hash, and the subject lines the commit menu shows. */
function indexRows(commits: Array<HistoryEntry>) {
  const rowOf = new Map<string, number>();
  const messages = new Map<string, string>();
  commits.forEach((commit, index) => {
    rowOf.set(commit.hash, index);
    messages.set(commit.hash, commit.message);
  });
  return { rowOf, messages };
}

/**
 * The graph with the dot of the row whose commit menu is open drawn in full colour. It reads the
 * open menu here rather than in the table, so opening a menu re-renders the graph and that one
 * row, not every row.
 */
function GraphWithMenu({ revealed, ...graph }: ComponentProps<typeof CommitGraph>) {
  const menuHash = useComputed(() => {
    const prefix = commitMenuSource("");
    const source = activeSource.value;
    return source?.startsWith(prefix) ? source.slice(prefix.length) : null;
  }).value;
  const menuRow = menuHash === null ? undefined : graph.commitRows.get(menuHash);
  const shown = useMemo(
    () => (menuRow === undefined ? revealed : new Set(revealed).add(menuRow)),
    [revealed, menuRow]
  );
  return <CommitGraph {...graph} revealed={shown} />;
}

/**
 * A drag handle on a column boundary. Each boundary has one on either side: the one at the left
 * edge of the cell after it draws the divider and takes keyboard focus, and the one at the right
 * edge of the cell before it only widens the pointer target.
 */
function Grip({
  boundary,
  side,
  label,
  resize
}: {
  boundary: number;
  side: "left" | "right";
  label: string;
  resize: ColumnResize;
}) {
  const left = side === "left";
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={left ? 0 : undefined}
      class={`absolute top-0 h-full w-1.5 cursor-col-resize focus:outline-1 focus:-outline-offset-1 focus:outline-focus ${
        left ? "left-0 border-l border-line-soft" : "right-0"
      }`}
      onMouseDown={(event) => resize.startResize(boundary, event)}
      onKeyDown={(event) => resize.nudge(boundary, event)}
    />
  );
}

/**
 * The history view: a table of commits with the graph laid over its first column, the details
 * of the open commit beneath its row, and resizable columns.
 */
export function CommitTable({
  commits,
  head,
  headBranch,
  focus = null,
  keepMergedBright = false,
  dimming = "subtle"
}: CommitTableProps) {
  const layout = useMemo(() => computeGraphLayout(commits, head), [commits, head]);
  const relations = useMemo(() => commitRelations(commits, focus), [commits, focus]);
  const { rowOf, messages } = useMemo(() => indexRows(commits), [commits]);
  // Kept while the rows and their relations stay the same, so the graph keeps its paths.
  const relationForLine = useCallback(
    (line: GraphLine) => lineRelation(line, commits, relations),
    [commits, relations]
  );

  const contentWidth = graphWidth(layout) + GRAPH_PADDING;
  const resize = useColumnResize(Math.min(Math.max(contentWidth, NARROWEST_GRAPH), WIDEST_GRAPH));
  const { containerRef, headRef, resizing } = resize;
  const scroll = useGraphScroll(containerRef, headRef, contentWidth);
  // Written by the table's handlers and read by the graph alone, so hovering redraws only dots.
  const hovered = useSignal<string | null>(null);

  const expandedHash = expandedCommit.value;
  const expandedRow = expandedHash === null ? -1 : (rowOf.get(expandedHash) ?? -1);
  const expansion = useMemo<GraphExpansion | null>(
    () => (expandedRow < 0 ? null : { row: expandedRow, height: COMMIT_DETAILS_HEIGHT }),
    [expandedRow]
  );
  const focusedHash = focusedCommit.value;
  const focusedLoaded = focusedHash !== null && rowOf.has(focusedHash);
  const tabStop = focusedLoaded ? focusedHash : commits[0]?.hash;

  // Dots that keep their full colour whatever the focus: the commits the user is on or chose.
  const revealed = new Set<number>();
  const chosen = selectedCommits.value.map((commit) => commit.hash);
  for (const hash of [head, focusedHash, expandedHash, ...chosen]) {
    const row = hash === null ? undefined : rowOf.get(hash);
    if (row !== undefined) {
      revealed.add(row);
    }
  }

  // Rows get the same callbacks on every render, so a row whose own props did not change skips.
  const reveal = useRef<(hash: string) => void>(() => {});
  reveal.current = (hash: string) => {
    const row = rowOf.get(hash);
    const vertex = row === undefined ? undefined : layout.vertices[row];
    if (vertex !== undefined) {
      scroll.revealLane(laneX(vertex.x));
    }
  };
  const onRevealLane = useCallback((hash: string) => reveal.current(hash), []);
  const toggles = useMemo(
    () => new Map(commits.map(({ hash }) => [hash, () => toggleCommitDetails(hash)])),
    [commits]
  );

  const l10n = window.l10n;
  const titles = [l10n.graph, l10n.description, l10n.date, l10n.author, l10n.commit];
  const grip = (boundary: number, side: "left" | "right") => (
    <Grip
      boundary={boundary}
      side={side}
      label={l10n.resizeColumn.replace("{0}", () => titles[boundary] ?? "")}
      resize={resize}
    />
  );
  const heading = "relative h-8 truncate border-b border-line px-3 text-left font-semibold";

  return (
    <div ref={containerRef} class="relative">
      <div
        ref={scroll.viewportRef}
        data-graph-viewport
        class="pointer-events-none absolute left-0 overflow-hidden"
        style={`width: var(--graph-viewport-width, 0px); top: var(--graph-top, ${TABLE_HEADER_HEIGHT}px);`}
      >
        <div style={{ width: `${contentWidth}px` }}>
          <GraphWithMenu
            layout={layout}
            expansion={expansion}
            relations={relations}
            relationForLine={relationForLine}
            keepMergedBright={keepMergedBright}
            dimming={dimming}
            revealed={revealed}
            hovered={hovered}
            commitRows={rowOf}
          />
        </div>
      </div>
      <table
        aria-label={l10n.graphKeyboardHint}
        class={`w-full cursor-default border-collapse text-ui select-none ${
          columnWidths.value === null ? "" : "table-fixed"
        }`}
        onMouseOver={(event) => {
          const row = (event.target as Element).closest<HTMLElement>("tr[data-commit-hash]");
          hovered.value = row?.dataset["commitHash"] ?? null;
        }}
        onMouseLeave={() => {
          hovered.value = null;
        }}
        onWheel={scroll.onWheel}
      >
        <colgroup>
          <col style="width: var(--col-graph)" />
          <col />
          <col style="width: var(--col-date)" />
          <col style="width: var(--col-author)" />
          <col style="width: var(--col-commit)" />
        </colgroup>
        <thead class="sticky z-10 bg-editor" style="top: var(--main-header-height, 0px)">
          <tr ref={headRef} class={resizing ? "cursor-col-resize" : ""}>
            <th class={`${heading} ${scroll.overflow ? "pb-2" : ""}`}>
              {titles[0]}
              <div
                ref={scroll.scrollRef}
                data-graph-scroll
                role="region"
                aria-label={l10n.scrollGraphHorizontally}
                tabIndex={scroll.overflow ? 0 : undefined}
                class={`graph-scrollbar absolute bottom-0 left-0 h-2.5 w-full overflow-x-auto overflow-y-hidden focus:outline-1 focus:-outline-offset-1 focus:outline-focus ${
                  scroll.overflow ? "" : "invisible"
                }`}
                onScroll={scroll.syncScroll}
              >
                <div style={{ width: `${contentWidth}px`, height: "1px" }} />
              </div>
              {grip(0, "right")}
            </th>
            <th class={heading}>
              {grip(0, "left")}
              {titles[1]}
              {scroll.overflow && (
                <button
                  type="button"
                  class="ml-2 inline-flex cursor-pointer items-center rounded-sm p-1 align-middle hover:bg-btn-hover focus:outline-1 focus:outline-focus disabled:cursor-default disabled:opacity-50"
                  aria-label={l10n.revealSelectedLane}
                  title={l10n.revealSelectedLane}
                  disabled={!focusedLoaded}
                  onClick={() => {
                    const hash = focusedCommit.peek();
                    if (hash !== null) {
                      reveal.current(hash);
                    }
                  }}
                >
                  <RevealIcon class="size-3.5" />
                </button>
              )}
              {grip(1, "right")}
            </th>
            {[2, 3, 4].map((column) => (
              <th key={column} class={heading}>
                {grip(column - 1, "left")}
                {titles[column]}
                {column < 4 && grip(column, "right")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {commits.map((commit, index) => (
            <Fragment key={commit.hash}>
              <CommitRow
                commit={commit}
                rows={commits}
                tabStop={commit.hash === tabStop}
                isHead={commit.hash === head}
                headBranch={headBranch}
                messages={messages}
                colour={branchColour(layout.vertices[index]?.colour ?? 0)}
                relation={relations[index] ?? "normal"}
                keepMergedBright={keepMergedBright}
                dimming={dimming}
                expanded={index === expandedRow}
                onSelect={toggles.get(commit.hash)}
                onRevealLane={onRevealLane}
              />
              {index === expandedRow &&
                (commit.hash === UNCOMMITTED_CHANGES ? (
                  <WorkingTreeDetails />
                ) : (
                  <CommitDetails details={commitDetails.value} />
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
