import { batch } from "@preact/signals";
import { useLayoutEffect } from "preact/hooks";

import type { HistoryEntry, HistoryFilter } from "@/backend/types";
import { branchListRef } from "@/backend/utils/refs";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { openBatch, openCompare } from "@/webview/components/history/HistoryTools";
import { PageControls, QueryStatus } from "@/webview/components/history/QueryControls";
import { Button } from "@/webview/components/ui/Button";
import { BranchIcon, TagIcon } from "@/webview/components/ui/Icons";
import { Loading } from "@/webview/components/ui/Loading";
import { Select } from "@/webview/components/ui/Select";
import {
  loadMoreCommits,
  refresh,
  selectBranch,
  setFocusDimming,
  toggleBranchFocus
} from "@/webview/lib/actions";
import { commitMenuHintDismissed, dismissCommitMenuHint } from "@/webview/lib/hints";
import {
  emptyFilter,
  historyActive,
  historyFilter,
  historyOffset,
  restoreScroll,
  selectedCommits,
  setHistoryFilter
} from "@/webview/lib/navigation";
import {
  branchDisplay,
  branchFocusTarget,
  commitHead,
  commitList,
  displayedBranch,
  focusDimming,
  focusPaused,
  graphErrors,
  headBranch,
  hiddenRemotes,
  maxCommits,
  moreCommitsAvailable,
  selectedRepo,
  showRemoteBranch
} from "@/webview/lib/stores";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { NoCommitsPage } from "@/webview/pages/NoCommitsPage";
import type { FocusDimming } from "@/webview/types";

/** The batch dialogs refuse selections larger than this. */
const BATCH_LIMIT = 100;

/** A full object name: SHA-1 or SHA-256. Anything else is shown as typed. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** The strips above the table share their layout; each adds its own spacing and colour. */
const BANNER = "flex flex-wrap items-center border-b border-line-soft px-3 text-xs";

/** `template` with every `{0}` replaced by `value`, which is inserted as it is. */
function fill(template: string, value: string) {
  return template.replaceAll("{0}", () => value);
}

/**
 * The filter sent to the history query. Without a revision of its own, the search stays within
 * the branch the graph is filtered to.
 */
function historyQueryFilter(filter: HistoryFilter): HistoryFilter {
  if (filter.revision !== "") {
    return filter;
  }
  const branch = displayedBranch();
  return { ...filter, revision: branch === "" ? "" : branchListRef(branch) };
}

/** What the filtered-history banner says the rows are. */
function historyScope(filter: HistoryFilter) {
  if (filter.path !== "") {
    return filter.path;
  }
  if (filter.revision !== "") {
    const shown = OBJECT_NAME.test(filter.revision)
      ? filter.revision.slice(0, 12)
      : filter.revision;
    return fill(window.l10n.historyAt, shown);
  }
  return window.l10n.filteredHistory;
}

