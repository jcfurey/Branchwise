import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { COMMIT_DETAILS_HEIGHT, TABLE_HEADER_HEIGHT } from "@/webview/constants";
import {
  type BodyGeometry,
  collapseMarkers,
  type MarkerKind,
  MARKER_PRIORITY,
  markerKinds,
  type OverviewMarker,
  type PageGeometry,
  scrollForStripPoint,
  type StripMark,
  visibleBand
} from "@/webview/lib/overview-markers";
import { rowHeight } from "@/webview/lib/webview-config";

/** The strip's width, in CSS pixels. The table gives up this much on its right. */
export const STRIP_WIDTH = 10;

/** Below this height, in CSS pixels, the strip would be too short to point at anything. */
const SHORTEST_STRIP = 24;

/** The property on the table's container that holds the room kept for the strip. */
const GUTTER_PROPERTY = "--overview-gutter";

/**
 * The theme colour of each kind, plus the visible band and the strip's edge, as utilities whose
 * computed `color` the canvas reads. Written out whole so that Tailwind finds them.
 */
const COLOUR_PROBES = {
  head: "text-overview-head",
  selected: "text-overview-selected",
  details: "text-overview-details",
  branch: "text-overview-branch",
  tag: "text-overview-tag",
  unpushed: "text-overview-unpushed",
  band: "text-overview-band",
  edge: "text-overview-edge"
} as const;

type Colours = Record<keyof typeof COLOUR_PROBES, string> & { tagAlpha: number; bandAlpha: number };

/** The probes' colours as the theme sets them now, so a theme switch shows on the next frame. */
function readColours(strip: HTMLElement): Colours {
  const colours = {} as Colours;
  for (const name of Object.keys(COLOUR_PROBES) as Array<keyof typeof COLOUR_PROBES>) {
    const probe = strip.querySelector(`[data-overview-colour="${name}"]`);
    colours[name] = probe === null ? "" : getComputedStyle(probe).color;
  }
  const style = getComputedStyle(strip);
  const alpha = (property: string) => {
    const value = Number.parseFloat(style.getPropertyValue(property));
    return Number.isFinite(value) ? value : 1;
  };
  colours.tagAlpha = alpha("--overview-tag-alpha");
  colours.bandAlpha = alpha("--overview-band-alpha");
  return colours;
}

/**
 * Draw one kind's mark at pixel row `y`. Each kind has its own shape and place across the strip
 * as well as its own colour: branches and tags in the left half, the selection and unpushed
 * commits in the right half, the open details as an outline across the whole width and HEAD as a
 * solid bar across it.
 */
function drawMark(
  context: CanvasRenderingContext2D,
  kind: MarkerKind,
  y: number,
  width: number,
  colours: Colours
) {
  context.globalAlpha = kind === "tag" ? colours.tagAlpha : 1;
  context.fillStyle = colours[kind];
  context.strokeStyle = colours[kind];
  const lane = (width - 1) / 2;
  switch (kind) {
    case "head":
      context.fillRect(1, y - 1, width - 1, 4);
      break;
    case "selected":
      context.fillRect(width - lane, y - 0.5, lane, 3);
      break;
    case "details":
      context.lineWidth = 1;
      context.strokeRect(1.5, y - 1.5, width - 2, 5);
      break;
    case "branch":
      context.fillRect(1, y, lane, 2);
      break;
    case "tag":
      context.fillRect(1 + lane / 4, y, lane / 2, 2);
      break;
    case "unpushed":
      context.beginPath();
      context.arc(width - lane / 2, y + 1, 1.25, 0, 2 * Math.PI);
      context.fill();
      break;
  }
}

/**
 * Paint the strip: its edge, the band of rows on screen, then the marks, least important first,
 * so that HEAD ends up over everything else that shares its pixels.
 */
function paint(
  context: CanvasRenderingContext2D,
  marks: readonly StripMark[],
  band: { top: number; bottom: number },
  width: number,
  height: number,
  colours: Colours
) {
  context.clearRect(0, 0, width, height);
  context.globalAlpha = 1;
  context.fillStyle = colours.edge;
  context.fillRect(0, 0, 1, height);
  context.globalAlpha = colours.bandAlpha;
  context.fillStyle = colours.band;
  const top = Math.min(band.top, height - 2);
  context.fillRect(1, top, width - 1, Math.max(band.bottom - top, 2));
  for (const kind of MARKER_PRIORITY.toReversed()) {
    for (const mark of marks) {
      if (mark.kinds.includes(kind)) {
        drawMark(context, kind, Math.min(Math.max(mark.y, 1), height - 3), width, colours);
      }
    }
  }
  context.globalAlpha = 1;
}

/** The height of the root's sticky header, which `MainHeader` keeps on the root element. */
function pageHeader() {
  const value = Number.parseFloat(
    document.documentElement.style.getPropertyValue("--main-header-height")
  );
  return Number.isFinite(value) ? value : 0;
}

/** Where the table and the window are now, or `null` while the table has no body to measure. */
function measure(container: HTMLElement, rows: number) {
  const table = container.querySelector<HTMLTableElement>(":scope > table");
  const tbody = table?.tBodies.item(0);
  if (!table || !tbody) {
    return null;
  }
  const body = tbody.getBoundingClientRect();
  const heading = table.tHead?.getBoundingClientRect().height ?? TABLE_HEADER_HEIGHT;
  const viewTop = pageHeader() + heading;
  const viewBottom = window.innerHeight;
  const top = Math.max(viewTop, body.top);
  const bottom = Math.min(viewBottom, body.bottom);
  const height = Math.floor(bottom - top);
  // Hidden while every row fits below the headings at once: there is nothing to scroll to.
  const shown = rows > 0 && body.height > viewBottom - viewTop + 1 && height >= SHORTEST_STRIP;
  return { body, viewTop, viewBottom, top, bottom, height, shown };
}

