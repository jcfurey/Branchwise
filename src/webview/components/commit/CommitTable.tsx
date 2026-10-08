import { useComputed, useSignal } from "@preact/signals";
import { type ComponentProps, Fragment } from "preact";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";

import type { AppliedCommits, ConflictForecastEntry, HistoryEntry } from "@/backend/types";
import { columnMenu, COLUMNS_MENU } from "@/webview/components/commit/column-choice";
import { CommitDetails } from "@/webview/components/commit/CommitDetails";
import { CommitGraph } from "@/webview/components/commit/CommitGraph";
import { CommitHoverCard } from "@/webview/components/commit/CommitHoverCard";
import { CommitRow, type PushState } from "@/webview/components/commit/CommitRow";
import { DayPill } from "@/webview/components/commit/DayPill";
import { OverviewStrip } from "@/webview/components/commit/OverviewStrip";
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
import { nearestBranches } from "@/webview/graph/nearest";
import { branchColour } from "@/webview/graph/palette";
import type { BranchRelation, GraphExpansion, GraphLine } from "@/webview/graph/types";
import { graphWidth, laneX } from "@/webview/graph/utils";
import { openContextMenu, toggleCommitDetails } from "@/webview/lib/actions";
import type { Membership } from "@/webview/lib/branch-preview";
import { useCommitStatsLoader } from "@/webview/lib/commit-stats";
import { conflictsByBranch } from "@/webview/lib/conflict-forecast";
import { detailsPosition } from "@/webview/lib/details-pane";
import { type CommitLookup, dragHandlers } from "@/webview/lib/drag-drop";
import { useHoverCards } from "@/webview/lib/hover-card";
import { commitMenuSource } from "@/webview/lib/menus";
import {
  focusedCommit,
  pendingReveal,
  revealDetails,
  selectCommitRows,
  selectedCommits
} from "@/webview/lib/navigation";
import { collectMarkers } from "@/webview/lib/overview-markers";
import {
  activeSource,
  columnWidths,
  commitDetails,
  expandedCommit,
  selectedRepo,
  shownColumns
} from "@/webview/lib/stores";
import { hiddenBranchMatcher, isBranchHidden } from "@/webview/lib/stores/hidden-branches.store";
import { getWebviewConfig, rowHeight } from "@/webview/lib/webview-config";
import type { FocusDimming } from "@/webview/types";
import { commitDays } from "@/webview/utils/date";

type CommitTableProps = {
  /** The rows in graph order. An uncommitted-changes row, when present, comes first. */
  commits: Array<HistoryEntry>;
  head: string | null;
  headBranch: string | null;
  /** The focused branch's history, split into its first-parent line and what was merged in. */
  focus?: { direct: Array<string>; merged: Array<string> } | null;
  /** Commits only on this computer and commits only on a remote, or `null` when not known. */
  pushStatus?: { unpushed: Array<string>; unpulled: Array<string> } | null;
  /** Branches that would not merge cleanly into HEAD, with the files in conflict. */
  conflicts?: Array<ConflictForecastEntry> | undefined;
  /** Commits of the focused or shown branch whose change the checked-out branch already has. */
  applied?: AppliedCommits["applied"] | undefined;
  keepMergedBright?: boolean;
  dimming?: FocusDimming;
  /**
   * The history of the ref the pointer rests on, shown over any focus until it moves on, and
   * the ref's name as the branch list spells it.
   */
  preview?: { name: string; membership: Membership } | null;
  /** Name the nearest branch after the message of each commit without a branch label. */
  showNearestBranch?: boolean;
};

/** Stands for "no nearest branches", so rows are not told of a change each time. */
const NO_NEAREST: ReadonlyMap<string, string> = new Map();

/** Whether a row with this relation to the previewed ref holds one of its commits. */
const inPreview = (relation: BranchRelation | undefined) =>
  relation === "direct" || relation === "merged";

/** Bounds of the graph column's width while the browser sizes the table, in pixels. */
const NARROWEST_GRAPH = 64;
const WIDEST_GRAPH = 240;

/** The custom property each cell's `<col>` takes its width from; the description has none. */
const COLUMN_WIDTHS = ["--col-graph", undefined, "--col-date", "--col-author", "--col-commit"];

