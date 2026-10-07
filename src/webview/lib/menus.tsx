import type { ComponentChildren } from "preact";

import type { GitCommitNode, GitRef, GitResetMode } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { openCompare, openFixup } from "@/webview/components/history/HistoryTools";
import { chooseBisectCommit } from "@/webview/components/repository/BisectView";
import {
  hasStagedChanges,
  onCheckedOutLine,
  openAddStaged,
  openEditMessage
} from "@/webview/components/repository/EditCommit";
import { openHiddenBranches } from "@/webview/components/repository/HiddenBranches";
import { openInteractiveRebase, openRebase } from "@/webview/components/repository/RebaseEditor";
import { openTracking } from "@/webview/components/repository/RemoteManager";
import { ReplayForecastFor } from "@/webview/components/repository/ReplayForecast";
import { openSplitCommit } from "@/webview/components/repository/SplitCommit";
import { openAddWorktree } from "@/webview/components/repository/WorktreeManager";
import { announce } from "@/webview/components/ui/Announcer";
import { Explain } from "@/webview/components/ui/Explain";
import { closeDialog, focusBranchInGraph, openFormDialog, runAction } from "@/webview/lib/actions";
import { copyToClipboard } from "@/webview/lib/actions/clipboard";
import { openUrl } from "@/webview/lib/actions/open-url";
import { branchPage, commitPage, type HostPage, tagPage } from "@/webview/lib/host-links";
import { openRemoteAction } from "@/webview/lib/remote-actions";
import { repositoryState } from "@/webview/lib/repository-actions";
import type { ShortcutId } from "@/webview/lib/shortcuts";
import { patternLike } from "@/webview/lib/stores/hidden-branches.store";
import type { ContextMenuEntry } from "@/webview/types";
import { format } from "@/webview/utils/format";

/** The message of each loaded commit by its full hash, to describe the parents of a merge. */
export type CommitMessages = ReadonlyMap<string, string>;

type Entry = Exclude<ContextMenuEntry, null>;

/** The key of a commit row, matched against the source of an open menu or dialog. */
export function commitMenuSource(hash: string) {
  return "commit:" + hash;
}

/** The key of a branch or tag label. Every label of the same ref shares it. */
export function refMenuSource(gitRef: GitRef) {
  return `ref:${gitRef.type}:${gitRef.name}`;
}

/** The title of an entry that asks for more before it acts. */
function more(title: string) {
  return title + "…";
}

/** Put a divider between each group of entries and the next. A fresh array every time. */
function grouped(...groups: Array<Array<Entry>>): Array<ContextMenuEntry> {
  const entries: Array<ContextMenuEntry> = [];
  for (const group of groups) {
    if (entries.length > 0 && group.length > 0) {
      entries.push(null);
    }
    entries.push(...group);
  }
  return entries;
}

/** A hash or ref name inside a dialog question. */
function named(text: string) {
  return (
    <b>
      <i>{text}</i>
    </b>
  );
}

function currentBranch() {
  return <b>{window.l10n.labelCurrentBranch}</b>;
}

function withExplanation(question: Array<ComponentChildren>, explanation: string) {
  return (
    <>
      {question}
      <Explain>{explanation}</Explain>
    </>
  );
}

/**
 * The symbolic ref that names a remote's default branch, such as `origin/HEAD`. It is not a
 * branch of its own, so nothing that treats it as one is offered.
 */
function isRemoteHead(gitRef: GitRef) {
  return gitRef.type === "remote" && gitRef.name.endsWith("/HEAD");
}

function compareEntry(hash: string): Entry {
  return { title: window.l10n.compareWith, onClick: () => openCompare("HEAD", hash) };
}

function focusEntry(branch: string): Entry {
  return { title: window.l10n.focusThisBranch, onClick: () => focusBranchInGraph(branch) };
}

/**
 * The entry that opens `page` on its host, titled from `title` with the host's name. None when
 * the repository's host is not known.
 */
