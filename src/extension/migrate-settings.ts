import * as vscode from "vscode";

import { logger } from "@/extension/util/logger";

/** The settings section before the extension was renamed to Branchwise. */
const PREVIOUS_SECTION = "neo-git-graph";
const SECTION = "branchwise";
const MIGRATED = "settingsCopiedFromNeoGitGraph";

/** The settings to copy: each one the extension declares, except `fetchAvatars`, which does nothing. */
export const MIGRATED_SETTINGS = [
  "autoCenterCommitDetailsView",
  "dateFormat",
  "dateType",
  "graphColours",
  "graphStyle",
  "initialLoadCommits",
  "loadMoreCommits",
  "maxDepthOfRepoSearch",
  "showCurrentBranchByDefault",
  "showUncommittedChanges",
  "tabIconColourTheme"
];

/**
 * Copy the settings saved under the extension's name before the rename: the user settings once,
 * and a workspace's settings the first time it opens. A setting already saved under the new name
 * is kept, and the old settings stay for anyone still running the old extension.
 */
export async function migrateSettings(ctx: vscode.ExtensionContext): Promise<void> {
  try {
    if (!ctx.globalState.get(MIGRATED, false)) {
      await copySettings(vscode.ConfigurationTarget.Global);
      await ctx.globalState.update(MIGRATED, true);
    }
    if (
      vscode.workspace.workspaceFolders !== undefined &&
      !ctx.workspaceState.get(MIGRATED, false)
    ) {
      await copySettings(vscode.ConfigurationTarget.Workspace);
      await ctx.workspaceState.update(MIGRATED, true);
    }
  } catch (error) {
    logger.warn(`Unable to copy the ${PREVIOUS_SECTION} settings`, error);
  }
}

async function copySettings(target: vscode.ConfigurationTarget) {
  const scope = target === vscode.ConfigurationTarget.Global ? "globalValue" : "workspaceValue";
  const previous = vscode.workspace.getConfiguration(PREVIOUS_SECTION);
  const current = vscode.workspace.getConfiguration(SECTION);
  for (const key of MIGRATED_SETTINGS) {
    const value = previous.inspect(key)?.[scope];
    if (value !== undefined && current.inspect(key)?.[scope] === undefined) {
      // One at a time: each update rewrites the same settings file.
      // eslint-disable-next-line no-await-in-loop
      await current.update(key, value, target);
      logger.info(`Copied ${PREVIOUS_SECTION}.${key} to ${SECTION}.${key}`);
    }
  }
}
