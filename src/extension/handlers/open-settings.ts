import * as vscode from "vscode";

/** Opens the Settings editor filtered to this extension's settings. */
export async function openExtensionSettings(): Promise<boolean> {
  await vscode.commands.executeCommand("workbench.action.openSettings", "branchwise");
  return true;
}
