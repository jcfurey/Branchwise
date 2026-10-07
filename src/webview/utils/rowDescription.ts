import type { ConflictForecastEntry, GitRef, HistoryEntry } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { repositoryState } from "@/webview/lib/repository-actions";
import { getRelativeDate } from "@/webview/utils/date";

/** What a commit row shows, as far as its spoken summary needs it. */
export type RowFacts = {
  subject: string;
  author: string;
  /** How long ago the commit was made, such as "3 days ago". */
  age: string;
  /** Different parents the commit names, loaded or not. */
  parents: number;
  isHead: boolean;
  push: "unpushed" | "unpulled" | undefined;
  /**
   * What a branch on the row would conflict with if merged, such as `main`, when the conflict
   * forecast marks one; otherwise `null`.
   */
  conflictsWith: string | null;
  /**
   * The checked-out branch, such as `main`, when it already has the commit's change under another
   * commit; otherwise absent or `null`.
   */
  appliedIn?: string | null;
  /** The row's branches and tags, in the order they are shown. */
  refs: ReadonlyArray<GitRef>;
};

/**
 * One line that says what a commit row shows, for screen readers, which otherwise hear the cells
 * but nothing of the dot, the markers or the labels' kinds: "Fix the parser, Ann Lee, 3 days
 * ago, merge of 2 parents, unpushed, has conflicts with main, already in main, branch topic,
 * tag v1.0".
 */
export function describeCommitRow(facts: RowFacts): string {
  const l10n = window.l10n;
  const parts = [facts.subject, facts.author, facts.age];
  if (facts.isHead) {
    parts.push(l10n.rowHead);
  }
  if (facts.parents > 1) {
    parts.push(l10n.rowMergeOf.replace("{0}", String(facts.parents)));
  }
  if (facts.push !== undefined) {
    parts.push(facts.push === "unpushed" ? l10n.rowUnpushed : l10n.rowUnpulled);
  }
  if (facts.conflictsWith !== null) {
    // Function replacements insert names as written, even when they contain `$`.
    const into = facts.conflictsWith;
    parts.push(l10n.rowConflictsWith.replace("{0}", () => into));
  }
  if (facts.appliedIn !== undefined && facts.appliedIn !== null) {
    const into = facts.appliedIn;
    parts.push(l10n.rowApplied.replace("{0}", () => into));
  }
  for (const ref of facts.refs) {
    const kind =
      ref.type === "head" ? l10n.rowBranch : ref.type === "tag" ? l10n.rowTag : l10n.rowRemote;
    parts.push(kind.replace("{0}", () => ref.name));
  }
  return parts.filter((part) => part !== "").join(", ");
}

/** How many different parents a commit names. */
function parentCount(parentHashes: ReadonlyArray<string>) {
  return parentHashes.length > 1 ? new Set(parentHashes).size : parentHashes.length;
}

/**
 * The spoken summary of a row of the commit table. `message` is the text the row shows, which
 * for the uncommitted changes is all there is to say. A remote's `HEAD`, such as `origin/HEAD`,
 * only names the remote's default branch and is left out, as the row's labels leave it out.
 */
export function commitRowLabel({
  commit,
  message,
  isHead,
  headBranch,
  push,
  conflicts,
  applied = false
}: {
  commit: HistoryEntry;
  message: string;
  isHead: boolean;
  headBranch: string | null;
  push: RowFacts["push"];
  /** The conflict forecast by branch, a remote one under `remotes/`, as the table holds it. */
  conflicts: ReadonlyMap<string, ConflictForecastEntry> | undefined;
  /** Whether the checked-out branch already has the commit's change under another commit. */
  applied?: boolean;
}): string {
  if (commit.hash === UNCOMMITTED_CHANGES) {
    return message;
  }
  const refs = commit.refs.filter((ref) => !(ref.type === "remote" && ref.name.endsWith("/HEAD")));
  // The checked-out branch's label leads, as on the row.
  const current = refs.findIndex((ref) => ref.type === "head" && ref.name === headBranch);
  if (current > 0) {
    refs.unshift(...refs.splice(current, 1));
  }
  const conflicting = refs.some((ref) => {
    if (ref.type === "tag") {
      return false;
    }
    const entry = conflicts?.get(ref.type === "remote" ? `remotes/${ref.name}` : ref.name);
    return (entry?.files.length ?? 0) > 0;
  });
  return describeCommitRow({
    subject: message,
    author: commit.author,
    age: getRelativeDate(commit.date),
    parents: parentCount(commit.parentHashes),
    isHead,
    push,
    conflictsWith: conflicting ? repositoryState.value?.head || "HEAD" : null,
    appliedIn: applied ? headBranch || "HEAD" : null,
    refs
  });
}
