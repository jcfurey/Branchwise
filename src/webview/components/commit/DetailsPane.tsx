import type { TargetedKeyboardEvent } from "preact";
import { useEffect, useRef } from "preact/hooks";

import {
  CloseDetailsButton,
  CommitDetailsContent
} from "@/webview/components/commit/CommitDetails";
import { WorkingTreeChanges } from "@/webview/components/commit/WorkingTreeDetails";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { closeCommitDetails } from "@/webview/lib/actions";
import {
  type DockedPosition,
  PANE_DEFAULT,
  PANE_MAX,
  PANE_MIN,
  PANE_STEP,
  paneSizes,
  savePaneSizes,
  setPaneSize
} from "@/webview/lib/details-pane";
import { commitDetails, expandedCommit } from "@/webview/lib/stores";

const PANE_ID = "branchwise-details-pane";

/** The table row of a commit, while it is on the page. */
function rowOf(hash: string) {
  return document.querySelector<HTMLElement>(`tr[data-commit-hash=${JSON.stringify(hash)}]`);
}

/** Close the details, and hand the keyboard back to their commit's row without scrolling to it. */
function close() {
  const hash = expandedCommit.peek();
  closeCommitDetails();
  if (hash !== null) {
    rowOf(hash)?.focus({ preventScroll: true });
  }
}

/** Escape belongs to the details, not to whatever listens further up, such as a dialog. */
function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
}

/**
 * The bar between the graph and the pane. Dragging it, or the arrow keys while it has the
 * keyboard, resize the pane; Home and End make it as small or as large as it goes, and a double
 * click puts it back to its usual size. Its value is the pane's share of the window, in percent.
 */
function Splitter({ position }: { position: DockedPosition }) {
  const share = paneSizes.value[position];
  const across = position === "right";
  // Lets go of the window's listeners if the splitter goes while a drag is under way.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  function startDrag(event: MouseEvent) {
    if (event.button !== 0) {
      return;
    }
    // No text selection follows the pointer.
    event.preventDefault();
    const from = across ? event.clientX : event.clientY;
    const start = paneSizes.peek()[position];
    const onMove = (moved: MouseEvent) => {
      // The pane is at the far edge of the window, so moving towards it makes it smaller.
      const travelled = from - (across ? moved.clientX : moved.clientY);
      const extent = across ? window.innerWidth : window.innerHeight;
      if (extent > 0) {
        setPaneSize(position, start + travelled / extent, false);
      }
    };
    const stop = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("blur", onEnd);
      stopDrag.current = null;
    };
    const onEnd = () => {
      stop();
      savePaneSizes();
    };
    stopDrag.current?.();
    stopDrag.current = stop;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("blur", onEnd);
  }

  function onKeyDown(event: TargetedKeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = across
      ? { ArrowLeft: PANE_STEP, ArrowRight: -PANE_STEP }
      : { ArrowUp: PANE_STEP, ArrowDown: -PANE_STEP };
    const step = steps[event.key];
    let next: number | undefined;
    if (step !== undefined) {
      next = share + step;
    } else if (event.key === "Home") {
      next = PANE_MIN;
    } else if (event.key === "End") {
      next = PANE_MAX;
    }
    if (next !== undefined) {
      event.preventDefault();
      setPaneSize(position, next);
    } else {
      closeOnEscape(event);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation={across ? "vertical" : "horizontal"}
      aria-label={window.l10n.resizeDetailsPane}
      aria-controls={PANE_ID}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={Math.round(PANE_MIN * 100)}
      aria-valuemax={Math.round(PANE_MAX * 100)}
      tabIndex={0}
      data-details-splitter
      class={`shrink-0 bg-line-soft hover:bg-focus focus:bg-focus focus:outline-1 focus:outline-focus ${
        across ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
      }`}
      onMouseDown={startDrag}
      onKeyDown={onKeyDown}
      onDblClick={() => setPaneSize(position, PANE_DEFAULT)}
    />
  );
}

/**
 * The open commit's details, docked below or to the right of the graph with a splitter between
 * the two. Choosing another commit replaces what it shows; Escape or its close button closes it.
 */
export function DetailsPane({ position }: { position: DockedPosition }) {
  const hash = expandedCommit.value;
  // To a tenth of a percent, without the float noise of multiplying.
  const percent = Math.round(paneSizes.value[position] * 1000) / 10;
  const below = position === "bottom";

  // The commit's row may now be behind the pane, which takes room from the graph as it opens.
  useEffect(() => {
    if (hash !== null) {
      rowOf(hash)?.scrollIntoView({ block: "nearest" });
    }
  }, [hash, position]);

  if (hash === null) {
    return null;
  }
  return (
    <>
      <Splitter position={position} />
      <section
        id={PANE_ID}
        aria-label={window.l10n.detailsPane}
        data-details-pane={position}
        class="relative min-h-0 min-w-0 shrink-0 bg-editor text-ui leading-4.5 whitespace-normal"
        style={below ? { height: `${percent}vh` } : { width: `${percent}vw` }}
        onKeyDown={closeOnEscape}
      >
        {/* A new commit starts afresh, as it would in a new row. */}
        <div key={hash} class="h-full overflow-hidden bg-btn">
          {hash === UNCOMMITTED_CHANGES ? (
            <WorkingTreeChanges />
          ) : (
            <CommitDetailsContent details={commitDetails.value} stacked={!below} />
          )}
        </div>
        <CloseDetailsButton onClick={close} />
      </section>
    </>
  );
}
