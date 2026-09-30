import { vi } from "vitest";

import type { HistoryEntry } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { WebviewConfig } from "@/types";
import { getWebviewConfig, updateWebviewConfig } from "@/webview/lib/webview-config";

/** A history row whose subject names it, dated at the epoch unless `more` says otherwise. */
export function entry(
  hash: string,
  parentHashes: Array<string> = [],
  more: Partial<HistoryEntry> = {}
): HistoryEntry {
  return {
    hash,
    parentHashes,
    author: "Tester",
    email: "tester@example.test",
    date: 0,
    message: `subject of ${hash}`,
    refs: [],
    ...more
  };
}

/** Install webview strings: `overrides` where given, and each other key reading as its name. */
export function speak(overrides: Record<string, string> = {}) {
  const strings = new Proxy(
    {},
    { get: (_target, key) => overrides[String(key)] ?? String(key) }
  ) as LocalizedStrings;
  Object.defineProperty(window, "l10n", { value: strings, configurable: true });
}

/** Change some settings for one test; the returned function puts the previous ones back. */
export function reconfigure(changes: Partial<WebviewConfig>) {
  const before = getWebviewConfig();
  updateWebviewConfig({ ...before, ...changes });
  return () => {
    updateWebviewConfig(before);
  };
}

const ignore = () => {};

/** jsdom has no ResizeObserver. The graph scroll hook only needs one that never reports. */
class QuietObserver {
  observe = ignore;
  unobserve = ignore;
  disconnect = ignore;
}

export function stubResizeObserver() {
  vi.stubGlobal("ResizeObserver", QuietObserver);
}

/** A host element in the document, so that focus and `closest` behave as in the webview. */
export function attachHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

/** Collapse the narrow and non-breaking spaces some ICU versions put into formatted dates. */
export function plainText(text: string | null | undefined) {
  return (text ?? "").replaceAll(/\s/gu, " ");
}
