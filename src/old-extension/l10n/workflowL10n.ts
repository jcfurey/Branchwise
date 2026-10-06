import * as vscode from "vscode";

export function getWorkflowLocalizedStrings() {
  return {
    submoduleChanges: vscode.l10n.t("Compare Submodule Revisions"),
    stagePointer: vscode.l10n.t("Stage Submodule Pointer"),
    unstagePointer: vscode.l10n.t("Unstage Submodule Pointer"),
    pointerHint: vscode.l10n.t(
      "Only this parent gitlink is staged or unstaged. Child files and .gitmodules keep their current staging."
    ),
    childCheckout: vscode.l10n.t("Child checkout"),
    parentCommitLabel: vscode.l10n.t("Parent commit"),
    parentIndexLabel: vscode.l10n.t("Parent index"),
    parentCheckout: vscode.l10n.t("Open Parent Graph"),
    childGraph: vscode.l10n.t("Open Child Graph"),
    stagedPointer: vscode.l10n.t("Compare staged pointer"),
    newPointer: vscode.l10n.t("This is a newly added submodule pointer."),
    removedCommits: vscode.l10n.t("Removed Commits"),
    addedCommits: vscode.l10n.t("Added Commits"),
    syncPreview: vscode.l10n.t("Review Synchronization"),
    previewPush: vscode.l10n.t("Preview Push"),
    previewPull: vscode.l10n.t("Fetch & Preview Pull"),
    fetchPreview: vscode.l10n.t("Fetch & Refresh Preview"),
    fetchedTipHint: vscode.l10n.t(
      "Remote commits reflect the last fetch. Refresh the preview to check for newer commits."
    ),
    incomingCommits: vscode.l10n.t("Incoming Commits"),
    outgoingCommits: vscode.l10n.t("Outgoing Commits"),
    showBranchHistory: vscode.l10n.t("Show Branch History in Graph"),
    noRemoteBranch: vscode.l10n.t(
      "No fetched remote branch. A push creates it if it does not exist."
    ),
    cannotFastForward: vscode.l10n.t(
      "A fast-forward update is unavailable. Inspect the incoming and outgoing commits."
    ),
    fastForward: vscode.l10n.t("Apply Reviewed Fast-forward"),
    workspaceSync: vscode.l10n.t("Workspace Fetch & Update"),
    fetchSelected: vscode.l10n.t("Fetch Selected Repositories"),
    fetchAllRepos: vscode.l10n.t("Fetch All Repositories"),
    selectAllRepos: vscode.l10n.t("Select all available repositories"),
    workspaceSyncHint: vscode.l10n.t(
      "Fetch runs independently for each selected repository. Review its upstream commits before updating its current branch."
    ),
    queued: vscode.l10n.t("Queued"),
    bulkFetch: vscode.l10n.t("Fetch All"),
    bulkPull: vscode.l10n.t("Pull All"),
    bulkPush: vscode.l10n.t("Push All"),
    bulkActions: vscode.l10n.t("Actions on the listed repositories"),
    bulkFetchHint: vscode.l10n.t(
      "Fetches every remote of each listed repository. No branch, work tree or index changes."
    ),
    bulkPullHint: vscode.l10n.t(
      "Fast-forwards the checked-out branch of each listed repository to its fetched upstream. Anything that cannot simply move forward is skipped; nothing is merged or forced."
    ),
    bulkPushHint: vscode.l10n.t(
      "Pushes each branch that is ahead of its upstream branch. Branches without an upstream, or with commits to pull first, are skipped; nothing is forced."
    ),
    bulkFetchStep: vscode.l10n.t("Fetch every remote"),
    bulkPushStep: vscode.l10n.t("{0} → {1}, {2} commits"),
    bulkSkipBranch: vscode.l10n.t("Skip {0}: {1}"),
    bulkSkipRepository: vscode.l10n.t("Skip: {0}"),
    bulkSkipOperation: vscode.l10n.t("an operation is in progress"),
    bulkSkipUncommitted: vscode.l10n.t("uncommitted changes"),
    bulkSkipDetached: vscode.l10n.t("HEAD is detached"),
    bulkSkipNoUpstream: vscode.l10n.t("no upstream branch"),
    bulkSkipUpstreamGone: vscode.l10n.t("its upstream branch was deleted"),
    bulkSkipDiverged: vscode.l10n.t("it has commits of its own and commits to pull"),
    bulkSkipUpToDate: vscode.l10n.t("already up to date"),
    bulkSkipNothingToPush: vscode.l10n.t("nothing to push"),
    bulkSkipUninitialized: vscode.l10n.t("not initialized"),
    bulkSkipNoRemote: vscode.l10n.t("no remote"),
    bulkSkipUnreadable: vscode.l10n.t("it could not be read"),
    bulkNothingToDo: vscode.l10n.t("Nothing to do in the listed repositories."),
    bulkRunFetch: vscode.l10n.t("Fetch {0} Repositories"),
    bulkRunPush: vscode.l10n.t("Push {0} Branches"),
    bulkSkipped: vscode.l10n.t("Skipped"),
    bulkSummary: vscode.l10n.t("{0} completed · {1} skipped · {2} failed"),
    reviewUpdate: vscode.l10n.t("Review Update"),
    cleanupBranches: vscode.l10n.t("Clean Up Merged Branches"),
    cleanupHint: vscode.l10n.t(
      "Select local branches fully merged into this HEAD. Current worktree branches, main, master, and remote default branches are protected."
    ),
    deleteSelectedBranches: vscode.l10n.t("Delete Selected Branches"),
    noMergedBranches: vscode.l10n.t("No removable merged branches."),
    fastForwardTitle: vscode.l10n.t("Fast-forward Branches"),
    fastForwardHint: vscode.l10n.t(
      "Move local branches up to their upstream when they have no commits of their own. Nothing is checked out, and the checked-out branch moves only when it has no uncommitted changes."
    ),
    fetchAllAndRefresh: vscode.l10n.t("Fetch All & Refresh"),
    noFastForwards: vscode.l10n.t(
      "No branch can move: each one with an upstream is up to date or has commits of its own."
    ),
    fastForwardBehind: vscode.l10n.t("{0} → {1}, {2} new commits"),
    fastForwardSkipped: vscode.l10n.t("Not moved"),
    fastForwardDiverged: vscode.l10n.t("{0} has commits of its own; pull or rebase it instead"),
    fastForwardWorktree: vscode.l10n.t("{0} is checked out in another worktree"),
    fastForwardUncommitted: vscode.l10n.t("{0} is checked out here with uncommitted changes"),
    fastForwardRun: vscode.l10n.t("Fast-forward {0} Branches"),
    fastForwardDone: vscode.l10n.t("Fast-forwarded {0} branches."),
    bisectTitle: vscode.l10n.t("Find a Regression (Bisect)"),
    bisectHint: vscode.l10n.t(
      "Choose a known good and known bad commit. Git checks out candidates; test each one, then mark it good, bad, or untestable. Reset returns to your original checkout."
    ),
    bisectGood: vscode.l10n.t("Known good commit"),
    bisectBad: vscode.l10n.t("Known bad commit"),
    bisectChooseGood: vscode.l10n.t("Use as Good Bisect Commit"),
    bisectChooseBad: vscode.l10n.t("Use as Bad Bisect Commit"),
    bisectStart: vscode.l10n.t("Start Bisect"),
    bisectMarkGood: vscode.l10n.t("Mark Good"),
    bisectMarkBad: vscode.l10n.t("Mark Bad"),
    bisectSkip: vscode.l10n.t("Skip Untestable Commit"),
    bisectReset: vscode.l10n.t("Reset Bisect"),
    bisectActive: vscode.l10n.t("Bisect in progress"),
    bisectRemaining: vscode.l10n.t("{0} candidate commits remain"),
    bisectFound: vscode.l10n.t("First bad commit"),
    bisectAmbiguous: vscode.l10n.t(
      "Skipped commits prevent identifying a single first bad commit. Reset and repeat with those commits testable."
    ),
    bisectOriginal: vscode.l10n.t("Original checkout"),
    bisectResetConfirm: vscode.l10n.t("End this bisect and return to {0}?")
  };
}
