import type { RepositoryQuery, SubjectedCommit } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { announce } from "@/webview/components/ui/Announcer";
import { openContentDialog } from "@/webview/lib/actions";
import { revealCommit } from "@/webview/lib/jump-to-head";
import { requestRepositoryQuery } from "@/webview/lib/repository-actions";
import { branchFocusTarget, displayedBranch, focusPaused, headBranch } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/**
 * The applied-commits query for the branch the user is looking at: the focused one, or the one
 * the graph is filtered to. `null` while the setting is off, while no branch is focused or
 * filtered, while the focus is paused, and for the checked-out branch, which has nothing to find.
 */
export function appliedCommitsQuery(): Extract<RepositoryQuery, { kind: "appliedCommits" }> | null {
  if (!getWebviewConfig().markAppliedCommits) {
    return null;
  }
  const focused = branchFocusTarget.value;
  if (focused !== undefined && focusPaused.value) {
    return null;
  }
  const branch = focused ?? displayedBranch();
  if (branch === "" || branch === headBranch.value) {
    return null;
  }
  return { kind: "appliedCommits", branch };
}

/** The checked-out branch's name, or `HEAD` while it is detached. */
function checkedOut() {
  return headBranch.value ?? "HEAD";
}

/**
 * "Already in main as 1a2b3c4d: Fix the parser", or "Already in main" when the commit of the
 * checked-out branch is not known.
 */
export function appliedTitle(equivalent: SubjectedCommit | null): string {
  const l10n = window.l10n;
  const branch = checkedOut();
  if (equivalent === null) {
    return l10n.appliedSomewhere.replace("{0}", () => branch);
  }
  // One pass, so that a `{1}` in the branch name or the subject is left as it is.
  const values = [branch, abbrevCommit(equivalent.hash), equivalent.subject];
  return l10n.appliedAs.replace(/\{([012])\}/g, (_, index: string) => values[Number(index)]!);
}

/**
 * Look for the commit of the checked-out branch that makes the same change as `hash`, behind the
 * loading dialog. One that is found is selected, and its name announced; otherwise a dialog says
 * why there is none. Nothing in the repository changes.
 */
export function findEquivalentCommit(hash: string): void {
  requestRepositoryQuery({ kind: "equivalentCommit", hash }, (data) => {
    if (data.kind !== "equivalentCommit") {
      return;
    }
    const l10n = window.l10n;
    const branch = checkedOut();
    const short = abbrevCommit(hash);
    if (data.equivalent !== null) {
      announce(appliedTitle(data.equivalent));
      revealCommit(data.equivalent.hash);
      return;
    }
    let message: string;
    if (data.onHead) {
      message = l10n.equivalentOnBranch;
    } else if (data.truncated) {
      message = l10n.equivalentNotFoundLimited;
    } else {
      message = l10n.equivalentNotFound;
    }
    const values = [short, branch];
    openContentDialog(
      l10n.findEquivalentCommit,
      message.replace(/\{([01])\}/g, (_, index: string) => values[Number(index)]!)
    );
  });
}
