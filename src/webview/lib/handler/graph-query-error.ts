import type { ResponseMessage } from "@/types";
import { closeCommitDetails, openErrorDialog } from "@/webview/lib/actions";
import { acceptGraphResponse } from "@/webview/lib/graph-requests";
import { graphErrors } from "@/webview/lib/stores";

export function handleGraphQueryError(
  message: Extract<ResponseMessage, { command: "graphQueryError" }>
) {
  if (!acceptGraphResponse({ ...message, command: message.query })) {
    return;
  }
  if (message.query === "commitDetails") {
    closeCommitDetails();
    openErrorDialog(window.l10n.unableToLoadCommitDetails, message.message);
    return;
  }
  graphErrors.value = { ...graphErrors.value, [message.query]: message.message };
}
