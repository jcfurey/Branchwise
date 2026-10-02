import { openErrorDialog } from "@/webview/lib/actions";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";

/**
 * Have the extension put `data` on the clipboard. `type` names what is copied in the message
 * shown when that fails, together with the reason when the request itself failed. The promise
 * settles once the attempt is over, with whether the text was copied, and never rejects.
 */
export async function copyToClipboard(type: string, data: string): Promise<boolean> {
  let reason: string | null = null;
  try {
    // A falsy result is the clipboard refusing the text, which has no reason to give.
    if (await rpcClient.request("clipboard.copy", data)) {
      return true;
    }
  } catch (error: unknown) {
    reason = error instanceof Error ? error.message : String(error);
  }
  // Every placeholder gets the type as it is: a function replacement expands no `$` patterns.
  const title = window.l10n.unableToCopyToClipboard.replaceAll("{0}", () => type);
  openErrorDialog(title, reason);
  return false;
}
