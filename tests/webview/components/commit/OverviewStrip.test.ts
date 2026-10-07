// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { selectedCommits } from "@/webview/lib/navigation";
import { expandedCommit, repoStates, selectedRepo } from "@/webview/lib/stores";

import {
  attachHost,
  entry,
  reconfigure,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

/** Where the table's body starts in the window before any scrolling, below a banner. */
const BODY_TOP = 100;
const HEADING = 32;
const WINDOW = 768;

/** `count` commits in one line, newest first, with a branch and a tag far down. */
function history(count: number): HistoryEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry(`c${index}`, index + 1 < count ? [`c${index + 1}`] : [], {
      refs:
        index === count - 20
          ? [{ hash: `c${index}`, name: "old-topic", type: "head" }]
          : index === count - 5
            ? [{ hash: `c${index}`, name: "v0.1", type: "tag" }]
            : []
    })
  );
}

let host: HTMLDivElement;
let rows: number;
let frames: FrameRequestCallback[];
let scrollTo: ReturnType<typeof vi.fn>;
let drawn: Array<{ call: string; args: unknown[] }>;

const strip = () => host.querySelector<HTMLElement>("[data-overview-strip]");
const canvas = () => host.querySelector<HTMLCanvasElement>("[data-overview-strip] canvas");

function draw(commits: HistoryEntry[], head: string | null = "c0") {
  rows = commits.length;
  act(() => render(h(CommitTable, { commits, head, headBranch: "main" }), host));
}

/** A drawing context that records what is drawn. */
function recordingContext() {
  const record =
    (call: string) =>
    (...args: unknown[]) => {
      drawn.push({ call, args });
    };
  return new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, key: string) => target[key] ?? record(key),
      set: (target: Record<string, unknown>, key: string, value: unknown) => {
        target[key] = value;
        return true;
      }
    }
  );
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  selectedRepo.value = "/repo";
  repoStates.value = {};
  expandedCommit.value = null;
  selectedCommits.value = [];
  drawn = [];
  frames = [];
  stubResizeObserver();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("innerHeight", WINDOW);
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  // Opening details scrolls them into view.
  vi.stubGlobal("scrollBy", vi.fn());
  // The table's body moves up as the window scrolls; the canvas sticks below the headings.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = BODY_TOP - window.scrollY;
    if (this.tagName === "TBODY") {
      return { top, bottom: top + rows * 24, height: rows * 24, width: 800 } as DOMRect;
    }
    if (this.tagName === "THEAD") {
      return { top: top - HEADING, bottom: top, height: HEADING, width: 800 } as DOMRect;
    }
    if (this.tagName === "CANVAS") {
      const canvasTop = Math.max(top, HEADING);
      return { top: canvasTop, height: WINDOW - canvasTop, width: 10 } as DOMRect;
    }
    return { top: 0, bottom: 0, height: 0, width: 0 } as DOMRect;
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => BODY_TOP + rows * 24 + 60
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => recordingContext() as unknown as CanvasRenderingContext2D
  );
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("draws the whole history beside the table, kept out of the keyboard's way", () => {
  draw(history(500));
  const element = canvas()!;
  expect(strip()!.hidden).toBe(false);
  expect(strip()!.getAttribute("aria-hidden")).toBe("true");
  expect(element.getAttribute("aria-hidden")).toBe("true");
  expect(element.hasAttribute("tabindex")).toBe(false);
  expect(element.tabIndex).toBe(-1);
  expect(element.dataset["markerKinds"]).toBe("head branch tag");
  expect(element.dataset["markerCount"]).toBe("3");
  // From the body's top to the bottom of the window, at one canvas pixel per CSS pixel.
  expect(element.style.height).toBe(`${WINDOW - BODY_TOP}px`);
  expect([element.width, element.height]).toEqual([10, WINDOW - BODY_TOP]);
  expect(host.firstElementChild!.getAttribute("style")).toContain("--overview-gutter: 10px");
  expect(drawn.some((step) => step.call === "fillRect")).toBe(true);
  // No row of the table is drawn as an element of the strip.
  expect(strip()!.querySelectorAll("*")).toHaveLength(9);
});

it("scrolls the table to the row under a click, and follows a drag", () => {
  draw(history(500));
  const element = canvas()!;
  const height = WINDOW - BODY_TOP;
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, clientY: BODY_TOP + height - 1 })
    );
  });
  // The last row, which the window cannot scroll to the middle: it goes as far down as it can.
  expect(scrollTo).toHaveBeenLastCalledWith(0, BODY_TOP + 500 * 24 + 60 - WINDOW);

  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = () => true;
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientY: BODY_TOP + height / 2 })
    );
  });
  // Row 250 of 500, centred.
  expect(scrollTo).toHaveBeenLastCalledWith(0, BODY_TOP + 250 * 24 + 12 - (HEADING + WINDOW) / 2);

  scrollTo.mockClear();
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 2, clientY: BODY_TOP })
    );
  });
  expect(scrollTo).not.toHaveBeenCalled();
});

it("redraws once per frame while the window scrolls", () => {
  draw(history(500));
  vi.stubGlobal("scrollY", 2000);
  for (let event = 0; event < 3; event++) {
    window.dispatchEvent(new Event("scroll"));
  }
  expect(frames).toHaveLength(1);
  act(() => frames[0]!(0));
  // Stuck below the heading now, the strip reaches from there to the bottom of the window.
  expect(canvas()!.style.height).toBe(`${WINDOW - HEADING}px`);
});

it("hides itself when every row fits on screen", () => {
  draw(history(20));
  expect(strip()!.hidden).toBe(true);
  expect(host.firstElementChild!.getAttribute("style")).toContain("--overview-gutter: 0px");
  draw(history(500));
  expect(strip()!.hidden).toBe(false);
});

it("marks the selection and the open details, and leaves when the setting is off", () => {
  const commits = history(500);
  act(() => {
    selectedCommits.value = [commits[300]!];
    expandedCommit.value = "c400";
  });
  draw(commits);
  expect(canvas()!.dataset["markerKinds"]).toBe("head selected details branch tag");

  const restore = reconfigure({ overviewMarkers: false });
  try {
    draw(commits);
    expect(strip()).toBeNull();
    expect(host.firstElementChild!.getAttribute("style") ?? "").not.toContain("--overview-gutter");
  } finally {
    act(() => restore());
  }
});
