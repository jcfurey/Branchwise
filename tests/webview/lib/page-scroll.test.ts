// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  graphScroller,
  onPageScroll,
  pageScrollTop,
  pageViewport,
  scrollPageTo
} from "@/webview/lib/page-scroll";

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--main-header-height");
  vi.restoreAllMocks();
});

/** The docked layout's scroller, holding a list that scrolls on its own, like a file tree. */
function docked() {
  document.body.innerHTML =
    '<div data-graph-scroller><table></table><div data-files style="overflow: auto"></div></div>';
  const scroller = graphScroller()!;
  let top = 0;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    }
  });
  return scroller;
}

describe("while the window scrolls", () => {
  it("reads and sets the window's position", () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(120);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    expect(graphScroller()).toBeNull();
    expect(pageScrollTop()).toBe(120);
    scrollPageTo(30);
    expect(scrollTo).toHaveBeenCalledWith(0, 30);
  });

  it("shows rows between the sticky header and the bottom of the window", () => {
    document.documentElement.style.setProperty("--main-header-height", "48px");
    expect(pageViewport()).toEqual({ top: 48, bottom: window.innerHeight });
    document.documentElement.style.removeProperty("--main-header-height");
    expect(pageViewport()).toEqual({ top: 0, bottom: window.innerHeight });
  });

  it("follows the document's scrolling", () => {
    const listener = vi.fn();
    const stop = onPageScroll(listener);
    document.dispatchEvent(new Event("scroll"));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    document.dispatchEvent(new Event("scroll"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("while the details are docked", () => {
  it("reads and sets the scroller's position, leaving the window alone", () => {
    const scroller = docked();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    scrollPageTo(300);
    expect(scroller.scrollTop).toBe(300);
    expect(pageScrollTop()).toBe(300);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("shows rows in the scroller's own box", () => {
    const scroller = docked();
    document.documentElement.style.setProperty("--main-header-height", "48px");
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 40, width: 500, height: 300 })
    );
    expect(pageViewport()).toEqual({ top: 40, bottom: 340 });
  });

  it("follows the scroller, but not the lists scrolling inside it", () => {
    const scroller = docked();
    const listener = vi.fn();
    const stop = onPageScroll(listener);
    scroller.dispatchEvent(new Event("scroll"));
    expect(listener).toHaveBeenCalledTimes(1);
    document.querySelector("[data-files]")!.dispatchEvent(new Event("scroll"));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    scroller.dispatchEvent(new Event("scroll"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