function hostEntry(title: string, page: HostPage | null, shortcut?: ShortcutId): Array<Entry> {
  if (page === null) {
    return [];
  }
  const entry: Entry = {
    title: title.replaceAll("{0}", () => page.host),
    onClick: () => void openUrl(page.url)
  };
  return [shortcut === undefined ? entry : { ...entry, shortcut }];
}

function copyBranchEntry(name: string): Entry {
  return {
    title: window.l10n.copyBranchName,
    onClick: () => copyToClipboard(window.l10n.typeBranchName, name)
  };
}

/** Open the hidden-branch patterns with one for branches named like this one added. */
function hideLikeEntry(gitRef: GitRef): Entry {
  return {
    title: more(window.l10n.hideBranchesLikeThis),
    onClick: () => openHiddenBranches(patternLike(gitRef))
  };
}

// Commit menu

/** Copy a commit ID, and tell a screen reader once it is on the clipboard. */
function copyCommitId(id: string) {
  void copyToClipboard(window.l10n.typeCommitHash, id).then((copied) => {
    if (copied) {
      announce(window.l10n.copiedToClipboard);
    }
  });
}

function addTag(hash: string) {
  openFormDialog({
    message: format(window.l10n.dialogAddTagTitle, named(abbrevCommit(hash))),
    inputs: [
      { kind: "ref", label: window.l10n.dialogAddTagName, value: "" },
      {
        kind: "select",
        label: window.l10n.dialogAddTagType,
        value: "annotated",
        options: [
          { label: window.l10n.dialogAddTagTypeAnnotated, value: "annotated" },
          { label: window.l10n.dialogAddTagTypeLightweight, value: "lightweight" }
        ]
      },
      {
        kind: "text",
        label: window.l10n.dialogAddTagMessage,
        value: "",
        placeholder: window.l10n.dialogAddTagOptional
      }
    ],
    action: window.l10n.dialogAddTagSubmit,
    source: commitMenuSource(hash),
    onSubmit: ([tagName, type, message]) => {
      // A lightweight tag has no message, whatever was left in the field.
      const lightweight = type === "lightweight";
      runAction({
        command: "addTag",
        tagName,
        commitHash: hash,
        lightweight,
        message: lightweight ? "" : message
      });
    }
  });
}

function createBranch(hash: string) {
  openFormDialog({
    message: format(window.l10n.dialogCreateBranchTitle, named(abbrevCommit(hash))),
    inputs: [{ kind: "ref", value: "" }],
    action: window.l10n.dialogCreateBranchSubmit,
    source: commitMenuSource(hash),
    onSubmit: ([branchName]) => runAction({ command: "createBranch", branchName, commitHash: hash })
  });
}

export function checkoutCommit(hash: string) {
  openFormDialog({
    message: withExplanation(
      format(window.l10n.dialogCheckoutConfirm, named(abbrevCommit(hash))),
      window.l10n.explainDetachedHead
    ),
    inputs: [],
    action: window.l10n.checkout,
    source: commitMenuSource(hash),
    onSubmit: () => runAction({ command: "checkoutCommit", commitHash: hash })
  });
}

/**
 * Cherry-pick or revert a commit. A merge has one change per parent, so the user picks the
 * parent (1-based, as Git's `--mainline` counts) that the change is taken against. The dialog
 * forecasts conflicts for an ordinary commit only, since a merge's depend on the parent chosen.
 */