/** The width of the Changes column, in pixels: room for `+12345 −12345`. It cannot be resized. */
const CHANGES_COLUMN = 104;

/** Index of each row by hash, the rows themselves, and the subject lines the commit menu shows. */
function indexRows(commits: Array<HistoryEntry>) {
  const rowOf = new Map<string, number>();
  const byHash = new Map<string, HistoryEntry>();
  const messages = new Map<string, string>();
  commits.forEach((commit, index) => {
    rowOf.set(commit.hash, index);
    byHash.set(commit.hash, commit);
    messages.set(commit.hash, commit.message);
  });
  return { rowOf, byHash, messages, hashes: commits.map((commit) => commit.hash) };
}

/** How long after Go to the revealed row takes the keyboard back if the workbench drops it. */
const REVEAL_SETTLE_MS = 5000;

/** Lets go of the row the last Go to revealed, if it is still held. */
let releaseHeld = () => {};

/**
 * Keep the keyboard on the row Go to revealed while the workbench settles. Closing the picker and
 * bringing the panel forward can blur the row, or hand the panel the keyboard with nothing focused
 * in it, after the row was focused; the row takes it back then. Only for a moment, and never over
 * a control: once the user clicks or types, or another Go to reveals a row, it lets go.
 */
function holdFocus(
  first: HTMLElement,
  hash: string,
  containerRef: { readonly current: HTMLElement | null }
) {
  releaseHeld();
  // The row itself, or the one drawn in its place if the table was redrawn meanwhile.
  const target = () =>
    first.isConnected
      ? first
      : containerRef.current?.querySelector<HTMLElement>(
          `tr[data-commit-hash=${JSON.stringify(hash)}]`
        );
  const restore = () => {
    const active = document.activeElement;
    // Never while the keyboard is elsewhere in the workbench: focusing the row would take it
    // from there, closing a picker that just opened.
    if (document.hasFocus() && (active === null || active === document.body)) {
      target()?.focus({ preventScroll: true });
    }
  };
  // Blurred towards nothing: look again once the focus has landed.
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget === null) {
      setTimeout(restore);
    }
  };
  const container = containerRef.current;
  const release = () => {
    clearTimeout(timer);
    container?.removeEventListener("focusout", onFocusOut);
    window.removeEventListener("focus", restore);
    window.removeEventListener("pointerdown", release, true);
    window.removeEventListener("keydown", release, true);
  };
  const timer = setTimeout(release, REVEAL_SETTLE_MS);
  releaseHeld = release;
  container?.addEventListener("focusout", onFocusOut);
  window.addEventListener("focus", restore);
  window.addEventListener("pointerdown", release, true);
  window.addEventListener("keydown", release, true);
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
 * of the open commit beneath its row unless they are docked beside the table, and resizable
 * columns.
 */
