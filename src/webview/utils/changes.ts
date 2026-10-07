import type { CommitStats } from "@/backend/types";
import { format } from "@/webview/utils/format";

/** A localized phrase for `count`, in the singular for exactly one. */
function counted(count: number, one: string, many: string) {
  return format(count === 1 ? one : many, count).join("");
}

/** The lines a commit added and deleted, as the Changes column shows them: `+12` and `−3`. */
export function changeCounts({ additions, deletions }: CommitStats): {
  added: string;
  deleted: string;
} {
  // U+2212, the minus sign, which is as wide as the plus sign.
  return { added: `+${additions}`, deleted: `−${deletions}` };
}

/** How many files a commit changed, such as "4 files changed". */
export function filesChanged({ files }: CommitStats): string {
  const l10n = window.l10n;
  return counted(files, l10n.filesChanged, l10n.filesChangedPlural);
}

/** The whole count in words, such as "4 files changed, 12 insertions, 3 deletions". */
export function changeSummary(stats: CommitStats): string {
  const l10n = window.l10n;
  return format(
    l10n.changesSummary,
    filesChanged(stats),
    counted(stats.additions, l10n.insertions, l10n.insertionsPlural),
    counted(stats.deletions, l10n.deletions, l10n.deletionsPlural)
  ).join("");
}
