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
