import { batch } from "@preact/signals";

import type { ResponseMessage } from "@/types";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import { selectBranch } from "@/webview/lib/actions";
import { acceptGraphResponse } from "@/webview/lib/graph-requests";
import { savedFocusBranch } from "@/webview/lib/navigation";
import {
  branchDisplay,
  branchList,
  headBranch,
  remoteVisibilityKey,
  selectedBranch,
  selectedRepo
} from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import type { CommitBranchType } from "@/webview/types";

type BranchesAnswer = Extract<ResponseMessage, { command: "loadBranches" }>;

/**
 * Take the branch list of the selected repository, and choose another branch when the one chosen
 * is not in it (or none is chosen yet).
 */
export function handleLoadBranches(msg: BranchesAnswer): void {
  // An answer for another repository or remote choice is refused before it can use up the
  // pending request. An answer that does not echo a key is not checked against it.
  const staleKey = msg.visibilityKey !== undefined && msg.visibilityKey !== remoteVisibilityKey();
  if (msg.repo !== selectedRepo.value || staleKey || !acceptGraphResponse(msg)) {
    return;
  }

  const { branches, head } = msg;
  batch(() => {
    branchList.value = branches;
    headBranch.value = head;
  });

  const current = selectedBranch.value;
  if (current === SHOW_ALL_BRANCHES || (current !== undefined && branches.includes(current))) {
    return;
  }
  selectBranch(replacementBranch(msg.repo, current, branches, head));
}

/** What to show in place of `current`, which is not among `branches`. */
function replacementBranch(
  repo: string,
  current: string | undefined,
  branches: Array<string>,
  head: string | null
): CommitBranchType {
  const headOrAll = head ?? SHOW_ALL_BRANCHES;
  if (branchDisplay.value === "filter") {
    return getWebviewConfig().showCurrentBranchByDefault ? headOrAll : SHOW_ALL_BRANCHES;
  }
  // Just after a switch, a focus mode returns to the target saved for this repository if it is
  // still there. A target that disappeared while in view gives way to HEAD instead.
  if (current === undefined) {
    const saved = savedFocusBranch(repo);
    if (saved === SHOW_ALL_BRANCHES || (saved !== undefined && branches.includes(saved))) {
      return saved;
    }
  }
  return headOrAll;
}
