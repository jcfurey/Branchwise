import * as vscode from "vscode";

import { extConfig } from "@/extension/config";
import { getWebviewLocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { WebviewConfig, WebviewInitialize } from "@/types";

/** The settings the page displays with, read now. Sent again whenever one of them changes. */
export function webviewConfig(): WebviewConfig {
  return {
    autoCenterCommitDetailsView: extConfig.autoCenterCommitDetailsView(),
    branchHoverPreview: extConfig.branchHoverPreview(),
    commitHoverCards: extConfig.commitHoverCards(),
    conflictForecast: extConfig.conflictForecast(),
    dateFormat: extConfig.dateFormat(),
    dateSeparators: extConfig.dateSeparators(),
    dragAndDrop: extConfig.dragAndDrop(),
    graphColours: extConfig.graphColours(),
    graphStyle: extConfig.graphStyle(),
    initialLoadCommits: extConfig.initialLoadCommits(),
    issueLinks: extConfig.issueLinks(),
    loadMoreCommits: extConfig.loadMoreCommits(),
    markAppliedCommits: extConfig.markAppliedCommits(),
    // Dates are formatted for VS Code's display language.
    locale: vscode.env.language,
    rowDensity: extConfig.rowDensity(),
    overviewMarkers: extConfig.overviewMarkers(),
    showChangesColumn: extConfig.showChangesColumn(),
    showCurrentBranchByDefault: extConfig.showCurrentBranchByDefault(),
    showNearestBranch: extConfig.showNearestBranch(),
    showWorktrees: extConfig.showWorktrees(),
    singleKeyShortcuts: extConfig.singleKeyShortcuts()
  };
}

/** Everything the page needs before it can render: its strings and its settings. */
export async function webviewInitialize(): Promise<WebviewInitialize> {
  return { l10n: getWebviewLocalizedStrings(), config: webviewConfig() };
}
