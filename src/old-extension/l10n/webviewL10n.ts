import * as vscode from "vscode";

import { getHistoryLocalizedStrings } from "./historyL10n";
import { getRepositoryLocalizedStrings } from "./repositoryL10n";
import { getWorkflowLocalizedStrings } from "./workflowL10n";

/**
 * Every string the Branchwise page shows, resolved into the display language.
 *
 * `vscode.l10n` exists only in the extension host, so the host calls this function and sends
 * the resulting object to the page in its answer to the `webview.initialize` RPC. The page keeps
 * it as `window.l10n` and reads each string by its property name.
 *
 * The repository, history and workflow tables are spread in first, then the entries below.
 *
 * `pnpm run l10n:export` collects the strings to translate by finding each literal passed to
 * `vscode.l10n.t`, so a string the page shows has to be declared, as a plain literal, in this
 * table or one of the other three.
 */
export function getWebviewLocalizedStrings() {
  return {
    ...getRepositoryLocalizedStrings(),
    ...getHistoryLocalizedStrings(),
    ...getWorkflowLocalizedStrings(),

    // Header pickers, toolbar and the graph's own controls
    repo: vscode.l10n.t("Repository"),
    branch: vscode.l10n.t("Branch"),
    branchDisplay: vscode.l10n.t("View"),
    filterToBranch: vscode.l10n.t("Filter to branch"),
    focusDirectHistory: vscode.l10n.t("Focus direct history"),
    focusAllAncestors: vscode.l10n.t("Focus all ancestors"),
    branchFocus: vscode.l10n.t("Focus: {0}"),
    focusThisBranch: vscode.l10n.t("Focus this branch"),
    focusBadge: vscode.l10n.t("Focus"),
    focusPausedBadge: vscode.l10n.t("Paused"),
    branchFocusPaused: vscode.l10n.t("Focus paused: {0}"),
    focusPausedHint: vscode.l10n.t("All colours restored. Resume to focus the same branch."),
    pauseBranchFocus: vscode.l10n.t("Pause focus"),
    resumeBranchFocus: vscode.l10n.t("Resume focus"),
    focusDimming: vscode.l10n.t("Dimming"),
    focusDimmingSubtle: vscode.l10n.t("Subtle"),
    focusDimmingStrong: vscode.l10n.t("Strong"),
    clearBranchFocus: vscode.l10n.t("Clear focus"),
    loadingBranchFocus: vscode.l10n.t("Loading branch focus…"),
    branchFocusUnavailable: vscode.l10n.t(
      "Branch focus unavailable. Refresh or select another branch."
    ),
    focusDirectHint: vscode.l10n.t(
      "Direct history: full colour · Merged history: muted · Other commits: grey"
    ),
    focusAncestorsHint: vscode.l10n.t("All ancestors: full colour · Other commits: grey"),
    showRemoteBranches: vscode.l10n.t("Show Remote Branches in Graph"),
    refresh: vscode.l10n.t("Refresh"),
    retry: vscode.l10n.t("Retry"),
    unableToLoadRepositories: vscode.l10n.t("Unable to load repositories: {0}"),
    close: vscode.l10n.t("Close"),
    loadMore: vscode.l10n.t("Load Older Commits"),
    showAll: vscode.l10n.t("All branches"),
    // {0} is the picker's own label: Repository, Branch or View.
    filterPlaceholder: vscode.l10n.t("{0}: type to filter…"),
    noResultsFound: vscode.l10n.t("Nothing matches this filter."),

    // Commit table headers. All but the last also name their column in "Resize {0} column".
    graph: vscode.l10n.t("Graph"),
    scrollGraphHorizontally: vscode.l10n.t("Scroll graph horizontally"),
    revealSelectedLane: vscode.l10n.t("Reveal selected lane"),
    resizeColumn: vscode.l10n.t("Resize {0} column"),
    description: vscode.l10n.t("Message"),
    date: vscode.l10n.t("Date"),
    author: vscode.l10n.t("Author"),
    commit: vscode.l10n.t("ID"),

    // Pages shown instead of the graph
    noCommits: vscode.l10n.t("This repository has no commits yet"),
    createFirstCommit: vscode.l10n.t("The graph appears here once you make the first commit."),
    noRepo: vscode.l10n.t("No Git repository found in the open folders"),
    // The title of VS Code's own git.init command, which the button runs.
    initializeRepo: vscode.l10n.t("Initialize Repository"),
    unableToInitializeRepo: vscode.l10n.t("Unable to create a Git repository: {0}"),

    // Error dialog titles. The reason, when there is one, is shown under the title.
    unableToLoad: vscode.l10n.t("Unable to load the graph"),
    unableToLoadCommitDetails: vscode.l10n.t("Unable to load the commit's files and message"),
    // {0} is typeCommitHash, typeTagName, typeBranchName or errorDetails.
    unableToCopyToClipboard: vscode.l10n.t("Unable to copy the {0} to the clipboard"),
    unableToViewDiff: vscode.l10n.t("Unable to open this file's changes"),
    unableToAddTag: vscode.l10n.t("Unable to create the tag"),
    unableToCheckoutBranch: vscode.l10n.t("Unable to check out the branch"),
    unableToCheckoutCommit: vscode.l10n.t("Unable to check out the commit"),
    unableToCherryPick: vscode.l10n.t("Unable to cherry-pick the commit"),
    unableToCreateBranch: vscode.l10n.t("Unable to create the branch"),
    unableToDeleteBranch: vscode.l10n.t("Unable to delete the branch"),
    unableToDeleteTag: vscode.l10n.t("Unable to delete the tag"),
    unableToMergeBranch: vscode.l10n.t("Unable to merge the branch"),
    unableToMergeCommit: vscode.l10n.t("Unable to merge the commit"),
    unableToPushTag: vscode.l10n.t("Unable to push the tag"),
    unableToRenameBranch: vscode.l10n.t("Unable to rename the branch"),
    unableToReset: vscode.l10n.t("Unable to reset the current branch"),
    unableToRevert: vscode.l10n.t("Unable to revert the commit"),
    // {0} is the web address.
    unableToOpenUrl: vscode.l10n.t("Unable to open {0}"),
    // The tooltip of a disabled submit button; {0} is that button's label.
    invalidCharacters: vscode.l10n.t("Git does not accept this name, so {0} is unavailable."),

    // Remote actions
    fetch: vscode.l10n.t("Fetch"),
    pushBranch: vscode.l10n.t("Push Branch"),
    pullBranch: vscode.l10n.t("Pull Branch"),
    remote: vscode.l10n.t("Remote"),
    remoteBranch: vscode.l10n.t("Remote Branch"),
    allRemotes: vscode.l10n.t("All Remotes"),
    setUpstream: vscode.l10n.t("Set as upstream branch"),
    pruneRemoteBranches: vscode.l10n.t("Prune deleted remote branches"),
    loadingRemotes: vscode.l10n.t("Loading remotes"),
    fetching: vscode.l10n.t("Fetching"),
    pushingBranch: vscode.l10n.t("Pushing branch"),
    pullingBranch: vscode.l10n.t("Pulling branch"),
    unableToLoadRemotes: vscode.l10n.t("Unable to load remotes"),
    unableToFetch: vscode.l10n.t("Unable to fetch"),
    unableToPushBranch: vscode.l10n.t("Unable to push branch"),
    unableToPullBranch: vscode.l10n.t("Unable to pull branch"),
    noRemotesConfigured: vscode.l10n.t(
      "No remotes configured. Add a remote to this repository first."
    ),
    remoteNotConfigured: vscode.l10n.t("The remote for '{0}' is no longer configured."),
    dialogFetchTitle: vscode.l10n.t("Fetch updates from a remote:"),
    dialogPushBranchTitle: vscode.l10n.t("Push branch {0} to a remote:"),
    dialogPullBranchTitle: vscode.l10n.t("Pull into branch {0} (fast-forward only):"),

    // Commit, branch and tag menus. Entries that open a dialog get "…" from the menu code.
    // Most of these labels also name the running or finished operation in Git Activity.
    addTag: vscode.l10n.t("Create Tag"),
    createBranch: vscode.l10n.t("Create Branch"),
    checkout: vscode.l10n.t("Check Out"),
    cherryPick: vscode.l10n.t("Cherry-pick"),
    revert: vscode.l10n.t("Revert"),
    merge: vscode.l10n.t("Merge into Current Branch"),
    reset: vscode.l10n.t("Reset Current Branch to This Commit"),
    copyCommitHash: vscode.l10n.t("Copy Commit ID"),
    moreRefs: vscode.l10n.t("More branches and tags: {0}"),
    copyShortCommitHash: vscode.l10n.t("Copy Short Commit ID"),
    copyCommitHashShort: vscode.l10n.t("Copy Short ID"),
    copyCommitHashFull: vscode.l10n.t("Copy Full ID"),
    copiedToClipboard: vscode.l10n.t("Copied"),
    commitUnpushed: vscode.l10n.t("Not pushed: no remote branch has this commit yet"),
    commitUnpulled: vscode.l10n.t("Not pulled: only the tracked remote branch has this commit"),
    conflictForecast: vscode.l10n.t("Merging this branch into {0} would conflict in:"),
    conflictForecastMore: vscode.l10n.t("and {0} more files"),
    copyTagName: vscode.l10n.t("Copy Tag Name"),
    copyBranchName: vscode.l10n.t("Copy Branch Name"),
    deleteTag: vscode.l10n.t("Delete Local Tag"),
    pushTag: vscode.l10n.t("Push Tag to Remote"),
    checkoutBranch: vscode.l10n.t("Check Out Branch"),
    renameBranch: vscode.l10n.t("Rename Branch"),
    deleteBranch: vscode.l10n.t("Delete Local Branch"),
    // {0} is the name of the repository's host, GitHub or GitLab.
    openCommitOnHost: vscode.l10n.t("Open Commit on {0}"),
    openBranchOnHost: vscode.l10n.t("Open Branch on {0}"),
    openTagOnHost: vscode.l10n.t("Open Tag on {0}"),

    // What a failed copy was copying, inserted mid-sentence into unableToCopyToClipboard
    typeCommitHash: vscode.l10n.t("commit ID"),
    typeTagName: vscode.l10n.t("tag name"),
    typeBranchName: vscode.l10n.t("branch name"),

    // Noun phrases inserted into the deletion, merge and reset questions
    labelTag: vscode.l10n.t("local tag"),
    labelBranch: vscode.l10n.t("local branch"),
    labelCurrentBranch: vscode.l10n.t("the current branch"),
    // A line of the tooltip on the checked-out branch's label
    tooltipCurrentBranch: vscode.l10n.t("Current branch"),

    // Dialogs opened from the menus. Hashes and ref names in {n} are shown bold italic.
    dialogAddTagTitle: vscode.l10n.t("Create a tag on commit {0}"),
    dialogAddTagName: vscode.l10n.t("Tag name"),
    dialogAddTagType: vscode.l10n.t("Tag type"),
    dialogAddTagMessage: vscode.l10n.t("Message"),
    dialogAddTagTypeAnnotated: vscode.l10n.t("Annotated (records tagger, date and message)"),
    dialogAddTagTypeLightweight: vscode.l10n.t("Lightweight (name only; the message is ignored)"),
    dialogAddTagOptional: vscode.l10n.t("Optional"),
    dialogAddTagSubmit: vscode.l10n.t("Create Tag"),
    dialogCreateBranchTitle: vscode.l10n.t(
      "Enter a name for a new branch at commit {0} (the branch is not checked out):"
    ),
    dialogCreateBranchSubmit: vscode.l10n.t("Create Branch"),
    dialogCheckoutRemoteTitle: vscode.l10n.t(
      "Enter a local branch name for {0}. Existing branches will be fast-forwarded when possible:"
    ),
    dialogCheckoutConfirm: vscode.l10n.t(
      "Check out commit {0}? This detaches HEAD: no branch will be checked out, and new commits will not be on any branch."
    ),
    dialogCherryPickConfirm: vscode.l10n.t(
      "Cherry-pick commit {0}? Its changes are applied to the current branch as a new commit."
    ),
    dialogRevertConfirm: vscode.l10n.t(
      "Revert commit {0}? A new commit that undoes its changes is added to the current branch."
    ),
    // {1} is labelCurrentBranch.
    dialogMergeConfirm: vscode.l10n.t("Merge {0} into {1}?"),
    dialogMergeNoFastForward: vscode.l10n.t("Always record a merge commit (no fast-forward)"),
    // {0} is labelCurrentBranch.
    dialogResetConfirm: vscode.l10n.t("Reset {0} to commit {1}?"),
    dialogResetSoft: vscode.l10n.t(
      "Soft: keep all changes, and stage those of the commits left behind"
    ),
    dialogResetMixed: vscode.l10n.t("Mixed: keep all changes, but unstage them"),
    dialogResetHard: vscode.l10n.t(
      "Hard: discard uncommitted changes to tracked files; untracked files stay"
    ),
    // {0} is labelBranch or labelTag.
    dialogDeleteConfirm: vscode.l10n.t("Delete {0} {1}?"),
    dialogDeleteForceDelete: vscode.l10n.t("Delete even if its commits are not merged (force)"),
    dialogRenameBranchTitle: vscode.l10n.t("Enter a new name for branch {0}:"),
    dialogRenameBranchSubmit: vscode.l10n.t("Rename Branch"),
    dialogYesCherryPick: vscode.l10n.t("Cherry-pick"),
    dialogYesRevert: vscode.l10n.t("Revert"),
    dialogYesMerge: vscode.l10n.t("Merge"),
    dialogYesReset: vscode.l10n.t("Reset"),
    dialogCancel: vscode.l10n.t("Cancel"),
    dialogDismiss: vscode.l10n.t("Dismiss"),

    // Relative dates come from Intl.RelativeTimeFormat in the page (src/webview/utils/date.ts),
    // so this table declares no time units.

    // Commit details. The value takes the place of {0}; the text before it, separator
    // included, is shown bold as the line's label.
    detailCommit: vscode.l10n.t("Commit ID: {0}"),
    detailParents: vscode.l10n.t("Parent commits: {0}"),
    detailAuthor: vscode.l10n.t("Author: {0}"),
    detailDate: vscode.l10n.t("Date: {0}"),
    detailCommitter: vscode.l10n.t("Committer: {0}"),
    // The branches and tags that contain the commit, loaded after the rest of the details.
    // {0} is a tag, shown as a button that selects its commit.
    checkingRefs: vscode.l10n.t("Checking…"),
    detailContainedIn: vscode.l10n.t("Contained in:"),
    moreBranches: vscode.l10n.t("and {0} more"),
    firstReleasedIn: vscode.l10n.t("First released in {0}"),
    laterTag: vscode.l10n.t("also in {0} later tag"),
    laterTags: vscode.l10n.t("also in {0} later tags"),
    followsTag: vscode.l10n.t("Follows {0}"),
    focusBranchChip: vscode.l10n.t("Focus {0} in the graph"),
    selectTaggedCommit: vscode.l10n.t("Select the commit tagged {0}"),

    // Uncommitted changes. {0} is the number of changed paths; the singular is used for 1.
    uncommittedChange: vscode.l10n.t("Uncommitted changes in {0} file"),
    uncommittedChanges: vscode.l10n.t("Uncommitted changes in {0} files"),
    viewWorkingTreeChanges: vscode.l10n.t("Click or press Enter to view uncommitted changes."),
    workingTreeHint: vscode.l10n.t(
      "Select a file to view its changes. Conflicted files open the merge editor."
    ),
    unstagedChanges: vscode.l10n.t("Unstaged Changes"),
    stagedChanges: vscode.l10n.t("Staged Changes"),
    untrackedFiles: vscode.l10n.t("Untracked Files"),
    nestedRepository: vscode.l10n.t("nested repository"),
    conflicts: vscode.l10n.t("Conflicts"),
    noWorkingTreeChanges: vscode.l10n.t("No uncommitted changes."),

    // Tooltips in a commit's file tree. The line counts pick the singular when {0} is 1.
    tooltipBinaryFile: vscode.l10n.t(
      "Git has no text diff for this file, so there is nothing to open."
    ),
    tooltipRenamedTo: vscode.l10n.t("Renamed from {0} to {1}"),
    tooltipAddition: vscode.l10n.t("{0} line added"),
    tooltipAdditions: vscode.l10n.t("{0} lines added"),
    tooltipDeletion: vscode.l10n.t("{0} line deleted"),
    tooltipDeletions: vscode.l10n.t("{0} lines deleted")
  };
}

export type LocalizedStrings = ReturnType<typeof getWebviewLocalizedStrings>;
