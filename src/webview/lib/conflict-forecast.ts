import type { ConflictForecastEntry, RepositoryQuery } from "@/backend/types";
import { hiddenBranchPatterns, hiddenRemotes, showRemoteBranch } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";

type ForecastQuery = Extract<RepositoryQuery, { kind: "conflictForecast" }>;

/**
 * The forecast the graph and the Branches pane ask for, or `null` while the setting is `off`.
 * Remote branches the graph hides are left out of it, so a change to what is hidden asks again.
 */
export function conflictForecastQuery(): ForecastQuery | null {
  const setting = getWebviewConfig().conflictForecast;
  if (setting === "off") {
    return null;
  }
  if (setting === "local" || !showRemoteBranch.value) {
    return { kind: "conflictForecast", scope: "local" };
  }
  return {
    kind: "conflictForecast",
    scope: "localAndRemote",
    hiddenRemotes: hiddenRemotes.value,
    hiddenBranchPatterns: hiddenBranchPatterns.value
  };
}

/**
 * The forecast by branch, spelt as in the branch list: a local branch by its name, a remote one
 * as `remotes/<remote>/<branch>`, so that a local branch named like a remote one stays apart.
 */
export function conflictsByBranch(
  conflicts: ReadonlyArray<ConflictForecastEntry> | undefined
): ReadonlyMap<string, ConflictForecastEntry> {
  return new Map(
    conflicts?.map((entry) => [entry.remote ? `remotes/${entry.branch}` : entry.branch, entry])
  );
}
