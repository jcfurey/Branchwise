import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import type { HistoryEntry } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { ChangeCounts } from "@/webview/components/commit/ChangeCounts";
import { commitStatsFailed, commitStatsOf, requestCommitStats } from "@/webview/lib/commit-stats";
import { type Box, hideHoverCard, hoverCard, placeCard } from "@/webview/lib/hover-card";
import { selectedRepo } from "@/webview/lib/stores";
import { filesChanged } from "@/webview/utils/changes";
import { getFullDate } from "@/webview/utils/date";

/**
 * The card about one commit that rests beside the pointer or the focused row: its subject, the
 * start of its message body, its author, full date and IDs, and its change counts, which are read
 * when it first shows. It is a picture only: hidden from screen readers, which read the same in
 * the details, and transparent to the pointer, so the row under it still takes every click.
 */
function Card({ commit, anchor }: { commit: HistoryEntry; anchor: Box }) {
  const card = useRef<HTMLDivElement>(null);
  const repo = selectedRepo.value;
  const { hash } = commit;
  const stats = commitStatsOf(repo, hash);
  const failed = stats === undefined && commitStatsFailed(repo, hash);

  useEffect(() => {
    if (repo !== undefined) {
      return requestCommitStats(repo, [hash]);
    }
  }, [repo, hash]);

  // Placed before it paints, and again when the counts and body arrive and make it taller.
  useLayoutEffect(() => {
    const element = card.current;
    if (element === null) {
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    const place = placeCard(
      anchor,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    element.style.left = `${place.left}px`;
    element.style.top = `${place.top}px`;
    element.style.visibility = "visible";
    element.dataset["above"] = String(place.above);
    element.dataset["before"] = String(place.before);
  });

  return (
    <div
      ref={card}
      data-hover-card={hash}
      aria-hidden="true"
      class="pointer-events-none fixed z-30 w-max max-w-[min(30rem,calc(100vw-1rem))] rounded-md border border-card-border bg-card px-3 py-2 text-ui leading-5 text-card-fg shadow-md"
      style={{ left: "0px", top: "0px", visibility: "hidden" }}
    >
      <div data-hover-subject class="font-semibold wrap-anywhere">
        {commit.message}
      </div>
      {stats !== undefined && stats.body !== "" && (
        <div data-hover-body class="mt-1 line-clamp-6 whitespace-pre-line wrap-anywhere text-muted">
          {stats.bodyCut ? `${stats.body}…` : stats.body}
        </div>
      )}
      <div class="mt-2 border-t border-line-soft pt-1.5">
        <div data-hover-author class="wrap-anywhere">{`${commit.author} <${commit.email}>`}</div>
        <div data-hover-date>{getFullDate(commit.date)}</div>
        <div data-hover-id class="font-mono text-xs leading-5">
          <span>{abbrevCommit(hash)}</span> <span class="text-muted">{hash}</span>
        </div>
        {!failed && (
          <div data-hover-changes>
            {stats === undefined ? (
              <span class="text-muted">{window.l10n.loadingChanges}</span>
            ) : (
              <>
                <ChangeCounts stats={stats} /> <span class="text-muted">{filesChanged(stats)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The card of the commit `hoverCard` names, while one of `rows` has it. */
export function CommitHoverCard({ rows }: { rows: ReadonlyMap<string, HistoryEntry> }) {
  const state = hoverCard.value;
  const commit = state === null ? undefined : rows.get(state.hash);
  // A refresh that dropped the commit drops its card too.
  useEffect(() => {
    if (state !== null && commit === undefined) {
      hideHoverCard();
    }
  }, [state, commit]);
  return state === null || commit === undefined ? null : (
    <Card key={`${state.hash}:${state.source}`} commit={commit} anchor={state.anchor} />
  );
}
