import * as vscode from "vscode";

/**
 * Start VS Code's own "Initialize Repository" flow, which asks where to create it. Resolves once
 * the flow ends, cancelled or not. The `.git` watcher reports a new repository in the workspace.
 */
export async function initializeRepo(): Promise<boolean> {
  await vscode.commands.executeCommand("git.init");
  return true;
}

/**
 * Start VS Code's own "Clone Repository" flow, which asks for the address and the folder, and
 * offers to open the clone. Resolves once the flow ends, cancelled or not.
 */
export async function cloneRepo(): Promise<boolean> {
  await vscode.commands.executeCommand("git.clone");
  return true;
}

/**
 * Ask for a folder and open it in this window, as File > Open Folder does. Opening one reloads
 * the window, so the answer may never arrive; a cancelled choice resolves.
 */
export async function openFolder(): Promise<boolean> {
  await vscode.commands.executeCommand("vscode.openFolder");
  return true;
}
