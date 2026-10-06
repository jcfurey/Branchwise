import { openErrorDialog } from "@/webview/lib/actions";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";

/**
 * Have the extension open `url` in the browser. Only a failed request is reported: the user may
 * decline a site in VS Code's own prompt, which needs no message here. Never rejects.
 */
export async function openUrl(url: string): Promise<void> {
  try {
    await rpcClient.request("url.open", url);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    openErrorDialog(
      window.l10n.unableToOpenUrl.replaceAll("{0}", () => url),
      reason
    );
  }
}
