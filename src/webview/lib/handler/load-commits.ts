import { batch } from "@preact/signals";

import type { ResponseMessage } from "@/types";
import { closeCommitDetails } from "@/webview/lib/actions";
import { acceptGraphResponse } from "@/webview/lib/graph-requests";
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

type CommitsAnswer = Extract<ResponseMessage, { command: "loadCommits" }>;

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

  const { commits } = msg;
  const expanded = expandedCommit.value;
  batch(() => {
    commitList.value = commits;
    commitHead.value = msg.head;
    moreCommitsAvailable.value = msg.moreCommitsAvailable;
    uncommittedChanges.value = msg.uncommittedChanges;
    // Details stay open only while their row is still in the graph.
    if (expanded !== null && !commits.some((commit) => commit.hash === expanded)) {
      closeCommitDetails();
    }
  });
}
