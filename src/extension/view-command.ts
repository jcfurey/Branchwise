import { basename } from "node:path";

import * as vscode from "vscode";

import { workTreeRoot } from "@/backend/utils/git";
import { extConfig } from "@/extension/config";
import { EXTENSION_NAME } from "@/extension/constants";
import { createWebviewHtml } from "@/extension/html";
import { createMessageProtocol } from "@/extension/legacy";
import { createRepoSelection, getSourceControlRepo } from "@/extension/repoSelection";
import { initRpcNotify, rpcNotify } from "@/extension/rpc/rpc-notify";
import { createRpcServer } from "@/extension/rpc/rpc-server";
import { initConfigWatcher } from "@/extension/watchers/config.watcher";
import { watchGitRepo } from "@/extension/watchers/git-repo.watcher";
import { watchGitDir } from "@/extension/watchers/git.watcher";
import { addSessionRepo } from "@/extension/workspace-scan";
import type { ResponseMessage, SidebarPane } from "@/types";

type ViewCommand = {
  (sourceControl?: Pick<vscode.SourceControl, "rootUri">, file?: string): void;
  showPane(pane: SidebarPane): void;
};

/** A file whose history the page should show once it has selected `repo`. */
type FileHistoryRequest = { repo: string; path: string };

/** The graph panel while it is open, with everything that lives and dies with it. */
type OpenGraph = {
  panel: vscode.WebviewPanel;
  selection: ReturnType<typeof createRepoSelection>;
  /** Whether the page has reported that it listens. */
  ready: boolean;
  attachments: vscode.Disposable[];
};

/**
 * The `branchwise.view` command. It opens the one graph panel or brings it forward, selects the
 * repository of a Source Control or File History click, and opens side panes on request.
 */
export function createViewCommand(ctx: vscode.ExtensionContext): ViewCommand {
  // Both serve every panel of the session.
  const protocol = createMessageProtocol(ctx);
  const rpcServer = createRpcServer();

  let graph: OpenGraph | undefined;
  let pendingFile: FileHistoryRequest | undefined;
  let pendingPane: SidebarPane | undefined;
  /** Counts clicks with a folder; only the latest one may select its repository. */
  let clicks = 0;

  function showPendingPane() {
    if (graph?.ready && pendingPane !== undefined) {
      const pane = pendingPane;
      pendingPane = undefined;
      void rpcNotify.notify("view.showPane", { pane });
    }
  }

  function onPageReady(opened: OpenGraph) {
    opened.ready = true;
    // The pane goes first; the selection sends its pending repository after this returns.
    showPendingPane();
  }

  function onRepoSent(webview: vscode.Webview, repo: string) {
    // The notification is posted within this call, so the page selects the repository before
    // it receives the file history below.
    void rpcNotify.notify("repo.select", { name: basename(repo), path: repo });
    if (pendingFile?.repo === repo) {
      const message: ResponseMessage = { command: "fileHistory", repo, path: pendingFile.path };
      pendingFile = undefined;
      void Promise.resolve(webview.postMessage(message)).catch(() => {});
    }
  }

  /** Select the repository that contains a clicked folder, once Git has named its top level. */
  async function followClick(folder: string, file: string | undefined) {
    const click = ++clicks;
    const top = await workTreeRoot(folder, extConfig.gitPath()).catch(() => null);
    const repo = top ?? folder;
    // Offer it in the picker even when a newer click or a closed panel means it is not selected.
    addSessionRepo(repo);
    if (click !== clicks || graph === undefined) {
      return;
    }
    pendingFile = file === undefined ? undefined : { repo, path: file };
    graph.selection.select(repo);
  }

  function openGraph(): OpenGraph {
    const extensionUri = ctx.extensionUri;
    const panel = vscode.window.createWebviewPanel(
      "branchwise",
      EXTENSION_NAME,
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "out")]
      }
    );
    panel.iconPath =
      extConfig.tabIconColourTheme() === "colour"
        ? vscode.Uri.joinPath(extensionUri, "resources", "webview-icon.svg")
        : {
            light: vscode.Uri.joinPath(extensionUri, "resources", "webview-icon-light.svg"),
            dark: vscode.Uri.joinPath(extensionUri, "resources", "webview-icon-dark.svg")
          };

    const attachments = [
      protocol.attach(panel),
      rpcServer.attach(panel.webview),
      initRpcNotify(panel.webview),
      initConfigWatcher(),
      watchGitDir(),
      watchGitRepo()
    ];
    const opened: OpenGraph = {
      panel,
      attachments,
      ready: false,
      selection: createRepoSelection(
        panel.webview,
        (repo) => onRepoSent(panel.webview, repo),
        () => onPageReady(opened)
      )
    };
    // Every listener exists before the page loads, so none of its messages is missed.
    panel.webview.html = createWebviewHtml(ctx, panel.webview);

    panel.onDidDispose(() => {
      if (graph !== opened) {
        return;
      }
      // Requests for this page end with it; the next panel starts afresh.
      graph = undefined;
      pendingFile = undefined;
      pendingPane = undefined;
      for (const attachment of opened.attachments) {
        attachment.dispose();
      }
      opened.selection.dispose();
    });
    return opened;
  }

  function view(sourceControl?: Pick<vscode.SourceControl, "rootUri">, file?: string): void {
    // Only a click with a folder selects a repository. A call without one leaves a pending file
    // history alone: the page shows it once ready, unless a newer click or the panel's closing
    // comes first.
    const folder = getSourceControlRepo(sourceControl);
    if (folder !== undefined) {
      void followClick(folder, file);
    }

    if (graph === undefined) {
      graph = openGraph();
    } else {
      graph.panel.reveal(vscode.window.activeTextEditor?.viewColumn);
    }
  }

  function showPane(pane: SidebarPane): void {
    // Only the last pane asked for before the page is ready is shown.
    pendingPane = pane;
    view();
    showPendingPane();
  }

  return Object.assign(view, { showPane });
}
