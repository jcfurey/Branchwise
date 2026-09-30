import * as vscode from "vscode";

/** Opens the shipped guide, rendered where the Markdown extension is available. */
export async function openDocumentation(ctx: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(ctx.extensionUri, "docs", "git-actions.md");
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    await vscode.commands.executeCommand("vscode.open", uri);
  }
}

export async function openWalkthrough(ctx: vscode.ExtensionContext): Promise<void> {
  const { publisher, name } = ctx.extension.packageJSON as { publisher: string; name: string };
  await vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    `${publisher}.${name}#gettingStarted`,
    false
  );
}

/** Runs one of this extension's commands on behalf of the webview. */
export async function runCommand(command: string): Promise<boolean> {
  await vscode.commands.executeCommand(command);
  return true;
}
