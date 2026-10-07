import type { ActionResponse } from "@/backend/types";
import type { ResponseMessage } from "@/types";
import { openFileHistory, openLineHistory } from "@/webview/components/history/HistoryTools";
import { receiveRepoState, selectRepo } from "@/webview/lib/actions";
import { handleActionResult } from "@/webview/lib/handler/action-result";
import { handleCommitDetails } from "@/webview/lib/handler/commit-details";
import { handleGraphQueryError } from "@/webview/lib/handler/graph-query-error";
import { handleLoadBranches } from "@/webview/lib/handler/load-branches";
import { handleLoadCommits } from "@/webview/lib/handler/load-commits";
import { handleRefresh } from "@/webview/lib/handler/refresh";
import { handleViewDiff } from "@/webview/lib/handler/view-diff";
import { handleLoadRemotes } from "@/webview/lib/remote-actions";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";

type Command = ResponseMessage["command"];
type Routes = { [C in Command]: (message: Extract<ResponseMessage, { command: C }>) => void };

const actionResult = (message: ActionResponse) => handleActionResult(message);

/**
 * Where each command goes. Keyed by every command of `ResponseMessage`, so a new command does not
 * compile without a route. The targets are looked up when a message arrives, not while loading.
 */
const routes: Routes = {
  repoState: (message) => receiveRepoState(message),
  graphQueryError: (message) => handleGraphQueryError(message),
  fileHistory: (message) => {
    // Switching restores the repository's own saved search, so it must come before this one.
    selectRepo(message.repo);
    if (message.lines === undefined) {
      openFileHistory(message.path);
    } else {
      const { start, end } = message.lines;
      openLineHistory(message.path, start, end, message.revision);
    }
  },
  repositoryAction: actionResult,
  addTag: actionResult,
  checkoutBranch: actionResult,
  checkoutCommit: actionResult,
  cherrypickCommit: actionResult,
  createBranch: actionResult,
  deleteBranch: actionResult,
  deleteTag: actionResult,
  mergeBranch: actionResult,
  mergeCommit: actionResult,
  pushTag: actionResult,
  pushBranch: actionResult,
  pullBranch: actionResult,
  fetchRemote: actionResult,
  renameBranch: actionResult,
  resetToCommit: actionResult,
  revertCommit: actionResult,
  repositoryQuery: (message) => handleRepositoryQuery(message),
  loadRemotes: (message) => handleLoadRemotes(message),
  commitDetails: (message) => handleCommitDetails(message),
  loadBranches: (message) => handleLoadBranches(message),
  loadCommits: (message) => handleLoadCommits(message),
  refresh: () => handleRefresh(),
  viewDiff: (message) => handleViewDiff(message)
};

let listening = false;

/** Only the commands listed above, not names that every object inherits, such as `toString`. */
function isRouted(command: string): command is Command {
  return Object.hasOwn(routes, command);
}

/**
 * Pass each command message from the extension to its handler, for the rest of the page's life.
 * Messages without a string `command`, such as RPC traffic, are left to their own listener.
 * Later calls do nothing, so a message is never handled twice.
 *
 * A message is handled completely before `dispatchEvent` returns. An exception from a handler is
 * not caught here; the listener stays for the next message.
 */
export function initDispatcher(): void {
  if (listening) {
    return;
  }
  listening = true;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null || !("command" in data)) {
      return;
    }
    const { command } = data;
    if (typeof command !== "string") {
      return;
    }
    if (!isRouted(command)) {
      // eslint-disable-next-line no-console
      console.warn("no handler for", command);
      return;
    }
    // The route and the message agree on the command, which TypeScript cannot follow here.
    const route = routes[command] as (message: ResponseMessage) => void;
    route(data as ResponseMessage);
  });
}
