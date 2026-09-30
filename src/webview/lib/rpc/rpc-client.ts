import type { RpcMethod, RpcMethodMap, RpcRequest } from "@/types";
import { initRpcHandler, type PendingRpcRequest } from "@/webview/lib/rpc/rpc-handler";
import { shellText } from "@/webview/lib/shell-text";
import { vscode } from "@/webview/lib/vscode";

/** How long the extension has to answer a request, the same for every method. */
const DEADLINE_MS = 30_000;

/**
 * The requests still waiting for an answer, by id. The handler settles and removes the entries it
 * receives answers for. This module adds them, and removes the ones that expire or fail to post.
 */
const waiting = new Map<string, PendingRpcRequest>();

let listening = false;

/**
 * Asks the extension to do something, and delivers its answer.
 *
 * Loading this module does nothing: it sits in an import cycle with the handler, and some tests
 * load it without a DOM. The handler is started by `init`, or by the first request.
 */
export const rpcClient = {
  /**
   * Start receiving the extension's answers and notifications. Once that has worked, later calls do
   * nothing. If it fails, the error is thrown and the next call tries again.
   */
  init(): void {
    listen();
  },

  /**
   * Send a request, and settle with the extension's answer or reject after the deadline. A message
   * that cannot be posted rejects the promise instead of throwing.
   */
  request<M extends RpcMethod>(
    method: M,
    params: RpcMethodMap[M]["params"]
  ): Promise<RpcMethodMap[M]["result"]> {
    // The executor runs before the constructor returns, so the caller can read the posted id, and
    // an answer that arrives while posting finds its entry.
    return new Promise((resolve, reject) => {
      try {
        // Without a listener, the answer would be lost and the request would time out.
        listen();
      } catch (error: unknown) {
        reject(asError(error));
        return;
      }

      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        waiting.delete(id);
        // Read now rather than when sent, so the text is whatever the shell carries at the time.
        reject(new Error(fillTemplate(shellText("rpcTimeout"), method)));
      }, DEADLINE_MS);
      waiting.set(id, {
        // The extension ships with the page, so its results are trusted to match the method.
        resolve: (result) => resolve(result as RpcMethodMap[M]["result"]),
        reject,
        timeout
      });

      const message = { kind: "rpc.request", id, method, params } as RpcRequest<M>;
      try {
        vscode.postMessage(message);
      } catch (error: unknown) {
        // A message that cannot be cloned, for example. The extension never saw it.
        waiting.delete(id);
        clearTimeout(timeout);
        reject(asError(error));
      }
    });
  }
};

function listen(): void {
  if (listening) {
    return;
  }

  initRpcHandler(waiting);
  // Only after the handler is in place, so that a failure is tried again.
  listening = true;
}

/** Put the method name at every `{0}`, as it is: a function replacement expands no `$` patterns. */
function fillTemplate(template: string, method: string): string {
  return template.replaceAll("{0}", () => method);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value });
}
