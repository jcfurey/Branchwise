import { vi } from "vitest";

import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { GitRepo, RpcMethod, WebviewConfig } from "@/types";

import { vscodeApi } from "@tests/webview/setup";

export type Reply = { result: unknown } | { error: string };
/** What the fake extension does with a request: answer it, later, or never (`undefined`). */
export type Answer = Reply | Promise<Reply> | undefined;

/** Strings the page shows in English; the rest read as their key names. */
export const PAGE_STRINGS = new Proxy({} as LocalizedStrings, {
  get: (_target, key) =>
    ({
      unableToLoadRepositories: "Unable to load repositories: {0}",
      retry: "Retry"
    })[key as string] ?? String(key)
});

export const PAGE_CONFIG: WebviewConfig = {
  locale: "en",
  dateFormat: "Relative",
  dragAndDrop: true,
  graphStyle: "angular",
  graphColours: ["#0085d9"],
  initialLoadCommits: 123,
  issueLinks: [],
  loadMoreCommits: 50,
  autoCenterCommitDetailsView: false,
  commitDetailsPosition: "inline",
  conflictForecast: "localAndRemote",
  showCurrentBranchByDefault: false,
  singleKeyShortcuts: true
};

export const initialized = (): Reply => ({
  result: { l10n: PAGE_STRINGS, config: PAGE_CONFIG }
});

export const scanned = (...repos: GitRepo[]): Reply => ({ result: { repos } });

export function repo(path: string): GitRepo {
  return { name: path.slice(path.lastIndexOf("/") + 1), path };
}

/** The document the extension's HTML gives the page, and the browser APIs jsdom lacks. */
export function prepareShell() {
  document.body.innerHTML = '<div id="app"></div>';
  Object.assign(document.documentElement.dataset, {
    loading: "Loading…",
    initFailed: "Unable to open the graph: {0}",
    rpcTimeout: "The extension did not answer in time: {0}"
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = () => {};
}

function deliver(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

/** Answer the page's RPC requests the way `respond` says, a moment after each is posted. */
export function fakeExtension(respond: (method: RpcMethod) => Answer) {
  vscodeApi.postMessage.mockImplementation(
    (message: { kind?: string; id?: string; method?: RpcMethod }) => {
      if (message.kind !== "rpc.request") {
        return;
      }
      const answer = respond(message.method!);
      if (answer === undefined) {
        return;
      }
      void Promise.resolve(answer).then((reply) => {
        setTimeout(() => {
          deliver(
            "error" in reply
              ? { kind: "rpc.response", id: message.id, success: false, error: reply.error }
              : { kind: "rpc.response", id: message.id, success: true, result: reply.result }
          );
        }, 5);
      });
    }
  );
}

/** Send a notification from the extension. */
export function notify(name: string, message: unknown) {
  deliver({ kind: "rpc.notify", id: `note-${name}-${Date.now()}`, name, message });
}

/** Everything the page posted, as `rpc:<method>` or the legacy command. */
export function posted() {
  return vscodeApi.postMessage.mock.calls.map(([message]) => {
    const sent = message as { kind?: string; method?: string; command?: string };
    return sent.kind === "rpc.request" ? `rpc:${sent.method}` : sent.command;
  });
}

export function app() {
  return document.getElementById("app")!;
}

/** A request that stays unanswered until the test lets it go. */
export function deferred() {
  let release!: (reply: Reply) => void;
  const answer = new Promise<Reply>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}
