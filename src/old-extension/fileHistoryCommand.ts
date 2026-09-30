import path from "node:path";

import * as vscode from "vscode";

import { gitClientFactory } from "@/backend/gitClient";
import { workTreeRoot } from "@/backend/utils/git";
import { extConfig } from "@/extension/config";

export function registerFileHistoryCommand(
  ctx: vscode.ExtensionContext,
  open: (repo: string, file: string) => void
) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("branchwise.fileHistory", async (uri?: vscode.Uri) => {
      try {
        const file = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!file || !["file", "vscode-remote"].includes(file.scheme)) {
          throw new Error(vscode.l10n.t("Select a workspace file to view its history."));
        }
        const folder = path.dirname(file.fsPath);
        const git = gitClientFactory(folder, extConfig.gitPath()).getInstance();
        // The folder's path within the repository holds even when the file was opened through
        // a symlink, which a path relative to the repository's real location would not.
        const [repo, prefix] = await Promise.all([
          workTreeRoot(folder, extConfig.gitPath()),
          git.raw(["rev-parse", "--show-prefix"])
        ]);
        if (repo === null) {
          throw new Error(vscode.l10n.t("Select a workspace file to view its history."));
        }
        open(repo, prefix.replace(/\n$/, "") + path.basename(file.fsPath));
      } catch (error) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t(
            "Unable to open file history: {0}",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    })
  );
}
