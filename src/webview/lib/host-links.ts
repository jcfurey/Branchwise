import type { RemoteDetails, RepositoryState } from "@/backend/types";
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

/** A pull request on GitHub and a merge request on GitLab: what a branch is reviewed through. */
export type ReviewRequest = { kind: IssueTracker["kind"]; url: string };

/**
 * The page that starts a pull request (GitHub) or a merge request (GitLab) from `branch`, as the
 * remote names it, into `base`. With no base the host proposes the repository's default branch.
 */
export function reviewRequestUrl(tracker: IssueTracker, branch: string, base: string | null) {
  if (tracker.kind === "github") {
    const range = base === null ? refPath(branch) : `${refPath(base)}...${refPath(branch)}`;
    return `${tracker.base}/compare/${range}?expand=1`;
  }
  const fields = [`merge_request[source_branch]=${encodeURIComponent(branch)}`];
  if (base !== null) {
    fields.push(`merge_request[target_branch]=${encodeURIComponent(base)}`);
  }
  return `${tracker.base}/-/merge_requests/new?${fields.join("&")}`;
}

/**
 * The review request for `branch` of `remote`, into the remote's default branch when it is
 * known. `null` when the remote is not on a known host, or the branch is the default branch,
 * which has nothing to merge into.
 */
function remoteReviewRequest(remote: RemoteDetails, branch: string): ReviewRequest | null {
  const tracker = remoteTracker(remote);
  if (tracker === null || branch === "HEAD" || branch === remote.defaultBranch) {
    return null;
  }
  return {
    kind: tracker.kind,
    url: reviewRequestUrl(tracker, branch, remote.defaultBranch ?? null)
  };
}

/** The remote a branch without an upstream is first pushed to, as the push dialog suggests it. */
function firstPushRemote(state: RepositoryState) {
  return (
    state.remotes.find((remote) => remote.name === state.pushDefault) ??
    state.remotes.find((remote) => remote.name === "origin") ??
    state.remotes[0] ??
    null
  );
}

/**
 * How a local branch is put up for review. A branch that tracks a branch on a known host opens
 * that branch's request page; one with no upstream, or whose upstream was deleted, has to be
 * pushed first (`push`), to a remote on a known host. `null` when neither applies.
 */
export function branchReviewRequest(
  state: RepositoryState | null,
  branch: string
): (ReviewRequest & { push: false }) | { kind: IssueTracker["kind"]; push: true } | null {
  const details = state?.branches.find((item) => item.name === branch);
  if (state === null || details === undefined) {
    return null;
  }
  const remote = details.upstream === "" ? null : upstreamRemote(state, details.upstream);
  if (remote !== null && !details.gone) {
    const request = remoteReviewRequest(remote, details.upstream.slice(remote.name.length + 1));
    return request === null ? null : { ...request, push: false };
  }
  const target = firstPushRemote(state);
  const tracker = target === null ? null : remoteTracker(target);
  if (target === null || tracker === null || branch === target.defaultBranch) {
    return null;
  }
  return { kind: tracker.kind, push: true };
}

/** The review request for a remote-tracking branch such as `origin/topic`. */
export function remoteBranchReviewRequest(
  state: RepositoryState | null,
  name: string
): ReviewRequest | null {
  const remote = state === null ? null : upstreamRemote(state, name);
  return remote === null ? null : remoteReviewRequest(remote, name.slice(remote.name.length + 1));
}

/** The review request for `branch` once it has been pushed to the remote `remoteName`. */
export function pushedReviewRequest(
  state: RepositoryState | null,
  remoteName: string,
  branch: string
): ReviewRequest | null {
  const remote = state?.remotes.find((item) => item.name === remoteName);
  return remote === undefined ? null : remoteReviewRequest(remote, branch);
}
