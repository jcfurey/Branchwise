import { useEffect, useState } from "preact/hooks";

import type { RepositoryQuery, RepositoryQueryData } from "@/backend/types";
import { repositoryRevision, requestPanelQuery } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";

export function useRepositoryQuery<K extends RepositoryQuery["kind"]>(
  query: Extract<RepositoryQuery, { kind: K }> | null,
  repo = selectedRepo.value
) {
  type Data = Extract<RepositoryQueryData, { kind: K }>;
  const revision = repositoryRevision.value;
  const baseKey = JSON.stringify([repo, query]);
  const key = JSON.stringify([baseKey, revision]);
  const [result, setResult] = useState<{
    key: string;
    baseKey: string;
    data: Data | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (query === null || repo === undefined) {
      return;
    }
    return requestPanelQuery(
      query,
      (data, error) =>
        setResult({ key, baseKey, data: data?.kind === query.kind ? (data as Data) : null, error }),
      repo
    );
  }, [key]);
  return {
    data: result?.baseKey === baseKey ? result.data : null,
    error: result?.key === key ? result.error : null,
    loading: query !== null && result?.key !== key
  };
}

/**
 * An answer to a settled read, the revision the read started at, and when the answer came, as a
 * count of the answers to every settled read so far.
 */
type Settled = {
  revision: number;
  data: RepositoryQueryData | null;
  error: string | null;
  answered: number;
};

/** How many answers settled reads have had, which orders them. */
let answers = 0;

/** One shared read, and the components showing it. */
type SettledRead = {
  listeners: Set<(answer: Settled) => void>;
  latest: Settled | null;
  /** Stops the read under way; null while none is. */
  cancel: (() => void) | null;
  read: () => void;
  /** Stops following the revision. */
  unfollow: () => void;
};

/**
 * The reads of `useSettledRepositoryQuery`, one for each repository and query, which every
 * component showing that query shares: the Workspace pane and the workspace sync dialog list the
 * same repositories, and two listings at once would each take twice as long.
 */
const settledReads = new Map<string, SettledRead>();

/**
 * Show the answers to `query` about `repo` to `listener` until the returned function is called.
 * A listener that arrives during a read joins it; otherwise it starts one, and is shown the last
 * answer, if any, meanwhile.
 */
function followSettledRead(
  baseKey: string,
  query: RepositoryQuery,
  repo: string,
  listener: (answer: Settled) => void
): () => void {
  let shared = settledReads.get(baseKey);
  if (shared === undefined) {
    const entry: SettledRead = {
      listeners: new Set(),
      latest: null,
      cancel: null,
      read: () => {
        const started = repositoryRevision.peek();
        entry.cancel = requestPanelQuery(
          query,
          (data, error) => {
            entry.cancel = null;
            entry.latest = { revision: started, data, error, answered: ++answers };
            for (const each of entry.listeners) {
              each(entry.latest);
            }
            if (repositoryRevision.peek() !== started) {
              entry.read();
            }
          },
          repo
        );
      },
      unfollow: () => {}
    };
    // `subscribe` calls back at once too; the first read is the listener's, below.
    let first = true;
    entry.unfollow = repositoryRevision.subscribe(() => {
      if (first) {
        first = false;
      } else if (entry.cancel === null) {
        entry.read();
      }
    });
    settledReads.set(baseKey, entry);
    shared = entry;
  }
  const read = shared;
  read.listeners.add(listener);
  if (read.latest !== null) {
    listener(read.latest);
  }
  if (read.cancel === null) {
    read.read();
  }
  return () => {
    read.listeners.delete(listener);
    if (read.listeners.size === 0) {
      read.unfollow();
      read.cancel?.();
      settledReads.delete(baseKey);
    }
  };
}

/**
 * `useRepositoryQuery` for a read that takes long, such as the status of every repository in the
 * workspace. A new revision does not stop the read under way: stopping it would start the read
 * over on every change, and while the repository keeps changing none would ever finish. The read
 * finishes and shows, and one more then starts if the revision moved on meanwhile, however often
 * it did. Components showing the same query share one read. Another repository or query still
 * stops the read under way once nothing shows it. `answered` tells which of two reads answered
 * last, and is 0 before the first answer.
 */
export function useSettledRepositoryQuery<K extends RepositoryQuery["kind"]>(
  query: Extract<RepositoryQuery, { kind: K }> | null,
  repo = selectedRepo.value
) {
  type Data = Extract<RepositoryQueryData, { kind: K }>;
  const revision = repositoryRevision.value;
  const baseKey = JSON.stringify([repo, query]);
  const [result, setResult] = useState<(Settled & { baseKey: string }) | null>(null);
  useEffect(() => {
    if (query === null || repo === undefined) {
      return;
    }
    return followSettledRead(baseKey, query, repo, (answer) => setResult({ ...answer, baseKey }));
  }, [baseKey]);
  const shown = result?.baseKey === baseKey ? result : null;
  return {
    data: shown?.data?.kind === query?.kind ? (shown?.data as Data | null) : null,
    error: shown?.error ?? null,
    loading: query !== null && (shown === null || shown.revision !== revision),
    answered: shown?.answered ?? 0
  };
}