function applyCommit(
  commit: GitCommitNode,
  messages: CommitMessages,
  command: "cherrypickCommit" | "revertCommit"
) {
  const commitHash = commit.hash;
  const cherryPick = command === "cherrypickCommit";
  const question = format(
    cherryPick ? window.l10n.dialogCherryPickConfirm : window.l10n.dialogRevertConfirm,
    named(abbrevCommit(commitHash))
  );
  const action = cherryPick ? window.l10n.dialogYesCherryPick : window.l10n.dialogYesRevert;
  const source = commitMenuSource(commitHash);

  if (commit.parentHashes.length < 2) {
    openFormDialog({
      message: (
        <>
          {question}
          <ReplayForecastFor
            query={{
              kind: "replayForecast",
              mode: cherryPick ? "pick" : "revert",
              onto: "HEAD",
              commits: [commitHash]
            }}
            operation={cherryPick ? "cherry-pick" : "revert"}
          />
        </>
      ),
      inputs: [],
      action,
      source,
      onSubmit: () => runAction({ command, commitHash, parentIndex: 0 })
    });
    return;
  }

  const options = commit.parentHashes.map((parent, index) => {
    const summary = messages.get(parent);
    const short = abbrevCommit(parent);
    return {
      label: summary === undefined ? short : `${short}: ${summary}`,
      value: String(index + 1)
    };
  });
  openFormDialog({
    message: question,
    inputs: [{ kind: "select", value: "1", options }],
    action,
    source,
    onSubmit: ([parent]) => runAction({ command, commitHash, parentIndex: Number(parent) })
  });
}

function mergeCommit(hash: string) {
  openFormDialog({
    message: format(window.l10n.dialogMergeConfirm, named(abbrevCommit(hash)), currentBranch()),
    inputs: [{ kind: "checkbox", label: window.l10n.dialogMergeNoFastForward, value: true }],
    action: window.l10n.dialogYesMerge,
    source: commitMenuSource(hash),
    onSubmit: ([createNewCommit]) =>
      runAction({ command: "mergeCommit", commitHash: hash, createNewCommit })
  });
}

export function resetToCommit(hash: string) {
  openFormDialog({
    message: withExplanation(
      format(window.l10n.dialogResetConfirm, currentBranch(), named(abbrevCommit(hash))),
      window.l10n.explainReset
    ),
    inputs: [
      {
        kind: "select",
        value: "mixed",
        options: [
          { label: window.l10n.dialogResetSoft, value: "soft" },
          { label: window.l10n.dialogResetMixed, value: "mixed" },
          { label: window.l10n.dialogResetHard, value: "hard" }
        ]
      }
    ],
    action: window.l10n.dialogYesReset,
    source: commitMenuSource(hash),
    destructive: true,
    onSubmit: ([mode]) =>
      runAction({ command: "resetToCommit", commitHash: hash, resetMode: mode as GitResetMode })
  });
}

export function commitMenu(
  commit: GitCommitNode,
  messages: CommitMessages
): Array<ContextMenuEntry> {
  const { hash } = commit;
  const l10n = window.l10n;
  return grouped(
    [
      { title: more(l10n.addTag), onClick: () => addTag(hash), shortcut: "addTag" },
      {
        title: more(l10n.createBranch),
        onClick: () => createBranch(hash),
        shortcut: "createBranch"
      }
    ],
    [
      { title: more(l10n.checkout), onClick: () => checkoutCommit(hash), shortcut: "checkout" },
      {
        title: more(l10n.cherryPick),
        onClick: () => applyCommit(commit, messages, "cherrypickCommit"),
        shortcut: "cherryPick"
      },
      {
        title: more(l10n.revert),
        onClick: () => applyCommit(commit, messages, "revertCommit"),
        shortcut: "revert"
      }
    ],
    [
      { title: more(l10n.merge), onClick: () => mergeCommit(hash), shortcut: "merge" },
      { title: more(l10n.reset), onClick: () => resetToCommit(hash), shortcut: "reset" }
    ],
    [
      // Editing in place rewrites the checked-out branch, so only its own commits offer it.
      ...(onCheckedOutLine(hash)
        ? [
            {
              title: more(l10n.editMessage),
              onClick: () => openEditMessage(hash),
              shortcut: "editMessage" as const
            },
            // A merge's changes are relative to more than one parent, so it has no single split.
            ...(commit.parentHashes.length < 2
              ? [{ title: more(l10n.splitCommit), onClick: () => openSplitCommit(hash) }]
              : []),
            ...(hasStagedChanges()
              ? [{ title: more(l10n.addStagedToCommit), onClick: () => openAddStaged(hash) }]
              : [])
          ]
        : []),
      {
        title: more(l10n.interactiveRebase),
        onClick: () => openInteractiveRebase(hash),
        shortcut: "interactiveRebase"
      },
      { title: more(l10n.createFixupMenu), onClick: () => openFixup(hash) },
      compareEntry(hash),
      { title: l10n.bisectChooseGood, onClick: () => chooseBisectCommit("good", hash) },
      { title: l10n.bisectChooseBad, onClick: () => chooseBisectCommit("bad", hash) },
      ...hostEntry(l10n.openCommitOnHost, commitPage(repositoryState.peek(), hash), "openOnHost"),
      { title: l10n.copyCommitHash, onClick: () => copyCommitId(hash), shortcut: "copyFullId" },
      {
        title: l10n.copyShortCommitHash,
        onClick: () => copyCommitId(abbrevCommit(hash)),
        shortcut: "copyShortId"
      }
    ]
  );
}

