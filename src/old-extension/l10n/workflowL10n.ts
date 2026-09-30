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
    reviewUpdate: vscode.l10n.t("Review Update"),
    cleanupBranches: vscode.l10n.t("Clean Up Merged Branches"),
    cleanupHint: vscode.l10n.t(
      "Select local branches fully merged into this HEAD. Current worktree branches, main, master, and remote default branches are protected."
    ),
    deleteSelectedBranches: vscode.l10n.t("Delete Selected Branches"),
    noMergedBranches: vscode.l10n.t("No removable merged branches."),
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
