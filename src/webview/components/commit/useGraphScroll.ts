import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { VERTEX_RADIUS } from "@/webview/graph/constants";
import { selectedRepo } from "@/webview/lib/stores";

/** Clip to the column the browser actually laid out, which may be narrower than its requested width. */
export function useGraphScroll(
  containerRef: RefObject<HTMLDivElement>,
  headRef: RefObject<HTMLTableRowElement>,
  contentWidth: number
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const repo = selectedRepo.value;

  function syncScroll() {
    if (viewportRef.current && scrollRef.current) {
      viewportRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
  }

  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
    syncScroll();
  }, [repo]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const row = headRef.current;
    const cell = row?.cells.item(0);
    if (!container || !row || !cell) {
      return;
    }
    const measure = () => {
      const width = cell.getBoundingClientRect().width;
      container.style.setProperty("--graph-viewport-width", `${width}px`);
      container.style.setProperty("--graph-top", `${row.getBoundingClientRect().height}px`);
      setOverflow(contentWidth > width + 1);
      syncScroll();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(cell);
    return () => observer.disconnect();
  }, [containerRef, headRef, contentWidth]);

  function onWheel(event: WheelEvent) {
    const cell = (event.target as Element).closest<HTMLTableCellElement>("td, th");
    const scroll = scrollRef.current;
    if (!scroll || cell?.cellIndex !== 0) {
      return;
    }
    const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!delta) {
      return;
    }
    const before = scroll.scrollLeft;
    scroll.scrollLeft +=
      delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientWidth : 1);
    if (scroll.scrollLeft !== before) {
      event.preventDefault();
      syncScroll();
    }
  }

  /** Called by explicit row navigation, never by a layout update or background refresh. */
  function revealLane(x: number) {
    const scroll = scrollRef.current;
    if (!scroll || scroll.clientWidth === 0) {
      return;
    }
    const margin = Math.min(VERTEX_RADIUS + 4, scroll.clientWidth / 2);
    if (x - margin < scroll.scrollLeft) {
      scroll.scrollLeft = Math.max(0, x - margin);
    } else if (x + margin > scroll.scrollLeft + scroll.clientWidth) {
      scroll.scrollLeft = x + margin - scroll.clientWidth;
    }
    syncScroll();
  }

  return { viewportRef, scrollRef, overflow, syncScroll, onWheel, revealLane };
}
