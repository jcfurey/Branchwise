import { signal } from "@preact/signals";

import type { WebviewConfig } from "@/types";

/**
 * The extension's settings, absent until the page is initialised. The object is the one the
 * extension sent, kept as it is: readers compare it by identity, and some tests edit it in place.
 */
const config = signal<WebviewConfig | undefined>(undefined);

/** Keep the settings the page starts with. They can only be given once. */
export function initializeWebviewConfig(value: WebviewConfig): void {
  // Peeked, so that a caller inside a render or effect does not come to depend on the settings.
  if (config.peek() !== undefined) {
    throw new Error("Webview configuration is already initialized");
  }
  config.value = value;
}

/**
 * Replace the settings after a change. A change that arrives before the page has its first
 * settings is dropped, and `false` says so.
 */
export function updateWebviewConfig(value: WebviewConfig): boolean {
  if (config.peek() === undefined) {
    return false;
  }
  config.value = value;
  return true;
}

/**
 * The current settings. A render, `computed` or effect that calls this runs again when they are
 * replaced, even one that called it too early and caught the error.
 */
export function getWebviewConfig(): WebviewConfig {
  const value = config.value;
  if (value === undefined) {
    throw new Error("Webview configuration is not initialized");
  }
  return value;
}
