/**
 * Where the graph scrolls. Usually the window scrolls, under the sticky header. While commit
 * details are docked in a pane, the window stays still and the graph scrolls in an element of
 * its own, marked `data-graph-scroller`, above or beside the pane. Code that reads or sets the
 * scroll position, or follows it, goes through these helpers so that it works in both layouts.
 */

const SCROLLER = "[data-graph-scroller]";

/** The element the graph scrolls in while the details are docked, or `null` while the window scrolls. */
export function graphScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SCROLLER);
}

export function pageScrollTop(): number {
  return graphScroller()?.scrollTop ?? window.scrollY;
}

export function scrollPageTo(top: number): void {
  const scroller = graphScroller();
  if (scroller === null) {
    window.scrollTo(0, top);
  } else {
    scroller.scrollTop = top;
  }
}

/**
 * Call `listener` each time the graph scrolls, in whichever layout is shown then. Returns the
 * function that stops listening.
 */
export function onPageScroll(listener: () => void): () => void {
  // An element's scroll event does not bubble, but the window sees every one while capturing.
  // Other scrolling lists, such as a commit's file tree, are left out.
  const handle = (event: Event) => {
    const { target } = event;
    if (
      target === document ||
      target === window ||
      (target instanceof Element && target.matches(SCROLLER))
    ) {
      listener();
    }
  };
  window.addEventListener("scroll", handle, { capture: true, passive: true });
  return () => window.removeEventListener("scroll", handle, { capture: true });
}

/**
 * The band of the window, top and bottom in client pixels, that the graph's rows show through:
 * between the sticky header and the bottom of the window, or the graph's own box while docked.
 */
export function pageViewport(): { top: number; bottom: number } {
  const scroller = graphScroller();
  if (scroller !== null) {
    const { top, bottom } = scroller.getBoundingClientRect();
    return { top, bottom };
  }
  const header = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--main-header-height")
  );
  return { top: Number.isNaN(header) ? 0 : header, bottom: window.innerHeight };
}
