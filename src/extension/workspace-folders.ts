import * as vscode from "vscode";

import { logger } from "@/extension/util/logger";

/**
 * Local paths of the workspace folders Git can read. Folders of virtual file systems, such as a
 * repository opened from the web, have no local path, so they are skipped and logged.
 */
export function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).flatMap((folder) => {
    if (folder.uri.scheme !== "file") {
      logger.warn(`Skipping workspace folder without a local path: ${folder.uri.toString()}`);
      return [];
    }
    return [folder.uri.fsPath];
  });
}
