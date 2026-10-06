export type RemoteDetails = { name: string; fetchUrls: string[]; pushUrls: string[] };
/** A ref and the commit it points to. An annotated tag reports the commit, not the tag object. */
export type RefDetails = { name: string; hash: string };
/** A branch, remote branch or tag offered by Go to, with the subject of its commit. */
export type RefTarget = GitRef & { subject: string };
export type BranchDetails = {
  name: string;
  hash: string;
  upstream: string;
  ahead: number;
  behind: number;
  gone: boolean;
  /** When the branch's last commit was committed, in seconds since 1970; 0 when unknown. */
  date: number;
  /** Whether HEAD already contains the branch's last commit, as for HEAD's own branch. */
  merged: boolean;
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
  /** How many paths have staged changes. */
  staged: number;
};
export type StashDetails = { ref: string; hash: string; message: string };
export type RebaseEntry = {
  hash: string;
  message: string;
  action: "pick" | "reword" | "squash" | "fixup" | "drop";
};
export type RebasePlan = { base: string; head: string; branch: string; entries: RebaseEntry[] };
/** A commit on the checked-out branch's first-parent line, as an edit of it finds it. */
export type EditPlan = {
  branch: string;
  /** HEAD when the plan was made. The edit is refused once the branch has moved on. */
  head: string;
  target: string;
  /** The target's whole message, without trailing newlines. */
  message: string;
  /** How many commits follow the target on the branch. Each of them gets a new ID. */
  later: number;
  /** A remote-tracking branch already contains the target, so sharing the edit needs a force push. */
  pushed: boolean;
};
/** An edit that adds the staged changes to the target commit. */
export type AmendPlan = EditPlan & { staged: StagedPlan };

export type RepositoryQuery =
  | WorkflowQuery
  | HistoryQuery
  | { kind: "workingTree" }
  | { kind: "branchFocus"; branch: string; hashes: string[] }
  | { kind: "pushStatus" }
  | { kind: "conflictForecast" }
  | { kind: "state" }
  | { kind: "stashes" }
  | {
      kind: "rebasePlan";
      base: string;
      autosquash?: boolean;
      /** Commits to squash into the oldest of them; they must be consecutive in the plan. */
      squash?: string[];
    }
  | { kind: "editPlan"; target: string }
  | { kind: "amendPlan"; target: string }
  | { kind: "lease"; remote: string; branch: string }
  /** Check the signature of the commit `hash` names. */
  | { kind: "signature"; hash: string };

export type RepositoryQueryData =
  | WorkflowQueryData
  | HistoryQueryData
  | { kind: "workingTree"; files: WorkingTreeFile[] }
  | { kind: "branchFocus"; tip: string; direct: string[]; merged: string[] }
  | { kind: "pushStatus"; unpushed: string[]; unpulled: string[] }
  | { kind: "conflictForecast"; conflicts: Array<{ branch: string; files: string[] }> }
  | { kind: "state"; state: RepositoryState }
  | { kind: "stashes"; stashes: StashDetails[] }
  | { kind: "rebasePlan"; plan: RebasePlan }
  | { kind: "editPlan"; plan: EditPlan }
  | { kind: "amendPlan"; plan: AmendPlan }
  | { kind: "lease"; hash: string }
  | { kind: "signature"; hash: string; check: SignatureCheck };

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
  | { kind: "reword"; plan: EditPlan; message: string }
  | { kind: "amendCommit"; plan: AmendPlan }
  | { kind: "recover"; operation: OperationState; resolution: "continue" | "abort" | "skip" }
  | { kind: "conflict"; path: string; operation: "open" | "stage" }
  | { kind: "addWorktree"; path: string; branch: string; newBranch: boolean; startPoint: string }
  | { kind: "removeWorktree"; path: string; expectedHead: string }
  | { kind: "openWorktree"; path: string };
import type { GitRef, SignatureCheck } from "./git.types";
import type { HistoryAction, HistoryQuery, HistoryQueryData, StagedPlan } from "./history.types";
import type { WorkflowAction, WorkflowQuery, WorkflowQueryData } from "./workflow.types";
import type { WorkingTreeFile, WorkingTreeGroup } from "./workingTree.types";
