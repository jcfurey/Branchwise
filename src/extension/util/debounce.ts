import type { Uri } from "vscode";

import { logger } from "@/extension/util/logger";

export type FsWatcherEvent = "created" | "deleted";

const QUIET_MS = 100;

/** Log a failed callback: nothing else would see it, because the timer that ran it returned. */
function reportFailure(reason: unknown) {
  logger.error("Unable to process repository change", reason);
}

/**
 * Hold back work per event kind and resource until that pair has had no new event for 100 ms,
 * then run the callback of the latest call once. Resources are the same when their URIs print
 * the same. Disposing cancels what is waiting; the debouncer still accepts calls afterwards.
 */
export function createDebouncer(): {
  debounce(
    type: FsWatcherEvent,
    uri: Uri,
    callback: (type: FsWatcherEvent, uri: Uri) => Promise<void>
  ): void;
  dispose(): void;
} {
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    debounce(type, uri, callback) {
      const key = `${type} ${uri.toString()}`;
      clearTimeout(waiting.get(key));
      waiting.set(
        key,
        setTimeout(() => {
          waiting.delete(key);
          try {
            // A callback that returns no promise has nothing left to fail.
            void Promise.resolve(callback(type, uri)).catch(reportFailure);
          } catch (error) {
            reportFailure(error);
          }
        }, QUIET_MS)
      );
    },
    dispose() {
      for (const timer of waiting.values()) {
        clearTimeout(timer);
      }
      waiting.clear();
    }
  };
}