// Ref menus

/** Check out a local branch now, or ask how to check out a remote one. Tags are ignored. */
export function checkoutBranchAction(gitRef: GitRef) {
  if (gitRef.type === "head") {
    runAction({ command: "checkoutBranch", branchName: gitRef.name, remoteBranch: null });
  } else if (gitRef.type === "remote" && !isRemoteHead(gitRef)) {
    openRemoteAction("checkout", "", gitRef.name);
  }
}

function renameBranch(gitRef: GitRef) {
  const oldName = gitRef.name;
  openFormDialog({
    message: format(window.l10n.dialogRenameBranchTitle, named(oldName)),
    inputs: [{ kind: "ref", value: oldName }],
    action: window.l10n.dialogRenameBranchSubmit,
    source: refMenuSource(gitRef),
    onSubmit: ([newName]) => {
      if (newName === oldName) {
        closeDialog();
        return;
      }
      runAction({ command: "renameBranch", oldName, newName });
    }
  });
}

function deleteBranch(gitRef: GitRef) {
  openFormDialog({
    message: withExplanation(
      format(window.l10n.dialogDeleteConfirm, window.l10n.labelBranch, named(gitRef.name)),
      window.l10n.explainDeleteBranch
    ),
    inputs: [{ kind: "checkbox", label: window.l10n.dialogDeleteForceDelete, value: false }],
    action: window.l10n.deleteBranch,
    source: refMenuSource(gitRef),
    destructive: true,
    onSubmit: ([forceDelete]) =>
      runAction({ command: "deleteBranch", branchName: gitRef.name, forceDelete })
  });
}

function mergeBranch(gitRef: GitRef) {
  openFormDialog({
    message: format(window.l10n.dialogMergeConfirm, named(gitRef.name), currentBranch()),
    inputs: [{ kind: "checkbox", label: window.l10n.dialogMergeNoFastForward, value: true }],
    action: window.l10n.dialogYesMerge,
    source: refMenuSource(gitRef),
    onSubmit: ([createNewCommit]) =>
      runAction({ command: "mergeBranch", branchName: gitRef.name, createNewCommit })
  });
}

function deleteTag(gitRef: GitRef) {
  openFormDialog({
    message: format(window.l10n.dialogDeleteConfirm, window.l10n.labelTag, named(gitRef.name)),
    inputs: [],
    action: window.l10n.deleteTag,
    source: refMenuSource(gitRef),
    destructive: true,
    onSubmit: () => runAction({ command: "deleteTag", tagName: gitRef.name })
  });
}

