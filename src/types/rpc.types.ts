import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";

import type { WebviewConfig } from "./config";
import type { GitRepo, RepoUpdate } from "./git.types";

// The request-and-answer protocol between the page and the extension. It shares the webview's
// message channel with the older `{ command }` messages of `legacy.ts`, and each side ignores the
// other family. Nothing checks these shapes at run time; the types keep both ends in step.

/** The answer to `webview.initialize`: the page's strings and its first display settings. */
export type WebviewInitialize = { l10n: LocalizedStrings; config: WebviewConfig };

/** The answer to `repo.scan`: the workspace's repositories, sorted by path. */
export type ScanRepoResult = { repos: GitRepo[] };

/**
 * Every method the page may call, with what it sends and what a successful answer holds. A
 * method that needs no input takes `null`, which must be sent: the extension ignores a request
 * without a `params` key. Failures never arrive as a result, but as a failure response.
 */
export type RpcMethodMap = {
  /** Put the text on the clipboard; `false` when VS Code refused it. */
  "clipboard.copy": { params: string; result: boolean };
  "webview.initialize": { params: null; result: WebviewInitialize };
  /** Run VS Code's own `git.init`; `true` once it finishes, even when the user cancelled. */
  "git.init": { params: null; result: boolean };
  /** Run VS Code's own `git.clone`; `true` once it finishes, even when the user cancelled. */
  "git.clone": { params: null; result: boolean };
  /**
   * Ask for a folder and open it in this window. Opening one reloads the window, so only a
   * cancelled choice is answered, with `true`.
   */
  "folder.open": { params: null; result: boolean };
  "repo.scan": { params: null; result: ScanRepoResult };
  /** Open the Settings editor on this extension's settings. */
  "settings.open": { params: null; result: boolean };
  "docs.open": { params: null; result: boolean };
  "walkthrough.open": { params: null; result: boolean };
  /**
   * Show the Go to picker for the repository; `true` once it is open. The choice arrives later as
   * `view.reveal`, as the user may take longer than a request may wait.
   */
  "goTo.show": { params: { repo: string }; result: boolean };
  /** Open an `http` or `https` address in the browser; `false` when it was not opened. */
  "url.open": { params: string; result: boolean };
};

export type RpcMethod = keyof RpcMethodMap;

/** The side panes a notification may open. */
export type SidebarPane = "refs" | "workspace";

/** Every notification the extension may send the page unasked, with its payload. */
export type RpcNotificationMap = {
  /** Open this pane, once the page is ready for it. */
  "view.showPane": { pane: SidebarPane };
  /** Ask the extension to show the Go to picker for the selected repository. */
  "view.goTo": null;
  /** Show this commit of this repository, chosen in the Go to picker. */
  "view.reveal": { repo: string; hash: string };
  /** Offer this repository in the picker and select it. */
  "repo.select": GitRepo;
  /** Repositories may have appeared or gone: list them again. */
  "repo.rescan": null;
  /** Some `branchwise.*` setting changed. The payload is the whole new configuration. */
  "config.changed": WebviewConfig;
  "repo.updated": RepoUpdate;
};

export type RpcNotificationName = keyof RpcNotificationMap;

// The two envelopes below are conditional on a bare type parameter, so they spread over a union
// of names. That also lets a message built for a generic name count as one of the full union.

/**
 * A notification as posted. `id` is unique within the extension's session and is otherwise
 * unused. The `message` key must be present, so a missing payload travels as `null`. Given a union
 * of names, this is the union of their notifications.
 */
export type RpcNotification<N extends RpcNotificationName = RpcNotificationName> =
  N extends RpcNotificationName
    ? { kind: "rpc.notify"; id: string; name: N; message: RpcNotificationMap[N] }
    : never;

/**
 * A call from the page. `id` is chosen by the page, unique per request, and comes back in the
 * response. Given a union of methods, this is the union of their requests, so checking `method`
 * narrows `params`.
 */
export type RpcRequest<M extends RpcMethod = RpcMethod> = M extends RpcMethod
  ? { kind: "rpc.request"; id: string; method: M; params: RpcMethodMap[M]["params"] }
  : never;

/**
 * The one answer to a request, repeating its `id`. A failure carries the error's text. Unlike the
 * request, this is not split by method: for several methods, `result` may be any of their results.
 */
export type RpcResponse<M extends RpcMethod = RpcMethod> =
  | { kind: "rpc.response"; id: string; success: true; result: RpcMethodMap[M]["result"] }
  | { kind: "rpc.response"; id: string; success: false; error: string };
