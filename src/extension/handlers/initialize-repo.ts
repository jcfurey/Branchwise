import * as vscode from "vscode";

/**
 * Start VS Code's own "Initialize Repository" flow, which asks where to create it. Resolves once
 * the flow ends, cancelled or not. The `.git` watcher reports a new repository in the workspace.
 */
export async function initializeRepo(): Promise<boolean> {
  await vscode.commands.executeCommand("git.init");
  return true;
}
