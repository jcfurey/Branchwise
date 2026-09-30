import path from "node:path";

import type { SimpleGit } from "simple-git";
import * as vscode from "vscode";

import { checkoutBranch, createBranch, deleteBranch, renameBranch } from "@/backend/actions/branch";
import {
  checkoutCommit,
  cherrypickCommit,
  resetToCommit,
  revertCommit
} from "@/backend/actions/commit";
import { mergeBranch, mergeCommit } from "@/backend/actions/merge";
import { fetchRemote, pullBranch, pushBranch } from "@/backend/actions/remote";
import { runRepositoryAction } from "@/backend/actions/repository";
import type { RepositoryEffect } from "@/backend/actions/repository";
import { addTag, deleteTag, pushTag } from "@/backend/actions/tag";
import { gitClientFactory } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import { loadBranches } from "@/backend/queries/loadBranches";
import { loadCommits } from "@/backend/queries/loadCommits";
import { loadRemotes } from "@/backend/queries/loadRemotes";
import { repositoryQuery } from "@/backend/queries/repository";
import type {
  ActionRequest,
  GraphQueryCommand,
  RepositoryAction,
  RepositoryQueryData,
  RepositoryState,
  RestoreBackup
} from "@/backend/types";
import { remoteForRef } from "@/backend/utils/remoteVisibility";
import { isRepoWithinPath, normalizeRepoPath } from "@/backend/utils/repoPath";
import { abbrevCommit } from "@/backend/utils/string";
import type { Config } from "@/extension/config";
import { openConflict } from "@/extension/conflicts";
import { logger } from "@/extension/util/logger";
import {
  muteGitRepoWatcher,
  selectWatchedRepo,
  unmuteGitRepoWatcher
} from "@/extension/watchers/git-repo.watcher";
import { invalidateWorkspaceScan, listRepos } from "@/extension/workspace-scan";
import { encodeDiffBlobUri, encodeDiffDocUri } from "@/old-extension/diffDocProvider";
import type { RepoManager } from "@/old-extension/repoManager";
import type { WebviewBridge } from "@/old-extension/webviewBridge";
import type { RequestMessage, ResponseMessage } from "@/types";

/**
 * Every sentence this module shows the user. The l10n bundle lists keys in the order the export
 * first meets them, so the entries stay in this order and no other file of the module adds a key.
 */
const text = {
  addedIn: (hash: string) => vscode.l10n.t("Added by {0}", hash),
  deletedIn: (hash: string) => vscode.l10n.t("Deleted by {0}", hash),
  busy: () =>
    vscode.l10n.t("Another Git operation is running in this repository. Wait for it to finish."),
  cancelled: () => vscode.l10n.t("The Git operation was cancelled."),
  undoRestore: () => vscode.l10n.t("Undo Restore"),
  restored: (file: string) =>
    vscode.l10n.t(
      "Restored {0}. Its previous contents are kept in Git until its next garbage collection.",
      file
    ),
  unsavedBeforeRestore: (file: string) =>
    vscode.l10n.t(
      "Save or revert the unsaved changes to {0} in the editor first; saving them later would undo the restore.",
      file
    ),
  unsavedInPreview: (file: string) =>
    vscode.l10n.t(
      "The preview shows unsaved changes to {0}. Save or revert them before restoring.",
      file
    ),
  openItsGraph: () => vscode.l10n.t("Open Its Graph"),
  nestedRepository: (folder: string) =>
    vscode.l10n.t(
      "{0} is a separate Git repository inside this one, so its files are not changes of this repository.",
      folder
    ),
  stagedChanges: () => vscode.l10n.t("Staged Changes"),
  workingTreeChanges: () => vscode.l10n.t("Working Tree Changes")
};

type Request<C extends RequestMessage["command"]> = Extract<RequestMessage, { command: C }>;
type PlainActionRequest = Exclude<ActionRequest, { command: "repositoryAction" }>;
type RepositoryActionRequest = Request<"repositoryAction">;
type GraphRequest = Request<GraphQueryCommand>;

/** The actions that call one backend function of the same name. */
const PLAIN_ACTIONS = [
  "addTag",
  "deleteTag",
  "pushTag",
  "createBranch",
  "deleteBranch",
  "renameBranch",
  "checkoutBranch",
  "checkoutCommit",
  "cherrypickCommit",
  "revertCommit",
  "resetToCommit",
  "mergeBranch",
  "mergeCommit",
  "pushBranch",
  "pullBranch",
  "fetchRemote"
] as const satisfies readonly PlainActionRequest["command"][];

