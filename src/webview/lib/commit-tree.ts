import { useEffect, useState } from "preact/hooks";

import type { TreeEntry } from "@/backend/types";
import { requestPanelQuery } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { LazyTree } from "@/webview/utils/allFiles";

/** A commit's tree as the page keeps it: its files, and whether Git listed more than these. */
export type CommitTree = { tree: LazyTree; more: boolean };

/** How many commits' trees are kept. A commit's tree never changes, so a kept one stays right. */
const KEPT_TREES = 8;

/** Trees read so far, by repository and commit, the most recently used last. */
const trees = new Map<string, CommitTree>();

function keyOf(repo: string, hash: string) {
  return JSON.stringify([repo, hash]);
}

function keep(key: string, entries: ReadonlyArray<TreeEntry>, more: boolean) {
  const kept = { tree: new LazyTree(entries), more };
  trees.set(key, kept);
  for (const oldest of trees.keys()) {
    if (trees.size <= KEPT_TREES) {
      break;
    }
    trees.delete(oldest);
  }
  return kept;
}

/** Look a kept tree up, and mark it as the most recently used. */
function recall(key: string) {
  const kept = trees.get(key);
  if (kept !== undefined) {
    trees.delete(key);
    trees.set(key, kept);
  }
  return kept;
}

/**
 * Every file of the commit `hash` in the selected repository, read the first time a component
 * asks for it and kept for the next. `null` while it loads; `error` says why it failed.
 */
export function useCommitTree(hash: string): { data: CommitTree | null; error: string | null } {
  const repo = selectedRepo.value;
  const key = repo === undefined ? null : keyOf(repo, hash);
  const [answer, setAnswer] = useState<{
    key: string;
    data: CommitTree | null;
    error: string | null;
  } | null>(null);
  const kept = key === null ? undefined : recall(key);

  useEffect(() => {
    if (key === null || kept !== undefined) {
      return;
    }
    return requestPanelQuery(
      { kind: "tree", hash },
      (data, error) => {
        if (data?.kind === "tree") {
          setAnswer({ key, data: keep(key, data.entries, data.more), error: null });
        } else {
          setAnswer({ key, data: null, error: error ?? "" });
        }
      },
      repo
    );
  }, [key]);

  if (kept !== undefined) {
    return { data: kept, error: null };
  }
  return answer?.key === key
    ? { data: answer.data, error: answer.error }
    : { data: null, error: null };
}

/** Forget every kept tree. For tests. */
export function forgetCommitTrees(): void {
  trees.clear();
}
