import * as vscode from "vscode";

import { extConfig } from "@/extension/config";
import { getWebviewLocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import type { WebviewConfig, WebviewInitialize } from "@/types";

/** The settings the page displays with, read now. Sent again whenever one of them changes. */
export function webviewConfig(): WebviewConfig {
  return {
    autoCenterCommitDetailsView: extConfig.autoCenterCommitDetailsView(),
    dateFormat: extConfig.dateFormat(),
    graphColours: extConfig.graphColours(),
    graphStyle: extConfig.graphStyle(),
    initialLoadCommits: extConfig.initialLoadCommits(),
    loadMoreCommits: extConfig.loadMoreCommits(),
    // Dates are formatted for VS Code's display language.
    locale: vscode.env.language,
    showCurrentBranchByDefault: extConfig.showCurrentBranchByDefault(),
    singleKeyShortcuts: extConfig.singleKeyShortcuts()
  };
}

/** Everything the page needs before it can render: its strings and its settings. */
export async function webviewInitialize(): Promise<WebviewInitialize> {
  return { l10n: getWebviewLocalizedStrings(), config: webviewConfig() };
}
