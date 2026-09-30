import { refresh } from "@/webview/lib/actions";

/**
 * Reload what is shown when the extension asks, for example when a hidden panel is shown again.
 * The message carries nothing else.
 */
export function handleRefresh(): void {
  refresh();
}
