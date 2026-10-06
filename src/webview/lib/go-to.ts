import { effect } from "@preact/signals";

import { revealCommit } from "@/webview/lib/jump-to-head";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { selectedRepo } from "@/webview/lib/stores";

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

/** Show the commit chosen in the picker, unless the user has moved to another repository. */
export function revealChoice(repo: string, hash: string) {
  if (repo === selectedRepo.peek()) {
    revealCommit(hash);
  }
}