/** Repository actions that only open an editor. They neither wait for other actions nor block them. */
const VIEW_ONLY = new Set<RepositoryAction["kind"]>([
  "viewWorkingTreeFile",
  "viewRangeFile",
  "viewHistoricalFile",
  "previewFileRestore"
]);

/** Repository actions that may change the repositories below theirs as well. */
const WHOLE_TREE = new Set<RepositoryAction["kind"]>(["submodule", "submodulePointer"]);

/** How much of the file tree an action keeps to itself while it runs. */
type LockScope = "none" | "repository" | "wholeTree";

/** A repository an exclusive action is changing. */
type Hold = { repo: string; wholeTree: boolean };

// Actions outlive their graph panel. Every attachment must see their locks until the action
// settles, including a panel opened while an old panel's push or rebase is still running.
const held = new Set<Hold>();

/** A running request that the page can stop with its id. */
type Cancellable = { repo: string; controller: AbortController };

/** The commit id a diff URI names for a side that does not exist; its document is empty. */
const NO_COMMIT = "0".repeat(40);

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Let `work` finish unobserved. Nobody waits for it, so a failure is only logged. */
function detach(work: Thenable<unknown> | undefined, what: string) {
  void Promise.resolve(work).catch((error: unknown) => {
    logger.debug(`${what} failed`, error);
  });
}

/** Stop the request recorded under `requestId`, but only when it runs in `repo`. */
function cancel(running: Map<string | undefined, Cancellable>, repo: string, requestId: string) {
  const entry = running.get(requestId);
  if (entry !== undefined && entry.repo === repo) {
    entry.controller.abort();
  }
}

/** Whether two spellings of a repository path, such as `/repo` and `/repo/`, name one folder. */
function sameRepository(a: string, b: string) {
  return isRepoWithinPath(a, b) && isRepoWithinPath(b, a);
}

/**
 * Whether an exclusive action holds `repo`: the same repository, or one that holds its whole
 * tree above `repo`. A whole-tree action also waits for every busy repository below its own.
 */
function isBlocked(repo: string, wholeTree: boolean) {
  return [...held].some(
    (hold) =>
      sameRepository(hold.repo, repo) ||
      (hold.wholeTree && isRepoWithinPath(repo, hold.repo)) ||
      (wholeTree && isRepoWithinPath(hold.repo, repo))
  );
}

function scopeOf(action: RepositoryAction): LockScope {
  if (VIEW_ONLY.has(action.kind)) {
    return "none";
  }
  return WHOLE_TREE.has(action.kind) ? "wholeTree" : "repository";
}

/** Whether an editor holds unsaved changes to `file`, given relative to `repo`. */
function hasUnsavedEditor(repo: string, file: string) {
  const target = normalizeRepoPath(path.join(repo, file));
  return vscode.workspace.textDocuments.some(
    (document) =>
      document.isDirty &&
      document.uri.scheme === "file" &&
      normalizeRepoPath(document.uri.fsPath) === target
  );
}

/**
 * Refuse to restore a file, or to undo a restore, over unsaved edits: saving them afterwards
 * would silently replace what Git just wrote. A preview only warns.
 */
function checkUnsavedEditors(repo: string, action: RepositoryAction) {
  if (action.kind === "restoreFile" || action.kind === "undoRestore") {
    const file = action.kind === "restoreFile" ? action.plan.destination : action.backup.path;
    if (hasUnsavedEditor(repo, file)) {
      throw new Error(text.unsavedBeforeRestore(file));
    }
  } else if (action.kind === "previewFileRestore") {
    const file = action.plan.destination;
    if (hasUnsavedEditor(repo, file)) {
      detach(vscode.window.showWarningMessage(text.unsavedInPreview(file)), "The preview warning");
    }
  }
}

/** A diff side in an editor title: the short commit, or `∅` for a side that does not exist. */
function sideLabel(commit: string | null) {
  return commit === null ? "∅" : abbrevCommit(commit);
}

async function showDiff(left: vscode.Uri, right: vscode.Uri, title: string) {
  await vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true });
}

