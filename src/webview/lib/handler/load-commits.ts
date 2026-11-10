import { batch } from "@preact/signals";

import type { GitCommitNode } from "@/backend/types";
import type { ResponseMessage } from "@/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { closeCommitDetails } from "@/webview/lib/actions";
import { acceptGraphResponse } from "@/webview/lib/graph-requests";
import { historyActive } from "@/webview/lib/navigation";
import {
  commitHead,
  commitList,
  displayedBranch,
  expandedCommit,
  moreCommitsAvailable,
  selectedRepo,
  uncommittedChanges
} from "@/webview/lib/stores";
import { graphVisibilityKey } from "@/webview/lib/stores/hidden-branches.store";
import { reuseRows, sameData } from "@/webview/utils/sameData";

type CommitsAnswer = Extract<ResponseMessage, { command: "loadCommits" }>;

/**
 * Whether a reload brought the row already shown. The row of uncommitted changes is dated with
 * the moment it was read, which nothing shows, so its date does not make it another row.
 */
function sameRow(a: GitCommitNode, b: GitCommitNode) {
  return a.hash === UNCOMMITTED_CHANGES
    ? sameData({ ...a, date: 0 }, { ...b, date: 0 })
    : sameData(a, b);
}

/** Take a page of graph rows for the branch on display in the selected repository. */
export function handleLoadCommits(msg: CommitsAnswer): void {
  // Rows for another repository, branch, remote choice or hidden-branch choice are refused before
  // they can use up the pending request. An answer that does not echo a key is not checked
  // against it.
  const staleKey = msg.visibilityKey !== undefined && msg.visibilityKey !== graphVisibilityKey();
  if (
    msg.repo !== selectedRepo.value ||
    msg.branchName !== displayedBranch() ||
    staleKey ||
    !acceptGraphResponse(msg)
  ) {
    return;
  }

  // A refresh mostly brings the rows already shown, as after a file was saved: keeping those
  // very objects, and the list itself when nothing changed, leaves the table as it is.
  const commits = reuseRows(commitList.peek(), msg.commits, sameRow);
  const expanded = expandedCommit.value;
  batch(() => {
    commitList.value = commits;
    commitHead.value = msg.head;
    moreCommitsAvailable.value = msg.moreCommitsAvailable;
    uncommittedChanges.value = msg.uncommittedChanges;
    // Details stay open only while their row is still in the graph. Search results are other
    // rows, which the view itself checks against what it shows.
    if (
      expanded !== null &&
      !historyActive.peek() &&
      !commits.some((commit) => commit.hash === expanded)
    ) {
      closeCommitDetails();
    }
  });
}
