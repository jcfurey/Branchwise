import type { GitCommitDetails, GitCommitNode } from "./git.types";
import type { RepositoryQuery, RepositoryQueryData } from "./repository.types";

/**
 * The reads behind the graph view. Each runs latest-wins: a newer request of the same kind, or a
 * change of repository, cancels the one in flight, and a cancelled read answers nothing.
 */
export type GraphQueryCommand = "loadBranches" | "loadCommits" | "commitDetails";

/** Which repository a message concerns, and which request it belongs to. */
type Identity = { repo: string; requestId: string };

/** How the two ref-listing reads treat remote-tracking branches. */
type RefScope = {
  showRemoteBranches: boolean;
  /** Remotes whose branches are left out; missing means none. */
  hiddenRemotes?: string[];
  /** An opaque tag for the webview's remote choice, echoed so it can drop outdated answers. */
  visibilityKey?: string;
  /** Always sent as `true` and echoed back unread. */
  hard: boolean;
};

/**
 * What the backend query for each command returns. The handler adds `repo` and `requestId` from
 * the request, so the graph reads leave out `requestId`, and `commitDetails` both.
 */
type Results = {
  /** Failure leaves `data` `null` and puts the message in `status`. */
  repositoryQuery: Identity & { data: RepositoryQueryData | null; status: string | null };
  /**
   * `remotes` in JavaScript sort order. `upstream` is the branch's tracked `refs/heads/` branch,
   * and `pushRemote` the remote a push would go to. On failure, all three are empty and `status`
   * holds the message.
   */
  loadRemotes: Identity & {
    remotes: string[];
    upstream: { remote: string; branchName: string } | null;
    pushRemote: string | null;
    status: string | null;
  };
  /** `null` when the revision is not a single commit or Git's answer could not be read. */
  commitDetails: { commitDetails: GitCommitDetails | null };
  /**
   * `branches` lists the checked-out branch first, then other local branches, then any remote ones
   * as `remotes/<remote>/<branch>`. `head` is the checked-out branch's name, if there is one.
   */
  loadBranches: {
    repo: string;
    branches: string[];
    head: string | null;
    hard: boolean;
    /** Always true: a folder that is not a repository fails the read instead. */
    isRepo: boolean;
    /** Copied from the request, so it may be present and `undefined`. */
    visibilityKey?: string | undefined;
  };
  /**
   * `head` is HEAD's commit hash, not a branch name. `uncommittedChanges` counts the working tree
   * entries, and is above zero exactly when `commits` opens with the placeholder row `"*"`.
   */
  loadCommits: {
    repo: string;
    branchName: string;
    commits: GitCommitNode[];
    head: string | null;
    moreCommitsAvailable: boolean;
    hard: boolean;
    uncommittedChanges: number;
    visibilityKey?: string | undefined;
  };
};

type QueryName = keyof Results;

/** What each read asks for, besides its identity. */
type Queries = {
  repositoryQuery: { query: RepositoryQuery };
  /** The local branch whose upstream and push remote to report, or `null` for neither. */
  loadRemotes: { branchName: string | null };
  commitDetails: { commitHash: string };
  loadBranches: RefScope;
  /**
   * `branchName` is `""` for every branch, or an entry of the `loadBranches` list. Branches whose
   * names match `hiddenBranchPatterns` are left out, apart from the checked-out branch and
   * `shownBranch`, the branch chosen in the header.
   */
  loadCommits: RefScope & {
    branchName: string;
    maxCommits: number;
    hiddenBranchPatterns?: string[];
    shownBranch?: string;
  };
};

/** The content of a successful answer to `T`, as the backend query returns it. */
export type QueryResult<T extends QueryName> = Results[T];

/** A read request from the webview. */
export type QueryRequest = {
  [K in QueryName]: { command: K } & Identity & Queries[K];
}[QueryName];

/** The answer to a `QueryRequest`, echoing its `repo` and `requestId`. */
export type QueryResponse = {
  [K in QueryName]: { command: K } & Identity & Results[K];
}[QueryName];
