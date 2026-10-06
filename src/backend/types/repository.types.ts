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
/** Values of the `branchwise.conflictForecast` setting: which branches the forecast tries. */
export type ConflictForecastScope = "local" | "localAndRemote" | "off";
/**
 * A branch that would not merge cleanly into HEAD. `branch` is a local branch's name, or a
 * remote-tracking branch's as `<remote>/<branch>` when `remote` is set. `committer` and `date`
 * (seconds since 1970) belong to its last commit, so the page can say whose work it is.
 */
export type ConflictForecastEntry = {
  branch: string;
  remote: boolean;
  files: string[];
  committer: string;
  date: number;
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
  /** The last destructive action that Undo can put back, if any. */
  undo?: SafetyUndo | null;
};
export type StashDetails = { ref: string; hash: string; message: string };
export type RebaseEntry = {
  hash: string;
  message: string;
  action: "pick" | "reword" | "squash" | "fixup" | "drop";
  /**
   * On the first commit of a squash group, the combined commit's message as the user edited it.
   * Without it Git combines the messages itself.
   */
  squashMessage?: string;
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
/** What replaying commits would do, worked out without touching the work tree, index or refs. */
export type ReplayForecast = {
  /** The first commit that would stop with conflicts, and its conflicted files. */
  stop: { hash: string; subject: string; files: string[] } | null;
  /** How many commits would apply cleanly: all of them, or those before the stop. */
  replayed: number;
  /** Why nothing was tried: too many commits, or a Git older than 2.40. */
  skipped?: "limit" | "unsupported";
};
/**
 * Commits to replay onto `onto`. A rebase replays what `git rebase onto` would, merges included;
 * a pick or revert replays `commits` in order, using parent `mainline` (1-based) of a merge.
 */
export type ReplayForecastQuery =
  | { kind: "replayForecast"; mode: "rebase"; onto: string }
  | {
      kind: "replayForecast";
      mode: "pick" | "revert";
      onto: string;
      commits: string[];
      mainline?: number;
    };
/** One hunk of the staged changes: where its lines are in HEAD's version and in the staged one. */
export type AbsorbHunk = {
  path: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};
/**
 * Why a staged change stays staged: the file is added, deleted, renamed, binary, or changes its
 * mode or kind; its lines were last changed by a commit outside the branch's own unpushed ones,
 * or by more than one commit; or it adds lines with none around them to go by.
 */
export type AbsorbReason =
  | "added"
  | "deleted"
  | "renamed"
  | "binary"
  | "special"
  | "outside"
  | "several"
  | "noContext";
/** How the staged changes split into fixup commits, as Absorb Staged Changes shows it first. */
export type AbsorbPlan = {
  branch: string;
  /** HEAD when the plan was made. The absorb is refused once the branch has moved on. */
  head: string;
  /** A digest of the staged changes. The absorb is refused once they differ. */
  staged: string;
  /** The commits that get a fixup commit, oldest first, each with the hunks it gets. */
  targets: Array<{ hash: string; subject: string; hunks: AbsorbHunk[] }>;
  /** What stays staged: one hunk, or a whole file when `hunk` is null. */
  left: Array<{ path: string; hunk: AbsorbHunk | null; reason: AbsorbReason }>;
  /** The oldest target's parent, where a rebase squashing the fixups starts; null for a root. */
  base: string | null;
  /** Whether nothing else would be staged, unstaged or untracked, as that rebase needs. */
  clean: boolean;
};

/** A run of changed lines in a file, which a split can put in a part of its own. */
export type SplitHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The hunk's lines, each starting with `-` or `+`, up to `SPLIT_PREVIEW_LINES` of them. */
  lines: string[];
  /** How many more lines the hunk has than `lines` shows. */
  hidden: number;
};
/** A file the commit to split changes. */
export type SplitFile = {
  path: string;
  /** The path before a rename; the same as `path` otherwise. */
  from: string;
  status: "A" | "M" | "D" | "R";
  /**
   * Two or more hunks that may go to different parts, or null for a file that goes whole:
   * one added, deleted, renamed, binary, changing its mode or type, or with one hunk only.
   */
  hunks: SplitHunk[] | null;
};
export type SplitPlan = EditPlan & { files: SplitFile[] };
/**
 * Which part each file of a split plan goes to, by the file's index in the plan: one part for
 * the whole file, or one per hunk. Parts are numbered from 0.
 */
export type SplitAssignment = Array<number | number[]>;

export type RepositoryQuery =
  | WorkflowQuery
  | HistoryQuery
  | { kind: "workingTree" }
  | { kind: "branchFocus"; branch: string; hashes: string[] }
  | { kind: "pushStatus" }
  | {
      kind: "conflictForecast";
      scope: ConflictForecastScope;
      /** Which remote-tracking branches the graph shows; the forecast leaves out the others. */
      showRemoteBranches?: boolean;
      hiddenRemotes?: string[];
      hiddenBranchPatterns?: string[];
    }
  | ReplayForecastQuery
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
  | { kind: "splitPlan"; target: string }
  | { kind: "absorbPlan" }
  | { kind: "lease"; remote: string; branch: string }
  | { kind: "safetyNet" }
  /** Check the signature of the commit `hash` names. */
  | { kind: "signature"; hash: string };

export type RepositoryQueryData =
  | WorkflowQueryData
  | HistoryQueryData
  | { kind: "workingTree"; files: WorkingTreeFile[] }
  | { kind: "branchFocus"; tip: string; direct: string[]; merged: string[] }
  | { kind: "pushStatus"; unpushed: string[]; unpulled: string[] }
  | { kind: "conflictForecast"; conflicts: ConflictForecastEntry[] }
  | { kind: "replayForecast"; forecast: ReplayForecast }
  | { kind: "state"; state: RepositoryState }
  | { kind: "stashes"; stashes: StashDetails[] }
  | { kind: "rebasePlan"; plan: RebasePlan }
  | { kind: "editPlan"; plan: EditPlan }
  | { kind: "amendPlan"; plan: AmendPlan }
  | { kind: "splitPlan"; plan: SplitPlan }
  | { kind: "absorbPlan"; plan: AbsorbPlan }
  | { kind: "lease"; hash: string }
  | { kind: "safetyNet"; entries: SafetyNetEntry[] }
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
  | { kind: "splitCommit"; plan: SplitPlan; messages: string[]; assignment: SplitAssignment }
  | { kind: "absorb"; plan: AbsorbPlan }
  | { kind: "recover"; operation: OperationState; resolution: "continue" | "abort" | "skip" }
  | { kind: "conflict"; path: string; operation: "open" | "stage" }
  | { kind: "addWorktree"; path: string; branch: string; newBranch: boolean; startPoint: string }
  | { kind: "removeWorktree"; path: string; expectedHead: string }
  | { kind: "openWorktree"; path: string }
  | { kind: "undoSafetyNet"; id: string };
import type { GitRef, SignatureCheck } from "./git.types";
import type { HistoryAction, HistoryQuery, HistoryQueryData, StagedPlan } from "./history.types";
import type { SafetyNetEntry, SafetyUndo } from "./safetyNet.types";
import type { WorkflowAction, WorkflowQuery, WorkflowQueryData } from "./workflow.types";
import type { WorkingTreeFile, WorkingTreeGroup } from "./workingTree.types";
