export type RemoteDetails = { name: string; fetchUrls: string[]; pushUrls: string[] };
/** A ref and the commit it points to. An annotated tag reports the commit, not the tag object. */
export type RefDetails = { name: string; hash: string };
export type BranchDetails = {
  name: string;
  hash: string;
  upstream: string;
  ahead: number;
  behind: number;
  gone: boolean;
};
export type WorktreeDetails = {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
};
export type OperationKind = "merge" | "rebase" | "cherry-pick" | "revert";
export type OperationState = { kind: OperationKind; id: string };
export type RepositoryState = {
  remotes: RemoteDetails[];
  pushDefault: string | null;
  branches: BranchDetails[];
  remoteBranches: RefDetails[];
  tags: RefDetails[];
  worktrees: WorktreeDetails[];
  head: string;
  operation: OperationState | null;
  conflicts: string[];
};
export type StashDetails = { ref: string; hash: string; message: string };
export type RebaseEntry = {
  hash: string;
  message: string;
  action: "pick" | "reword" | "squash" | "fixup" | "drop";
};
export type RebasePlan = { base: string; head: string; branch: string; entries: RebaseEntry[] };

export type RepositoryQuery =
  | WorkflowQuery
  | HistoryQuery
  | { kind: "workingTree" }
  | { kind: "branchFocus"; branch: string; hashes: string[] }
  | { kind: "state" }
  | { kind: "stashes" }
  | { kind: "rebasePlan"; base: string; autosquash?: boolean }
  | { kind: "lease"; remote: string; branch: string };

export type RepositoryQueryData =
  | WorkflowQueryData
  | HistoryQueryData
  | { kind: "workingTree"; files: WorkingTreeFile[] }
  | { kind: "branchFocus"; tip: string; direct: string[]; merged: string[] }
  | { kind: "state"; state: RepositoryState }
  | { kind: "stashes"; stashes: StashDetails[] }
  | { kind: "rebasePlan"; plan: RebasePlan }
  | { kind: "lease"; hash: string };

export type RepositoryAction =
  | WorkflowAction
  | HistoryAction
  | { kind: "viewWorkingTreeFile"; path: string; group: WorkingTreeGroup }
  | { kind: "addRemote"; name: string; url: string; fetch: boolean }
  | { kind: "editRemote"; name: string; fetchUrls: string[]; pushUrls: string[] }
  | { kind: "renameRemote"; name: string; newName: string }
  | { kind: "removeRemote"; name: string }
  | { kind: "pushDefault"; remote: string | null }
  | { kind: "setTracking"; branch: string; upstream: string | null }
  | { kind: "deleteRemoteRef"; remote: string; name: string; refType: "branch" | "tag" }
  | { kind: "saveStash"; message: string; includeUntracked: boolean }
  | {
      kind: "stash";
      operation: "inspect" | "apply" | "pop" | "drop";
      stash: StashDetails;
      reinstateIndex: boolean;
    }
  | { kind: "rebase"; branch: string; onto: string; expectedHead: string }
  | { kind: "interactiveRebase"; plan: RebasePlan }
  | { kind: "recover"; operation: OperationState; resolution: "continue" | "abort" | "skip" }
  | { kind: "conflict"; path: string; operation: "open" | "stage" }
  | { kind: "addWorktree"; path: string; branch: string; newBranch: boolean; startPoint: string }
  | { kind: "removeWorktree"; path: string; expectedHead: string }
  | { kind: "openWorktree"; path: string };
import type { HistoryAction, HistoryQuery, HistoryQueryData } from "./history.types";
import type { WorkflowAction, WorkflowQuery, WorkflowQueryData } from "./workflow.types";
import type { WorkingTreeFile, WorkingTreeGroup } from "./workingTree.types";
