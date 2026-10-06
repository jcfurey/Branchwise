import { useEffect, useState } from "preact/hooks";

import type { ReplayForecast, ReplayForecastQuery } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { ConflictIcon } from "@/webview/components/ui/Icons";
import { selectedRepo } from "@/webview/lib/stores";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { format } from "@/webview/utils/format";

/** How long an editor's order must stay unchanged before its forecast is asked for, in ms. */
export const FORECAST_DELAY = 300;

/** Conflicted files named in a forecast at most; the rest are counted. */
const FILES_LISTED = 5;

export type ReplayOperation = "rebase" | "cherry-pick" | "revert";

/** The forecast of a query, or `pending` while it is being worked out. */
export type ForecastState = { forecast: ReplayForecast | null; pending: boolean };

/**
 * The forecast of `query`, asked for once `query` has stayed the same for `delay` ms. A changed
 * query gives up the request for the one before at once, which stops its Git processes.
 */
export function useReplayForecast(
  query: ReplayForecastQuery | null,
  delay = 0,
  repo = selectedRepo.value
): ForecastState {
  const key = JSON.stringify(query);
  const [settled, setSettled] = useState<ReplayForecastQuery | null>(delay === 0 ? query : null);
  useEffect(() => {
    if (delay === 0) {
      return;
    }
    setSettled(null);
    const timer = setTimeout(() => setSettled(query), delay);
    return () => clearTimeout(timer);
  }, [key]);
  const asked = delay === 0 ? query : settled;
  const result = useRepositoryQuery<"replayForecast">(asked, repo);
  const current = JSON.stringify(asked) === key && !result.loading;
  return {
    forecast: current ? (result.data?.forecast ?? null) : null,
    pending: query !== null && !current
  };
}

/** The first few of `files`, separated by commas, and how many more there are. */
export function forecastFiles(files: string[]) {
  const listed = files.slice(0, FILES_LISTED).join(", ");
  const more = files.length - FILES_LISTED;
  return more > 0
    ? `${listed} ${window.l10n.conflictForecastMore.replace("{0}", String(more))}`
    : listed;
}

function stopTemplate(operation: ReplayOperation) {
  const l10n = window.l10n;
  if (operation === "revert") {
    return l10n.forecastRevertStop;
  }
  return operation === "cherry-pick" ? l10n.forecastCherryPickStop : l10n.forecastRebaseStop;
}

function cleanText(operation: ReplayOperation, count: number) {
  const l10n = window.l10n;
  const [one, many] =
    operation === "revert"
      ? [l10n.forecastRevertsOne, l10n.forecastReverts]
      : [l10n.forecastReplaysOne, l10n.forecastReplays];
  return count === 1 ? one : many.replace("{0}", String(count));
}

/**
 * One line saying where `operation` would stop with conflicts, or that it would apply cleanly.
 * It only informs: nothing waits for it. The region stays in place while empty, so that a screen
 * reader announces the answer when it arrives.
 */
export function ReplayForecastLine({
  state,
  operation
}: {
  state: ForecastState;
  operation: ReplayOperation;
}) {
  const l10n = window.l10n;
  const { forecast, pending } = state;
  let content = null;
  let kind = "none";
  if (pending) {
    kind = "checking";
    content = <span class="text-muted">{l10n.forecastChecking}</span>;
  } else if (forecast?.skipped !== undefined) {
    kind = "skipped";
    content = (
      <span class="text-muted">
        {forecast.skipped === "limit" ? l10n.forecastSkippedLimit : l10n.forecastNeedsGit}
      </span>
    );
  } else if (forecast?.stop) {
    const { hash, subject, files } = forecast.stop;
    kind = "stop";
    content = (
      <span class="flex items-start gap-1 text-git-conflict">
        <ConflictIcon class="mt-px size-3.5 shrink-0" />
        <span class="min-w-0 break-words">
          {format(
            stopTemplate(operation),
            <>
              <code>{abbrevCommit(hash)}</code> {subject}
            </>,
            forecastFiles(files)
          )}
        </span>
      </span>
    );
  } else if (forecast !== null && forecast.replayed > 0) {
    kind = "clean";
    content = <span class="text-muted">{cleanText(operation, forecast.replayed)}</span>;
  }
  return (
    <span role="status" data-replay-forecast={kind} class="mt-2 block text-left text-xs">
      {content}
    </span>
  );
}

/** The forecast of `query` as one line, for a confirmation dialog. */
export function ReplayForecastFor({
  query,
  operation
}: {
  query: ReplayForecastQuery;
  operation: ReplayOperation;
}) {
  return <ReplayForecastLine state={useReplayForecast(query)} operation={operation} />;
}

/** The mark on an editor's entry where the replay would stop, with the files in conflict. */
export function ForecastStopMark({ files }: { files: string[] }) {
  return (
    <p data-forecast-stop class="flex items-start gap-1 text-xs text-git-conflict">
      <ConflictIcon class="mt-px size-3.5 shrink-0" />
      <span class="min-w-0 break-words">
        {format(window.l10n.forecastStopsHere, forecastFiles(files))}
      </span>
    </p>
  );
}
