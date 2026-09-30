import type { Webview } from "vscode";

import { logger } from "@/extension/util/logger";
import type { RequestMessage, ResponseMessage } from "@/types";

type Command = RequestMessage["command"];

/** What the page sends for `command`, narrowed to that one message shape. */
type Handler<T extends Command> = (
  msg: Extract<RequestMessage, { command: T }>
) => void | Promise<void>;

/** The page connection that the `{ command }` handlers talk through. */
export type WebviewBridge = {
  /** Stop listening to the page. Handlers stay registered, and `post` still forwards. */
  dispose: () => void;
  /** Hand `msg` to the page, with VS Code's answer passed back untouched. */
  post: (msg: ResponseMessage) => Thenable<boolean>;
  /** Make `handler` the one handler of `command`, replacing an earlier one. */
  onMessage: <T extends Command>(command: T, handler: Handler<T>) => void;
};

/** The `command` of a page message, or undefined for anything else, such as RPC traffic. */
function commandOf(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const { command } = message as { command?: unknown };
  return typeof command === "string" ? command : undefined;
}

function reportFailure(command: string, error: unknown) {
  logger.warn(`The handler of the ${command} message failed`, error);
}

/**
 * Route the messages of `webview` to one handler per command. A handler runs within the call
 * that delivers its message. Its failure is logged, never passed on: VS Code ignores what event
 * listeners return, so a rejection would only surface as an unhandled one.
 */
export function webviewBridgeFactory(webview: Webview): WebviewBridge {
  // A Map, so that names such as `toString` never find something inherited.
  const handlers = new Map<string, (msg: RequestMessage) => void | Promise<void>>();

  const subscription = webview.onDidReceiveMessage((message: unknown): Promise<void> => {
    const command = commandOf(message);
    const handler = command === undefined ? undefined : handlers.get(command);
    if (command === undefined || handler === undefined) {
      return Promise.resolve();
    }
    try {
      return Promise.resolve(handler(message as RequestMessage)).then(
        () => undefined,
        (error: unknown) => reportFailure(command, error)
      );
    } catch (error) {
      reportFailure(command, error);
      return Promise.resolve();
    }
  });

  return {
    dispose: () => subscription.dispose(),
    post: (msg) => webview.postMessage(msg),
    onMessage: (command, handler) => {
      handlers.set(command, handler as (msg: RequestMessage) => void | Promise<void>);
    }
  };
}