function localBranchMenu(gitRef: GitRef, isHeadBranch: boolean) {
  const { name } = gitRef;
  const fullName = "refs/heads/" + name;
  const l10n = window.l10n;
  const upstream = { title: more(l10n.configureUpstream), onClick: () => openTracking(name) };
  const worktree = { title: more(l10n.addWorktree), onClick: () => openAddWorktree(fullName) };
  const push = { title: more(l10n.pushBranch), onClick: () => openRemoteAction("push", name) };
  const rename = { title: more(l10n.renameBranch), onClick: () => renameBranch(gitRef) };

  // Rebasing onto, checking out, deleting, or merging the checked-out branch has nothing to do;
  // pulling into it is offered instead.
  const tools: Array<Entry> = isHeadBranch
    ? [
        upstream,
        worktree,
        push,
        { title: more(l10n.pullBranch), onClick: () => openRemoteAction("pull", name) },
        rename
      ]
    : [
        upstream,
        worktree,
        { title: more(l10n.rebaseOnto), onClick: () => openRebase(fullName), shortcut: "rebase" },
        { title: l10n.checkoutBranch, onClick: () => checkoutBranchAction(gitRef) },
        push,
        rename,
        { title: more(l10n.deleteBranch), onClick: () => deleteBranch(gitRef) },
        { title: more(l10n.merge), onClick: () => mergeBranch(gitRef), shortcut: "merge" }
      ];
  return grouped([focusEntry(name), compareEntry(gitRef.hash)], tools, [
    ...hostEntry(l10n.openBranchOnHost, branchPage(repositoryState.peek(), name)),
    copyBranchEntry(name),
    hideLikeEntry(gitRef)
  ]);
}

function remoteBranchMenu(gitRef: GitRef) {
  const { name } = gitRef;
  const fullName = "refs/remotes/" + name;
  const l10n = window.l10n;
  const rebase: Entry = {
    title: more(l10n.rebaseOnto),
    onClick: () => openRebase(fullName),
    shortcut: "rebase"
  };
  const worktree = { title: more(l10n.addWorktree), onClick: () => openAddWorktree(fullName) };
  const fetch = { title: more(l10n.fetch), onClick: () => openRemoteAction("fetch", "", name) };

  if (isRemoteHead(gitRef)) {
    return grouped([compareEntry(gitRef.hash)], [rebase, worktree, fetch], [copyBranchEntry(name)]);
  }
  return grouped(
    [focusEntry("remotes/" + name), compareEntry(gitRef.hash)],
    [
      rebase,
      worktree,
      {
        title: more(l10n.deleteRemoteBranch),
        onClick: () => openRemoteAction("branchDelete", "", name)
      },
      fetch,
      { title: more(l10n.checkoutBranch), onClick: () => checkoutBranchAction(gitRef) }
    ],
    [copyBranchEntry(name), hideLikeEntry(gitRef)]
  );
}

function tagMenu(gitRef: GitRef) {
  const { name } = gitRef;
  const l10n = window.l10n;
  return grouped(
    [compareEntry(gitRef.hash)],
    [
      { title: more(l10n.deleteTag), onClick: () => deleteTag(gitRef) },
      { title: more(l10n.pushTag), onClick: () => openRemoteAction("tagPush", name) },
      { title: more(l10n.deleteRemoteTag), onClick: () => openRemoteAction("tagDelete", name) }
    ],
    [
      ...hostEntry(l10n.openTagOnHost, tagPage(repositoryState.peek(), name)),
      { title: l10n.copyTagName, onClick: () => copyToClipboard(window.l10n.typeTagName, name) }
    ]
  );
}

/** The menu of a branch or tag label. `isHeadBranch` marks the checked-out local branch. */
export function refMenu(gitRef: GitRef, isHeadBranch: boolean): Array<ContextMenuEntry> {
  switch (gitRef.type) {
    case "head":
      return localBranchMenu(gitRef, isHeadBranch);
    case "remote":
      return remoteBranchMenu(gitRef);
    case "tag":
      return tagMenu(gitRef);
  }
}
