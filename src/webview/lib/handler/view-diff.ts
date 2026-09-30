import type { ResponseViewDiff } from "@/types";
import { openErrorDialog } from "@/webview/lib/actions";

/** Report a diff that the extension could not open. An opened diff needs nothing here. */
export function handleViewDiff(msg: ResponseViewDiff): void {
  if (!msg.success) {
    openErrorDialog(window.l10n.unableToViewDiff);
  }
}
