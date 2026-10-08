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
 * `useRepositoryQuery` for a read that takes long, such as the status of every repository in the
 * workspace. A new revision does not stop the read under way: stopping it would start the read
 * over on every change, and while the repository keeps changing none would ever finish. The read
 * finishes and shows, and one more then starts if the revision moved on meanwhile, however often
 * it did. Another repository or query still stops the read under way.
 */
export function useSettledRepositoryQuery<K extends RepositoryQuery["kind"]>(
  query: Extract<RepositoryQuery, { kind: K }> | null,
  repo = selectedRepo.value
) {
  type Data = Extract<RepositoryQueryData, { kind: K }>;
  const revision = repositoryRevision.value;
  const baseKey = JSON.stringify([repo, query]);
  const [result, setResult] = useState<{
    baseKey: string;
    revision: number;
    data: Data | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (query === null || repo === undefined) {
      return;
    }
    let cancel: (() => void) | null = null;
    const read = () => {
      const started = repositoryRevision.peek();
      cancel = requestPanelQuery(
        query,
        (data, error) => {
          cancel = null;
          setResult({
            baseKey,
            revision: started,
            data: data?.kind === query.kind ? (data as Data) : null,
            error
          });
          if (repositoryRevision.peek() !== started) {
            read();
          }
        },
        repo
      );
    };
    // Called at once, then on every new revision; a read under way picks those up when done.
    const stop = repositoryRevision.subscribe(() => {
      if (cancel === null) {
        read();
      }
    });
    return () => {
      stop();
      cancel?.();
    };
  }, [baseKey]);
  return {
    data: result?.baseKey === baseKey ? result.data : null,
    error: result?.baseKey === baseKey ? result.error : null,
    loading: query !== null && (result?.baseKey !== baseKey || result.revision !== revision)
  };
}
