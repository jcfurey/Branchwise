import { useEffect, useState } from "preact/hooks";

import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import {
  emptyFilter,
  focusHistory,
  focusedCommit,
  historyActive,
  pendingReveal,
  setHistoryFilter,
  showTab
} from "@/webview/lib/navigation";
import { commitHead, commitList } from "@/webview/lib/stores";

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
 * commit, whose first row it is; the table selects it once the rows arrive.
 */
export function revealCommit(hash: string) {
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
}

/**
 * Whether the checked-out commit's row is out of sight: behind the sticky header, past the bottom
 * of the window, or not among the rows shown. False while there is no HEAD to jump to, and while
 * the graph is still loading.
 */
export function useHeadOutOfSight() {
  const [hidden, setHidden] = useState(false);
  const head = commitHead.value;
  const rows = commitList.value;
  const searching = historyActive.value;
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
        const top = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--main-header-height")
        );
        setHidden(box.bottom <= (Number.isNaN(top) ? 0 : top) || box.top >= window.innerHeight);
      });
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [head, rows, searching]);
  return hidden;
}
