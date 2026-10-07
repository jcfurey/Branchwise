import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import { TABLE_HEADER_HEIGHT } from "@/webview/constants";
import { onPageScroll } from "@/webview/lib/page-scroll";
import { type CommitDays, getDayName } from "@/webview/utils/date";

/**
 * The day of the topmost commit row showing below the table's sticky headings, or null while the
 * first row is still wholly in sight, once the table has scrolled past, and when that row is not
 * a dated commit.
 */
function topDay(
  container: HTMLElement | null,
  rowOf: ReadonlyMap<string, number>,
  { days }: CommitDays
): number | null {
  const head = container?.querySelector("thead");
  const body = container?.querySelector("tbody");
  if (!head || !body) {
    return null;
  }
  const line = head.getBoundingClientRect().bottom;
  if (body.getBoundingClientRect().top >= line) {
    return null;
  }
  // Rows sit one below the other, so the first to reach below the line is found by halving, which
  // reads a handful of rows on each frame however many are loaded.
  const rows = body.rows;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle]!.getBoundingClientRect().bottom > line) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  if (low === rows.length) {
    return null;
  }
  // A details row is not a commit: it shows the commit above it.
  let at = low;
  while (at > 0 && rows[at]!.dataset["commitHash"] === undefined) {
    at--;
  }
  const hash = rows[at]!.dataset["commitHash"];
  return hash === undefined ? null : (days[rowOf.get(hash) ?? -1] ?? null);
}

/**
 * A small label under the table's headings that names the day of the topmost commit row while
 * the table is scrolled. It is read from the page on scroll, at most once a frame, and only
 * re-renders itself when the day changes. Screen readers skip it: each row says its own date.
 */
export function DayPill({
  containerRef,
  rowOf,
  days
}: {
  containerRef: RefObject<HTMLElement>;
  rowOf: ReadonlyMap<string, number>;
  days: CommitDays;
}) {
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    let pending = false;
    const update = () => {
      pending = false;
      setDay(topDay(containerRef.current, rowOf, days));
    };
    const schedule = () => {
      if (!pending) {
        pending = true;
        frame = requestAnimationFrame(update);
      }
    };
    schedule();
    const stopScroll = onPageScroll(schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      stopScroll();
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, rowOf, days]);

  if (day === null) {
    return null;
  }
  // A sticky strip of no height before the table, so it never moves a row of the graph's grid.
  return (
    <div
      aria-hidden="true"
      class="pointer-events-none sticky z-10 h-0"
      style={`top: calc(var(--main-header-height, 0px) + var(--graph-top, ${TABLE_HEADER_HEIGHT}px));`}
    >
      <span
        data-day-pill
        class="absolute top-1 left-1/2 -translate-x-1/2 rounded-full border border-line bg-menu px-2.5 py-0.5 text-xs whitespace-nowrap text-menu-fg shadow-md"
      >
        {getDayName(day)}
      </span>
    </div>
  );
}
