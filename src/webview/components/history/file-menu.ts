import type { TreeEntry } from "@/backend/types";
import { openFileHistory, openRestoreFile } from "@/webview/components/history/HistoryTools";
import { copyToClipboard } from "@/webview/lib/actions/clipboard";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import type { ContextMenuEntry } from "@/webview/types";

export function fileContextMenu(
  hash: string,
  file: string,
  before = file,
  deleted = false,
  destination = file
): ContextMenuEntry[] {
  const revision = deleted ? hash + "^" : hash;
  const historicalPath = deleted ? before : file;
  return [
    { title: window.l10n.fileHistory, onClick: () => openFileHistory(historicalPath, revision) },
    {
      title: window.l10n.openHistoricalFile,
      onClick: () =>
        sendRepositoryAction({ kind: "viewHistoricalFile", hash: revision, path: historicalPath })
    },
    {
      title: window.l10n.restoreHistoricalFile,
      onClick: () => openRestoreFile(revision, historicalPath, destination || file)
    }
  ];
}

/**
 * The menu of an entry in a commit's whole tree. A submodule has no contents of its own to open,
 * so it offers only its path and its history.
 */
export function treeFileMenu(hash: string, entry: TreeEntry): ContextMenuEntry[] {
  const { path } = entry;
  const open: ContextMenuEntry[] =
    entry.kind === "submodule"
      ? []
      : [
          {
            title: window.l10n.openHistoricalFile,
            onClick: () => sendRepositoryAction({ kind: "viewHistoricalFile", hash, path })
          },
          {
            title: window.l10n.openCurrentFile,
            onClick: () => sendRepositoryAction({ kind: "viewCurrentFile", path })
          }
        ];
  return [
    ...open,
    {
      title: window.l10n.copyPath,
      onClick: () => void copyToClipboard(window.l10n.typeFilePath, path)
    },
    { title: window.l10n.fileHistory, onClick: () => openFileHistory(path, hash) }
  ];
}
