import { effect, untracked } from "@preact/signals";

import { revealCommit } from "@/webview/lib/jump-to-head";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { commitList, graphErrors, selectedRepo } from "@/webview/lib/stores";

/** Stops waiting for a repository to open the picker for. */
let stopWaiting: (() => void) | undefined;

/**
 * Ask the extension for the Go to picker of the selected repository. A page that has just
 * opened has none yet, so the request waits for the first one; asking again replaces it.
 */
export function openGoTo() {
  stopWaiting?.();
  let asked = false;
  const stop = effect(() => {
    const repo = selectedRepo.value;
    if (asked || repo === undefined) {
      return;
    }
    asked = true;
    // The first run happens before `effect` returns, so the watch ends a little later.
    queueMicrotask(() => stop());
    stopWaiting = undefined;
    void rpcClient.request("goTo.show", { repo });
  });
  if (!asked) {
    stopWaiting = stop;
  }
}

/** Stops waiting for the graph's rows to reveal a commit in. */
let stopRevealing: (() => void) | undefined;

/**
 * Show a commit chosen in the picker or from an editor line, with its details when `details`
 * says so, unless the user has moved to another repository. A repository the page has only just
 * selected has no rows yet; they may well hold the commit, so the reveal waits for them rather
 * than opening the history at the commit. A failed load stops the wait.
 */
export function revealChoice(repo: string, hash: string, details = false) {
  stopRevealing?.();
  stopRevealing = undefined;
  let done = false;
  const stop = effect(() => {
    if (done) {
      return;
    }
    const waiting = commitList.value === undefined && graphErrors.value.loadCommits === undefined;
    if (selectedRepo.value === repo && waiting) {
      return;
    }
    done = true;
    // The first run happens before `effect` returns, so the watch ends a little later.
    queueMicrotask(() => stop());
    stopRevealing = undefined;
    if (selectedRepo.peek() === repo) {
      untracked(() => revealCommit(hash, details));
    }
  });
  if (!done) {
    stopRevealing = stop;
  }
}
