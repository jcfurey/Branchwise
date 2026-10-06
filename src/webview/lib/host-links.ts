import type { RepositoryState } from "@/backend/types";
import {
  type IssueTracker,
  remoteTracker,
  repositoryTracker,
  upstreamRemote
} from "@/webview/lib/commit-message";

/** A web page of the repository's host, with the host's name for the entry that opens it. */
export type HostPage = { host: string; url: string };

/** A ref name in a URL path: each segment escaped, the slashes between them kept. */
function refPath(name: string) {
  return name.split("/").map(encodeURIComponent).join("/");
}

/** The page at `path` below the repository. GitLab keeps a project's own pages below `/-/`. */
function hostPage(tracker: IssueTracker, path: string): HostPage {
  return tracker.kind === "github"
    ? { host: "GitHub", url: `${tracker.base}/${path}` }
    : { host: "GitLab", url: `${tracker.base}/-/${path}` };
}

/** A commit's page on the host the repository's issues link to, or `null` when it is unknown. */
export function commitPage(state: RepositoryState | null, hash: string): HostPage | null {
  const tracker = repositoryTracker(state);
  return tracker === null ? null : hostPage(tracker, `commit/${encodeURIComponent(hash)}`);
}

/** A tag's page on the host the repository's issues link to, or `null` when it is unknown. */
export function tagPage(state: RepositoryState | null, tag: string): HostPage | null {
  const tracker = repositoryTracker(state);
  if (tracker === null) {
    return null;
  }
  const path = tracker.kind === "github" ? "releases/tag/" : "tags/";
  return hostPage(tracker, path + refPath(tag));
}

/**
 * The page of the branch a local branch tracks, on its remote's host. `null` unless the branch
 * tracks a remote branch on a known host that still has it; the remote's branch name, which may
 * differ from the local one, is the one opened.
 */
export function branchPage(state: RepositoryState | null, branch: string): HostPage | null {
  const details = state?.branches.find((item) => item.name === branch);
  if (state === null || details === undefined || details.upstream === "" || details.gone) {
    return null;
  }
  const remote = upstreamRemote(state, details.upstream);
  const tracker = remote === null ? null : remoteTracker(remote);
  if (remote === null || tracker === null) {
    return null;
  }
  return hostPage(tracker, "tree/" + refPath(details.upstream.slice(remote.name.length + 1)));
}
