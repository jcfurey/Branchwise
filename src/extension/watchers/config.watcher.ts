import * as vscode from "vscode";

import { webviewConfig } from "@/extension/handlers/initialize";
import { rpcNotify } from "@/extension/rpc/rpc-notify";
import { logger } from "@/extension/util/logger";

/** Settings that decide which repositories the workspace scan finds. */
const REPO_SEARCH_SETTINGS = [
  "git.path",
  "branchwise.maxDepthOfRepoSearch",
  "branchwise.nestedRepoSearchDepth"
];

/**
 * Tell the graph when settings change: a new repository search asks it to scan again, and any
 * Branchwise setting sends it the current display settings. `onTabIcon` is called when the
 * setting for the tab's icon changes, which the tab's owner applies. Disposing the result stops
 * all of it.
 */
export function initConfigWatcher(onTabIcon?: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("branchwise.tabIconColourTheme")) {
      onTabIcon?.();
    }
    if (REPO_SEARCH_SETTINGS.some((setting) => event.affectsConfiguration(setting))) {
      logger.info("Configuration changed");
      void rpcNotify.notify("repo.rescan", null);
    }
    if (event.affectsConfiguration("branchwise")) {
      void rpcNotify.notify("config.changed", webviewConfig());
    }
  });
}