/** Explain that a folder is a repository of its own, and offer to open its graph. */
function explainNestedRepository(folder: string) {
  const open = text.openItsGraph();
  const choice = Promise.resolve(
    vscode.window.showInformationMessage(text.nestedRepository(folder), open)
  ).then((picked) =>
    picked === open
      ? vscode.commands.executeCommand("branchwise.view", { rootUri: vscode.Uri.file(folder) })
      : undefined
  );
  detach(choice, "Opening the nested repository");
}

/** Open whatever a repository action produced for the user to look at. */
async function openEffect(repo: string, effect: RepositoryEffect) {
  if (!effect) {
    return;
  }
  switch (effect.kind) {
    case "worktree":
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(effect.path), true);
      return;
    case "conflict":
      await openConflict(effect.path, effect.status);
      return;
    case "nestedRepository":
      explainNestedRepository(effect.path);
      return;
    case "document": {
      const document = await vscode.workspace.openTextDocument({
        language: "diff",
        content: effect.text
      });
      await vscode.window.showTextDocument(document, { preview: true });
      return;
    }
    case "diff":
      await showDiff(
        encodeDiffDocUri(repo, effect.before, effect.left ?? NO_COMMIT),
        encodeDiffDocUri(repo, effect.after, effect.right ?? NO_COMMIT),
        `${effect.after} (${sideLabel(effect.left)} ↔ ${sideLabel(effect.right)})`
      );
      return;
    case "workingTreeDiff": {
      const group = effect.staged ? text.stagedChanges() : text.workingTreeChanges();
      await showDiff(
        encodeDiffBlobUri(repo, effect.before, effect.left),
        effect.workingPath === null
          ? encodeDiffBlobUri(repo, effect.after, effect.right)
          : vscode.Uri.file(effect.workingPath),
        `${effect.after} (${group})`
      );
      return;
    }
    case "historicalFile":
      await vscode.commands.executeCommand(
        "vscode.open",
        encodeDiffDocUri(repo, effect.path, effect.hash),
        { preview: true }
      );
      return;
    case "restoreDiff":
      // `destination` is absolute here; a file that does not exist yet compares as empty.
      await showDiff(
        effect.exists
          ? vscode.Uri.file(effect.destination)
          : encodeDiffDocUri(repo, effect.sourcePath, NO_COMMIT),
        encodeDiffDocUri(repo, effect.sourcePath, effect.hash),
        `${effect.destination} ↔ ${effect.hash.slice(0, 12)}`
      );
      return;
    default:
      // A restore offers its undo once it has been answered; anything else opens nothing.
      return;
  }
}

/** Run the backend function behind a plain action, which takes the whole request. */
function runPlainAction(git: SimpleGit, request: PlainActionRequest, config: Config) {
  switch (request.command) {
    case "addTag":
      return addTag(git, request);
    case "deleteTag":
      return deleteTag(git, request);
    case "pushTag":
      return pushTag(git, request);
    case "createBranch":
      return createBranch(git, request);
    case "deleteBranch":
      return deleteBranch(git, request);
    case "renameBranch":
      return renameBranch(git, request);
    case "checkoutBranch":
      return checkoutBranch(git, request);
    case "checkoutCommit":
      return checkoutCommit(git, request);
    case "cherrypickCommit":
      return cherrypickCommit(git, request);
    case "revertCommit":
      return revertCommit(git, request);
    case "resetToCommit":
      return resetToCommit(git, request);
    case "mergeBranch":
      return mergeBranch(git, request, config.gitPath());
    case "mergeCommit":
      return mergeCommit(git, request, config.gitPath());
    case "pushBranch":
      return pushBranch(git, request);
    case "pullBranch":
      return pullBranch(git, request);
    case "fetchRemote":
      return fetchRemote(git, request);
  }
}

/**
 * Answer the graph page's `{ command }` requests: Git actions, repository and graph reads, the
 * selected repository, its saved view state and commit diffs. One registration serves one panel.
 * Actions are serialized per repository, and a newer graph read cancels the one it replaces.
 */
