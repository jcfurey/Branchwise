import { signal } from "@preact/signals";
import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type { CommitStats } from "@/backend/types";
import { COMMIT_DETAILS_HEIGHT, ROW_HEIGHT, UNCOMMITTED_CHANGES } from "@/webview/constants";
import { repositoryRevision, requestPanelQuery } from "@/webview/lib/repository-actions";
import { rowHeight as currentRowHeight } from "@/webview/lib/webview-config";

/** Rows above and below the window whose counts are read too, so a short scroll finds them. */
export const STATS_MARGIN = 40;

/** How long scrolling or resizing must pause, in milliseconds, before the rows are asked for. */
export const STATS_SETTLE_MS = 150;

/** Answers remembered at most; the oldest goes first. */
const CACHE_SIZE = 20_000;

/**
 * Counts by repository and commit, for the rest of the session: a commit never changes, so
 * neither does what it changed.
 */
const answers = new Map<string, CommitStats>();

/** Commits being read now, so that no two reads ask for the same one. */
const reading = new Set<string>();

/**
 * Commits that the last read could not count, with the `repositoryRevision` it failed at. They
 * are asked for again once the repository changes, and not before.
 */
const failed = new Map<string, number>();

/** Bumped by every answer, so that whatever shows counts draws again. */
export const commitStatsVersion = signal(0);

const keyOf = (repo: string, hash: string) => `${repo}\0${hash}`;

function remember(key: string, stats: CommitStats) {
  answers.delete(key);
  if (answers.size >= CACHE_SIZE) {
    answers.delete(answers.keys().next().value!);
  }
  answers.set(key, stats);
}

/**
 * The counts of `hash` in `repo`, or `undefined` until they are read. A render, `computed` or
 * effect that calls this runs again when an answer arrives.
 */
export function commitStatsOf(repo: string | undefined, hash: string): CommitStats | undefined {
  // Read for its subscription: the map itself is not a signal.
  void commitStatsVersion.value;
  return repo === undefined ? undefined : answers.get(keyOf(repo, hash));
}

/** Whether the last read of `hash` in `repo` found no counts since the repository last changed. */
export function commitStatsFailed(repo: string | undefined, hash: string): boolean {
  void commitStatsVersion.value;
  return repo !== undefined && failed.get(keyOf(repo, hash)) === repositoryRevision.value;
}

/**
 * Ask for the counts of whichever of `hashes` are neither known nor being read. The returned
 * function stops the read while it waits, and the commits it asked for can be asked for again.
 */
export function requestCommitStats(repo: string, hashes: readonly string[]): () => void {
  const revision = repositoryRevision.peek();
  const wanted = [...new Set(hashes)].filter((hash) => {
    const key = keyOf(repo, hash);
    return (
      hash !== UNCOMMITTED_CHANGES &&
      !answers.has(key) &&
      !reading.has(key) &&
      failed.get(key) !== revision
    );
  });
  if (wanted.length === 0) {
    return () => {};
  }
  const keys = wanted.map((hash) => keyOf(repo, hash));
  keys.forEach((key) => reading.add(key));
  let waiting = true;
  const settle = () => {
    waiting = false;
    keys.forEach((key) => reading.delete(key));
  };
  const stop = requestPanelQuery(
    { kind: "commitStats", hashes: wanted },
    (data) => {
      settle();
      const stats = data?.kind === "commitStats" ? data.stats : {};
      wanted.forEach((hash, at) => {
        const answer = Object.hasOwn(stats, hash) ? stats[hash] : undefined;
        if (answer === undefined) {
          // Git does not have the commit, or the read failed.
          failed.set(keys[at]!, revision);
        } else {
          failed.delete(keys[at]!);
          remember(keys[at]!, answer);
        }
      });
      commitStatsVersion.value++;
    },
    repo,
    // Answers are kept by repository, so one that arrives after a switch is still worth keeping.
    true
  );
  return () => {
    if (waiting) {
      settle();
      stop();
    }
  };
}

/**
 * The rows worth reading for a table body whose top is `top` pixels below the top of a window
 * `height` pixels tall: those in sight and `STATS_MARGIN` either side, as `[start, end)`. Rows
 * are `rowHeight` tall; open details push the rows below them down, which only widens the range.
 */
export function rowsInSight(
  top: number,
  height: number,
  count: number,
  detailsOpen: boolean,
  rowHeight: number = ROW_HEIGHT
): [start: number, end: number] {
  const pushed = detailsOpen ? Math.ceil(COMMIT_DETAILS_HEIGHT / rowHeight) : 0;
  const first = Math.floor(-top / rowHeight) - pushed - STATS_MARGIN;
  const last = Math.ceil((height - top) / rowHeight) + STATS_MARGIN;
  const clamp = (row: number) => Math.min(Math.max(row, 0), count);
  return [clamp(first), clamp(last)];
}

/**
 * Read the counts of the rows in sight of `body`, while `enabled`: once the table draws, and
 * again whenever scrolling or resizing pauses. Reads still waiting stop when the table goes,
 * the rows change or another repository is shown.
 */
export function useCommitStatsLoader(
  body: RefObject<HTMLElement>,
  hashes: readonly string[],
  detailsOpen: boolean,
  repo: string | undefined,
  enabled: boolean
): void {
  // Read when the timer fires, so that opening details does not start everything again.
  const open = useRef(detailsOpen);
  open.current = detailsOpen;
  useEffect(() => {
    if (!enabled || repo === undefined) {
      return;
    }
    const reads: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      timer = undefined;
      const element = body.current;
      if (element !== null) {
        const top = element.getBoundingClientRect().top;
        const [start, end] = rowsInSight(
          top,
          window.innerHeight,
          hashes.length,
          open.current,
          currentRowHeight()
        );
        reads.push(requestCommitStats(repo, hashes.slice(start, end)));
      }
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(load, STATS_SETTLE_MS);
    };
    load();
    window.addEventListener("scroll", later, { capture: true, passive: true });
    window.addEventListener("resize", later);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", later, { capture: true });
      window.removeEventListener("resize", later);
      reads.forEach((stop) => stop());
    };
  }, [enabled, repo, hashes]);
}
