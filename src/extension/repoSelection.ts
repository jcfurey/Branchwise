import type * as vscode from "vscode";

import { normalizeRepoPath } from "@/backend/utils/repoPath";

export function getSourceControlRepo(sourceControl?: Pick<vscode.SourceControl, "rootUri">) {
  const repoPath = sourceControl?.rootUri?.fsPath;
  return typeof repoPath === "string" && repoPath.length > 0
    ? normalizeRepoPath(repoPath)
    : undefined;
}

/**
 * Retain the latest SCM button click until the webview can receive the selection.
 * `onReady` runs once the webview reports that it listens.
 */
export function createRepoSelection(
  webview: vscode.Webview,
  send: (repo: string) => void,
  onReady?: () => void
) {
  let ready = false;
  let pendingRepo: string | undefined;

  function flush() {
    if (ready && pendingRepo !== undefined) {
      const repo = pendingRepo;
      pendingRepo = undefined;
      send(repo);
    }
  }

  const listener = webview.onDidReceiveMessage((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "viewReady"
    ) {
      ready = true;
      onReady?.();
      flush();
    }
  });

  return {
    select(repo: string) {
      pendingRepo = normalizeRepoPath(repo);
      flush();
    },
    dispose() {
      listener.dispose();
      ready = false;
      pendingRepo = undefined;
    }
  };
}
