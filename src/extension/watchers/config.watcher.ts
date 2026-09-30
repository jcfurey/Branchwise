import * as vscode from "vscode";

import { webviewConfig } from "@/extension/handlers/initialize";
import { rpcNotify } from "@/extension/rpc/rpc-notify";
import { logger } from "@/extension/util/logger";

/** Settings that decide which repositories the workspace scan finds. */
const REPO_SEARCH_SETTINGS = ["git.path", "branchwise.maxDepthOfRepoSearch"];

/**
 * Tell the graph when settings change: a new repository search asks it to scan again, and any
 * Branchwise setting sends it the current display settings. Disposing the result stops both.
 */
export function initConfigWatcher(): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (REPO_SEARCH_SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
      logger.info("Configuration changed");
      void rpcNotify.notify("repo.rescan", null);
    }
    if (event.affectsConfiguration("branchwise")) {
      void rpcNotify.notify("config.changed", webviewConfig());
    }
  });
}
