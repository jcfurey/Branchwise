import * as vscode from "vscode";

import { rpcNotify } from "@/extension/rpc/rpc-notify";
import { createDebouncer, type FsWatcherEvent } from "@/extension/util/debounce";
import { logger } from "@/extension/util/logger";
import { invalidateWorkspaceScan } from "@/extension/workspace-scan";

/** Forget the cached workspace scan and have the graph ask for the repository list again. */
function rescan(reason: string) {
  logger.info(reason);
  invalidateWorkspaceScan();
  void rpcNotify.notify("repo.rescan", null);
}

/**
 * Rescan when a `.git` entry appears or disappears anywhere in the workspace folders, or when the
 * folders themselves change. Every reported path counts: the depth-limited scan decides whether
 * the picker lists anything new.
 */
export function watchGitDir(): vscode.Disposable {
  // `.git` is a directory in an ordinary repository and a file in a linked worktree or a
  // submodule. The glob matches both, but nothing inside a `.git` directory.
  const watcher = vscode.workspace.createFileSystemWatcher("**/.git", false, true, false);
  const debouncer = createDebouncer();
  const onGitEntry = (type: FsWatcherEvent) => (uri: vscode.Uri) =>
    debouncer.debounce(type, uri, async (kind, entry) => {
      rescan(`Git directory ${kind}: ${entry.fsPath}`);
    });

  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(onGitEntry("created")),
    watcher.onDidDelete(onGitEntry("deleted")),
    vscode.workspace.onDidChangeWorkspaceFolders(() => rescan("Workspace folders changed")),
    debouncer
  );
}
