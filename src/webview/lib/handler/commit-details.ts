import type { ResponseMessage } from "@/types";
import { closeCommitDetails, openErrorDialog } from "@/webview/lib/actions";
import { acceptGraphResponse } from "@/webview/lib/graph-requests";
import { commitDetails } from "@/webview/lib/stores";

type DetailsAnswer = Extract<ResponseMessage, { command: "commitDetails" }>;

/**
 * Take the details of the open row, or report that they could not be read. Only the answer to
 * the latest request counts; opening another row or closing the details makes a new one or none,
 * so an accepted answer belongs to the open row.
 */
export function handleCommitDetails(msg: DetailsAnswer): void {
  if (!acceptGraphResponse(msg)) {
    return;
  }
  if (msg.commitDetails === null) {
    closeCommitDetails();
    openErrorDialog(window.l10n.unableToLoadCommitDetails);
    return;
  }
  commitDetails.value = msg.commitDetails;
}
