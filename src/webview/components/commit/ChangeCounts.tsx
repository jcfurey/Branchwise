import type { CommitStats } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { commitStatsOf } from "@/webview/lib/commit-stats";
import { selectedRepo } from "@/webview/lib/stores";
import { changeCounts, changeSummary } from "@/webview/utils/changes";

/** The lines a commit added and deleted, `+12 −3`, in the theme's added and deleted colours. */
export function ChangeCounts({ stats }: { stats: CommitStats }) {
  const { added, deleted } = changeCounts(stats);
  return (
    <span class="tabular-nums">
      <span class="text-git-added">{added}</span> <span class="text-git-deleted">{deleted}</span>
    </span>
  );
}

/**
 * A row's cell of the Changes column. It stays empty until the counts are read, and for the
 * uncommitted changes; its tooltip names the files as well as the lines.
 */
export function ChangesCell({ hash, class: className }: { hash: string; class: string }) {
  const stats = hash === UNCOMMITTED_CHANGES ? undefined : commitStatsOf(selectedRepo.value, hash);
  return (
    <td
      class={className}
      title={stats === undefined ? undefined : changeSummary(stats)}
      data-changes
    >
      {stats !== undefined && <ChangeCounts stats={stats} />}
    </td>
  );
}
