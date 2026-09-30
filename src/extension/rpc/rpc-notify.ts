import type * as vscode from "vscode";

import { logger } from "@/extension/util/logger";
import type { RpcNotification, RpcNotificationMap, RpcNotificationName } from "@/types";

/** The graph webview that receives notifications, if one is open. */
let target: vscode.Webview | undefined;
/** Counts attachments, so a handle can tell whether its attachment is still the current one. */
let attachments = 0;
/** Counts notifications, which gives each one an id that no other in this session shares. */
let notifications = 0;

/**
 * Send notifications to `webview` in place of any webview attached before. Disposing the result
 * detaches it again, unless a later call has attached a webview since.
 */
export function initRpcNotify(webview: vscode.Webview): vscode.Disposable {
  const attachment = ++attachments;
  target = webview;
  return {
    dispose() {
      if (attachments === attachment) {
        target = undefined;
      }
    }
  };
}

/**
 * One-way messages to the graph webview. Callers fire and forget: a notification sent while no
 * webview is attached is dropped, and a failed post is logged rather than rejected.
 */
export const rpcNotify = {
  async notify<N extends RpcNotificationName>(
    name: N,
    message: RpcNotificationMap[N]
  ): Promise<void> {
    const webview = target;
    if (webview === undefined) {
      logger.debug(`Dropped the ${name} notification: no graph view is attached`);
      return;
    }

    // The webview only accepts a notification that carries the message key, which JSON drops
    // when its value is undefined.
    const notification = {
      kind: "rpc.notify",
      id: `notify-${++notifications}`,
      name,
      message: message ?? null
    } as RpcNotification<N>;
    logger.debug(`Posting the ${name} notification (${notification.id})`);
    try {
      // The post starts before the first await, so notifications keep the order of the calls.
      if ((await webview.postMessage(notification)) === false) {
        logger.debug(`The ${name} notification (${notification.id}) found no live graph view`);
      }
    } catch (error) {
      logger.error(`Unable to post the ${name} notification (${notification.id})`, error);
    }
  }
};
