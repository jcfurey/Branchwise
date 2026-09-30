import type { GitRepo, RpcNotificationName, SidebarPane, WebviewConfig } from "@/types";
import { applyWebviewConfig, refresh, selectRepo } from "@/webview/lib/actions";
import { loadRepoList } from "@/webview/lib/load-repos";
import { showPane } from "@/webview/lib/navigation";
import { selectedRepo } from "@/webview/lib/stores";
import { repoListStore } from "@/webview/lib/stores/repo-list.store";

/** A request the webview has sent, waiting for the extension to answer it. */
export type PendingRpcRequest = {
  resolve: (result: unknown) => void;
  reject: (reason: unknown) => void;
  /** The client's deadline for the answer. The answer cancels it. */
  timeout: ReturnType<typeof setTimeout>;
};

type Fields = Record<string, unknown>;

const MALFORMED_RESPONSE = "Malformed response to an RPC request";

/** The panes a notification may open. Typed by `SidebarPane`, so a new pane must be added here. */
const panes: Record<SidebarPane, true> = { refs: true, workspace: true };

/**
 * One handler per notification. Each checks its own payload and ignores one it cannot use, as
 * unknown names are ignored. The handlers reach the imported actions only when a message arrives:
 * this module is part of an import cycle through the repository list store.
 */
const notifications: Record<RpcNotificationName, (message: unknown) => void> = {
  "view.showPane": (message) => {
    if (isFields(message) && isPane(message.pane)) {
      showPane(message.pane);
    }
  },
  "repo.select": (message) => {
    if (isRepo(message)) {
      // Offer the repository first, so that the picker can show the one being selected.
      repoListStore.add(message);
      selectRepo(message.path);
    }
  },
  "repo.rescan": () => {
    // Not awaited: the scan never rejects, and keeps its own error for the picker.
    void loadRepoList();
  },
  "config.changed": (message) => {
    // The extension sends its whole configuration. Beyond being an object, it is trusted.
    if (isFields(message)) {
      applyWebviewConfig(message as WebviewConfig);
    }
  },
  "repo.updated": (message) => {
    // The extension echoes the path the webview selected, so an exact match is enough.
    if (
      isFields(message) &&
      typeof message.path === "string" &&
      message.path === selectedRepo.value
    ) {
      refresh();
    }
  }
};

/**
 * Handle the extension's RPC messages for the rest of the page's life. An answer settles the
 * entry of `requests` with its id, and a notification is passed to the action it names. Other
 * messages, including the legacy ones with a `command`, are left to the dispatcher.
 *
 * Each message is handled completely before `dispatchEvent` returns. An exception from one
 * message leaves the listener in place for the next.
 */
export function initRpcHandler(requests: Map<string, PendingRpcRequest>): void {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!isFields(data) || typeof data.id !== "string") {
      return;
    }

    if (data.kind === "rpc.response") {
      settle(requests, data.id, data);
    } else if (data.kind === "rpc.notify" && typeof data.name === "string" && "message" in data) {
      notify(data.name, data.message);
    }
  });
}

/**
 * Settle the request that the response answers. A response for a request always settles it, even
 * when malformed, so the caller does not wait for the deadline to learn that it failed.
 */
function settle(requests: Map<string, PendingRpcRequest>, id: string, response: Fields): void {
  const request = requests.get(id);
  if (request === undefined) {
    // Never sent, already answered, or already timed out.
    return;
  }

  // Finish with the table first: a callback may send more messages, or throw.
  requests.delete(id);
  clearTimeout(request.timeout);

  if (response.success === true) {
    request.resolve(response.result);
  } else if (response.success === false && typeof response.error === "string") {
    request.reject(new Error(response.error));
  } else {
    request.reject(new Error(MALFORMED_RESPONSE));
  }
}

function notify(name: string, message: unknown): void {
  // The extension and the page may come from different builds, so an unknown name is no error.
  if (Object.hasOwn(notifications, name)) {
    notifications[name as RpcNotificationName](message);
  }
}

/** A plain object, as opposed to `null`, a primitive or an array. */
function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPane(value: unknown): value is SidebarPane {
  return typeof value === "string" && Object.hasOwn(panes, value);
}

function isRepo(value: unknown): value is GitRepo {
  return isFields(value) && typeof value.name === "string" && typeof value.path === "string";
}
