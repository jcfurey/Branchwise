import { stat } from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

type GitExtension = {
  enabled: boolean;
  getAPI(version: 1): { getRepository(uri: vscode.Uri): unknown };
};

/** Conflicts where both sides changed the file, so the merge editor has all three versions. */
const MERGEABLE = new Set(["UU", "AA"]);

/**
 * Whether VS Code's Git extension tracks the repository of `uri`. Its merge-editor command
 * returns without an error for repositories it does not know, such as one deeper than its scan
 * depth, so the extension must be asked first.
 */
async function gitExtensionTracks(uri: vscode.Uri) {
  try {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    const git = extension?.isActive ? extension.exports : await extension?.activate();
    return git?.enabled === true && git.getAPI(1).getRepository(uri) !== null;
  } catch {
    return false;
  }
}

/**
 * Open a conflicted file: in the merge editor when VS Code's Git extension can show it, as a
 * plain file otherwise, and with an explanation when neither side kept the file.
 */
export async function openConflict(file: string, status: string) {
  const uri = vscode.Uri.file(file);
  if (MERGEABLE.has(status) && (await gitExtensionTracks(uri))) {
    await vscode.commands.executeCommand("git.openMergeEditor", uri);
    return;
  }
  if (
    await stat(file).then(
      () => true,
      () => false
    )
  ) {
    await vscode.commands.executeCommand("vscode.open", uri);
    return;
  }
  void vscode.window.showInformationMessage(
    status === "DD"
      ? vscode.l10n.t(
          "Both sides deleted {0}. Stage its deletion to resolve the conflict.",
          path.basename(file)
        )
      : vscode.l10n.t(
          "{0} is not in the working tree. Restore it or stage its deletion to resolve the conflict.",
          path.basename(file)
        )
  );
}
