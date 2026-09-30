import * as vscode from "vscode";

import { gitClientFactory } from "@/backend/gitClient";
import { extConfig } from "@/extension/config";
import { DiffDocProvider } from "@/old-extension/diffDocProvider";
import { ExtensionState } from "@/old-extension/extensionState";
import { registerMessageHandlers } from "@/old-extension/messageHandler";
import { createRepoManager } from "@/old-extension/repoManager";
import { webviewBridgeFactory } from "@/old-extension/webviewBridge";

/**
 * The `{ command }` message protocol that drives graph queries and Git actions. Created once per
 * activation: every graph panel attached to it shares the saved per-repository state, and the
 * provider behind `branchwise:` diff documents lives until deactivation.
 */
export function createMessageProtocol(ctx: vscode.ExtensionContext) {
  // Creating the state also clears the avatar cache that earlier versions kept.
  const repoManager = createRepoManager(new ExtensionState(ctx));

  const documents = new DiffDocProvider(
    // Read the Git path per document, so a changed setting applies to the next diff.
    (repo) => gitClientFactory(repo, extConfig.gitPath()).getInstance(),
    // Diff editors restored from an earlier session may load repositories this workspace saved.
    (repo) => Object.hasOwn(repoManager.getRepos(), repo)
  );
  const registration = vscode.workspace.registerTextDocumentContentProvider(
    DiffDocProvider.scheme,
    documents
  );
  ctx.subscriptions.push({
    dispose() {
      registration.dispose();
      documents.dispose();
    }
  });

  return {
    /**
     * Serve the protocol on `panel` until the result is disposed. Everything is in place when
     * this returns, so a page loaded afterwards cannot send a message nobody hears.
     */
    attach(panel: vscode.WebviewPanel): { dispose(): void } {
      let visible = panel.visible;
      const bridge = webviewBridgeFactory(panel.webview);
      const handlers = registerMessageHandlers(bridge, { config: extConfig, repoManager });

      const viewState = panel.onDidChangeViewState(() => {
        // Focus and column changes fire this too; only a change of visibility matters.
        if (panel.visible === visible) {
          return;
        }
        visible = panel.visible;
        if (visible) {
          // Forget the page's repository first, so the reload the refresh starts counts as a new
          // selection. A post that fails means the panel is going away; there is nothing to do.
          handlers.onPanelShown();
          void Promise.resolve(bridge.post({ command: "refresh" })).catch(() => {});
        }
      });

      let attached = true;
      return {
        dispose() {
          if (!attached) {
            return;
          }
          attached = false;
          handlers.dispose();
          bridge.dispose();
          viewState.dispose();
        }
      };
    }
  };
}
