import { useEffect, useState } from "preact/hooks";

import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { detailsPosition, paneSizes } from "@/webview/lib/details-pane";
import {
  emptyFilter,
  focusHistory,
  focusedCommit,
  historyActive,
  pendingReveal,
  revealDetails,
  setHistoryFilter,
  showTab
} from "@/webview/lib/navigation";
import { onPageScroll, pageViewport } from "@/webview/lib/page-scroll";
import { commitHead, commitList, expandedCommit } from "@/webview/lib/stores";

/** The table row of a commit, while it is on the page. */
function rowOf(hash: string) {
  return document.querySelector<HTMLElement>(`main tr[data-commit-hash=${JSON.stringify(hash)}]`);
}

/**
 * Bring the checked-out commit into view and put the keyboard on it. A search gives way to the
 * graph first; a HEAD the graph has not loaded opens as the history at HEAD.
 */
export function jumpToHead() {
  const head = commitHead.peek();
  if (head === null) {
    return;
  }
  showTab("graph");
  if (historyActive.peek()) {
    setHistoryFilter(emptyFilter());
  }
  if (!(commitList.peek() ?? []).some((commit) => commit.hash === head)) {
    focusHistory(head);
    return;
  }
  focusedCommit.value = head;
  // The graph may only now be replacing the search results.
  requestAnimationFrame(() => {
    const row = rowOf(head);
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  });
}

/**
 * Bring the commit chosen in Go to into view, put the keyboard on it and select its row. A search
 * gives way to the graph first. A commit the graph has not loaded opens as the history at that
 * commit, whose first row it is; the table selects it once the rows arrive, and with `details`
 * opens its details too.
 */
export function revealCommit(hash: string, details = false) {
  showTab("graph");
  if (!(commitList.peek() ?? []).some((commit) => commit.hash === hash)) {
    focusHistory(hash);
  } else {
    if (historyActive.peek()) {
      setHistoryFilter(emptyFilter());
    }
    focusedCommit.value = hash;
  }
  pendingReveal.value = hash;
  revealDetails.value = details;
}

/**
 * Whether the checked-out commit's row is out of sight: behind the sticky header, past the bottom
 * of the window or behind docked details, or not among the rows shown. False while there is no
 * HEAD to jump to, and while the graph is still loading.
 */
export function useHeadOutOfSight() {
  const [hidden, setHidden] = useState(false);
  const head = commitHead.value;
  const rows = commitList.value;
  const searching = historyActive.value;
  // Opening, moving or resizing docked details changes how much of the graph shows.
  const position = detailsPosition();
  const open = expandedCommit.value !== null;
  const sizes = paneSizes.value;
  useEffect(() => {
    if (head === null || head === UNCOMMITTED_CHANGES) {
      setHidden(false);
      return;
    }
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const row = rowOf(head);
        if (row === null) {
          // Missing from search results or the loaded graph; still loading is not missing.
          setHidden(searching || rows !== undefined);
          return;
        }
        const box = row.getBoundingClientRect();
        const { top, bottom } = pageViewport();
        setHidden(box.bottom <= top || box.top >= bottom);
      });
    };
    check();
    const stopScroll = onPageScroll(check);
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(frame);
      stopScroll();
      window.removeEventListener("resize", check);
    };
  }, [head, rows, searching, position, open, sizes]);
  return hidden;
}