type OverviewStripProps = {
  /** The table's container, which the strip sits in and gives room on its right. */
  containerRef: RefObject<HTMLDivElement>;
  markers: readonly OverviewMarker[];
  rows: number;
  /** The row whose details are open, or -1. */
  expandedRow: number;
};

/**
 * A narrow strip on the table's right edge that shows the whole loaded history at once: marks for
 * HEAD, branches and tags, the selection, the open details and unpushed commits,
 * and a band over the rows on screen. Clicking or dragging on it scrolls there. It is drawn on a
 * canvas, so tens of thousands of rows cost no more than a few hundred, and it is a pointer
 * convenience only: Go to and the arrow keys reach every row without it.
 */
export function OverviewStrip({ containerRef, markers, rows, expandedRow }: OverviewStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const body: BodyGeometry = {
    rows,
    rowHeight: rowHeight(),
    expandedRow,
    expansionHeight: COMMIT_DETAILS_HEIGHT
  };
  // Read by the listeners, which are added once.
  const latest = useRef({ markers, body });
  latest.current = { markers, body };
  const frame = useRef(0);
  const draw = useRef(() => {});
  const collapsed = useRef<{ key: unknown; height: number; marks: StripMark[] } | null>(null);

  draw.current = () => {
    frame.current = 0;
    const container = containerRef.current;
    const strip = stripRef.current;
    const canvas = canvasRef.current;
    if (!container || !strip || !canvas) {
      return;
    }
    const geometry = measure(container, latest.current.body.rows);
    const shown = geometry?.shown === true;
    strip.hidden = !shown;
    container.style.setProperty(GUTTER_PROPERTY, shown ? `${STRIP_WIDTH}px` : "0px");
    if (!geometry || !shown) {
      return;
    }
    const { height } = geometry;
    const scale = window.devicePixelRatio || 1;
    const width = STRIP_WIDTH;
    if (canvas.style.height !== `${height}px`) {
      canvas.style.height = `${height}px`;
    }
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    // Collapsing reads every marker, so it is redone only when the marks or the height change.
    const { markers: current, body: layout } = latest.current;
    if (collapsed.current?.key !== current || collapsed.current.height !== height) {
      collapsed.current = {
        key: current,
        height,
        marks: collapseMarkers(current, layout.rows, height)
      };
    }
    const band = visibleBand(
      geometry.top - geometry.body.top,
      geometry.bottom - geometry.body.top,
      layout,
      height
    );
    paint(context, collapsed.current.marks, band, width, height, readColours(strip));
  };

  // Drawn before the browser paints, so the strip never shows a frame with stale room or marks.
  useLayoutEffect(() => {
    cancelAnimationFrame(frame.current);
    draw.current();
  }, [markers, rows, expandedRow]);

  useLayoutEffect(() => {
    const schedule = () => {
      if (frame.current === 0) {
        frame.current = requestAnimationFrame(() => draw.current());
      }
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // The table grows as rows load and details open, and banners opening above it move it down
    // without any scrolling; either way the page's body changes size.
    const observer = new ResizeObserver(schedule);
    const container = containerRef.current;
    if (container) {
      observer.observe(container);
    }
    observer.observe(document.body);
    // A theme switch changes the body's class and the colour variables on the root element.
    const themes = new MutationObserver(schedule);
    themes.observe(document.documentElement, { attributeFilter: ["class", "style"] });
    themes.observe(document.body, { attributeFilter: ["class"] });
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      themes.disconnect();
      container?.style.removeProperty(GUTTER_PROPERTY);
    };
  }, [containerRef]);

  /** Scroll the window so the row under `clientY` sits in the middle of the rows on screen. */
  function scrollToPoint(clientY: number) {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const geometry = container ? measure(container, latest.current.body.rows) : null;
    if (!canvas || !geometry?.shown) {
      return;
    }
    const box = canvas.getBoundingClientRect();
    const page: PageGeometry = {
      bodyTop: geometry.body.top + window.scrollY,
      viewTop: geometry.viewTop,
      viewBottom: geometry.viewBottom,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight
    };
    const { scrollTop } = scrollForStripPoint(
      clientY - box.top,
      box.height,
      latest.current.body,
      page
    );
    window.scrollTo(0, scrollTop);
  }

  const kinds = markerKinds(markers);
  return (
    <div
      ref={stripRef}
      aria-hidden="true"
      data-overview-strip
      class="overview-strip absolute right-0 bottom-0"
      style={{ top: `var(--graph-top, ${TABLE_HEADER_HEIGHT}px)`, width: `${STRIP_WIDTH}px` }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-marker-kinds={kinds.join(" ")}
        data-marker-count={markers.length}
        class="sticky block w-full cursor-pointer touch-none"
        style={{
          top: `calc(var(--main-header-height, 0px) + var(--graph-top, ${TABLE_HEADER_HEIGHT}px))`
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          scrollToPoint(event.clientY);
          // Keeps a drag going past the strip's ends. A pointer the browser no longer tracks
          // cannot be captured, and the click has done its work already.
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {}
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            scrollToPoint(event.clientY);
          }
        }}
      />
      {(Object.keys(COLOUR_PROBES) as Array<keyof typeof COLOUR_PROBES>).map((name) => (
        <span key={name} hidden data-overview-colour={name} class={COLOUR_PROBES[name]} />
      ))}
    </div>
  );
}
