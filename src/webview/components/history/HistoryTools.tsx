import { useState } from "preact/hooks";

import type {
  BatchPlan,
  Comparison,
  FileRestorePlan,
  HistoryEntry,
  StagedPlan
} from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { Select } from "@/webview/components/ui/Select";
import {
  closeDialog,
  openContentDialog,
  openErrorDialog,
  openFormDialog
} from "@/webview/lib/actions";
import { activity } from "@/webview/lib/activity";
import {
  emptyFilter,
  focusHistory,
  selectedCommits,
  selectionInGraphOrder,
  setHistoryFilter
} from "@/webview/lib/navigation";
import {
  requestPanelQuery,
  requestRepositoryQuery,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import { moveButton, useListMove } from "@/webview/lib/use-list-move";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { getFullDate } from "@/webview/utils/date";
import { format } from "@/webview/utils/format";

import { PageControls, QueryStatus, TextField } from "./QueryControls";

function HistoryRows({ entries }: { entries: HistoryEntry[] }) {
  return (
    <ul class="divide-y divide-line-soft">
      {entries.map((entry) => (
        <li key={entry.hash}>
          <button
            class="flex w-full cursor-pointer gap-3 px-2 py-2 text-left hover:bg-row-hover focus:outline-1 focus:outline-focus"
            onClick={() => {
              closeDialog();
              focusHistory(entry.hash);
            }}
            title={entry.hash}
          >
            <code class="shrink-0 text-muted">{entry.hash.slice(0, 8)}</code>
            <span class="min-w-0 break-words">{entry.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function UniqueCommits({ comparison, side }: { comparison: Comparison; side: "left" | "right" }) {
  const [offset, setOffset] = useState(0);
  const query = useRepositoryQuery<"compareCommits">(
    offset === 0
      ? null
      : { kind: "compareCommits", left: comparison.left, right: comparison.right, side, offset }
  );
  const page =
    offset === 0
      ? side === "left"
        ? comparison.leftOnly
        : comparison.rightOnly
      : query.data?.page;
  return (
    <section class="min-w-0 rounded border border-line-soft p-2">
      <h3 class="mb-2 font-semibold">
        {side === "left" ? window.l10n.onlyOnLeft : window.l10n.onlyOnRight}
      </h3>
      <QueryStatus {...query} />
      {page && (
        <>
          <HistoryRows entries={page.entries} />
          <PageControls
            offset={offset}
            count={page.entries.length}
            more={page.more}
            change={setOffset}
          />
        </>
      )}
    </section>
  );
}

export function CompareView({
  left: initialLeft,
  right: initialRight
}: {
  left: string;
  right: string;
}) {
  const [left, setLeft] = useState(initialLeft);
  const [right, setRight] = useState(initialRight);
  const [mergeBase, setMergeBase] = useState(false);
  const [request, setRequest] = useState({
    kind: "compare" as const,
    left: initialLeft,
    right: initialRight,
    mergeBase: false
  });
  const query = useRepositoryQuery<"compare">(request);
  const comparison = query.data?.comparison;
  return (
    <div class="space-y-4 text-left">
      <form
        class="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setRequest({ kind: "compare", left, right, mergeBase });
        }}
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <TextField label={window.l10n.comparisonLeft} value={left} change={setLeft} />
          <TextField label={window.l10n.comparisonRight} value={right} change={setRight} />
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            label={window.l10n.compareFromBase}
            checked={mergeBase}
            onInput={(event) => setMergeBase(event.currentTarget.checked)}
          />
          <Button type="submit" variant="primary" disabled={!left.trim() || !right.trim()}>
            {window.l10n.compareSubmit}
          </Button>
        </div>
      </form>
      <QueryStatus {...query} />
      {comparison && (
        <>
          <section>
            <h3 class="mb-2 font-semibold">
              {window.l10n.comparedFiles}{" "}
              <span class="text-muted">({comparison.files.length})</span>
            </h3>
            <p class="mb-2 font-mono text-xs text-muted">
              {comparison.base.slice(0, 12)} ↔ {comparison.right.slice(0, 12)}
            </p>
            {comparison.files.length === 0 && <p>{window.l10n.identicalFiles}</p>}
            <ul class="max-h-72 overflow-auto rounded border border-line-soft">
              {comparison.files.map((file) => (
                <li key={file.after}>
                  <button
                    class="flex w-full cursor-pointer gap-3 px-3 py-1.5 text-left hover:bg-row-hover focus:outline-1 focus:outline-focus"
                    onClick={() =>
                      sendRepositoryAction({
                        kind: "viewRangeFile",
                        left: file.status === "A" ? null : comparison.base,
                        right: file.status === "D" ? null : comparison.right,
                        before: file.before,
                        after: file.after
                      })
                    }
                  >
                    <code
                      class={
                        file.status === "A"
                          ? "text-git-added"
                          : file.status === "D"
                            ? "text-git-deleted"
                            : "text-git-modified"
                      }
                    >
                      {file.status}
                    </code>
                    <span class="min-w-0 break-all">
                      {file.before !== file.after ? `${file.before} → ${file.after}` : file.after}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <div class="grid gap-3 md:grid-cols-2">
            <UniqueCommits
              key={comparison.left + comparison.right + "left"}
              comparison={comparison}
              side="left"
            />
            <UniqueCommits
              key={comparison.left + comparison.right + "right"}
              comparison={comparison}
              side="right"
            />
          </div>
        </>
      )}
    </div>
  );
}

export function openCompare(left = "HEAD", right = "HEAD") {
  openContentDialog(window.l10n.compareRevisions, <CompareView left={left} right={right} />, true);
}

function ReflogView() {
  const [offset, setOffset] = useState(0);
  const query = useRepositoryQuery<"reflog">({ kind: "reflog", offset });
  return (
    <div class="space-y-3 text-left">
      <p class="text-muted">{window.l10n.reflogHint}</p>
      <QueryStatus {...query} />
      {query.data && (
        <>
          <ul class="divide-y divide-line-soft">
            {query.data.entries.map((entry, index) => (
              <li key={entry.selector + index} class="space-y-2 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <code>{entry.hash.slice(0, 12)}</code>
                  <time class="text-xs text-muted">{getFullDate(entry.date)}</time>
                </div>
                <p class="break-words">{entry.message}</p>
                <p class="break-all text-xs text-muted">{entry.selector}</p>
                <div class="flex gap-2">
                  <Button
                    onClick={() => {
                      closeDialog();
                      focusHistory(entry.hash);
                    }}
                  >
                    {window.l10n.showInGraph}
                  </Button>
                  <Button
                    onClick={() =>
                      openFormDialog({
                        message: (
                          <>
                            {window.l10n.recoverBranch}: <code>{entry.hash.slice(0, 12)}</code>
                          </>
                        ),
                        inputs: [
                          {
                            kind: "ref",
                            label: window.l10n.recoveryBranchName,
                            value: "recovered/" + entry.hash.slice(0, 8)
                          }
                        ],
                        action: window.l10n.recoverBranch,
                        source: null,
                        onSubmit: ([name]) =>
                          sendRepositoryAction({ kind: "recoverBranch", name, hash: entry.hash })
                      })
                    }
                  >
                    {window.l10n.recoverBranch}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {query.data.entries.length === 0 && <p>{window.l10n.noReflog}</p>}
          <PageControls
            offset={offset}
            count={query.data.entries.length}
            more={query.data.more}
            change={setOffset}
          />
        </>
      )}
    </div>
  );
}

export function openReflog() {
  openContentDialog(window.l10n.reflog, <ReflogView />, true);
}

export function openFileHistory(file: string, revision = "") {
  closeDialog();
  setHistoryFilter({ ...emptyFilter(), path: file, follow: true, revision });
}

function RestorePreview({ plan: initial, repo }: { plan: FileRestorePlan; repo: string }) {
  const [plan, setPlan] = useState(initial);
  const [changed, setChanged] = useState(false);
  const [checking, setChecking] = useState(false);
  // The native diff can become visible before the extension finishes opening it.
  const busy =
    checking || activity.value.some((entry) => entry.repo === repo && entry.finished === null);

  /**
   * Plan again with the same source and destination, since the file can change after planning,
   * even in the preview itself. `next` learns whether the file still matches what was shown.
   */
  function replan(next: (fresh: FileRestorePlan, unchanged: boolean) => void) {
    const owner = dialog.value;
    setChecking(true);
    requestPanelQuery(
      {
        kind: "restorePlan",
        source: plan.source,
        sourcePath: plan.sourcePath,
        destination: plan.destination
      },
      (data, error) => {
        if (dialog.value !== owner) {
          return;
        }
        setChecking(false);
        if (data?.kind !== "restorePlan") {
          openErrorDialog(window.l10n.unableToLoadRepository, error);
          return;
        }
        const unchanged = data.plan.snapshot === plan.snapshot;
        if (!unchanged) {
          setPlan(data.plan);
          setChanged(true);
        }
        next(data.plan, unchanged);
      },
      repo
    );
  }

  return (
    <div class="space-y-3 text-left">
      <p>
        {format(
          window.l10n.restoreFileConfirm,
          <b>{plan.destination}</b>,
          <code>{plan.source.slice(0, 12)}</code>
        )}
      </p>
      <p class="break-all text-muted">
        {window.l10n.restoreSource}: {plan.sourcePath}
      </p>
      {changed && (
        <p class="rounded border border-line p-2" role="status">
          {window.l10n.restorePlanChanged}
        </p>
      )}
      {plan.dirty && (
        <p class="rounded border border-line p-2" role="alert">
          {window.l10n.restoreDirty}
        </p>
      )}
      <div class="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            replan((fresh) =>
              sendRepositoryAction({ kind: "previewFileRestore", plan: fresh }, repo)
            )
          }
        >
          {window.l10n.restorePreview}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            // A changed file is shown again for review instead of being restored.
            replan((fresh, unchanged) => {
              if (unchanged) {
                sendRepositoryAction({ kind: "restoreFile", plan: fresh }, repo);
              }
            })
          }
        >
          {window.l10n.restoreHistoricalFile}
        </Button>
      </div>
    </div>
  );
}

export function openRestoreFile(source: string, sourcePath: string, destination = sourcePath) {
  const repo = selectedRepo.value;
  if (!repo) {
    return;
  }
  openFormDialog({
    message: window.l10n.restoreHistoricalFile,
    inputs: [{ kind: "text", label: window.l10n.restoreDestination, value: destination }],
    action: window.l10n.restorePreview,
    source: null,
    onSubmit: ([target]) =>
      requestRepositoryQuery(
        { kind: "restorePlan", source, sourcePath, destination: target },
        (data) => {
          if (data.kind === "restorePlan") {
            openContentDialog(
              window.l10n.restoreHistoricalFile,
              <RestorePreview plan={data.plan} repo={repo} />
            );
          }
        },
        repo
      )
  });
}

export function BatchEditor({
  plan,
  operation,
  repo
}: {
  plan: BatchPlan;
  operation: "cherry-pick" | "revert";
  repo: string;
}) {
  const [entries, setEntries] = useState(plan.entries);
  const [mainline, setMainline] = useState("1");
  const merges = entries.filter((entry) => entry.parentHashes.length > 1);
  const parentCount =
    merges.length > 0 ? Math.min(...merges.map((entry) => entry.parentHashes.length)) : 0;
  const { root, move, status } = useListMove(entries, setEntries);
  const title = operation === "revert" ? window.l10n.batchRevert : window.l10n.batchCherryPick;
  return (
    <div ref={root} class="space-y-3 text-left">
      <p>
        <b>{plan.branch}</b> · <code>{plan.head.slice(0, 12)}</code>
      </p>
      <p class="text-muted">{window.l10n.batchOrderHint}</p>
      <ol class="divide-y divide-line-soft">
        {entries.map((entry, index) => (
          <li key={entry.hash} data-entry={entry.hash} class="space-y-2 py-2">
            <div class="flex gap-2">
              <span class="text-muted">{index + 1}.</span>
              <code>{entry.hash.slice(0, 8)}</code>
              <span class="break-words">{entry.message}</span>
            </div>
            {entry.parentHashes.length > 1 && (
              <p class="break-all text-xs text-muted">
                {entry.parentHashes.map((hash, i) => `${i + 1}: ${hash.slice(0, 12)}`).join(" · ")}
              </p>
            )}
            <div class="flex gap-2">
              <Button
                {...moveButton(entry.hash, "earlier")}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                {window.l10n.moveEarlier}
              </Button>
              <Button
                {...moveButton(entry.hash, "later")}
                disabled={index === entries.length - 1}
                onClick={() => move(index, 1)}
              >
                {window.l10n.moveLater}
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {status}
      {parentCount > 0 && (
        <label class="grid gap-2">
          {window.l10n.batchMainline}
          <Select
            value={mainline}
            onChange={setMainline}
            options={Array.from({ length: parentCount }, (_, i) => ({
              label: String(i + 1),
              value: String(i + 1)
            }))}
          />
        </label>
      )}
      <Button
        variant="primary"
        onClick={() =>
          sendRepositoryAction(
            {
              kind: "batch",
              operation,
              plan: { ...plan, entries },
              mainline: parentCount ? Number(mainline) : 0
            },
            repo
          )
        }
      >
        {title}
      </Button>
    </div>
  );
}

export function openBatch(operation: "cherry-pick" | "revert") {
  const repo = selectedRepo.value;
  if (!repo || selectedCommits.value.length === 0) {
    return;
  }
  const ordered =
    operation === "cherry-pick" ? selectionInGraphOrder().toReversed() : selectionInGraphOrder();
  requestRepositoryQuery(
    { kind: "batchPlan", hashes: ordered.map((entry) => entry.hash) },
    (data) => {
      if (data.kind === "batchPlan") {
        openContentDialog(
          operation === "revert" ? window.l10n.batchRevert : window.l10n.batchCherryPick,
          <BatchEditor plan={data.plan} operation={operation} repo={repo} />,
          true
        );
      }
    },
    repo
  );
}

function FixupPreview({ plan, repo }: { plan: StagedPlan; repo: string }) {
  return (
    <div class="space-y-3 text-left">
      <p>{format(window.l10n.fixupPreview, <code>{plan.target.slice(0, 12)}</code>)}</p>
      <ul class="max-h-72 overflow-auto rounded border border-line-soft p-2 font-mono text-xs">
        {plan.files.map((file) => (
          <li key={file} class="break-all py-1">
            {file}
          </li>
        ))}
      </ul>
      <Button variant="primary" onClick={() => sendRepositoryAction({ kind: "fixup", plan }, repo)}>
        {window.l10n.createFixup}
      </Button>
    </div>
  );
}

export function openFixup(target: string) {
  const repo = selectedRepo.value;
  if (!repo) {
    return;
  }
  requestRepositoryQuery(
    { kind: "stagedPlan", target },
    (data) => {
      if (data.kind === "stagedPlan") {
        openContentDialog(window.l10n.createFixup, <FixupPreview plan={data.plan} repo={repo} />);
      }
    },
    repo
  );
}
