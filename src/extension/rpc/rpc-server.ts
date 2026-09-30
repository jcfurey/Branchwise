import type * as vscode from "vscode";

import { rpcHandlers } from "@/extension/rpc/handlers";
import { logger } from "@/extension/util/logger";
import type { RpcMethod, RpcMethodMap, RpcResponse } from "@/types";

/** An RPC request as read off the channel; `method` may still name no handler. */
type IncomingRequest = { id: string; method: string; params: unknown };

type RpcResult = RpcMethodMap[RpcMethod]["result"];

const UNKNOWN_ERROR = "Unknown error";

/** A field of `message` that it holds itself, ignoring anything its prototype supplies. */
function ownField(message: object, key: string): unknown {
  return Object.hasOwn(message, key) ? (message as Record<string, unknown>)[key] : undefined;
}

/**
 * Read an RPC request from a webview message. Anything else on the channel, such as
 * notifications or legacy `{ command }` messages, yields undefined and must be left alone.
 */
function readRequest(message: unknown): IncomingRequest | undefined {
  if (typeof message !== "object" || message === null || !Object.hasOwn(message, "params")) {
    return undefined;
  }
  const id = ownField(message, "id");
  const method = ownField(message, "method");
  return ownField(message, "kind") === "rpc.request" &&
    typeof id === "string" &&
    typeof method === "string"
    ? { id, method, params: ownField(message, "params") }
    : undefined;
}

/**
 * The text the webview shows for a thrown value: its string `message` when it has one (this
 * covers errors from another realm too), otherwise the value converted to a string.
 */
function describeError(thrown: unknown): string {
  try {
    if (
      ((typeof thrown === "object" && thrown !== null) || typeof thrown === "function") &&
      "message" in thrown &&
      typeof thrown.message === "string"
    ) {
      return thrown.message;
    }
    return String(thrown);
  } catch {
    // For example an object whose `toString` throws; the request must still be answered.
    return UNKNOWN_ERROR;
  }
}

/** The handler for `method`. Only the table's own properties count, so `toString` is none. */
function findHandler(method: string) {
  const handlers: Readonly<Record<string, (params: unknown) => unknown>> = rpcHandlers;
  return Object.hasOwn(handlers, method) ? handlers[method] : undefined;
}

function resultResponse(id: string, result: unknown): RpcResponse {
  // The handler table ties each result to its method. JSON drops a key whose value is
  // undefined and the webview ignores a success without `result`, so undefined goes as null.
  return { kind: "rpc.response", id, success: true, result: (result ?? null) as RpcResult };
}

function errorResponse(id: string, error: string): RpcResponse {
  return { kind: "rpc.response", id, success: false, error };
}

/**
 * Serve the RPC requests a webview sends, answering each with one response from the
 * matching entry of `rpcHandlers`.
 */
export function createRpcServer() {
  return {
    /** Answer requests from `webview` until the returned disposable is disposed. */
    attach(webview: vscode.Webview): vscode.Disposable {
      let disposed = false;

      /** Post a response; a closed attachment drops it. Throws when delivery fails. */
      const post = async (method: string, response: RpcResponse) => {
        if (disposed) {
          logger.debug(`Drop RPC response: ${method} (${response.id}); the view is closed`);
          return;
        }
        await webview.postMessage(response);
        const outcome = response.success ? "success" : "failure";
        logger.debug(`Sent RPC response: ${method} (${response.id}), ${outcome}`);
      };

      /** Post a failure response, logging rather than throwing when it cannot be delivered. */
      const postFailure = async (method: string, id: string, error: string) => {
        try {
          await post(method, errorResponse(id, error));
        } catch (deliveryError) {
          logger.error(`Could not deliver the RPC failure for ${method} (${id})`, deliveryError);
        }
      };

      const answer = async ({ id, method, params }: IncomingRequest) => {
        logger.debug(`Receive RPC request: ${method} (${id})`);
        const handler = findHandler(method);
        if (handler === undefined) {
          logger.warn(`Refuse RPC request ${id}: unknown method ${method}`);
          await postFailure(method, id, `Unknown RPC method: ${method}`);
          return;
        }

        let result: unknown;
        try {
          result = await handler(params);
        } catch (thrown) {
          logger.error(`RPC method ${method} failed (${id})`, thrown);
          await postFailure(method, id, describeError(thrown));
          return;
        }

        try {
          await post(method, resultResponse(id, result));
        } catch (deliveryError) {
          // Typically a result JSON cannot carry. Say so rather than leave the webview waiting.
          logger.error(`Could not deliver the RPC result for ${method} (${id})`, deliveryError);
          await postFailure(method, id, describeError(deliveryError));
        }
      };

      const listener = webview.onDidReceiveMessage(async (message: unknown) => {
        const request = disposed ? undefined : readRequest(message);
        if (request !== undefined) {
          await answer(request);
        }
      });

      return {
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          listener.dispose();
        }
      };
    }
  };
}
