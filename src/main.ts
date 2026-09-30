import * as l10n from "@vscode/l10n";
import * as vscode from "vscode";

import { resolveBuiltInGitPath } from "@/extension/config";
import { EXTENSION_NAME } from "@/extension/constants";
import { openDocumentation, openWalkthrough } from "@/extension/handlers/onboarding";
import { migrateSettings } from "@/extension/migrate-settings";
import { logger } from "@/extension/util/logger";
import { createViewCommand } from "@/extension/view-command";
import { registerFileHistoryCommand } from "@/old-extension/fileHistoryCommand";

/**
 * Set the extension up for this window. Everything here is synchronous: the settings copy and the
 * Git lookup run in the background, and no Git process starts until the graph is opened. VS Code
 * disposes what is pushed to `ctx.subscriptions` when the extension deactivates.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  // The log comes first so that every later step can write to it.
  logger.init(ctx);

  // Neither rejects, and nothing below needs their results.
  void migrateSettings(ctx);
  void resolveBuiltInGitPath();

  // Backend messages are translated by the standalone library, which needs VS Code's bundle.
  l10n.config({ contents: vscode.l10n.bundle ?? {} });

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusItem.name = EXTENSION_NAME;
  statusItem.command = "branchwise.view";
  statusItem.text = `$(type-hierarchy) ${EXTENSION_NAME}`;
  statusItem.tooltip = vscode.l10n.t("View Graph");
  statusItem.show();
  ctx.subscriptions.push(statusItem);

  const view = createViewCommand(ctx);
  ctx.subscriptions.push(
    // Source Control passes itself as the first argument, which selects its repository.
    vscode.commands.registerCommand("branchwise.view", view),
    vscode.commands.registerCommand("branchwise.showBranches", () => view.showPane("refs")),
    // Returning the promises lets `executeCommand` settle once the page has opened.
    vscode.commands.registerCommand("branchwise.openDocumentation", () => openDocumentation(ctx)),
    vscode.commands.registerCommand("branchwise.openWalkthrough", () => openWalkthrough(ctx))
  );

  registerFileHistoryCommand(ctx, (repo, file) => view({ rootUri: vscode.Uri.file(repo) }, file));

  logger.info("Extension activated");
}
