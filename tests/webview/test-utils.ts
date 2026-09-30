import type { GraphQueryCommand, QueryRequest } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { WebviewConfig } from "@/types";
import { initDispatcher } from "@/webview/lib/dispatcher";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { initializeWebviewConfig } from "@/webview/lib/webview-config";

import { vscodeApi } from "@tests/webview/setup";

/**
 * The settings every page under test starts with. One object for the whole module graph, left
 * open to changes: some tests adjust a field of it in place through `getWebviewConfig()`.
 */
const settings: WebviewConfig = {
  autoCenterCommitDetailsView: true,
  dateFormat: "Date & Time",
  graphColours: [],
  graphStyle: "rounded",
  initialLoadCommits: 300,
  loadMoreCommits: 100,
  locale: "en",
  showCurrentBranchByDefault: false
};

/** Strings that read as their own keys, so that a test can find a text by the name it has. */
const keyNames = new Proxy(
  {},
  {
    get: (_target, key) => String(key)
  }
) as LocalizedStrings;

/**
 * The most recent graph query of kind `command` that the page posted, as the very object it
 * posted. Throws when the page has posted none since the mock's record was last cleared.
 */
export function latestGraphRequest<K extends GraphQueryCommand>(
  command: K
): Extract<QueryRequest, { command: K }> {
  const posted: Array<{ command?: unknown }> = vscodeApi.postMessage.mock.calls.map(
    (call) => call[0]
  );
  const matching = posted.filter((message) => message.command === command);
  const latest = matching.at(-1);
  if (latest === undefined) {
    throw new Error(`No ${command} request was sent`);
  }
  return latest as Extract<QueryRequest, { command: K }>;
}

/**
 * Prepare the page for a test: give it its settings and its strings and, when asked, start
 * handling the messages the extension sends. The settings can be given only once per module graph,
 * so a file calls this once, at its top level or in `beforeAll`.
 */
export function setupWebviewTest({
  dispatchMessages = false
}: { dispatchMessages?: boolean } = {}): void {
  initializeWebviewConfig(settings);
  Object.defineProperty(window, "l10n", {
    value: keyNames,
    configurable: true,
    enumerable: false,
    writable: false
  });
  if (dispatchMessages) {
    rpcClient.init();
    initDispatcher();
  }
}
