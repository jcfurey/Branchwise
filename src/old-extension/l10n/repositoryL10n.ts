import * as vscode from "vscode";

export function getRepositoryLocalizedStrings() {
  return {
    manageRemotes: vscode.l10n.t("Remotes"),
    addRemote: vscode.l10n.t("Add Remote"),
    editRemote: vscode.l10n.t("Edit URLs"),
    renameRemote: vscode.l10n.t("Rename Remote"),
    removeRemote: vscode.l10n.t("Remove Remote"),
    fetchUrls: vscode.l10n.t("Fetch URLs (one per line)"),
    pushUrls: vscode.l10n.t("Push URLs (blank uses fetch URLs)"),
    remotePushUrls: vscode.l10n.t("Push URLs"),
    defaultPushRemote: vscode.l10n.t("Default Push Remote"),
    defaultSetting: vscode.l10n.t("Use Git default"),
    none: vscode.l10n.t("None"),
    save: vscode.l10n.t("Save"),
    remoteName: vscode.l10n.t("Remote name"),
    remoteUrl: vscode.l10n.t("URL"),
    fetchAfterAdding: vscode.l10n.t("Fetch after adding"),
    removeRemoteConfirm: vscode.l10n.t(
      "Remove remote {0} and its remote-tracking references? The remote server and local branches will remain."
    ),
    deleteRemoteBranch: vscode.l10n.t("Delete Remote Branch"),
    deleteRemoteTag: vscode.l10n.t("Delete Remote Tag"),
    deleteRemoteRefConfirm: vscode.l10n.t(
      "Delete {0} from remote {1}? This changes the remote repository for everyone using it."
    ),
    configureUpstream: vscode.l10n.t("Configure Upstream"),
    upstreamBranch: vscode.l10n.t("Upstream Branch"),
    trackingStatus: vscode.l10n.t("{0}: {1} ahead, {2} behind"),
    upstreamGone: vscode.l10n.t("Upstream no longer exists"),
    noUpstream: vscode.l10n.t("No upstream configured"),
    worktreeAt: vscode.l10n.t("Checked out at {0}"),
    forceWithLease: vscode.l10n.t("Force with lease (replace rewritten history)"),
    forcePushConfirm: vscode.l10n.t(
      "Replace the history of {0} on {1}? The push will succeed only if the remote still points to the last fetched commit {2}."
    ),
    fetchBeforeCheckout: vscode.l10n.t("Fetch the latest remote revision before checkout"),
    loadingRepository: vscode.l10n.t("Loading repository details"),
    runningGitAction: vscode.l10n.t("Running Git operation"),
    unableToRunGitAction: vscode.l10n.t("Unable to complete Git operation"),
    unableToLoadRepository: vscode.l10n.t("Unable to load repository details"),
    stashes: vscode.l10n.t("Stashes"),
    saveStash: vscode.l10n.t("Save Stash"),
    includeUntracked: vscode.l10n.t("Include untracked files"),
    inspectStash: vscode.l10n.t("Inspect Stash"),
    applyStash: vscode.l10n.t("Apply Stash"),
    popStash: vscode.l10n.t("Pop Stash"),
    dropStash: vscode.l10n.t("Drop Stash"),
    dropStashConfirm: vscode.l10n.t("Permanently drop stash {0}?"),
    reinstateIndex: vscode.l10n.t("Restore staged changes as staged"),
    noStashes: vscode.l10n.t("No stashes saved."),
    worktrees: vscode.l10n.t("Worktrees"),
    addWorktree: vscode.l10n.t("Create Worktree"),
    openWorktree: vscode.l10n.t("Open in New Window"),
    removeWorktree: vscode.l10n.t("Remove Worktree"),
    worktreePath: vscode.l10n.t("Absolute Folder Path"),
    newBranch: vscode.l10n.t("Create a new branch"),
    startPoint: vscode.l10n.t("Start Point (for a new branch)"),
    removeWorktreeConfirm: vscode.l10n.t(
      "Remove worktree {0}? Git will refuse if it contains uncommitted or untracked files. Its branch will remain."
    ),
    lockedWorktree: vscode.l10n.t("Locked"),
    prunableWorktree: vscode.l10n.t("Missing worktree"),
    currentWorktree: vscode.l10n.t("Current worktree"),
    detachedHead: vscode.l10n.t("Detached HEAD"),
    rebaseOnto: vscode.l10n.t("Move the current branch onto this (rebase)"),
    rebaseConfirm: vscode.l10n.t(
      "Rebase {0} onto {1}? This rewrites commits on the current branch and preserves merge structure. Commit or stash your changes first."
    ),
    interactiveRebase: vscode.l10n.t("Edit commits after this (interactive rebase)"),
    rebasePlanTitle: vscode.l10n.t("Interactive Rebase"),
    rebasePlanDescription: vscode.l10n.t(
      "Commits run from top to bottom. Squash combines a commit with the previous retained commit. Reword edits its message. Drop removes it from this branch."
    ),
    pickCommit: vscode.l10n.t("Pick"),
    rewordCommit: vscode.l10n.t("Reword"),
    squashCommit: vscode.l10n.t("Squash"),
    dropCommit: vscode.l10n.t("Drop"),
    moveEarlier: vscode.l10n.t("Move Earlier"),
    moveLater: vscode.l10n.t("Move Later"),
    movedEntry: vscode.l10n.t("Moved {0} to position {1} of {2}."),
    startRebase: vscode.l10n.t("Start Rebase"),
    combinedMessage: vscode.l10n.t("Message of the combined commit {0}"),
    combinedMessageHint: vscode.l10n.t(
      "Squash keeps these messages in one commit; Fixup messages are left out. Edit the result here."
    ),
    combinedMessageRequired: vscode.l10n.t("The combined commit needs a message."),
    editMessage: vscode.l10n.t("Edit Message"),
    editMessageIntro: vscode.l10n.t("Edit the message of {0}. Its changes stay as they are."),
    commitMessage: vscode.l10n.t("Commit message"),
    saveMessage: vscode.l10n.t("Save Message"),
    rewritesOneLater: vscode.l10n.t("The commit after it is rewritten too and gets a new ID."),
    rewritesLater: vscode.l10n.t("The {0} commits after it are rewritten too and get new IDs."),
    alreadyPushed: vscode.l10n.t(
      "This commit is already on a remote. Sharing the rewritten history needs a force push, and anyone who fetched it has to rebase their work onto it."
    ),
    addStagedToCommit: vscode.l10n.t("Add Staged Changes to This Commit"),
    addStagedConfirm: vscode.l10n.t("Add these staged changes to {0}?"),
    addStagedSubmit: vscode.l10n.t("Add Staged Changes"),
    explainAddStaged: vscode.l10n.t(
      "The changes are committed as a fixup! commit, which an autosquash rebase then folds into this commit. If the rebase stops on a conflict, the status strip offers Continue and Abort, and Abort leaves the changes in the fixup! commit."
    ),
    splitCommit: vscode.l10n.t("Split Commit"),
    splitIntro: vscode.l10n.t(
      "Split {0} into several commits. Choose the part each file or hunk goes to. The parts are committed in order, each with the original author and date."
    ),
    explainSplit: vscode.l10n.t(
      "The parts are built from the commit's parent without touching the working tree or the index, and together they must make exactly the original commit. The commits after it are made again on the last part with the same files, so no rebase runs and uncommitted changes stay as they are."
    ),
    splitPart: vscode.l10n.t("Part {0}"),
    splitPartMessage: vscode.l10n.t("Message of Part {0}"),
    addSplitPart: vscode.l10n.t("+ Part"),
    removeSplitPart: vscode.l10n.t("Remove Part {0}"),
    splitFilePart: vscode.l10n.t("Part for {0}"),
    splitHunkPart: vscode.l10n.t("Part for {0} at {1}"),
    splitHunks: vscode.l10n.t("{0} hunks: choose a part for each"),
    splitByHunk: vscode.l10n.t("By hunk"),
    splitMoreLines: vscode.l10n.t("{0} more lines"),
    splitPreview: vscode.l10n.t("{0} commits: {1}"),
    splitPartFiles: vscode.l10n.t("Part {0} ({1} files)"),
    splitPartOneFile: vscode.l10n.t("Part {0} (1 file)"),
    splitPartsJoin: vscode.l10n.t("{0}, {1}"),
    splitEmptyPart: vscode.l10n.t("Choose at least one file or hunk for Part {0}."),
    splitNoMessage: vscode.l10n.t("Enter a message for Part {0}."),
    absorbStaged: vscode.l10n.t("Absorb Staged Changes"),
    absorbIntro: vscode.l10n.t(
      "Each staged hunk becomes part of a fixup! commit for the commit of this branch that last changed its lines. Unstaged and untracked changes stay as they are."
    ),
    absorbLeft: vscode.l10n.t("Left staged"),
    absorbNothing: vscode.l10n.t(
      "None of the staged changes can be absorbed, so nothing would change."
    ),
    createFixupCommits: vscode.l10n.t("Create Fixup Commits"),
    createAndSquash: vscode.l10n.t("Create and Squash Now"),
    explainCreateAndSquash: vscode.l10n.t(
      "Create and Squash Now then opens the interactive rebase editor with each fixup arranged after its commit. Nothing is rewritten until you start the rebase there."
    ),
    absorbNeedsClean: vscode.l10n.t(
      "To squash now, nothing else may be staged, unstaged or untracked, since the rebase needs a clean working tree. The fixup commits can still be created and squashed later."
    ),
    absorbRootTarget: vscode.l10n.t(
      "A fixup goes into the first commit of the history, which the rebase editor cannot rewrite, so it cannot be squashed from here."
    ),
    absorbAdded: vscode.l10n.t("added file"),
    absorbDeleted: vscode.l10n.t("deleted file"),
    absorbRenamed: vscode.l10n.t("renamed or copied file"),
    absorbBinary: vscode.l10n.t("binary file"),
    absorbSpecial: vscode.l10n.t("mode or file type changed"),
    absorbOutside: vscode.l10n.t(
      "lines last changed by a commit already pushed or older than the branch"
    ),
    absorbSeveral: vscode.l10n.t("lines last changed by more than one commit"),
    absorbNoContext: vscode.l10n.t("no surrounding lines to tell which commit it belongs to"),
    invalidRebasePlan: vscode.l10n.t(
      "Keep at least one commit; the first retained commit cannot be Squash. Reword requires a message."
    ),
    operationInProgress: vscode.l10n.t("{0} in progress"),
    conflictedFiles: vscode.l10n.t("Conflicted Files"),
    continueOperation: vscode.l10n.t("Continue"),
    abortOperation: vscode.l10n.t("Abort"),
    skipOperation: vscode.l10n.t("Skip Commit"),
    recoveryConfirm: vscode.l10n.t(
      "{0} the current {1}? Abort restores the pre-operation state; Skip discards the current patch."
    ),
    openConflict: vscode.l10n.t("Open Conflict"),
    showMoreRefs: vscode.l10n.t("Show {0} more ({1} hidden)"),
    dropdownPage: vscode.l10n.t("{0}–{1} of {2}. Type to narrow the list, or use the arrow keys."),
    stageResolution: vscode.l10n.t("Stage Resolution"),
    stageResolutionConfirm: vscode.l10n.t("Mark {0} as resolved and stage its current contents?"),
    mergeOperation: vscode.l10n.t("Merge"),
    rebaseOperation: vscode.l10n.t("Rebase"),
    cherryPickOperation: vscode.l10n.t("Cherry-pick"),
    revertOperation: vscode.l10n.t("Revert"),

    // Branches pane
    branchesPane: vscode.l10n.t("Branches"),
    localBranches: vscode.l10n.t("Local Branches"),
    tags: vscode.l10n.t("Tags"),
    refFilter: vscode.l10n.t("Filter branches, tags and stashes…"),
    noMatchingRefs: vscode.l10n.t("Nothing matches this filter."),
    noTags: vscode.l10n.t("No tags."),
    createBranchHere: vscode.l10n.t("New Branch"),
    newBranchFrom: vscode.l10n.t("Create a branch at {0}"),
    remoteBranchesShown: vscode.l10n.t(
      "Remote branches are shown in the graph. Click to hide them."
    ),
    remoteBranchesHidden: vscode.l10n.t(
      "Remote branches are hidden from the graph. Click to show them."
    ),
    hiddenFromGraph: vscode.l10n.t(
      "Hidden from the graph. Selecting a remote branch shows them again."
    ),
    refActions: vscode.l10n.t("Actions for {0}"),
    pinBranch: vscode.l10n.t("Pin {0} to the top"),
    unpinBranch: vscode.l10n.t("Unpin {0}"),
    pinnedBranch: vscode.l10n.t("Pinned"),
    sortBranchesByRecent: vscode.l10n.t("Sort by most recent commit"),
    branchesSortedByRecent: vscode.l10n.t("Sorted by most recent commit. Click to sort by name."),
    branchesSortedByName: vscode.l10n.t("Sorted by name. Click to sort by most recent commit."),
    branchMerged: vscode.l10n.t("merged"),
    branchMergedTitle: vscode.l10n.t("Already merged into {0}: deleting it loses no commits"),
    branchGone: vscode.l10n.t("gone"),
    branchStale: vscode.l10n.t("stale"),
    branchStaleTitle: vscode.l10n.t("No commits for {0} days"),
    branchDiverged: vscode.l10n.t("Diverged: {0} ahead of and {1} behind its upstream"),
    remoteActions: vscode.l10n.t("Actions for remote {0}"),
    showRemoteInGraph: vscode.l10n.t("Show remote {0} in the graph"),
    hideRemoteFromGraph: vscode.l10n.t("Hide remote {0} from the graph"),
    applyShort: vscode.l10n.t("Apply"),
    popShort: vscode.l10n.t("Pop"),
    settingsTools: vscode.l10n.t("Settings & Tools"),
    openSettings: vscode.l10n.t("Open Extension Settings"),
    gettingStarted: vscode.l10n.t("Getting Started"),
    learnMore: vscode.l10n.t("Learn more"),

    // Hidden branches
    hiddenBranches: vscode.l10n.t("Hidden Branches"),
    hideBranchesLikeThis: vscode.l10n.t("Hide Branches Like This"),
    hiddenBranchesExplain: vscode.l10n.t(
      "Branches whose names match these patterns are left out of the graph and the branch lists. Write one pattern per line: * matches any characters, / included, and ? any one character. Remote branches are matched without their remote's name, so dependabot/* also hides origin/dependabot/npm/foo. The checked-out branch and the selected branch always stay shown."
    ),
    hiddenBranchPatterns: vscode.l10n.t("Patterns, one per line"),
    hiddenBranchesPreview: vscode.l10n.t("Branches each pattern hides"),
    branchesHiddenByPatterns: vscode.l10n.t("Branches hidden by name patterns: {0}"),
    showHiddenBranches: vscode.l10n.t("Show all"),
    editHiddenBranches: vscode.l10n.t("Edit patterns"),
    selectionMatchesHiddenPattern: vscode.l10n.t(
      "This branch matches a hidden-branch pattern. It stays shown while selected."
    ),

    // Guidance
    commitMenuHint: vscode.l10n.t(
      "Right-click a commit, or use its ⋯ button, for actions. On the keyboard, press Shift+F10."
    ),
    commitActions: vscode.l10n.t("Actions for commit {0}"),
    explainReset: vscode.l10n.t(
      "Soft and mixed keep your files. Hard discards uncommitted changes. The previous position stays in the reflog, so Recover lost commits can bring it back."
    ),
    explainDetachedHead: vscode.l10n.t(
      "You can build and test here. Create a branch from this commit to keep new work, or check out a branch to return."
    ),
    explainDeleteBranch: vscode.l10n.t(
      "The commits stay in the repository for a while. Recover lost commits lists the branch tip if you need it back."
    ),
    explainForcePush: vscode.l10n.t(
      "Anyone who already fetched the old history has to rebase their work onto the new one."
    ),
    explainInteractiveRebase: vscode.l10n.t(
      "Nothing changes until you start the rebase. If it stops on a conflict, the status strip offers Continue and Abort, and Abort restores the branch as it was."
    ),
    explainDropStash: vscode.l10n.t(
      "Branchwise keeps a dropped stash in the Safety Net for 30 days, so Undo can bring it back."
    ),
    forecastChecking: vscode.l10n.t("Checking for conflicts…"),
    forecastRebaseStop: vscode.l10n.t("Rebase would stop at {0}: conflicts in {1}"),
    forecastCherryPickStop: vscode.l10n.t("Cherry-pick would stop at {0}: conflicts in {1}"),
    forecastRevertStop: vscode.l10n.t("Revert would stop at {0}: conflicts in {1}"),
    forecastStopsHere: vscode.l10n.t("Would stop here: conflicts in {0}"),
    forecastReplaysOne: vscode.l10n.t("Replays 1 commit cleanly"),
    forecastReplays: vscode.l10n.t("Replays {0} commits cleanly"),
    forecastRevertsOne: vscode.l10n.t("Reverts 1 commit cleanly"),
    forecastReverts: vscode.l10n.t("Reverts {0} commits cleanly"),
    forecastSkippedLimit: vscode.l10n.t("Conflict forecast skipped: too many commits"),
    forecastNeedsGit: vscode.l10n.t("Conflict forecast needs Git 2.40 or later")
  };
}