/** Scroll back to a saved position once rows are on screen to scroll through. */
function useScrollRestore(rows: Array<HistoryEntry> | undefined, repo: string | undefined) {
  useLayoutEffect(() => {
    const top = restoreScroll.peek();
    if (rows === undefined || top === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, top);
      restoreScroll.value = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [repo, rows]);
}

function FocusBanner({
  target,
  loading,
  failed
}: {
  target: string;
  loading: boolean;
  failed: boolean;
}) {
  const l10n = window.l10n;
  const paused = focusPaused.value;
  let hint = l10n.focusDirectHint;
  if (paused) {
    hint = l10n.focusPausedHint;
  } else if (failed) {
    hint = l10n.branchFocusUnavailable;
  } else if (loading) {
    hint = l10n.loadingBranchFocus;
  } else if (branchDisplay.value === "ancestors") {
    hint = l10n.focusAncestorsHint;
  }
  return (
    <div role="status" class={`${BANNER} gap-x-3 gap-y-1 py-1.5`}>
      <span class="max-w-80 truncate" title={target}>
        {fill(paused ? l10n.branchFocusPaused : l10n.branchFocus, target.replace(/^remotes\//, ""))}
      </span>
      <span class="text-muted">{hint}</span>
      <Button onClick={toggleBranchFocus}>
        {paused ? l10n.resumeBranchFocus : l10n.pauseBranchFocus}
      </Button>
      <label class="flex items-center gap-2">
        {l10n.focusDimming}
        <Select
          aria-label={l10n.focusDimming}
          options={[
            { label: l10n.focusDimmingSubtle, value: "subtle" },
            { label: l10n.focusDimmingStrong, value: "strong" }
          ]}
          value={focusDimming.value}
          onChange={(value) => setFocusDimming(value as FocusDimming)}
        />
      </label>
      <Button onClick={() => selectBranch("*")}>{l10n.clearBranchFocus}</Button>
    </div>
  );
}

/**
 * The branches and tags whose names hold the search text. Each opens the history at the commit
 * it points to.
 */
function MatchingRefs({ refs }: { refs: ReadonlyArray<string> }) {
  return (
    <div class={`${BANNER} gap-1.5 py-1.5`}>
      <span class="mr-1 text-muted">{window.l10n.matchingRefs}</span>
      {refs.map((ref) => {
        const tag = ref.startsWith("refs/tags/");
        const name = ref.replace(/^refs\/(?:heads|tags|remotes)\//, "");
        const Glyph = tag ? TagIcon : BranchIcon;
        return (
          <button
            key={ref}
            type="button"
            title={ref}
            class="inline-flex max-w-64 cursor-pointer items-center gap-1 rounded-sm border border-line-soft px-1.5 py-0.5 hover:bg-btn-hover focus:outline-1 focus:outline-focus"
            onClick={() => setHistoryFilter({ ...emptyFilter(), revision: ref })}
          >
            <Glyph class="size-3 shrink-0" />
            <span class="truncate">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

function SelectionBar({ selected }: { selected: Array<HistoryEntry> }) {
  const l10n = window.l10n;
  const tooMany = selected.length > BATCH_LIMIT;
  const [first, second] = selected;
  return (
    <div class="flex flex-wrap items-center gap-2 border-b border-line-soft bg-row-head px-3 py-2 text-ui">
      <span>{fill(l10n.selectedCount, String(selected.length))}</span>
      {selected.length === 2 && first !== undefined && second !== undefined && (
        <Button onClick={() => openCompare(first.hash, second.hash)}>{l10n.compareSelected}</Button>
      )}
      <Button disabled={tooMany} onClick={() => openBatch("cherry-pick")}>
        {l10n.batchCherryPick}
      </Button>
      <Button disabled={tooMany} onClick={() => openBatch("revert")}>
        {l10n.batchRevert}
      </Button>
      <Button
        onClick={() => {
          selectedCommits.value = [];
        }}
      >
        {l10n.clearSelection}
      </Button>
    </div>
  );
}

function CommitMenuHint() {
  return (
    <div role="note" class={`${BANNER} justify-between gap-2 py-1.5 text-muted`}>
      <span>{window.l10n.commitMenuHint}</span>
      <button
        type="button"
        class="cursor-pointer rounded-sm px-1.5 py-0.5 hover:bg-btn-hover focus:outline-1 focus:outline-focus"
        onClick={dismissCommitMenuHint}
      >
        {window.l10n.dialogDismiss}
      </button>
    </div>
  );
}

/**
 * The column beside the sidebar: the commit graph, or the commits a history search found, with
 * the banners and controls that belong to them. Everything it shows comes from the stores.
 */
export function GraphView() {
  const l10n = window.l10n;
  const inHistory = historyActive.value;
  const filter = historyFilter.value;

  const history = useRepositoryQuery<"history">(
    inHistory
      ? {
          kind: "history",
          showRemoteBranches: showRemoteBranch.value,
          hiddenRemotes: hiddenRemotes.value,
          filter: historyQueryFilter(filter),
          offset: historyOffset.value
        }
      : null
  );
  const rows = inHistory ? history.data?.page.entries : commitList.value;
  const matchingRefs = inHistory ? history.data?.page.refs : undefined;

  const target = branchFocusTarget.value;
  const focus = useRepositoryQuery<"branchFocus">(
    target !== undefined && rows !== undefined && rows.length > 0
      ? { kind: "branchFocus", branch: target, hashes: rows.map((row) => row.hash) }
      : null
  );

  const pushStatus = useRepositoryQuery<"pushStatus">(
    rows !== undefined && rows.length > 0 ? { kind: "pushStatus" } : null
  );

  useScrollRestore(rows, selectedRepo.value);

  if (inHistory && (history.error !== null || (history.loading && history.data === null))) {
    return (
      <main class="space-y-3 p-3">
        <QueryStatus loading={history.loading} error={history.error} />
        {history.error !== null && <Button onClick={refresh}>{l10n.retry}</Button>}
      </main>
    );
  }

  const errors = graphErrors.value;
  if (!inHistory && (errors.loadBranches !== undefined || errors.loadCommits !== undefined)) {
    // An empty message still counts as a failure; the alert then repeats the heading.
    const message = errors.loadBranches ?? errors.loadCommits;
    return (
      <main data-graph-error class="space-y-3 p-3">
        <h2 class="font-semibold">{l10n.unableToLoad}</h2>
        <QueryStatus loading={false} error={message || l10n.unableToLoad} />
        <Button onClick={refresh}>{l10n.retry}</Button>
      </main>
    );
  }

  if (rows === undefined) {
    return (
      <main class="grid flex-1 place-items-center">
        <Loading />
      </main>
    );
  }

  const head = commitHead.value;
  if (!inHistory && rows.length === 0 && head === null) {
    return <NoCommitsPage />;
  }

  const paused = focusPaused.value;
  const selected = selectedCommits.value;
  const more = moreCommitsAvailable.value;
  // The table goes back to its own colours whenever the focus data may be out of date.
  const focusData = paused || focus.loading || focus.error !== null ? null : focus.data;

  return (
    <main class="relative">
      {target !== undefined && (
        <FocusBanner target={target} loading={focus.loading} failed={focus.error !== null} />
      )}
      {inHistory && (
        <div class={`${BANNER} justify-between gap-2 py-2 text-muted`}>
          <span class="min-w-0 truncate">{historyScope(filter)}</span>
          <span>{l10n.filteredHistoryHint}</span>
        </div>
      )}
      {matchingRefs !== undefined && matchingRefs.length > 0 && (
        <MatchingRefs refs={matchingRefs} />
      )}
      {selected.length > 1 && <SelectionBar selected={selected} />}
      {inHistory && rows.length === 0 && <p class="p-6 text-muted">{l10n.noHistoryMatches}</p>}
      {!inHistory && !commitMenuHintDismissed.value && <CommitMenuHint />}
      <CommitTable
        commits={rows}
        head={head}
        headBranch={headBranch.value}
        focus={focusData}
        pushStatus={pushStatus.data}
        keepMergedBright={branchDisplay.value === "ancestors"}
        dimming={focusDimming.value}
      />
      {inHistory && history.data !== null && (
        <div class="px-3">
          <PageControls
            offset={historyOffset.value}
            count={rows.length}
            more={history.data.page.more}
            change={(offset) =>
              batch(() => {
                historyOffset.value = offset;
                selectedCommits.value = [];
              })
            }
          />
        </div>
      )}
      {!inHistory &&
        more &&
        (rows.length < maxCommits.value ? (
          // A larger page has been asked for and is on its way.
          <Loading />
        ) : (
          <div class="flex justify-center py-4">
            <Button onClick={loadMoreCommits}>{l10n.loadMore}</Button>
          </div>
        ))}
    </main>
  );
}
