import type { OperationKind } from "./repository.types";

/** The destructive actions the Safety Net records. */
export type SafetyActionKind =
  | "softReset"
  | "mixedReset"
  | "hardReset"
  | "rebase"
  | "interactiveRebase"
  | "reword"
  | "amend"
  | "absorb"
  | "merge"
  | "cherryPick"
  | "revert"
  | "fastForward"
  | "deleteBranch"
  | "cleanup"
  | "renameBranch"
  | "deleteTag"
  | "dropStash"
  | "forcePush"
  | "deleteRemoteBranch";

/** One ref an action moved, created or deleted. `null` stands for a ref that does not exist. */
export type SafetyRefChange = {
  /** The full ref name, or `HEAD` for a detached HEAD. */
  ref: string;
  old: string | null;
  new: string | null;
};

/**
 * What one destructive action replaced, written before the action ran. Every old value is kept
 * reachable under `refs/branchwise/backup/<id>/`, so Git's garbage collection leaves it alone.
 */
export type SafetyRecord = {
  /** `<milliseconds since 1970>-<n>`, unique in the repository and in time order. */
  id: string;
  kind: SafetyActionKind;
  /** What the title names: a branch, a tag, a stash message or a count of branches. */
  subject: string;
  /** A second name, such as a renamed branch's new name; usually empty. */
  detail: string;
  /** When the action started, in seconds since 1970. */
  date: number;
  /** The branch HEAD was on when the action started, as a full ref, or `null` when detached. */
  head: string | null;
  /**
   * How Undo moves the checked-out branch back: `keep` updates the files as `git reset --keep`
   * does, `soft` leaves the index and files alone, `mixed` resets the index too.
   */
  mode: "keep" | "soft" | "mixed";
  /** Until the action finishes, `new` repeats `old`. */
  changes: SafetyRefChange[];
  /** Uncommitted changes a hard reset discarded, kept as a `git stash create` commit. */
  saved: string | null;
  /** A dropped stash's commit and message. */
  stash: { hash: string; message: string } | null;
  /** The configuration of deleted branches, such as their upstream, as key and value. */
  config: Array<[key: string, value: string]>;
  /** False for actions that are only recorded, such as a force push. */
  undoable: boolean;
  /**
   * `pending` while an operation the action left stopped, such as a rebase on a conflict, is
   * unfinished; `unfinished` when it ended outside Branchwise, so the new values are unknown.
   */
  state: "pending" | "unfinished" | "done" | "undone";
  /** The operation a pending record waits for. */
  operation: OperationKind | null;
};

/** A commit that only a Safety Net backup still reaches. */
export type LostCommit = { hash: string; subject: string; date: number };

/** A record as the Safety Net lists it, newest first. */
export type SafetyNetEntry = SafetyRecord & {
  /** The localized name of the action, such as "Hard Reset of main". */
  title: string;
  /** Whether Restore can put the refs back now, as far as the record tells. */
  restorable: boolean;
  /** Commits no branch, tag, remote branch or HEAD reaches any more, newest first. */
  lost: LostCommit[];
  /** More lost commits than `lost` lists. */
  moreLost: boolean;
};

/** The action the header's Undo entry would undo. */
export type SafetyUndo = { id: string; title: string };
