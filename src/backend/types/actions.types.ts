import type { GitResetMode } from "./git.types";
import type { RepositoryAction } from "./repository.types";

/** `null` when the action succeeded, otherwise why it failed, often in Git's own words. */
export type GitCommandStatus = string | null;

/**
 * What each action needs besides the repository, keyed by its command. A few inputs also name
 * `requestId`: the four where every sender must supply one, and the two where one may be passed.
 */
type Payloads = {
  repositoryAction: { requestId: string; action: RepositoryAction };

  /** `message` is ignored when `lightweight` is true, and the webview then sends `""`. */
  addTag: { tagName: string; commitHash: string; lightweight: boolean; message: string };
  deleteTag: { tagName: string };
  pushTag: { tagName: string; remote: string; requestId?: string };

  createBranch: { commitHash: string; branchName: string };
  deleteBranch: { branchName: string; forceDelete: boolean };
  renameBranch: { oldName: string; newName: string };
  /**
   * `remoteBranch` is `null` for a local branch, or the short `<remote>/<branch>` name to check
   * out from, fetching it first when `fetch` is true.
   */
  checkoutBranch: {
    branchName: string;
    remoteBranch: string | null;
    fetch?: boolean;
    requestId?: string;
  };

  /**
   * `parentIndex` is 0 for an ordinary commit, or the 1-based parent of a merge to replay
   * against, which Git receives as `-m`.
   */
  cherrypickCommit: { commitHash: string; parentIndex: number };
  revertCommit: { commitHash: string; parentIndex: number };
  checkoutCommit: { commitHash: string };
  resetToCommit: { commitHash: string; resetMode: GitResetMode };

  /** `createNewCommit` asks for `--no-ff`. */
  mergeBranch: { branchName: string; createNewCommit: boolean };
  mergeCommit: { commitHash: string; createNewCommit: boolean };

  /** A present `expectedRemoteHash` turns the push into a force-with-lease against it. */
  pushBranch: {
    requestId: string;
    branchName: string;
    remote: string;
    remoteBranch: string;
    setUpstream: boolean;
    expectedRemoteHash?: string;
  };
  pullBranch: { requestId: string; branchName: string; remote: string; remoteBranch: string };
  /** A `null` remote fetches from every remote. */
  fetchRemote: { requestId: string; remote: string | null; prune: boolean };
};

type ActionName = keyof Payloads;

/** The input of the backend function behind action `T`, without the message envelope. */
export type ActionPayload<T extends ActionName> = Payloads[T];

/**
 * A request from the webview to run one action in `repo`. `requestId` pairs the answer with the
 * request and lets the webview cancel it; a request without one gets an answer without echoes.
 */
export type ActionRequest = {
  [K in ActionName]: { command: K; repo: string; requestId?: string } & Payloads[K];
}[ActionName];

/**
 * The single answer to an `ActionRequest`, sent once the action settles. `repo` and `requestId`
 * are copied from the request together, and only when it had a `requestId`.
 */
export type ActionResponse = {
  [K in ActionName]: { command: K; status: GitCommandStatus; repo?: string; requestId?: string };
}[ActionName];
