import type { HistoryFilter } from "@/backend/types";
import { openFileHistory, openRestoreFile } from "@/webview/components/history/HistoryTools";
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

/** The entry that opens how commit `hash` of a line history changed the lines it follows. */
export function lineChangesEntry(hash: string, filter: HistoryFilter): ContextMenuEntry {
  return {
    title: window.l10n.lineChanges,
    onClick: () =>
      sendRepositoryAction({
        kind: "viewLineChanges",
        hash,
        path: filter.path,
        lines: filter.lines ?? "",
        revision: filter.revision
      })
  };
}
