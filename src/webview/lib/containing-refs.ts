import { useEffect, useState } from "preact/hooks";

import type { ContainingRefs, RepositoryQuery } from "@/backend/types";
import { repositoryRevision, requestPanelQuery } from "@/webview/lib/repository-actions";
import { hiddenRemotes, selectedRepo, showRemoteBranch } from "@/webview/lib/stores";
import { branchPatternScope } from "@/webview/lib/stores/hidden-branches.store";

/** Answers remembered at most; the oldest goes first. */
const CACHE_SIZE = 200;

/**
 * Answers by repository, commit and branch visibility, each with the `repositoryRevision` it was
 * read at. Which refs contain a commit changes only when refs move, and every such change bumps
 * the revision, so an answer from an earlier revision is shown only until it has been read again.
 */
const cache = new Map<string, { revision: number; refs: ContainingRefs }>();

function remember(key: string, revision: number, refs: ContainingRefs) {
  cache.delete(key);
  if (cache.size >= CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, { revision, refs });
}

/**
 * The branches and tags that contain `hash`, and the tag it follows, under the graph's branch
 * visibility. Asked for after the caller first renders, so it never holds anything else up, and
 * cancelled when the caller goes away or asks about another commit. `refs` is `null` while
 * the first answer loads and after a failure, which `loading` tells apart.
 */
export function useContainingRefs(hash: string): { refs: ContainingRefs | null; loading: boolean } {
  const repo = selectedRepo.value;
  const revision = repositoryRevision.value;
  const query: Extract<RepositoryQuery, { kind: "containingRefs" }> = {
    kind: "containingRefs",
    hash,
    showRemoteBranches: showRemoteBranch.value,
    hiddenRemotes: hiddenRemotes.value,
    ...branchPatternScope()
  };
  const key = JSON.stringify([repo, query]);
  const read = JSON.stringify([key, revision]);
  const entry = cache.get(key);
  const fresh = entry?.revision === revision;
  // The read that failed last, and a count that changes with every answer to draw it.
  const [failed, setFailed] = useState<string | null>(null);
  const [, setAnswers] = useState(0);
  useEffect(() => {
    if (repo === undefined || fresh) {
      return;
    }
    return requestPanelQuery(
      query,
      (data) => {
        if (data?.kind === "containingRefs") {
          remember(key, revision, {
            branches: data.branches,
            tags: data.tags,
            follows: data.follows
          });
        } else {
          cache.delete(key);
          setFailed(read);
        }
        setAnswers((count) => count + 1);
      },
      repo
    );
  }, [read]);
  // After a refresh the last answer stays up until the new one comes, so nothing flickers.
  return {
    refs: entry?.refs ?? null,
    loading: repo !== undefined && !fresh && failed !== read
  };
}