export function registerMessageHandlers(
  bridge: WebviewBridge,
  deps: { config: Config; repoManager: RepoManager }
): { dispose: () => void; onPanelShown: () => void } {
  // Settings are read when a request needs them, so a changed setting applies to the next one.
  const { config, repoManager } = deps;

  /** The repository the page shows, as far as the graph reads know. */
  let shownRepo: string | undefined;
  /** Keyed by request id; a page may send an action with the property present but undefined. */
  const cancellableActions = new Map<string | undefined, Cancellable>();
  const repositoryReads = new Map<string | undefined, Cancellable>();
  /** The running read of each graph command. */
  const graphReads = new Map<GraphQueryCommand, AbortController>();
  let undoRequests = 0;

  /** Post to the page. A page that is gone cannot receive anything, which is not an error here. */
  function send(message: ResponseMessage) {
    const lost = (error: unknown) => {
      logger.debug(`The graph page did not receive a ${message.command} message`, error);
    };
    try {
      void Promise.resolve(bridge.post(message)).catch(lost);
    } catch (error) {
      lost(error);
    }
  }

  function clientFor(repo: string, signal: AbortSignal) {
    return gitClientFactory(repo, config.gitPath(), signal).getInstance();
  }

  function answerAction(request: ActionRequest, status: string | null) {
    const { command, repo } = request;
    // The echoes go with the property, even when the page left its value undefined.
    send(
      Object.hasOwn(request, "requestId")
        ? { command, status, requestId: request.requestId as string, repo }
        : { command, status }
    );
  }

  /**
   * Take the repository as `scope` says, run `work` with a signal the page can fire through
   * `cancelAction`, give the repository back and answer. Never rejects for a Git failure.
   */
  async function runAction<T>(
    request: ActionRequest,
    scope: LockScope,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<{ status: string | null; result: T | undefined }> {
    const { repo } = request;
    let hold: Hold | undefined;
    if (scope !== "none") {
      const wholeTree = scope === "wholeTree";
      if (isBlocked(repo, wholeTree)) {
        const status = text.busy();
        answerAction(request, status);
        return { status, result: undefined };
      }
      hold = { repo, wholeTree };
      held.add(hold);
      // The action's own writes must not make the graph reload halfway through.
      muteGitRepoWatcher(repo);
    }
    const controller = new AbortController();
    const cancellable = Object.hasOwn(request, "requestId");
    if (cancellable) {
      cancellableActions.set(request.requestId, { repo, controller });
    }
    let status: string | null = null;
    let result: T | undefined;
    try {
      result = await work(controller.signal);
    } catch (error) {
      status = controller.signal.aborted ? text.cancelled() : errorText(error);
    } finally {
      if (cancellable) {
        cancellableActions.delete(request.requestId);
      }
      if (hold !== undefined) {
        held.delete(hold);
        unmuteGitRepoWatcher(repo);
      }
    }
    answerAction(request, status);
    return { status, result };
  }

  /** Save `names` as the hidden remotes of `repo`, and tell the page if the record changed. */
  function publishHiddenRemotes(repo: string, names: string[]) {
    const record = repoManager.updateHiddenRemotes(repo, names);
    if (record !== undefined) {
      send({ command: "repoState", repo, state: record });
    }
  }

  /** A hidden remote stays hidden under its new name, and is forgotten once removed. */
  function followRemoteChange(repo: string, action: RepositoryAction) {
    if (action.kind !== "renameRemote" && action.kind !== "removeRemote") {
      return;
    }
    const hidden = repoManager.getRepos()[repo]?.hiddenRemotes ?? [];
    const { name } = action;
    const newName = action.kind === "renameRemote" ? action.newName : undefined;
    publishHiddenRemotes(
      repo,
      newName === undefined
        ? hidden.filter((hiddenName) => hiddenName !== name)
        : hidden.map((hiddenName) => (hiddenName === name ? newName : hiddenName))
    );
  }

  async function repositoryAction(request: RepositoryActionRequest) {
    const { repo, action } = request;
    const { status, result: effect } = await runAction(request, scopeOf(action), async (signal) => {
      checkUnsavedEditors(repo, action);
      const produced = await runRepositoryAction(clientFor(repo, signal), action, config.gitPath());
      followRemoteChange(repo, action);
      await openEffect(repo, produced);
      if (action.kind === "submodule") {
        // A submodule may have appeared or gone, so the picker scans again.
        invalidateWorkspaceScan();
      }
      return produced;
    });
    if (effect?.kind === "restored" && effect.backup !== null) {
      offerUndo(repo, effect.backup);
    }
    return status;
  }

  /**
   * Offer to put back what a restore replaced. The undo runs as a request of its own, answered
   * to the page like any other, after which the page reloads whatever the outcome.
   */
  function offerUndo(repo: string, backup: RestoreBackup) {
    const undo = text.undoRestore();
    const offer = Promise.resolve(
      vscode.window.showInformationMessage(text.restored(backup.path), undo)
    ).then(async (choice) => {
      if (choice !== undo) {
        return;
      }
      undoRequests += 1;
      const status = await repositoryAction({
        command: "repositoryAction",
        repo,
        requestId: `undo-restore-${undoRequests}`,
        action: { kind: "undoRestore", backup }
      });
      send({ command: "refresh" });
      if (status !== null) {
        detach(vscode.window.showErrorMessage(status), "Reporting the failed undo");
      }
    });
    detach(offer, "Undo Restore");
  }

  /** The picker's repositories, with the one the page asks from first when the scan missed it. */
  async function workspaceRepos(current: string) {
    await repoManager.pruneMissing();
    const listed = await listRepos(config.gitPath(), config.maxDepthOfRepoSearch());
    return listed.includes(current) ? listed : [current, ...listed];
  }

  /**
   * Drop hidden remotes that no longer exist, such as one renamed outside Branchwise. A remote
   * that is gone from the configuration but still has remote-tracking refs stays hidden.
   */
  function reconcileHiddenRemotes(repo: string, state: RepositoryState, hidden: string[]) {
    const configured = state.remotes.map((remote) => remote.name);
    const withRefs = new Set(state.remoteBranches.map((ref) => remoteForRef(ref.name, configured)));
    publishHiddenRemotes(
      repo,
      hidden.filter((name) => configured.includes(name) || withRefs.has(name))
    );
  }

  async function onRepositoryQuery(request: Request<"repositoryQuery">) {
    const { repo, requestId, query } = request;
    const controller = new AbortController();
    repositoryReads.set(requestId, { repo, controller });
    // Compared by identity afterwards: any save meanwhile means the page changed something.
    const savedBefore = query.kind === "state" ? repoManager.getRepos()[repo] : undefined;
    let data: RepositoryQueryData | null;
    let status: string | null = null;
    try {
      const git = clientFor(repo, controller.signal);
      const repos = query.kind === "workspace" ? await workspaceRepos(repo) : [];
      data = await repositoryQuery(git, query, {
        repos,
        binary: config.gitPath(),
        signal: controller.signal
      });
    } catch (error) {
      data = null;
      status = errorText(error);
    }
    repositoryReads.delete(requestId);
    if (controller.signal.aborted) {
      return;
    }
    if (
      query.kind === "state" &&
      data?.kind === "state" &&
      ![...held].some((hold) => sameRepository(hold.repo, repo)) &&
      repoManager.getRepos()[repo] === savedBefore
    ) {
      reconcileHiddenRemotes(repo, data.state, savedBefore?.hiddenRemotes ?? []);
    }
    send({ command: "repositoryQuery", repo, requestId, data, status });
  }

  async function onLoadRemotes({ repo, requestId, branchName }: Request<"loadRemotes">) {
    let message: ResponseMessage;
    try {
      const git = gitClientFactory(repo, config.gitPath()).getInstance();
      const settings = await loadRemotes(git, branchName);
      message = { ...settings, command: "loadRemotes", repo, requestId, status: null };
    } catch (error) {
      message = {
        command: "loadRemotes",
        repo,
        requestId,
        remotes: [],
        upstream: null,
        pushRemote: null,
        status: errorText(error)
      };
    }
    send(message);
  }

  function abortGraphReads() {
    for (const controller of graphReads.values()) {
      controller.abort();
    }
    graphReads.clear();
  }

  /**
   * Make `repo` the shown repository: stop the reads of the previous one and watch this one. A
   * watcher that cannot start costs refreshes, not the read, so its failure is only logged.
   */
  function showRepo(repo: string) {
    if (repo === shownRepo) {
      return;
    }
    abortGraphReads();
    shownRepo = repo;
    try {
      selectWatchedRepo(repo, config.gitPath());
    } catch (error) {
      logger.debug(`Unable to select repository: ${repo}`, error);
    }
  }

  /** Run a graph read latest-wins. A read that was cancelled answers nothing at all. */
  async function graphRead(
    request: GraphRequest,
    read: (git: SimpleGit) => Promise<ResponseMessage>
  ) {
    const { command, repo, requestId } = request;
    showRepo(repo);
    graphReads.get(command)?.abort();
    const controller = new AbortController();
    graphReads.set(command, controller);
    let message: ResponseMessage;
    try {
      message = await read(clientFor(repo, controller.signal));
    } catch (error) {
      message = {
        command: "graphQueryError",
        query: command,
        repo,
        requestId,
        message: errorText(error)
      };
    } finally {
      if (graphReads.get(command) === controller) {
        graphReads.delete(command);
      }
    }
    if (!controller.signal.aborted) {
      send(message);
    }
  }

  async function onViewDiff(request: Request<"viewDiff">) {
    const { repo, commitHash, oldFilePath, newFilePath, type } = request;
    const short = abbrevCommit(commitHash);
    const name = newFilePath.slice(newFilePath.lastIndexOf("/") + 1);
    const change =
      type === "A"
        ? text.addedIn(short)
        : type === "D"
          ? text.deletedIn(short)
          : `${short}^ ↔ ${short}`;
    let success = true;
    try {
      // The left side is the old path at the first parent, so an added file compares with nothing.
      await showDiff(
        encodeDiffDocUri(repo, oldFilePath, `${commitHash}^`),
        encodeDiffDocUri(repo, newFilePath, commitHash),
        `${name} (${change})`
      );
    } catch (error) {
      logger.error(`Unable to open the diff of ${newFilePath} at ${short}`, error);
      success = false;
    }
    send({ command: "viewDiff", success });
  }

  for (const command of PLAIN_ACTIONS) {
    bridge.onMessage(command, async (request) => {
      await runAction(request, "repository", (signal) =>
        runPlainAction(clientFor(request.repo, signal), request, config)
      );
    });
  }
  bridge.onMessage("repositoryAction", async (request) => {
    await repositoryAction(request);
  });

  bridge.onMessage("cancelAction", ({ repo, requestId }) => {
    cancel(cancellableActions, repo, requestId);
  });
  bridge.onMessage("cancelRepositoryQuery", ({ repo, requestId }) => {
    cancel(repositoryReads, repo, requestId);
  });

  bridge.onMessage("repositoryQuery", onRepositoryQuery);
  bridge.onMessage("loadRemotes", onLoadRemotes);

  bridge.onMessage("loadCommits", (request) =>
    graphRead(request, async (git) => {
      const result = await loadCommits(git, {
        branchName: request.branchName,
        maxCommits: request.maxCommits,
        hiddenRemotes: request.hiddenRemotes ?? [],
        showRemoteBranches: request.showRemoteBranches,
        hard: request.hard,
        dateType: config.dateType(),
        showUncommittedChanges: config.showUncommittedChanges()
      });
      return {
        ...result,
        command: "loadCommits",
        repo: request.repo,
        requestId: request.requestId,
        branchName: request.branchName,
        visibilityKey: request.visibilityKey
      };
    })
  );
  bridge.onMessage("loadBranches", (request) =>
    graphRead(request, async (git) => {
      const result = await loadBranches(git, {
        showRemoteBranches: request.showRemoteBranches,
        hiddenRemotes: request.hiddenRemotes ?? [],
        hard: request.hard,
        repo: request.repo,
        gitPath: config.gitPath()
      });
      return {
        ...result,
        command: "loadBranches",
        visibilityKey: request.visibilityKey,
        repo: request.repo,
        requestId: request.requestId
      };
    })
  );
  bridge.onMessage("commitDetails", (request) =>
    graphRead(request, async (git) => {
      const result = await commitDetails(git, {
        commitHash: request.commitHash,
        dateType: config.dateType()
      });
      return {
        ...result,
        command: "commitDetails",
        repo: request.repo,
        requestId: request.requestId
      };
    })
  );

  bridge.onMessage("selectRepo", ({ repo }) => {
    send({
      command: "repoState",
      repo,
      state: repoManager.getRepos()[repo] ?? { columnWidths: null }
    });
    showRepo(repo);
  });
  bridge.onMessage("saveRepoState", ({ repo, state }) => {
    // Fields the page sends replace the saved ones; the others stay.
    repoManager.setRepoState(repo, {
      columnWidths: null,
      ...repoManager.getRepos()[repo],
      ...state
    });
  });
  bridge.onMessage("viewDiff", onViewDiff);

  return {
    // Actions, their Undo offers and remote reads are left to finish: stopping a push or a
    // rebase halfway would do more harm than an answer nobody reads.
    dispose() {
      abortGraphReads();
      for (const { controller } of repositoryReads.values()) {
        controller.abort();
      }
      repositoryReads.clear();
    },
    onPanelShown() {
      shownRepo = undefined;
    }
  };
}
