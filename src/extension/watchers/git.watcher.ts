import { lstat } from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import { rpcNotify } from "@/extension/rpc/rpc-notify";
import { logger } from "@/extension/util/logger";
import { holdsOfferedRepo, invalidateWorkspaceScan } from "@/extension/workspace-scan";

/**
 * How long the workspace must stay quiet before it is scanned again. VS Code hands events over
 * in batches about 100 ms apart, and one change often arrives in two of them.
 */
const QUIET_MS = 250;
/** The longest a scan waits for that quiet, when repositories keep appearing. */
const LONGEST_WAIT_MS = 2000;

/**
 * How many new paths are looked into at a time. More than that at once is a build or an install,
 * not a clone, and is left alone.
 */
const NEW_PATHS_AT_ONCE = 32;
/** A new path here is never a repository the scan lists, and `.git` entries report themselves. */
const NEVER_A_REPOSITORY = /[\\/](\.git|node_modules|bower_components)([\\/]|$)/;

/** Forget the cached workspace scan and have the graph ask for the repository list again. */
function rescan(reason: string) {
  logger.info(reason);
  invalidateWorkspaceScan();
  void rpcNotify.notify("repo.rescan", null);
}

/**
 * Rescan when a `.git` entry appears or disappears anywhere in the workspace folders, when a
 * folder that holds a repository comes or goes, or when the workspace folders themselves change.
 * Every reported `.git` entry counts: the depth-limited scan decides whether the picker lists
 * anything new. One scan answers for everything reported while it waited, as when a clone
 * brings its submodules one after another.
 */
export function watchGitDir(): vscode.Disposable {
  // `.git` is a directory in an ordinary repository and a file in a linked worktree or a
  // submodule. The glob matches both, but nothing inside a `.git` directory.
  const entries = vscode.workspace.createFileSystemWatcher("**/.git", false, true, false);
  // VS Code reports a folder that was deleted, renamed or moved alone, and nothing for what it
  // held, so the `.git` entry of a repository that came or went with its folder is never seen.
  // On Linux the same holds for a folder filled as soon as it is made, as a clone is.
  const folders = vscode.workspace.createFileSystemWatcher("**", false, true, false);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingSince = 0;
  const soon = (reason: string) => {
    const now = Date.now();
    if (timer === undefined) {
      waitingSince = now;
    }
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = undefined;
        rescan(reason);
      },
      Math.min(QUIET_MS, Math.max(0, waitingSince + LONGEST_WAIT_MS - now))
    );
  };

  let lookingInto = 0;
  let closed = false;
  const onCreated = (uri: vscode.Uri) => {
    const created = uri.fsPath;
    if (lookingInto >= NEW_PATHS_AT_ONCE || NEVER_A_REPOSITORY.test(created)) {
      return;
    }
    lookingInto++;
    // A file where a folder is needed, or nothing there at all, fails the same way.
    void lstat(path.join(created, ".git"))
      .then(
        () => !closed && soon(`Repository folder created: ${created}`),
        () => {}
      )
      .finally(() => lookingInto--);
  };

  return vscode.Disposable.from(
    entries,
    folders,
    entries.onDidCreate((uri) => soon(`Git directory created: ${uri.fsPath}`)),
    entries.onDidDelete((uri) => soon(`Git directory deleted: ${uri.fsPath}`)),
    folders.onDidCreate(onCreated),
    folders.onDidDelete((uri) => {
      if (holdsOfferedRepo(uri.fsPath)) {
        soon(`Repository folder deleted: ${uri.fsPath}`);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => rescan("Workspace folders changed")),
    {
      dispose: () => {
        closed = true;
        clearTimeout(timer);
        timer = undefined;
      }
    }
  );
}