export function CommitTable({
  commits,
  head,
  headBranch,
  focus = null,
  pushStatus = null,
  conflicts,
  applied,
  keepMergedBright = false,
  dimming = "subtle",
  preview = null,
  showNearestBranch = false
}: CommitTableProps) {
  const pushOf = useMemo(() => {
    const status = new Map<string, PushState>();
    pushStatus?.unpushed.forEach((hash) => status.set(hash, "unpushed"));
    pushStatus?.unpulled.forEach((hash) => status.set(hash, "unpulled"));
    return status;
  }, [pushStatus]);
  const conflictsOf = useMemo(() => conflictsByBranch(conflicts), [conflicts]);
  const appliedOf = useMemo(
    () => new Map(applied?.map((commit) => [commit.hash, commit.equivalent])),
    [applied]
  );
  const layout = useMemo(() => computeGraphLayout(commits, head), [commits, head]);
  const focusRelations = useMemo(() => commitRelations(commits, focus), [commits, focus]);
  // A preview is drawn over the focus; once it ends, the focus's relations are shown unchanged.
  const membership = preview?.membership ?? null;
  const previewRelations = useMemo(
    () => (membership === null ? null : commitRelations(commits, membership)),
    [commits, membership]
  );
  const relations = previewRelations ?? focusRelations;
  const shownDimming = previewRelations === null ? dimming : "preview";
  const shownMergedBright = previewRelations === null && keepMergedBright;
  const { rowOf, byHash, messages, hashes } = useMemo(() => indexRows(commits), [commits]);
  // Worked out once for each list of rows, never for each row as it draws.
  const separators = getWebviewConfig().dateSeparators;
  const days = useMemo(() => (separators ? commitDays(commits) : null), [commits, separators]);
  // Kept while the rows and their relations stay the same, so the graph keeps its paths.
  const relationForLine = useCallback(
    (line: GraphLine) => lineRelation(line, commits, relations),
    [commits, relations]
  );
  // Once per list of rows, not per render. The hidden-branch patterns are read here so that a
  // change to them works it out again.
  const hiddenMatcher = hiddenBranchMatcher.value;
  const nearest = useMemo(
    () => (showNearestBranch ? nearestBranches(commits, headBranch, isBranchHidden) : NO_NEAREST),
    [commits, headBranch, showNearestBranch, hiddenMatcher]
  );

  const contentWidth = graphWidth(layout) + GRAPH_PADDING;
  const resize = useColumnResize(Math.min(Math.max(contentWidth, NARROWEST_GRAPH), WIDEST_GRAPH));
  const { containerRef, headRef, resizing } = resize;
  const scroll = useGraphScroll(containerRef, headRef, contentWidth);
  // Written by the table's handlers and read by the graph alone, so hovering redraws only dots.
  const hovered = useSignal<string | null>(null);
  // Read here, so that a new density or column choice redraws the open graph at once.
  const height = rowHeight();
  const shown = shownColumns.value;

  const expandedHash = expandedCommit.value;
  const expandedRow = expandedHash === null ? -1 : (rowOf.get(expandedHash) ?? -1);
  // Docked details leave the rows, and so the graph, as they are.
  const inline = detailsPosition() === "inline";
  const expansion = useMemo<GraphExpansion | null>(
    () => (expandedRow < 0 || !inline ? null : { row: expandedRow, height: COMMIT_DETAILS_HEIGHT }),
    [expandedRow, inline]
  );
  const focusedHash = focusedCommit.value;
  const focusedLoaded = focusedHash !== null && rowOf.has(focusedHash);
  const tabStop = focusedLoaded ? focusedHash : commits[0]?.hash;

  const { showChangesColumn, commitHoverCards } = getWebviewConfig();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  useCommitStatsLoader(
    bodyRef,
    hashes,
    inline && expandedRow >= 0,
    selectedRepo.value,
    showChangesColumn
  );
  useHoverCards(containerRef);

  // Dots that keep their full colour whatever the focus: the commits the user is on or chose.
  const revealed = new Set<number>();
  const chosen = selectedCommits.value.map((commit) => commit.hash);
  for (const hash of [head, focusedHash, expandedHash, ...chosen]) {
    const row = hash === null ? undefined : rowOf.get(hash);
    if (row !== undefined) {
      revealed.add(row);
    }
  }

  const overview = getWebviewConfig().overviewMarkers;
  const selection = selectedCommits.value;
  const markers = useMemo(
    () =>
      overview
        ? collectMarkers({
            commits,
            head,
            selected: new Set(selection.map((commit) => commit.hash)),
            details: expandedHash,
            unpushed: new Set(pushStatus?.unpushed)
          })
        : [],
    [overview, commits, head, selection, expandedHash, pushStatus]
  );

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

  // One set of drag listeners for every row and label, reading the rows as they are now.
  const rowsNow = useRef<CommitLookup | null>(null);
  rowsNow.current = {
    commit: (hash) => {
      const index = rowOf.get(hash);
      return index === undefined ? undefined : commits[index];
    },
    messages
  };
  const drag = useMemo(() => dragHandlers(() => rowsNow.current), []);

  // A commit chosen in Go to, once its row is here: centred, focused and selected, and with its
  // details open when the reveal asked for them.
  const revealing = pendingReveal.value;
  useEffect(() => {
    const index = revealing === null ? undefined : rowOf.get(revealing);
    const commit = index === undefined ? undefined : commits[index];
    if (commit === undefined) {
      return;
    }
    pendingReveal.value = null;
    selectCommitRows(commit, commits, false, false);
    if (revealDetails.peek()) {
      revealDetails.value = false;
      if (expandedCommit.peek() !== commit.hash) {
        toggleCommitDetails(commit.hash);
      }
    }
    const row = containerRef.current?.querySelector<HTMLElement>(
      `tr[data-commit-hash=${JSON.stringify(commit.hash)}]`
    );
    row?.scrollIntoView({ block: "center" });
    // Focusing the row makes it the focused commit and brings its dot into view.
    row?.focus({ preventScroll: true });
    if (row) {
      holdFocus(row, commit.hash, containerRef);
    }
  }, [revealing, rowOf, commits, containerRef]);
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
  const last = shown.at(-1);

  /** What a heading holds besides its grips: its title, and the graph's and message's controls. */
  function headingContent(column: number) {
    if (column === 0) {
      return (
        <>
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
        </>
      );
    }
    if (column === 1 && scroll.overflow) {
      return (
        <>
          {titles[1]}
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
        </>
      );
    }
    return titles[column];
  }

  return (
    <div
      ref={containerRef}
      class="relative pr-[var(--overview-gutter,0px)]"
      style={{ "--row-height": `${height}px` }}
      data-branch-preview={preview?.name}
    >
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
            keepMergedBright={shownMergedBright}
            dimming={shownDimming}
            revealed={revealed}
            hovered={hovered}
            commitRows={rowOf}
            rowHeight={height}
          />
        </div>
      </div>
      {days !== null && <DayPill containerRef={containerRef} rowOf={rowOf} days={days} />}
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
        {...drag}
      >
        <colgroup>
          {shown.map((column) => {
            const width = COLUMN_WIDTHS[column];
            return (
              <col key={column} style={width === undefined ? undefined : `width: var(${width})`} />
            );
          })}
          {showChangesColumn && <col style={{ width: `${CHANGES_COLUMN}px` }} />}
        </colgroup>
        <thead
          class="sticky z-10 bg-editor"
          style="top: var(--main-header-height, 0px)"
          // Choosing the columns. Keyboard users find the same choice under Settings & Tools.
          onContextMenu={(event) => openContextMenu(event, COLUMNS_MENU, columnMenu())}
        >
          <tr ref={headRef} class={resizing ? "cursor-col-resize" : ""}>
            {shown.map((column, at) => {
              const before = shown[at - 1];
              return (
                <th
                  key={column}
                  class={column === 0 && scroll.overflow ? `${heading} pb-2` : heading}
                >
                  {before !== undefined && grip(before, "left")}
                  {headingContent(column)}
                  {column !== last && grip(column, "right")}
                </th>
              );
            })}
            {showChangesColumn && (
              <th class={heading}>
                {/* The divider the grips draw elsewhere: this column keeps its width. */}
                <span class="absolute top-0 left-0 h-full border-l border-line-soft" />
                {l10n.changesColumn}
              </th>
            )}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
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
                keepMergedBright={shownMergedBright}
                dimming={shownDimming}
                previewBranch={
                  preview !== null && inPreview(previewRelations?.[index])
                    ? preview.name
                    : undefined
                }
                nearestBranch={nearest.get(commit.hash)}
                push={pushOf.get(commit.hash)}
                conflicts={conflictsOf}
                applied={appliedOf.get(commit.hash)}
                expanded={index === expandedRow}
                dayStart={days?.starts.has(index) ?? false}
                onSelect={toggles.get(commit.hash)}
                onRevealLane={onRevealLane}
                showChanges={showChangesColumn}
                hoverCards={commitHoverCards}
              />
              {index === expandedRow &&
                inline &&
                (commit.hash === UNCOMMITTED_CHANGES ? (
                  <WorkingTreeDetails />
                ) : (
                  <CommitDetails details={commitDetails.value} />
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {overview && (
        <OverviewStrip
          containerRef={containerRef}
          markers={markers}
          rows={commits.length}
          expandedRow={inline ? expandedRow : -1}
        />
      )}
      <CommitHoverCard rows={byHash} />
    </div>
  );
}
